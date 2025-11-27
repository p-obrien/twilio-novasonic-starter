/**
 * Handler for Twilio 'start' messages.
 *
 * Responsible for:
 * - Validating start message and CallSid
 * - Setting up WebSocket properties
 * - Creating and initializing Bedrock session
 * - Registering event handlers for Bedrock responses
 * - Queuing initial session events in correct order
 *
 * This is the most complex handler as it orchestrates the entire session initialization.
 */

import { BaseMessageHandler, MessageHandlerContext } from './BaseMessageHandler';
import { TwilioStartMessage } from '../types/TwilioMessages';
import { webSocketSecurity } from '../../security/WebSocketSecurity';
import { SessionMetrics } from '../../observability/sessionMetrics';
import { CorrelationIdManager } from '../../utils/correlationId';
import { AudioBufferManager } from '../../audio/AudioBufferManager';
import { processBedrockAudioOutput } from '../../audio/AudioProcessor';
import { extractErrorDetails, CircuitBreakerOpenError } from '../../errors/ClientErrors';
import { getBedrockCircuitBreaker } from '../../resilience';
import {
  DefaultAudioInputConfiguration,
  DefaultAudioOutputConfiguration,
  DefaultTextConfiguration
} from '../../utils/constants';
import { wsIdToSessionId } from '../WebsocketHandler';

/**
 * Handles Twilio 'start' events which initiate media stream sessions.
 */
export class StartMessageHandler extends BaseMessageHandler<TwilioStartMessage> {
  /**
   * Handle a Twilio start message.
   *
   * This performs the complete session initialization sequence:
   * 1. Validate the start message and CallSid
   * 2. Update WebSocket properties
   * 3. Create Bedrock session
   * 4. Setup session events in correct order
   * 5. Register event handlers for Bedrock responses
   *
   * @param message - The start message from Twilio
   */
  async handle(message: TwilioStartMessage): Promise<void> {
    // Step 1: Validate start message
    const validation = await this.validateStartMessage(message);
    if (!validation.isValid) {
      this.log('warn', 'Invalid Twilio start message', {
        reason: validation.reason,
        callSid: message.start?.callSid
      });
      this.ws.close(1008, 'Invalid start message');
      return;
    }

    // Step 2: Update WebSocket properties
    this.updateWebSocketProperties(message, validation.callSid);

    // Step 3: Create and initialize Bedrock session
    if (!this.ws.id) {
      this.log('error', 'WebSocket missing ID, cannot create session');
      return;
    }

    try {
      // Record mapping for correlating websocket <-> bedrock session
      wsIdToSessionId.set(this.ws.id, this.sessionId);
    } catch (e) {
      this.log('debug', 'Failed to set wsIdToSessionId mapping', { wsId: this.ws.id, err: e });
    }

    // Step 4: Initialize Bedrock session if not already active
    await this.initializeBedrockSession();

    // Step 5: Setup session events and register handlers
    await this.setupSessionEventsAndHandlers();
  }

  /**
   * Validate the start message structure and security.
   *
   * @param message - The start message to validate
   * @returns Validation result with CallSid if valid
   */
  private async validateStartMessage(
    message: TwilioStartMessage
  ): Promise<{ isValid: boolean; reason?: string; callSid?: string }> {
    const validation = webSocketSecurity.validateWebSocketMessage(message);

    if (!validation.isValid) {
      return {
        isValid: false,
        reason: validation.reason
      };
    }

    return {
      isValid: true,
      callSid: validation.callSid
    };
  }

