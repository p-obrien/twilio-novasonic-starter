/**
 * Custom Bedrock Observability
 * 
 * Provides streaming-aware observability for Bedrock interactions
 * since the default OpenTelemetry instrumentation doesn't handle
 * bidirectional streaming properly.
 */

import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import logger from './logger';
import { applicationMetrics, metricsUtils } from './metrics';
import { CloudWatchMetrics } from './cloudWatchMetrics';
import { cloudWatchBatcher } from './cloudWatchBatcher';
import { smartSampler, TracingUtils } from './smartSampling';

interface BedrockSessionMetrics {
    sessionId: string;
    modelId: string;
    startTime: number;
    endTime?: number;
    eventsProcessed: number;
    audioChunksReceived: number;
    textTokensReceived: number;
    errors: number;
    status: 'active' | 'completed' | 'error';
}

class BedrockObservability {
    private sessions = new Map<string, BedrockSessionMetrics>();
    private tracer: any;
    private readonly MAX_SESSIONS = 1000; // Prevent memory leaks
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        // Initialize safe tracer
        try {
            const { safeTrace } = require('./safeTracing');
            this.tracer = safeTrace.getTracer('bedrock-streaming');
        } catch (error) {
            // Fallback to no-op tracer
            this.tracer = {
                startActiveSpan: (name: string, fn: any) => fn({ setStatus: () => {}, recordException: () => {}, end: () => {} })
            };
        }
        
