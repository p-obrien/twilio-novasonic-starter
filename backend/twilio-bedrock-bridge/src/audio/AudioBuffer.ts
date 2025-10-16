/**
 * Audio buffer for smoothing irregular Bedrock audio chunks into consistent Twilio frames.
 * 
 * This class solves the timing mismatch between Bedrock's variable-sized audio chunks
 * and Twilio's requirement for consistent 160-byte μ-law frames at 20ms intervals.
 * 
 * Key features:
 * - Accumulates audio data from multiple Bedrock chunks
 * - Outputs precisely timed 160-byte frames every 20ms
 * - Handles buffer overflow protection to prevent memory issues
 * - Provides proper frame padding and completion signaling
 * 
 * @example
 * ```typescript
 * const buffer = new AudioBuffer(websocket, 'session-123');
 * buffer.addAudio(bedrockChunk1); // 240 bytes
 * buffer.addAudio(bedrockChunk2); // 80 bytes
 * // Automatically outputs 160-byte frames at 20ms intervals
 * ```
 */
 
import logger from '../observability/logger';
import { audioQualityAnalyzer } from './AudioQualityAnalyzer';
import { BufferPool } from './BufferPool';
 
/**
 * Configuration options for AudioBuffer behavior
 */
export interface AudioBufferOptions {
  /** Size of each output frame in bytes (default: 160 for 20ms at 8kHz) */
  frameSize?: number;
  /** Interval between frame transmissions in milliseconds (default: 20ms) */
  intervalMs?: number;
  /** Maximum buffer duration in milliseconds before overflow protection kicks in (default: 200ms) */
  maxBufferMs?: number;
}
 
/**
 * Minimal WebSocket interface required for audio transmission
 */
export interface WebSocketLike {
  /** WebSocket ready state (1 = OPEN) */
  readyState: number;
  /** Twilio stream identifier for this connection */
  twilioStreamSid?: string;
  /** Sequence number for outbound frames */
  _twilioOutSeq?: number;
  /** Send data through the WebSocket */
  send(data: string, callback?: (err?: Error) => void): void;
}
 
/**
 * AudioBuffer manages the accumulation and consistent delivery of audio frames
 * for a single session, ensuring smooth playback despite irregular input timing.
 */
export class AudioBuffer {
  /** Internal buffer storing accumulated audio data */
  private buffer: Buffer = Buffer.alloc(0);

  /** Pooled buffers currently in use */
  private pooledBuffers: Buffer[] = [];
 
  /** Size of each output frame in bytes */
  private frameSize: number;
 
  /** Interval between frame transmissions in milliseconds */
  private intervalMs: number;
 
  /** Maximum buffer size in bytes before overflow protection */
  private maxBufferSize: number;
 
  /** Timer handle for periodic frame transmission */
  private timer: NodeJS.Timeout | null = null;
 
  /** Whether the buffer is actively transmitting frames */
  private isActive = false;
 
  /** Current sequence number for frame ordering */
  private seq = 0;

  /** Buffer pool for efficient memory management */
  private bufferPool: BufferPool;
 
  /**
   * Creates a new AudioBuffer for managing consistent frame delivery.
   * 
   * @param ws - WebSocket connection for frame transmission
   * @param sessionId - Unique identifier for this audio session
   * @param options - Configuration options for buffer behavior
   */
  constructor(
    private ws: WebSocketLike,
    private sessionId: string,
    options: AudioBufferOptions = {}
  ) {
    // Configure frame size (160 bytes = 20ms at 8kHz μ-law)
    this.frameSize = options.frameSize ?? 160;
 
    // Configure transmission interval (20ms for real-time audio)
    this.intervalMs = options.intervalMs ?? 20;
 
    // Configure maximum buffer duration to prevent excessive latency
    const maxBufferMs = options.maxBufferMs ?? 200;
    // Fix: μ-law is 1 byte per sample at 8kHz, so 8000 bytes = 1 second
    this.maxBufferSize = Math.floor((8000 * maxBufferMs) / 1000); // Convert ms to bytes at 8kHz
 
    // Initialize sequence number from WebSocket state
    this.seq = Number(ws._twilioOutSeq || 0);

    // Initialize buffer pool
    this.bufferPool = BufferPool.getInstance();
 
    logger.debug('AudioBuffer initialized', {
      sessionId: this.sessionId,
      frameSize: this.frameSize,
      intervalMs: this.intervalMs,
      maxBufferSize: this.maxBufferSize
    });
  }
 
