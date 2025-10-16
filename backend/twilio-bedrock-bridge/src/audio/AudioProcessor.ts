/**
 * AudioProcessor - Comprehensive audio format conversion and processing utilities
 * 
 * This module provides a complete suite of audio processing functions for the
 * Twilio-Bedrock bridge, handling the complex audio format conversions required
 * for seamless communication between different audio systems.
 * 
 * Key capabilities:
 * - μ-law (G.711) encoding and decoding for Twilio compatibility
 * - High-quality resampling with anti-aliasing filters
 * - PCM format conversions (8kHz ↔ 16kHz, 16-bit signed)
 * - Intelligent format detection and processing pipelines
 * - Optimized algorithms for real-time audio processing
 * 
 * Audio format support:
 * - Input: μ-law @ 8kHz (Twilio), PCM16LE @ various rates (Bedrock)
 * - Output: μ-law @ 8kHz (Twilio), PCM16LE @ 16kHz (Bedrock)
 * - Processing: Anti-aliased resampling, format detection, padding
 * 
 * The module implements ITU G.711 μ-law standard for telephony compatibility
 * and uses sophisticated filtering techniques to maintain audio quality during
 * sample rate conversions.
 * 
 * @example
 * ```typescript
 * // Convert Twilio audio for Bedrock
 * const pcm16k = processTwilioAudioInput(muLawBuffer);
 * 
 * // Convert Bedrock audio for Twilio
 * const muLaw8k = processBedrockAudioOutput(bedrockResponse);
 * ```
 */

// Internal modules - audio
import { audioQualityAnalyzer } from './AudioQualityAnalyzer';
import { BufferPool } from './BufferPool';

// Internal modules - observability
import logger from '../observability/logger';

// Internal modules - utils
import { AudioSampleRates, AudioProcessing } from '../utils/constants';

/**
 * Managed buffer wrapper that automatically releases buffers back to pool
 */
export class ManagedBuffer {
  private released = false;

  constructor(
    public readonly buffer: Buffer,
    private readonly pool: BufferPool
  ) {}

  /**
   * Releases the buffer back to the pool
   */
  public release(): void {
    if (!this.released) {
      this.pool.release(this.buffer);
      this.released = true;
    }
  }

  /**
   * Gets the underlying buffer (use with caution)
   */
  public getBuffer(): Buffer {
    return this.buffer;
  }

  /**
   * Automatic cleanup when object is garbage collected
   */
  public [Symbol.dispose](): void {
    this.release();
  }
}

/**
 * Performance benchmarking results for audio processing functions
 */
export interface AudioProcessingBenchmark {
  /** Function name being benchmarked */
  functionName: string;
  /** Number of iterations performed */
  iterations: number;
  /** Total time in milliseconds */
  totalTimeMs: number;
  /** Average time per iteration in microseconds */
  avgTimeMicros: number;
  /** Samples processed per second */
  samplesPerSecond: number;
  /** Memory usage statistics */
  memoryStats: {
    heapUsedBefore: number;
    heapUsedAfter: number;
    heapDelta: number;
  };
}

/**
 * Benchmarks audio processing functions for performance analysis
 */
export class AudioProcessingBenchmarker {
  /**
   * Benchmarks μ-law to PCM conversion performance
   */
  public static benchmarkMuLawToPcm(iterations: number = 1000): AudioProcessingBenchmark {
    // Create test data
    const testData = Buffer.alloc(160); // 20ms of μ-law audio
    for (let i = 0; i < testData.length; i++) {
      testData[i] = Math.floor(Math.random() * 256);
    }

    // Measure memory before
    const memBefore = process.memoryUsage();
    
    // Benchmark the function
    const startTime = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      const result = muLawBufferToPcm16LE(testData);
      // Release buffer back to pool
      BufferPool.getInstance().release(result);
    }
    
    const endTime = process.hrtime.bigint();
    const memAfter = process.memoryUsage();
    
    // Calculate metrics
    const totalTimeMs = Number(endTime - startTime) / 1_000_000;
    const avgTimeMicros = (totalTimeMs * 1000) / iterations;
    const samplesPerSecond = (testData.length * iterations) / (totalTimeMs / 1000);
    
