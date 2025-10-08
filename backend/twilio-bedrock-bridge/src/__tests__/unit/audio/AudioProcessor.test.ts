/**
 * AudioProcessor Unit Tests
 * 
 * Tests for audio format conversion and processing utilities including
 * μ-law encoding/decoding, resampling, and format detection.
 */

import {
    muLawDecodeByte,
    pcm16ToMuLawByte,
    muLawBufferToPcm16LE,
    pcm16BufferToMuLaw,
    upsample8kTo16k,
    downsampleWithAntiAliasing,
    processTwilioAudioInput,
    processBedrockAudioOutput,
    AudioProcessingBenchmarker
} from '../../../audio/AudioProcessor';
import { BufferPool } from '../../../audio/BufferPool';

describe('AudioProcessor', () => {
    let bufferPool: BufferPool;

    beforeEach(() => {
        // Create isolated buffer pool for each test
        bufferPool = BufferPool.create({ initialSize: 5, maxSize: 20 });
        // Mock the singleton to return our test instance
        jest.spyOn(BufferPool, 'getInstance').mockReturnValue(bufferPool);
    });

    afterEach(() => {
        bufferPool.cleanup();
        jest.restoreAllMocks();
    });

    describe('μ-law Conversion', () => {
        describe('muLawDecodeByte', () => {
            it('should decode μ-law silence correctly', () => {
                const silence = 0xFF; // μ-law silence
                const decoded = muLawDecodeByte(silence);
                expect(decoded).toBe(0);
            });

            it('should decode μ-law values to valid PCM range', () => {
                for (let i = 0; i < 256; i++) {
                    const decoded = muLawDecodeByte(i);
                    expect(decoded).toBeGreaterThanOrEqual(-32768);
                    expect(decoded).toBeLessThanOrEqual(32767);
                }
            });

            it('should handle boundary values correctly', () => {
                // μ-law 0x00 should decode to a negative value (due to bit inversion)
                expect(muLawDecodeByte(0x00)).toBeLessThan(0);
                expect(muLawDecodeByte(0x80)).toBeGreaterThan(0);
                expect(muLawDecodeByte(0xFF)).toBe(0); // μ-law silence
            });
        });

        describe('pcm16ToMuLawByte', () => {
            it('should encode PCM silence to μ-law silence', () => {
                const encoded = pcm16ToMuLawByte(0);
                expect(encoded).toBe(0xFF);
            });

            it('should encode positive and negative values correctly', () => {
                const positiveEncoded = pcm16ToMuLawByte(16000);
                const negativeEncoded = pcm16ToMuLawByte(-16000);

                expect(positiveEncoded).not.toBe(negativeEncoded);
                expect(positiveEncoded).toBeGreaterThanOrEqual(0);
                expect(positiveEncoded).toBeLessThanOrEqual(255);
                expect(negativeEncoded).toBeGreaterThanOrEqual(0);
                expect(negativeEncoded).toBeLessThanOrEqual(255);
            });

            it('should handle boundary values', () => {
                expect(pcm16ToMuLawByte(32767)).toBeGreaterThanOrEqual(0);
                expect(pcm16ToMuLawByte(-32768)).toBeGreaterThanOrEqual(0);
            });
        });

        describe('Round-trip conversion', () => {
            it('should maintain reasonable accuracy in round-trip conversion', () => {
                const testValues = [0, 1000, -1000, 16000, -16000, 32000, -32000];

                for (const original of testValues) {
                    const encoded = pcm16ToMuLawByte(original);
                    const decoded = muLawDecodeByte(encoded);

                    // μ-law is lossy, so allow some tolerance
                    const tolerance = Math.abs(original) * 0.1 + 100; // 10% + 100 sample tolerance
                    expect(Math.abs(decoded - original)).toBeLessThan(tolerance);
                }
            });
        });
    });

    describe('Buffer Conversion', () => {
        describe('muLawBufferToPcm16LE', () => {
            it('should convert μ-law buffer to PCM16LE with correct size', () => {
                const muLawBuffer = createMuLawTestBuffer(160);
                const pcmBuffer = muLawBufferToPcm16LE(muLawBuffer);

                expect(pcmBuffer.length).toBe(320); // 160 * 2 bytes per sample
            });

            it('should handle empty buffer', () => {
                const emptyBuffer = Buffer.alloc(0);
                const result = muLawBufferToPcm16LE(emptyBuffer);
                expect(result.length).toBe(0);
            });

            it('should produce valid PCM16LE data', () => {
                const muLawBuffer = createMuLawTestBuffer(10);
                const pcmBuffer = muLawBufferToPcm16LE(muLawBuffer);

                // Check that we can read 16-bit samples
                for (let i = 0; i < pcmBuffer.length; i += 2) {
                    const sample = pcmBuffer.readInt16LE(i);
                    expect(sample).toBeGreaterThanOrEqual(-32768);
                    expect(sample).toBeLessThanOrEqual(32767);
                }
            });
        });

        describe('pcm16BufferToMuLaw', () => {
            it('should convert PCM16LE buffer to μ-law with correct size', () => {
                const pcmBuffer = createPcm16TestBuffer(160);
                const muLawBuffer = pcm16BufferToMuLaw(pcmBuffer);

                expect(muLawBuffer.length).toBe(160); // 320 bytes / 2 bytes per sample
            });

            it('should handle odd-length buffers by truncating', () => {
                const oddBuffer = Buffer.alloc(321); // Odd number of bytes
                const result = pcm16BufferToMuLaw(oddBuffer);
                expect(result.length).toBe(160); // (321-1) / 2
            });

            it('should produce valid μ-law data', () => {
                const pcmBuffer = createPcm16TestBuffer(10);
                const muLawBuffer = pcm16BufferToMuLaw(pcmBuffer);

                for (let i = 0; i < muLawBuffer.length; i++) {
                    expect(muLawBuffer[i]).toBeGreaterThanOrEqual(0);
                    expect(muLawBuffer[i]).toBeLessThanOrEqual(255);
                }
            });
        });
    });

    describe('Resampling', () => {
        describe('upsample8kTo16k', () => {
            it('should double the sample count', () => {
                const input = createPcm16TestBuffer(80); // 80 samples at 8kHz
                const output = upsample8kTo16k(input);

                expect(output.length).toBe(320); // 160 samples * 2 bytes = 320 bytes
            });

            it('should maintain audio duration', () => {
                const input = createPcm16TestBuffer(160); // 20ms at 8kHz
                const output = upsample8kTo16k(input);

                const inputSamples = input.length / 2;
                const outputSamples = output.length / 2;

                expect(outputSamples).toBe(inputSamples * 2);
            });

            it('should handle empty buffer', () => {
                const emptyBuffer = Buffer.alloc(0);
                const result = upsample8kTo16k(emptyBuffer);
                expect(result.length).toBe(0);
            });

            it('should produce smooth interpolation', () => {
                // Create a simple ramp signal
                const input = Buffer.alloc(8); // 4 samples
                input.writeInt16LE(0, 0);
                input.writeInt16LE(1000, 2);
                input.writeInt16LE(2000, 4);
                input.writeInt16LE(3000, 6);

                const output = upsample8kTo16k(input);
                expect(output.length).toBe(16); // 8 samples

                // Check that interpolated values are between original samples
                const sample1 = output.readInt16LE(2); // First interpolated sample
                expect(sample1).toBeGreaterThan(0);
                expect(sample1).toBeLessThan(1000);
            });
        });

        describe('downsampleWithAntiAliasing', () => {
            it('should reduce sample count correctly', () => {
                const input = createPcm16TestBuffer(320); // 320 samples
                const output = downsampleWithAntiAliasing(input, 16000, 8000);

                const expectedSamples = Math.floor(320 / 2);
                expect(output.length).toBe(expectedSamples * 2);
            });

            it('should handle various sample rate ratios', () => {
                const input = createPcm16TestBuffer(480); // 480 samples

                // 24kHz to 8kHz (3:1 ratio)
                const output = downsampleWithAntiAliasing(input, 24000, 8000);
                const expectedSamples = Math.floor(480 / 3);
                expect(output.length).toBe(expectedSamples * 2);
            });

            it('should apply anti-aliasing filtering', () => {
                // Create high-frequency content that should be filtered
                const input = Buffer.alloc(1600); // 800 samples
                for (let i = 0; i < 800; i++) {
                    // High frequency sine wave
                    const sample = Math.floor(Math.sin(i * 0.5) * 16000);
                    input.writeInt16LE(sample, i * 2);
                }

                const output = downsampleWithAntiAliasing(input, 16000, 8000);
                expect(output.length).toBeGreaterThan(0);

                // Output should be smoother (less high-frequency content)
                // This is a basic check - in practice you'd analyze frequency content
                let highFreqCount = 0;
                for (let i = 2; i < output.length - 2; i += 2) {
                    const prev = output.readInt16LE(i - 2);
                    const curr = output.readInt16LE(i);
                    const next = output.readInt16LE(i + 2);

                    // Count rapid changes (high frequency indicators)
                    if (Math.abs(curr - prev) > 8000 && Math.abs(next - curr) > 8000) {
                        highFreqCount++;
                    }
                }

                // Should have fewer high-frequency artifacts than input
                // This is a basic check - anti-aliasing should reduce rapid changes
                expect(highFreqCount).toBeLessThan(output.length / 4); // More lenient threshold
            });
        });
    });

    describe('High-level Processing Functions', () => {
        describe('processTwilioAudioInput', () => {
            it('should convert μ-law to PCM16LE at 16kHz', () => {
                const muLawInput = createMuLawTestBuffer(160); // 20ms at 8kHz
                const result = processTwilioAudioInput(muLawInput);

                // Should be upsampled to 16kHz
                expect(result.length).toBe(640); // 320 samples * 2 bytes
            });

            it('should apply padding for small chunks', () => {
                const smallInput = createMuLawTestBuffer(80); // 10ms at 8kHz
                const result = processTwilioAudioInput(smallInput);

                // Should be padded to at least 10ms at 16kHz (160 samples = 320 bytes)
                expect(result.length).toBeGreaterThanOrEqual(320);
            });

            it('should handle empty input', () => {
                const emptyInput = Buffer.alloc(0);
                const result = processTwilioAudioInput(emptyInput);

                // Should still produce minimum chunk size due to padding
                expect(result.length).toBeGreaterThan(0);
            });
        });

        describe('processBedrockAudioOutput', () => {
            it('should process base64 PCM audio to μ-law', () => {
                const pcmData = createPcm16TestBuffer(320); // 20ms at 16kHz
                const base64Data = pcmData.toString('base64');

                const audioOutput = {
                    content: base64Data,
                    sampleRateHz: 16000
                };

                const result = processBedrockAudioOutput(audioOutput);

                // Should be downsampled to 8kHz μ-law
                expect(result.length).toBe(160); // 20ms at 8kHz
            });

            it('should handle μ-law input correctly', () => {
                const muLawData = createMuLawTestBuffer(160);
                const base64Data = muLawData.toString('base64');

                const audioOutput = {
                    payload: base64Data,
                    mediaType: 'audio/mulaw',
                    sampleRateHz: 8000
                };

                const result = processBedrockAudioOutput(audioOutput);
                expect(result.length).toBe(160);
            });

            it('should handle various response formats', () => {
                const pcmData = createPcm16TestBuffer(160);
                const base64Data = pcmData.toString('base64');

                const formats = [
                    { content: base64Data },
                    { payload: base64Data },
                    { chunk: base64Data },
                    { data: base64Data }
                ];

                for (const format of formats) {
                    const result = processBedrockAudioOutput(format, 16000);
                    expect(result.length).toBeGreaterThan(0);
                }
            });

            it('should throw error for missing payload', () => {
                expect(() => {
                    processBedrockAudioOutput({});
                }).toThrow('audioOutput missing payload');
            });

            it('should handle invalid sample rates gracefully', () => {
                const pcmData = createPcm16TestBuffer(160);
                const base64Data = pcmData.toString('base64');

                const audioOutput = {
                    content: base64Data,
                    sampleRateHz: -1000 // Invalid sample rate
                };

                // Should not throw and should use default sample rate
                const result = processBedrockAudioOutput(audioOutput, 16000);
                expect(result.length).toBeGreaterThan(0);
            });
        });
    });

    describe('Performance Benchmarking', () => {
        describe('AudioProcessingBenchmarker', () => {
            it('should benchmark μ-law to PCM conversion', () => {
                const benchmark = AudioProcessingBenchmarker.benchmarkMuLawToPcm(10);

                expect(benchmark.functionName).toBe('muLawBufferToPcm16LE');
                expect(benchmark.iterations).toBe(10);
                expect(benchmark.totalTimeMs).toBeGreaterThan(0);
                expect(benchmark.avgTimeMicros).toBeGreaterThan(0);
                expect(benchmark.samplesPerSecond).toBeGreaterThan(0);
                expect(benchmark.memoryStats).toBeDefined();
            });

            it('should benchmark PCM to μ-law conversion', () => {
                const benchmark = AudioProcessingBenchmarker.benchmarkPcmToMuLaw(10);

                expect(benchmark.functionName).toBe('pcm16BufferToMuLaw');
                expect(benchmark.iterations).toBe(10);
                expect(benchmark.totalTimeMs).toBeGreaterThan(0);
            });

            it('should benchmark upsampling', () => {
                const benchmark = AudioProcessingBenchmarker.benchmarkUpsampling(10);

                expect(benchmark.functionName).toBe('upsample8kTo16k');
                expect(benchmark.iterations).toBe(10);
                expect(benchmark.totalTimeMs).toBeGreaterThan(0);
            });

            it('should run comprehensive benchmark', () => {
                const results = AudioProcessingBenchmarker.runComprehensiveBenchmark(5);

                expect(results).toHaveLength(3);
                expect(results[0].functionName).toBe('muLawBufferToPcm16LE');
                expect(results[1].functionName).toBe('pcm16BufferToMuLaw');
                expect(results[2].functionName).toBe('upsample8kTo16k');
            });
        });
    });

    describe('Memory Management', () => {
        it('should use buffer pool for allocations', () => {
            const initialStats = bufferPool.getStats();

            const muLawBuffer = createMuLawTestBuffer(160);
            const pcmBuffer = muLawBufferToPcm16LE(muLawBuffer);

            const afterStats = bufferPool.getStats();
            expect(afterStats.acquisitions).toBeGreaterThan(initialStats.acquisitions);

            // Release buffer back to pool
            bufferPool.release(pcmBuffer);

            const finalStats = bufferPool.getStats();
            expect(finalStats.releases).toBeGreaterThan(initialStats.releases);
        });

        it('should handle buffer pool exhaustion gracefully', () => {
            // Fill up the buffer pool
            const buffers = [];
            for (let i = 0; i < 25; i++) { // More than maxSize
                const buffer = muLawBufferToPcm16LE(createMuLawTestBuffer(160));
                buffers.push(buffer);
            }

            // Should still work even when pool is exhausted
            const result = muLawBufferToPcm16LE(createMuLawTestBuffer(160));
            expect(result.length).toBe(320);

            // Clean up
            buffers.forEach(buf => bufferPool.release(buf));
        });
    });

    describe('Edge Cases', () => {
        it('should handle very small buffers', () => {
            const tinyBuffer = Buffer.alloc(1);
            tinyBuffer[0] = 0x80;

            const result = muLawBufferToPcm16LE(tinyBuffer);
            expect(result.length).toBe(2);
        });

        it('should handle very large buffers', () => {
            const largeBuffer = createMuLawTestBuffer(8000); // 1 second at 8kHz
            const result = muLawBufferToPcm16LE(largeBuffer);
            expect(result.length).toBe(16000);
        });

        it('should handle malformed audio data gracefully', () => {
            // Test with random data
            const randomBuffer = Buffer.alloc(160);
            for (let i = 0; i < 160; i++) {
                randomBuffer[i] = Math.floor(Math.random() * 256);
            }

            // Should not throw
            const result = muLawBufferToPcm16LE(randomBuffer);
            expect(result.length).toBe(320);
        });
    });
});