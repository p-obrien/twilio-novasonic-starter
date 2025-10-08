/**
 * AudioQualityAnalyzer - Comprehensive audio quality monitoring and analysis
 * 
 * This module provides real-time audio quality metrics for monitoring
 * audio processing performance, signal quality, and system health.
 * 
 * Key metrics:
 * - Signal analysis: RMS levels, peak detection, silence detection
 * - Buffer health: underruns, overruns, jitter analysis
 * - Processing quality: conversion accuracy, latency tracking
 * - Real-time performance: throughput, processing time
 */

import { metricsUtils } from '../observability/metrics';
import { CloudWatchMetrics } from '../observability/cloudWatchMetrics';
import logger from '../observability/logger';

export interface AudioQualityMetrics {
    // Signal Quality
    rmsLevel: number;           // Root Mean Square level (0-1)
    peakLevel: number;          // Peak amplitude level (0-1)
    silenceRatio: number;       // Percentage of silence (0-1)
    dynamicRange: number;       // Dynamic range in dB

    // Buffer Health
    bufferUnderruns: number;    // Number of buffer underruns
    bufferOverruns: number;     // Number of buffer overruns
    averageBufferLevel: number; // Average buffer fill level (0-1)
    jitterMs: number;           // Buffer level jitter in milliseconds

    // Processing Quality
    processingLatencyMs: number; // Processing latency
    conversionErrors: number;    // Number of conversion errors
    sampleRateAccuracy: number;  // Sample rate accuracy (0-1)

    // Performance
    throughputBytesPerSec: number; // Audio throughput
    cpuUsagePercent: number;       // CPU usage for audio processing
}

export class AudioQualityAnalyzer {
    private static instance: AudioQualityAnalyzer;
    private sessionMetrics = new Map<string, SessionAudioMetrics>();

    // Analysis parameters
    private readonly SILENCE_THRESHOLD = 0.01; // RMS threshold for silence detection
    private readonly ANALYSIS_WINDOW_MS = 1000; // Analysis window size
    private readonly MAX_SESSIONS = 100; // Prevent memory leaks

    private constructor() {
        // Periodic cleanup and reporting
        // Disable background timers during tests to avoid async work after Jest teardown.
        if (process.env.NODE_ENV !== 'test') {
            setInterval(() => {
                this.cleanupInactiveSessions();
                this.reportAggregateMetrics();
            }, 30000); // Every 30 seconds
        }
    }

    public static getInstance(): AudioQualityAnalyzer {
        if (!AudioQualityAnalyzer.instance) {
            AudioQualityAnalyzer.instance = new AudioQualityAnalyzer();
        }
        return AudioQualityAnalyzer.instance;
    }

    /**
     * Analyze audio quality for a given session and audio chunk
     */
    public analyzeAudioChunk(
        sessionId: string,
        audioData: Buffer,
        sampleRate: number = 8000,
        operation: string = 'process',
        callSid?: string
    ): AudioQualityMetrics {
        const startTime = Date.now();

        // Get or create session metrics
        let sessionMetrics = this.sessionMetrics.get(sessionId);
        if (!sessionMetrics) {
            sessionMetrics = new SessionAudioMetrics(sessionId, callSid);
            this.sessionMetrics.set(sessionId, sessionMetrics);

            // Prevent memory leaks
            if (this.sessionMetrics.size > this.MAX_SESSIONS) {
                this.cleanupOldestSession();
            }
        }

        // Analyze the audio chunk
        const signalAnalysis = this.analyzeSignalQuality(audioData, sampleRate);
        const bufferHealth = sessionMetrics.analyzeBufferHealth();
        const processingLatency = Date.now() - startTime;

        // Update session metrics
        sessionMetrics.updateMetrics(signalAnalysis, processingLatency, audioData.length);

        // Create comprehensive metrics
        const metrics: AudioQualityMetrics = {
            // Signal Quality
            rmsLevel: signalAnalysis.rmsLevel,
            peakLevel: signalAnalysis.peakLevel,
            silenceRatio: signalAnalysis.silenceRatio,
            dynamicRange: signalAnalysis.dynamicRange,

            // Buffer Health
            bufferUnderruns: sessionMetrics.bufferUnderruns,
            bufferOverruns: sessionMetrics.bufferOverruns,
            averageBufferLevel: sessionMetrics.getAverageBufferLevel(),
            jitterMs: sessionMetrics.getJitterMs(),

            // Processing Quality
            processingLatencyMs: processingLatency,
            conversionErrors: sessionMetrics.conversionErrors,
            sampleRateAccuracy: sessionMetrics.getSampleRateAccuracy(sampleRate),

            // Performance
            throughputBytesPerSec: sessionMetrics.getThroughput(),
            cpuUsagePercent: this.estimateCpuUsage(processingLatency, audioData.length)
        };

        // Record metrics to observability system
        this.recordMetrics(sessionId, operation, metrics, callSid);

        return metrics;
    }