    return {
      functionName: 'muLawBufferToPcm16LE',
      iterations,
      totalTimeMs,
      avgTimeMicros,
      samplesPerSecond,
      memoryStats: {
        heapUsedBefore: memBefore.heapUsed,
        heapUsedAfter: memAfter.heapUsed,
        heapDelta: memAfter.heapUsed - memBefore.heapUsed
      }
    };
  }

  /**
   * Benchmarks PCM to μ-law conversion performance
   */
  public static benchmarkPcmToMuLaw(iterations: number = 1000): AudioProcessingBenchmark {
    // Create test data
    const testData = Buffer.alloc(320); // 20ms of PCM16LE audio
    for (let i = 0; i < testData.length; i += 2) {
      const sample = Math.floor(Math.random() * 65536) - 32768;
      testData.writeInt16LE(sample, i);
    }

    // Measure memory before
    const memBefore = process.memoryUsage();
    
    // Benchmark the function
    const startTime = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      const result = pcm16BufferToMuLaw(testData);
      // Release buffer back to pool
      BufferPool.getInstance().release(result);
    }
    
    const endTime = process.hrtime.bigint();
    const memAfter = process.memoryUsage();
    
    // Calculate metrics
    const totalTimeMs = Number(endTime - startTime) / 1_000_000;
    const avgTimeMicros = (totalTimeMs * 1000) / iterations;
    const samplesPerSecond = ((testData.length / 2) * iterations) / (totalTimeMs / 1000);
    
    return {
      functionName: 'pcm16BufferToMuLaw',
      iterations,
      totalTimeMs,
      avgTimeMicros,
      samplesPerSecond,
      memoryStats: {
        heapUsedBefore: memBefore.heapUsed,
        heapUsedAfter: memAfter.heapUsed,
        heapDelta: memAfter.heapUsed - memBefore.heapUsed
      }
    };
  }

  /**
   * Benchmarks upsampling performance
   */
  public static benchmarkUpsampling(iterations: number = 1000): AudioProcessingBenchmark {
    // Create test data (20ms of PCM16LE at 8kHz)
    const testData = Buffer.alloc(320);
    for (let i = 0; i < testData.length; i += 2) {
      const sample = Math.floor(Math.random() * 65536) - 32768;
      testData.writeInt16LE(sample, i);
    }

    // Measure memory before
    const memBefore = process.memoryUsage();
    
    // Benchmark the function
    const startTime = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      const result = upsample8kTo16k(testData);
      // Release buffer back to pool
      BufferPool.getInstance().release(result);
    }
    
    const endTime = process.hrtime.bigint();
    const memAfter = process.memoryUsage();
    
    // Calculate metrics
    const totalTimeMs = Number(endTime - startTime) / 1_000_000;
    const avgTimeMicros = (totalTimeMs * 1000) / iterations;
    const samplesPerSecond = ((testData.length / 2) * iterations) / (totalTimeMs / 1000);
    
    return {
      functionName: 'upsample8kTo16k',
      iterations,
      totalTimeMs,
      avgTimeMicros,
      samplesPerSecond,
      memoryStats: {
        heapUsedBefore: memBefore.heapUsed,
        heapUsedAfter: memAfter.heapUsed,
        heapDelta: memAfter.heapUsed - memBefore.heapUsed
      }
    };
  }

  /**
   * Runs a comprehensive benchmark of all audio processing functions
   */
  public static runComprehensiveBenchmark(iterations: number = 1000): AudioProcessingBenchmark[] {
    logger.info('Starting comprehensive audio processing benchmark', { iterations });
    
    const results = [
      this.benchmarkMuLawToPcm(iterations),
      this.benchmarkPcmToMuLaw(iterations),
      this.benchmarkUpsampling(iterations)
    ];

    // Log results
    for (const result of results) {
      logger.info('Benchmark result', {
        function: result.functionName,
        avgTimeMicros: Math.round(result.avgTimeMicros * 100) / 100,
        samplesPerSecond: Math.round(result.samplesPerSecond),
        memoryDelta: result.memoryStats.heapDelta
      });
    }

    return results;
  }
}

