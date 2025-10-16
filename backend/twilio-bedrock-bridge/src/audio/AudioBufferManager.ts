/**
 * AudioBufferManager - Singleton manager for session-based audio buffers
 * 
 * This class provides centralized management of AudioBuffer instances across
 * multiple concurrent sessions. It ensures that each session gets its own
 * isolated audio buffer while providing a unified interface for buffer operations.
 * 
 * Key responsibilities:
 * - Creates and manages AudioBuffer instances per session
 * - Provides session isolation to prevent audio cross-contamination
 * - Handles buffer lifecycle (creation, cleanup, removal)
 * - Offers monitoring and status reporting across all sessions
 * - Implements cleanup routines for inactive sessions
 * 
 * The singleton pattern ensures consistent buffer management across the entire
 * application and prevents duplicate buffer creation for the same session.
 * 
 * @example
 * ```typescript
 * const manager = AudioBufferManager.getInstance();
 * manager.addAudio('session-123', websocket, audioChunk);
 * manager.flushAndRemove('session-123'); // When call ends
 * ```
 */
 
import { AudioBuffer, WebSocketLike } from './AudioBuffer';
import { BufferPool } from './BufferPool';
import logger from '../observability/logger';
 
/**
 * Singleton manager for session-based audio buffer lifecycle management.
 * Ensures proper isolation and cleanup of audio streams across concurrent sessions.
 */
export class AudioBufferManager {
  /** Singleton instance for global buffer management */
  private static instance: AudioBufferManager;
 
  /** Map of session IDs to their corresponding AudioBuffer instances */
  private sessionBuffers: Map<string, AudioBuffer> = new Map();

  /** Buffer pool for efficient memory management */
  private bufferPool: BufferPool;
 
  /** Private constructor to enforce singleton pattern */
  private constructor() { 
    this.bufferPool = BufferPool.getInstance();
  }
 
  /**
   * Gets the singleton instance of AudioBufferManager.
   * 
   * Creates the instance on first access using lazy initialization.
   * This ensures only one manager exists throughout the application lifecycle.
   * 
   * @returns The singleton AudioBufferManager instance
   */
  public static getInstance(): AudioBufferManager {
    if (!AudioBufferManager.instance) {
      AudioBufferManager.instance = new AudioBufferManager();
    }
    return AudioBufferManager.instance;
  }
 
  /**
   * Retrieves or creates an AudioBuffer for the specified session.
   * 
   * If a buffer already exists for the session, it returns the existing instance.
   * Otherwise, creates a new AudioBuffer with optimized settings for Twilio
   * communication and registers it for the session.
   * 
   * Buffer configuration:
   * - 160-byte frames (20ms at 8kHz μ-law)
   * - 5ms transmission intervals for maximum consumption rate
   * - 3000ms maximum buffer to handle Bedrock's faster-than-realtime audio generation
   * 
   * @param sessionId - Unique identifier for the audio session
   * @param ws - WebSocket connection for audio transmission
   * @returns AudioBuffer instance for the session
   */
  public getBuffer(sessionId: string, ws: WebSocketLike): AudioBuffer {
    let buffer = this.sessionBuffers.get(sessionId);
 
    if (!buffer) {
      buffer = new AudioBuffer(ws, sessionId, {
        frameSize: 160,    // 20ms at 8kHz μ-law (160 bytes = 160 samples = 20ms at 8kHz)
        intervalMs: 5,     // Reduced to 5ms intervals for maximum consumption rate
        maxBufferMs: 3000  // Increased to 3000ms for maximum headroom
      });
 
      this.sessionBuffers.set(sessionId, buffer);
 
      logger.debug('Created new audio buffer for session', { sessionId });
    }
 
    return buffer;
  }
 
  /**
   * Adds audio data to the buffer for the specified session.
   * 
   * This is the primary method for feeding audio data into the system.
   * It automatically creates a buffer if one doesn't exist for the session,
   * then delegates the audio data to the session's AudioBuffer for processing.
   * 
   * The audio data will be accumulated and transmitted as consistent frames
   * according to the buffer's configured timing parameters.
   * 
   * @param sessionId - Unique identifier for the audio session
   * @param ws - WebSocket connection for audio transmission
   * @param audioData - Raw μ-law audio data to buffer and transmit
   */
  public addAudio(sessionId: string, ws: WebSocketLike, audioData: Buffer): void {
    const buffer = this.getBuffer(sessionId, ws);
    buffer.addAudio(audioData);
  }
 
  /**
   * Flushes all remaining audio data and removes the buffer for a session.
   * 
   * This method ensures no audio data is lost by sending all buffered audio
   * before cleaning up the session. It should be called when an audio stream
   * ends normally and you want to ensure all audio reaches the listener.
   * 
   * The flush operation will:
   * - Send all complete frames from the buffer
   * - Pad any partial frame with silence and send it
   * - Send a completion mark to Twilio
   * - Remove the buffer from active session tracking
   * 
   * @param sessionId - Unique identifier for the audio session to flush
   */
  public flushAndRemove(sessionId: string): void {
    const buffer = this.sessionBuffers.get(sessionId);
    if (buffer) {
      buffer.flush();
      this.sessionBuffers.delete(sessionId);
      logger.debug('Flushed and removed audio buffer for session', { sessionId });
    }
  }
 
