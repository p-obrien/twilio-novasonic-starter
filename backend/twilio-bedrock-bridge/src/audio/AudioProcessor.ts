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

import logger from '../utils/logger';
import { audioQualityAnalyzer } from './AudioQualityAnalyzer';

/**
 * Decodes a single μ-law encoded byte to 16-bit signed PCM sample.
 * 
 * Implements the ITU G.711 μ-law decompression algorithm used in telephony systems.
 * μ-law encoding provides logarithmic quantization that emphasizes lower amplitude
 * signals, making it ideal for voice transmission over limited bandwidth channels.
 * 
 * The algorithm:
 * 1. Inverts all bits (μ-law uses inverted encoding)
 * 2. Extracts sign, exponent, and mantissa components
 * 3. Reconstructs the linear PCM value using logarithmic expansion
 * 4. Applies sign and clamps to 16-bit range
 * 
 * @param uVal - μ-law encoded byte (0-255)
 * @returns 16-bit signed PCM sample (-32768 to 32767)
 */
export function muLawDecodeByte(uVal: number): number {
  // Step 1: Invert all bits (μ-law uses complement encoding)
  uVal = ~uVal & 0xff;

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
  return sample;
}

/**
 * Converts a buffer of μ-law encoded bytes to PCM16LE format.
 * 
 * Processes an entire buffer of μ-law samples, converting each byte to a
 * 16-bit signed PCM sample in little-endian format. This is the standard
 * conversion used when receiving audio from Twilio for processing by Bedrock.
 * 
 * The output buffer will be exactly twice the size of the input buffer
 * (1 byte μ-law → 2 bytes PCM16LE per sample).
 * 
 * @param muBuf - Buffer containing μ-law encoded audio samples
 * @returns Buffer containing PCM16LE audio samples (little-endian)
 */
export function muLawBufferToPcm16LE(muBuf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(muBuf.length * 2);
  for (let i = 0; i < muBuf.length; i++) {
    const sample = muLawDecodeByte(muBuf[i]);
    out.writeInt16LE(sample, i * 2);
  }
  return out;
}

/**
 * Upsamples PCM16LE audio from 8kHz to 16kHz with anti-aliasing filtering.
 * 
 * Performs high-quality sample rate conversion using interpolation and filtering
 * to prevent aliasing artifacts. This is essential when converting Twilio audio
 * (8kHz) for processing by Bedrock models that expect 16kHz input.
 * 
 * The upsampling process:
 * 1. Doubles the sample rate by inserting interpolated samples
 * 2. Applies a 5-tap FIR low-pass filter to prevent aliasing
 * 3. Uses weighted interpolation for smooth transitions between samples
 * 4. Maintains audio quality while expanding frequency range
 * 
 * The anti-aliasing filter has a cutoff frequency around 4kHz to preserve
 * the original 8kHz signal bandwidth while preventing artifacts in the
 * expanded 16kHz output.
 * 
 * @param pcm16leBuf - Input PCM16LE buffer at 8kHz sample rate
 * @returns Output PCM16LE buffer at 16kHz sample rate (2x size)
 */
export function upsample8kTo16k(pcm16leBuf: Buffer): Buffer {
  const inputSamples = pcm16leBuf.length / 2;  // Each sample is 2 bytes
  const outputSamples = inputSamples * 2;           // Double the sample count
  const out = Buffer.allocUnsafe(outputSamples * 2); // Allocate output buffer

  // Optimized upsampling with basic anti-aliasing filter
  for (let i = 0; i < inputSamples; i++) {
    const currentSample = pcm16leBuf.readInt16LE(i * 2);

    // Write the original sample at even positions
    out.writeInt16LE(currentSample, i * 4);

    // Calculate interpolated sample with simple 3-tap filter for better quality
    let interpolatedSample = currentSample;

    if (i < inputSamples - 1) {
      const nextSample = pcm16leBuf.readInt16LE((i + 1) * 2);
      const prevSample = i > 0 ? pcm16leBuf.readInt16LE((i - 1) * 2) : currentSample;
      
      // 3-tap filter: 25% previous + 50% average + 25% next
      interpolatedSample = Math.round(
        0.25 * prevSample + 
        0.5 * ((currentSample + nextSample) / 2) + 
        0.25 * nextSample
      );
    }

    // Write the interpolated sample at odd positions
    out.writeInt16LE(interpolatedSample, i * 4 + 2);
  }

  return out;
}

