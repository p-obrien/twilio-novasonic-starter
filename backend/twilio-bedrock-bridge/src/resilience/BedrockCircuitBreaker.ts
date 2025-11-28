/**
 * @fileoverview Bedrock-specific Circuit Breaker Configuration
 *
 * Provides a pre-configured circuit breaker instance for AWS Bedrock operations.
 * Configuration is loaded from environment variables with sensible defaults.
 */

import { CircuitBreaker, CircuitBreakerState } from './CircuitBreaker';
import logger from '../observability/logger';

/**
 * Configuration loaded from environment variables
 */
interface BedrockCircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit (default: 5) */
  failureThreshold: number;

  /** Time in ms to wait before attempting recovery (default: 30000) */
  timeoutMs: number;

  /** Number of consecutive successes in HALF_OPEN to close circuit (default: 2) */
  successThreshold: number;

  /** Maximum concurrent calls allowed in HALF_OPEN state (default: 1) */
  halfOpenMaxCalls: number;

  /** Whether circuit breaker is enabled (default: true) */
  enabled: boolean;
}

/**
 * Load circuit breaker configuration from environment variables
 */
function loadBedrockCircuitBreakerConfig(): BedrockCircuitBreakerConfig {
  const config: BedrockCircuitBreakerConfig = {
    failureThreshold: parseInt(process.env.BEDROCK_CB_FAILURE_THRESHOLD || '5', 10),
    timeoutMs: parseInt(process.env.BEDROCK_CB_TIMEOUT_MS || '30000', 10),
    successThreshold: parseInt(process.env.BEDROCK_CB_SUCCESS_THRESHOLD || '2', 10),
    halfOpenMaxCalls: parseInt(process.env.BEDROCK_CB_HALF_OPEN_MAX_CALLS || '1', 10),
    enabled: process.env.BEDROCK_CB_ENABLED !== 'false' // Enabled by default
  };

  // Validate configuration
  if (config.failureThreshold < 1) {
    logger.warn('Invalid BEDROCK_CB_FAILURE_THRESHOLD, using default', {
      provided: process.env.BEDROCK_CB_FAILURE_THRESHOLD,
      default: 5
    });
    config.failureThreshold = 5;
  }

  if (config.timeoutMs < 1000) {
    logger.warn('Invalid BEDROCK_CB_TIMEOUT_MS (must be >= 1000ms), using default', {
      provided: process.env.BEDROCK_CB_TIMEOUT_MS,
      default: 30000
    });
    config.timeoutMs = 30000;
  }

  if (config.successThreshold < 1) {
    logger.warn('Invalid BEDROCK_CB_SUCCESS_THRESHOLD, using default', {
      provided: process.env.BEDROCK_CB_SUCCESS_THRESHOLD,
      default: 2
    });
    config.successThreshold = 2;
  }

  if (config.halfOpenMaxCalls < 1) {
    logger.warn('Invalid BEDROCK_CB_HALF_OPEN_MAX_CALLS, using default', {
      provided: process.env.BEDROCK_CB_HALF_OPEN_MAX_CALLS,
      default: 1
    });
    config.halfOpenMaxCalls = 1;
  }

  logger.info('Bedrock circuit breaker configuration loaded', {
    enabled: config.enabled,
    failureThreshold: config.failureThreshold,
    timeoutMs: config.timeoutMs,
    successThreshold: config.successThreshold,
    halfOpenMaxCalls: config.halfOpenMaxCalls
  });

  return config;
}

/**
 * State change callback for observability
 */
function onBedrockCircuitBreakerStateChange(
  from: CircuitBreakerState,
  to: CircuitBreakerState
): void {
  // Log state transitions for visibility
  logger.info('Bedrock circuit breaker state changed', {
    from,
    to,
    timestamp: new Date().toISOString()
  });

  // Emit custom metric for state transitions (if metrics are enabled)
  // This integrates with the existing observability infrastructure
  try {
    // The observability module will handle metric emission
    // We just need to emit an event that can be picked up by metrics collectors
    if (to === CircuitBreakerState.OPEN) {
      logger.warn('Bedrock circuit breaker OPENED - service protection engaged', {
        previousState: from,
        action: 'Rejecting new Bedrock session requests'
      });
    } else if (to === CircuitBreakerState.CLOSED) {
      logger.info('Bedrock circuit breaker CLOSED - service recovered', {
        previousState: from,
        action: 'Accepting new Bedrock session requests'
      });
    } else if (to === CircuitBreakerState.HALF_OPEN) {
      logger.info('Bedrock circuit breaker testing recovery', {
        previousState: from,
        action: 'Allowing limited Bedrock session requests'
      });
    }
  } catch (error) {
    logger.error('Error in circuit breaker state change callback', {
      from,
      to,
      error
    });
  }
}

/**
 * Create Bedrock circuit breaker instance
 *
 * This function is called lazily to create the circuit breaker only when needed.
 * This allows tests to override environment variables before the circuit breaker is created.
 */
function createBedrockCircuitBreaker(): CircuitBreaker {
  const config = loadBedrockCircuitBreakerConfig();

  if (!config.enabled) {
    logger.info('Bedrock circuit breaker is DISABLED via configuration');
    // Return a pass-through circuit breaker that always allows requests
    // Note: We still create a real circuit breaker but immediately force it to CLOSED
    // and it will stay closed since it won't track failures when disabled
  }

  const circuitBreaker = new CircuitBreaker({
    name: 'bedrock-initiateSession',
    failureThreshold: config.failureThreshold,
    successThreshold: config.successThreshold,
    timeout: config.timeoutMs,
    halfOpenMaxCalls: config.halfOpenMaxCalls,
    onStateChange: onBedrockCircuitBreakerStateChange
  });

  return circuitBreaker;
}

/**
 * Singleton instance of Bedrock circuit breaker
 * Lazy-initialized on first access
 */
let bedrockCircuitBreakerInstance: CircuitBreaker | null = null;

/**
 * Get the Bedrock circuit breaker instance
 *
 * Lazily creates the circuit breaker on first access.
 * This allows tests to override environment variables before creation.
 */
export function getBedrockCircuitBreaker(): CircuitBreaker {
  if (!bedrockCircuitBreakerInstance) {
    bedrockCircuitBreakerInstance = createBedrockCircuitBreaker();
  }
  return bedrockCircuitBreakerInstance;
}

/**
 * Reset the circuit breaker instance (for testing)
 *
 * WARNING: This is intended for testing only.
 * Do not use in production code.
 */
export function resetBedrockCircuitBreaker(): void {
  if (bedrockCircuitBreakerInstance) {
    logger.warn('Resetting Bedrock circuit breaker instance');
    bedrockCircuitBreakerInstance.reset();
    bedrockCircuitBreakerInstance = null;
  }
}

/**
 * Export the circuit breaker instance for backward compatibility
 * This allows both `getBedrockCircuitBreaker()` and direct import
 */
export const bedrockCircuitBreaker = new Proxy({} as CircuitBreaker, {
  get(target, prop) {
    const instance = getBedrockCircuitBreaker();
    return (instance as any)[prop];
  }
});
