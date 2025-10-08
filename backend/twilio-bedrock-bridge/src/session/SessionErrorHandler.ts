/**
 * @fileoverview Session Error Handling System
 * 
 * Provides consistent error handling patterns across all session types
 * with proper error context, correlation ID propagation, and retry mechanisms.
 */

import logger from '../observability/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { 
  SessionError, 
  AudioProcessingError, 
  SessionInactiveError,
  extractErrorDetails 
} from '../errors/ClientErrors';

/**
 * Error severity levels for classification
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Error categories for better handling
 */
export enum ErrorCategory {
  NETWORK = 'network',
  AUDIO_PROCESSING = 'audio_processing',
  SESSION_LIFECYCLE = 'session_lifecycle',
  CONFIGURATION = 'configuration',
  RESOURCE_EXHAUSTION = 'resource_exhaustion',
  EXTERNAL_SERVICE = 'external_service',
  VALIDATION = 'validation',
  UNKNOWN = 'unknown'
}

/**
 * Enhanced error context with correlation information
 */
export interface SessionErrorContext {
  readonly sessionId: string;
  readonly correlationId: string;
  readonly operation: string;
  readonly timestamp: number;
  readonly severity: ErrorSeverity;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly metadata: Record<string, any>;
  readonly stackTrace?: string;
  readonly parentError?: Error;
}

/**
 * Retry configuration for transient errors
 */
export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly retryableCategories: ErrorCategory[];
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableCategories: [
    ErrorCategory.NETWORK,
    ErrorCategory.EXTERNAL_SERVICE,
    ErrorCategory.RESOURCE_EXHAUSTION,
  ],
};

/**
 * Session error handler that provides consistent error handling patterns
 */
export class SessionErrorHandler {
  private readonly retryConfig: RetryConfig;
  private readonly errorCounts = new Map<string, number>();
  private readonly lastErrors = new Map<string, SessionErrorContext>();

  constructor(retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.retryConfig = retryConfig;
  }

  /**
   * Handles an error with proper context and correlation ID propagation
   */
  public handleError(
    error: Error,
    sessionId: string,
    operation: string,
    metadata: Record<string, any> = {}
  ): SessionErrorContext {
    const correlationId = CorrelationIdManager.getCurrentCorrelationId() || 'unknown';
    
    // Classify the error
    const { severity, category, retryable } = this.classifyError(error);
    
    // Create error context
    const errorContext: SessionErrorContext = {
      sessionId,
      correlationId,
      operation,
      timestamp: Date.now(),
      severity,
      category,
      retryable,
      metadata: {
        ...metadata,
        errorMessage: error.message,
        errorName: error.name,
      },
      stackTrace: error.stack,
      parentError: error,
    };

    // Update error tracking
    this.updateErrorTracking(sessionId, errorContext);

    // Log the error with appropriate level
    this.logError(errorContext);

    // Emit error event for monitoring
    this.emitErrorEvent(errorContext);

    return errorContext;
  }