  /**
   * Adds audio data to the internal buffer for eventual transmission.
   * 
   * This method handles variable-sized audio chunks from Bedrock and ensures
   * the buffer doesn't grow beyond configured limits. If the buffer would
   * overflow, the oldest data is dropped to maintain real-time performance.
   * 
   * The transmission timer is automatically started on the first audio addition.
   * 
   * @param audioData - Raw μ-law audio data to buffer
   */
  public addAudio(audioData: Buffer): void {
    // Start transmission timer on first audio data
    if (!this.isActive) {
      this.start();
    }
 
    // Implement overflow protection to prevent excessive memory usage
    if (this.buffer.length + audioData.length > this.maxBufferSize) {
      const excessBytes = (this.buffer.length + audioData.length) - this.maxBufferSize;
 
      logger.warn('Audio buffer overflow, dropping oldest data', {
        sessionId: this.sessionId,
        droppedBytes: excessBytes,
        bufferSize: this.buffer.length,
        newDataSize: audioData.length
      });

      // Report buffer overrun to quality analyzer
      const bufferLevel = this.buffer.length / this.maxBufferSize;
      audioQualityAnalyzer.reportBufferEvent(this.sessionId, 'overrun', bufferLevel);
 
      // Remove excess bytes from the beginning (oldest data) to make room
      this.buffer = this.buffer.subarray(excessBytes);
    }
 
    // Append new audio data to the buffer
    this.buffer = Buffer.concat([this.buffer, audioData]);
 
    logger.debug('Added audio to buffer', {
      sessionId: this.sessionId,
      addedBytes: audioData.length,
      addedMs: Math.round((audioData.length / 8000) * 1000),
      totalBufferBytes: this.buffer.length,
      bufferedMs: Math.round((this.buffer.length / 8000) * 1000) // Convert bytes to milliseconds at 8kHz
    });
  }
 
