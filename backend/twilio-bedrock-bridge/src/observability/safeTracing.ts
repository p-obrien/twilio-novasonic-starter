/**
 * Safe tracing utilities that gracefully handle OTEL failures
 * Provides fallback behavior when OTEL is not available or fails at runtime
 */

import { trace, Span, Tracer, SpanOptions, SpanStatusCode } from '@opentelemetry/api';
import { isOtelAvailable, isFallbackMode, enableFallbackMode } from './tracing';
import logger from './logger';

// Fallback span implementation that does nothing but maintains the interface
class FallbackSpan {
  setStatus(_status: { code: SpanStatusCode; message?: string }): void {
    // No-op
  }
  
  recordException(_exception: Error): void {
    // No-op
  }
  
  addEvent(_name: string, _attributes?: Record<string, any>): void {
    // No-op
  }
  
  end(): void {
    // No-op
  }
  
  spanContext() {
    return {
      traceId: 'fallback-trace-id',
      spanId: 'fallback-span-id',
      traceFlags: 0
    };
  }
}

// Safe tracer that handles OTEL failures gracefully
export class SafeTracer {
  private tracer: Tracer | null = null;
  private serviceName: string;
  
  constructor(serviceName: string = 'twilio-bedrock-bridge') {
    this.serviceName = serviceName;
    this.initializeTracer();
  }
  
  private initializeTracer(): void {
    if (isOtelAvailable() && !isFallbackMode()) {
      try {
        this.tracer = trace.getTracer(this.serviceName);
      } catch (error) {
        enableFallbackMode(`Failed to get tracer: ${error instanceof Error ? error.message : String(error)}`);
        this.tracer = null;
      }
    }
  }
  
  /**
   * Safely start a span with automatic fallback
   */
  startSpan(name: string, options?: SpanOptions): Span | FallbackSpan {
    if (!isOtelAvailable() || isFallbackMode() || !this.tracer) {
      return new FallbackSpan() as any;
    }
    
    try {
      return this.tracer.startSpan(name, options);
    } catch (error) {
      enableFallbackMode(`Failed to start span: ${error instanceof Error ? error.message : String(error)}`);
      return new FallbackSpan() as any;
    }
  }
  
  /**
   * Safely start an active span with automatic fallback
   */
  startActiveSpan<T>(
    name: string, 
    optionsOrFn: SpanOptions | ((span: Span) => T),
    fnOrContext?: ((span: Span) => T) | any,
    fn?: (span: Span) => T
  ): T {
    // Handle different overload signatures
    let options: SpanOptions = {};
    let callback: (span: Span) => T;
    
    if (typeof optionsOrFn === 'function') {
      callback = optionsOrFn;
    } else {
      options = optionsOrFn || {};
      callback = (fnOrContext || fn) as (span: Span) => T;
    }
    
    if (!isOtelAvailable() || isFallbackMode() || !this.tracer) {
      // Execute callback with fallback span
      return callback(new FallbackSpan() as any);
    }
    
    try {
      return this.tracer.startActiveSpan(name, options, callback);
    } catch (error) {
      enableFallbackMode(`Failed to start active span: ${error instanceof Error ? error.message : String(error)}`);
      logger.warn(`Tracing failed for ${name}, continuing without tracing`, { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return callback(new FallbackSpan() as any);
    }
  }
}

// Singleton safe tracer instance
export const safeTracer = new SafeTracer();

/**
 * Safe wrapper for getting the active span
 */
export function getSafeActiveSpan(): Span | null {
  if (!isOtelAvailable() || isFallbackMode()) {
    return null;
  }
  
  try {
    return trace.getActiveSpan() || null;
  } catch (error) {
    enableFallbackMode(`Failed to get active span: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Safe wrapper for trace operations with automatic fallback
 */
export const safeTrace = {
  /**
   * Get a safe tracer instance
   */
  getTracer(name: string = 'twilio-bedrock-bridge'): SafeTracer {
    return new SafeTracer(name);
  },
  
  /**
   * Get the active span safely
   */
  getActiveSpan(): Span | null {
    return getSafeActiveSpan();
  },
  
  /**
   * Check if tracing is available
   */
  isAvailable(): boolean {
    return isOtelAvailable() && !isFallbackMode();
  },
  
  /**
   * Get tracing status for debugging
   */
  getStatus(): { available: boolean; fallbackMode: boolean; error: Error | null } {
    const { getOtelError } = require('./tracing');
    return {
      available: isOtelAvailable(),
      fallbackMode: isFallbackMode(),
      error: getOtelError()
    };
  }
};