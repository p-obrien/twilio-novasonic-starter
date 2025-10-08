/**
 * Unified Tracing Interface
 * 
 * Provides a consistent tracing API that automatically uses the best available
 * tracing method: OTEL (preferred) or X-Ray (Fargate fallback).
 */

import { safeTrace } from './safeTracing';
import { fargateXRayTracer, XRayTracing } from './xrayTracing';
import { isOtelAvailable, getActiveTracer } from './tracing';
import { smartSampler } from './smartSampling';
import logger from './logger';

export interface UnifiedSpan {
  setStatus(status: { code: number; message?: string }): void;
  recordException(error: Error): void;
  setAttributes(attributes: Record<string, string | number | boolean>): void;
  addEvent(name: string, attributes?: Record<string, any>): void;
  end(): void;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentId?: string;
}

class UnifiedTracingService {
  /**
   * Start a span using the best available tracing method
   */
  public startSpan(
    operationName: string,
    options?: {
      attributes?: Record<string, string | number | boolean>;
      callSid?: string;
      parentSpan?: any;
    }
  ): UnifiedSpan {
    const activeTracer = getActiveTracer();

    switch (activeTracer) {
      case 'otel':
        return this.createOTELSpan(operationName, options);
      
      case 'xray':
        return this.createXRaySpan(operationName, options);
      
      default:
        return this.createNoOpSpan(operationName, options);
    }
  }

