/**
 * @fileoverview Distributed Tracing Correlation ID Management
 * 
 * This module provides utilities for generating, managing, and propagating correlation IDs
 * across the entire request lifecycle. Correlation IDs help trace requests through
 * multiple services and components for better observability and debugging.
 * 
 * Features:
 * - Automatic correlation ID generation and propagation
 * - Integration with OpenTelemetry tracing
 * - Context-aware correlation ID storage using AsyncLocalStorage
 * - Support for both HTTP requests and WebSocket connections
 * - Twilio-specific correlation ID extraction from CallSid
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { trace, context, SpanKind } from '@opentelemetry/api';
import { Request, Response, NextFunction } from 'express';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface CorrelationContext {
  correlationId: string;
  callSid?: string;
  sessionId?: string;
  accountSid?: string;
  streamSid?: string;
  parentCorrelationId?: string;
  timestamp: number;
  source: 'webhook' | 'websocket' | 'internal' | 'bedrock';
}

export interface CorrelationHeaders {
  'x-correlation-id'?: string;
  'x-twilio-call-sid'?: string;
  'x-session-id'?: string;
  'x-parent-correlation-id'?: string;
}

// ============================================================================
// ASYNC LOCAL STORAGE FOR CORRELATION CONTEXT
// ============================================================================

let correlationStorage: AsyncLocalStorage<CorrelationContext> | undefined;

/**
 * Lazily create the AsyncLocalStorage instance so tests can mock the
 * AsyncLocalStorage constructor before the storage is created. Tests often
 * replace the mocked constructor's implementation in beforeEach; creating
 * the storage lazily ensures the mocked constructor is used.
 */
function getCorrelationStorage(): AsyncLocalStorage<CorrelationContext> {
  if (!correlationStorage) {
    // Use runtime require to obtain the latest AsyncLocalStorage constructor.
    // Tests may mock 'async_hooks' after this module is imported; using require()
    // ensures we use the mocked constructor when tests replace it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AsyncLocalStorage: ALS } = require('async_hooks');
    // ALS may be untyped (mock). Cast the created instance to the correct type.
    correlationStorage = (new ALS()) as AsyncLocalStorage<CorrelationContext>;
  }
  return correlationStorage as AsyncLocalStorage<CorrelationContext>;
}

// ============================================================================
// CORRELATION ID UTILITIES
// ============================================================================

export class CorrelationIdManager {
  private static readonly CORRELATION_ID_HEADER = 'x-correlation-id';
  private static readonly PARENT_CORRELATION_ID_HEADER = 'x-parent-correlation-id';
  private static readonly CALL_SID_HEADER = 'x-twilio-call-sid';
  private static readonly SESSION_ID_HEADER = 'x-session-id';

  /**
   * Generate a new correlation ID with optional prefix
   */
  public static generateCorrelationId(prefix?: string): string {
    const uuid = randomUUID();
    return prefix ? `${prefix}-${uuid}` : uuid;
  }

  /**
   * Generate a unique correlation ID (alias for generateCorrelationId for test compatibility)
   */
  public static generateId(): string {
    return this.generateCorrelationId();
  }

  /**
   * Generate a correlation ID from Twilio CallSid for consistency
   */
  public static generateFromCallSid(callSid: string): string {
    // Use CallSid as base but add a short UUID suffix for uniqueness
    const suffix = randomUUID().split('-')[0];
    return `twilio-${callSid}-${suffix}`;
  }

  /**
   * Generate a correlation ID for Bedrock sessions
   */
  public static generateForBedrock(sessionId: string): string {
    const suffix = randomUUID().split('-')[0];
    return `bedrock-${sessionId}-${suffix}`;
  }

  // Cache for current context to reduce AsyncLocalStorage overhead
  private static contextCache: { context: CorrelationContext | undefined; timestamp: number } | null = null;
  private static readonly CONTEXT_CACHE_TTL = 50; // Cache for 50ms for high-frequency operations