        // Periodic cleanup of stale sessions
        this.cleanupInterval = setInterval(() => {
            this.cleanupStaleSessions();
        }, 300000); // 5 minutes
    }

    /**
     * Cleanup stale sessions to prevent memory leaks
     */
    private cleanupStaleSessions(): void {
        const now = Date.now();
        const staleThreshold = 30 * 60 * 1000; // 30 minutes
        
        for (const [sessionId, metrics] of this.sessions.entries()) {
            if (now - metrics.startTime > staleThreshold && metrics.status === 'active') {
                logger.warn('Cleaning up stale session', { sessionId, age: now - metrics.startTime });
                this.completeSession(sessionId, 'timeout');
            }
        }
        
        // If we still have too many sessions, remove oldest completed ones
        if (this.sessions.size > this.MAX_SESSIONS) {
            const completed = Array.from(this.sessions.entries())
                .filter(([_, metrics]) => metrics.status !== 'active')
                .sort(([_, a], [__, b]) => (a.endTime || 0) - (b.endTime || 0));
            
            const toRemove = completed.slice(0, completed.length - this.MAX_SESSIONS + 100);
            toRemove.forEach(([sessionId]) => this.sessions.delete(sessionId));
            
            if (toRemove.length > 0) {
                logger.info('Cleaned up old completed sessions', { count: toRemove.length });
            }
        }
    }

    /**
     * Start tracking a new Bedrock session
     */
    startSession(sessionId: string, modelId?: string) {
        // Import config here to avoid circular dependencies
        const { config } = require('../config/AppConfig');
        const actualModelId = modelId || config.bedrock.modelId;
        const metrics: BedrockSessionMetrics = {
            sessionId,
            modelId: actualModelId,
            startTime: Date.now(),
            eventsProcessed: 0,
            audioChunksReceived: 0,
            textTokensReceived: 0,
            errors: 0,
            status: 'active'
        };

        this.sessions.set(sessionId, metrics);

        // Create OpenTelemetry span for the session with smart sampling
        const span = smartSampler.startSpanWithSampling(
            this.tracer,
            'bedrock.streaming.session',
            {
                kind: SpanKind.CLIENT,
                attributes: {
                    'bedrock.model_id': actualModelId,
                    'bedrock.session_id': sessionId,
                    'bedrock.operation': 'bidirectional_stream'
                },
                sessionId
            }
        );

        // Store span reference for later completion
        (metrics as any).span = span;

        // Record OpenTelemetry metrics
        applicationMetrics.bedrockRequestsTotal.add(1, { model_id: actualModelId, operation: 'streaming_session' });

        logger.info('Bedrock session started', {
            sessionId,
            modelId: actualModelId,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Record an event processed in the session with smart sampling
     */
    recordEvent(sessionId: string, eventType: string, eventData?: any) {
        const metrics = this.sessions.get(sessionId);
        if (!metrics) return;

        metrics.eventsProcessed++;

        // Track specific event types
        if (eventType === 'audioOutput') {
            metrics.audioChunksReceived++;
        } else if (eventType === 'textOutput') {
            metrics.textTokensReceived += eventData?.text?.length || 0;
        }

        // Update span attributes
        const span = (metrics as any).span;
        if (span) {
            span.setAttributes({
                'bedrock.events_processed': metrics.eventsProcessed,
                'bedrock.audio_chunks_received': metrics.audioChunksReceived,
                'bedrock.text_tokens_received': metrics.textTokensReceived
            });
        }

        // Use smart sampling for high-volume streaming events
        const samplingDecision = smartSampler.shouldSample({
            operationName: `bedrock.streaming.${eventType}`,
            attributes: {
                'bedrock.event_type': eventType,
                'bedrock.model_id': metrics.modelId
            },
            sessionId
        });

        // Only create detailed event spans for sampled events
        if (samplingDecision.shouldSample) {
            const eventSpan = smartSampler.startSpanWithSampling(
                this.tracer,
                `bedrock.streaming.event.${eventType}`,
                {
                    kind: SpanKind.CLIENT,
                    attributes: {
                        'bedrock.event_type': eventType,
                        'bedrock.model_id': metrics.modelId,
                        'bedrock.session_id': sessionId,
                        'bedrock.event_sequence': metrics.eventsProcessed,
                        ...(eventData && { 'bedrock.event_data_size': JSON.stringify(eventData).length })
                    },
                    sessionId
                }
            );
            eventSpan.end();
        }

        // Record OpenTelemetry metrics (always record metrics, sampling only affects traces)
        if (eventType === 'audioOutput') {
            applicationMetrics.audioChunksProcessed.add(1, { operation: 'bedrock_output' });
        } else if (eventType === 'textOutput') {
            applicationMetrics.bedrockTokensOutput.add(eventData?.text?.length || 1, { model_id: metrics.modelId });
        }

        logger.debug('Bedrock event processed', {
            sessionId,
            eventType,
            totalEvents: metrics.eventsProcessed
        });
    }

    /**
     * Record an error in the session
     */
    recordError(sessionId: string, error: Error | string, context?: any) {
        const metrics = this.sessions.get(sessionId);
        if (!metrics) return;

        metrics.errors++;
        metrics.status = 'error';

        const span = (metrics as any).span;
        if (span) {
            span.recordException(error instanceof Error ? error : new Error(error));
            span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : error });
            span.setAttributes({
                'bedrock.errors': metrics.errors
            });
        }

        // Record OpenTelemetry metrics
        applicationMetrics.bedrockErrors.add(1, { 
            model_id: metrics.modelId, 
            error_type: error instanceof Error ? error.name : 'unknown' 
        });

        logger.error('Bedrock session error', {
            sessionId,
            error: error instanceof Error ? error.message : error,
            context,
            totalErrors: metrics.errors
        });
    }

    /**
     * Complete a Bedrock session
     */
    completeSession(sessionId: string, reason: 'completed' | 'timeout' | 'error' = 'completed') {
        const metrics = this.sessions.get(sessionId);
        if (!metrics) return;

        metrics.endTime = Date.now();
        metrics.status = reason === 'completed' ? 'completed' : 'error';

        const duration = metrics.endTime - metrics.startTime;
        const span = (metrics as any).span;

        if (span) {
            span.setAttributes({
                'bedrock.duration_ms': duration,
                'bedrock.completion_reason': reason,
                'bedrock.final_status': metrics.status
            });

            if (reason === 'completed') {
                span.setStatus({ code: SpanStatusCode.OK });
            } else {
                span.setStatus({ code: SpanStatusCode.ERROR, message: `Session ended: ${reason}` });
            }

            span.end();
        }

        logger.info('Bedrock session completed', {
            sessionId,
            duration,
            reason,
            eventsProcessed: metrics.eventsProcessed,
            audioChunksReceived: metrics.audioChunksReceived,
            textTokensReceived: metrics.textTokensReceived,
            errors: metrics.errors
        });

        // Record OpenTelemetry metrics
        applicationMetrics.bedrockRequestDuration.record(duration / 1000, { 
            model_id: metrics.modelId, 
            operation: 'streaming_session',
            success: (reason === 'completed').toString()
        });

        // Send custom metrics to CloudWatch (batched)
        this.sendCloudWatchMetrics(metrics, duration);

        // Clean up session data
        this.sessions.delete(sessionId);
    }

    /**
     * Get current session metrics
     */
    getSessionMetrics(sessionId: string): BedrockSessionMetrics | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Get all active sessions
     */
    getActiveSessions(): BedrockSessionMetrics[] {
        return Array.from(this.sessions.values()).filter(s => s.status === 'active');
    }

    /**
     * Record usage information when available
     */
    recordUsage(sessionId: string, usage: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    }) {
        const metrics = this.sessions.get(sessionId);
        if (!metrics) return;

        const span = (metrics as any).span;
        if (span) {
            span.setAttributes({
                'bedrock.input_tokens': usage.inputTokens || 0,
                'bedrock.output_tokens': usage.outputTokens || 0,
                'bedrock.total_tokens': usage.totalTokens || 0
            });
        }

        // Record the actual metrics
        if (usage.inputTokens !== undefined) {
            applicationMetrics.bedrockTokensInput.add(usage.inputTokens, { 
                model_id: metrics.modelId, 
                operation: 'streaming_session' 
            });
        }
        
        if (usage.outputTokens !== undefined) {
            applicationMetrics.bedrockTokensOutput.add(usage.outputTokens, { 
                model_id: metrics.modelId, 
                operation: 'streaming_session' 
            });
        }

        // Also send to CloudWatch
        if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
            CloudWatchMetrics.bedrockRequest(
                metrics.modelId, 
                'streaming_session', 
                0, // duration not available here
                true, 
                usage.inputTokens, 
                usage.outputTokens
            );
        }

        logger.info('Bedrock usage recorded', {
            sessionId,
            ...usage
        });
    }

    /**
     * Shutdown observability and cleanup resources
     */
    shutdown(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.sessions.clear();
    }

    /**
     * Send custom metrics to CloudWatch using batched approach
     */
    private sendCloudWatchMetrics(metrics: BedrockSessionMetrics, duration: number) {
        try {
            logger.debug('Adding CloudWatch metrics to batch', {
                sessionId: metrics.sessionId,
                metricsCount: 4
            });

            // Add metrics to the batch instead of sending immediately
            cloudWatchBatcher.addMetrics([
                {
                    metricName: 'SessionDuration',
                    value: duration,
                    unit: 'Milliseconds',
                    dimensions: [
                        { Name: 'ModelId', Value: metrics.modelId },
                        { Name: 'Status', Value: metrics.status }
                    ]
                },
                {
                    metricName: 'AudioChunksReceived',
                    value: metrics.audioChunksReceived,
                    unit: 'Count',
                    dimensions: [
                        { Name: 'ModelId', Value: metrics.modelId }
                    ]
                },
                {
                    metricName: 'EventsProcessed',
                    value: metrics.eventsProcessed,
                    unit: 'Count',
                    dimensions: [
                        { Name: 'ModelId', Value: metrics.modelId }
                    ]
                },
                {
                    metricName: 'SessionErrors',
                    value: metrics.errors,
                    unit: 'Count',
                    dimensions: [
                        { Name: 'ModelId', Value: metrics.modelId }
                    ]
                }
            ]);

            logger.debug('CloudWatch metrics added to batch successfully', {
                sessionId: metrics.sessionId,
                batchSize: cloudWatchBatcher.getBatchSize()
            });
        } catch (error) {
            logger.error('Failed to add CloudWatch metrics to batch', { 
                sessionId: metrics.sessionId,
                error: error instanceof Error ? error.message : String(error),
                errorName: error instanceof Error ? error.name : 'unknown'
            });
        }
    }
}

// Export singleton instance
export const bedrockObservability = new BedrockObservability();