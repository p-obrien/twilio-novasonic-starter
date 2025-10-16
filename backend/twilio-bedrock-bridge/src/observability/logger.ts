import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import * as util from 'util';
import { CorrelationIdManager } from '../utils/correlationId';
import { isOtelAvailable, isFallbackMode } from './tracing';

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

const LEVEL_PRIORITIES: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

/**
 * Determine current log level dynamically. Tests set process.env.LOG_LEVEL in
 * beforeEach, and some consumers expect logger to respect env changes at runtime.
 * For production use this is inexpensive; for very hot paths we cache in-memory.
 */
function getCurrentLevel(): LogLevel {
  const rawLevel = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
  return (['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'].includes(rawLevel) ? (rawLevel as LogLevel) : 'INFO');
}

function isLevelEnabled(level: LogLevel): boolean {
  const current = getCurrentLevel();
  return LEVEL_PRIORITIES[level] <= LEVEL_PRIORITIES[current];
}

// Cache for trace context to avoid repeated expensive operations
let cachedTraceContext: any = null;
let lastContextCheck = 0;
const CONTEXT_CACHE_TTL = 100; // Cache for 100ms to reduce overhead

// Function to clear trace context cache
function clearTraceContextCache(): void {
  cachedTraceContext = null;
  lastContextCheck = 0;
}

