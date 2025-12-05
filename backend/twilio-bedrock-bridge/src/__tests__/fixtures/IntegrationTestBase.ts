/**
 * Integration Test Base Class
 * 
 * Base class for integration tests that provides common setup, teardown,
 * credential checking, and resource management.
 * 
 * Requirements: 3.4, 3.5
 */

import { IntegrationTestUtils } from '../utils/IntegrationTestUtils';

/**
 * Base class for integration tests
 * 
 * Provides:
 * - Automatic credential checking
 * - Resource tracking and cleanup
 * - Common test utilities
 * - Consistent setup/teardown patterns
 * 
 * Usage:
 * ```typescript
 * class MyIntegrationTest extends IntegrationTestBase {
 *   async runTest() {
 *     if (this.shouldSkip()) return;
 *     
 *     const resource = await this.createResource();
 *     this.trackResource('my-resource', async () => {
 *       await this.cleanupResource(resource);
 *     });
 *     
 *     // Test logic...
 *   }
 * }
 * ```
 */
export abstract class IntegrationTestBase {
  protected testName: string;
  protected timeout: number;
  protected skipReason?: string;

  /**
   * Create a new integration test base
   * 
   * @param testName - Name of the test
   * @param timeout - Test timeout in milliseconds (default: 30000)
   */
  constructor(testName: string, timeout: number = 30000) {
    this.testName = testName;
    this.timeout = IntegrationTestUtils.getRecommendedTimeout(timeout);
  }

  /**
   * Setup method called before each test
   * Override to add custom setup logic
   */
  async setup(): Promise<void> {
    IntegrationTestUtils.logTestInfo(`Setting up test: ${this.testName}`);
  }

  /**
   * Teardown method called after each test
   * Override to add custom teardown logic
   */
  async teardown(): Promise<void> {
    IntegrationTestUtils.logTestInfo(`Tearing down test: ${this.testName}`);
    await IntegrationTestUtils.cleanupAllResources();
  }

  /**
   * Check if test should be skipped
   * 
   * @returns true if test should be skipped
   */
  shouldSkip(): boolean {
    if (!IntegrationTestUtils.hasAWSCredentials()) {
      this.skipReason = 'AWS credentials not available';
      return true;
    }
    return false;
  }

  /**
   * Get skip reason
   * 
   * @returns Skip reason or undefined
   */
  getSkipReason(): string | undefined {
    return this.skipReason;
  }

  /**
   * Track a resource for cleanup
   * 
   * @param resourceId - Unique identifier for the resource
   * @param cleanup - Cleanup function
   */
  protected trackResource(
    resourceId: string,
    cleanup: () => Promise<void>
  ): void {
    IntegrationTestUtils.trackResource(resourceId, cleanup);
    IntegrationTestUtils.logTestInfo(`Tracked resource: ${resourceId}`);
  }

  /**
   * Wait for a condition with timeout
   * 
   * @param condition - Condition to wait for
   * @param timeout - Timeout in milliseconds
   * @param interval - Check interval in milliseconds
   */
  protected async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout?: number,
    interval?: number
  ): Promise<void> {
    return IntegrationTestUtils.waitFor(
      condition,
      timeout || this.timeout,
      interval
    );
  }

  /**
   * Retry an operation with exponential backoff
   * 
   * @param operation - Operation to retry
   * @param maxRetries - Maximum number of retries
   * @param initialDelay - Initial delay in milliseconds
   */
  protected async retry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    return IntegrationTestUtils.retry(operation, maxRetries, initialDelay);
  }

  /**
   * Create a test session ID
   * 
   * @param prefix - Optional prefix
   * @returns Unique session ID
   */
  protected createTestSessionId(prefix?: string): string {
    return IntegrationTestUtils.createTestSessionId(
      prefix || this.testName
    );
  }

  /**
   * Log test information
   * 
   * @param message - Message to log
   * @param data - Optional data
   */
  protected logInfo(message: string, data?: any): void {
    IntegrationTestUtils.logTestInfo(`[${this.testName}] ${message}`, data);
  }

  /**
   * Get test timeout
   * 
   * @returns Timeout in milliseconds
   */
  getTimeout(): number {
    return this.timeout;
  }

  /**
   * Check if running in CI
   * 
   * @returns true if running in CI
   */
  protected isCI(): boolean {
    return IntegrationTestUtils.isCI();
  }

  /**
   * Get test statistics
   * 
   * @returns Test statistics
   */
  protected getStats(): {
    trackedResources: number;
    hasCredentials: boolean;
    environment: string;
  } {
    return IntegrationTestUtils.getTestStats();
  }
}

