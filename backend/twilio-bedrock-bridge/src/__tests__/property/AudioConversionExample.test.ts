/**
 * Example Property-Based Tests for Audio Conversion
 * 
 * This file demonstrates how to use the property test generators
 * to test audio processing functions. These are example tests that
 * show the framework is working correctly.
 */

import * as fc from 'fast-check';
import {
  PROPERTY_TEST_CONFIG,
  muLawAudio,
  pcmAudio,
  standardTwilioChunk,
} from '../utils/PropertyTestGenerators';
import {
  muLawBufferToPcm16LE,
  pcm16BufferToMuLaw,
  upsample8kTo16k,
} from '@/audio/AudioProcessor';

describe('Audio Conversion Property Tests (Examples)', () => {
  describe('μ-law to PCM conversion', () => {
    it('should double the buffer size (1 byte μ-law → 2 bytes PCM)', () => {
      fc.assert(
        fc.property(muLawAudio(), (muLawBuffer) => {
          const pcmBuffer = muLawBufferToPcm16LE(muLawBuffer);
          return pcmBuffer.length === muLawBuffer.length * 2;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should produce even-length PCM buffers', () => {
      fc.assert(
        fc.property(muLawAudio(), (muLawBuffer) => {
          const pcmBuffer = muLawBufferToPcm16LE(muLawBuffer);
          return pcmBuffer.length % 2 === 0;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });

  describe('PCM to μ-law conversion', () => {
    it('should halve the buffer size (2 bytes PCM → 1 byte μ-law)', () => {
      fc.assert(
        fc.property(pcmAudio(), (pcmBuffer) => {
          const muLawBuffer = pcm16BufferToMuLaw(pcmBuffer);
          return muLawBuffer.length === pcmBuffer.length / 2;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should produce valid μ-law bytes (0-255)', () => {
      fc.assert(
        fc.property(pcmAudio(), (pcmBuffer) => {
          const muLawBuffer = pcm16BufferToMuLaw(pcmBuffer);
          for (let i = 0; i < muLawBuffer.length; i++) {
            if (muLawBuffer[i] < 0 || muLawBuffer[i] > 255) {
              return false;
            }
          }
          return true;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });

  describe('upsampling 8kHz to 16kHz', () => {
    it('should double the buffer size', () => {
      fc.assert(
        fc.property(pcmAudio(), (pcmBuffer) => {
          const upsampledBuffer = upsample8kTo16k(pcmBuffer);
          return upsampledBuffer.length === pcmBuffer.length * 2;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should maintain even byte count', () => {
      fc.assert(
        fc.property(pcmAudio(), (pcmBuffer) => {
          const upsampledBuffer = upsample8kTo16k(pcmBuffer);
          return upsampledBuffer.length % 2 === 0;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });

  describe('standard Twilio chunks', () => {
    it('should convert standard chunks correctly', () => {
      fc.assert(
        fc.property(standardTwilioChunk(), (muLawBuffer) => {
          const pcmBuffer = muLawBufferToPcm16LE(muLawBuffer);
          // Standard Twilio chunk: 160 bytes μ-law → 320 bytes PCM
          return pcmBuffer.length === 320;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });
});