  /**
   * Update WebSocket properties with data from start message.
   *
   * @param message - The start message
   * @param callSid - Validated CallSid
   */
  private updateWebSocketProperties(message: TwilioStartMessage, callSid?: string): void {
    const streamSid = message.start.streamSid;
    this.ws.twilioStreamSid = streamSid;
    this.ws.twilioSampleRate = Number(message.start.sample_rate_hz || 8000);

    // Update with validated CallSid
    if (callSid) {
      this.ws.callSid = callSid;

      // Update correlation context with CallSid information
      const updatedContext = CorrelationIdManager.createWebSocketContext({
        callSid: callSid,
        streamSid: streamSid,
        sessionId: this.sessionId,
        parentCorrelationId: this.ws.correlationContext?.correlationId
      });
      this.ws.correlationContext = updatedContext;
      CorrelationIdManager.setContext(updatedContext);

      // Update session tracking with CallSid
      SessionMetrics.endSession(this.sessionId); // End temporary session
      SessionMetrics.createSession(this.sessionId, this.ws, callSid); // Create new session with CallSid
    }

    this.log('info', 'Twilio start event validated', {
      streamSid: streamSid,
      sampleRate: this.ws.twilioSampleRate,
      callSid: this.ws.callSid
    });
  }

  /**
   * Initialize the Bedrock bidirectional stream session.
   */
  private async initializeBedrockSession(): Promise<void> {
    if (this.isSessionActive()) {
      this.log('debug', 'Bedrock session already active for sessionId');
      return;
    }

    this.log('info', 'Creating and initiating Bedrock session for Twilio call');

    try {
      this.log('debug', 'Calling createStreamSession');
      this.bedrockClient.createStreamSession(this.sessionId);
      this.log('info', 'createStreamSession completed');

      // Start the bidirectional stream in background; don't await since it runs until session end.
      this.log('debug', 'Starting initiateSession (background) for Bedrock', { ts: Date.now() });

      // Wrap initiateSession with circuit breaker for resilience
      const circuitBreaker = getBedrockCircuitBreaker();
      circuitBreaker
        .execute(() => this.bedrockClient.initiateSession(this.sessionId))
        .catch((e: unknown) => {
          const errorDetails = extractErrorDetails(e);

          // Handle circuit breaker open error specifically
          if (e instanceof CircuitBreakerOpenError) {
            this.log('warn', 'Bedrock circuit breaker is OPEN - closing WebSocket', {
              retryAfterMs: e.getRetryAfterMs(),
              retryAfterSeconds: e.getRetryAfterSeconds(),
              ...errorDetails
            });

            // Close WebSocket with 1013 (Try Again Later) status code
            // This tells Twilio that the service is temporarily unavailable
            this.ws.close(1013, 'Service temporarily unavailable - please try again later');
          } else {
            this.log('error', 'Bedrock initiateSession failed (async)', errorDetails);

            // Close WebSocket with 1011 (Internal Server Error) for other errors
            this.ws.close(1011, 'Internal server error');
          }
        });
    } catch (createErr) {
      const errorDetails = extractErrorDetails(createErr);
      this.log('warn', 'Failed to create/initiate Bedrock session (sync)', errorDetails);
    }
  }

  /**
   * Setup session events and register event handlers for Bedrock responses.
   *
   * CRITICAL: Events must be queued in exact order:
   * 1. sessionStart
   * 2. promptStart
   * 3. systemPrompt
   * 4. audioContentStart
   */
  private async setupSessionEventsAndHandlers(): Promise<void> {
    try {
      // Verify session is active before setting up events
      if (!this.isSessionActive()) {
        this.log('error', 'Session is not active, cannot setup events');
        return;
      }

      this.log('debug', 'Setting up session events');

      // CRITICAL: sessionStart MUST be the first event
      this.bedrockClient.setupSessionStartEvent(this.sessionId);
      this.log('info', 'Queued sessionStart for Bedrock session');

      // First: enqueue promptStart to initialize the prompt
      this.bedrockClient.setupPromptStartEvent(this.sessionId);
      this.log('info', 'Queued promptStart for Bedrock session');

      // Second: enqueue SYSTEM role text prompt (required as first content)
      const twilioSystemPrompt =
        'You are a helpful voice assistant on a phone call. When you detect user speech, always respond with a clear, concise spoken acknowledgment or answer. Keep responses brief and conversational, as if speaking naturally on a phone call. Always respond when the user speaks to you.';
      this.bedrockClient.setupSystemPromptEvent(
        this.sessionId,
        DefaultTextConfiguration,
        twilioSystemPrompt
      );
      this.log('info', 'Queued systemPrompt for Bedrock session');

      // Third: queue audio contentStart for user input
      this.bedrockClient.setupStartAudioEvent(this.sessionId, DefaultAudioInputConfiguration);
      this.log('info', 'Queued audio contentStart for Bedrock session');
    } catch (setupErr) {
      this.log('error', 'Failed to setup Bedrock session events', {
        error: setupErr,
        message: (setupErr as Error)?.message
      });
      return;
    }

    // Register event handlers
    this.registerEventHandlers();
  }