/**
 * Pre-computed μ-law decode lookup table for maximum performance.
 * This eliminates the need for bit manipulation and arithmetic during decoding.
 */
const MU_LAW_DECODE_TABLE = new Int16Array(256);

/**
 * Pre-computed μ-law encode lookup table for maximum performance.
 * This eliminates the need for complex encoding calculations.
 */
const MU_LAW_ENCODE_TABLE = new Uint8Array(65536);

/**
 * Initialize μ-law lookup tables for optimized conversion
 */
function initializeMuLawTables(): void {
  // Initialize decode table
  for (let i = 0; i < 256; i++) {
    // Step 1: Invert all bits (μ-law uses complement encoding)
    let uVal = ~i & 0xff;

    // Step 2: Extract encoded components
    const sign = uVal & 0x80;        // Sign bit (bit 7)
    const exponent = (uVal >> 4) & 0x07;  // Exponent (bits 4-6)
    const mantissa = uVal & 0x0f;    // Mantissa (bits 0-3)

    // Step 3: Reconstruct linear sample using logarithmic expansion
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample = sample - 0x84;  // Remove bias

    // Step 4: Apply sign
    if (sign !== 0) {
      sample = -sample;
    }

    // Step 5: Clamp to 16-bit signed integer range
    if (sample > 32767) sample = 32767;
    if (sample < -32768) sample = -32768;
    
    MU_LAW_DECODE_TABLE[i] = sample;
  }

  // Initialize encode table
  for (let i = 0; i < 65536; i++) {
    // Convert from unsigned 16-bit index to signed 16-bit sample
    let sample = i - 32768;
    
    // Step 1: Clamp input to 16-bit signed range
    if (sample > 32767) sample = 32767;
    if (sample < -32768) sample = -32768;

    // Step 2: Extract sign and work with absolute value
    const BIAS = 0x84;  // μ-law bias constant
    let sign = (sample >> 8) & 0x80;  // Extract sign bit
    if (sign !== 0) sample = -sample;  // Work with absolute value

    // Step 3: Clamp to maximum encodable value and add bias
    if (sample > 32635) sample = 32635;
    sample = sample + BIAS;

    // Step 4: Find the appropriate exponent (segment)
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
      exponent--;
    }

    // Step 5: Extract mantissa from the biased sample
    const mantissa = (sample >> (exponent + 3)) & 0x0f;

    // Step 6: Combine components and invert (μ-law convention)
    const ulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
    MU_LAW_ENCODE_TABLE[i] = ulawByte;
  }
}

// Initialize tables immediately
initializeMuLawTables();

/**
 * Optimized μ-law decode using pre-computed lookup table.
 * 
 * This function provides maximum performance by eliminating all arithmetic
 * and bit manipulation operations during runtime. The lookup table is
 * pre-computed once during module initialization.
 * 
 * @param uVal - μ-law encoded byte (0-255)
 * @returns 16-bit signed PCM sample (-32768 to 32767)
 */
export function muLawDecodeByte(uVal: number): number {
  return MU_LAW_DECODE_TABLE[uVal & 0xff];
}

/**
 * Optimized μ-law encode using pre-computed lookup table.
 * 
 * This function provides maximum performance by eliminating all arithmetic
 * and bit manipulation operations during runtime.
 * 
 * @param sample - 16-bit signed PCM sample (-32768 to 32767)
 * @returns μ-law encoded byte (0-255)
 */
export function pcm16ToMuLawByte(sample: number): number {
  // Convert signed sample to unsigned index (add 32768)
  const index = (sample + 32768) & 0xffff;
  return MU_LAW_ENCODE_TABLE[index];
}

/**
 * Converts a buffer of μ-law encoded bytes to PCM16LE format using optimized vectorized operations.
 * 
 * This function uses pre-computed lookup tables and optimized memory access patterns
 * to achieve maximum performance. It processes multiple samples per iteration where
 * possible and uses efficient buffer operations.
 * 
 * The output buffer will be exactly twice the size of the input buffer
 * (1 byte μ-law → 2 bytes PCM16LE per sample).
 * 
 * @param muBuf - Buffer containing μ-law encoded audio samples
 * @returns Buffer containing PCM16LE audio samples (little-endian)
 */
