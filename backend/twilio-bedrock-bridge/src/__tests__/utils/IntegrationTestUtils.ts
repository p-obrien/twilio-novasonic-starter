/**
 * Integration Test Utilities
 * 
 * Utilities for integration tests including AWS credential checking,
 * resource tracking, and cleanup management.
 * 
 * Requirements: 5.1, 5.3
 */

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

/**
 * Resource cleanup function type
 */
export type CleanupFunction = () => Promise<void>;

/**
 * Tracked resource for cleanup
 */
interface TrackedResource {
  resourceId: string;
  cleanup: CleanupFunction;
  createdAt: number;
}

/**
 * Integration test utilities class
 */
export class IntegrationTestUtils {
  private static resources: Map<string, TrackedResource> = new Map();

  /**
   * Check if AWS credentials are available
   * 
   * @returns true if credentials are configured
   */
  static hasAWSCredentials(): boolean {
    return !!(
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_REGION
    );
  }

  /**
   * Skip integration tests if AWS credentials are not available
   * Logs a helpful message for developers
   * 
   * @returns true if tests should be skipped
   */
  static skipIfNoCredentials(): boolean {
    const skip = !this.hasAWSCredentials();
    
    if (skip) {
      console.log('⏭️  Skipping integration tests - AWS credentials not available');
      console.log('   Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION to run');
      console.log('   Or configure AWS credentials in ~/.aws/credentials');
    }
    
    return skip;
  }

  /**
   * Track a resource for cleanup
   * 
   * @param resourceId - Unique identifier for the resource
   * @param cleanup - Cleanup function to call
   */
  static trackResource(resourceId: string, cleanup: CleanupFunction): void {
    this.resources.set(resourceId, {
      resourceId,
      cleanup,
      createdAt: Date.now()
    });
  }

  /**
   * Clean up a specific resource
   * 
   * @param resourceId - Resource to clean up
   * @returns true if cleanup was successful
   */
  static async cleanupResource(resourceId: string): Promise<boolean> {
    const resource = this.resources.get(resourceId);
    
    if (!resource) {
      return false;
    }

    try {
      await resource.cleanup();
      this.resources.delete(resourceId);
      return true;
    } catch (error) {
      console.error(`Failed to cleanup resource ${resourceId}:`, error);
      return false;
    }
  }

  /**
   * Clean up all tracked resources
   * Should be called in afterEach or afterAll hooks
   * 
   * @returns Array of cleanup results
   */
  static async cleanupAllResources(): Promise<Array<{
    resourceId: string;
    success: boolean;
    error?: Error;
  }>> {
    const results: Array<{
      resourceId: string;
      success: boolean;
      error?: Error;
    }> = [];

    for (const [resourceId, resource] of this.resources.entries()) {
      try {
        await resource.cleanup();
        results.push({ resourceId, success: true });
        this.resources.delete(resourceId);
      } catch (error) {
        results.push({
          resourceId,
          success: false,
          error: error as Error
        });
      }
    }

    return results;
  }

  /**
   * Get count of tracked resources
   * 
   * @returns Number of resources being tracked
   */
  static getTrackedResourceCount(): number {
    return this.resources.size;
  }

  /**
   * Clear all tracked resources without cleanup
   * Use with caution - only for test cleanup
   */
  static clearTrackedResources(): void {
    this.resources.clear();
  }

  /**
   * Create a Bedrock Runtime client for integration tests
   * 
   * @param region - AWS region (defaults to environment variable)
   * @returns BedrockRuntimeClient instance
   */
  static createBedrockClient(region?: string): BedrockRuntimeClient {
    if (!this.hasAWSCredentials()) {
      throw new Error('AWS credentials not available for integration test');
    }

    return new BedrockRuntimeClient({
      region: region || process.env.AWS_REGION || 'us-east-1'
    });
  }

  /**
   * Verify Bedrock response has expected structure
   * 
   * @param response - Response to verify
   * @throws Error if response is invalid
   */
  static verifyBedrockResponse(response: any): void {
    if (!response) {
      throw new Error('Bedrock response is null or undefined');
    }

    if (!response.body) {
      throw new Error('Bedrock response missing body');
    }

    // Verify body is iterable (async iterator)
    if (typeof response.body[Symbol.asyncIterator] !== 'function') {
      throw new Error('Bedrock response body is not an async iterator');
    }
  }