  /**
   * Get the current correlation context from AsyncLocalStorage with caching
   */
  public static getCurrentContext(): CorrelationContext | undefined {
    const now = Date.now();
    
    // Use cached context for high-frequency operations
    if (this.contextCache && (now - this.contextCache.timestamp) < this.CONTEXT_CACHE_TTL) {
      return this.contextCache.context;
    }
    
    const context = getCorrelationStorage().getStore();
    
    // Cache the result
    this.contextCache = { context, timestamp: now };
    
    return context;
  }

  /**
   * Get the current correlation ID with optimized context retrieval
   */
  public static getCurrentCorrelationId(): string | undefined {
    return this.getCurrentContext()?.correlationId;
  }

  /**
   * Set correlation context for the current async context
   *
   * Accepts undefined to allow tests to clear the current context without throwing.
   */
  public static setContext(context?: CorrelationContext): void {
    // Invalidate cache when context changes
    this.contextCache = null;

    try {
      // Always use the same AsyncLocalStorage instance so async hooks remain active.
      // Enter with the provided context (can be undefined) to set/clear the store.
      getCorrelationStorage().enterWith(context as any);
    } catch (err) {
      // If the underlying storage is mocked or doesn't support enterWith in the current test
      // environment, swallow the error to avoid failing tests.
    }
  }

  /**
   * Run a function within a correlation context with cache invalidation
   * Accepts partial context and fills in missing required properties
   */
  public static runWithContext<T>(
    context: CorrelationContext | Partial<CorrelationContext>,
    fn: () => T | Promise<T>
  ): T | Promise<T> {
    // Ensure context has all required properties
    const fullContext: CorrelationContext = {
      correlationId: context.correlationId || this.generateCorrelationId(),
      timestamp: context.timestamp || Date.now(),
      source: context.source || 'internal',
      ...context
    };

    // Invalidate cache before running in new context
    const previousCache = this.contextCache;
    this.contextCache = null;
    
    // Run the function inside ALS and ensure we restore cache only after async work completes.
    const result = getCorrelationStorage().run(fullContext, fn);

    // If the result is a Promise, restore cache when the Promise settles.
    if (result && typeof (result as any).then === 'function') {
      return (result as Promise<T>).finally(() => {
        this.contextCache = previousCache;
      });
    }

    // Synchronous result - restore previous cache and return immediately.
    this.contextCache = previousCache;
    return result;
  }

  /**
   * Create a new correlation context
   */
  public static createContext(options: {
    correlationId?: string;
    callSid?: string;
    sessionId?: string;
    accountSid?: string;
    streamSid?: string;
    parentCorrelationId?: string;
    source: CorrelationContext['source'];
  }): CorrelationContext {
    return {
      correlationId: options.correlationId || this.generateCorrelationId(),
      callSid: options.callSid,
      sessionId: options.sessionId,
      accountSid: options.accountSid,
      streamSid: options.streamSid,
      parentCorrelationId: options.parentCorrelationId,
      timestamp: Date.now(),
      source: options.source
    };
  }

  /**
   * Create a simple correlation context for testing (with default values)
   */
  public static createSimpleContext(options: {
    correlationId?: string;
    sessionId?: string;
    callSid?: string;
    source?: CorrelationContext['source'];
  } = {}): CorrelationContext {
    return {
      correlationId: options.correlationId || this.generateCorrelationId(),
      sessionId: options.sessionId,
      callSid: options.callSid,
      timestamp: Date.now(),
      source: options.source || 'internal'
    };
  }

  /**
   * Create a correlation context from a partial context object
   */
  public static fromPartial(partial: Partial<CorrelationContext>): CorrelationContext {
    return {
      correlationId: partial.correlationId || this.generateCorrelationId(),
      timestamp: partial.timestamp || Date.now(),
      source: partial.source || 'internal',
      ...partial
    };
  }

