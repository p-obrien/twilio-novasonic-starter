/**
 * @fileoverview Retry Logic and Backoff Behavior Tests
 *
 * Tests verify retry mechanisms including:
 * - Exponential backoff calculation
 * - Retry condition evaluation
 * - Maximum retry limits
 * - Jitter application
 * - Error classification for retryability
 *
 * **Validates: Requirements 8.2**
 */

import {
  withRetry,
  withRetryResult,
  createRetryConfigForErrorType,
  DEFAULT_RETRY_CONFIG,
  RetryConfig
} from '../../../utils/RetryUtils';
import { BedrockServiceError, SessionError } from '../../../errors/ClientErrors';

describe('RetryUtils', () => {
  // Don't use fake timers for retry tests - they interfere with async retry logic
  // The retry logic uses real setTimeout which doesn't work well with fake timers

  describe('withRetry', () => {
    it('should succeed on first attempt without retrying', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await withRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValue('success');

      const config: Partial<RetryConfig> = {
        maxRetries: 3,
        initialDelayMs: 10, // Use short delays for tests
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      const result = await withRetry(operation, config);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw error after max retries exhausted', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Network timeout'));

      const config: Partial<RetryConfig> = {
        maxRetries: 2,
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      await expect(withRetry(operation, config)).rejects.toThrow('Network timeout');
      expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry non-retryable errors', async () => {
      const validationError = BedrockServiceError.create(
        'Validation failed',
        'ValidationException',
        'bedrock_invoke'
      );

      const operation = jest.fn().mockRejectedValue(validationError);

      const config: Partial<RetryConfig> = {
        maxRetries: 3,
        initialDelayMs: 100
      };

      await expect(withRetry(operation, config)).rejects.toThrow(validationError);
      expect(operation).toHaveBeenCalledTimes(1); // No retries
    });

    it('should retry retryable Bedrock errors', async () => {
      const throttlingError = BedrockServiceError.create(
        'Rate limit exceeded',
        'ThrottlingException',
        'bedrock_invoke'
      );

      const operation = jest
        .fn()
        .mockRejectedValueOnce(throttlingError)
        .mockResolvedValue('success');

      const config: Partial<RetryConfig> = {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      const result = await withRetry(operation, config);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should call onRetry callback on each retry attempt', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValue('success');

      const onRetry = jest.fn();

      const config: Partial<RetryConfig> = {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffMultiplier: 2,
        jitterFactor: 0,
        onRetry
      };

      await withRetry(operation, config);

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 20);
    });

    it('should use custom shouldRetry function when provided', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Retry this'))
        .mockRejectedValueOnce(new Error('Do not retry this'))
        .mockResolvedValue('success');

      const shouldRetry = jest.fn((error: unknown, attempt: number) => {
        const err = error as Error;
        return err.message === 'Retry this';
      });

      const config: Partial<RetryConfig> = {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0,
        shouldRetry
      };

      await expect(withRetry(operation, config)).rejects.toThrow('Do not retry this');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(shouldRetry).toHaveBeenCalledTimes(2);
    });
  });

  describe('withRetryResult', () => {
    it('should return success result with attempt count', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('success');

      const config: Partial<RetryConfig> = {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      const result = await withRetryResult(operation, config);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(2);
      expect(result.totalDelayMs).toBeGreaterThanOrEqual(10);
      expect(result.error).toBeUndefined();
    });

    it('should return failure result after max retries', async () => {
      const error = new Error('Throttling exception');
      const operation = jest.fn().mockRejectedValue(error);

      const config: Partial<RetryConfig> = {
        maxRetries: 2,
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      const result = await withRetryResult(operation, config);

      expect(result.success).toBe(false);
      expect(result.result).toBeUndefined();
      expect(result.attempts).toBe(3);
      expect(result.totalDelayMs).toBeGreaterThanOrEqual(20);
      expect(result.error).toBe(error);
    });

    it('should track total delay across retries', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockResolvedValue('success');

      const config: Partial<RetryConfig> = {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffMultiplier: 2,
        jitterFactor: 0
      };

      const result = await withRetryResult(operation, config);

      expect(result.success).toBe(true);
      expect(result.totalDelayMs).toBeGreaterThanOrEqual(30); // 10 + 20
    });
  });

  describe('Exponential Backoff', () => {
    it('should apply exponential backoff between retries', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('success');

      const onRetry = jest.fn();

      const config: Partial<RetryConfig> = {
        maxRetries: 4,
        initialDelayMs: 10,
        backoffMultiplier: 2,
        jitterFactor: 0,
        onRetry
      };

      await withRetry(operation, config);

      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 20);
      expect(onRetry).toHaveBeenNthCalledWith(3, expect.any(Error), 3, 40);
    });

    it('should cap delay at maxDelayMs', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValue('success');

      const onRetry = jest.fn();

      const config: Partial<RetryConfig> = {
        maxRetries: 3,
        initialDelayMs: 100,
        backoffMultiplier: 10,
        maxDelayMs: 200,
        jitterFactor: 0,
        onRetry
      };

      await withRetry(operation, config);

      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 100);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 200); // Capped at maxDelayMs
    });

    it('should apply jitter to delay', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValue('success');

      const onRetry = jest.fn();

      const config: Partial<RetryConfig> = {
        maxRetries: 2,
        initialDelayMs: 100,
        backoffMultiplier: 1,
        jitterFactor: 0.1, // 10% jitter
        onRetry
      };

      await withRetry(operation, config);

      expect(onRetry).toHaveBeenCalledTimes(1);
      const actualDelay = onRetry.mock.calls[0][2];
      expect(actualDelay).toBeGreaterThanOrEqual(100);
      expect(actualDelay).toBeLessThanOrEqual(110);
    });
  });

  describe('Error Classification', () => {
    it('should retry network errors', async () => {
      const networkErrors = [
        new Error('ECONNRESET'),
        new Error('ENOTFOUND'),
        new Error('ECONNREFUSED'),
        new Error('Network timeout'),
        new Error('Connection failed')
      ];

      for (const error of networkErrors) {
        const operation = jest
          .fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValue('success');

        const config: Partial<RetryConfig> = {
          maxRetries: 2,
          initialDelayMs: 10,
          backoffMultiplier: 1,
          jitterFactor: 0
        };

        const result = await withRetry(operation, config);

        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(2);

        jest.clearAllMocks();
      }
    });

    it('should retry throttling errors', async () => {
      const throttlingErrors = [
        new Error('Throttling exception'),
        new Error('Rate limit exceeded'),
        new Error('Too many requests'),
        new Error('Service unavailable')
      ];

      for (const error of throttlingErrors) {
        const operation = jest
          .fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValue('success');

        const config: Partial<RetryConfig> = {
          maxRetries: 2,
          initialDelayMs: 10,
          backoffMultiplier: 1,
          jitterFactor: 0
        };

        const result = await withRetry(operation, config);

        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(2);

        jest.clearAllMocks();
      }
    });

    it('should not retry unknown errors by default', async () => {
      const unknownError = new Error('Unknown error type');

      const operation = jest.fn().mockRejectedValue(unknownError);

      const config: Partial<RetryConfig> = {
        maxRetries: 3,
        initialDelayMs: 100
      };

      await expect(withRetry(operation, config)).rejects.toThrow(unknownError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should respect BedrockClientError retryability', async () => {
      const retryableError = BedrockServiceError.create(
        'Internal server error',
        'InternalServerException',
        'bedrock_invoke'
      );

      const nonRetryableError = BedrockServiceError.create(
        'Access denied',
        'AccessDeniedException',
        'bedrock_invoke'
      );

      // Test retryable error
      const retryableOp = jest
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      const config: Partial<RetryConfig> = {
        maxRetries: 2,
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      await withRetry(retryableOp, config);

      expect(retryableOp).toHaveBeenCalledTimes(2);

      // Test non-retryable error
      const nonRetryableOp = jest.fn().mockRejectedValue(nonRetryableError);

      await expect(withRetry(nonRetryableOp, config)).rejects.toThrow(nonRetryableError);
      expect(nonRetryableOp).toHaveBeenCalledTimes(1);
    });
  });

  describe('createRetryConfigForErrorType', () => {
    it('should create network error config with aggressive retries', () => {
      const config = createRetryConfigForErrorType('network');

      expect(config.maxRetries).toBe(5);
      expect(config.initialDelayMs).toBe(500);
      expect(config.maxDelayMs).toBe(10000);
      expect(config.backoffMultiplier).toBe(1.5);
    });

    it('should create service error config with moderate retries', () => {
      const config = createRetryConfigForErrorType('service');

      expect(config.maxRetries).toBe(3);
      expect(config.initialDelayMs).toBe(1000);
      expect(config.maxDelayMs).toBe(30000);
      expect(config.backoffMultiplier).toBe(2);
    });

    it('should create validation error config with no retries', () => {
      const config = createRetryConfigForErrorType('validation');

      expect(config.maxRetries).toBe(0);
      expect(config.initialDelayMs).toBe(0);
      expect(config.maxDelayMs).toBe(0);
    });

    it('should create critical error config with minimal retries', () => {
      const config = createRetryConfigForErrorType('critical');

      expect(config.maxRetries).toBe(1);
      expect(config.initialDelayMs).toBe(100);
      expect(config.maxDelayMs).toBe(1000);
      expect(config.backoffMultiplier).toBe(1.2);
    });
  });

  describe('Retry with Correlation ID', () => {
    it('should preserve correlation ID across retries', async () => {
      const correlationId = 'test-correlation-123';
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('ENOTFOUND'))
        .mockResolvedValue('success');

      const onRetry = jest.fn();

      const config: Partial<RetryConfig> = {
        maxRetries: 2,
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0,
        onRetry
      };

      await withRetry(operation, config, correlationId);

      expect(operation).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 10);
    });
  });

  describe('Concurrent Retries', () => {
    it('should handle multiple concurrent retry operations independently', async () => {
      const operation1 = jest
        .fn()
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValue('op1-success');

      const operation2 = jest
        .fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValue('op2-success');

      const config: Partial<RetryConfig> = {
        maxRetries: 2,
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      const [result1, result2] = await Promise.all([
        withRetry(operation1, config),
        withRetry(operation2, config)
      ]);

      expect(result1).toBe('op1-success');
      expect(result2).toBe('op2-success');
      expect(operation1).toHaveBeenCalledTimes(2);
      expect(operation2).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero max retries', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Network error'));

      const config: Partial<RetryConfig> = {
        maxRetries: 0,
        initialDelayMs: 10
      };

      await expect(withRetry(operation, config)).rejects.toThrow('Network error');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle operation that throws synchronously', async () => {
      const operation = jest.fn().mockImplementation(() => {
        throw new Error('ECONNREFUSED');
      });

      const config: Partial<RetryConfig> = {
        maxRetries: 2,
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      await expect(withRetry(operation, config)).rejects.toThrow('ECONNREFUSED');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should handle very large backoff multipliers', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Throttling'))
        .mockResolvedValue('success');

      const onRetry = jest.fn();

      const config: Partial<RetryConfig> = {
        maxRetries: 2,
        initialDelayMs: 100,
        backoffMultiplier: 100,
        maxDelayMs: 500,
        jitterFactor: 0,
        onRetry
      };

      await withRetry(operation, config);

      // First retry: 100ms (initial delay)
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 100);
    });

    it('should handle operation that succeeds after exact max retries', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockResolvedValue('success');

      const config: Partial<RetryConfig> = {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      const result = await withRetry(operation, config);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });
  });

  describe('Default Configuration', () => {
    it('should use default config when no config provided', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Too many requests'))
        .mockResolvedValue('success');

      // Override default to use shorter delay for testing
      const config: Partial<RetryConfig> = {
        initialDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      const result = await withRetry(operation, config);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should merge partial config with defaults', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Internal server error'))
        .mockResolvedValue('success');

      const config: Partial<RetryConfig> = {
        maxRetries: 5,
        initialDelayMs: 10, // Override for testing
        backoffMultiplier: 1,
        jitterFactor: 0
      };

      const result = await withRetry(operation, config);

      expect(result).toBe('success');
    });
  });
});