  /**
   * Wait for a condition to be true with timeout
   * 
   * @param condition - Function that returns true when condition is met
   * @param timeout - Maximum wait time in milliseconds
   * @param interval - Check interval in milliseconds
   * @returns Promise that resolves when condition is met
   */
  static async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 10000,
    interval: number = 100
  ): Promise<void> {
    const startTime = Date.now();

    while (true) {
      const result = await condition();
      
      if (result) {
        return;
      }

      if (Date.now() - startTime > timeout) {
        throw new Error(`Timeout waiting for condition after ${timeout}ms`);
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  /**
   * Create a test timeout wrapper
   * Automatically fails test if it exceeds timeout
   * 
   * @param testFn - Test function to wrap
   * @param timeout - Timeout in milliseconds
   * @returns Wrapped test function
   */
  static withTimeout<T>(
    testFn: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return Promise.race([
      testFn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout)
      )
    ]);
  }

  /**
   * Retry a function with exponential backoff
   * Useful for flaky integration tests
   * 
   * @param fn - Function to retry
   * @param maxRetries - Maximum number of retries
   * @param initialDelay - Initial delay in milliseconds
   * @returns Result of function
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
        }
      }
    }

    throw lastError || new Error('Retry failed');
  }

  /**
   * Create a mock Bedrock response for testing
   * 
   * @param audioChunks - Array of audio data chunks
   * @param sampleRate - Sample rate in Hz
   * @returns Mock response object
   */
  static createMockBedrockResponse(
    audioChunks: Buffer[],
    sampleRate: number = 16000
  ): any {
    return {
      body: {
        async *[Symbol.asyncIterator]() {
          for (const chunk of audioChunks) {
            yield {
              audioOutput: {
                audio: chunk.toString('base64'),
                sampleRateHz: sampleRate
              }
            };
          }
        }
      }
    };
  }

  /**
   * Verify test environment is properly configured
   * 
   * @throws Error if environment is not configured correctly
   */
  static verifyTestEnvironment(): void {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Warning: NODE_ENV is not set to "test"');
    }

    // Verify required test dependencies are available
    if (typeof jest === 'undefined') {
      throw new Error('Jest is not available - tests must run with Jest');
    }
  }

  /**
   * Get integration test statistics
   * 
   * @returns Test statistics object
   */
  static getTestStats(): {
    trackedResources: number;
    hasCredentials: boolean;
    environment: string;
  } {
    return {
      trackedResources: this.resources.size,
      hasCredentials: this.hasAWSCredentials(),
      environment: process.env.NODE_ENV || 'unknown'
    };
  }

  /**
   * Create a test session ID with timestamp
   * 
   * @param prefix - Optional prefix for session ID
   * @returns Unique session ID
   */
  static createTestSessionId(prefix: string = 'test'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Log integration test info
   * 
   * @param message - Message to log
   * @param data - Optional data to include
   */
  static logTestInfo(message: string, data?: any): void {
    if (process.env.VERBOSE_TESTS === 'true') {
      console.log(`[Integration Test] ${message}`, data || '');
    }
  }

  /**
   * Setup integration test environment
   * Call this in beforeAll hook
   */
  static setupIntegrationTests(): void {
    this.verifyTestEnvironment();
    this.clearTrackedResources();
    
    if (!this.hasAWSCredentials()) {
      console.log('⚠️  AWS credentials not configured - integration tests will be skipped');
    }
  }

  /**
   * Teardown integration test environment
   * Call this in afterAll hook
   * 
   * @returns Cleanup results
   */
  static async teardownIntegrationTests(): Promise<void> {
    const results = await this.cleanupAllResources();
    
    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      console.error(`Failed to cleanup ${failed.length} resources:`, failed);
    }
  }

  /**
   * Check if running in CI environment
   * 
   * @returns true if running in CI
   */
  static isCI(): boolean {
    return !!(
      process.env.CI ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.CIRCLECI
    );
  }

  /**
   * Get recommended test timeout based on environment
   * 
   * @param baseTimeout - Base timeout in milliseconds
   * @returns Adjusted timeout
   */
  static getRecommendedTimeout(baseTimeout: number = 30000): number {
    // Increase timeout in CI environments
    return this.isCI() ? baseTimeout * 2 : baseTimeout;
  }
}