function getTraceContext() {
  const now = Date.now();
  
  // Use cached context if it's recent enough (for high-frequency operations)
  if (cachedTraceContext && (now - lastContextCheck) < CONTEXT_CACHE_TTL) {
    return cachedTraceContext;
  }
  
  const traceContext: any = {};
  
  // Always get correlation context (this works independently of OTEL)
  const correlationContext = CorrelationIdManager.getCurrentContext();
  if (correlationContext) {
    // Use object spread for better performance than individual assignments
    Object.assign(traceContext, {
      correlationId: correlationContext.correlationId,
      source: correlationContext.source,
      ...(correlationContext.callSid && { callSid: correlationContext.callSid }),
      ...(correlationContext.sessionId && { sessionId: correlationContext.sessionId }),
      ...(correlationContext.accountSid && { accountSid: correlationContext.accountSid }),
      ...(correlationContext.streamSid && { streamSid: correlationContext.streamSid }),
      ...(correlationContext.parentCorrelationId && { parentCorrelationId: correlationContext.parentCorrelationId })
    });
  }
  
  // Only add OTEL trace information if available and working
  if (isOtelAvailable() && !isFallbackMode()) {
    try {
      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        const spanContext = activeSpan.spanContext();
        Object.assign(traceContext, {
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
          traceFlags: spanContext.traceFlags
        });
      }
    } catch (error) {
      // OTEL failed at runtime - enable fallback mode
      const { enableFallbackMode } = require('./tracing');
      enableFallbackMode(`OTEL runtime error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Cache the result for high-frequency operations
  cachedTraceContext = traceContext;
  lastContextCheck = now;
  
  return traceContext;
}

function formatMessage(level: LogLevel, message: any, meta?: any) {
  const ts = new Date().toISOString();
  const traceContext = getTraceContext();
  const body = typeof message === 'string' ? message : util.inspect(message, { depth: 4 });
  
  const logEntry = {
    timestamp: ts,
    level,
    message: body,
    ...traceContext,
    ...(meta && { meta: typeof meta === 'string' ? meta : meta })
  };

  // For CloudWatch structured logging
  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify(logEntry);
  }
  
  // For development - human readable
  let out = `[${ts}] [${level}]`;
  
  // Add correlation ID (prioritized over trace ID for readability)
  if (traceContext.correlationId) {
    out += ` [corr:${traceContext.correlationId.slice(-12)}]`;
  } else if (traceContext.traceId) {
    out += ` [trace:${traceContext.traceId.slice(-8)}]`;
  }
  
  // Add call context for Twilio operations
  if (traceContext.callSid) {
    out += ` [call:${traceContext.callSid.slice(-8)}]`;
  }
  
  out += ` ${body}`;
  
  if (meta !== undefined) {
    try {
      const metaStr = typeof meta === 'string' ? meta : JSON.stringify(meta);
      out += ` | ${metaStr}`;
    } catch (e) {
      out += ` | (meta: ${util.inspect(meta)})`;
    }
  }
  return out;
}

function logWithSpan(level: LogLevel, message: any, meta?: any) {
  // Diagnostic hook for tests — logs are visible on stderr/stdout but tests
  // capture console.log/console.error/console.warn. Use console.debug so we can
  // inspect flow without interfering with mockConsole in tests.
  try {
    console.debug && console.debug('[TEST-DEBUG] logWithSpan - entry', level, typeof message === 'string' ? message : '[obj]');
  } catch (e) {
    // Swallow console errors that can occur when Jest environment is torn down
  }

  if (!isLevelEnabled(level)) {
    try {
      console.debug && console.debug('[TEST-DEBUG] logWithSpan - level disabled', level);
    } catch (e) {
      // ignore
    }
    return;
  }
  
  // Try to add span events if OTEL is available
  if (isOtelAvailable() && !isFallbackMode()) {
    try {
      const activeSpan = trace.getActiveSpan();
      const correlationContext = CorrelationIdManager.getCurrentContext();
      
      if (activeSpan) {
        // Add log as span event with correlation context
        const eventAttributes: any = {
          'log.severity': level,
          'log.message': typeof message === 'string' ? message : util.inspect(message),
          ...(meta && { 'log.meta': typeof meta === 'string' ? meta : JSON.stringify(meta) })
        };
        
        // Add correlation context to span event
        if (correlationContext) {
          eventAttributes['correlation.id'] = correlationContext.correlationId;
          eventAttributes['correlation.source'] = correlationContext.source;
          if (correlationContext.callSid) {
            eventAttributes['twilio.call_sid'] = correlationContext.callSid;
          }
          if (correlationContext.sessionId) {
            eventAttributes['session.id'] = correlationContext.sessionId;
          }
        }
        
        activeSpan.addEvent(`log.${level.toLowerCase()}`, eventAttributes);
        
        // Mark span as error if this is an error log
        if (level === 'ERROR') {
          activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: typeof message === 'string' ? message : 'Error occurred' });
        }
      }
    } catch (error) {
      // OTEL failed at runtime - enable fallback mode and continue
      const { enableFallbackMode } = require('./tracing');
      enableFallbackMode(`OTEL span operation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Always output the log message regardless of OTEL status
  const formattedMessage = formatMessage(level, message, meta);
  try {
    console.debug && console.debug('[TEST-DEBUG] logWithSpan - formattedMessage ready', level, formattedMessage.slice ? formattedMessage.slice(0, 200) : String(formattedMessage));
  } catch (e) {
    // Swallow console errors that can occur when Jest environment is torn down
  }
  
  switch (level) {
    case 'ERROR':
      try { console.error && console.error(formattedMessage); } catch (e) { /* ignore */ }
      break;
    case 'WARN':
      try { console.warn && console.warn(formattedMessage); } catch (e) { /* ignore */ }
      break;
    default:
      try { console.log && console.log(formattedMessage); } catch (e) { /* ignore */ }
  }
}

// Enhanced logger with tracing integration
const logger = {
  error(message: any, meta?: any) {
    logWithSpan('ERROR', message, meta);
  },

  warn(message: any, meta?: any) {
    logWithSpan('WARN', message, meta);
  },

  info(message: any, meta?: any) {
    logWithSpan('INFO', message, meta);
  },

  debug(message: any, meta?: any) {
    logWithSpan('DEBUG', message, meta);
  },

  trace(message: any, meta?: any) {
    logWithSpan('TRACE', message, meta);
  },

  // Helper method to create a traced operation with fallback
  withSpan<T>(name: string, operation: () => T | Promise<T>, attributes?: Record<string, any>): T | Promise<T> {
    // If OTEL is not available or in fallback mode, just execute the operation
    if (!isOtelAvailable() || isFallbackMode()) {
      this.debug(`Executing operation without tracing: ${name}`, attributes);
      return operation();
    }
    
    try {
      const tracer = trace.getTracer('twilio-bedrock-bridge');
      return tracer.startActiveSpan(name, { kind: SpanKind.INTERNAL, attributes }, (span) => {
        try {
          const result = operation();
          if (result instanceof Promise) {
            return result
              .then((value) => {
                span.setStatus({ code: SpanStatusCode.OK });
                return value;
              })
              .catch((error) => {
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                span.recordException(error);
                throw error;
              })
              .finally(() => {
                span.end();
              });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
          }
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
          span.recordException(error as Error);
          span.end();
          throw error;
        }
      });
    } catch (error) {
      // OTEL failed - enable fallback mode and execute operation without tracing
      const { enableFallbackMode } = require('./tracing');
      enableFallbackMode(`OTEL withSpan failed: ${error instanceof Error ? error.message : String(error)}`);
      this.warn(`Tracing failed for operation ${name}, continuing without tracing`, { error: error instanceof Error ? error.message : String(error) });
      return operation();
    }
  },

  isLevelEnabled
};

export default logger;
export { logger, isLevelEnabled, LogLevel, clearTraceContextCache };