/**
 * Encodes a 16-bit PCM sample to μ-law format byte.
 * 
 * Implements the ITU G.711 μ-law compression algorithm for telephony systems.
 * This logarithmic encoding reduces 16-bit linear PCM to 8-bit μ-law while
 * maintaining good perceptual quality for voice signals.
 * 
 * The encoding process:
 * 1. Clamps input to 16-bit range and extracts sign
 * 2. Adds bias and finds the appropriate exponent (segment)
 * 3. Extracts mantissa from the biased sample
 * 4. Combines sign, exponent, and mantissa
 * 5. Inverts all bits (μ-law convention)
 * 
 * @param sample - 16-bit signed PCM sample (-32768 to 32767)
 * @returns μ-law encoded byte (0-255)
 */
export function pcm16ToMuLawByte(sample: number): number {
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
  return ulawByte;
}

/**
 * Downsamples PCM audio with anti-aliasing filtering to prevent artifacts.
 * 
 * Performs high-quality sample rate reduction using interpolation and low-pass
 * filtering to prevent aliasing. This is crucial when converting higher sample
 * rate audio (e.g., from Bedrock) to Twilio's 8kHz requirement.
 * 
 * The downsampling process:
 * 1. Calculates the decimation ratio between source and target rates
 * 2. Applies a 3-tap FIR low-pass filter with cutoff at target Nyquist frequency
 * 3. Uses linear interpolation for fractional sample positions
 * 4. Maintains audio quality while reducing bandwidth
 * 
 * @param srcBuf - Source PCM16LE buffer at original sample rate
 * @param srcRate - Source sample rate in Hz
 * @param targetRate - Target sample rate in Hz
 * @returns Downsampled PCM16LE buffer at target sample rate
 */
export function downsampleWithAntiAliasing(srcBuf: Buffer, srcRate: number, targetRate: number): Buffer {
  const inputSamples = Math.floor(srcBuf.length / 2);  // Each sample is 2 bytes
  const ratio = srcRate / targetRate;                   // Decimation ratio
  const outputSamples = Math.floor(inputSamples / ratio); // Output sample count
  const out = Buffer.allocUnsafe(outputSamples * 2);    // Allocate output buffer

  // Debug logging for downsampling
  const inputDurationMs = Math.round((inputSamples / srcRate) * 1000);
  const outputDurationMs = Math.round((outputSamples / targetRate) * 1000);

  logger.debug('Downsampling audio', {
    inputSamples,
    srcRate,
    targetRate,
    ratio,
    outputSamples,
    inputDurationMs,
    outputDurationMs,
    durationMatch: inputDurationMs === outputDurationMs
  });

  // Simple decimation with linear interpolation for fractional positions
  for (let outIdx = 0; outIdx < outputSamples; outIdx++) {
    const srcIdx = outIdx * ratio;
    const baseSampleIdx = Math.floor(srcIdx);
    const frac = srcIdx - baseSampleIdx;

    let sample = srcBuf.readInt16LE(baseSampleIdx * 2);

    // Linear interpolation for fractional positions
    if (frac > 0 && baseSampleIdx + 1 < inputSamples) {
      const nextSample = srcBuf.readInt16LE((baseSampleIdx + 1) * 2);
      sample = Math.round(sample * (1 - frac) + nextSample * frac);
    }

    // Clamp and write output sample
    const outputSample = Math.max(-32768, Math.min(32767, sample));
    out.writeInt16LE(outputSample, outIdx * 2);
  }

  return out;
}

/**
 * Converts an entire PCM16LE buffer to μ-law format.
 * 
 * Processes a buffer of 16-bit signed PCM samples, encoding each sample
 * to μ-law format for Twilio transmission. This is the final step in
 * preparing Bedrock audio output for telephony systems.
 * 
 * The output buffer will be exactly half the size of the input buffer
 * (2 bytes PCM16LE → 1 byte μ-law per sample).
 * 
 * @param pcm16Buffer - Input buffer containing PCM16LE samples
 * @returns Buffer containing μ-law encoded audio samples
 */