  /**
   * Immediately stops and removes the buffer for a session.
   * 
   * This method stops audio transmission without flushing remaining data.
   * Use this when a session ends abruptly (e.g., call hangup, error conditions)
   * or when you need to immediately halt audio processing.
   * 
   * Unlike flushAndRemove(), this method:
   * - Stops transmission immediately without sending remaining audio
   * - Sends a completion mark to Twilio
   * - Removes the buffer from active session tracking
   * - Logs the reason for stopping (useful for debugging)
   * 
   * @param sessionId - Unique identifier for the audio session to stop
   * @param reason - Optional reason for stopping (logged for debugging)
   */
  public stopAndRemove(sessionId: string, reason?: string): void {
    const buffer = this.sessionBuffers.get(sessionId);
    if (buffer) {
      buffer.stop(reason);
      this.sessionBuffers.delete(sessionId);
      logger.debug('Stopped and removed audio buffer for session', { sessionId, reason });
    }
  }
 
  /**
   * Retrieves the current status of a session's audio buffer.
   * 
   * Provides real-time metrics about the buffer state, useful for monitoring
   * audio latency, buffer health, and debugging audio issues. The returned
   * information includes buffer size in both bytes and milliseconds.
   * 
   * @param sessionId - Unique identifier for the audio session
   * @returns Buffer status object with metrics, or null if session doesn't exist
   * @returns status.bufferBytes - Current buffer size in bytes
   * @returns status.bufferMs - Current buffer duration in milliseconds
   * @returns status.isActive - Whether the buffer is actively transmitting
   */
  public getBufferStatus(sessionId: string): { bufferBytes: number; bufferMs: number; isActive: boolean } | null {
    const buffer = this.sessionBuffers.get(sessionId);
    return buffer ? buffer.getStatus() : null;
  }

  /**
   * Retrieves send queue statistics for a session's audio buffer.
   * 
   * Provides metrics about WebSocket send performance, queue size, and
   * transmission statistics for monitoring and debugging purposes.
   * 
   * @param sessionId - Unique identifier for the audio session
   * @returns Send statistics object, or null if session doesn't exist
   */
  public getSendStats(sessionId: string) {
    const buffer = this.sessionBuffers.get(sessionId);
    return buffer ? buffer.getSendStats() : null;
  }
 
  /**
   * Performs cleanup of inactive audio buffer sessions.
   * 
   * This maintenance method identifies and removes buffers that are no longer
   * active and have no remaining audio data. It helps prevent memory leaks
   * and keeps the session map clean in long-running applications.
   * 
   * A session is considered eligible for cleanup if:
   * - The buffer is not actively transmitting (isActive = false)
   * - The buffer contains no audio data (bufferBytes = 0)
   * 
   * This method should be called periodically (e.g., every few minutes) or
   * after significant session activity to maintain optimal memory usage.
   */
  public cleanup(): void {
    const sessionsToRemove: string[] = [];
 
    for (const [sessionId, buffer] of this.sessionBuffers.entries()) {
      const status = buffer.getStatus();
      if (!status.isActive && status.bufferBytes === 0) {
        sessionsToRemove.push(sessionId);
      }
    }
 
    for (const sessionId of sessionsToRemove) {
      this.sessionBuffers.delete(sessionId);
      logger.debug('Cleaned up inactive audio buffer', { sessionId });
    }
 
    if (sessionsToRemove.length > 0) {
      logger.debug('Audio buffer cleanup completed', {
        removedSessions: sessionsToRemove.length,
        activeSessions: this.sessionBuffers.size
      });
    }
  }
 
  /**
   * Retrieves a list of all currently managed session IDs.
   * 
   * Returns an array of session identifiers for all buffers currently
   * managed by this instance. This is useful for monitoring, debugging,
   * and administrative operations that need to know about active sessions.
   * 
   * Note: The returned sessions may include both active and inactive buffers.
   * Use getBufferStatus() to check the active state of individual sessions.
   * 
   * @returns Array of session IDs currently managed by this buffer manager
   */
  public getActiveSessions(): string[] {
    return Array.from(this.sessionBuffers.keys());
  }
 
  /**
   * Forces removal of all audio buffers (for debugging/config changes).
   * 
   * This method stops and removes all active buffers, forcing new sessions
   * to create fresh buffers with updated configuration. Use with caution
   * as it will interrupt any active audio streams.
   */
  public forceCleanupAll(): void {
    logger.info('Force cleaning up all audio buffers', { 
      activeBuffers: this.sessionBuffers.size 
    });
    
    for (const [sessionId, buffer] of this.sessionBuffers.entries()) {
      buffer.stop('force_cleanup');
    }
    
    this.sessionBuffers.clear();
    logger.info('All audio buffers cleared');
  }

  /**
   * Updates memory pressure and triggers adaptive behavior
   */
  public updateMemoryPressure(): void {
    // Get system memory usage
    const memUsage = process.memoryUsage();
    const totalMemory = memUsage.heapTotal + memUsage.external;
    const usedMemory = memUsage.heapUsed;
    const memoryPressure = usedMemory / totalMemory;

    // Update buffer pool with current memory pressure
    this.bufferPool.updateMemoryPressure(memoryPressure);

    // If memory pressure is high, perform aggressive cleanup
    if (memoryPressure > 0.8) {
      logger.warn('High memory pressure detected, performing cleanup', {
        memoryPressure,
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        activeSessions: this.sessionBuffers.size
      });

      this.cleanup();
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    }
  }

  /**
   * Gets buffer pool statistics for monitoring
   */
  public getBufferPoolStats() {
    return this.bufferPool.getStats();
  }
}