    /**
     * Analyze signal quality of audio data
     */
    private analyzeSignalQuality(audioData: Buffer, sampleRate: number) {
        const samples = this.convertToSamples(audioData);

        // Calculate RMS level
        let sumSquares = 0;
        let peakLevel = 0;
        let silentSamples = 0;

        for (const sample of samples) {
            const normalizedSample = Math.abs(sample) / 32768; // Normalize to 0-1
            sumSquares += normalizedSample * normalizedSample;
            peakLevel = Math.max(peakLevel, normalizedSample);

            if (normalizedSample < this.SILENCE_THRESHOLD) {
                silentSamples++;
            }
        }

        const rmsLevel = Math.sqrt(sumSquares / samples.length);
        const silenceRatio = silentSamples / samples.length;

        // Calculate dynamic range (simplified)
        const dynamicRange = peakLevel > 0 ? 20 * Math.log10(peakLevel / Math.max(rmsLevel, 0.001)) : 0;

        return {
            rmsLevel,
            peakLevel,
            silenceRatio,
            dynamicRange: Math.max(0, Math.min(60, dynamicRange)) // Clamp to reasonable range
        };
    }

    /**
     * Convert audio buffer to normalized samples
     */
    private convertToSamples(audioData: Buffer): number[] {
        const samples: number[] = [];

        // Assume 16-bit PCM for now (can be enhanced for μ-law)
        for (let i = 0; i < audioData.length - 1; i += 2) {
            const sample = audioData.readInt16LE(i);
            samples.push(sample);
        }

        return samples;
    }

    /**
     * Estimate CPU usage based on processing time and data size
     */
    private estimateCpuUsage(processingTimeMs: number, dataSize: number): number {
        // Simple heuristic: processing time vs expected time for data size
        const expectedTimeMs = (dataSize / 8000) * 1000; // Assume 8kHz, 1 byte per sample
        const cpuRatio = processingTimeMs / Math.max(expectedTimeMs, 1);
        return Math.min(100, cpuRatio * 100); // Cap at 100%
    }

    /**
     * Record metrics to observability system
     */
    private recordMetrics(
        sessionId: string,
        operation: string,
        metrics: AudioQualityMetrics,
        callSid?: string
    ): void {
        // Safely record to OTEL / fallback metrics if available
        try {
            if (typeof metricsUtils !== 'undefined' && metricsUtils && typeof metricsUtils.recordAudioProcessing === 'function') {
                metricsUtils.recordAudioProcessing(
                    operation,
                    metrics.processingLatencyMs / 1000,
                    0, // chunk size recorded separately
                    undefined,
                    callSid
                );
            }
        } catch (err) {
            logger.debug('Failed to record audio processing metric', { sessionId, error: err instanceof Error ? err.message : String(err) });
        }
    
        // Record additional quality metrics (guarded to avoid crashes in tests)
        const labels = {
            session_id: sessionId,
            operation,
            call_sid: callSid || 'unknown'
        };
    
        const safeRecordCustom = (name: string, value: number | string) => {
            try {
                if (typeof metricsUtils !== 'undefined' && metricsUtils && typeof metricsUtils.recordCustomMetric === 'function') {
                    metricsUtils.recordCustomMetric(name, typeof value === 'number' ? value : Number(value), labels);
                }
            } catch (err) {
                logger.debug('Failed to record custom metric', { metric: name, error: err instanceof Error ? err.message : String(err) });
            }
        };
    
        // Signal quality metrics
        safeRecordCustom('audio_rms_level', metrics.rmsLevel);
        safeRecordCustom('audio_peak_level', metrics.peakLevel);
        safeRecordCustom('audio_silence_ratio', metrics.silenceRatio);
        safeRecordCustom('audio_dynamic_range_db', metrics.dynamicRange);
    
        // Buffer health metrics
        safeRecordCustom('audio_buffer_underruns', metrics.bufferUnderruns);
        safeRecordCustom('audio_buffer_overruns', metrics.bufferOverruns);
        safeRecordCustom('audio_buffer_level', metrics.averageBufferLevel);
        safeRecordCustom('audio_jitter_ms', metrics.jitterMs);
    
        // Processing quality metrics
        safeRecordCustom('audio_processing_latency_ms', metrics.processingLatencyMs);
        safeRecordCustom('audio_conversion_errors', metrics.conversionErrors);
        safeRecordCustom('audio_sample_rate_accuracy', metrics.sampleRateAccuracy);
    
        // Performance metrics
        safeRecordCustom('audio_throughput_bytes_per_sec', metrics.throughputBytesPerSec);
        safeRecordCustom('audio_cpu_usage_percent', metrics.cpuUsagePercent);
    
        // Send comprehensive audio quality metrics to CloudWatch (safe invocation)
        try {
            CloudWatchMetrics.audioQuality(
                sessionId,
                operation,
                metrics.rmsLevel,
                metrics.peakLevel,
                metrics.silenceRatio,
                metrics.dynamicRange,
                metrics.bufferUnderruns,
                metrics.bufferOverruns,
                metrics.jitterMs,
                metrics.processingLatencyMs,
                metrics.throughputBytesPerSec,
                callSid
            );
        } catch (err) {
            logger.debug('Failed to send CloudWatch audio quality metrics', { sessionId, error: err instanceof Error ? err.message : String(err) });
        }
    
        // Log significant quality issues
        if (metrics.silenceRatio > 0.8) {
            logger.warn('High silence ratio detected', { sessionId, silenceRatio: metrics.silenceRatio });
        }
    
        if (metrics.bufferUnderruns > 0 || metrics.bufferOverruns > 0) {
            logger.warn('Buffer issues detected', {
                sessionId,
                underruns: metrics.bufferUnderruns,
                overruns: metrics.bufferOverruns
            });
        }
    
        if (metrics.processingLatencyMs > 100) {
            logger.warn('High processing latency detected', {
                sessionId,
                latencyMs: metrics.processingLatencyMs
            });
        }
    }