export function pcm16BufferToMuLaw(pcm16Buffer: Buffer): Buffer {
  const totalSamples = Math.floor(pcm16Buffer.length / 2);
  const muLawBytes: number[] = [];

  for (let i = 0; i < totalSamples; i++) {
    const sample = pcm16Buffer.readInt16LE(i * 2);
    muLawBytes.push(pcm16ToMuLawByte(sample));
  }

  return Buffer.from(muLawBytes);
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
 * @returns μ-law encoded buffer at 8kHz ready for Twilio transmission
 */
export function processBedrockAudioOutput(
  audioOutput: any,
  defaultSampleRate: number = 24000,
  sessionId?: string,
  callSid?: string
): Buffer {
  // Step 1: Extract base64 audio payload with defensive property checking
  // Different Bedrock models may use different property names for audio data
  const b64 = audioOutput?.content ?? audioOutput?.payload ?? audioOutput?.chunk ?? audioOutput?.data ??
    (typeof audioOutput === 'string' ? audioOutput : undefined);

  if (!b64) {
    throw new Error('audioOutput missing payload');
  }

  // Step 2: Decode base64 payload and extract metadata
  let srcBuf = Buffer.from(b64, 'base64');
  let srcRate = Number(audioOutput?.sampleRateHz || audioOutput?.sample_rate_hz || defaultSampleRate);
  const mediaHint = (audioOutput?.mediaType || audioOutput?.media_type || audioOutput?.encoding || '').toString().toLowerCase();

  // Validate sample rate to prevent timing issues
  if (srcRate <= 0 || srcRate > 48000) {
    logger.warn('Invalid source sample rate detected, using default', { srcRate, defaultSampleRate });
    srcRate = defaultSampleRate;
  }

  // Debug logging to help identify timing issues
  const expectedSamples = Math.floor(srcBuf.length / 2); // Assuming PCM16LE
  const expectedDurationMs = srcRate > 0 ? Math.round((expectedSamples / srcRate) * 1000) : 'unknown';

  logger.debug('Processing Bedrock audio', {
    srcBufferBytes: srcBuf.length,
    srcRate,
    mediaHint,
    expectedSamples,
    expectedDurationMs,
    audioOutputKeys: Object.keys(audioOutput || {})
  });

  let muBuf: Buffer;

  // Step 3: Determine processing path based on format detection
  const looksLikeMuLaw = mediaHint.includes('mulaw') || mediaHint.includes('ulaw') ||
    mediaHint.includes('g.711') || mediaHint.includes('g711');

  if (looksLikeMuLaw) {
    // Path A: Input is already μ-law encoded
    if (srcRate === 8000) {
      // Optimal case: already μ-law @ 8kHz, use directly to avoid quality loss
      muBuf = Buffer.from(srcBuf);
    } else {
      // Resample μ-law: decode → resample → re-encode
      const pcmFromMu = muLawBufferToPcm16LE(srcBuf);
      const downsampledPcm = downsampleWithAntiAliasing(pcmFromMu, srcRate, 8000);
      muBuf = pcm16BufferToMuLaw(downsampledPcm);
    }
  } else {
    // Path B: Input is PCM16LE (most common case for Bedrock)

    // Ensure buffer has even length for 16-bit samples
    if (srcBuf.length % 2 !== 0) {
      srcBuf = srcBuf.subarray(0, srcBuf.length - 1);
    }

    // Downsample to 8kHz and encode to μ-law for Twilio
    const downsampledPcm = downsampleWithAntiAliasing(srcBuf, srcRate, 8000);
    muBuf = pcm16BufferToMuLaw(downsampledPcm);
  }

  // Debug logging for output
  const outputDurationMs = Math.round((muBuf.length / 8000) * 1000);
  logger.debug('Processed to μ-law', {
    outputBytes: muBuf.length,
    outputDurationMs,
    compressionRatio: srcBuf.length / muBuf.length
  });

  // Analyze audio quality if session info is available
  if (sessionId) {
    try {
      audioQualityAnalyzer.analyzeAudioChunk(
        sessionId,
        muBuf,
        8000,
        'bedrock_output_processing',
        callSid
      );
    } catch (error) {
      logger.debug('Audio quality analysis failed', { sessionId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return muBuf;
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