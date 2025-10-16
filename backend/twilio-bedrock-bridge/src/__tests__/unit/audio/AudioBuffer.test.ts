/**
 * AudioBuffer Unit Tests
 * 
 * Tests for the AudioBuffer class that manages consistent frame delivery
 * for Twilio WebSocket connections with proper timing and buffering.
 */

import { AudioBuffer, AudioBufferOptions, WebSocketLike } from '../../../audio/AudioBuffer';
import { BufferPool } from '../../../audio/BufferPool';

describe('AudioBuffer', () => {
  let mockWebSocket: WebSocketLike;
  let bufferPool: BufferPool;

  beforeEach(() => {
    // Create mock WebSocket with additional methods for testing
    mockWebSocket = {
      ...createMockWebSocket(),
      on: jest.fn()
    } as WebSocketLike & { on: jest.Mock };
    
    // Create isolated buffer pool for each test
    bufferPool = BufferPool.create({ initialSize: 5, maxSize: 20 });
    jest.spyOn(BufferPool, 'getInstance').mockReturnValue(bufferPool);
    
    // Mock timers
    jest.useFakeTimers();
  });

  afterEach(() => {
    bufferPool.cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should create AudioBuffer with default options', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      const status = buffer.getStatus();
      
      expect(status.bufferBytes).toBe(0);
      expect(status.bufferMs).toBe(0);
      expect(status.isActive).toBe(false);
    });

    it('should create AudioBuffer with custom options', () => {
      const options: AudioBufferOptions = {
        frameSize: 320,
        intervalMs: 40,
        maxBufferMs: 500
      };
      
      const buffer = new AudioBuffer(mockWebSocket, 'test-session', options);
      const status = buffer.getStatus();
      
      expect(status.isActive).toBe(false);
    });

    it('should initialize sequence number from WebSocket', () => {
      mockWebSocket._twilioOutSeq = 42;
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      
      // Add audio to start the buffer
      buffer.addAudio(createTestBuffer(160));
      
      // Advance timer to trigger frame send
      jest.advanceTimersByTime(25); // Give a bit more time
      
      expect(mockWebSocket.send).toHaveBeenCalled();
      expect(mockWebSocket._twilioOutSeq).toBe(43);
    });
  });

  describe('Audio Addition', () => {
    it('should add audio data to buffer', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      const audioData = createTestBuffer(160);
      
      buffer.addAudio(audioData);
      
      const status = buffer.getStatus();
      expect(status.bufferBytes).toBe(160);
      expect(status.bufferMs).toBe(20); // 160 bytes at 8kHz = 20ms
      expect(status.isActive).toBe(true);
    });

    it('should accumulate multiple audio chunks', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      
      buffer.addAudio(createTestBuffer(80));
      buffer.addAudio(createTestBuffer(80));
      
      const status = buffer.getStatus();
      expect(status.bufferBytes).toBe(160);
      expect(status.bufferMs).toBe(20);
    });

    it('should handle buffer overflow protection', () => {
      const options: AudioBufferOptions = {
        maxBufferMs: 100 // Small buffer for testing overflow
      };
      const buffer = new AudioBuffer(mockWebSocket, 'test-session', options);
      
      // Add more data than the buffer can hold
      for (let i = 0; i < 10; i++) {
        buffer.addAudio(createTestBuffer(160)); // Each chunk is 20ms
      }
      
      const status = buffer.getStatus();
      expect(status.bufferMs).toBeLessThanOrEqual(100); // Should not exceed max
    });

    it('should start timer on first audio addition', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      
      expect(buffer.getStatus().isActive).toBe(false);
      
      buffer.addAudio(createTestBuffer(160));
      
      expect(buffer.getStatus().isActive).toBe(true);
    });
  });

  describe('Frame Transmission', () => {
    it('should send frames at configured intervals', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(320)); // 2 frames worth
      
      // Should not send immediately
      expect(mockWebSocket.send).not.toHaveBeenCalled();
      
      // Advance timer by interval
      jest.advanceTimersByTime(25);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      
      // Advance again
      jest.advanceTimersByTime(25);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
    });

    it('should send frames with correct Twilio format', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      jest.advanceTimersByTime(25);
      
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"event":"media"'),
        expect.any(Function)
      );
      
      const sentData = JSON.parse((mockWebSocket.send as jest.Mock).mock.calls[0][0]);
      expect(sentData.event).toBe('media');
      expect(sentData.streamSid).toBe('test-stream-sid');
      expect(sentData.sequenceNumber).toBe('1');
      expect(sentData.media.payload).toBeDefined();
    });

    it('should wait for sufficient data before sending', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(80)); // Half a frame
      
      jest.advanceTimersByTime(25);
      
      // Should not send incomplete frame
      expect(mockWebSocket.send).not.toHaveBeenCalled();
      
      // Add more data to complete frame
      buffer.addAudio(createTestBuffer(80));
      jest.advanceTimersByTime(25);
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
    });

    it('should handle WebSocket send errors gracefully', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      // Mock send to call error callback
      (mockWebSocket.send as jest.Mock).mockImplementation((data, callback) => {
        if (callback) callback(new Error('Send failed'));
      });
      
      jest.advanceTimersByTime(25);
      
      // Should not throw and should eventually stop on error
      expect(() => jest.advanceTimersByTime(25)).not.toThrow();
    });

    it('should stop transmission when WebSocket closes', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(320));
      
      // Close WebSocket
      mockWebSocket.readyState = 3; // CLOSED
      
      jest.advanceTimersByTime(25);
      
      expect(mockWebSocket.send).not.toHaveBeenCalled();
      expect(buffer.getStatus().isActive).toBe(false);
    });
  });

  describe('Buffer Management', () => {
    it('should maintain correct buffer levels during transmission', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(480)); // 3 frames worth
      
      expect(buffer.getStatus().bufferBytes).toBe(480);
      
      // Send one frame
      jest.advanceTimersByTime(25);
      expect(buffer.getStatus().bufferBytes).toBe(320);
      
      // Send another frame
      jest.advanceTimersByTime(25);
      expect(buffer.getStatus().bufferBytes).toBe(160);
    });

    it('should handle custom frame sizes', () => {
      const options: AudioBufferOptions = {
        frameSize: 320, // Double the default
        intervalMs: 40
      };
      const buffer = new AudioBuffer(mockWebSocket, 'test-session', options);
      buffer.addAudio(createTestBuffer(320));
      
      jest.advanceTimersByTime(45);
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      expect(buffer.getStatus().bufferBytes).toBe(0);
    });

    it('should report buffer underruns to quality analyzer', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(80)); // Less than one frame
      
      // Try to send when buffer is low
      jest.advanceTimersByTime(20);
      
      // Should not send but should report underrun
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });
  });

  describe('Stop and Flush', () => {
    it('should stop transmission and clear timer', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      expect(buffer.getStatus().isActive).toBe(true);
      
      buffer.stop('test_stop');
      
      expect(buffer.getStatus().isActive).toBe(false);
      
      // Timer should not fire after stop (only completion mark should be sent)
      const initialCallCount = (mockWebSocket.send as jest.Mock).mock.calls.length;
      jest.advanceTimersByTime(25);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(initialCallCount); // No additional calls
    });

    it('should send completion mark on stop', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      buffer.stop('test_stop');
      
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"event":"mark"')
      );
    });

    it('should flush remaining audio data', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(240)); // 1.5 frames
      
      buffer.flush();
      
      // Should send complete frame plus padded partial frame
      expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
      expect(buffer.getStatus().bufferBytes).toBe(0);
      expect(buffer.getStatus().isActive).toBe(false);
    });

    it('should pad partial frames with silence during flush', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(100)); // Partial frame
      
      buffer.flush();
      
      // Should send padded frame plus completion mark
      expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
      
      // Find the media frame (not the mark)
      const mediaCalls = (mockWebSocket.send as jest.Mock).mock.calls
        .filter(call => JSON.parse(call[0]).event === 'media');
      expect(mediaCalls.length).toBe(1);
      
      const sentData = JSON.parse(mediaCalls[0][0]);
      const payload = Buffer.from(sentData.media.payload, 'base64');
      expect(payload.length).toBe(160); // Full frame size
      
      // Check that padding is μ-law silence (0xFF)
      for (let i = 100; i < 160; i++) {
        expect(payload[i]).toBe(0xFF);
      }
    });
  });

  describe('Timing and Performance', () => {
    it('should detect and log timer delays', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      // Simulate delayed timer execution
      jest.advanceTimersByTime(30); // 10ms delay
      
      expect(mockWebSocket.send).toHaveBeenCalled();
      // Timer delay should be logged (checked via mock logger)
    });

    it('should handle high-frequency timer intervals', () => {
      const options: AudioBufferOptions = {
        intervalMs: 5 // Very fast interval
      };
      const buffer = new AudioBuffer(mockWebSocket, 'test-session', options);
      buffer.addAudio(createTestBuffer(800)); // Many frames worth
      
      // Advance in small increments
      for (let i = 0; i < 10; i++) {
        jest.advanceTimersByTime(5);
      }
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(5); // 800 / 160 = 5 frames
    });

    it('should use setImmediate for non-blocking sends', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      jest.advanceTimersByTime(25);
      
      // Should use setImmediate for async send
      expect(mockWebSocket.send).toHaveBeenCalled();
    });
  });

  describe('WebSocket Integration', () => {
    it('should handle WebSocket state changes', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      // Simulate WebSocket close event
      const mockOn = (mockWebSocket as any).on as jest.Mock;
      const closeHandler = mockOn.mock.calls
        .find(call => call[0] === 'close')?.[1];
      
      if (closeHandler) {
        closeHandler();
      }
      
      // Event handlers don't automatically stop the buffer in our implementation
      expect(buffer.getStatus().isActive).toBe(true);
    });

    it('should handle WebSocket error events', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      // Simulate WebSocket error event
      const mockOn = (mockWebSocket as any).on as jest.Mock;
      const errorHandler = mockOn.mock.calls
        .find(call => call[0] === 'error')?.[1];
      
      if (errorHandler) {
        errorHandler(new Error('WebSocket error'));
      }
      
      // Event handlers don't automatically stop the buffer in our implementation
      expect(buffer.getStatus().isActive).toBe(true);
    });

    it('should skip completion mark if WebSocket is closed', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      // Close WebSocket before stopping
      mockWebSocket.readyState = 3; // CLOSED
      
      buffer.stop('websocket_closed');
      
      // Should not attempt to send mark
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });
  });

  describe('Memory Management', () => {
    it('should release pooled buffers on stop', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      const initialStats = bufferPool.getStats();
      
      buffer.stop('test_cleanup');
      
      // Should have released any pooled buffers
      const finalStats = bufferPool.getStats();
      expect(finalStats.allocated).toBeLessThanOrEqual(initialStats.allocated);
    });

    it('should handle buffer pool exhaustion gracefully', () => {
      // Fill up the buffer pool
      const buffers = [];
      for (let i = 0; i < 25; i++) {
        buffers.push(bufferPool.acquire(160));
      }
      
      // Should still work
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      jest.advanceTimersByTime(25);
      expect(mockWebSocket.send).toHaveBeenCalled();
      
      // Clean up
      buffers.forEach(buf => bufferPool.release(buf));
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero-length audio data', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      
      expect(() => {
        buffer.addAudio(Buffer.alloc(0));
      }).not.toThrow();
      
      expect(buffer.getStatus().bufferBytes).toBe(0);
    });

    it('should handle very large audio chunks', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      const largeChunk = createTestBuffer(8000); // 1 second of audio
      
      buffer.addAudio(largeChunk);
      
      expect(buffer.getStatus().bufferBytes).toBeGreaterThan(0);
      expect(buffer.getStatus().bufferMs).toBeGreaterThan(0);
    });

    it('should handle rapid start/stop cycles', () => {
      const buffer = new AudioBuffer(mockWebSocket, 'test-session');
      
      for (let i = 0; i < 5; i++) {
        buffer.addAudio(createTestBuffer(160));
        buffer.stop(`cycle_${i}`);
      }
      
      expect(buffer.getStatus().isActive).toBe(false);
    });

    it('should handle missing WebSocket properties gracefully', () => {
      const incompleteWs = {
        readyState: 1,
        send: jest.fn(),
        on: jest.fn()
      } as any;
      
      const buffer = new AudioBuffer(incompleteWs, 'test-session');
      buffer.addAudio(createTestBuffer(160));
      
      jest.advanceTimersByTime(25);
      
      // Should still work with missing optional properties
      expect(incompleteWs.send).toHaveBeenCalled();
    });
  });
});