  /**
   * Extract correlation context from HTTP headers
   */
  public static extractFromHeaders(headers: Record<string, string | string[] | undefined>): Partial<CorrelationContext> {
    const getHeader = (key: string): string | undefined => {
      const value = headers[key.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    };

    return {
      correlationId: getHeader(this.CORRELATION_ID_HEADER),
      callSid: getHeader(this.CALL_SID_HEADER),
      sessionId: getHeader(this.SESSION_ID_HEADER),
      parentCorrelationId: getHeader(this.PARENT_CORRELATION_ID_HEADER)
    };
  }

  /**
   * Create headers object with correlation information using lazy evaluation
   */
  public static createHeaders(context?: CorrelationContext): CorrelationHeaders {
    const ctx = context || this.getCurrentContext();
    if (!ctx) return {};

    // Use object spread for better performance and lazy evaluation
    return {
      [this.CORRELATION_ID_HEADER]: ctx.correlationId,
      ...(ctx.callSid && { [this.CALL_SID_HEADER]: ctx.callSid }),
      ...(ctx.sessionId && { [this.SESSION_ID_HEADER]: ctx.sessionId }),
      ...(ctx.parentCorrelationId && { [this.PARENT_CORRELATION_ID_HEADER]: ctx.parentCorrelationId })
    };
  }

  /**
   * Add correlation context to OpenTelemetry span with optimized attribute setting
   */
  public static addToSpan(span: any, context?: CorrelationContext): void {
    const ctx = context || this.getCurrentContext();
    if (!ctx || !span) return;

    // Build attributes object once and set all at once for better performance
    const attributes: Record<string, any> = {
      'correlation.id': ctx.correlationId,
      'correlation.source': ctx.source,
      'correlation.timestamp': ctx.timestamp
    };

    // Add optional attributes using lazy evaluation
    if (ctx.callSid) attributes['twilio.call_sid'] = ctx.callSid;
    if (ctx.sessionId) attributes['session.id'] = ctx.sessionId;
    if (ctx.accountSid) attributes['twilio.account_sid'] = ctx.accountSid;
    if (ctx.streamSid) attributes['twilio.stream_sid'] = ctx.streamSid;
    if (ctx.parentCorrelationId) attributes['correlation.parent_id'] = ctx.parentCorrelationId;

    span.setAttributes(attributes);
  }

  /**
   * Create a child correlation context for nested operations
   */
  public static createChildContext(
    source: CorrelationContext['source'],
    additionalData?: Partial<CorrelationContext>
  ): CorrelationContext {
    const parentContext = this.getCurrentContext();
    
    return this.createContext({
      source,
      parentCorrelationId: parentContext?.correlationId,
      callSid: parentContext?.callSid,
      accountSid: parentContext?.accountSid,
      sessionId: parentContext?.sessionId,
      streamSid: parentContext?.streamSid,
      ...additionalData
    });
  }

  /**
   * Clear the correlation context cache (useful for testing or memory management)
   */
  public static clearCache(): void {
    // Only clear the in-memory cache. Preserve the AsyncLocalStorage instance so
    // async hooks and timer propagation remain intact.
    this.contextCache = null;
  }

  /**
   * Middleware for Express to handle correlation IDs in HTTP requests with optimizations
   */
  public static middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        // Extract existing correlation info from headers (lazy evaluation)
        const headerContext = CorrelationIdManager.extractFromHeaders(req.headers);
        
        // Extract Twilio-specific information from request body
        const callSid = req.body?.CallSid || headerContext.callSid;
        const accountSid = req.body?.AccountSid;

        // Create correlation context with optimized ID generation
        const correlationId = headerContext.correlationId || 
          (callSid ? CorrelationIdManager.generateFromCallSid(callSid) : CorrelationIdManager.generateCorrelationId());

        const correlationContext = CorrelationIdManager.createContext({
          correlationId,
          callSid,
          accountSid,
          parentCorrelationId: headerContext.parentCorrelationId,
          source: 'webhook'
        });

        // Set response headers efficiently
        const responseHeaders: Record<string, string> = {
          [CorrelationIdManager.CORRELATION_ID_HEADER]: correlationContext.correlationId
        };
        
        if (correlationContext.callSid) {
          responseHeaders[CorrelationIdManager.CALL_SID_HEADER] = correlationContext.callSid;
        }
        
        // Set all headers at once
        Object.entries(responseHeaders).forEach(([key, value]) => {
          res.setHeader(key, value);
        });

        // Add to OpenTelemetry span if available (with error handling)
        try {
          const { getSafeActiveSpan } = require('../observability/safeTracing');
          const activeSpan = getSafeActiveSpan();
          if (activeSpan) {
            CorrelationIdManager.addToSpan(activeSpan, correlationContext);
          }
        } catch (error) {
          // Safe tracing failed, continue without span context
        }

        // Run the rest of the request in this correlation context
        CorrelationIdManager.runWithContext(correlationContext, () => {
          next();
        });
      } catch (error) {
        // If correlation middleware fails, continue without correlation context
        console.error('Correlation middleware error:', error);
        next();
      }
    };
  }

  /**
   * Create correlation context for WebSocket connections
   */
  public static createWebSocketContext(options: {
    callSid?: string;
    accountSid?: string;
    streamSid?: string;
    sessionId?: string;
    parentCorrelationId?: string;
  }): CorrelationContext {
    const correlationId = options.callSid 
      ? this.generateFromCallSid(options.callSid)
      : this.generateCorrelationId('ws');

    return this.createContext({
      correlationId,
      source: 'websocket',
      ...options
    });
  }

  /**
   * Create correlation context for Bedrock operations
   */
  public static createBedrockContext(sessionId: string, parentContext?: CorrelationContext): CorrelationContext {
    return this.createContext({
      correlationId: this.generateForBedrock(sessionId),
      sessionId,
      source: 'bedrock',
      parentCorrelationId: parentContext?.correlationId,
      callSid: parentContext?.callSid,
      accountSid: parentContext?.accountSid
    });
  }

  /**
   * Trace a function execution with correlation context
   */
  public static traceWithCorrelation<T>(
    operationName: string,
    fn: () => T | Promise<T>,
    attributes?: Record<string, any>
  ): T | Promise<T> {
    const correlationContext = this.getCurrentContext();
    
    try {
      const { safeTrace } = require('../observability/safeTracing');
      const tracer = safeTrace.getTracer('twilio-bedrock-bridge');

      return tracer.startActiveSpan(operationName, {
        kind: SpanKind.INTERNAL,
        attributes: {
          ...attributes,
          ...(correlationContext && {
            'correlation.id': correlationContext.correlationId,
            'correlation.source': correlationContext.source
          })
        }
      }, (span: any) => {
        try {
          // Add correlation context to span
          if (correlationContext) {
            this.addToSpan(span, correlationContext);
          }

          const result = fn();
          
          if (result instanceof Promise) {
            return result
              .then((value) => {
                span.setStatus({ code: 1 }); // OK
                return value;
              })
              .catch((error) => {
                span.setStatus({ code: 2, message: error.message }); // ERROR
                span.recordException(error);
                throw error;
              })
              .finally(() => {
                span.end();
              });
          } else {
            span.setStatus({ code: 1 }); // OK
            span.end();
            return result;
          }
        } catch (error) {
          span.setStatus({ code: 2, message: (error as Error).message }); // ERROR
          span.recordException(error as Error);
          span.end();
          throw error;
        }
      });
    } catch (error) {
      // Safe tracing failed, execute function without tracing
      return fn();
    }
  }
}
  
