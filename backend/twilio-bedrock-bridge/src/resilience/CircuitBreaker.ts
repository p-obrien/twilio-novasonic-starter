/**
 * @fileoverview Circuit Breaker Pattern Implementation
 *
 * Implements the Circuit Breaker pattern to prevent cascading failures
 * when calling external services. The circuit breaker has three states:
 *
 * CLOSED: Normal operation, all requests pass through
 * OPEN: Service is failing, reject requests immediately
 * HALF_OPEN: Testing recovery, allow limited requests
 *
 * State transitions:
 * CLOSED → OPEN: After N consecutive failures
 * OPEN → HALF_OPEN: After timeout period
 * HALF_OPEN → CLOSED: After M successful requests
 * HALF_OPEN → OPEN: On any failure
 */

import { CircuitBreakerOpenError } from '../errors/ClientErrors';
import { CorrelationIdManager } from '../utils/correlationId';
import logger from '../observability/logger';

/**
 * Circuit breaker state enumeration
 */
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

/**
 * Configuration options for circuit breaker
 */
export interface CircuitBreakerOptions {
  /** Name of the circuit breaker for logging and metrics */
  name: string;

  /** Number of consecutive failures before opening circuit */
  failureThreshold: number;

  /** Number of consecutive successes in HALF_OPEN to close circuit */
  successThreshold: number;

  /** Time in ms to wait before attempting recovery (OPEN → HALF_OPEN) */
  timeout: number;

  /** Maximum concurrent calls allowed in HALF_OPEN state (default: 1) */
  halfOpenMaxCalls?: number;

  /** Optional callback when state changes */
  onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;
}

/**
 * Metrics data for circuit breaker monitoring
 */
export interface CircuitBreakerMetrics {
  /** Current state */
  state: CircuitBreakerState;

  /** Current consecutive failure count */
  failureCount: number;

  /** Current consecutive success count in HALF_OPEN */
  successCount: number;

  /** Timestamp when circuit will transition to HALF_OPEN (if OPEN) */
  nextAttempt: number;

  /** Number of active calls in HALF_OPEN state */
  halfOpenCalls: number;

  /** Total number of successful calls */
  totalSuccesses: number;

  /** Total number of failed calls */
  totalFailures: number;

  /** Total number of rejected calls (circuit OPEN) */
  totalRejections: number;

  /** Last state change timestamp */
  lastStateChangeTime: number;
}

