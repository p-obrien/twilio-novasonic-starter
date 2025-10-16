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
  /** Pre-allocated circular buffer for zero-copy audio operations */
  private circularBuffer: Buffer;

  /** Write position in the circular buffer */
  private writePos = 0;

  /** Read position in the circular buffer */
  private readPos = 0;

  /** Current amount of data in the buffer */
  private dataLength = 0;

  /** Pooled buffers currently in use */
  private pooledBuffers: Buffer[] = [];

  /** Size of each output frame in bytes */
  private frameSize: number;

  /** Interval between frame transmissions in milliseconds */
  private intervalMs: number;

  /** Maximum buffer size in bytes before overflow protection */
  private maxBufferSize: number;

  /** Size of the circular buffer (larger than maxBufferSize for safety) */
  private circularBufferSize: number;

  /** Timer handle for periodic frame transmission */
  private timer: NodeJS.Timeout | null = null;

  /** Whether the buffer is actively transmitting frames */
  private isActive = false;

  /** Current sequence number for frame ordering */
  private seq = 0;

  /** Buffer pool for efficient memory management */
  private bufferPool: BufferPool;

  /** Dedicated send queue for WebSocket operations */
  private sendQueue: Array<{
    message: string;
    seq: number;
    timestamp: number;
    callback?: (err?: Error) => void;
  }> = [];

  /** Whether the send queue is currently being processed */
  private processingQueue = false;

  /** Maximum queue size before dropping frames */
  private maxQueueSize = 10;

  /** Send queue processing statistics */
  private sendStats = {
    queued: 0,
    sent: 0,
    dropped: 0,
    errors: 0
  };

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

    // Allocate circular buffer with extra headroom for safety
    // Make it 4x larger than maxBufferSize to handle burst scenarios and wrap-around safely
    this.circularBufferSize = Math.max(this.maxBufferSize * 4, 32768); // Minimum 32KB
    this.circularBuffer = Buffer.alloc(this.circularBufferSize);

    // Initialize sequence number from WebSocket state
    this.seq = Number(ws._twilioOutSeq || 0);

    // Initialize buffer pool
    this.bufferPool = BufferPool.getInstance();

    logger.debug('AudioBuffer initialized', {
      sessionId: this.sessionId,
      frameSize: this.frameSize,
      intervalMs: this.intervalMs,
      maxBufferSize: this.maxBufferSize,
      circularBufferSize: this.circularBufferSize
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
   * Uses a pre-allocated circular buffer for zero-copy operations.
   * 
   * @param audioData - Raw μ-law audio data to buffer
   */
  public addAudio(audioData: Buffer): void {
    // Start transmission timer on first audio data
    if (!this.isActive) {
      this.start();
    }

    const incomingSize = audioData.length;

    // Implement overflow protection to prevent excessive memory usage
    if (this.dataLength + incomingSize > this.maxBufferSize) {
      const excessBytes = (this.dataLength + incomingSize) - this.maxBufferSize;

      logger.warn('Audio buffer overflow, dropping oldest data', {
        sessionId: this.sessionId,
        droppedBytes: excessBytes,
        currentDataLength: this.dataLength,
        newDataSize: incomingSize,
        maxBufferSize: this.maxBufferSize
      });

      // Report buffer overrun to quality analyzer
      const bufferLevel = this.dataLength / this.maxBufferSize;
      audioQualityAnalyzer.reportBufferEvent(this.sessionId, 'overrun', bufferLevel);

      // Advance read position to drop oldest data
      this.advanceReadPosition(excessBytes);
    }

    // Write new audio data to circular buffer
    this.writeToCircularBuffer(audioData);

    logger.debug('Added audio to circular buffer', {
      sessionId: this.sessionId,
      addedBytes: incomingSize,
      addedMs: Math.round((incomingSize / 8000) * 1000),
      totalBufferBytes: this.dataLength,
      bufferedMs: Math.round((this.dataLength / 8000) * 1000),
      writePos: this.writePos,
      readPos: this.readPos
    });
  }

  /**
   * Writes data to the circular buffer, handling wrap-around automatically.
   * This is a zero-copy operation that directly writes to the pre-allocated buffer.
   * 
   * @param data - Audio data to write to the circular buffer
   */
  private writeToCircularBuffer(data: Buffer): void {
    const dataSize = data.length;
    let sourceOffset = 0;

    while (sourceOffset < dataSize) {
      // Calculate how much we can write before hitting the end of the circular buffer
      const spaceToEnd = this.circularBufferSize - this.writePos;
      const bytesToWrite = Math.min(dataSize - sourceOffset, spaceToEnd);

      // Copy data directly into the circular buffer
      data.copy(this.circularBuffer, this.writePos, sourceOffset, sourceOffset + bytesToWrite);

      // Update positions
      this.writePos = (this.writePos + bytesToWrite) % this.circularBufferSize;
      this.dataLength += bytesToWrite;
      sourceOffset += bytesToWrite;
    }
  }

  /**
   * Advances the read position by the specified number of bytes, handling wrap-around.
   * This effectively removes data from the buffer without copying.
   * 
   * @param bytes - Number of bytes to advance (remove from buffer)
   */
  private advanceReadPosition(bytes: number): void {
    const bytesToAdvance = Math.min(bytes, this.dataLength);
    this.readPos = (this.readPos + bytesToAdvance) % this.circularBufferSize;
    this.dataLength -= bytesToAdvance;
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
          bufferMs: Math.round((this.dataLength / 8000) * 1000)
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
   * circular buffer and queues it for asynchronous WebSocket transmission.
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
    if (this.dataLength < this.frameSize) {
      // Not enough data yet, continue waiting for more audio
      // Report potential underrun if buffer is getting low
      if (this.dataLength > 0) {
        const bufferLevel = this.dataLength / this.maxBufferSize;
        if (bufferLevel < 0.1) { // Less than 10% of max buffer
          audioQualityAnalyzer.reportBufferEvent(this.sessionId, 'underrun', bufferLevel);
        }
      }
      return;
    }

    try {
      // Extract exactly one frame's worth of data from the circular buffer
      const frameData = this.readFromCircularBuffer(this.frameSize);

      // Increment sequence number for frame ordering
      this.seq += 1;
      this.ws._twilioOutSeq = this.seq;

      // Pre-serialize the message (move JSON work off critical path)
      const mediaMessage = {
        event: 'media',
        streamSid: this.ws.twilioStreamSid,
        sequenceNumber: String(this.seq),
        media: {
          payload: frameData.toString('base64') // Convert binary audio to base64
        }
      };

      // Queue the frame for async sending
      this.queueFrameForSend(JSON.stringify(mediaMessage), this.seq);

      logger.debug('Prepared audio frame for send queue', {
        sessionId: this.sessionId,
        seq: this.seq,
        frameBytes: frameData.length,
        frameDurationMs: Math.round((frameData.length / 8000) * 1000),
        remainingBufferBytes: this.dataLength,
        remainingMs: Math.round((this.dataLength / 8000) * 1000),
        readPos: this.readPos,
        writePos: this.writePos,
        queueSize: this.sendQueue.length,
        timestamp: Date.now()
      });

    } catch (err) {
      logger.warn('Error preparing audio frame', {
        sessionId: this.sessionId,
        err
      });
    }
  }

  /**
   * Queues a frame for asynchronous WebSocket transmission
   */
  private queueFrameForSend(message: string, seq: number): void {
    // Check queue size and drop oldest frames if necessary
    if (this.sendQueue.length >= this.maxQueueSize) {
      const dropped = this.sendQueue.shift();
      this.sendStats.dropped++;

      logger.warn('Send queue overflow, dropped frame', {
        sessionId: this.sessionId,
        droppedSeq: dropped?.seq,
        queueSize: this.sendQueue.length,
        maxQueueSize: this.maxQueueSize
      });
    }

    // Add to queue
    this.sendQueue.push({
      message,
      seq,
      timestamp: Date.now()
    });

    this.sendStats.queued++;

    // Start processing if not already running
    if (!this.processingQueue) {
      // Use setImmediate to process queue outside timer context
      setImmediate(() => this.processSendQueue());
    }
  }

  /**
   * Processes the WebSocket send queue asynchronously
   */
  private processSendQueue(): void {
    if (this.processingQueue || this.sendQueue.length === 0) {
      return;
    }

    this.processingQueue = true;

    // Process queue in batches to avoid blocking
    const batchSize = 3; // Process up to 3 frames per tick
    let processed = 0;

    const processNext = () => {
      while (processed < batchSize && this.sendQueue.length > 0) {
        const item = this.sendQueue.shift()!;
        processed++;

        // Check if WebSocket is still available
        if (!this.ws || this.ws.readyState !== 1) {
          this.processingQueue = false;
          return;
        }

        // Calculate queue latency
        const queueLatency = Date.now() - item.timestamp;
        if (queueLatency > 10) {
          logger.warn('High send queue latency', {
            sessionId: this.sessionId,
            seq: item.seq,
            queueLatency,
            queueSize: this.sendQueue.length
          });
        }

        // Send the frame
        const sendStartTime = Date.now();
        this.ws.send(item.message, (err: any) => {
          const sendDuration = Date.now() - sendStartTime;

          if (err) {
            this.sendStats.errors++;
            logger.warn('WebSocket send failed', {
              sessionId: this.sessionId,
              seq: item.seq,
              sendDuration,
              queueLatency,
              err
            });
          } else {
            this.sendStats.sent++;

            // Log slow sends
            if (sendDuration > 5) {
              logger.warn('Slow WebSocket send', {
                sessionId: this.sessionId,
                seq: item.seq,
                sendDuration,
                queueLatency,
                remainingQueue: this.sendQueue.length
              });
            }
          }
        });
      }

      // Continue processing if there are more items
      if (this.sendQueue.length > 0) {
        setImmediate(processNext);
      } else {
        this.processingQueue = false;
      }
    };

    processNext();
  }

  /**
   * Reads data from the circular buffer, handling wrap-around automatically.
   * This creates a new buffer with the requested data and advances the read position.
   * 
   * @param bytes - Number of bytes to read from the circular buffer
   * @returns Buffer containing the requested data
   */
  private readFromCircularBuffer(bytes: number): Buffer {
    const bytesToRead = Math.min(bytes, this.dataLength);
    const result = Buffer.allocUnsafe(bytesToRead);
    let resultOffset = 0;
    let remainingBytes = bytesToRead;
    let currentReadPos = this.readPos;

    while (remainingBytes > 0) {
      // Calculate how much we can read before hitting the end of the circular buffer
      const bytesToEnd = this.circularBufferSize - currentReadPos;
      const chunkSize = Math.min(remainingBytes, bytesToEnd);

      // Copy data from circular buffer to result
      this.circularBuffer.copy(result, resultOffset, currentReadPos, currentReadPos + chunkSize);

      // Update positions
      currentReadPos = (currentReadPos + chunkSize) % this.circularBufferSize;
      resultOffset += chunkSize;
      remainingBytes -= chunkSize;
    }

    // Update the actual read position and data length
    this.readPos = currentReadPos;
    this.dataLength -= bytesToRead;

    return result;
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

    // Clear send queue
    this.sendQueue.length = 0;
    this.processingQueue = false;

    // Mark buffer as inactive
    this.isActive = false;

    logger.debug('AudioBuffer stopped', {
      sessionId: this.sessionId,
      reason,
      remainingBufferBytes: this.dataLength,
      sendStats: this.sendStats
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
      remainingBytes: this.dataLength,
      queueSize: this.sendQueue.length
    });

    // For testing environments, use synchronous flush
    if (process.env.NODE_ENV === 'test') {
      this.flushSync();
      return;
    }

    // Send all complete frames that can be formed from remaining data
    while (this.dataLength >= this.frameSize && this.ws && this.ws.readyState === 1) {
      this.sendFrame();
    }

    // Handle any partial frame by padding with silence
    if (this.dataLength > 0 && this.ws && this.ws.readyState === 1) {
      // Read remaining data from circular buffer
      const remainingData = this.readFromCircularBuffer(this.dataLength);

      // Create a full frame filled with μ-law silence (0xFF)
      const paddedFrame = Buffer.alloc(this.frameSize, 0xFF);

      // Copy the remaining audio data to the beginning of the frame
      remainingData.copy(paddedFrame, 0, 0, remainingData.length);

      // Increment sequence and queue the padded frame
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

      // Queue the final padded frame
      this.queueFrameForSend(JSON.stringify(mediaMessage), this.seq);

      logger.debug('Queued final padded frame', {
        sessionId: this.sessionId,
        originalBytes: remainingData.length,
        paddedBytes: this.frameSize,
        seq: this.seq
      });
    }

    // Wait a brief moment for send queue to process, then stop
    setTimeout(() => {
      // Clear the circular buffer and stop transmission
      this.clearCircularBuffer();
      this.releasePooledBuffers();
      this.stop('flushed');
    }, 50); // 50ms should be enough for queue to process
  }

  /**
   * Synchronous flush for testing environments
   */
  private flushSync(): void {
    // Send all complete frames that can be formed from remaining data
    while (this.dataLength >= this.frameSize && this.ws && this.ws.readyState === 1) {
      // Extract frame data
      const frameData = this.readFromCircularBuffer(this.frameSize);

      // Increment sequence number
      this.seq += 1;
      this.ws._twilioOutSeq = this.seq;

      // Send directly without queueing
      const mediaMessage = {
        event: 'media',
        streamSid: this.ws.twilioStreamSid,
        sequenceNumber: String(this.seq),
        media: {
          payload: frameData.toString('base64')
        }
      };

      this.ws.send(JSON.stringify(mediaMessage));
    }

    // Handle any partial frame by padding with silence
    if (this.dataLength > 0 && this.ws && this.ws.readyState === 1) {
      // Read remaining data from circular buffer
      const remainingData = this.readFromCircularBuffer(this.dataLength);

      // Create a full frame filled with μ-law silence (0xFF)
      const paddedFrame = Buffer.alloc(this.frameSize, 0xFF);

      // Copy the remaining audio data to the beginning of the frame
      remainingData.copy(paddedFrame, 0, 0, remainingData.length);

      // Send the padded frame directly
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

      logger.debug('Sent final padded frame synchronously', {
        sessionId: this.sessionId,
        originalBytes: remainingData.length,
        paddedBytes: this.frameSize,
        seq: this.seq
      });
    }

    // Clear the circular buffer and stop transmission
    this.clearCircularBuffer();
    this.releasePooledBuffers();
    this.stop('flushed');
  }

  /**
   * Clears the circular buffer by resetting all positions and data length.
   */
  private clearCircularBuffer(): void {
    this.readPos = 0;
    this.writePos = 0;
    this.dataLength = 0;
    // Optionally clear the buffer contents for security
    this.circularBuffer.fill(0);
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
   * Gets send queue statistics for monitoring
   */
  public getSendStats() {
    return {
      ...this.sendStats,
      queueSize: this.sendQueue.length,
      processing: this.processingQueue
    };
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
      bufferBytes: this.dataLength,
      bufferMs: Math.round((this.dataLength / 8000) * 1000), // Convert bytes to milliseconds at 8kHz
      isActive: this.isActive
    };
  }
}