// ============================================================================
 // Timer propagation helpers (robust ALS support across macrotasks/microtasks)
 // ============================================================================
 
 /**
  * Patch global timer APIs to capture the current AsyncLocalStorage store when a
  * callback is scheduled and re-enter that store when the callback executes.
  *
  * This ensures correlation context is preserved across setTimeout, setImmediate,
  * and process.nextTick boundaries even when the event loop schedules callbacks
  * as macrotasks/microtasks.
  *
  * The implementation is defensive: it preserves the original functions and is
  * idempotent (won't patch multiple times).
  */
 function patchTimersForALS(): void {
   // Use any to avoid TS issues with global typing changes
   const g: any = globalThis as any;
   if (g.__correlationTimersPatched) return;
 
   const originalSetTimeout = g.setTimeout;
   const originalSetImmediate = g.setImmediate;
   const originalNextTick = process.nextTick;
 
   g.setTimeout = function (callback: (...args: any[]) => void, delay?: number, ...args: any[]) {
     const store = getCorrelationStorage().getStore();
     // Wrap callback execution in a microtask that re-enters the captured ALS store.
     // Add a synchronous fallback: if microtask-run context is not set, enter the
     // captured store synchronously for the callback and restore the previous store.
     return originalSetTimeout(function (...cbArgs: any[]) {
       try {
         Promise.resolve().then(() => {
           try {
             getCorrelationStorage().run(store as any, () => callback(...cbArgs));
           } catch (e) {
             // Microtask re-entry failed; attempt synchronous enterWith fallback
             try {
               const prev = getCorrelationStorage().getStore();
               getCorrelationStorage().enterWith(store as any);
               try {
                 callback(...cbArgs);
               } finally {
                 // Restore previous store if any
                 if (prev !== undefined) {
                   getCorrelationStorage().enterWith(prev as any);
                 }
               }
             } catch (_inner) {
               callback(...cbArgs);
             }
           }
         }).catch(() => {
           callback(...cbArgs);
         });
       } catch (e) {
         callback(...cbArgs);
       }
     }, delay, ...args);
   };
 
   if (originalSetImmediate) {
     g.setImmediate = function (callback: (...args: any[]) => void, ...args: any[]) {
       const store = getCorrelationStorage().getStore();
       return originalSetImmediate(function (...cbArgs: any[]) {
         try {
           Promise.resolve().then(() => {
             try {
               getCorrelationStorage().run(store as any, () => callback(...cbArgs));
             } catch (e) {
               // Fallback synchronous enterWith
               try {
                 const prev = getCorrelationStorage().getStore();
                 getCorrelationStorage().enterWith(store as any);
                 try {
                   callback(...cbArgs);
                 } finally {
                   if (prev !== undefined) {
                     getCorrelationStorage().enterWith(prev as any);
                   }
                 }
               } catch (_inner) {
                 callback(...cbArgs);
               }
             }
           }).catch(() => {
             callback(...cbArgs);
           });
         } catch (e) {
           callback(...cbArgs);
         }
       }, ...args);
     };
   }
 
   // Patch process.nextTick separately
   process.nextTick = function (callback: (...args: any[]) => void, ...args: any[]) {
     const store = getCorrelationStorage().getStore();
     return originalNextTick(function (...cbArgs: any[]) {
       try {
         Promise.resolve().then(() => {
           try {
             getCorrelationStorage().run(store as any, () => callback(...cbArgs));
           } catch (e) {
             // Fallback synchronous enterWith
             try {
               const prev = getCorrelationStorage().getStore();
               getCorrelationStorage().enterWith(store as any);
               try {
                 callback(...cbArgs);
               } finally {
                 if (prev !== undefined) {
                   getCorrelationStorage().enterWith(prev as any);
                 }
               }
             } catch (_inner) {
               callback(...cbArgs);
             }
           }
         }).catch(() => {
           callback(...cbArgs);
         });
       } catch (e) {
         callback(...cbArgs);
       }
     }, ...args);
   };
 
   g.__correlationTimersPatched = true;
 }
 
 // Patch timers eagerly so runtime behavior preserves correlation across async boundaries.
 // This is a small API addition done carefully and is safe to run during module init.
 try {
   patchTimersForALS();
 } catch (e) {
   // If patching fails for any reason (very old Node or restricted env), continue
   // without patching — existing ALS behavior will apply.
 }
 
// ============================================================================
 // CONVENIENCE EXPORTS
 // ============================================================================

/**
 * Test helper to inject a custom AsyncLocalStorage instance (useful for unit tests).
 * Tests can call this to ensure the module uses their mocked storage instance.
 */
export function __setAsyncLocalStorageForTests(storage: AsyncLocalStorage<CorrelationContext> | any): void {
  correlationStorage = storage;
}

export const {
  generateCorrelationId,
  generateId,
  generateFromCallSid,
  generateForBedrock,
  getCurrentContext,
  getCurrentCorrelationId,
  setContext,
  runWithContext,
  createContext,
  createSimpleContext,
  fromPartial,
  createChildContext,
  createWebSocketContext,
  createBedrockContext,
  traceWithCorrelation,
  clearCache
} = CorrelationIdManager;

// Export middleware with proper binding
export const correlationMiddleware = CorrelationIdManager.middleware.bind(CorrelationIdManager);

// Default export
export default CorrelationIdManager;