  /**
   * Register handlers for Bedrock response events.
   */
  private registerEventHandlers(): void {
    // Register handler for when model response ends to prepare for next user turn
    this.bedrockClient.registerEventHandler(this.sessionId, 'contentEnd', (data: unknown) => {
      const contentEnd = data as { role?: string; type?: string };
      // Check if this is the end of assistant audio content
      if (contentEnd?.role === 'ASSISTANT' && contentEnd?.type === 'AUDIO') {
        this.log('debug', 'Model finished speaking, ready for next user turn');

        // Flush any remaining audio in the buffer
        try {
          const audioBufferManager = AudioBufferManager.getInstance();
          const bufferStatus = audioBufferManager.getBufferStatus(this.sessionId);
          if (bufferStatus && bufferStatus.bufferBytes > 0) {
            this.log('debug', 'Flushing remaining audio buffer after model finished speaking', {
              remainingBytes: bufferStatus.bufferBytes,
              remainingMs: bufferStatus.bufferMs
            });
          }
        } catch (e) {
          this.log('warn', 'Failed to flush audio buffer after contentEnd', { err: e });
        }
      }
    });

    // Register handler to forward Nova Sonic audioOutput events to Twilio using buffered streaming
    this.bedrockClient.registerEventHandler(this.sessionId, 'audioOutput', (data: unknown) => {
      this.handleAudioOutput(data);
    });
  }

  /**
   * Handle audioOutput events from Bedrock.
   *
   * @param data - Audio output event data from Bedrock
   */
  private handleAudioOutput(data: unknown): void {
    const audioOut = data as { audio?: string; sampleRateHz?: number; sample_rate_hz?: number };
    const timestamp = Date.now();

    this.log('debug', 'audioOutput handler invoked', {
      timestamp,
      keys: Object.keys(audioOut || {}),
      sampleRateHint: audioOut?.sampleRateHz ?? audioOut?.sample_rate_hz,
      defaultRate: DefaultAudioOutputConfiguration.sampleRateHertz
    });

    try {
      // Process audio output using the dedicated audio processor
      // Use the configured output sample rate (16kHz) as the default
      const muBuf = processBedrockAudioOutput(
        audioOut,
        DefaultAudioOutputConfiguration.sampleRateHertz || 16000,
        this.sessionId,
        this.ws.callSid
      );

      this.log('debug', 'Processed audioOutput to μ-law', {
        muBytes: muBuf.length,
        muDurationMs: Math.round((muBuf.length / 8000) * 1000),
        timestamp
      });

      // Add audio to session buffer for proper timing
      const audioBufferManager = AudioBufferManager.getInstance();

      const audioRealDurationMs = Math.round((muBuf.length / 8000) * 1000);
      const timeSinceLastAudioMs = timestamp - (this.ws._lastAudioTimestamp || timestamp);
      this.ws._lastAudioTimestamp = timestamp;

      this.log('debug', 'Adding Nova Sonic audio to buffer with proper timing', {
        audioBytes: muBuf.length,
        audioRealDurationMs,
        timeSinceLastAudioMs,
        generationRate:
          audioRealDurationMs > 0
            ? (timeSinceLastAudioMs / audioRealDurationMs).toFixed(2) + 'x'
            : 'unknown',
        isFasterThanRealtime: timeSinceLastAudioMs < audioRealDurationMs,
        mode: 'buffered_timing'
      });

      audioBufferManager.addAudio(this.sessionId, this.ws, muBuf);
    } catch (err) {
      this.log('warn', 'Failed to forward audioOutput to Twilio', {
        err,
        inspected: (err as Error)?.stack ?? null
      });
    }
  }
}
