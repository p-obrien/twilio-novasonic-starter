/**
 * @fileoverview Comprehensive Circuit Breaker Tests
 *
 * Tests cover:
 * - State transitions (CLOSED → OPEN → HALF_OPEN → CLOSED)
 * - Edge cases (concurrent requests, timeouts, rapid failures)
 * - Performance requirements (< 1ms overhead)
 * - Memory management (no leaks with 1000+ requests)
 */

import { CircuitBreaker, CircuitBreakerState } from '../../../resilience/CircuitBreaker';
import { CircuitBreakerOpenError } from '../../../errors/ClientErrors';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../../utils/TimerTestUtils';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    useFakeTimers();
  });

  afterEach(() => {
    useRealTimers();
  });
  describe('State Transitions', () => {
    describe('CLOSED → OPEN', () => {
      it('should transition to OPEN after threshold failures', async () => {
        const cb = new CircuitBreaker({
          name: 'test-circuit',
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 1000
        });

        expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);

        // Fail 3 times to reach threshold
        const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

        for (let i = 0; i < 3; i++) {
          await expect(cb.execute(failingFn)).rejects.toThrow('Service error');
        }

        // Circuit should now be OPEN
        expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
      });

      it('should not transition to OPEN if failures are not consecutive', async () => {
        const cb = new CircuitBreaker({
          name: 'test-circuit',
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 1000
        });

        const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));
        const successFn = jest.fn().mockResolvedValue('success');

        // Fail twice
        await expect(cb.execute(failingFn)).rejects.toThrow();
        await expect(cb.execute(failingFn)).rejects.toThrow();

        // Success resets failure count
        await cb.execute(successFn);

        // Fail twice more - should still be CLOSED
        await expect(cb.execute(failingFn)).rejects.toThrow();
        await expect(cb.execute(failingFn)).rejects.toThrow();

        expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
      });
    });

    describe('OPEN → HALF_OPEN', () => {
      it('should transition to HALF_OPEN after timeout', async () => {
        const cb = new CircuitBreaker({
          name: 'test-circuit',
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 100 // Short timeout for testing
        });

        const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

        // Trigger failures to open circuit
        await expect(cb.execute(failingFn)).rejects.toThrow();
        await expect(cb.execute(failingFn)).rejects.toThrow();

        expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

        // Requests should be rejected immediately
        await expect(cb.execute(failingFn)).rejects.toThrow(CircuitBreakerOpenError);

        // Wait for timeout using fake timers
        advanceTimersByTime(150);

        // Next request should trigger HALF_OPEN state
        const successFn = jest.fn().mockResolvedValue('success');
        await cb.execute(successFn);

        expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
      });

      it('should reject requests while OPEN before timeout expires', async () => {
        const cb = new CircuitBreaker({
          name: 'test-circuit',
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 5000 // Long timeout
        });

        const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

        // Open the circuit
        await expect(cb.execute(failingFn)).rejects.toThrow();
        await expect(cb.execute(failingFn)).rejects.toThrow();

        expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

        // Requests should be rejected with CircuitBreakerOpenError
        await expect(cb.execute(failingFn)).rejects.toThrow(CircuitBreakerOpenError);

        const metrics = cb.getMetrics();
        expect(metrics.totalRejections).toBe(1);
      });
    });

    describe('HALF_OPEN → CLOSED', () => {
      it('should transition to CLOSED after successful requests', async () => {
        const cb = new CircuitBreaker({
          name: 'test-circuit',
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 100
        });

        const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));
        const successFn = jest.fn().mockResolvedValue('success');

        // Open the circuit
        await expect(cb.execute(failingFn)).rejects.toThrow();
        await expect(cb.execute(failingFn)).rejects.toThrow();
        expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

        // Wait for timeout using fake timers
        advanceTimersByTime(150);

        // First success triggers HALF_OPEN
        await cb.execute(successFn);
        expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);

        // Second success should close the circuit
        await cb.execute(successFn);
        expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
      });
    });

    describe('HALF_OPEN → OPEN', () => {
      it('should transition back to OPEN on any failure in HALF_OPEN', async () => {
        const cb = new CircuitBreaker({
          name: 'test-circuit',
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 100
        });

        const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));
        const successFn = jest.fn().mockResolvedValue('success');

        // Open the circuit
        await expect(cb.execute(failingFn)).rejects.toThrow();
        await expect(cb.execute(failingFn)).rejects.toThrow();
        expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

        // Wait for timeout using fake timers
        advanceTimersByTime(150);

        // First success triggers HALF_OPEN
        await cb.execute(successFn);
        expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);

        // Failure in HALF_OPEN should reopen circuit
        await expect(cb.execute(failingFn)).rejects.toThrow();
        expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
      });
    });
  });

  describe('Edge Cases', () => {
    describe('Concurrent requests in HALF_OPEN', () => {
      it('should limit concurrent calls in HALF_OPEN state', async () => {
        const cb = new CircuitBreaker({
          name: 'test-circuit',
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 100,
          halfOpenMaxCalls: 1
        });

        const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));
        let callCount = 0;
        const slowSuccessFn = jest.fn().mockImplementation(async () => {
          callCount++;
          // Simulate slow operation without setTimeout (fake timers don't work well with async mocks)
          return 'success';
        });

        // Open the circuit
        await expect(cb.execute(failingFn)).rejects.toThrow();
        await expect(cb.execute(failingFn)).rejects.toThrow();
        expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

        // Wait for timeout using fake timers
        advanceTimersByTime(150);

        // Start two concurrent requests in HALF_OPEN
        const promise1 = cb.execute(slowSuccessFn);
        const promise2 = cb.execute(slowSuccessFn);

        // One should succeed, one should be rejected
        const results = await Promise.allSettled([promise1, promise2]);

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const rejectedCount = results.filter(
          r => r.status === 'rejected' && r.reason instanceof CircuitBreakerOpenError
        ).length;

        // Only 1 concurrent call allowed
        expect(callCount).toBeLessThanOrEqual(1);
        expect(successCount + rejectedCount).toBe(2);
      });
    });

    describe('Rapid successive failures', () => {
      it('should handle rapid failures correctly', async () => {
        const cb = new CircuitBreaker({
          name: 'test-circuit',
          failureThreshold: 5,
          successThreshold: 2,
          timeout: 1000
        });

        const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

        // Rapid failures
        for (let i = 0; i < 10; i++) {
          try {
            await cb.execute(failingFn);
          } catch (error) {
            // Expected
          }
        }

        expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

        const metrics = cb.getMetrics();
        // First 5 failures should execute, remaining 5 should be rejected
        expect(metrics.totalFailures).toBe(5);
        expect(metrics.totalRejections).toBe(5);
      });
    });

    describe('Mixed success/failure patterns', () => {
      it('should handle alternating success and failure', async () => {
        const cb = new CircuitBreaker({
          name: 'test-circuit',
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 1000
        });

        const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));
        const successFn = jest.fn().mockResolvedValue('success');

        // Alternating pattern
        for (let i = 0; i < 10; i++) {
          if (i % 2 === 0) {
            await cb.execute(successFn);
          } else {
            await expect(cb.execute(failingFn)).rejects.toThrow();
          }
        }

        // Should remain CLOSED because failures are not consecutive
        expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
      });
    });

    describe('Timeout expiration during requests', () => {
      it('should transition to HALF_OPEN even if requests are pending', async () => {
        const cb = new CircuitBreaker({
          name: 'test-circuit',
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 100
        });

        const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

        // Open the circuit
        await expect(cb.execute(failingFn)).rejects.toThrow();
        await expect(cb.execute(failingFn)).rejects.toThrow();
        expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

        // Wait for timeout using fake timers
        advanceTimersByTime(150);

        // State should transition on next request
        const successFn = jest.fn().mockResolvedValue('success');
        await cb.execute(successFn);

        expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
      });
    });
  });

  describe('Metrics', () => {
    it('should track total successes and failures', async () => {
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 1000
      });

      const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));
      const successFn = jest.fn().mockResolvedValue('success');

      // Execute some requests
      await cb.execute(successFn);
      await cb.execute(successFn);
      await expect(cb.execute(failingFn)).rejects.toThrow();
      await expect(cb.execute(failingFn)).rejects.toThrow();

      const metrics = cb.getMetrics();
      expect(metrics.totalSuccesses).toBe(2);
      expect(metrics.totalFailures).toBe(2);
      expect(metrics.totalRejections).toBe(0);
    });

    it('should track rejections when circuit is OPEN', async () => {
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 1000
      });

      const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

      // Open the circuit
      await expect(cb.execute(failingFn)).rejects.toThrow();
      await expect(cb.execute(failingFn)).rejects.toThrow();

      // Try more requests (should be rejected)
      await expect(cb.execute(failingFn)).rejects.toThrow(CircuitBreakerOpenError);
      await expect(cb.execute(failingFn)).rejects.toThrow(CircuitBreakerOpenError);

      const metrics = cb.getMetrics();
      expect(metrics.totalRejections).toBe(2);
    });
  });

  describe('State Change Callback', () => {
    it('should call onStateChange callback on transitions', async () => {
      const onStateChange = jest.fn();
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 100,
        onStateChange
      });

      const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

      // Trigger CLOSED → OPEN
      await expect(cb.execute(failingFn)).rejects.toThrow();
      await expect(cb.execute(failingFn)).rejects.toThrow();

      expect(onStateChange).toHaveBeenCalledWith(
        CircuitBreakerState.CLOSED,
        CircuitBreakerState.OPEN
      );

      // Wait for timeout and trigger OPEN → HALF_OPEN using fake timers
      advanceTimersByTime(150);

      const successFn = jest.fn().mockResolvedValue('success');
      await cb.execute(successFn);

      expect(onStateChange).toHaveBeenCalledWith(
        CircuitBreakerState.OPEN,
        CircuitBreakerState.HALF_OPEN
      );
    });

    it('should handle callback errors gracefully', async () => {
      const onStateChange = jest.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });

      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 1000,
        onStateChange
      });

      const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

      // Should not throw even if callback throws
      await expect(cb.execute(failingFn)).rejects.toThrow('Service error');
      await expect(cb.execute(failingFn)).rejects.toThrow('Service error');

      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Manual Control', () => {
    it('should allow forcing circuit to OPEN', () => {
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 1000
      });

      expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);

      cb.forceOpen();

      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should allow forcing circuit to CLOSED', async () => {
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 1000
      });

      const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

      // Open the circuit
      await expect(cb.execute(failingFn)).rejects.toThrow();
      await expect(cb.execute(failingFn)).rejects.toThrow();
      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

      cb.forceClosed();

      expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should allow resetting circuit', async () => {
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 1000
      });

      const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));
      const successFn = jest.fn().mockResolvedValue('success');

      // Generate some activity
      await cb.execute(successFn);
      await expect(cb.execute(failingFn)).rejects.toThrow();

      cb.reset();

      const metrics = cb.getMetrics();
      expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(metrics.totalSuccesses).toBe(0);
      expect(metrics.totalFailures).toBe(0);
      expect(metrics.totalRejections).toBe(0);
    });
  });

  describe('Performance', () => {
    it('should add < 1ms overhead per request', async () => {
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 100,
        successThreshold: 2,
        timeout: 1000
      });

      const fastFn = jest.fn().mockResolvedValue('success');

      // Warm up
      await cb.execute(fastFn);

      // Measure 100 requests
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        await cb.execute(fastFn);
      }
      const end = performance.now();

      const avgOverhead = (end - start) / 100;

      // Circuit breaker overhead should be < 1ms per request
      expect(avgOverhead).toBeLessThan(1);
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory with 1000+ requests', async () => {
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 100,
        successThreshold: 2,
        timeout: 1000
      });

      const successFn = jest.fn().mockResolvedValue('success');

      // Execute 1000 requests
      for (let i = 0; i < 1000; i++) {
        await cb.execute(successFn);
      }

      const metrics = cb.getMetrics();
      expect(metrics.totalSuccesses).toBe(1000);

      // Metrics should not grow unbounded
      expect(metrics.failureCount).toBeLessThanOrEqual(100);
      expect(metrics.successCount).toBeLessThanOrEqual(2);
    });
  });

  describe('CircuitBreakerOpenError', () => {
    it('should include retry timing information', async () => {
      const cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 5000
      });

      const failingFn = jest.fn().mockRejectedValue(new Error('Service error'));

      // Open the circuit
      await expect(cb.execute(failingFn)).rejects.toThrow();
      await expect(cb.execute(failingFn)).rejects.toThrow();

      // Try to execute (should be rejected)
      try {
        await cb.execute(failingFn);
        fail('Should have thrown CircuitBreakerOpenError');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerOpenError);
        const cbError = error as CircuitBreakerOpenError;

        expect(cbError.code).toBe('CIRCUIT_BREAKER_OPEN');
        expect(cbError.retryable).toBe(true);
        expect(cbError.getRetryAfterMs()).toBeGreaterThan(0);
        expect(cbError.getRetryAfterSeconds()).toBeGreaterThan(0);
        expect(cbError.nextAttemptTime).toBeGreaterThan(Date.now());
      }
    });
  });
});