/**
 * Bedrock integration test base class
 * 
 * Specialized base class for Bedrock integration tests
 */
export abstract class BedrockIntegrationTestBase extends IntegrationTestBase {
  protected bedrockClient?: any;

  /**
   * Setup Bedrock client
   */
  async setup(): Promise<void> {
    await super.setup();
    
    if (!this.shouldSkip()) {
      this.bedrockClient = IntegrationTestUtils.createBedrockClient();
      this.logInfo('Created Bedrock client');
    }
  }

  /**
   * Teardown Bedrock client
   */
  async teardown(): Promise<void> {
    if (this.bedrockClient) {
      this.bedrockClient = undefined;
      this.logInfo('Cleaned up Bedrock client');
    }
    
    await super.teardown();
  }

  /**
   * Verify Bedrock response
   * 
   * @param response - Response to verify
   */
  protected verifyBedrockResponse(response: any): void {
    IntegrationTestUtils.verifyBedrockResponse(response);
  }

  /**
   * Get Bedrock client
   * 
   * @returns Bedrock client
   * @throws Error if client not initialized
   */
  protected getBedrockClient(): any {
    if (!this.bedrockClient) {
      throw new Error('Bedrock client not initialized');
    }
    return this.bedrockClient;
  }
}

/**
 * Helper function to create integration test suite
 * 
 * @param suiteName - Name of the test suite
 * @param tests - Test functions
 * @param options - Suite options
 */
export function createIntegrationTestSuite(
  suiteName: string,
  tests: Array<{
    name: string;
    fn: () => Promise<void>;
    timeout?: number;
  }>,
  options: {
    skipIfNoCredentials?: boolean;
    setupAll?: () => Promise<void>;
    teardownAll?: () => Promise<void>;
  } = {}
): void {
  const shouldSkip = options.skipIfNoCredentials !== false &&
    IntegrationTestUtils.skipIfNoCredentials();

  if (shouldSkip) {
    describe.skip(suiteName, () => {
      it('skipped - no AWS credentials', () => {
        // Placeholder
      });
    });
    return;
  }

  describe(suiteName, () => {
    beforeAll(async () => {
      IntegrationTestUtils.setupIntegrationTests();
      if (options.setupAll) {
        await options.setupAll();
      }
    });

    afterAll(async () => {
      if (options.teardownAll) {
        await options.teardownAll();
      }
      await IntegrationTestUtils.teardownIntegrationTests();
    });

    afterEach(async () => {
      await IntegrationTestUtils.cleanupAllResources();
    });

    for (const test of tests) {
      it(
        test.name,
        async () => {
          await test.fn();
        },
        test.timeout || IntegrationTestUtils.getRecommendedTimeout()
      );
    }
  });
}

/**
 * Decorator to skip test if no credentials
 * 
 * @param target - Test class
 * @param propertyKey - Method name
 * @param descriptor - Property descriptor
 */
export function skipIfNoCredentials(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  const originalMethod = descriptor.value;

  descriptor.value = async function (this: IntegrationTestBase, ...args: any[]) {
    if (this.shouldSkip()) {
      console.log(`Skipping ${propertyKey}: ${this.getSkipReason()}`);
      return;
    }
    return originalMethod.apply(this, args);
  };

  return descriptor;
}