    /**
     * Get current metrics for a session
     */
    public getSessionMetrics(sessionId: string): AudioQualityMetrics | null {
        const sessionMetrics = this.sessionMetrics.get(sessionId);
        return sessionMetrics ? sessionMetrics.getCurrentMetrics() : null;
    }

    /**
     * Report buffer event (underrun/overrun)
     */
    public reportBufferEvent(sessionId: string, eventType: 'underrun' | 'overrun', bufferLevel: number): void {
        const sessionMetrics = this.sessionMetrics.get(sessionId);
        if (sessionMetrics) {
            sessionMetrics.reportBufferEvent(eventType, bufferLevel);
        }
    }

    /**
     * Clean up inactive sessions
     */
    private cleanupInactiveSessions(): void {
        const now = Date.now();
        const inactiveThreshold = 5 * 60 * 1000; // 5 minutes

        for (const [sessionId, metrics] of this.sessionMetrics.entries()) {
            if (now - metrics.lastActivity > inactiveThreshold) {
                this.sessionMetrics.delete(sessionId);
                logger.debug('Cleaned up inactive audio quality session', { sessionId });
            }
        }
    }

    /**
     * Clean up oldest session to prevent memory leaks
     */
    private cleanupOldestSession(): void {
        let oldestSessionId: string | null = null;
        let oldestTime = Date.now();

        for (const [sessionId, metrics] of this.sessionMetrics.entries()) {
            if (metrics.lastActivity < oldestTime) {
                oldestTime = metrics.lastActivity;
                oldestSessionId = sessionId;
            }
        }

        if (oldestSessionId) {
            this.sessionMetrics.delete(oldestSessionId);
            logger.debug('Cleaned up oldest audio quality session', { sessionId: oldestSessionId });
        }
    }

    /**
     * Report aggregate metrics across all sessions
     */
    private reportAggregateMetrics(): void {
        if (this.sessionMetrics.size === 0) return;
    
        let totalSessions = 0;
        let totalUnderruns = 0;
        let totalOverruns = 0;
        let avgLatency = 0;
        let avgThroughput = 0;
    
        for (const metrics of this.sessionMetrics.values()) {
            totalSessions++;
            totalUnderruns += metrics.bufferUnderruns;
            totalOverruns += metrics.bufferOverruns;
            avgLatency += metrics.getAverageLatency();
            avgThroughput += metrics.getThroughput();
        }
    
        avgLatency /= totalSessions;
        avgThroughput /= totalSessions;
    
        // Safely record aggregate metrics
        const safeRecord = (name: string, value: number) => {
            try {
                if (typeof metricsUtils !== 'undefined' && metricsUtils && typeof metricsUtils.recordCustomMetric === 'function') {
                    metricsUtils.recordCustomMetric(name, value, {});
                }
            } catch (err) {
                logger.debug('Failed to record aggregate metric', { metric: name, error: err instanceof Error ? err.message : String(err) });
            }
        };
    
        safeRecord('audio_active_sessions', totalSessions);
        safeRecord('audio_total_underruns', totalUnderruns);
        safeRecord('audio_total_overruns', totalOverruns);
        safeRecord('audio_avg_latency_ms', avgLatency);
        safeRecord('audio_avg_throughput_bytes_per_sec', avgThroughput);
    
        logger.debug('Audio quality aggregate metrics', {
            activeSessions: totalSessions,
            totalUnderruns,
            totalOverruns,
            avgLatencyMs: avgLatency,
            avgThroughputBps: avgThroughput
        });
    }
}

