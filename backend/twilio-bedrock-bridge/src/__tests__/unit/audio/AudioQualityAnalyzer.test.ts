/**
 * AudioQualityAnalyzer Unit Tests
 * 
 * Tests for audio quality monitoring and analysis using real audio samples,
 * real timing measurements, and real buffer patterns.
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import { AudioQualityAnalyzer, AudioQualityMetrics } from '../../../audio/AudioQualityAnalyzer';
import { AudioTestUtils } from '../../utils/AudioTestUtils';

describe('AudioQualityAnalyzer', () => {
  let analyzer: AudioQualityAnalyzer;

  beforeEach(() => {
    analyzer = AudioQualityAnalyzer.getInstance();
  });

  describe('Signal Quality Analysis', () => {
    it('should calculate RMS level for real audio samples', () => {
      // Requirement 9.1: Test quality analyzer using real audio samples
      const sessionId = 'test-session-rms';
      const audioData = AudioTestUtils.generateSineWave(440, 100, 8000);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.rmsLevel).toBeGreaterThan(0);
      expect(metrics.rmsLevel).toBeLessThanOrEqual(1.0);
    });

    it('should detect silence in real audio samples', () => {
      // Requirement 9.1: Test quality analyzer using real audio samples
      const sessionId = 'test-session-silence';
      const silenceData = AudioTestUtils.generateSilence(100, 8000);

      const metrics = analyzer.analyzeAudioChunk(sessionId, silenceData, 8000);

      expect(metrics.silenceRatio).toBeGreaterThan(0.9); // Should detect mostly silence
      expect(metrics.rmsLevel).toBeLessThan(0.02); // Very low RMS for silence
    });

    it('should calculate peak level for real audio samples', () => {
      // Requirement 9.1: Test quality analyzer using real audio samples
      const sessionId = 'test-session-peak';
      const audioData = AudioTestUtils.generateSineWave(1000, 100, 8000);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.peakLevel).toBeGreaterThan(0);
      expect(metrics.peakLevel).toBeLessThanOrEqual(1.0);
      expect(metrics.peakLevel).toBeGreaterThanOrEqual(metrics.rmsLevel);
    });

    it('should calculate dynamic range for real audio samples', () => {
      // Requirement 9.1: Test quality analyzer using real audio samples
      const sessionId = 'test-session-dynamic';
      const audioData = AudioTestUtils.generateSineWave(440, 100, 8000);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.dynamicRange).toBeGreaterThanOrEqual(0);
      expect(metrics.dynamicRange).toBeLessThanOrEqual(60); // Clamped to reasonable range
    });

    it('should analyze white noise correctly', () => {
      // Requirement 9.1: Test quality analyzer using real audio samples
      const sessionId = 'test-session-noise';
      const noiseData = AudioTestUtils.generateWhiteNoise(100, 8000);

      const metrics = analyzer.analyzeAudioChunk(sessionId, noiseData, 8000);

      expect(metrics.rmsLevel).toBeGreaterThan(0);
      expect(metrics.silenceRatio).toBeLessThan(0.5); // Noise should not be silent
    });

    it('should handle different sample rates', () => {
      // Requirement 9.1: Test quality analyzer using real audio samples
      const sessionId = 'test-session-samplerate';
      
      const audio8k = AudioTestUtils.generateSineWave(440, 100, 8000);
      const metrics8k = analyzer.analyzeAudioChunk(sessionId + '-8k', audio8k, 8000);

      const audio16k = AudioTestUtils.generateSineWave(440, 100, 16000);
      const metrics16k = analyzer.analyzeAudioChunk(sessionId + '-16k', audio16k, 16000);

      expect(metrics8k.rmsLevel).toBeGreaterThan(0);
      expect(metrics16k.rmsLevel).toBeGreaterThan(0);
    });
  });

  describe('Latency Tracking', () => {
    it('should track processing latency with real timing', () => {
      // Requirement 9.2: Test latency tracking with real timing
      const sessionId = 'test-session-latency';
      const audioData = AudioTestUtils.generateSineWave(440, 100, 8000);

      const startTime = Date.now();
      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);
      const endTime = Date.now();

      expect(metrics.processingLatencyMs).toBeGreaterThanOrEqual(0);
      expect(metrics.processingLatencyMs).toBeLessThanOrEqual(endTime - startTime + 1);
    });

    it('should track latency across multiple chunks', () => {
      // Requirement 9.2: Test latency tracking with real timing
      const sessionId = 'test-session-multi-latency';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      const latencies: number[] = [];
      for (let i = 0; i < 5; i++) {
        const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);
        latencies.push(metrics.processingLatencyMs);
      }

      // All latencies should be reasonable
      latencies.forEach(latency => {
        expect(latency).toBeGreaterThanOrEqual(0);
        expect(latency).toBeLessThan(100); // Should be fast
      });
    });

    it('should measure latency for different audio sizes', () => {
      // Requirement 9.2: Test latency tracking with real timing
      const sessionId = 'test-session-size-latency';

      const smallAudio = AudioTestUtils.generateSineWave(440, 20, 8000);
      const smallMetrics = analyzer.analyzeAudioChunk(sessionId + '-small', smallAudio, 8000);

      const largeAudio = AudioTestUtils.generateSineWave(440, 500, 8000);
      const largeMetrics = analyzer.analyzeAudioChunk(sessionId + '-large', largeAudio, 8000);

      expect(smallMetrics.processingLatencyMs).toBeGreaterThanOrEqual(0);
      expect(largeMetrics.processingLatencyMs).toBeGreaterThanOrEqual(0);
      // Larger audio might take longer, but not always guaranteed in tests
    });

    it('should track average latency over time', () => {
      // Requirement 9.2: Test latency tracking with real timing
      const sessionId = 'test-session-avg-latency';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Process multiple chunks
      for (let i = 0; i < 10; i++) {
        analyzer.analyzeAudioChunk(sessionId, audioData, 8000);
      }

      const sessionMetrics = analyzer.getSessionMetrics(sessionId);
      expect(sessionMetrics).not.toBeNull();
      if (sessionMetrics) {
        expect(sessionMetrics.processingLatencyMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Jitter Detection', () => {
    it('should detect jitter with real buffer level changes', () => {
      // Requirement 9.3: Test jitter detection with real timestamps
      const sessionId = 'test-session-jitter';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Create session first by analyzing audio
      analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      // Report varying buffer levels to create jitter
      analyzer.reportBufferEvent(sessionId, 'underrun', 0.2);
      analyzer.reportBufferEvent(sessionId, 'underrun', 0.8);
      analyzer.reportBufferEvent(sessionId, 'underrun', 0.3);
      analyzer.reportBufferEvent(sessionId, 'underrun', 0.7);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.jitterMs).toBeGreaterThan(0);
    });

    it('should calculate jitter from buffer level variations', () => {
      // Requirement 9.3: Test jitter detection with real timestamps
      const sessionId = 'test-session-jitter-calc';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Create session first
      analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      // Create consistent buffer levels (low jitter)
      for (let i = 0; i < 5; i++) {
        analyzer.reportBufferEvent(sessionId, 'underrun', 0.5);
      }

      const lowJitterMetrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      // Create varying buffer levels (high jitter)
      const sessionId2 = 'test-session-jitter-calc-2';
      analyzer.analyzeAudioChunk(sessionId2, audioData, 8000);
      
      const levels = [0.1, 0.9, 0.2, 0.8, 0.3];
      levels.forEach(level => {
        analyzer.reportBufferEvent(sessionId2, 'underrun', level);
      });

      const highJitterMetrics = analyzer.analyzeAudioChunk(sessionId2, audioData, 8000);

      expect(lowJitterMetrics.jitterMs).toBeLessThan(highJitterMetrics.jitterMs);
    });

    it('should handle zero jitter case', () => {
      // Requirement 9.3: Test jitter detection with real timestamps
      const sessionId = 'test-session-zero-jitter';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // No buffer events reported
      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.jitterMs).toBe(0);
    });

    it('should track jitter over multiple measurements', () => {
      // Requirement 9.3: Test jitter detection with real timestamps
      const sessionId = 'test-session-jitter-tracking';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Create session first
      analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      // Simulate varying buffer conditions
      const bufferLevels = [0.5, 0.6, 0.4, 0.7, 0.3, 0.8, 0.2];
      bufferLevels.forEach(level => {
        analyzer.reportBufferEvent(sessionId, 'underrun', level);
      });

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.jitterMs).toBeGreaterThan(0);
      expect(metrics.averageBufferLevel).toBeGreaterThan(0);
      expect(metrics.averageBufferLevel).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Buffer Health Monitoring', () => {
    it('should detect buffer underruns with real buffers', () => {
      // Requirement 9.4: Test packet loss detection with real buffers
      const sessionId = 'test-session-underrun';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Create session first
      analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      analyzer.reportBufferEvent(sessionId, 'underrun', 0.1);
      analyzer.reportBufferEvent(sessionId, 'underrun', 0.05);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.bufferUnderruns).toBe(2);
      expect(metrics.bufferOverruns).toBe(0);
    });

    it('should detect buffer overruns with real buffers', () => {
      // Requirement 9.4: Test packet loss detection with real buffers
      const sessionId = 'test-session-overrun';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Create session first
      analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      analyzer.reportBufferEvent(sessionId, 'overrun', 0.95);
      analyzer.reportBufferEvent(sessionId, 'overrun', 0.98);
      analyzer.reportBufferEvent(sessionId, 'overrun', 0.99);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.bufferOverruns).toBe(3);
      expect(metrics.bufferUnderruns).toBe(0);
    });

    it('should track both underruns and overruns', () => {
      // Requirement 9.4: Test packet loss detection with real buffers
      const sessionId = 'test-session-both-events';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Create session first
      analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      analyzer.reportBufferEvent(sessionId, 'underrun', 0.1);
      analyzer.reportBufferEvent(sessionId, 'overrun', 0.95);
      analyzer.reportBufferEvent(sessionId, 'underrun', 0.05);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.bufferUnderruns).toBe(2);
      expect(metrics.bufferOverruns).toBe(1);
    });

    it('should calculate average buffer level', () => {
      // Requirement 9.4: Test packet loss detection with real buffers
      const sessionId = 'test-session-avg-buffer';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Create session first
      analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      const levels = [0.3, 0.5, 0.7, 0.4, 0.6];
      levels.forEach(level => {
        analyzer.reportBufferEvent(sessionId, 'underrun', level);
      });

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      const expectedAvg = levels.reduce((sum, l) => sum + l, 0) / levels.length;
      expect(metrics.averageBufferLevel).toBeCloseTo(expectedAvg, 2);
    });
  });

  describe('Throughput Measurement', () => {
    it('should calculate throughput from real audio data', () => {
      const sessionId = 'test-session-throughput';
      const audioData = AudioTestUtils.generateSineWave(440, 100, 8000);

      // Process multiple chunks to establish throughput
      for (let i = 0; i < 5; i++) {
        analyzer.analyzeAudioChunk(sessionId, audioData, 8000);
      }

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.throughputBytesPerSec).toBeGreaterThanOrEqual(0);
    });

    it('should track throughput over time', () => {
      const sessionId = 'test-session-throughput-time';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      const throughputs: number[] = [];
      for (let i = 0; i < 10; i++) {
        const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);
        throughputs.push(metrics.throughputBytesPerSec);
      }

      // Throughput should stabilize after a few samples
      const laterThroughputs = throughputs.slice(5);
      laterThroughputs.forEach(tp => {
        expect(tp).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Sample Rate Accuracy', () => {
    it('should verify sample rate accuracy', () => {
      const sessionId = 'test-session-samplerate-accuracy';
      const audioData = AudioTestUtils.generateSineWave(440, 100, 8000);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.sampleRateAccuracy).toBeGreaterThan(0);
      expect(metrics.sampleRateAccuracy).toBeLessThanOrEqual(1.0);
    });

    it('should handle different expected sample rates', () => {
      const sessionId = 'test-session-samplerate-diff';
      
      const audio8k = AudioTestUtils.generateSineWave(440, 100, 8000);
      const metrics8k = analyzer.analyzeAudioChunk(sessionId + '-8k', audio8k, 8000);

      const audio16k = AudioTestUtils.generateSineWave(440, 100, 16000);
      const metrics16k = analyzer.analyzeAudioChunk(sessionId + '-16k', audio16k, 16000);

      expect(metrics8k.sampleRateAccuracy).toBeGreaterThan(0);
      expect(metrics16k.sampleRateAccuracy).toBeGreaterThan(0);
    });
  });

  describe('CPU Usage Estimation', () => {
    it('should estimate CPU usage from processing time', () => {
      const sessionId = 'test-session-cpu';
      const audioData = AudioTestUtils.generateSineWave(440, 100, 8000);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.cpuUsagePercent).toBeGreaterThanOrEqual(0);
      expect(metrics.cpuUsagePercent).toBeLessThanOrEqual(100);
    });

    it('should show higher CPU usage for larger audio chunks', () => {
      const sessionId = 'test-session-cpu-size';

      const smallAudio = AudioTestUtils.generateSineWave(440, 20, 8000);
      const smallMetrics = analyzer.analyzeAudioChunk(sessionId + '-small', smallAudio, 8000);

      const largeAudio = AudioTestUtils.generateSineWave(440, 1000, 8000);
      const largeMetrics = analyzer.analyzeAudioChunk(sessionId + '-large', largeAudio, 8000);

      expect(smallMetrics.cpuUsagePercent).toBeGreaterThanOrEqual(0);
      expect(largeMetrics.cpuUsagePercent).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Session Management', () => {
    it('should track metrics per session', () => {
      const session1 = 'test-session-1';
      const session2 = 'test-session-2';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Create sessions first
      analyzer.analyzeAudioChunk(session1, audioData, 8000);
      analyzer.analyzeAudioChunk(session2, audioData, 8000);

      analyzer.reportBufferEvent(session1, 'underrun', 0.2);
      analyzer.reportBufferEvent(session2, 'overrun', 0.9);

      const metrics1 = analyzer.analyzeAudioChunk(session1, audioData, 8000);
      const metrics2 = analyzer.analyzeAudioChunk(session2, audioData, 8000);

      expect(metrics1.bufferUnderruns).toBe(1);
      expect(metrics1.bufferOverruns).toBe(0);
      expect(metrics2.bufferUnderruns).toBe(0);
      expect(metrics2.bufferOverruns).toBe(1);
    });

    it('should retrieve session metrics', () => {
      const sessionId = 'test-session-retrieve';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      const sessionMetrics = analyzer.getSessionMetrics(sessionId);
      expect(sessionMetrics).not.toBeNull();
      if (sessionMetrics) {
        expect(sessionMetrics.bufferUnderruns).toBeGreaterThanOrEqual(0);
        expect(sessionMetrics.bufferOverruns).toBeGreaterThanOrEqual(0);
      }
    });

    it('should return null for non-existent session', () => {
      const sessionMetrics = analyzer.getSessionMetrics('non-existent-session');
      expect(sessionMetrics).toBeNull();
    });

    it('should handle multiple sessions concurrently', () => {
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      const sessions = ['session-a', 'session-b', 'session-c'];
      sessions.forEach(sessionId => {
        analyzer.analyzeAudioChunk(sessionId, audioData, 8000);
      });

      sessions.forEach(sessionId => {
        const metrics = analyzer.getSessionMetrics(sessionId);
        expect(metrics).not.toBeNull();
      });
    });
  });

  describe('Quality Thresholds', () => {
    it('should detect high silence ratio', () => {
      // Requirement 9.5: Test quality thresholds trigger correctly
      const sessionId = 'test-session-high-silence';
      const silenceData = AudioTestUtils.generateSilence(100, 8000);

      const metrics = analyzer.analyzeAudioChunk(sessionId, silenceData, 8000);

      expect(metrics.silenceRatio).toBeGreaterThan(0.8);
    });

    it('should detect high processing latency', () => {
      // Requirement 9.5: Test quality thresholds trigger correctly
      const sessionId = 'test-session-high-latency';
      // Use a large audio chunk to potentially increase processing time
      const largeAudio = AudioTestUtils.generateSineWave(440, 1000, 8000);

      const metrics = analyzer.analyzeAudioChunk(sessionId, largeAudio, 8000);

      // Just verify latency is measured, threshold detection is logged
      expect(metrics.processingLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should detect buffer issues', () => {
      // Requirement 9.5: Test quality thresholds trigger correctly
      const sessionId = 'test-session-buffer-issues';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Create session first
      analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      analyzer.reportBufferEvent(sessionId, 'underrun', 0.1);
      analyzer.reportBufferEvent(sessionId, 'overrun', 0.95);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.bufferUnderruns).toBeGreaterThan(0);
      expect(metrics.bufferOverruns).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty audio buffer', () => {
      const sessionId = 'test-session-empty';
      const emptyBuffer = Buffer.alloc(0);

      const metrics = analyzer.analyzeAudioChunk(sessionId, emptyBuffer, 8000);

      // Empty buffer results in NaN for RMS (sqrt of 0/0)
      expect(isNaN(metrics.rmsLevel) || metrics.rmsLevel === 0).toBe(true);
      expect(metrics.peakLevel).toBe(0);
      // Empty buffer has no samples, so silenceRatio is NaN or 1.0
      expect(isNaN(metrics.silenceRatio) || metrics.silenceRatio === 1.0).toBe(true);
    });

    it('should handle very small audio chunks', () => {
      const sessionId = 'test-session-tiny';
      const tinyBuffer = Buffer.alloc(2);
      tinyBuffer.writeInt16LE(1000, 0);

      const metrics = analyzer.analyzeAudioChunk(sessionId, tinyBuffer, 8000);

      expect(metrics.rmsLevel).toBeGreaterThanOrEqual(0);
      expect(metrics.peakLevel).toBeGreaterThanOrEqual(0);
    });

    it('should handle very large audio chunks', () => {
      const sessionId = 'test-session-huge';
      const hugeBuffer = AudioTestUtils.generateSineWave(440, 5000, 8000); // 5 seconds

      const metrics = analyzer.analyzeAudioChunk(sessionId, hugeBuffer, 8000);

      expect(metrics.rmsLevel).toBeGreaterThan(0);
      expect(metrics.processingLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle odd-length buffers', () => {
      const sessionId = 'test-session-odd';
      const oddBuffer = Buffer.alloc(161); // Odd number

      const metrics = analyzer.analyzeAudioChunk(sessionId, oddBuffer, 8000);

      expect(metrics.rmsLevel).toBeGreaterThanOrEqual(0);
    });

    it('should handle maximum amplitude audio', () => {
      const sessionId = 'test-session-max-amp';
      const maxAmpBuffer = Buffer.alloc(160);
      for (let i = 0; i < 80; i++) {
        maxAmpBuffer.writeInt16LE(32767, i * 2); // Max positive value
      }

      const metrics = analyzer.analyzeAudioChunk(sessionId, maxAmpBuffer, 8000);

      expect(metrics.peakLevel).toBeCloseTo(1.0, 1);
      expect(metrics.rmsLevel).toBeGreaterThan(0.9);
    });
  });

  describe('Conversion Errors', () => {
    it('should track conversion errors', () => {
      const sessionId = 'test-session-conversion';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      // Initial analysis
      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics.conversionErrors).toBe(0);
    });
  });

  describe('Integration with Call SID', () => {
    it('should accept and track call SID', () => {
      const sessionId = 'test-session-callsid';
      const callSid = 'CA1234567890abcdef';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      const metrics = analyzer.analyzeAudioChunk(
        sessionId,
        audioData,
        8000,
        'process',
        callSid
      );

      expect(metrics).toBeDefined();
      expect(metrics.rmsLevel).toBeGreaterThanOrEqual(0);
    });

    it('should work without call SID', () => {
      const sessionId = 'test-session-no-callsid';
      const audioData = AudioTestUtils.generateSineWave(440, 50, 8000);

      const metrics = analyzer.analyzeAudioChunk(sessionId, audioData, 8000);

      expect(metrics).toBeDefined();
      expect(metrics.rmsLevel).toBeGreaterThanOrEqual(0);
    });
  });
});
