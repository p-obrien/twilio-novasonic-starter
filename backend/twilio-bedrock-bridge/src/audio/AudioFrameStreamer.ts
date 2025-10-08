/**
 * AudioFrameStreamer - High-performance timer-driven audio streaming for Twilio
 * 
 * This module provides utilities for streaming pre-recorded audio buffers to Twilio
 * WebSocket connections with precise timing control and backpressure management.
 * 
 * Key features:
 * - Timer-driven transmission for consistent frame delivery
 * - Pre-encoding optimization to minimize per-frame processing overhead
 * - Backpressure detection and handling to prevent buffer overflow
 * - Automatic WebSocket state monitoring and cleanup
 * - Configurable frame sizes and transmission intervals
 * 
 * The streamer is optimized for scenarios where you have a complete audio buffer
 * (e.g., from Bedrock TTS) that needs to be transmitted as timed frames to maintain
 * proper audio playback timing on the Twilio side.
 * 
 * @example
 * ```typescript
 * // Stream a complete audio buffer with default settings
 * streamAudioFrames(websocket, audioBuffer, 'session-123');
 * 
 * // Stream with custom frame timing
 * streamAudioFrames(websocket, audioBuffer, 'session-123', {
 *   frameSize: 160,
 *   intervalMs: 20,
 *   bufferedAmountThreshold: 32768
 * });
 * ```
 */

import logger from '../observability/logger';

/**
 * Configuration options for audio frame streaming behavior.
 */
export interface AudioFrameStreamerOptions {
  /** Size of each audio frame in bytes (default: 160 for 20ms at 8kHz) */
  frameSize?: number;
  /** Interval between frame transmissions in milliseconds (default: 20ms) */
  intervalMs?: number;
  /** WebSocket buffer threshold for backpressure control (default: 32768 bytes) */
  bufferedAmountThreshold?: number;
}

/**
 * Minimal WebSocket interface required for audio frame streaming.
 * Provides the essential methods and properties needed for Twilio communication.
 */
export interface WebSocketLike {
  /** WebSocket connection state (1 = OPEN, others = closed/closing) */
  readyState: number;
  /** Twilio stream identifier for this WebSocket connection */
  twilioStreamSid?: string;
  /** Current outbound sequence number for frame ordering */
  _twilioOutSeq?: number;
  /** Send data through the WebSocket with optional error callback */
  send(data: string, callback?: (err?: Error) => void): void;
  /** Register event listeners for WebSocket state changes */
  on(event: string, listener: (...args: any[]) => void): void;
}

/**
 * Streams a complete μ-law audio buffer to Twilio WebSocket as precisely timed frames.
 * 
 * This function takes a complete audio buffer and streams it frame-by-frame with
 * consistent timing to ensure proper audio playback. It uses pre-encoding optimization
 * to minimize CPU overhead during transmission and implements backpressure control
 * to prevent WebSocket buffer overflow.
 * 
 * The streaming process:
 * 1. Pre-encodes all frames and JSON payloads to avoid per-tick processing
 * 2. Starts a timer that fires at the configured interval (default 20ms)
 * 3. Each timer tick sends one frame if WebSocket buffer allows
 * 4. Monitors WebSocket state and stops on disconnection
 * 5. Sends completion mark when all frames are transmitted
 * 
 * Backpressure handling prevents overwhelming the WebSocket by monitoring the
 * bufferedAmount property and skipping transmission when the buffer is full.
 * 
 * @param ws - WebSocket connection for frame transmission
 * @param muBuf - Complete μ-law audio buffer to stream
 * @param sessionId - Unique session identifier for logging and tracking
 * @param options - Configuration options for streaming behavior
 */