/**
 * Per-session audio metrics tracking
 */
class SessionAudioMetrics {
    public bufferUnderruns = 0;
    public bufferOverruns = 0;
    public conversionErrors = 0;
    public lastActivity = Date.now();

    private bufferLevels: number[] = [];
    private latencies: number[] = [];
    private throughputSamples: Array<{ timestamp: number; bytes: number }> = [];
    private expectedSampleRate = 8000;
    private actualSampleRate = 8000;

    constructor(
        public readonly sessionId: string,
        public readonly callSid?: string
    ) { }

    updateMetrics(signalAnalysis: any, latency: number, dataSize: number): void {
        this.lastActivity = Date.now();
        this.latencies.push(latency);
        this.throughputSamples.push({ timestamp: this.lastActivity, bytes: dataSize });

        // Keep only recent samples
        const maxSamples = 100;
        if (this.latencies.length > maxSamples) {
            this.latencies = this.latencies.slice(-maxSamples);
        }
        if (this.throughputSamples.length > maxSamples) {
            this.throughputSamples = this.throughputSamples.slice(-maxSamples);
        }
    }

    analyzeBufferHealth() {
        // This would be enhanced with actual buffer monitoring
        return {
            currentLevel: 0.5, // Placeholder
            jitter: this.getJitterMs()
        };
    }

    reportBufferEvent(eventType: 'underrun' | 'overrun', bufferLevel: number): void {
        if (eventType === 'underrun') {
            this.bufferUnderruns++;
        } else {
            this.bufferOverruns++;
        }

        this.bufferLevels.push(bufferLevel);
        if (this.bufferLevels.length > 100) {
            this.bufferLevels = this.bufferLevels.slice(-100);
        }
    }

    getAverageBufferLevel(): number {
        if (this.bufferLevels.length === 0) return 0.5; // Default
        return this.bufferLevels.reduce((sum, level) => sum + level, 0) / this.bufferLevels.length;
    }

    getJitterMs(): number {
        if (this.bufferLevels.length < 2) return 0;

        let jitter = 0;
        for (let i = 1; i < this.bufferLevels.length; i++) {
            jitter += Math.abs(this.bufferLevels[i] - this.bufferLevels[i - 1]);
        }

        return (jitter / (this.bufferLevels.length - 1)) * 1000; // Convert to ms
    }

    getSampleRateAccuracy(expectedRate: number): number {
        this.expectedSampleRate = expectedRate;
        // This would be enhanced with actual sample rate measurement
        return Math.min(1.0, this.actualSampleRate / this.expectedSampleRate);
    }

    getThroughput(): number {
        if (this.throughputSamples.length < 2) return 0;

        const now = Date.now();
        const recentSamples = this.throughputSamples.filter(s => now - s.timestamp < 10000); // Last 10 seconds

        if (recentSamples.length < 2) return 0;

        const totalBytes = recentSamples.reduce((sum, s) => sum + s.bytes, 0);
        const timeSpanMs = recentSamples[recentSamples.length - 1].timestamp - recentSamples[0].timestamp;

        return timeSpanMs > 0 ? (totalBytes * 1000) / timeSpanMs : 0; // bytes per second
    }

    getAverageLatency(): number {
        if (this.latencies.length === 0) return 0;
        return this.latencies.reduce((sum, lat) => sum + lat, 0) / this.latencies.length;
    }

    getCurrentMetrics(): AudioQualityMetrics {
        return {
            rmsLevel: 0, // Would be filled by latest analysis
            peakLevel: 0,
            silenceRatio: 0,
            dynamicRange: 0,
            bufferUnderruns: this.bufferUnderruns,
            bufferOverruns: this.bufferOverruns,
            averageBufferLevel: this.getAverageBufferLevel(),
            jitterMs: this.getJitterMs(),
            processingLatencyMs: this.getAverageLatency(),
            conversionErrors: this.conversionErrors,
            sampleRateAccuracy: this.getSampleRateAccuracy(this.expectedSampleRate),
            throughputBytesPerSec: this.getThroughput(),
            cpuUsagePercent: 0 // Would be calculated
        };
    }
}

// Export singleton instance
export const audioQualityAnalyzer = AudioQualityAnalyzer.getInstance();