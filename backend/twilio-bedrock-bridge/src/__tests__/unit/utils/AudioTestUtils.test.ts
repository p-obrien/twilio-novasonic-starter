/**
 * Unit tests for AudioTestUtils
 * 
 * Verifies that audio test utilities work correctly for generating
 * and comparing test audio data.
 */

import { AudioTestUtils } from '../../utils/AudioTestUtils';

describe('AudioTestUtils', () => {
  describe('Buffer Creation', () => {
    it('should create buffer with specified size', () => {
      const buffer = AudioTestUtils.createBuffer(160);
      expect(buffer.length).toBe(160);
    });

    it('should create buffer with pattern', () => {
      const buffer = AudioTestUtils.createBuffer(100, 0x42);
      expect(buffer.length).toBe(100);
      expect(buffer[0]).toBe(0x42);
      expect(buffer[99]).toBe(0x42);
    });

    it('should create μ-law buffer', () => {
      const buffer = AudioTestUtils.createMuLawBuffer(160);
      expect(buffer.length).toBe(160);
      expect(AudioTestUtils.isMuLaw(buffer)).toBe(true);
    });

    it('should create PCM16 buffer', () => {
      const buffer = AudioTestUtils.createPcm16Buffer(80);
      expect(buffer.length).toBe(160); // 80 samples * 2 bytes
      expect(AudioTestUtils.isPCM16(buffer)).toBe(true);
    });
  });

  describe('Audio Generation', () => {
    it('should generate sine wave', () => {
      const buffer = AudioTestUtils.generateSineWave(440, 100, 8000);
      expect(buffer.length).toBeGreaterThan(0);
      expect(buffer.length % 2).toBe(0); // PCM16 has even length
      expect(AudioTestUtils.isPCM16(buffer)).toBe(true);
    });

    it('should generate silence', () => {
      const buffer = AudioTestUtils.generateSilence(100, 8000);
      expect(buffer.length).toBeGreaterThan(0);
      
      // Silence should be all zeros
      for (let i = 0; i < buffer.length; i++) {
        expect(buffer[i]).toBe(0);
      }
    });

    it('should generate white noise', () => {
      const buffer = AudioTestUtils.generateWhiteNoise(100, 8000);
      expect(buffer.length).toBeGreaterThan(0);
      expect(AudioTestUtils.isPCM16(buffer)).toBe(true);
      
      // Noise should have variation (not all zeros)
      const hasVariation = buffer.some(byte => byte !== 0);
      expect(hasVariation).toBe(true);
    });
  });

  describe('Audio Comparison', () => {
    it('should compare identical buffers', () => {
      const buffer1 = AudioTestUtils.createBuffer(160, 0x42);
      const buffer2 = AudioTestUtils.createBuffer(160, 0x42);
      
      expect(AudioTestUtils.compareAudioBuffers(buffer1, buffer2, 0.0)).toBe(true);
    });

    it('should detect different buffers', () => {
      const buffer1 = AudioTestUtils.createBuffer(160, 0x42);
      const buffer2 = AudioTestUtils.createBuffer(160, 0x43);
      
      expect(AudioTestUtils.compareAudioBuffers(buffer1, buffer2, 0.0)).toBe(false);
    });

    it('should calculate audio difference', () => {
      const buffer1 = AudioTestUtils.createBuffer(100, 0x00);
      const buffer2 = AudioTestUtils.createBuffer(100, 0xFF);
      
      const difference = AudioTestUtils.calculateAudioDifference(buffer1, buffer2);
      expect(difference).toBeGreaterThan(0);
      expect(difference).toBeLessThanOrEqual(1.0);
    });

    it('should handle different length buffers', () => {
      const buffer1 = AudioTestUtils.createBuffer(100);
      const buffer2 = AudioTestUtils.createBuffer(200);
      
      expect(AudioTestUtils.compareAudioBuffers(buffer1, buffer2)).toBe(false);
      expect(AudioTestUtils.calculateAudioDifference(buffer1, buffer2)).toBe(1.0);
    });
  });

  describe('Format Validation', () => {
    it('should validate PCM16 format', () => {
      const validPCM = AudioTestUtils.createPcm16Buffer(80);
      expect(AudioTestUtils.isPCM16(validPCM)).toBe(true);
      
      const invalidPCM = Buffer.alloc(161); // Odd length
      expect(AudioTestUtils.isPCM16(invalidPCM)).toBe(false);
    });

    it('should validate μ-law format', () => {
      const muLaw = AudioTestUtils.createMuLawBuffer(160);
      expect(AudioTestUtils.isMuLaw(muLaw)).toBe(true);
      
      const empty = Buffer.alloc(0);
      expect(AudioTestUtils.isMuLaw(empty)).toBe(false);
    });
  });

  describe('Size Calculation', () => {
    it('should calculate PCM16 to μ-law size', () => {
      const size = AudioTestUtils.calculateConvertedSize(320, 'pcm16', 'mulaw');
      expect(size).toBe(160);
    });

    it('should calculate μ-law to PCM16 size', () => {
      const size = AudioTestUtils.calculateConvertedSize(160, 'mulaw', 'pcm16');
      expect(size).toBe(320);
    });

    it('should handle same format conversion', () => {
      const size = AudioTestUtils.calculateConvertedSize(160, 'pcm16', 'pcm16');
      expect(size).toBe(160);
    });
  });

  describe('Test Audio Creation', () => {
    it('should create sine wave audio', () => {
      const audio = AudioTestUtils.createTestAudio({
        type: 'sine',
        frequency: 440,
        duration: 100
      });
      
      expect(audio.length).toBeGreaterThan(0);
      expect(AudioTestUtils.isPCM16(audio)).toBe(true);
    });

    it('should create silence audio', () => {
      const audio = AudioTestUtils.createTestAudio({
        type: 'silence',
        duration: 100
      });
      
      expect(audio.length).toBeGreaterThan(0);
    });

    it('should create noise audio', () => {
      const audio = AudioTestUtils.createTestAudio({
        type: 'noise',
        duration: 100
      });
      
      expect(audio.length).toBeGreaterThan(0);
    });

    it('should create pattern audio', () => {
      const audio = AudioTestUtils.createTestAudio({
        type: 'pattern',
        size: 160,
        pattern: 0x42
      });
      
      expect(audio.length).toBe(160);
      expect(audio[0]).toBe(0x42);
    });
  });
});
