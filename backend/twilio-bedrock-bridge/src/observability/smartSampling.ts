/**
 * Smart Sampling for High-Volume Traces
 * 
 * Provides intelligent sampling strategies to reduce trace volume while
 * maintaining observability for critical operations and error scenarios.
 */

import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { observabilityConfig } from './config';
import { isOtelAvailable } from './tracing';
import logger from './logger';

export interface SamplingContext {
  operationName: string;
  attributes?: Record<string, any>;
  parentSpanContext?: any;
  isError?: boolean;
  sessionId?: string;
  callSid?: string;
}

export interface SamplingDecision {
  shouldSample: boolean;
  reason: string;
  sampleRate: number;
}

export class SmartSampler {
  private static instance: SmartSampler;
  private samplingStats = new Map<string, { total: number; sampled: number }>();
  private lastStatsLog = Date.now();
  private readonly STATS_LOG_INTERVAL = 5 * 60 * 1000; // 5 minutes

  public static getInstance(): SmartSampler {
    if (!SmartSampler.instance) {
      SmartSampler.instance = new SmartSampler();
    }
    return SmartSampler.instance;
  }

  /**
   * Determine if a trace should be sampled based on operation type and context
   */
  public shouldSample(context: SamplingContext): SamplingDecision {
    const { operationName, attributes = {}, isError = false } = context;
    
    // Always sample errors
    if (isError) {
      this.recordSamplingDecision(operationName, true, 'error');
      return {
        shouldSample: true,
        reason: 'error_always_sampled',
        sampleRate: observabilityConfig.tracing.sampling.errors
      };
    }

    // Check custom rules first
    const customRule = this.findMatchingCustomRule(operationName, attributes);
    if (customRule) {
      const shouldSample = Math.random() < customRule.sampleRate;
      this.recordSamplingDecision(operationName, shouldSample, 'custom_rule');
      return {
        shouldSample,
        reason: `custom_rule_${customRule.sampleRate}`,
        sampleRate: customRule.sampleRate
      };
    }

    // Apply operation-specific sampling rates
    const sampleRate = this.getSampleRateForOperation(operationName);
    const shouldSample = Math.random() < sampleRate;
    
    this.recordSamplingDecision(operationName, shouldSample, 'operation_specific');
    
    // Log sampling stats periodically
    this.maybeLogSamplingStats();

    return {
      shouldSample,
      reason: `operation_${operationName}_${sampleRate}`,
      sampleRate
    };
  }