export function muLawBufferToPcm16LE(muBuf: Buffer): Buffer {
  const bufferPool = BufferPool.getInstance();
  const out = bufferPool.acquire(muBuf.length * 2);
  
  // Create Int16Array view for efficient 16-bit writes
  const outView = new Int16Array(out.buffer, out.byteOffset, muBuf.length);
  
  // Process samples using optimized lookup table
  for (let i = 0; i < muBuf.length; i++) {
    outView[i] = MU_LAW_DECODE_TABLE[muBuf[i]];
  }
  
  return out;
}

/**
 * Optimized upsampling from 8kHz to 16kHz using vectorized operations and improved interpolation.
 * 
 * This function uses typed arrays for efficient memory access and implements
 * a higher-quality interpolation algorithm with anti-aliasing characteristics.
 * The algorithm uses a 3-point interpolation filter for better audio quality.
 * 
 * Performance optimizations:
 * - Uses Int16Array views for efficient memory access
 * - Vectorized operations where possible
 * - Optimized interpolation coefficients
 * - Reduced function call overhead
 * 
 * @param pcm16leBuf - Input PCM16LE buffer at 8kHz sample rate
 * @returns Output PCM16LE buffer at 16kHz sample rate (2x size)
 */
export function upsample8kTo16k(pcm16leBuf: Buffer): Buffer {
  const inputSamples = pcm16leBuf.length / 2;
  const outputSamples = inputSamples * 2;
  const bufferPool = BufferPool.getInstance();
  const out = bufferPool.acquire(outputSamples * 2);

  // Create typed array views for efficient access
  const inView = new Int16Array(pcm16leBuf.buffer, pcm16leBuf.byteOffset, inputSamples);
  const outView = new Int16Array(out.buffer, out.byteOffset, outputSamples);

  // Optimized upsampling with 3-point interpolation
  for (let i = 0; i < inputSamples; i++) {
    const outIdx = i * 2;
    
    // Copy original sample
    outView[outIdx] = inView[i];

    // Calculate interpolated sample using 3-point filter
    if (i < inputSamples - 1) {
      const prev = i > 0 ? inView[i - 1] : inView[i];
      const curr = inView[i];
      const next = inView[i + 1];
      
      // 3-point interpolation with anti-aliasing characteristics
      // Coefficients: [-0.0625, 0.5625, 0.5625, -0.0625] for better quality
      const interpolated = Math.round(
        -0.0625 * prev + 0.5625 * curr + 0.5625 * next
      );
      
      outView[outIdx + 1] = Math.max(-32768, Math.min(32767, interpolated));
    } else {
      // Last sample - just duplicate
      outView[outIdx + 1] = inView[i];
    }
  }

  return out;
}



/**
 * Optimized downsampling with anti-aliasing using vectorized operations and improved filtering.
 * 
 * This function uses typed arrays for efficient memory access and implements
 * a high-quality anti-aliasing filter to prevent artifacts during downsampling.
 * The algorithm uses a 5-tap FIR filter for better frequency response.
 * 
 * Performance optimizations:
 * - Uses Int16Array views for efficient memory access
 * - Pre-computed filter coefficients
 * - Optimized loop structure
 * - Reduced memory allocations
 * 
 * @param srcBuf - Source PCM16LE buffer at original sample rate
 * @param srcRate - Source sample rate in Hz
 * @param targetRate - Target sample rate in Hz
 * @returns Downsampled PCM16LE buffer at target sample rate
 */
