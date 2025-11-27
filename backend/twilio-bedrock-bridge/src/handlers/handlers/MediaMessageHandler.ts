/**
 * Handler for Twilio 'media' messages.
 *
 * PERFORMANCE CRITICAL: This handler processes audio frames at ~50 frames/second.
 * Any performance degradation here directly impacts call quality and latency.
 *
 * Responsible for:
 * - Processing inbound audio frames from Twilio
 * - Converting audio format (μ-law → PCM16LE, resampling 8kHz → 16kHz)
 * - Managing user turn state (detecting speech activity and silence)
 * - Streaming audio to Bedrock with zero buffering for ultra-low latency
 * - Smart sampling for distributed tracing (avoid tracing every frame)
 */

import { BaseMessageHandler, MessageHandlerContext } from './BaseMessageHandler';
import { TwilioMediaMessage } from '../types/TwilioMessages';
import { processTwilioAudioInput } from '../../audio/AudioProcessor';
import { AudioBufferManager } from '../../audio/AudioBufferManager';
import { extractErrorDetails } from '../../errors/ClientErrors';
import { safeTrace } from '../../observability/safeTracing';
import { smartSampler } from '../../observability/smartSampling';
import { setTimeoutWithCorrelation } from '../../utils/asyncCorrelation';

/**
 * Handles Twilio 'media' events containing audio frames.
 *
 * This is a performance-critical handler that must process frames with minimal overhead.
 */
export class MediaMessageHandler extends BaseMessageHandler<TwilioMediaMessage> {
  /** Timer for detecting end of user speech (silence timeout) */
  private turnEndTimer: NodeJS.Timeout | null = null;

  /** Flag indicating if user is currently speaking */
  private isUserTurnActive = false;

  /** Timestamp of last received audio frame */
  private lastAudioTime = 0;

  /** Silence timeout in milliseconds (3 seconds) */
  private readonly SILENCE_TIMEOUT_MS = 3000;

  /**
   * Handle a Twilio media message containing an audio frame.
   *
   * Processing flow:
   * 1. Validate media payload exists
   * 2. Check if this is an inbound frame (skip outbound)
   * 3. Process audio with smart tracing
   * 4. Manage turn state
   * 5. Send audio immediately to Bedrock (zero buffering)
   *
   * @param message - The media message from Twilio
   */
  async handle(message: TwilioMediaMessage): Promise<void> {
    const media = message.media;
    const payloadB64 = media?.payload || media?.chunk || (message as any).payload;

    // Validate payload exists
    if (!media || !payloadB64) {
      this.log('warn', 'Missing media.payload from Twilio media frame');
      return;
    }

    // Only forward inbound audio (Twilio may send inbound/outbound frames)
    const track = (media.track || '').toString().toLowerCase();
    const isInbound =
      track.includes('inbound') || track === 'inbound' || track === 'inbound_audio' || !track;

    if (!isInbound) {
      this.log('debug', 'Skipping non-inbound media frame', { track });
      return;
    }

    // Use smart sampling for high-volume media processing with safe tracing
    const tracer = safeTrace.getTracer('twilio-bedrock-bridge');
    const samplingDecision = smartSampler.shouldSample({
      operationName: 'websocket.message.media',
      attributes: {
        'websocket.direction': 'inbound',
        'websocket.message_type': 'media',
        'media.track': track
      },
      sessionId: this.ws.id,
      callSid: this.ws.callSid
    });

    // Create span only if sampled and tracing is available
    const span =
      samplingDecision.shouldSample && safeTrace.isAvailable()
        ? smartSampler.startSpanWithSampling(tracer as any, 'websocket.message.media', {
            attributes: {
              'websocket.direction': 'inbound',
              'websocket.message_type': 'media',
              'media.track': track
            },
            sessionId: this.ws.id,
            callSid: this.ws.callSid
          })
        : tracer.startSpan('websocket.message.media'); // Fallback span

    try {
      // Process the audio frame
      await this.processAudioFrame(payloadB64, samplingDecision.shouldSample, span);
    } catch (procErr) {
      // Handle processing errors
      await this.handleProcessingError(procErr, span);
    }
  }

  /**
   * Process an audio frame from Twilio.
   *
   * @param payloadB64 - Base64-encoded μ-law audio payload
   * @param sampled - Whether this frame is being traced
   * @param span - OpenTelemetry span (if tracing)
   */
  private async processAudioFrame(
    payloadB64: string,
    sampled: boolean,
    span: any
  ): Promise<void> {
    const muLawBuf = Buffer.from(payloadB64, 'base64');

    // Process inbound audio using the dedicated audio processor
    const pcm16le_16k = processTwilioAudioInput(muLawBuf, this.ws.id, this.ws.callSid);

    this.log('debug', 'Processed inbound audio', {
      inputBytes: muLawBuf.length,
      outputBytes: pcm16le_16k.length,
      outputSamples: pcm16le_16k.length / 2,
      sampled: sampled
    });

    if (span) {
      span.setAttributes({
        'audio.input_bytes': muLawBuf.length,
        'audio.output_bytes': pcm16le_16k.length,
        'audio.output_samples': pcm16le_16k.length / 2
      });
    }

    // Track audio activity for turn management
    this.updateTurnState();

    // Reset silence timer with correlation context
    this.resetSilenceTimer();

    // Ultra-low latency: send audio immediately to Bedrock (no buffering)
    await this.sendAudioImmediately(pcm16le_16k);

    // End span if it was created
    if (span) {
      span.end();
    }
  }

