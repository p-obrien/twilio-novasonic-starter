/**
 * Property-Based Testing Generators for Audio Data
 * 
 * This module provides generators for property-based testing using fast-check.
 * These generators create random but valid audio data for testing audio processing
 * functions across a wide range of inputs.
 * 
 * The generators ensure that:
 * - Audio buffers have valid sizes and formats
 * - μ-law audio contains valid byte values (0-255)
 * - PCM audio contains valid 16-bit signed samples (-32768 to 32767)
 * - Generated data is suitable for testing audio conversion properties
 */

import * as fc from 'fast-check';

/**
 * Configuration for property-based tests
 * Ensures all property tests run with at least 100 iterations
 */
export const PROPERTY_TEST_CONFIG = {
  /** Minimum number of iterations for property tests */
  numRuns: 100,
  /** Timeout per property test in milliseconds */
  timeout: 10000,
  /** Enable verbose output for debugging */
  verbose: false,
  /** Seed for reproducible test runs (optional) */
  seed: undefined as number | undefined,
};

/**
 * Audio format constants for generators
 */
export const AUDIO_CONSTANTS = {
  /** Twilio μ-law sample rate (8kHz) */
  MULAW_SAMPLE_RATE: 8000,
  /** Bedrock PCM sample rate (16kHz) */
  PCM_SAMPLE_RATE: 16000,
  /** Bytes per PCM16LE sample */
  BYTES_PER_SAMPLE: 2,
  /** Minimum audio chunk size in bytes (1ms at 8kHz μ-law) */
  MIN_CHUNK_SIZE: 8,
  /** Maximum audio chunk size in bytes (1 second at 16kHz PCM) */
  MAX_CHUNK_SIZE: 32000,
  /** Standard Twilio chunk size (20ms at 8kHz μ-law) */
  STANDARD_MULAW_CHUNK: 160,
  /** Standard Bedrock chunk size (20ms at 16kHz PCM) */
  STANDARD_PCM_CHUNK: 640,
};

/**
 * Generates a random audio buffer of arbitrary size
 * 
 * @param minSize - Minimum buffer size in bytes
 * @param maxSize - Maximum buffer size in bytes
 * @returns Arbitrary that generates Buffer instances
 */
export function audioBuffer(
  minSize: number = AUDIO_CONSTANTS.MIN_CHUNK_SIZE,
  maxSize: number = AUDIO_CONSTANTS.MAX_CHUNK_SIZE
): fc.Arbitrary<Buffer> {
  return fc
    .uint8Array({ minLength: minSize, maxLength: maxSize })
    .map((arr) => Buffer.from(arr));
}

/**
 * Generates μ-law encoded audio data
 * 
 * μ-law audio consists of bytes in the range 0-255, where each byte
 * represents a compressed audio sample. This generator creates valid
 * μ-law audio buffers suitable for testing Twilio audio processing.
 * 
 * @param minSamples - Minimum number of μ-law samples
 * @param maxSamples - Maximum number of μ-law samples
 * @returns Arbitrary that generates μ-law audio buffers
 */
export function muLawAudio(
  minSamples: number = AUDIO_CONSTANTS.MIN_CHUNK_SIZE,
  maxSamples: number = AUDIO_CONSTANTS.STANDARD_MULAW_CHUNK * 10
): fc.Arbitrary<Buffer> {
  return fc
    .uint8Array({ minLength: minSamples, maxLength: maxSamples })
    .map((arr) => Buffer.from(arr));
}

/**
 * Generates PCM16LE audio data
 * 
 * PCM16LE audio consists of 16-bit signed little-endian samples.
 * Each sample is in the range -32768 to 32767. This generator creates
 * valid PCM audio buffers suitable for testing Bedrock audio processing.
 * 
 * @param minSamples - Minimum number of PCM samples
 * @param maxSamples - Maximum number of PCM samples
 * @returns Arbitrary that generates PCM16LE audio buffers
 */
export function pcmAudio(
  minSamples: number = AUDIO_CONSTANTS.MIN_CHUNK_SIZE / 2,
  maxSamples: number = AUDIO_CONSTANTS.STANDARD_PCM_CHUNK / 2
): fc.Arbitrary<Buffer> {
  return fc
    .array(fc.integer({ min: -32768, max: 32767 }), {
      minLength: minSamples,
      maxLength: maxSamples,
    })
    .map((samples) => {
      const buffer = Buffer.allocUnsafe(samples.length * AUDIO_CONSTANTS.BYTES_PER_SAMPLE);
      for (let i = 0; i < samples.length; i++) {
        buffer.writeInt16LE(samples[i], i * AUDIO_CONSTANTS.BYTES_PER_SAMPLE);
      }
      return buffer;
    });
}