export function downsampleWithAntiAliasing(srcBuf: Buffer, srcRate: number, targetRate: number): Buffer {
  const inputSamples = Math.floor(srcBuf.length / 2);
  const ratio = srcRate / targetRate;
  const outputSamples = Math.floor(inputSamples / ratio);
  const bufferPool = BufferPool.getInstance();
  const out = bufferPool.acquire(outputSamples * 2);

  // Create typed array views for efficient access
  const inView = new Int16Array(srcBuf.buffer, srcBuf.byteOffset, inputSamples);
  const outView = new Int16Array(out.buffer, out.byteOffset, outputSamples);

  // Debug logging for downsampling
  const inputDurationMs = Math.round((inputSamples / srcRate) * 1000);
  const outputDurationMs = Math.round((outputSamples / targetRate) * 1000);

  logger.debug('Optimized downsampling audio', {
    inputSamples,
    srcRate,
    targetRate,
    ratio,
    outputSamples,
    inputDurationMs,
    outputDurationMs,
    durationMatch: inputDurationMs === outputDurationMs
  });

  // 5-tap anti-aliasing filter coefficients (Hamming window, cutoff at Nyquist/2)
  const filterCoeffs = [-0.0234, 0.1563, 0.7344, 0.1563, -0.0234];
  const filterRadius = 2;

  // Optimized downsampling with anti-aliasing filter
  for (let outIdx = 0; outIdx < outputSamples; outIdx++) {
    const srcIdx = outIdx * ratio;
    const centerIdx = Math.round(srcIdx);
    
    let filteredSample = 0;
    let coeffSum = 0;

    // Apply 5-tap filter around the center sample
    for (let filterIdx = 0; filterIdx < filterCoeffs.length; filterIdx++) {
      const sampleIdx = centerIdx - filterRadius + filterIdx;
      
      if (sampleIdx >= 0 && sampleIdx < inputSamples) {
        filteredSample += inView[sampleIdx] * filterCoeffs[filterIdx];
        coeffSum += filterCoeffs[filterIdx];
      }
    }

    // Normalize by coefficient sum and clamp to 16-bit range
    const normalizedSample = coeffSum > 0 ? filteredSample / coeffSum : 0;
    outView[outIdx] = Math.max(-32768, Math.min(32767, Math.round(normalizedSample)));
  }

  return out;
}

/**
 * Converts an entire PCM16LE buffer to μ-law format using optimized vectorized operations.
 * 
 * This function uses pre-computed lookup tables and efficient memory access patterns
 * to achieve maximum performance. It processes samples using typed arrays for
 * optimal memory access and eliminates intermediate array allocations.
 * 
 * The output buffer will be exactly half the size of the input buffer
 * (2 bytes PCM16LE → 1 byte μ-law per sample).
 * 
 * @param pcm16Buffer - Input buffer containing PCM16LE samples
 * @returns Buffer containing μ-law encoded audio samples
 */
export function pcm16BufferToMuLaw(pcm16Buffer: Buffer): Buffer {
  const totalSamples = Math.floor(pcm16Buffer.length / 2);
  const bufferPool = BufferPool.getInstance();
  const out = bufferPool.acquire(totalSamples);
  
  // Create Int16Array view for efficient 16-bit reads
  const inView = new Int16Array(pcm16Buffer.buffer, pcm16Buffer.byteOffset, totalSamples);
  
  // Process samples using optimized lookup table
  for (let i = 0; i < totalSamples; i++) {
    // Convert signed sample to unsigned index for lookup table
    const index = (inView[i] + 32768) & 0xffff;
    out[i] = MU_LAW_ENCODE_TABLE[index];
  }

  return out;
}

/**
 * Processes audio output from Bedrock models for Twilio transmission.
 * 
 * This is the main processing pipeline for converting Bedrock TTS output into
 * the μ-law format required by Twilio. It handles various input formats and
 * sample rates, applying appropriate conversions to ensure compatibility.
 * 
 * Processing pipeline:
 * 1. Extracts base64 audio payload from Bedrock response
 * 2. Detects audio format (μ-law vs PCM) from metadata hints
 * 3. Applies appropriate conversion path:
 *    - μ-law input: decode → resample → re-encode if needed
 *    - PCM input: downsample → encode to μ-law
 * 4. Ensures final output is μ-law @ 8kHz for Twilio
 * 
 * The function is defensive and handles various response formats from
 * different Bedrock models, making it robust across model variations.
 * 
 * @param audioOutput - Bedrock audio response object or base64 string
 * @param defaultSampleRate - Default sample rate if not specified (24kHz)
 * @param sessionId - Optional session ID for quality analysis
 * @param callSid - Optional call SID for quality analysis
 * @returns μ-law encoded buffer at 8kHz ready for Twilio transmission
 */