  /**
   * Trace an async operation with automatic span management
   */
  public async traceAsync<T>(
    operationName: string,
    operation: (span: UnifiedSpan) => Promise<T>,
    options?: {
      attributes?: Record<string, string | number | boolean>;
      callSid?: string;
    }
  ): Promise<T> {
    const span = this.startSpan(operationName, options);
    
    try {
      const result = await operation(span);
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      span.setStatus({ code: 2, message: (error as Error).message }); // ERROR
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Trace a synchronous operation
   */
  public traceSync<T>(
    operationName: string,
    operation: (span: UnifiedSpan) => T,
    options?: {
      attributes?: Record<string, string | number | boolean>;
      callSid?: string;
    }
  ): T {
    const span = this.startSpan(operationName, options);
    
    try {
      const result = operation(span);
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      span.setStatus({ code: 2, message: (error as Error).message }); // ERROR
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Get current trace context for correlation
   */
  public getTraceContext(): TraceContext | null {
    const activeTracer = getActiveTracer();

    switch (activeTracer) {
      case 'otel':
        return this.getOTELTraceContext();
      
      case 'xray':
        return this.getXRayTraceContext();
      
      default:
        return null;
    }
  }

  /**
   * Add correlation information to logs
   */
  public addTraceContextToLog(logData: Record<string, any>): Record<string, any> {
    const traceContext = this.getTraceContext();
    
    if (traceContext) {
      return {
        ...logData,
        traceId: traceContext.traceId,
        spanId: traceContext.spanId,
        parentSpanId: traceContext.parentId
      };
    }

    return logData;
  }

  /**
   * Check if tracing is available
   */
  public isAvailable(): boolean {
    return getActiveTracer() !== 'none';
  }

  /**
   * Get the active tracing method
   */
  public getActiveMethod(): string {
    return getActiveTracer();
  }

  // Private methods for different tracing implementations

  private createOTELSpan(
    operationName: string,
    options?: {
      attributes?: Record<string, string | number | boolean>;
      callSid?: string;
      parentSpan?: any;
    }
  ): UnifiedSpan {
    const tracer = safeTrace.getTracer('twilio-bedrock-bridge');
    
    const otelSpan = safeTrace.isAvailable() 
      ? smartSampler.startSpanWithSampling(tracer as any, operationName, {
          attributes: options?.attributes || {},
          callSid: options?.callSid
        })
      : tracer.startSpan(operationName);

    return {
      setStatus: (status) => otelSpan.setStatus(status),
      recordException: (error) => otelSpan.recordException(error),
      setAttributes: (attributes) => otelSpan.setAttributes(attributes),
      addEvent: (name, attributes) => otelSpan.addEvent(name, attributes),
      end: () => otelSpan.end()
    };
  }

  private createXRaySpan(
    operationName: string,
    options?: {
      attributes?: Record<string, string | number | boolean>;
      callSid?: string;
    }
  ): UnifiedSpan {
    const segment = fargateXRayTracer.createSubsegment(operationName);
    
    // Add attributes as metadata
    if (options?.attributes && segment) {
      segment.addMetadata('attributes', options.attributes);
    }

    if (options?.callSid && segment) {
      segment.addAnnotation('call_sid', options.callSid);
    }

    return {
      setStatus: (status) => {
        if (segment && status.code === 2) {
          segment.addError(new Error(status.message || 'Operation failed'));
        }
      },
      recordException: (error) => {
        if (segment) {
          segment.addError(error);
        }
      },
      setAttributes: (attributes) => {
        if (segment) {
          Object.entries(attributes).forEach(([key, value]) => {
            segment.addAnnotation(key, value);
          });
        }
      },
      addEvent: (name, attributes) => {
        if (segment) {
          segment.addMetadata('events', { [name]: attributes });
        }
      },
      end: () => {
        if (segment) {
          segment.close();
        }
      }
    };
  }

  private createNoOpSpan(
    operationName: string,
    options?: {
      attributes?: Record<string, string | number | boolean>;
      callSid?: string;
    }
  ): UnifiedSpan {
    // Log the operation for debugging
    logger.debug('Tracing operation (no-op)', {
      operation: operationName,
      attributes: options?.attributes,
      callSid: options?.callSid
    });

    return {
      setStatus: () => {},
      recordException: (error) => {
        logger.error('Operation exception', { operation: operationName, error: error.message });
      },
      setAttributes: () => {},
      addEvent: () => {},
      end: () => {}
    };
  }

  private getOTELTraceContext(): TraceContext | null {
    try {
      const span = safeTrace.getActiveSpan();
      if (!span) return null;

      const spanContext = span.spanContext();
      return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId
      };
    } catch (error) {
      return null;
    }
  }

  private getXRayTraceContext(): TraceContext | null {
    const xrayContext = fargateXRayTracer.getTraceContext();
    if (!xrayContext) return null;

    return {
      traceId: xrayContext.traceId,
      spanId: xrayContext.segmentId,
      parentId: xrayContext.parentId
    };
  }
}

// Export singleton instance
export const unifiedTracing = new UnifiedTracingService();

// Convenience functions for common operations
export const UnifiedTracing = {
  // Audio processing
  traceAudioProcessing: async <T>(
    operation: string,
    callSid: string,
    fn: (span: UnifiedSpan) => Promise<T>
  ): Promise<T> => {
    return unifiedTracing.traceAsync(
      `audio.${operation}`,
      fn,
      {
        attributes: { operation, component: 'audio_processor' },
        callSid
      }
    );
  },

  // Bedrock requests
  traceBedrockRequest: async <T>(
    modelId: string,
    operation: string,
    fn: (span: UnifiedSpan) => Promise<T>
  ): Promise<T> => {
    return unifiedTracing.traceAsync(
      `bedrock.${operation}`,
      async (span) => {
        span.setAttributes({
          'bedrock.model_id': modelId,
          'bedrock.operation': operation,
          component: 'bedrock_client'
        });
        return fn(span);
      }
    );
  },

  // WebSocket operations
  traceWebSocketOperation: <T>(
    operation: string,
    callSid: string,
    fn: (span: UnifiedSpan) => T
  ): T => {
    return unifiedTracing.traceSync(
      `websocket.${operation}`,
      (span) => {
        span.setAttributes({
          'websocket.operation': operation,
          component: 'websocket_handler'
        });
        return fn(span);
      },
      { callSid }
    );
  },

  // Webhook handling
  traceWebhook: async <T>(
    callSid: string,
    accountSid: string,
    fn: (span: UnifiedSpan) => Promise<T>
  ): Promise<T> => {
    return unifiedTracing.traceAsync(
      'webhook.handle',
      async (span) => {
        span.setAttributes({
          'twilio.call_sid': callSid,
          'twilio.account_sid': accountSid,
          component: 'webhook_handler'
        });
        return fn(span);
      },
      { callSid }
    );
  }
};