/**
 * Generic Circuit Breaker implementation
 *
 * Thread-safe implementation using internal state management.
 * Designed for high-performance with <1ms decision overhead.
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttempt = 0;
  private halfOpenCalls = 0;

  // Metrics
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalRejections = 0;
  private lastStateChangeTime = Date.now();

  private readonly halfOpenMaxCalls: number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? 1;

    logger.info('Circuit breaker initialized', {
      name: options.name,
      failureThreshold: options.failureThreshold,
      successThreshold: options.successThreshold,
      timeout: options.timeout,
      halfOpenMaxCalls: this.halfOpenMaxCalls
    });
  }

  /**
   * Execute a function with circuit breaker protection
   *
   * @param fn - Async function to execute
   * @returns Promise resolving to function result
   * @throws CircuitBreakerOpenError if circuit is OPEN
   * @throws Original error if function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we can execute
    const canExecute = this.canExecute();

    if (!canExecute) {
      this.totalRejections++;

      const correlationId = CorrelationIdManager.getCurrentCorrelationId();

      logger.warn('Circuit breaker rejected request', {
        circuitName: this.options.name,
        state: this.state,
        nextAttempt: this.nextAttempt,
        retryAfterMs: Math.max(0, this.nextAttempt - Date.now()),
        correlationId
      });

      throw CircuitBreakerOpenError.create(
        this.options.name,
        this.nextAttempt,
        'circuit_breaker_execute',
        undefined,
        correlationId
      );
    }

    // Track if we're in HALF_OPEN state
    const wasHalfOpen = this.state === CircuitBreakerState.HALF_OPEN;
    if (wasHalfOpen) {
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    } finally {
      // Decrement half-open calls counter
      if (wasHalfOpen) {
        this.halfOpenCalls--;
      }
    }
  }

  /**
   * Check if a request can be executed
   *
   * @returns true if request can proceed, false otherwise
   */
  private canExecute(): boolean {
    const now = Date.now();

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        // Check if timeout has elapsed
        if (now >= this.nextAttempt) {
          this.transitionTo(CircuitBreakerState.HALF_OPEN);
          return true;
        }
        return false;

      case CircuitBreakerState.HALF_OPEN:
        // Allow limited concurrent calls
        return this.halfOpenCalls < this.halfOpenMaxCalls;

      default:
        return false;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.totalSuccesses++;

    const correlationId = CorrelationIdManager.getCurrentCorrelationId();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.successCount++;

      logger.debug('Circuit breaker request succeeded in HALF_OPEN', {
        circuitName: this.options.name,
        successCount: this.successCount,
        successThreshold: this.options.successThreshold,
        correlationId
      });

      if (this.successCount >= this.options.successThreshold) {
        this.transitionTo(CircuitBreakerState.CLOSED);
      }
    } else if (this.state === CircuitBreakerState.CLOSED) {
      // Reset failure count on success
      if (this.failureCount > 0) {
        logger.debug('Circuit breaker resetting failure count after success', {
          circuitName: this.options.name,
          previousFailureCount: this.failureCount,
          correlationId
        });
        this.failureCount = 0;
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: Error): void {
    this.totalFailures++;

    const correlationId = CorrelationIdManager.getCurrentCorrelationId();

    logger.warn('Circuit breaker request failed', {
      circuitName: this.options.name,
      state: this.state,
      failureCount: this.failureCount + 1,
      failureThreshold: this.options.failureThreshold,
      errorName: error.name,
      errorMessage: error.message,
      correlationId
    });

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // Any failure in HALF_OPEN opens the circuit
      this.transitionTo(CircuitBreakerState.OPEN);
    } else if (this.state === CircuitBreakerState.CLOSED) {
      this.failureCount++;

      if (this.failureCount >= this.options.failureThreshold) {
        this.transitionTo(CircuitBreakerState.OPEN);
      }
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitBreakerState): void {
    const oldState = this.state;

    if (oldState === newState) {
      return;
    }

    this.state = newState;
    this.lastStateChangeTime = Date.now();

    const correlationId = CorrelationIdManager.getCurrentCorrelationId();

    // Reset counters based on new state
    switch (newState) {
      case CircuitBreakerState.CLOSED:
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttempt = 0;
        this.halfOpenCalls = 0;
        break;

      case CircuitBreakerState.OPEN:
        this.nextAttempt = Date.now() + this.options.timeout;
        this.successCount = 0;
        this.halfOpenCalls = 0;
        break;

      case CircuitBreakerState.HALF_OPEN:
        this.successCount = 0;
        this.failureCount = 0;
        this.halfOpenCalls = 0;
        break;
    }

    logger.info('Circuit breaker state transition', {
      circuitName: this.options.name,
      from: oldState,
      to: newState,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttempt: this.nextAttempt,
      correlationId
    });

    // Call state change callback if provided
    if (this.options.onStateChange) {
      try {
        this.options.onStateChange(oldState, newState);
      } catch (error) {
        logger.error('Circuit breaker state change callback failed', {
          circuitName: this.options.name,
          from: oldState,
          to: newState,
          error,
          correlationId
        });
      }
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttempt: this.nextAttempt,
      halfOpenCalls: this.halfOpenCalls,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalRejections: this.totalRejections,
      lastStateChangeTime: this.lastStateChangeTime
    };
  }

  /**
   * Force circuit breaker to OPEN state (for testing/manual intervention)
   */
  forceOpen(): void {
    logger.warn('Circuit breaker forced to OPEN state', {
      circuitName: this.options.name,
      currentState: this.state
    });
    this.transitionTo(CircuitBreakerState.OPEN);
  }

  /**
   * Force circuit breaker to CLOSED state (for testing/manual intervention)
   */
  forceClosed(): void {
    logger.warn('Circuit breaker forced to CLOSED state', {
      circuitName: this.options.name,
      currentState: this.state
    });
    this.transitionTo(CircuitBreakerState.CLOSED);
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    logger.info('Circuit breaker reset', {
      circuitName: this.options.name,
      currentState: this.state
    });

    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = 0;
    this.halfOpenCalls = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
    this.totalRejections = 0;
    this.lastStateChangeTime = Date.now();
  }
}
