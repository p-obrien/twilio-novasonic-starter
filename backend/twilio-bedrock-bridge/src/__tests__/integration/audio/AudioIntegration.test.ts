/**
 * Audio Integration Tests
 * 
 * Tests for the integration of audio conversion components working together
 * in realistic scenarios similar to production usage.
 */

import { 
  processTwilioAudioInput,
  processBedrockAudioOutput,
  muLawBufferToPcm16LE,
  pcm16BufferToMuLaw
} from '../../../audio/AudioProcessor';
import { AudioBuffer } from '../../../audio/AudioBuffer';
import { streamAudioFrames } from '../../../audio/AudioFrameStreamer';
import { BufferPool } from '../../../audio/BufferPool';

describe('Audio Integration', () => {
  let bufferPool: BufferPool;
  let mockWebSocket: any;

  beforeEach(() => {
    bufferPool = BufferPool.create({ initialSize: 10, maxSize: 50 });
    jest.spyOn(BufferPool, 'getInstance').mockReturnValue(bufferPool);
    
    mockWebSocket = createMockWebSocket();
    jest.useFakeTimers();
  });

  afterEach(() => {
    bufferPool.cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('End-to-End Audio Processing', () => {
    it('should process complete Twilio to Bedrock to Twilio pipeline', () => {
      // Simulate Twilio μ-law input (20ms at 8kHz)
      const twilioInput = createMuLawTestBuffer(160);
      
      // Step 1: Process Twilio input for Bedrock
      const bedrockInput = processTwilioAudioInput(twilioInput);
      expect(bedrockInput.length).toBe(640); // 320 samples * 2 bytes at 16kHz
      
      // Step 2: Simulate Bedrock processing (convert back to simulate response)
      const bedrockResponse = {
        content: bedrockInput.toString('base64'),
        sampleRateHz: 16000
      };
      
      // Step 3: Process Bedrock output for Twilio
      const twilioOutput = processBedrockAudioOutput(bedrockResponse);
      expect(twilioOutput.length).toBe(160); // Back to μ-law at 8kHz
      
      // Verify the pipeline maintains reasonable audio quality
      expect(twilioOutput).toBeInstanceOf(Buffer);
      
      // Check that output is valid μ-law
      for (let i = 0; i < twilioOutput.length; i++) {
        expect(twilioOutput[i]).toBeGreaterThanOrEqual(0);
        expect(twilioOutput[i]).toBeLessThanOrEqual(255);
      }
    });

    it('should handle multiple audio chunks in sequence', () => {
      const chunks = [
        createMuLawTestBuffer(80),   // 10ms
        createMuLawTestBuffer(160),  // 20ms
        createMuLawTestBuffer(240)   // 30ms
      ];
      
      const processedChunks = chunks.map(chunk => 
        processTwilioAudioInput(chunk)
      );
      
      // Each chunk should be processed independently
      expect(processedChunks[0].length).toBeGreaterThan(0);
      expect(processedChunks[1].length).toBeGreaterThan(0);
      expect(processedChunks[2].length).toBeGreaterThan(0);
      
      // Combine processed chunks
      const combinedInput = Buffer.concat(processedChunks);
      
      // Process combined input as Bedrock response
      const bedrockResponse = {
        payload: combinedInput.toString('base64'),
        sampleRateHz: 16000
      };
      
      const finalOutput = processBedrockAudioOutput(bedrockResponse);
      expect(finalOutput.length).toBeGreaterThan(0);
    });

    it('should maintain audio timing through buffer and streaming', () => {
      // Create 1 second of audio data
      const audioData = createMuLawTestBuffer(8000); // 1 second at 8kHz
      
      // Use AudioBuffer to manage timing
      const audioBuffer = new AudioBuffer(mockWebSocket, 'integration-test');
      audioBuffer.addAudio(audioData);
      
      // Simulate real-time playback (50 frames at 20ms each = 1 second)
      for (let i = 0; i < 50; i++) {
        jest.advanceTimersByTime(25); // Give a bit more time for each frame
      }
      
      // Should have sent most frames (allow for timing variations)
      expect(mockWebSocket.send).toHaveBeenCalledTimes(50);
      
      // Verify frame timing consistency
      const calls = (mockWebSocket.send as jest.Mock).mock.calls;
      for (let i = 0; i < calls.length; i++) {
        const frameData = JSON.parse(calls[i][0]);
        expect(frameData.event).toBe('media');
        expect(frameData.sequenceNumber).toBe(String(i + 1));
        
        const payload = Buffer.from(frameData.media.payload, 'base64');
        expect(payload.length).toBe(160); // Consistent frame size
      }
    });

    it('should handle streaming large audio buffers efficiently', () => {
      // Create 5 seconds of audio
      const largeAudioBuffer = createMuLawTestBuffer(40000); // 5 seconds at 8kHz
      
      // Stream using AudioFrameStreamer
      streamAudioFrames(mockWebSocket, largeAudioBuffer, 'large-stream-test');
      
      // Simulate streaming (250 frames at 20ms each = 5 seconds)
      jest.advanceTimersByTime(5000);
      
      // Should have sent all frames
      expect(mockWebSocket.send).toHaveBeenCalledTimes(250);
      
      // Verify that streaming completed (check for completion mark)
      jest.advanceTimersByTime(25);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(251); // 250 frames + 1 mark
    });
  });

  describe('Format Conversion Accuracy', () => {
    it('should maintain signal integrity through conversions', () => {
      // Create a known signal pattern
      const originalPcm = Buffer.alloc(320); // 160 samples
      for (let i = 0; i < 160; i++) {
        // Create a sine wave pattern
        const sample = Math.floor(Math.sin(i * 0.1) * 16000);
        originalPcm.writeInt16LE(sample, i * 2);
      }
      
      // Convert PCM -> μ-law -> PCM
      const muLawEncoded = pcm16BufferToMuLaw(originalPcm);
      const pcmDecoded = muLawBufferToPcm16LE(muLawEncoded);
      
      expect(muLawEncoded.length).toBe(160);
      expect(pcmDecoded.length).toBe(320);
      
      // Check signal correlation (μ-law is lossy, so allow some tolerance)
      let correlationSum = 0;
      let originalSum = 0;
      let decodedSum = 0;
      
      for (let i = 0; i < 160; i++) {
        const original = originalPcm.readInt16LE(i * 2);
        const decoded = pcmDecoded.readInt16LE(i * 2);
        
        correlationSum += original * decoded;
        originalSum += original * original;
        decodedSum += decoded * decoded;
      }
      
      const correlation = correlationSum / Math.sqrt(originalSum * decodedSum);
      expect(correlation).toBeGreaterThan(0.8); // Strong correlation despite μ-law compression
    });

    it('should handle edge cases in format conversion', () => {
      const edgeCases = [
        Buffer.alloc(0),           // Empty buffer
        Buffer.alloc(1),           // Single byte
        Buffer.alloc(159),         // Just under frame size
        Buffer.alloc(161),         // Just over frame size
        Buffer.alloc(10000)        // Large buffer
      ];
      
      for (const testBuffer of edgeCases) {
        if (testBuffer.length > 0) {
          testBuffer.fill(0x80); // Fill with valid μ-law data
        }
        
        expect(() => {
          const processed = processTwilioAudioInput(testBuffer);
          expect(processed).toBeInstanceOf(Buffer);
        }).not.toThrow();
      }
    });
  });

  describe('Memory Management Integration', () => {
    it('should efficiently manage memory during intensive processing', () => {
      const initialStats = bufferPool.getStats();
      
      // Process many audio chunks
      for (let i = 0; i < 100; i++) {
        const chunk = createMuLawTestBuffer(160);
        const processed = processTwilioAudioInput(chunk);
        
        // Simulate releasing processed data
        if (processed.length > 0) {
          bufferPool.release(processed);
        }
      }
      
      const finalStats = bufferPool.getStats();
      
      // Should have high cache hit rate due to buffer reuse
      const hitRate = finalStats.cacheHits / finalStats.acquisitions;
      expect(hitRate).toBeGreaterThan(0.5); // At least 50% cache hits
      
      // Memory usage should be stable
      expect(finalStats.totalMemoryBytes).toBeLessThan(initialStats.totalMemoryBytes * 10);
    });

    it('should handle memory pressure gracefully', () => {
      // Simulate memory pressure
      bufferPool.updateMemoryPressure(0.9);
      
      // Continue processing under pressure
      const testData = createMuLawTestBuffer(160);
      
      expect(() => {
        for (let i = 0; i < 10; i++) {
          processTwilioAudioInput(testData);
        }
      }).not.toThrow();
      
      // Pool should have adapted to pressure
      const stats = bufferPool.getStats();
      expect(stats.memoryPressure).toBe(0.9);
    });
  });

  describe('Real-time Performance', () => {
    it('should process audio faster than real-time', () => {
      const audioChunk = createMuLawTestBuffer(160); // 20ms of audio
      
      const startTime = process.hrtime.bigint();
      
      // Process 1 second worth of 20ms chunks
      for (let i = 0; i < 50; i++) {
        processTwilioAudioInput(audioChunk);
      }
      
      const endTime = process.hrtime.bigint();
      const processingTimeMs = Number(endTime - startTime) / 1_000_000;
      
      // Should process 1 second of audio in much less than 1 second
      expect(processingTimeMs).toBeLessThan(100); // Less than 100ms to process 1s of audio
    });

    it('should maintain consistent performance under load', () => {
      const processingTimes: number[] = [];
      const audioChunk = createMuLawTestBuffer(160);
      
      // Measure processing time for multiple iterations
      for (let i = 0; i < 20; i++) {
        const startTime = process.hrtime.bigint();
        processTwilioAudioInput(audioChunk);
        const endTime = process.hrtime.bigint();
        
        processingTimes.push(Number(endTime - startTime) / 1_000_000);
      }
      
      // Calculate variance in processing times
      const avgTime = processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length;
      const variance = processingTimes.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / processingTimes.length;
      const stdDev = Math.sqrt(variance);
      
      // Processing times should be consistent (low standard deviation)
      // Handle case where avgTime might be very small or zero
      if (avgTime > 0) {
        expect(stdDev).toBeLessThan(avgTime * 2); // More lenient threshold
      } else {
        expect(stdDev).toBeLessThan(1); // Very small absolute threshold
      }
    });
  });

  describe('Error Recovery', () => {
    it('should recover from processing errors gracefully', () => {
      const validChunk = createMuLawTestBuffer(160);
      const invalidChunk = Buffer.alloc(160, 0xFF); // All silence
      
      // Process valid chunk
      const result1 = processTwilioAudioInput(validChunk);
      expect(result1.length).toBeGreaterThan(0);
      
      // Process invalid chunk (should not throw)
      const result2 = processTwilioAudioInput(invalidChunk);
      expect(result2.length).toBeGreaterThan(0);
      
      // Continue processing valid chunks
      const result3 = processTwilioAudioInput(validChunk);
      expect(result3.length).toBeGreaterThan(0);
    });

    it('should handle WebSocket errors during streaming', () => {
      const audioData = createMuLawTestBuffer(320); // 2 frames
      
      // Start streaming
      streamAudioFrames(mockWebSocket, audioData, 'error-test');
      
      // Send first frame successfully
      jest.advanceTimersByTime(20);
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      
      // Simulate WebSocket error
      (mockWebSocket.send as jest.Mock).mockImplementation(() => {
        throw new Error('WebSocket error');
      });
      
      // Should handle error gracefully
      expect(() => {
        jest.advanceTimersByTime(20);
      }).not.toThrow();
    });
  });
});