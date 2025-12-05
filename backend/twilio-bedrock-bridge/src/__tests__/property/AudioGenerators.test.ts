/**
 * Property Test Generators Validation
 * 
 * This test verifies that the audio data generators produce valid data
 * suitable for property-based testing of audio processing functions.
 */

import * as fc from 'fast-check';
import {
  PROPERTY_TEST_CONFIG,
  AUDIO_CONSTANTS,
  audioBuffer,
  muLawAudio,
  pcmAudio,
  pcmAudioWithFrequency,
  standardTwilioChunk,
  standardBedrockChunk,
  arbitrarySizedAudioBuffer,
  sampleRate,
  sampleRatePair,
} from '../utils/PropertyTestGenerators';

describe('Audio Property Test Generators', () => {
  describe('audioBuffer generator', () => {
    it('should generate buffers within specified size range', () => {
      fc.assert(
        fc.property(audioBuffer(10, 100), (buffer) => {
          return buffer.length >= 10 && buffer.length <= 100;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should generate valid Buffer instances', () => {
      fc.assert(
        fc.property(audioBuffer(), (buffer) => {
          return Buffer.isBuffer(buffer);
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });

  describe('muLawAudio generator', () => {
    it('should generate μ-law audio with valid byte values', () => {
      fc.assert(
        fc.property(muLawAudio(), (buffer) => {
          // All bytes should be in range 0-255 (automatically true for Buffer)
          for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] < 0 || buffer[i] > 255) {
              return false;
            }
          }
          return true;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should generate buffers within specified sample count', () => {
      fc.assert(
        fc.property(muLawAudio(160, 160), (buffer) => {
          return buffer.length === 160;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });

  describe('pcmAudio generator', () => {
    it('should generate PCM audio with even byte count', () => {
      fc.assert(
        fc.property(pcmAudio(), (buffer) => {
          // PCM16LE requires even number of bytes (2 bytes per sample)
          return buffer.length % 2 === 0;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should generate valid 16-bit signed samples', () => {
      fc.assert(
        fc.property(pcmAudio(), (buffer) => {
          // Read all samples and verify they're in valid range
          for (let i = 0; i < buffer.length; i += 2) {
            const sample = buffer.readInt16LE(i);
            if (sample < -32768 || sample > 32767) {
              return false;
            }
          }
          return true;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should generate buffers with specified sample count', () => {
      fc.assert(
        fc.property(pcmAudio(160, 160), (buffer) => {
          return buffer.length === 160 * 2; // 160 samples * 2 bytes per sample
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });

  describe('pcmAudioWithFrequency generator', () => {
    it('should generate PCM audio with even byte count', () => {
      fc.assert(
        fc.property(pcmAudioWithFrequency(), (buffer) => {
          return buffer.length % 2 === 0;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should generate audio with expected duration', () => {
      const durationMs = 20;
      const sampleRate = AUDIO_CONSTANTS.PCM_SAMPLE_RATE;
      const expectedSamples = Math.floor((durationMs / 1000) * sampleRate);
      const expectedBytes = expectedSamples * 2;

      fc.assert(
        fc.property(
          pcmAudioWithFrequency(100, 3000, durationMs, sampleRate),
          (buffer) => {
            return buffer.length === expectedBytes;
          }
        ),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });

  describe('standardTwilioChunk generator', () => {
    it('should generate standard Twilio chunk size', () => {
      fc.assert(
        fc.property(standardTwilioChunk(), (buffer) => {
          return buffer.length === AUDIO_CONSTANTS.STANDARD_MULAW_CHUNK;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });

  describe('standardBedrockChunk generator', () => {
    it('should generate standard Bedrock chunk size', () => {
      fc.assert(
        fc.property(standardBedrockChunk(), (buffer) => {
          return buffer.length === AUDIO_CONSTANTS.STANDARD_PCM_CHUNK;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should generate PCM audio with even byte count', () => {
      fc.assert(
        fc.property(standardBedrockChunk(), (buffer) => {
          return buffer.length % 2 === 0;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });

  describe('arbitrarySizedAudioBuffer generator', () => {
    it('should generate buffers of various sizes', () => {
      const sizes = new Set<number>();

      fc.assert(
        fc.property(arbitrarySizedAudioBuffer(), (buffer) => {
          sizes.add(buffer.length);
          return Buffer.isBuffer(buffer);
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );

      // Should generate at least some variety in sizes
      expect(sizes.size).toBeGreaterThan(10);
    });
  });

  describe('sampleRate generator', () => {
    it('should generate valid sample rates', () => {
      const validRates = [8000, 16000, 24000, 44100, 48000];

      fc.assert(
        fc.property(sampleRate(), (rate) => {
          return validRates.includes(rate);
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });

  describe('sampleRatePair generator', () => {
    it('should generate pairs of valid sample rates', () => {
      const validRates = [8000, 16000, 24000, 44100, 48000];

      fc.assert(
        fc.property(sampleRatePair(), ([srcRate, targetRate]) => {
          return (
            validRates.includes(srcRate) && validRates.includes(targetRate)
          );
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should generate pairs as tuples', () => {
      fc.assert(
        fc.property(sampleRatePair(), (pair) => {
          return Array.isArray(pair) && pair.length === 2;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });
});