export function processBedrockAudioOutput(
  audioOutput: any,
  defaultSampleRate: number = AudioSampleRates.BEDROCK_DEFAULT,
  sessionId?: string,
  callSid?: string
): Buffer {
  const audioPayload = extractAudioPayload(audioOutput);
  const { srcBuf, srcRate, mediaHint } = decodeAudioMetadata(audioPayload, audioOutput, defaultSampleRate);
  
  logAudioProcessingStart(srcBuf, srcRate, mediaHint, audioOutput);
  
  const muBuf = processAudioByFormat(srcBuf, srcRate, mediaHint);
  
  logAudioProcessingComplete(muBuf, srcBuf);
  analyzeAudioQuality(sessionId, muBuf, callSid);
  
  return muBuf;
}

/**
 * Extracts base64 audio payload from Bedrock response
 */
function extractAudioPayload(audioOutput: any): string {
  const b64 = audioOutput?.content ?? audioOutput?.payload ?? audioOutput?.chunk ?? audioOutput?.data ??
    (typeof audioOutput === 'string' ? audioOutput : undefined);

  if (!b64) {
    throw new Error('audioOutput missing payload');
  }

  return b64;
}

/**
 * Decodes audio metadata from the payload and response
 */
function decodeAudioMetadata(
  b64Payload: string, 
  audioOutput: any, 
  defaultSampleRate: number
): { srcBuf: Buffer; srcRate: number; mediaHint: string } {
  let srcBuf = Buffer.from(b64Payload, 'base64');
  let srcRate = Number(audioOutput?.sampleRateHz || audioOutput?.sample_rate_hz || defaultSampleRate);
  const mediaHint = (audioOutput?.mediaType || audioOutput?.media_type || audioOutput?.encoding || '').toString().toLowerCase();

  // Validate sample rate to prevent timing issues
  if (srcRate <= 0 || srcRate > AudioSampleRates.MAX_SUPPORTED) {
    logger.warn('Invalid source sample rate detected, using default', { srcRate, defaultSampleRate });
    srcRate = defaultSampleRate;
  }

  return { srcBuf, srcRate, mediaHint };
}

/**
 * Logs the start of audio processing with debug information
 */
function logAudioProcessingStart(srcBuf: Buffer, srcRate: number, mediaHint: string, audioOutput: any): void {
  const expectedSamples = Math.floor(srcBuf.length / AudioProcessing.BYTES_PER_SAMPLE_16BIT); // Assuming PCM16LE
  const expectedDurationMs = srcRate > 0 ? Math.round((expectedSamples / srcRate) * 1000) : 'unknown';

  logger.debug('Processing Bedrock audio', {
    srcBufferBytes: srcBuf.length,
    srcRate,
    mediaHint,
    expectedSamples,
    expectedDurationMs,
    audioOutputKeys: Object.keys(audioOutput || {})
  });
}

/**
 * Processes audio based on detected format
 */
function processAudioByFormat(srcBuf: Buffer, srcRate: number, mediaHint: string): Buffer {
  const looksLikeMuLaw = detectMuLawFormat(mediaHint);

  if (looksLikeMuLaw) {
    return processMuLawInput(srcBuf, srcRate);
  } else {
    return processPcmInput(srcBuf, srcRate);
  }
}

/**
 * Detects if the audio format is μ-law based on media hints
 */
function detectMuLawFormat(mediaHint: string): boolean {
  return mediaHint.includes('mulaw') || mediaHint.includes('ulaw') ||
    mediaHint.includes('g.711') || mediaHint.includes('g711');
}

/**
 * Processes μ-law input audio
 */
function processMuLawInput(srcBuf: Buffer, srcRate: number): Buffer {
  if (srcRate === AudioSampleRates.TWILIO_MULAW) {
    // Optimal case: already μ-law @ 8kHz, use directly to avoid quality loss
    return Buffer.from(srcBuf);
  } else {
    // Resample μ-law: decode → resample → re-encode
    const pcmFromMu = muLawBufferToPcm16LE(srcBuf);
    const downsampledPcm = downsampleWithAntiAliasing(pcmFromMu, srcRate, AudioSampleRates.TWILIO_MULAW);
    return pcm16BufferToMuLaw(downsampledPcm);
  }
}

