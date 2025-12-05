/**
 * Example Integration Test
 * 
 * Demonstrates how to use the integration test infrastructure including:
 * - IntegrationTestBase class
 * - BedrockResponseFixtures
 * - Resource tracking and cleanup
 * - Credential checking
 * 
 * This is a reference implementation showing best practices.
 * 
 * Requirements: 3.4, 3.5
 */

import { BedrockIntegrationTestBase } from '../fixtures/IntegrationTestBase';
import { BedrockResponseFixtures } from '../fixtures/BedrockResponseFixtures';
import { IntegrationTestUtils } from '../utils/IntegrationTestUtils';

/**
 * Example integration test class
 */
class ExampleBedrockTest extends BedrockIntegrationTestBase {
  constructor() {
    super('ExampleBedrockTest', 30000);
  }

  /**
   * Test creating a session
   */
  async testSessionCreation(): Promise<void> {
    if (this.shouldSkip()) {
      this.logInfo('Skipping test:', this.getSkipReason());
      return;
    }

    const sessionId = this.createTestSessionId('example');
    this.logInfo('Created test session:', sessionId);

    // Track session for cleanup
    this.trackResource(sessionId, async () => {
      this.logInfo('Cleaning up session:', sessionId);
      // Cleanup logic would go here
    });

    // Test logic...
    expect(sessionId).toBeDefined();
    expect(sessionId).toContain('example');
  }

  /**
   * Test processing Bedrock response
   */
  async testBedrockResponse(): Promise<void> {
    if (this.shouldSkip()) return;

    // Create a realistic greeting response
    const greetingAudio = BedrockResponseFixtures.createGreetingAudioBuffer(2000);
    const response = BedrockResponseFixtures.createGreetingResponse(greetingAudio);

    // Verify response structure
    this.verifyBedrockResponse(response);

    // Process response
    const audioChunks: Buffer[] = [];
    let contentEndReceived = false;

    for await (const event of response.body) {
      if (event.audioOutput) {
        const audioData = Buffer.from(event.audioOutput.audio, 'base64');
        audioChunks.push(audioData);
        this.logInfo('Received audio chunk:', audioData.length);
      }

      if (event.contentEnd) {
        contentEndReceived = true;
        this.logInfo('Received content end');
      }
    }

    // Verify we received audio and content end
    expect(audioChunks.length).toBeGreaterThan(0);
    expect(contentEndReceived).toBe(true);
  }

  /**
   * Test error handling
   */
  async testErrorHandling(): Promise<void> {
    if (this.shouldSkip()) return;

    const response = BedrockResponseFixtures.createErrorResponse(
      'Test error',
      'TestError'
    );

    let errorReceived = false;
    let errorMessage = '';

    for await (const event of response.body) {
      if (event.error) {
        errorReceived = true;
        errorMessage = event.error.message;
        this.logInfo('Received error:', errorMessage);
      }
    }

    expect(errorReceived).toBe(true);
    expect(errorMessage).toBe('Test error');
  }

  /**
   * Test multi-chunk response
   */
  async testMultiChunkResponse(): Promise<void> {
    if (this.shouldSkip()) return;

    const chunks = [
      BedrockResponseFixtures.createResponseAudioBuffer(500),
      BedrockResponseFixtures.createResponseAudioBuffer(500),
      BedrockResponseFixtures.createResponseAudioBuffer(500)
    ];

    const response = BedrockResponseFixtures.createMultiChunkResponse(chunks);

    const receivedChunks: Buffer[] = [];

    for await (const event of response.body) {
      if (event.audioOutput) {
        const audioData = Buffer.from(event.audioOutput.audio, 'base64');
        receivedChunks.push(audioData);
      }
    }

    expect(receivedChunks.length).toBe(3);
  }
}

describe('Example Integration Test', () => {
  let test: ExampleBedrockTest | undefined;

  // Skip entire suite if no credentials
  const shouldSkip = IntegrationTestUtils.skipIfNoCredentials();

  if (shouldSkip) {
    it.skip('requires AWS credentials', () => {
      // Placeholder
    });
    return;
  }

  beforeAll(() => {
    IntegrationTestUtils.setupIntegrationTests();
  });

  afterAll(async () => {
    await IntegrationTestUtils.teardownIntegrationTests();
  });

  beforeEach(async () => {
    test = new ExampleBedrockTest();
    await test.setup();
  });

  afterEach(async () => {
    if (test) {
      await test.teardown();
    }
  });

  it('should create session', async () => {
    if (!test) throw new Error('Test not initialized');
    await test.testSessionCreation();
  }, test?.getTimeout() || 30000);

  it('should process Bedrock response', async () => {
    if (!test) throw new Error('Test not initialized');
    await test.testBedrockResponse();
  }, test?.getTimeout() || 30000);

  it('should handle errors', async () => {
    if (!test) throw new Error('Test not initialized');
    await test.testErrorHandling();
  }, test?.getTimeout() || 30000);

  it('should process multi-chunk response', async () => {
    if (!test) throw new Error('Test not initialized');
    await test.testMultiChunkResponse();
  }, test?.getTimeout() || 30000);
});

// Alternative: Using createIntegrationTestSuite helper
import { createIntegrationTestSuite } from '../fixtures/IntegrationTestBase';

createIntegrationTestSuite(
  'Example Integration Test (Alternative)',
  [
    {
      name: 'should verify credentials are available',
      fn: async () => {
        expect(IntegrationTestUtils.hasAWSCredentials()).toBe(true);
      }
    },
    {
      name: 'should create Bedrock client',
      fn: async () => {
        const client = IntegrationTestUtils.createBedrockClient();
        expect(client).toBeDefined();
      }
    },
    {
      name: 'should track and cleanup resources',
      fn: async () => {
        const resourceId = 'test-resource-' + Date.now();
        let cleanupCalled = false;

        IntegrationTestUtils.trackResource(resourceId, async () => {
          cleanupCalled = true;
        });

        expect(IntegrationTestUtils.getTrackedResourceCount()).toBeGreaterThan(0);

        await IntegrationTestUtils.cleanupAllResources();

        expect(cleanupCalled).toBe(true);
        expect(IntegrationTestUtils.getTrackedResourceCount()).toBe(0);
      }
    },
    {
      name: 'should wait for condition',
      fn: async () => {
        let condition = false;
        
        setTimeout(() => {
          condition = true;
        }, 100);

        await IntegrationTestUtils.waitFor(() => condition, 5000, 50);

        expect(condition).toBe(true);
      }
    },
    {
      name: 'should retry failed operations',
      fn: async () => {
        let attempts = 0;

        const operation = async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return 'success';
        };

        const result = await IntegrationTestUtils.retry(operation, 5, 100);

        expect(result).toBe('success');
        expect(attempts).toBe(3);
      }
    }
  ],
  {
    skipIfNoCredentials: true,
    setupAll: async () => {
      console.log('Setting up integration test suite');
    },
    teardownAll: async () => {
      console.log('Tearing down integration test suite');
    }
  }
);
