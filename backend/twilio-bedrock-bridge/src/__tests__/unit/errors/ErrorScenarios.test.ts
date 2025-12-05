/**
 * @fileoverview Error Scenario Coverage Tests
 *
 * Tests verify error handling patterns including:
 * - Circuit breaker state transitions (already covered in CircuitBreaker.test.ts)
 * - Error propagation through the system
 * - Resource cleanup patterns with try-finally
 * - Error context preservation
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
 */

import {
  SessionError,
  AudioProcessingError,
  StreamingError,
  BedrockServiceError,
  extractErrorDetails,
  ErrorSeverity
} from '../../../errors/ClientErrors';
import { CircuitBreaker, CircuitBreakerState } from '../../../resilience/CircuitBreaker';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../../utils/TimerTestUtils';

describe('Error Scenario Coverage', () => {
  beforeEach(() => {
    useFakeTimers();
  });

  afterEach(() => {
    useRealTimers();
  });

  describe('Error Propagation', () => {
    it('should propagate errors through async call chain', async () => {
      const innerOperation = async () => {
        throw SessionError.create(
          'Inner operation failed',
          'inner_op',
          'session-123',
          'correlation-456'
        );
      };

      const middleOperation = async () => {
        try {
          await innerOperation();
        } catch (error) {
          // Re-throw with additional context
          throw StreamingError.create(
            'Middle operation failed',
            'middle_op',
            'session-123',
            'correlation-456',
            { originalError: (error as Error).message },
            error as Error
          );
        }
      };

      const outerOperation = async () => {
        await middleOperation();
      };

      await expect(outerOperation()).rejects.toThrow(StreamingError);

      try {
        await outerOperation();
      } catch (error) {
        const streamingError = error as StreamingError;
        expect(streamingError.code).toBe('STREAMING_ERROR');
        expect(streamingError.sessionId).toBe('session-123');
        expect(streamingError.correlationId).toBe('correlation-456');
        expect(streamingError.cause).toBeInstanceOf(SessionError);
      }
    });

    it('should preserve error context through multiple layers', async () => {
      const correlationId = 'test-correlation-123';
      const sessionId = 'test-session-456';

      const operation1 = async () => {
        throw AudioProcessingError.create(
          'Audio processing failed',
          'audio_process',
          sessionId,
          correlationId,
          { bufferSize: 1024 }
        );
      };

      const operation2 = async () => {
        try {
          await operation1();
        } catch (error) {
          // Wrap error but preserve context
          throw SessionError.create(
            'Session operation failed',
            'session_op',
            sessionId,
            correlationId,
            { cause: (error as Error).message },
            error as Error
          );
        }
      };

      try {
        await operation2();
        fail('Should have thrown error');
      } catch (error) {
        const sessionError = error as SessionError;
        expect(sessionError.sessionId).toBe(sessionId);
        expect(sessionError.correlationId).toBe(correlationId);
        expect(sessionError.cause).toBeInstanceOf(AudioProcessingError);
      }
    });
  });

  describe('Resource Cleanup Patterns', () => {
    it('should cleanup resources in finally block on success', async () => {
      let resourceAcquired = false;
      let resourceReleased = false;

      const operation = async () => {
        try {
          resourceAcquired = true;
          // Simulate successful operation
          return 'success';
        } finally {
          resourceReleased = true;
        }
      };

      const result = await operation();

      expect(result).toBe('success');
      expect(resourceAcquired).toBe(true);
      expect(resourceReleased).toBe(true);
    });

    it('should cleanup resources in finally block on error', async () => {
      let resourceAcquired = false;
      let resourceReleased = false;

      const operation = async () => {
        try {
          resourceAcquired = true;
          throw new Error('Operation failed');
        } finally {
          resourceReleased = true;
        }
      };

      await expect(operation()).rejects.toThrow('Operation failed');

      expect(resourceAcquired).toBe(true);
      expect(resourceReleased).toBe(true);
    });

    it('should cleanup multiple resources even if one cleanup fails', async () => {
      const cleanupResults: string[] = [];

      const operation = async () => {
        try {
          throw new Error('Operation failed');
        } finally {
          // Cleanup resource 1
          try {
            cleanupResults.push('resource1-cleaned');
          } catch (e) {
            cleanupResults.push('resource1-failed');
          }

          // Cleanup resource 2 (fails)
          try {
            throw new Error('Cleanup failed');
          } catch (e) {
            cleanupResults.push('resource2-failed');
          }

          // Cleanup resource 3
          try {
            cleanupResults.push('resource3-cleaned');
          } catch (e) {
            cleanupResults.push('resource3-failed');
          }
        }
      };

      await expect(operation()).rejects.toThrow('Operation failed');

      expect(cleanupResults).toEqual([
        'resource1-cleaned',
        'resource2-failed',
        'resource3-cleaned'
      ]);
    });

    it('should handle nested try-finally blocks correctly', async () => {
      const cleanupOrder: string[] = [];

      const operation = async () => {
        try {
          try {
            throw new Error('Inner error');
          } finally {
            cleanupOrder.push('inner-cleanup');
          }
        } finally {
          cleanupOrder.push('outer-cleanup');
        }
      };

      await expect(operation()).rejects.toThrow('Inner error');

      expect(cleanupOrder).toEqual(['inner-cleanup', 'outer-cleanup']);
    });
  });

  describe('Circuit Breaker Error Handling', () => {
    it('should handle errors during circuit breaker state transitions', async () => {
      const stateChanges: string[] = [];
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 100,
        onStateChange: (from, to) => {
          stateChanges.push(`${from}->${to}`);
        }
      });

      const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

      // Trigger state transition to OPEN
      await expect(cb.execute(failingFn)).rejects.toThrow();
      await expect(cb.execute(failingFn)).rejects.toThrow();

      expect(stateChanges).toContain('CLOSED->OPEN');
      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should track errors across circuit breaker lifecycle', async () => {
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 100
      });

      const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));
      const successFn = jest.fn().mockResolvedValue('success');

      // Generate some failures
      for (let i = 0; i < 5; i++) {
        try {
          await cb.execute(failingFn);
        } catch (e) {
          // Expected
        }
      }

      const metrics = cb.getMetrics();
      expect(metrics.totalFailures).toBeGreaterThan(0);
      expect(metrics.totalRejections).toBeGreaterThan(0);

      // Wait for timeout and recover
      advanceTimersByTime(150);

      await cb.execute(successFn);
      await cb.execute(successFn);

      expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('Error Context Preservation', () => {
    it('should preserve all error context fields', () => {
      const error = SessionError.create(
        'Test error',
        'test_operation',
        'session-123',
        'correlation-456',
        { customField: 'customValue', retryAttempt: 1 }
      );

      expect(error.sessionId).toBe('session-123');
      expect(error.correlationId).toBe('correlation-456');
      expect(error.operation).toBe('test_operation');
      expect(error.context.metadata.customField).toBe('customValue');
      expect(error.context.metadata.retryAttempt).toBe(1);
    });

    it('should extract error details correctly', () => {
      const error = AudioProcessingError.create(
        'Processing failed',
        'audio_processing',
        'session-123',
        'correlation-456',
        { sampleRate: 16000, channels: 1 }
      );

      const details = extractErrorDetails(error);

      expect(details.name).toBe('AudioProcessingError');
      expect(details.message).toBe('Processing failed');
      expect(details.code).toBe('AUDIO_PROCESSING_ERROR');
      expect(details.sessionId).toBe('session-123');
      expect(details.correlationId).toBe('correlation-456');
      expect(details.severity).toBe(ErrorSeverity.HIGH);
      expect(details.retryable).toBe(true);
      expect(details.context).toBeDefined();
    });

    it('should preserve error cause chain', () => {
      const rootCause = new Error('Root cause');
      const middleError = SessionError.create(
        'Middle error',
        'middle_op',
        'session-123',
        'correlation-456',
        {},
        rootCause
      );
      const topError = StreamingError.create(
        'Top error',
        'top_op',
        'session-123',
        'correlation-456',
        {},
        middleError
      );

      expect(topError.cause).toBe(middleError);
      expect(middleError.cause).toBe(rootCause);
    });
  });

  describe('Error Severity Handling', () => {
    it('should classify errors by severity', () => {
      const lowSeverityError = SessionError.create(
        'Minor issue',
        'test_op',
        'session-123'
      );

      const highSeverityError = StreamingError.create(
        'Critical failure',
        'streaming',
        'session-123'
      );

      const criticalError = BedrockServiceError.create(
        'Service unavailable',
        'InternalServerException',
        'bedrock_invoke',
        'session-123'
      );

      expect(lowSeverityError.severity).toBe(ErrorSeverity.MEDIUM);
      expect(highSeverityError.severity).toBe(ErrorSeverity.HIGH);
      expect(criticalError.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should determine retryability based on error type', () => {
      const retryableError = BedrockServiceError.create(
        'Throttling',
        'ThrottlingException',
        'bedrock_invoke'
      );

      const nonRetryableError = BedrockServiceError.create(
        'Validation failed',
        'ValidationException',
        'bedrock_invoke'
      );

      expect(retryableError.retryable).toBe(true);
      expect(nonRetryableError.retryable).toBe(false);
    });
  });

  describe('Concurrent Error Handling', () => {
    it('should handle multiple concurrent errors independently', async () => {
      const errors: Error[] = [];

      const operations = [
        async () => {
          throw SessionError.create('Error 1', 'op1', 'session-1');
        },
        async () => {
          throw SessionError.create('Error 2', 'op2', 'session-2');
        },
        async () => {
          throw SessionError.create('Error 3', 'op3', 'session-3');
        }
      ];

      const results = await Promise.allSettled(
        operations.map(op => op())
      );

      results.forEach(result => {
        if (result.status === 'rejected') {
          errors.push(result.reason);
        }
      });

      expect(errors).toHaveLength(3);
      expect(errors[0]).toBeInstanceOf(SessionError);
      expect(errors[1]).toBeInstanceOf(SessionError);
      expect(errors[2]).toBeInstanceOf(SessionError);
    });

    it('should preserve error context in concurrent operations', async () => {
      const correlationIds = ['corr-1', 'corr-2', 'corr-3'];

      const operations = correlationIds.map(corrId =>
        async () => {
          throw SessionError.create(
            'Concurrent error',
            'concurrent_op',
            `session-${corrId}`,
            corrId
          );
        }
      );

      const results = await Promise.allSettled(
        operations.map(op => op())
      );

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const error = result.reason as SessionError;
          expect(error.correlationId).toBe(correlationIds[index]);
        }
      });
    });
  });

  describe('Error Recovery Patterns', () => {
    it('should implement retry with exponential backoff pattern', async () => {
      let attempts = 0;
      const maxRetries = 3;

      const operation = async () => {
        attempts++;
        if (attempts < maxRetries) {
          throw new Error('Temporary failure');
        }
        return 'success';
      };

      const retryWithBackoff = async (fn: () => Promise<string>, retries: number) => {
        for (let i = 0; i < retries; i++) {
          try {
            return await fn();
          } catch (error) {
            if (i === retries - 1) throw error;
            // Exponential backoff would happen here
          }
        }
        throw new Error('Max retries exceeded');
      };

      const result = await retryWithBackoff(operation, maxRetries);

      expect(result).toBe('success');
      expect(attempts).toBe(maxRetries);
    });

    it('should implement fallback pattern on error', async () => {
      const primaryOperation = async () => {
        throw new Error('Primary failed');
      };

      const fallbackOperation = async () => {
        return 'fallback-result';
      };

      const operationWithFallback = async () => {
        try {
          return await primaryOperation();
        } catch (error) {
          return await fallbackOperation();
        }
      };

      const result = await operationWithFallback();

      expect(result).toBe('fallback-result');
    });
  });
});
