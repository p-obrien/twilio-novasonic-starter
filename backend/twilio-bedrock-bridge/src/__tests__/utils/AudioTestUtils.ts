/**
 * Audio Test Utilities
 * 
 * Consolidated utilities for audio generation, comparison, and testing.
 * Provides reusable functions for creating test audio data and verifying
 * audio processing operations.
 * 
 * Requirements: 5.1, 5.3
 */

import { Buffer } from 'node:buffer';

export class AudioTestUtils {
  /**
   * Generate a sine wave audio buffer for testing
   * 
   * @param frequency - Frequency in Hz
   * @param duration - Duration in milliseconds
   * @param sampleRate - Sample rate in Hz (default: 8000 for μ-law)
   * @returns Buffer containing PCM16 audio data
   */
  static generateSineWave(
    frequency: number,
    duration: number,
    sampleRate: number = 8000
  ): Buffer {
    const samples = Math.floor((duration / 1000) * sampleRate);
    const buffer = Buffer.alloc(samples * 2); // 2 bytes per sample for PCM16

    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const sample = Math.floor(Math.sin(2 * Math.PI * frequency * t) * 16000);
      buffer.writeInt16LE(sample, i * 2);
    }

    return buffer;
  }

  /**
   * Generate silence audio buffer
   * 
   * @param duration - Duration in milliseconds
   * @param sampleRate - Sample rate in Hz (default: 8000)
   * @returns Buffer containing silence (zeros for PCM16)
   */
  static generateSilence(duration: number, sampleRate: number = 8000): Buffer {
    const samples = Math.floor((duration / 1000) * sampleRate);
    return Buffer.alloc(samples * 2); // All zeros = silence
  }

  /**
   * Generate white noise audio buffer
   * 
   * @param duration - Duration in milliseconds
   * @param sampleRate - Sample rate in Hz (default: 8000)
   * @returns Buffer containing random noise
   */
  static generateWhiteNoise(duration: number, sampleRate: number = 8000): Buffer {
    const samples = Math.floor((duration / 1000) * sampleRate);
    const buffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
      // Generate random sample between -16000 and 16000
      const sample = Math.floor((Math.random() * 2 - 1) * 16000);
      buffer.writeInt16LE(sample, i * 2);
    }

    return buffer;
  }

  /**
   * Create a test buffer with a simple pattern
   * Useful for debugging and verifying buffer operations
   * 
   * @param size - Size in bytes
   * @param pattern - Optional fill pattern (0-255)
   * @returns Buffer filled with pattern
   */
  static createBuffer(size: number, pattern?: number): Buffer {
    const buffer = Buffer.alloc(size);
    
    if (pattern !== undefined) {
      buffer.fill(pattern);
    } else {
      // Fill with incrementing pattern for easier debugging
      for (let i = 0; i < size; i++) {
        buffer[i] = i % 256;
      }
    }
    
    return buffer;
  }

  /**
   * Create a μ-law encoded test buffer
   * 
   * @param size - Size in bytes
   * @returns Buffer with valid μ-law values
   */
  static createMuLawBuffer(size: number): Buffer {
    const buffer = Buffer.alloc(size);
    
    // Fill with valid μ-law values (avoid 0x00 and 0xFF which are special)
    for (let i = 0; i < size; i++) {
      buffer[i] = 0x80 + (i % 127); // Valid μ-law range
    }
    
    return buffer;
  }

  /**
   * Create a PCM16 test buffer with sine wave pattern
   * 
   * @param samples - Number of samples (not bytes)
   * @returns Buffer containing PCM16 audio data
   */
  static createPcm16Buffer(samples: number): Buffer {
    const buffer = Buffer.alloc(samples * 2);
    
    for (let i = 0; i < samples; i++) {
      // Create a sine wave pattern for realistic audio data
      const sample = Math.floor(Math.sin(i * 0.1) * 16000);
      buffer.writeInt16LE(sample, i * 2);
    }
    
    return buffer;
  }

  /**
   * Compare two audio buffers with tolerance
   * 
   * @param buffer1 - First buffer
   * @param buffer2 - Second buffer
   * @param tolerance - Acceptable difference (0.0 to 1.0)
   * @returns true if buffers are similar within tolerance
   */
  static compareAudioBuffers(
    buffer1: Buffer,
    buffer2: Buffer,
    tolerance: number = 0.05
  ): boolean {
    if (buffer1.length !== buffer2.length) {
      return false;
    }

    const difference = this.calculateAudioDifference(buffer1, buffer2);
    return difference <= tolerance;
  }

  /**
   * Calculate the difference between two audio buffers
   * 
   * @param buffer1 - First buffer
   * @param buffer2 - Second buffer
   * @returns Normalized difference (0.0 to 1.0)
   */
  static calculateAudioDifference(buffer1: Buffer, buffer2: Buffer): number {
    if (buffer1.length !== buffer2.length) {
      return 1.0; // Maximum difference
    }

    let totalDifference = 0;
    const maxValue = 65535; // Maximum value for 16-bit audio

    for (let i = 0; i < buffer1.length; i++) {
      totalDifference += Math.abs(buffer1[i] - buffer2[i]);
    }

    // Normalize to 0.0 - 1.0 range
    return totalDifference / (buffer1.length * maxValue);
  }

  /**
   * Verify that a buffer contains valid PCM16 audio
   * 
   * @param buffer - Buffer to verify
   * @returns true if buffer appears to be valid PCM16
   */
  static isPCM16(buffer: Buffer): boolean {
    // PCM16 buffers must have even length (2 bytes per sample)
    if (buffer.length % 2 !== 0) {
      return false;
    }

    // Check that samples are within valid range
    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      if (sample < -32768 || sample > 32767) {
        return false;
      }
    }

    return true;
  }

  /**
   * Verify that a buffer contains valid μ-law audio
   * 
   * @param buffer - Buffer to verify
   * @returns true if buffer appears to be valid μ-law
   */
  static isMuLaw(buffer: Buffer): boolean {
    // μ-law is 8-bit, so any buffer length is valid
    // All byte values are technically valid μ-law
    return buffer.length > 0;
  }

  /**
   * Convert and verify audio format conversion
   * Helper for testing round-trip conversions
   * 
   * @param input - Input audio buffer
   * @param fromFormat - Source format ('pcm16' or 'mulaw')
   * @param toFormat - Target format ('pcm16' or 'mulaw')
   * @param converter - Conversion function
   * @returns Converted buffer
   */
  static convertAndVerify(
    input: Buffer,
    fromFormat: 'pcm16' | 'mulaw',
    toFormat: 'pcm16' | 'mulaw',
    converter: (input: Buffer) => Buffer
  ): Buffer {
    const output = converter(input);

    // Verify output format
    if (toFormat === 'pcm16') {
      if (!this.isPCM16(output)) {
        throw new Error('Conversion did not produce valid PCM16 audio');
      }
    } else if (toFormat === 'mulaw') {
      if (!this.isMuLaw(output)) {
        throw new Error('Conversion did not produce valid μ-law audio');
      }
    }

    return output;
  }

  /**
   * Calculate expected buffer size after format conversion
   * 
   * @param inputSize - Input buffer size in bytes
   * @param fromFormat - Source format
   * @param toFormat - Target format
   * @returns Expected output size in bytes
   */
  static calculateConvertedSize(
    inputSize: number,
    fromFormat: 'pcm16' | 'mulaw',
    toFormat: 'pcm16' | 'mulaw'
  ): number {
    if (fromFormat === 'pcm16' && toFormat === 'mulaw') {
      // PCM16 to μ-law: 2 bytes -> 1 byte
      return inputSize / 2;
    } else if (fromFormat === 'mulaw' && toFormat === 'pcm16') {
      // μ-law to PCM16: 1 byte -> 2 bytes
      return inputSize * 2;
    }
    
    // Same format
    return inputSize;
  }

  /**
   * Create a buffer with specific audio characteristics for testing
   * 
   * @param options - Audio generation options
   * @returns Generated audio buffer
   */
  static createTestAudio(options: {
    type: 'sine' | 'silence' | 'noise' | 'pattern';
    duration?: number;
    frequency?: number;
    sampleRate?: number;
    size?: number;
    pattern?: number;
  }): Buffer {
    const {
      type,
      duration = 100,
      frequency = 440,
      sampleRate = 8000,
      size = 160,
      pattern
    } = options;

    switch (type) {
      case 'sine':
        return this.generateSineWave(frequency, duration, sampleRate);
      case 'silence':
        return this.generateSilence(duration, sampleRate);
      case 'noise':
        return this.generateWhiteNoise(duration, sampleRate);
      case 'pattern':
        return this.createBuffer(size, pattern);
      default:
        throw new Error(`Unknown audio type: ${type}`);
    }
  }
}
