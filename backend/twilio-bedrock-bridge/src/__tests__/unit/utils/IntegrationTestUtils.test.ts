/**
 * Unit tests for IntegrationTestUtils
 * 
 * Verifies that integration test utilities work correctly for
 * credential checking and resource management.
 */

import { IntegrationTestUtils } from '../../utils/IntegrationTestUtils';

describe('IntegrationTestUtils', () => {
  beforeEach(() => {
    // Clear tracked resources before each test
    IntegrationTestUtils.clearTrackedResources();
  });

  afterEach(async () => {
    // Clean up any tracked resources after each test
    await IntegrationTestUtils.cleanupAllResources();
  });

  describe('Credential Checking', () => {
    it('should check for AWS credentials', () => {
      const hasCredentials = IntegrationTestUtils.hasAWSCredentials();
      
      // Result depends on environment, just verify it returns boolean
      expect(typeof hasCredentials).toBe('boolean');
    });

    it('should determine if tests should be skipped', () => {
      const shouldSkip = IntegrationTestUtils.skipIfNoCredentials();
      
      // Result depends on environment, just verify it returns boolean
      expect(typeof shouldSkip).toBe('boolean');
    });
  });

  describe('Resource Tracking', () => {
    it('should track resources', () => {
      const cleanup = jest.fn().mockResolvedValue(undefined);
      
      IntegrationTestUtils.trackResource('test-resource-1', cleanup);
      
      expect(IntegrationTestUtils.getTrackedResourceCount()).toBe(1);
    });

    it('should track multiple resources', () => {
      const cleanup1 = jest.fn().mockResolvedValue(undefined);
      const cleanup2 = jest.fn().mockResolvedValue(undefined);
      
      IntegrationTestUtils.trackResource('resource-1', cleanup1);
      IntegrationTestUtils.trackResource('resource-2', cleanup2);
      
      expect(IntegrationTestUtils.getTrackedResourceCount()).toBe(2);
    });

    it('should cleanup specific resource', async () => {
      const cleanup = jest.fn().mockResolvedValue(undefined);
      
      IntegrationTestUtils.trackResource('test-resource', cleanup);
      
      const result = await IntegrationTestUtils.cleanupResource('test-resource');
      
      expect(result).toBe(true);
      expect(cleanup).toHaveBeenCalled();
      expect(IntegrationTestUtils.getTrackedResourceCount()).toBe(0);
    });

    it('should handle cleanup of non-existent resource', async () => {
      const result = await IntegrationTestUtils.cleanupResource('non-existent');
      
      expect(result).toBe(false);
    });

    it('should cleanup all resources', async () => {
      const cleanup1 = jest.fn().mockResolvedValue(undefined);
      const cleanup2 = jest.fn().mockResolvedValue(undefined);
      
      IntegrationTestUtils.trackResource('resource-1', cleanup1);
      IntegrationTestUtils.trackResource('resource-2', cleanup2);
      
      const results = await IntegrationTestUtils.cleanupAllResources();
      
      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);
      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
      expect(IntegrationTestUtils.getTrackedResourceCount()).toBe(0);
    });

    it('should handle cleanup errors', async () => {
      const cleanup = jest.fn().mockRejectedValue(new Error('Cleanup failed'));
      
      IntegrationTestUtils.trackResource('failing-resource', cleanup);
      
      const results = await IntegrationTestUtils.cleanupAllResources();
      
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
    });

    it('should clear tracked resources', () => {
      const cleanup = jest.fn().mockResolvedValue(undefined);
      
      IntegrationTestUtils.trackResource('resource-1', cleanup);
      IntegrationTestUtils.clearTrackedResources();
      
      expect(IntegrationTestUtils.getTrackedResourceCount()).toBe(0);
    });
  });

  describe('Wait Utilities', () => {
    it('should wait for condition to be true', async () => {
      let counter = 0;
      const condition = () => {
        counter++;
        return counter >= 3;
      };
      
      await IntegrationTestUtils.waitFor(condition, 1000, 10);
      
      expect(counter).toBeGreaterThanOrEqual(3);
    });

    it('should timeout if condition never met', async () => {
      const condition = () => false;
      
      await expect(
        IntegrationTestUtils.waitFor(condition, 100, 10)
      ).rejects.toThrow('Timeout waiting for condition');
    });

    it('should handle async conditions', async () => {
      let counter = 0;
      const condition = async () => {
        counter++;
        return counter >= 2;
      };
      
      await IntegrationTestUtils.waitFor(condition, 1000, 10);
      
      expect(counter).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Timeout Wrapper', () => {
    it('should complete before timeout', async () => {
      const testFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'success';
      };
      
      const result = await IntegrationTestUtils.withTimeout(testFn, 1000);
      
      expect(result).toBe('success');
    });

    it('should timeout if test takes too long', async () => {
      const testFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'success';
      };
      
      await expect(
        IntegrationTestUtils.withTimeout(testFn, 50)
      ).rejects.toThrow('Test timeout');
    });
  });

  describe('Retry Logic', () => {
    it('should succeed on first try', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      
      const result = await IntegrationTestUtils.retry(fn, 3, 10);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');
      
      const result = await IntegrationTestUtils.retry(fn, 3, 10);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Always fails'));
      
      await expect(
        IntegrationTestUtils.retry(fn, 2, 10)
      ).rejects.toThrow('Always fails');
      
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('Mock Bedrock Response', () => {
    it('should create mock response', () => {
      const chunks = [Buffer.from('chunk1'), Buffer.from('chunk2')];
      
      const response = IntegrationTestUtils.createMockBedrockResponse(chunks, 16000);
      
      expect(response).toBeDefined();
      expect(response.body).toBeDefined();
      expect(typeof response.body[Symbol.asyncIterator]).toBe('function');
    });

    it('should iterate through mock response', async () => {
      const chunks = [Buffer.from('chunk1'), Buffer.from('chunk2')];
      const response = IntegrationTestUtils.createMockBedrockResponse(chunks);
      
      const receivedChunks: any[] = [];
      for await (const chunk of response.body) {
        receivedChunks.push(chunk);
      }
      
      expect(receivedChunks).toHaveLength(2);
      expect(receivedChunks[0].audioOutput).toBeDefined();
    });
  });

  describe('Test Environment', () => {
    it('should verify test environment', () => {
      expect(() => {
        IntegrationTestUtils.verifyTestEnvironment();
      }).not.toThrow();
    });

    it('should get test stats', () => {
      const stats = IntegrationTestUtils.getTestStats();
      
      expect(stats).toHaveProperty('trackedResources');
      expect(stats).toHaveProperty('hasCredentials');
      expect(stats).toHaveProperty('environment');
      expect(typeof stats.trackedResources).toBe('number');
      expect(typeof stats.hasCredentials).toBe('boolean');
    });

    it('should check if running in CI', () => {
      const isCI = IntegrationTestUtils.isCI();
      
      expect(typeof isCI).toBe('boolean');
    });

    it('should get recommended timeout', () => {
      const timeout = IntegrationTestUtils.getRecommendedTimeout(30000);
      
      expect(timeout).toBeGreaterThanOrEqual(30000);
    });
  });

  describe('Test Session ID', () => {
    it('should create unique session IDs', () => {
      const id1 = IntegrationTestUtils.createTestSessionId();
      const id2 = IntegrationTestUtils.createTestSessionId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toContain('test-');
      expect(id2).toContain('test-');
    });

    it('should create session ID with custom prefix', () => {
      const id = IntegrationTestUtils.createTestSessionId('custom');
      
      expect(id).toContain('custom-');
    });
  });

  describe('Setup and Teardown', () => {
    it('should setup integration tests', () => {
      expect(() => {
        IntegrationTestUtils.setupIntegrationTests();
      }).not.toThrow();
    });

    it('should teardown integration tests', async () => {
      const cleanup = jest.fn().mockResolvedValue(undefined);
      IntegrationTestUtils.trackResource('test-resource', cleanup);
      
      await IntegrationTestUtils.teardownIntegrationTests();
      
      expect(cleanup).toHaveBeenCalled();
      expect(IntegrationTestUtils.getTrackedResourceCount()).toBe(0);
    });
  });
});