  /**
   * Update user turn state based on audio activity.
   */
  private updateTurnState(): void {
    this.lastAudioTime = Date.now();

    if (!this.isUserTurnActive) {
      this.isUserTurnActive = true;
      this.log('debug', 'User turn started');
    }
  }

  /**
   * Reset the silence timeout timer.
   */
  private resetSilenceTimer(): void {
    if (this.turnEndTimer) {
      clearTimeout(this.turnEndTimer);
    }

    this.turnEndTimer = setTimeoutWithCorrelation(() => {
      this.endCurrentUserTurn();
    }, this.SILENCE_TIMEOUT_MS);
  }

  /**
   * Send audio immediately to Bedrock without buffering.
   *
   * @param audioData - Processed audio data (PCM16LE @ 16kHz)
   */
  private async sendAudioImmediately(audioData: Buffer): Promise<void> {
    if (!this.sessionId || !this.isSessionActive()) {
      this.log('debug', 'No active Bedrock session for immediate audio', {
        hasSessionId: !!this.sessionId,
        isSessionActive: this.sessionId ? this.isSessionActive() : false
      });
      return;
    }

    try {
      // Send audio chunk immediately to Bedrock (non-blocking)
      this.bedrockClient.streamAudioChunk(this.sessionId, audioData).catch((streamErr) => {
        this.log('warn', 'Failed to forward immediate audio chunk to Bedrock', {
          err: streamErr
        });
      });

      this.log('debug', 'Forwarded immediate audio chunk to Bedrock', {
        bytes: audioData.length,
        latencyMode: 'immediate'
      });
    } catch (err) {
      this.log('warn', 'Error sending immediate audio', { err });
    }
  }

  /**
   * End the current user turn due to silence timeout.
   */
  private endCurrentUserTurn(): void {
    if (!this.isUserTurnActive || !this.sessionId || !this.isSessionActive()) {
      this.log('debug', 'Skipping turn end - not active or no session', {
        isUserTurnActive: this.isUserTurnActive,
        hasSessionId: !!this.sessionId,
        isSessionActive: this.sessionId ? this.isSessionActive() : false
      });
      return;
    }

    try {
      this.log('info', 'Ending user turn due to silence timeout');

      // End audio content (step 8 in Nova Sonic flow)
      this.bedrockClient.sendContentEnd(this.sessionId);
      this.log('info', 'Sent contentEnd for session');

      // Wait a brief moment then signal prompt end (step 9 in Nova Sonic flow)
      setTimeoutWithCorrelation(() => {
        if (this.isSessionActive()) {
          this.bedrockClient.sendPromptEnd(this.sessionId);
          this.log('info', 'Sent promptEnd for session - model should now respond');
        }
      }, 100);

      this.isUserTurnActive = false;
      this.log('debug', 'User turn ended, waiting for model response');
    } catch (endErr) {
      this.log('warn', 'Failed to end user turn', { err: endErr });
    }
  }

  /**
   * Handle audio processing errors.
   *
   * @param procErr - The processing error
   * @param span - OpenTelemetry span (if tracing)
   */
  private async handleProcessingError(procErr: unknown, span: any): Promise<void> {
    const errorDetails = extractErrorDetails(procErr);
    this.log('error', 'Media processing failed - cleaning up session', errorDetails);

    // Clean up audio buffer for this session to prevent memory leaks
    if (this.sessionId) {
      try {
        const audioBufferManager = AudioBufferManager.getInstance();
        audioBufferManager.flushAndRemove(this.sessionId);
        this.log('debug', 'Audio buffer cleaned up after processing error');
      } catch (cleanupErr) {
        this.log('error', 'Failed to clean up audio buffer', {
          error: extractErrorDetails(cleanupErr)
        });
      }
    }

    // End span with error if it was created
    if (span) {
      span.recordException(procErr as Error);
      span.setStatus({
        code: 2,
        message: procErr instanceof Error ? procErr.message : String(procErr)
      });
      span.end();
    }

    // Close WebSocket connection with error status
    try {
      this.ws.close(1011, 'Audio processing error');
    } catch (closeErr) {
      this.log('error', 'Failed to close WebSocket after processing error', {
        error: extractErrorDetails(closeErr)
      });
    }
  }

  /**
   * Cleanup method called when handler is no longer needed.
   * Clears the silence timeout timer.
   */
  cleanup(): void {
    if (this.turnEndTimer) {
      clearTimeout(this.turnEndTimer);
      this.turnEndTimer = null;
    }
  }
}