/**
 * Generates PCM audio with specific characteristics
 * 
 * This generator creates PCM audio with controlled frequency content,
 * useful for testing audio quality and conversion accuracy.
 * 
 * @param minFreq - Minimum frequency in Hz
 * @param maxFreq - Maximum frequency in Hz
 * @param durationMs - Duration in milliseconds
 * @param sampleRate - Sample rate in Hz
 * @returns Arbitrary that generates PCM audio with specific frequency
 */
export function pcmAudioWithFrequency(
  minFreq: number = 100,
  maxFreq: number = 3000,
  durationMs: number = 20,
  sampleRate: number = AUDIO_CONSTANTS.PCM_SAMPLE_RATE
): fc.Arbitrary<Buffer> {
  return fc.integer({ min: minFreq, max: maxFreq }).map((frequency) => {
    const samples = Math.floor((durationMs / 1000) * sampleRate);
    const buffer = Buffer.allocUnsafe(samples * AUDIO_CONSTANTS.BYTES_PER_SAMPLE);
    
    // Generate sine wave at specified frequency
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const sample = Math.round(Math.sin(2 * Math.PI * frequency * t) * 16000);
      buffer.writeInt16LE(sample, i * AUDIO_CONSTANTS.BYTES_PER_SAMPLE);
    }
    
    return buffer;
  });
}

/**
 * Generates standard Twilio audio chunks (20ms at 8kHz μ-law)
 * 
 * This generator creates audio chunks matching the standard size
 * sent by Twilio Media Streams, useful for testing realistic scenarios.
 * 
 * @returns Arbitrary that generates standard Twilio audio chunks
 */
export function standardTwilioChunk(): fc.Arbitrary<Buffer> {
  return muLawAudio(
    AUDIO_CONSTANTS.STANDARD_MULAW_CHUNK,
    AUDIO_CONSTANTS.STANDARD_MULAW_CHUNK
  );
}

/**
 * Generates standard Bedrock audio chunks (20ms at 16kHz PCM)
 * 
 * This generator creates audio chunks matching the standard size
 * expected by Bedrock models, useful for testing realistic scenarios.
 * 
 * @returns Arbitrary that generates standard Bedrock audio chunks
 */
export function standardBedrockChunk(): fc.Arbitrary<Buffer> {
  return pcmAudio(
    AUDIO_CONSTANTS.STANDARD_PCM_CHUNK / 2,
    AUDIO_CONSTANTS.STANDARD_PCM_CHUNK / 2
  );
}

/**
 * Generates audio buffers with arbitrary sizes for boundary testing
 * 
 * This generator creates buffers with various sizes including edge cases
 * like very small buffers, odd-sized buffers, and large buffers.
 * 
 * @returns Arbitrary that generates buffers of various sizes
 */
export function arbitrarySizedAudioBuffer(): fc.Arbitrary<Buffer> {
  return fc.oneof(
    // Very small buffers (1-10 bytes)
    audioBuffer(1, 10),
    // Small buffers (10-100 bytes)
    audioBuffer(10, 100),
    // Medium buffers (100-1000 bytes)
    audioBuffer(100, 1000),
    // Large buffers (1000-10000 bytes)
    audioBuffer(1000, 10000),
    // Standard sizes
    muLawAudio(AUDIO_CONSTANTS.STANDARD_MULAW_CHUNK, AUDIO_CONSTANTS.STANDARD_MULAW_CHUNK),
    pcmAudio(AUDIO_CONSTANTS.STANDARD_PCM_CHUNK / 2, AUDIO_CONSTANTS.STANDARD_PCM_CHUNK / 2)
  );
}

/**
 * Generates sample rates for testing resampling
 * 
 * @returns Arbitrary that generates common audio sample rates
 */
export function sampleRate(): fc.Arbitrary<number> {
  return fc.constantFrom(
    8000,   // Twilio μ-law
    16000,  // Bedrock PCM
    24000,  // Bedrock default
    44100,  // CD quality
    48000   // Professional audio
  );
}

/**
 * Generates pairs of sample rates for resampling tests
 * 
 * @returns Arbitrary that generates [sourceSampleRate, targetSampleRate] pairs
 */
export function sampleRatePair(): fc.Arbitrary<[number, number]> {
  return fc.tuple(sampleRate(), sampleRate());
}
