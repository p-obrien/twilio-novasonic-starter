/**
 * Timer Test Utilities
 * 
 * Provides utilities for managing fake timers in tests.
 * Ensures consistent timer handling and prevents common pitfalls.
 * 
 * Requirements: 7.2
 */

/**
 * Setup fake timers for a test suite
 * Call this in beforeEach to enable fake timers
 */
export function useFakeTimers(): void {
  jest.useFakeTimers();
}

/**
 * Restore real timers after a test suite
 * Call this in afterEach to restore real timers
 */
export function useRealTimers(): void {
  jest.useRealTimers();
}

/**
 * Advance timers by a specific amount
 * Useful for testing time-dependent behavior
 * 
 * @param ms - Milliseconds to advance
 */
export function advanceTimersByTime(ms: number): void {
  jest.advanceTimersByTime(ms);
}

/**
 * Run all pending timers
 * Executes all queued timer callbacks
 */
export function runAllTimers(): void {
  jest.runAllTimers();
}

/**
 * Run only currently pending timers
 * Does not execute timers created during execution
 */
export function runOnlyPendingTimers(): void {
  jest.runOnlyPendingTimers();
}

/**
 * Clear all pending timers
 * Removes all queued timer callbacks
 */
export function clearAllTimers(): void {
  jest.clearAllTimers();
}

/**
 * Get the number of pending timers
 * Useful for debugging timer-related issues
 */
export function getTimerCount(): number {
  return jest.getTimerCount();
}

/**
 * Setup and teardown fake timers for a test suite
 * Returns cleanup function to call in afterEach
 * 
 * @example
 * describe('My Test Suite', () => {
 *   const cleanup = setupFakeTimers();
 *   
 *   afterEach(cleanup);
 *   
 *   it('should work with fake timers', () => {
 *     // Test code
 *   });
 * });
 */
export function setupFakeTimers(): () => void {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  return () => {
    jest.useRealTimers();
  };
}

/**
 * Wait for a specific amount of time using fake timers
 * Advances timers and flushes promises
 * 
 * @param ms - Milliseconds to wait
 */
export async function waitForTime(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await Promise.resolve(); // Flush promises
}

/**
 * Wait for all timers and promises to complete
 * Useful for ensuring all async operations finish
 */
export async function flushTimersAndPromises(): Promise<void> {
  jest.runAllTimers();
  await Promise.resolve();
  await Promise.resolve(); // Double flush for nested promises
}

/**
 * Test helper that runs a function with fake timers
 * Automatically sets up and tears down fake timers
 * 
 * @param fn - Test function to run
 * @returns Result of the test function
 */
export async function withFakeTimers<T>(
  fn: () => Promise<T> | T
): Promise<T> {
  jest.useFakeTimers();
  
  try {
    const result = await fn();
    return result;
  } finally {
    jest.useRealTimers();
  }
}

/**
 * Mock setTimeout with immediate execution
 * Useful for tests that need setTimeout to execute immediately
 * 
 * @returns Cleanup function to restore original setTimeout
 */
export function mockSetTimeoutImmediate(): () => void {
  const originalSetTimeout = global.setTimeout;
  
  (global.setTimeout as any) = (fn: () => void, _delay: number) => {
    fn();
    return 0 as any;
  };
  
  return () => {
    global.setTimeout = originalSetTimeout;
  };
}

/**
 * Mock setInterval with immediate execution
 * Useful for tests that need setInterval to execute immediately
 * 
 * @returns Cleanup function to restore original setInterval
 */
export function mockSetIntervalImmediate(): () => void {
  const originalSetInterval = global.setInterval;
  
  (global.setInterval as any) = (fn: () => void, _delay: number) => {
    fn();
    return 0 as any;
  };
  
  return () => {
    global.setInterval = originalSetInterval;
  };
}

/**
 * Timer test configuration
 */
export interface TimerTestConfig {
  /**
   * Whether to use fake timers (default: true)
   */
  useFake?: boolean;
  
  /**
   * Whether to automatically advance timers (default: false)
   */
  autoAdvance?: boolean;
  
  /**
   * Time to advance on each step (default: 20ms)
   */
  advanceStep?: number;
}

/**
 * Configure timer behavior for a test suite
 * 
 * @param config - Timer configuration
 * @returns Cleanup function
 */
export function configureTimers(config: TimerTestConfig = {}): () => void {
  const {
    useFake = true,
    autoAdvance = false,
    advanceStep = 20
  } = config;

  beforeEach(() => {
    if (useFake) {
      jest.useFakeTimers();
      
      if (autoAdvance) {
        // Auto-advance timers on each tick
        const originalSetTimeout = global.setTimeout;
        (global.setTimeout as any) = (fn: () => void, delay: number) => {
          jest.advanceTimersByTime(Math.min(delay, advanceStep));
          return originalSetTimeout(fn, 0);
        };
      }
    }
  });

  return () => {
    if (useFake) {
      jest.useRealTimers();
    }
  };
}

/**
 * Verify that no timers are pending
 * Useful for ensuring tests clean up properly
 */
export function expectNoTimersPending(): void {
  const count = jest.getTimerCount();
  if (count > 0) {
    throw new Error(`Expected no pending timers, but found ${count}`);
  }
}

/**
 * Verify that a specific number of timers are pending
 * 
 * @param expected - Expected number of pending timers
 */
export function expectTimerCount(expected: number): void {
  const count = jest.getTimerCount();
  if (count !== expected) {
    throw new Error(`Expected ${expected} pending timers, but found ${count}`);
  }
}