  /**
   * Executes an operation with retry logic for transient errors
   */
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    sessionId: string,
    operationName: string,
    metadata: Record<string, any> = {}
  ): Promise<T> {
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.retryConfig.maxAttempts) {
      attempt++;

      try {
        const result = await operation();
        
        // Reset error count on success
        if (attempt > 1) {
          logger.info(`Operation succeeded after retry`, {
            sessionId,
            operation: operationName,
            attempt,
            correlationId: CorrelationIdManager.getCurrentCorrelationId(),
          });
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        const errorContext = this.handleError(lastError, sessionId, operationName, {
          ...metadata,
          attempt,
          maxAttempts: this.retryConfig.maxAttempts,
        });

        // Check if error is retryable
        if (!errorContext.retryable || attempt >= this.retryConfig.maxAttempts) {
          logger.error(`Operation failed after ${attempt} attempts`, {
            sessionId,
            operation: operationName,
            finalError: extractErrorDetails(lastError),
            correlationId: errorContext.correlationId,
          });
          throw lastError;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.retryConfig.baseDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
          this.retryConfig.maxDelayMs
        );

        logger.warn(`Operation failed, retrying in ${delay}ms`, {
          sessionId,
          operation: operationName,
          attempt,
          maxAttempts: this.retryConfig.maxAttempts,
          delay,
          error: extractErrorDetails(lastError),
          correlationId: errorContext.correlationId,
        });

        // Wait before retry
        await this.delay(delay);
      }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError || new Error('Unknown error in retry logic');
  }

  /**
   * Creates a circuit breaker for external service calls
   */
  public createCircuitBreaker(
    sessionId: string,
    serviceName: string,
    options: {
      failureThreshold?: number;
      resetTimeoutMs?: number;
      monitoringWindowMs?: number;
    } = {}
  ): {
    execute: <T>(operation: () => Promise<T>) => Promise<T>;
    getState: () => 'closed' | 'open' | 'half-open';
    getStats: () => { failures: number; successes: number; state: string };
  } {
    const {
      failureThreshold = 5,
      resetTimeoutMs = 60000,
      monitoringWindowMs = 300000,
    } = options;

    let state: 'closed' | 'open' | 'half-open' = 'closed';
    let failures = 0;
    let successes = 0;
    let lastFailureTime = 0;
    let nextAttemptTime = 0;

    const execute = async <T>(operation: () => Promise<T>): Promise<T> => {
      const now = Date.now();

      // Reset counters if monitoring window has passed
      if (now - lastFailureTime > monitoringWindowMs) {
        failures = 0;
        successes = 0;
      }

      // Check circuit breaker state
      if (state === 'open') {
        if (now < nextAttemptTime) {
          throw new SessionError(
            `Circuit breaker is open for ${serviceName}`,
            sessionId
          );
        } else {
          state = 'half-open';
        }
      }

      try {
        const result = await operation();
        
        // Success - reset or close circuit
        successes++;
        if (state === 'half-open') {
          state = 'closed';
          failures = 0;
          logger.info(`Circuit breaker closed for ${serviceName}`, {
            sessionId,
            correlationId: CorrelationIdManager.getCurrentCorrelationId(),
          });
        }
        
        return result;
      } catch (error) {
        failures++;
        lastFailureTime = now;
        
        // Open circuit if threshold reached
        if (failures >= failureThreshold) {
          state = 'open';
          nextAttemptTime = now + resetTimeoutMs;
          
          logger.error(`Circuit breaker opened for ${serviceName}`, {
            sessionId,
            failures,
            threshold: failureThreshold,
            resetTimeoutMs,
            correlationId: CorrelationIdManager.getCurrentCorrelationId(),
          });
        }
        
        throw error;
      }
    };

    return {
      execute,
      getState: () => state,
      getStats: () => ({ failures, successes, state }),
    };
  }

  /**
   * Gets error statistics for a session
   */
  public getErrorStats(sessionId: string): {
    totalErrors: number;
    lastError?: SessionErrorContext;
    errorsByCategory: Record<ErrorCategory, number>;
    errorsBySeverity: Record<ErrorSeverity, number>;
  } {
    const totalErrors = this.errorCounts.get(sessionId) || 0;
    const lastError = this.lastErrors.get(sessionId);
    
    // This is a simplified implementation - in a real system,
    // you'd want to track more detailed statistics
    const errorsByCategory = {} as Record<ErrorCategory, number>;
    const errorsBySeverity = {} as Record<ErrorSeverity, number>;
    
    if (lastError) {
      errorsByCategory[lastError.category] = 1;
      errorsBySeverity[lastError.severity] = 1;
    }

    return {
      totalErrors,
      lastError,
      errorsByCategory,
      errorsBySeverity,
    };
  }

  /**
   * Clears error tracking for a session
   */
  public clearErrorTracking(sessionId: string): void {
    this.errorCounts.delete(sessionId);
    this.lastErrors.delete(sessionId);
  }

  /**
   * Classifies an error to determine severity, category, and retryability
   */
  private classifyError(error: Error): {
    severity: ErrorSeverity;
    category: ErrorCategory;
    retryable: boolean;
  } {
    // Audio processing errors
    if (error instanceof AudioProcessingError) {
      return {
        severity: ErrorSeverity.MEDIUM,
        category: ErrorCategory.AUDIO_PROCESSING,
        retryable: true,
      };
    }

    // Session lifecycle errors
    if (error instanceof SessionInactiveError) {
      return {
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.SESSION_LIFECYCLE,
        retryable: false,
      };
    }

    if (error instanceof SessionError) {
      return {
        severity: ErrorSeverity.MEDIUM,
        category: ErrorCategory.SESSION_LIFECYCLE,
        retryable: false,
      };
    }

    // Network-related errors
    if (error.message.includes('timeout') || 
        error.message.includes('connection') ||
        error.message.includes('network')) {
      return {
        severity: ErrorSeverity.MEDIUM,
        category: ErrorCategory.NETWORK,
        retryable: true,
      };
    }

    // Resource exhaustion
    if (error.message.includes('memory') ||
        error.message.includes('buffer') ||
        error.message.includes('queue full')) {
      return {
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.RESOURCE_EXHAUSTION,
        retryable: true,
      };
    }

    // Validation errors
    if (error.message.includes('validation') ||
        error.message.includes('invalid') ||
        error.name === 'ValidationError') {
      return {
        severity: ErrorSeverity.LOW,
        category: ErrorCategory.VALIDATION,
        retryable: false,
      };
    }

    // Default classification
    return {
      severity: ErrorSeverity.MEDIUM,
      category: ErrorCategory.UNKNOWN,
      retryable: false,
    };
  }

  /**
   * Updates error tracking for a session
   */
  private updateErrorTracking(sessionId: string, errorContext: SessionErrorContext): void {
    const currentCount = this.errorCounts.get(sessionId) || 0;
    this.errorCounts.set(sessionId, currentCount + 1);
    this.lastErrors.set(sessionId, errorContext);
  }

  /**
   * Logs an error with appropriate level based on severity
   */
  private logError(errorContext: SessionErrorContext): void {
    const logData = {
      sessionId: errorContext.sessionId,
      operation: errorContext.operation,
      category: errorContext.category,
      severity: errorContext.severity,
      retryable: errorContext.retryable,
      correlationId: errorContext.correlationId,
      metadata: errorContext.metadata,
    };

    switch (errorContext.severity) {
      case ErrorSeverity.CRITICAL:
        logger.error(`Critical session error`, logData);
        break;
      case ErrorSeverity.HIGH:
        logger.error(`High severity session error`, logData);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn(`Medium severity session error`, logData);
        break;
      case ErrorSeverity.LOW:
        logger.info(`Low severity session error`, logData);
        break;
    }
  }

  /**
   * Emits error event for monitoring systems
   */
  private emitErrorEvent(errorContext: SessionErrorContext): void {
    // In a real system, this would emit to monitoring/alerting systems
    // For now, we'll just log it as a structured event
    logger.info(`Session error event`, {
      event: 'session_error',
      sessionId: errorContext.sessionId,
      correlationId: errorContext.correlationId,
      category: errorContext.category,
      severity: errorContext.severity,
      retryable: errorContext.retryable,
      timestamp: errorContext.timestamp,
    });
  }

  /**
   * Simple delay utility for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}