  /**
   * Starts the periodic frame transmission timer.
   * 
   * This creates a single timer that runs at the configured interval,
   * ensuring consistent frame delivery regardless of when audio data arrives.
   * The timer continues until explicitly stopped or the session ends.
   * 
   * @private
   */
  private start(): void {
    // Prevent multiple timers from being created
    if (this.isActive || this.timer) {
      return;
    }
 
    this.isActive = true;
    logger.debug('Starting audio buffer timer', {
      sessionId: this.sessionId,
      intervalMs: this.intervalMs,
      frameSize: this.frameSize
    });
 
    // Create interval timer for consistent frame delivery with timing measurement
    let lastTimerCall = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const actualInterval = now - lastTimerCall;
      lastTimerCall = now;
 
      // Log if timer is significantly delayed
      if (actualInterval > this.intervalMs + 5) {
        logger.warn('Timer delay detected', {
          sessionId: this.sessionId,
          expectedInterval: this.intervalMs,
          actualInterval,
          delay: actualInterval - this.intervalMs,
          bufferMs: Math.round((this.buffer.length / 8000) * 1000)
        });
      }
 
      this.sendFrame();
    }, this.intervalMs);
  }
 
  /**
   * Sends a single audio frame if sufficient data is available in the buffer.
   * 
   * This method is called periodically by the timer to maintain consistent
   * frame delivery. It extracts exactly one frame's worth of data from the
   * buffer and sends it via WebSocket in Twilio's expected format.
   * 
   * If insufficient data is available, the method waits for more data.
   * If the WebSocket is closed, the buffer is automatically stopped.
   * 
   * @private
   */
  private sendFrame(): void {
    // Verify WebSocket is still available for transmission
    if (!this.ws || this.ws.readyState !== 1) {
      this.stop('websocket_closed');
      return;
    }
 
    // Wait for sufficient data to form a complete frame
    if (this.buffer.length < this.frameSize) {
      // Not enough data yet, continue waiting for more audio
      // Report potential underrun if buffer is getting low
      if (this.buffer.length > 0) {
        const bufferLevel = this.buffer.length / this.maxBufferSize;
        if (bufferLevel < 0.1) { // Less than 10% of max buffer
          audioQualityAnalyzer.reportBufferEvent(this.sessionId, 'underrun', bufferLevel);
        }
      }
      return;
    }
 
    try {
      // Extract exactly one frame's worth of data from the buffer
      const frameData = this.buffer.subarray(0, this.frameSize);
      this.buffer = this.buffer.subarray(this.frameSize);
 
      // Increment sequence number for frame ordering
      this.seq += 1;
      this.ws._twilioOutSeq = this.seq;
 
      // Construct Twilio media message in expected format
      const mediaMessage = {
        event: 'media',
        streamSid: this.ws.twilioStreamSid,
        sequenceNumber: String(this.seq),
        media: {
          payload: frameData.toString('base64') // Convert binary audio to base64
        }
      };
 
      // Send frame asynchronously to avoid blocking the timer
      const sendStartTime = Date.now();
 
      // Use setImmediate to ensure WebSocket send doesn't block the timer
      setImmediate(() => {
        this.ws.send(JSON.stringify(mediaMessage), (err: any) => {
          const sendDuration = Date.now() - sendStartTime;
          if (err) {
            logger.warn('Failed to send audio frame', {
              sessionId: this.sessionId,
              seq: this.seq,
              sendDuration,
              err
            });
          } else if (sendDuration > 5) {
            // Log slow sends that might be causing timing issues
            logger.warn('Slow WebSocket send detected', {
              sessionId: this.sessionId,
              seq: this.seq,
              sendDuration,
              remainingBufferMs: Math.round((this.buffer.length / 8000) * 1000)
            });
          }
        });
      });
 
      logger.debug('Queued audio frame for send', {
        sessionId: this.sessionId,
        seq: this.seq,
        frameBytes: frameData.length,
        frameDurationMs: Math.round((frameData.length / 8000) * 1000),
        remainingBufferBytes: this.buffer.length,
        remainingMs: Math.round((this.buffer.length / 8000) * 1000),
        timestamp: Date.now()
      });
 
    } catch (err) {
      logger.warn('Error sending audio frame', {
        sessionId: this.sessionId,
        err
      });
    }
  }
 
  /**
   * Stops the frame transmission timer and marks the buffer as inactive.
   * 
   * This method immediately stops frame transmission but does not flush
   * remaining audio data. Use flush() if you need to send remaining frames.
   * A completion mark is sent to signal the end of the audio stream.
   * 
   * @param reason - Optional reason for stopping (for logging purposes)
   */
  public stop(reason?: string): void {
    // Clear the periodic transmission timer
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
 
    // Mark buffer as inactive
    this.isActive = false;
 
    logger.debug('AudioBuffer stopped', {
      sessionId: this.sessionId,
      reason,
      remainingBufferBytes: this.buffer.length
    });
 
    // Release any pooled buffers
    this.releasePooledBuffers();

    // Notify Twilio that the audio stream has ended
    this.sendCompletionMark();
  }
 
  /**
   * Flushes all remaining audio data from the buffer and stops transmission.
   * 
   * This method ensures no audio data is lost by sending all complete frames
   * and padding any partial frame with silence. This is typically called when
   * the audio stream ends to ensure all buffered audio reaches the listener.
   * 
   * The buffer is cleared and stopped after flushing is complete.
   */
  public flush(): void {
    logger.debug('Flushing remaining audio buffer', {
      sessionId: this.sessionId,
      remainingBytes: this.buffer.length
    });
 
    // Send all complete frames that can be formed from remaining data
    while (this.buffer.length >= this.frameSize && this.ws && this.ws.readyState === 1) {
      this.sendFrame();
    }
 
    // Handle any partial frame by padding with silence
    if (this.buffer.length > 0 && this.ws && this.ws.readyState === 1) {
      // Create a full frame filled with μ-law silence (0xFF)
      const paddedFrame = Buffer.alloc(this.frameSize, 0xFF);
 
      // Copy the remaining audio data to the beginning of the frame
      this.buffer.copy(paddedFrame, 0, 0, this.buffer.length);
 
      // Send the padded frame
      this.seq += 1;
      this.ws._twilioOutSeq = this.seq;
 
      const mediaMessage = {
        event: 'media',
        streamSid: this.ws.twilioStreamSid,
        sequenceNumber: String(this.seq),
        media: {
          payload: paddedFrame.toString('base64')
        }
      };
 
      this.ws.send(JSON.stringify(mediaMessage));
 
      logger.debug('Sent final padded frame', {
        sessionId: this.sessionId,
        originalBytes: this.buffer.length,
        paddedBytes: this.frameSize
      });
    }
 
    // Clear the buffer and stop transmission
    this.buffer = Buffer.alloc(0);
    this.releasePooledBuffers();
    this.stop('flushed');
  }
 
  /**
   * Sends a completion mark to Twilio indicating the end of the audio stream.
   * 
   * Twilio uses marks for synchronization and to detect when audio streams
   * have finished. This helps with proper call flow management and cleanup.
   * 
   * @private
   */
  private sendCompletionMark(): void {
    try {
      // Only send mark if WebSocket is open and has a valid stream ID
      if (this.ws && this.ws.readyState === 1 && this.ws.twilioStreamSid) {
        const markMsg = {
          event: 'mark',
          streamSid: this.ws.twilioStreamSid,
          mark: { name: `bedrock_out_${Date.now()}` } // Unique mark name with timestamp
        };
 
        this.ws.send(JSON.stringify(markMsg));
 
        logger.debug('Sent completion mark', {
          sessionId: this.sessionId,
          markName: markMsg.mark.name
        });
      }
    } catch (err) {
      logger.warn('Failed to send completion mark', {
        sessionId: this.sessionId,
        err
      });
    }
  }
 
  /**
   * Releases all pooled buffers back to the buffer pool
   */
  private releasePooledBuffers(): void {
    for (const buffer of this.pooledBuffers) {
      this.bufferPool.release(buffer);
    }
    this.pooledBuffers.length = 0;
  }

  /**
   * Returns the current status of the audio buffer.
   * 
   * This method provides insight into buffer state for monitoring and
   * debugging purposes. The returned information includes buffer size
   * in both bytes and milliseconds, plus the active state.
   * 
   * @returns Object containing buffer metrics and status
   */
  public getStatus(): { bufferBytes: number; bufferMs: number; isActive: boolean } {
    return {
      bufferBytes: this.buffer.length,
      bufferMs: Math.round((this.buffer.length / 8000) * 1000), // Convert bytes to milliseconds at 8kHz
      isActive: this.isActive
    };
  }
}