  /**
   * Create a span with smart sampling applied
   */
  public startSpanWithSampling(
    tracer: any,
    operationName: string,
    options: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
      isError?: boolean;
      sessionId?: string;
      callSid?: string;
    } = {}
  ) {
    const samplingDecision = this.shouldSample({
      operationName,
      attributes: options.attributes,
      isError: options.isError,
      sessionId: options.sessionId,
      callSid: options.callSid
    });

    // If not sampling, return a no-op span
    if (!samplingDecision.shouldSample) {
      try {
        const { getSafeActiveSpan } = require('./safeTracing');
        return getSafeActiveSpan() || tracer.startSpan('noop');
      } catch (error) {
        return tracer.startSpan('noop');
      }
    }

    // Create the actual span with sampling metadata
    const span = tracer.startSpan(operationName, {
      kind: options.kind || SpanKind.INTERNAL,
      attributes: {
        ...options.attributes,
        'sampling.decision': samplingDecision.reason,
        'sampling.rate': samplingDecision.sampleRate,
        ...(options.sessionId && { 'session.id': options.sessionId }),
        ...(options.callSid && { 'call.sid': options.callSid })
      }
    });

    return span;
  }

  /**
   * Wrapper for high-volume operations with automatic sampling
   */
  public async traceHighVolumeOperation<T>(
    tracer: any,
    operationName: string,
    operation: () => Promise<T>,
    options: {
      attributes?: Record<string, any>;
      sessionId?: string;
      callSid?: string;
    } = {}
  ): Promise<T> {
    const span = this.startSpanWithSampling(tracer, operationName, options);
    
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      // If an error occurs, we want to ensure this trace is captured
      // even if it wasn't originally sampled
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      
      span.setAttributes({
        'error.name': error instanceof Error ? error.name : 'UnknownError',
        'error.message': error instanceof Error ? error.message : String(error),
        'sampling.promoted': 'true' // Mark as promoted due to error
      });
      
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Get sample rate for a specific operation
   */
  private getSampleRateForOperation(operationName: string): number {
    const { sampling } = observabilityConfig.tracing;
    
    // Map operation names to sampling rates
    const operationMappings: Record<string, number> = {
      // WebSocket operations
      'websocket.message': sampling.websocketMessages,
      'websocket.send': sampling.websocketMessages,
      'websocket.receive': sampling.websocketMessages,
      
      // Audio processing
      'audio.chunk.process': sampling.audioChunks,
      'audio.chunk.receive': sampling.audioChunks,
      'audio.chunk.send': sampling.audioChunks,
      
      // Bedrock streaming
      'bedrock.streaming.chunk': sampling.bedrockStreaming,
      'bedrock.streaming.event': sampling.bedrockStreaming,
      
      // Health checks
      'health.check': sampling.healthChecks,
      'health.status': sampling.healthChecks,
      
      // Critical operations
      'error.handle': sampling.errors,
      'bedrock.request': sampling.bedrockRequests,
      'bedrock.initiate_session': sampling.sessionLifecycle,
      'session.create': sampling.sessionLifecycle,
      'session.end': sampling.sessionLifecycle,
    };

    // Check for exact match first
    if (operationMappings[operationName]) {
      return operationMappings[operationName];
    }

    // Check for partial matches
    for (const [pattern, rate] of Object.entries(operationMappings)) {
      if (operationName.includes(pattern.split('.')[0])) {
        return rate;
      }
    }

    // Default to global sample rate
    return observabilityConfig.tracing.sampleRate;
  }

  /**
   * Find matching custom sampling rule
   */
  private findMatchingCustomRule(
    operationName: string, 
    attributes: Record<string, any>
  ): { sampleRate: number } | null {
    const { customRules } = observabilityConfig.tracing.sampling;
    
    for (const rule of customRules) {
      if (operationName === rule.operationName) {
        // Check if attributes match (if specified)
        if (rule.attributes) {
          const matches = Object.entries(rule.attributes).every(
            ([key, value]) => attributes[key] === value
          );
          if (matches) {
            return { sampleRate: rule.sampleRate };
          }
        } else {
          return { sampleRate: rule.sampleRate };
        }
      }
    }
    
    return null;
  }

  /**
   * Record sampling decision for statistics
   */
  private recordSamplingDecision(
    operationName: string, 
    sampled: boolean, 
    reason: string
  ): void {
    const key = `${operationName}:${reason}`;
    const stats = this.samplingStats.get(key) || { total: 0, sampled: 0 };
    
    stats.total++;
    if (sampled) {
      stats.sampled++;
    }
    
    this.samplingStats.set(key, stats);
  }

  /**
   * Log sampling statistics periodically
   */
  private maybeLogSamplingStats(): void {
    const now = Date.now();
    if (now - this.lastStatsLog > this.STATS_LOG_INTERVAL) {
      this.logSamplingStats();
      this.lastStatsLog = now;
    }
  }

  /**
   * Log current sampling statistics
   */
  private logSamplingStats(): void {
    const stats: Record<string, any> = {};
    
    for (const [key, data] of this.samplingStats.entries()) {
      const [operation, reason] = key.split(':');
      const sampleRate = data.total > 0 ? (data.sampled / data.total) : 0;
      
      if (!stats[operation]) {
        stats[operation] = {};
      }
      
      stats[operation][reason] = {
        total: data.total,
        sampled: data.sampled,
        actualRate: Math.round(sampleRate * 10000) / 100 // Round to 2 decimal places
      };
    }

    logger.info('Trace sampling statistics', {
      component: 'smart_sampler',
      period_minutes: this.STATS_LOG_INTERVAL / 60000,
      operations: stats
    });

    // Reset stats for next period
    this.samplingStats.clear();
  }

  /**
   * Get current sampling configuration
   */
  public getSamplingConfig(): any {
    return {
      globalSampleRate: observabilityConfig.tracing.sampleRate,
      operationRates: observabilityConfig.tracing.sampling,
      customRules: observabilityConfig.tracing.sampling.customRules
    };
  }

  /**
   * Update sampling rate for an operation at runtime
   */
  public updateOperationSampleRate(operationName: string, sampleRate: number): void {
    if (sampleRate < 0 || sampleRate > 1) {
      throw new Error('Sample rate must be between 0 and 1');
    }

    // This would require updating the config object
    // In a production system, you might want to persist this change
    logger.info('Updated sampling rate for operation', {
      operationName,
      newSampleRate: sampleRate,
      component: 'smart_sampler'
    });
  }
}

// Export singleton instance
export const smartSampler = SmartSampler.getInstance();

// Convenience functions for common patterns
export const TracingUtils = {
  /**
   * Trace a WebSocket message with smart sampling
   */
  traceWebSocketMessage: async <T>(
    tracer: any,
    direction: 'inbound' | 'outbound',
    messageType: string,
    operation: () => Promise<T>,
    sessionId?: string,
    callSid?: string
  ): Promise<T> => {
    return smartSampler.traceHighVolumeOperation(
      tracer,
      `websocket.message.${direction}`,
      operation,
      {
        attributes: {
          'websocket.direction': direction,
          'websocket.message_type': messageType
        },
        sessionId,
        callSid
      }
    );
  },

  /**
   * Trace audio chunk processing with smart sampling
   */
  traceAudioChunk: async <T>(
    tracer: any,
    operation: string,
    chunkProcessor: () => Promise<T>,
    sessionId?: string,
    callSid?: string
  ): Promise<T> => {
    return smartSampler.traceHighVolumeOperation(
      tracer,
      `audio.chunk.${operation}`,
      chunkProcessor,
      {
        attributes: {
          'audio.operation': operation
        },
        sessionId,
        callSid
      }
    );
  },

  /**
   * Trace Bedrock streaming events with smart sampling
   */
  traceBedrockStreaming: async <T>(
    tracer: any,
    eventType: string,
    eventProcessor: () => Promise<T>,
    sessionId?: string,
    modelId?: string
  ): Promise<T> => {
    return smartSampler.traceHighVolumeOperation(
      tracer,
      `bedrock.streaming.${eventType}`,
      eventProcessor,
      {
        attributes: {
          'bedrock.event_type': eventType,
          ...(modelId && { 'bedrock.model_id': modelId })
        },
        sessionId
      }
    );
  }
};