/**
 * @fileoverview Retry Utilities with Exponential Backoff
 * 
 * Provides retry mechanisms for transient errors with configurable
 * backoff strategies and error classification.
 */

import { BedrockClientError, ErrorSeverity } from '../errors/ClientErrors';
import { isValidCorrelationId } from '../types/TypeGuards';

/**
 * Retry configuration options
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  
  /** Backoff multiplier */
  backoffMultiplier: number;
  
  /** Jitter factor (0-1) to add randomness */
  jitterFactor: number;
  
  /** Custom retry condition function */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  
  /** Callback for retry attempts */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1
};

/**
 * Retry result type
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: unknown;
  attempts: number;
  totalDelayMs: number;
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  correlationId?: string
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry on the last attempt
      if (attempt === finalConfig.maxRetries) {
        break;
      }

      // Check if we should retry this error
      if (!shouldRetryError(error, attempt, finalConfig)) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const delayMs = calculateDelay(attempt, finalConfig);
      totalDelayMs += delayMs;

      // Call retry callback if provided
      if (finalConfig.onRetry) {
        finalConfig.onRetry(error, attempt + 1, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // All retries exhausted, throw the last error
  throw lastError;
}

/**
 * Execute a function with retry logic and return detailed result
 */
export async function withRetryResult<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  correlationId?: string
): Promise<RetryResult<T>> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      const result = await operation();
      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalDelayMs
      };
    } catch (error) {
      lastError = error;

      // Don't retry on the last attempt
      if (attempt === finalConfig.maxRetries) {
        break;
      }

      // Check if we should retry this error
      if (!shouldRetryError(error, attempt, finalConfig)) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const delayMs = calculateDelay(attempt, finalConfig);
      totalDelayMs += delayMs;

      // Call retry callback if provided
      if (finalConfig.onRetry) {
        finalConfig.onRetry(error, attempt + 1, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: finalConfig.maxRetries + 1,
    totalDelayMs
  };
}

/**
 * Determine if an error should be retried
 */
function shouldRetryError(
  error: unknown,
  attempt: number,
  config: RetryConfig
): boolean {
  // Use custom retry condition if provided
  if (config.shouldRetry) {
    return config.shouldRetry(error, attempt);
  }

  // Check if it's a BedrockClientError
  if (error instanceof BedrockClientError) {
    return error.canRetry();
  }

  // Check for common retryable error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Network and timeout errors are usually retryable
    const retryablePatterns = [
      'timeout',
      'network',
      'connection',
      'econnreset',
      'enotfound',
      'econnrefused',
      'throttling',
      'rate limit',
      'service unavailable',
      'internal server error',
      'too many requests'
    ];

    return retryablePatterns.some(pattern => 
      message.includes(pattern) || name.includes(pattern)
    );
  }

  // Default to not retrying unknown errors
  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  // Calculate exponential backoff
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  
  // Apply maximum delay limit
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  
  // Add jitter to avoid thundering herd
  const jitter = cappedDelay * config.jitterFactor * Math.random();
  
  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a retry configuration for specific error types
 */
export function createRetryConfigForErrorType(
  errorType: 'network' | 'service' | 'validation' | 'critical'
): RetryConfig {
  switch (errorType) {
    case 'network':
      return {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 5,
        initialDelayMs: 500,
        maxDelayMs: 10000,
        backoffMultiplier: 1.5
      };
    
    case 'service':
      return {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2
      };
    
    case 'validation':
      return {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 0, // Don't retry validation errors
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1
      };
    
    case 'critical':
      return {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 1,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 1.2
      };
    
    default:
      return DEFAULT_RETRY_CONFIG;
  }
}

/**
 * Retry decorator for class methods
 */
export function retryable(config: Partial<RetryConfig> = {}) {
  return function <T extends (...args: any[]) => Promise<any>>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const originalMethod = descriptor.value;
    
    if (!originalMethod) {
      throw new Error('Retryable decorator can only be applied to methods');
    }

    descriptor.value = async function (this: any, ...args: any[]) {
      return withRetry(
        () => originalMethod.apply(this, args),
        config
      );
    } as T;

    return descriptor;
  };
}

/**
 * Circuit breaker state
 */
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Failure threshold to open circuit */
  failureThreshold: number;
  
  /** Success threshold to close circuit from half-open */
  successThreshold: number;
  
  /** Timeout before trying half-open state */
  timeoutMs: number;
  
  /** Monitor window in milliseconds */
  monitorWindowMs: number;
}

/**
 * Simple circuit breaker implementation
 */
export class CircuitBreaker<T extends any[], R> {
  private state = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(
    private readonly operation: (...args: T) => Promise<R>,
    config: Partial<CircuitBreakerConfig> = {}
  ) {
    this.config = {
      failureThreshold: 5,
      successThreshold: 2,
      timeoutMs: 60000,
      monitorWindowMs: 300000,
      ...config
    };
  }

  async execute(...args: T): Promise<R> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime < this.config.timeoutMs) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = CircuitState.HALF_OPEN;
      this.successes = 0;
    }

    try {
      const result = await this.operation(...args);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  getState(): string {
    return this.state;
  }

  getStats(): {
    state: string;
    failures: number;
    successes: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime
    };
  }
}