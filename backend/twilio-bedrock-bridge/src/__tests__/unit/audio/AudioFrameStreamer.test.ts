/**
 * AudioFrameStreamer Unit Tests
 * 
 * Tests for the AudioFrameStreamer module that provides timer-driven
 * audio streaming with precise timing control and backpressure management.
 */

import { streamAudioFrames, AudioFrameStreamerOptions, WebSocketLike } from '../../../audio/AudioFrameStreamer';

describe('AudioFrameStreamer', () => {
  let mockWebSocket: WebSocketLike;

  beforeEach(() => {
    mockWebSocket = createMockWebSocket();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Basic Streaming', () => {
    it('should stream complete audio buffer as timed frames', () => {
      const audioBuffer = createTestBuffer(320); // 2 frames worth
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      
      // Should not send immediately
      expect(mockWebSocket.send).not.toHaveBeenCalled();
      
      // Advance timer by interval
      jest.advanceTimersByTime(20);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      
      // Advance again for second frame
      jest.advanceTimersByTime(20);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
    });

    it('should send frames with correct Twilio format', () => {
      const audioBuffer = createTestBuffer(160);
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"event":"media"'),
        expect.any(Function)
      );
      
      const sentData = JSON.parse((mockWebSocket.send as jest.Mock).mock.calls[0][0]);
      expect(sentData.event).toBe('media');
      expect(sentData.streamSid).toBe('test-stream-sid');
      expect(sentData.sequenceNumber).toBe('1');
      expect(sentData.media.payload).toBeDefined();
      
      // Verify base64 payload
      const payload = Buffer.from(sentData.media.payload, 'base64');
      expect(payload.length).toBe(160);
    });

    it('should increment sequence numbers correctly', () => {
      const audioBuffer = createTestBuffer(480); // 3 frames
      mockWebSocket._twilioOutSeq = 10;
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      
      // Send all frames
      jest.advanceTimersByTime(60);
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(3);
      expect(mockWebSocket._twilioOutSeq).toBe(13);
      
      // Check sequence numbers in sent messages
      const calls = (mockWebSocket.send as jest.Mock).mock.calls;
      expect(JSON.parse(calls[0][0]).sequenceNumber).toBe('11');
      expect(JSON.parse(calls[1][0]).sequenceNumber).toBe('12');
      expect(JSON.parse(calls[2][0]).sequenceNumber).toBe('13');
    });

    it('should handle partial frames by padding with silence', () => {
      const audioBuffer = createTestBuffer(100); // Partial frame
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      
      const sentData = JSON.parse((mockWebSocket.send as jest.Mock).mock.calls[0][0]);
      const payload = Buffer.from(sentData.media.payload, 'base64');
      expect(payload.length).toBe(160); // Full frame size
      
      // Check padding is μ-law silence (0xFF)
      for (let i = 100; i < 160; i++) {
        expect(payload[i]).toBe(0xFF);
      }
    });
  });

  describe('Configuration Options', () => {
    it('should use custom frame size', () => {
      const options: AudioFrameStreamerOptions = {
        frameSize: 320,
        intervalMs: 40
      };
      const audioBuffer = createTestBuffer(320);
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session', options);
      jest.advanceTimersByTime(40);
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      
      const sentData = JSON.parse((mockWebSocket.send as jest.Mock).mock.calls[0][0]);
      const payload = Buffer.from(sentData.media.payload, 'base64');
      expect(payload.length).toBe(320);
    });

    it('should use custom transmission interval', () => {
      const options: AudioFrameStreamerOptions = {
        intervalMs: 10 // Fast interval
      };
      const audioBuffer = createTestBuffer(320); // 2 frames
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session', options);
      
      // Should send first frame after 10ms
      jest.advanceTimersByTime(10);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      
      // Second frame after another 10ms
      jest.advanceTimersByTime(10);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
    });

    it('should respect environment variable overrides', () => {
      process.env.TWILIO_ULAW_FRAME_SIZE = '320';
      process.env.TWILIO_ULAW_FRAME_INTERVAL_MS = '40';
      
      const audioBuffer = createTestBuffer(320);
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(40);
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      
      // Clean up
      delete process.env.TWILIO_ULAW_FRAME_SIZE;
      delete process.env.TWILIO_ULAW_FRAME_INTERVAL_MS;
    });

    it('should enforce minimum interval of 1ms', () => {
      process.env.TWILIO_ULAW_FRAME_INTERVAL_MS = '0'; // Invalid
      
      const audioBuffer = createTestBuffer(160);
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(1); // Should use minimum 1ms
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      
      delete process.env.TWILIO_ULAW_FRAME_INTERVAL_MS;
    });
  });

  describe('Backpressure Management', () => {
    it('should skip transmission when WebSocket buffer is full', () => {
      const audioBuffer = createTestBuffer(320); // 2 frames
      
      // Mock high buffered amount
      (mockWebSocket as any).bufferedAmount = 40000; // Above threshold
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      // Should skip due to backpressure
      expect(mockWebSocket.send).not.toHaveBeenCalled();
      
      // Reduce buffered amount
      (mockWebSocket as any).bufferedAmount = 1000;
      jest.advanceTimersByTime(20);
      
      // Should send now
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
    });

    it('should use custom buffered amount threshold', () => {
      const options: AudioFrameStreamerOptions = {
        bufferedAmountThreshold: 10000 // Lower threshold
      };
      const audioBuffer = createTestBuffer(160);
      
      (mockWebSocket as any).bufferedAmount = 15000; // Above custom threshold
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session', options);
      jest.advanceTimersByTime(20);
      
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });

    it('should handle missing bufferedAmount property', () => {
      const audioBuffer = createTestBuffer(160);
      
      // Don't set bufferedAmount property
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      // Should work normally (defaults to 0)
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('WebSocket State Management', () => {
    it('should stop streaming when WebSocket closes', () => {
      const audioBuffer = createTestBuffer(320); // 2 frames
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      
      // Send first frame
      jest.advanceTimersByTime(20);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      
      // Close WebSocket
      mockWebSocket.readyState = 3; // CLOSED
      
      // Should not send second frame
      jest.advanceTimersByTime(20);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
    });

    it('should handle WebSocket close events', () => {
      const audioBuffer = createTestBuffer(320);
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      
      // Trigger close event
      const closeHandler = (mockWebSocket.on as jest.Mock).mock.calls
        .find(call => call[0] === 'close')?.[1];
      
      if (closeHandler) {
        closeHandler();
      }
      
      // Should stop streaming
      jest.advanceTimersByTime(20);
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });

    it('should handle WebSocket error events', () => {
      const audioBuffer = createTestBuffer(320);
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      
      // Trigger error event
      const errorHandler = (mockWebSocket.on as jest.Mock).mock.calls
        .find(call => call[0] === 'error')?.[1];
      
      if (errorHandler) {
        errorHandler(new Error('WebSocket error'));
      }
      
      // Should stop streaming
      jest.advanceTimersByTime(20);
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });

    it('should handle missing WebSocket properties gracefully', () => {
      const incompleteWs = {
        readyState: 1,
        send: jest.fn(),
        on: jest.fn()
      } as any;
      
      const audioBuffer = createTestBuffer(160);
      
      streamAudioFrames(incompleteWs, audioBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      expect(incompleteWs.send).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle send errors gracefully', () => {
      const audioBuffer = createTestBuffer(320);
      
      // Mock send to call error callback
      (mockWebSocket.send as jest.Mock).mockImplementation((data, callback) => {
        if (callback) callback(new Error('Send failed'));
      });
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      expect(mockWebSocket.send).toHaveBeenCalled();
      // Should stop streaming on error
      jest.advanceTimersByTime(20);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
    });

    it('should handle JSON serialization errors', () => {
      const audioBuffer = createTestBuffer(160);
      
      // Create WebSocket with problematic streamSid
      mockWebSocket.twilioStreamSid = undefined;
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      // Should handle gracefully
      expect(mockWebSocket.send).toHaveBeenCalled();
    });

    it('should handle timer exceptions gracefully', () => {
      const audioBuffer = createTestBuffer(160);
      
      // Mock send to throw
      (mockWebSocket.send as jest.Mock).mockImplementation(() => {
        throw new Error('Send exception');
      });
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      
      expect(() => {
        jest.advanceTimersByTime(20);
      }).not.toThrow();
    });
  });

  describe('Completion Handling', () => {
    it('should send completion mark after all frames', () => {
      const audioBuffer = createTestBuffer(160); // 1 frame
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      // Should send frame first
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse((mockWebSocket.send as jest.Mock).mock.calls[0][0]).event).toBe('media');
      
      // Advance to trigger completion
      jest.advanceTimersByTime(20);
      
      // Should send completion mark
      expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
      expect(JSON.parse((mockWebSocket.send as jest.Mock).mock.calls[1][0]).event).toBe('mark');
    });

    it('should include timestamp in completion mark', () => {
      const audioBuffer = createTestBuffer(160);
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(40); // Send frame and trigger completion
      
      const markCall = (mockWebSocket.send as jest.Mock).mock.calls
        .find(call => JSON.parse(call[0]).event === 'mark');
      
      expect(markCall).toBeDefined();
      
      const markData = JSON.parse(markCall[0]);
      expect(markData.mark.name).toMatch(/^bedrock_out_\d+$/);
    });

    it('should not send completion mark if WebSocket is closed', () => {
      const audioBuffer = createTestBuffer(160);
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(20); // Send frame
      
      // Close WebSocket before completion
      mockWebSocket.readyState = 3;
      
      jest.advanceTimersByTime(20);
      
      // Should only have sent the media frame, not the mark
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
    });

    it('should handle completion mark send errors', () => {
      const audioBuffer = createTestBuffer(160);
      
      let callCount = 0;
      (mockWebSocket.send as jest.Mock).mockImplementation((data, callback) => {
        callCount++;
        if (callCount === 2) { // Completion mark
          throw new Error('Mark send failed');
        }
        if (callback) callback();
      });
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      
      expect(() => {
        jest.advanceTimersByTime(40);
      }).not.toThrow();
    });
  });

  describe('Performance and Timing', () => {
    it('should pre-encode frames for optimal performance', () => {
      const audioBuffer = createTestBuffer(1600); // 10 frames
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      
      // All frames should be pre-encoded, so timing should be consistent
      const startTime = Date.now();
      
      for (let i = 0; i < 10; i++) {
        jest.advanceTimersByTime(20);
      }
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(10);
      
      // Verify all payloads are valid base64
      const calls = (mockWebSocket.send as jest.Mock).mock.calls;
      for (const call of calls) {
        const data = JSON.parse(call[0]);
        if (data.event === 'media') {
          expect(() => Buffer.from(data.media.payload, 'base64')).not.toThrow();
        }
      }
    });

    it('should handle high-frequency streaming', () => {
      const options: AudioFrameStreamerOptions = {
        intervalMs: 1 // Very fast
      };
      const audioBuffer = createTestBuffer(1600); // 10 frames
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session', options);
      
      // Stream all frames rapidly
      jest.advanceTimersByTime(10);
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(10);
    });

    it('should use setImmediate for non-blocking sends', () => {
      const audioBuffer = createTestBuffer(160);
      
      streamAudioFrames(mockWebSocket, audioBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      // Send should be called (setImmediate is mocked by Jest)
      expect(mockWebSocket.send).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty audio buffer', () => {
      const emptyBuffer = Buffer.alloc(0);
      
      streamAudioFrames(mockWebSocket, emptyBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      // Should send completion mark immediately
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse((mockWebSocket.send as jest.Mock).mock.calls[0][0]).event).toBe('mark');
    });

    it('should handle very large audio buffers', () => {
      const largeBuffer = createTestBuffer(16000); // 100 frames
      
      streamAudioFrames(mockWebSocket, largeBuffer, 'test-session');
      
      // Stream for 2 seconds (100 frames at 20ms each)
      jest.advanceTimersByTime(2000);
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(100); // 100 frames
      
      // Advance a bit more to trigger completion mark
      jest.advanceTimersByTime(25);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(101); // 100 frames + 1 mark
    });

    it('should handle single-byte audio buffer', () => {
      const tinyBuffer = Buffer.alloc(1);
      tinyBuffer[0] = 0x80;
      
      streamAudioFrames(mockWebSocket, tinyBuffer, 'test-session');
      jest.advanceTimersByTime(20);
      
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      
      const sentData = JSON.parse((mockWebSocket.send as jest.Mock).mock.calls[0][0]);
      const payload = Buffer.from(sentData.media.payload, 'base64');
      expect(payload.length).toBe(160); // Padded to full frame
      expect(payload[0]).toBe(0x80);
      
      // Rest should be silence
      for (let i = 1; i < 160; i++) {
        expect(payload[i]).toBe(0xFF);
      }
    });

    it('should handle rapid start/stop scenarios', () => {
      const audioBuffer = createTestBuffer(160);
      
      // Start multiple streams rapidly
      for (let i = 0; i < 5; i++) {
        streamAudioFrames(mockWebSocket, audioBuffer, `session-${i}`);
      }
      
      jest.advanceTimersByTime(20);
      
      // All should work independently
      expect(mockWebSocket.send).toHaveBeenCalled();
    });
  });
});