export function streamAudioFrames(
  ws: WebSocketLike,
  muBuf: Buffer,
  sessionId: string,
  options: AudioFrameStreamerOptions = {}
): void {
  // Configure frame size with environment variable fallback (160 bytes = 20ms at 8kHz μ-law)
  const frameSize = options.frameSize ?? Number(process.env.TWILIO_ULAW_FRAME_SIZE ?? process.env.TEST_ULAW_FRAME_SIZE ?? 160);
  
  // Configure transmission interval with minimum 1ms to prevent excessive CPU usage
  const forcedIntervalMs = options.intervalMs ?? (process.env.TWILIO_ULAW_FRAME_INTERVAL_MS
    ? Math.max(1, Number(process.env.TWILIO_ULAW_FRAME_INTERVAL_MS))
    : 20); // Default 20ms for real-time audio (50fps)
  
  // Configure backpressure threshold to prevent WebSocket buffer overflow
  // Reduced from 65536 to 32768 bytes for more responsive backpressure handling
  const BUFFERED_AMOUNT_THRESHOLD = options.bufferedAmountThreshold ?? Number(process.env.TWILIO_BUFFERED_AMOUNT_THRESHOLD ?? 32768);

  logger.debug('Beginning timer-driven send of outbound μ-law frames', { 
    sessionId, 
    muBytes: muBuf.length, 
    frameSize, 
    forcedIntervalMs 
  });

  // Pre-encode all frames and JSON payloads to minimize per-tick processing overhead
  // This optimization significantly reduces CPU usage during transmission
  const totalFrames = Math.ceil(muBuf.length / frameSize);
  const framesB64: string[] = new Array(totalFrames);
  const framesJson: string[] = new Array(totalFrames);
  
  // Process each frame: extract, pad if necessary, encode to base64, and pre-build JSON
  for (let i = 0; i < totalFrames; i++) {
    const off = i * frameSize;
    let frameData = muBuf.subarray(off, off + frameSize);
    
    // Pad the final frame with μ-law silence (0xFF) if it's shorter than frameSize
    if (frameData.length < frameSize) {
      const padded = Buffer.alloc(frameSize, 0xFF); // μ-law silence value
      frameData.copy(padded, 0, 0, frameData.length);
      frameData = padded;
    }
    
    // Pre-encode frame to base64 for JSON payload
    framesB64[i] = frameData.toString('base64');
    
    // Pre-build JSON message structure (sequence number filled at send time)
    framesJson[i] = JSON.stringify({
      event: 'media',
      streamSid: ws.twilioStreamSid,
      sequenceNumber: undefined, // Will be updated with actual sequence number
      media: { payload: framesB64[i] }
    });
  }

  // Initialize transmission state tracking
  let seq = Number(ws._twilioOutSeq || 0);  // Current sequence number for frame ordering
  let framesSent = 0;                       // Count of successfully sent frames
  let frameIndex = 0;                       // Index of next frame to send
  let outboundInterval: NodeJS.Timeout | null = null; // Timer handle for cleanup

  /**
   * Helper function to stop the transmission timer and log completion status.
   * Centralizes cleanup logic and ensures proper resource management.
   * 
   * @param reason - Optional reason for stopping (used for debugging)
   */
  const stopOutbound = (reason?: string) => {
    if (outboundInterval) {
      clearInterval(outboundInterval);
      outboundInterval = null;
    }
    logger.debug('Stopped outbound timer', { sessionId, reason, framesSent, frameIndex, totalFrames });
  };

  // Start the precision timer for frame transmission
  outboundInterval = setInterval(() => {
    // Verify WebSocket is still open and available for transmission
    if (!ws || ws.readyState !== 1) {
      stopOutbound('websocket_closed');
      return;
    }

    // Check if all frames have been transmitted
    if (frameIndex >= totalFrames) {
      stopOutbound('completed_frames');
      sendCompletionMark(ws, sessionId);
      return;
    }

    try {
      // Implement backpressure control to prevent WebSocket buffer overflow
      const buffered = (ws as any).bufferedAmount ?? 0;
      if (buffered > BUFFERED_AMOUNT_THRESHOLD) {
        // Skip this transmission cycle to allow WebSocket buffer to drain
        // This prevents memory buildup and maintains audio quality
        logger.debug('Skipping send due to high ws.bufferedAmount', { 
          sessionId, 
          buffered, 
          frameIndex, 
          BUFFERED_AMOUNT_THRESHOLD 
        });
        return;
      }

      // Increment sequence number for proper frame ordering
      seq = seq + 1;
      ws._twilioOutSeq = seq;

      // Inject sequence number into pre-built JSON message
      // This approach minimizes JSON parsing overhead during transmission
      const msgObj: any = JSON.parse(framesJson[frameIndex]);
      msgObj.sequenceNumber = String(seq);
      const payloadStr = JSON.stringify(msgObj);

      // Send frame asynchronously to maintain timer precision
      // Using fire-and-forget pattern with error callback for monitoring
      ws.send(payloadStr, (err: any) => {
        if (err) {
          logger.warn('Failed to send outbound media frame (callback)', { sessionId, seq, err });
          // Stop transmission on send errors to prevent rapid retry loops
          stopOutbound('send_error');
          return;
        }
        
        // Track successful transmissions and log progress periodically
        framesSent++;
        if (framesSent % 25 === 0) {
          logger.debug('Sent outbound media frame batch progress', { sessionId, framesSent, seq });
        }
      });

      // Advance to next frame for subsequent timer tick
      frameIndex++;
      
    } catch (err) {
      logger.warn('Error in timer-driven outbound sender', { sessionId, err, frameIndex });
      stopOutbound('exception');
    }
  }, forcedIntervalMs);

  // Register WebSocket event handlers for automatic cleanup
  // These ensure the timer is stopped if the connection fails during streaming
  ws.on('close', () => {
    stopOutbound('ws_close_event');
  });
  
  ws.on('error', (err: any) => {
    logger.warn('WebSocket error during outbound sending', { sessionId, err });
    stopOutbound('ws_error_event');
  });
}

/**
 * Sends a completion mark to Twilio indicating the end of audio stream transmission.
 * 
 * Twilio uses marks for synchronization and stream lifecycle management. The completion
 * mark helps Twilio detect when an audio stream has finished, enabling proper call
 * flow management and resource cleanup on the Twilio side.
 * 
 * The mark includes a timestamp-based unique identifier to distinguish between
 * different audio streams and completion events.
 * 
 * @param ws - WebSocket connection to send the mark through
 * @param sessionId - Session identifier for logging and tracking
 */
function sendCompletionMark(ws: WebSocketLike, sessionId: string): void {
  try {
    if (ws && ws.readyState === 1 && ws.twilioStreamSid) {
      const markMsg = {
        event: 'mark',
        streamSid: ws.twilioStreamSid,
        mark: { name: `bedrock_out_${Date.now()}` }
      };
      ws.send(JSON.stringify(markMsg));
      logger.debug('Sent mark after Bedrock outbound audio', { 
        client: sessionId, 
        markName: markMsg.mark.name 
      });
    } else {
      logger.debug('Skipping mark send: websocket not open or no twilioStreamSid', { 
        sessionId, 
        readyState: ws && ws.readyState, 
        twilioStreamSid: ws.twilioStreamSid 
      });
    }
  } catch (markErr) {
    logger.warn('Failed to send mark after Bedrock outbound audio', { client: sessionId, err: markErr });
  }
}