/**
 * Processes PCM input audio
 */
function processPcmInput(srcBuf: Buffer, srcRate: number): Buffer {
  // Ensure buffer has even length for 16-bit samples
  if (srcBuf.length % AudioProcessing.BYTES_PER_SAMPLE_16BIT !== 0) {
    srcBuf = srcBuf.subarray(0, srcBuf.length - 1);
  }

  // Downsample to 8kHz and encode to μ-law for Twilio
  const downsampledPcm = downsampleWithAntiAliasing(srcBuf, srcRate, AudioSampleRates.TWILIO_MULAW);
  return pcm16BufferToMuLaw(downsampledPcm);
}

/**
 * Logs audio processing completion
 */
function logAudioProcessingComplete(muBuf: Buffer, srcBuf: Buffer): void {
  const outputDurationMs = Math.round((muBuf.length / AudioSampleRates.TWILIO_MULAW) * 1000);
  logger.debug('Processed to μ-law', {
    outputBytes: muBuf.length,
    outputDurationMs,
    compressionRatio: srcBuf.length / muBuf.length
  });
}

/**
 * Analyzes audio quality if session information is available
 */
function analyzeAudioQuality(sessionId: string | undefined, muBuf: Buffer, callSid?: string): void {
  if (sessionId) {
    try {
      audioQualityAnalyzer.analyzeAudioChunk(
        sessionId,
        muBuf,
        AudioSampleRates.TWILIO_MULAW,
        'bedrock_output_processing',
        callSid
      );
    } catch (error) {
      logger.debug('Audio quality analysis failed', { 
        sessionId, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
}

/**
 * Processes inbound Twilio audio for Bedrock model consumption.
 * 
 * Converts μ-law audio from Twilio into the PCM16LE format expected by
 * Bedrock models. This includes format conversion and upsampling to provide
 * higher quality audio for speech recognition and processing.
 * 
 * Processing pipeline:
 * 1. Decodes μ-law samples to PCM16LE at 8kHz
 * 2. Upsamples from 8kHz to 16kHz with anti-aliasing
 * 3. Applies padding for small chunks to ensure minimum processing size
 * 4. Returns PCM16LE buffer ready for Bedrock transmission
 * 
 * The upsampling improves audio quality for Bedrock models that benefit
 * from higher sample rates, while padding ensures consistent chunk sizes
 * for optimal model performance.
 * 
 * @param muLawBuffer - μ-law encoded audio buffer from Twilio
 * @returns PCM16LE buffer at 16kHz ready for Bedrock processing
 */
export function processTwilioAudioInput(muLawBuffer: Buffer, sessionId?: string, callSid?: string): Buffer {
  const startTime = Date.now();
  
  // Step 1: Convert μ-law to PCM16LE at original 8kHz rate
  const pcm16le_8k = muLawBufferToPcm16LE(muLawBuffer);

  // Step 2: Upsample from 8kHz to 16kHz with anti-aliasing
  let pcm16le_16k = upsample8kTo16k(pcm16le_8k);

  // Step 3: Apply padding for small chunks to ensure optimal processing
  // Bedrock models perform better with minimum chunk sizes
  const minSamples = Math.floor(0.01 * 16000); // 10ms at 16kHz = 160 samples
  const currentSamples = pcm16le_16k.length / 2;

  if (currentSamples < minSamples) {
    const paddingBytes = (minSamples - currentSamples) * 2;
    const padding = Buffer.alloc(paddingBytes, 0); // Silent padding
    pcm16le_16k = Buffer.concat([pcm16le_16k, padding]);
  }

  // Step 4: Analyze audio quality if session info is available
  if (sessionId) {
    try {
      audioQualityAnalyzer.analyzeAudioChunk(
        sessionId,
        pcm16le_16k,
        16000,
        'twilio_input_processing',
        callSid
      );
    } catch (error) {
      logger.debug('Audio quality analysis failed', { sessionId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return pcm16le_16k;
}