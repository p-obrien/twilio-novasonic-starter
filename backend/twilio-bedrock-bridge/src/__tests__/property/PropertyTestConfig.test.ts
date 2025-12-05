/**
 * Property Test Configuration Validation
 * 
 * This test verifies that the property-based testing framework is properly
 * configured and that all property tests run with at least 100 iterations.
 * 
 * **Feature: testing-strategy-improvements, Property 3: Property test iteration count**
 * **Validates: Requirements 4.5**
 */

import * as fc from 'fast-check';
import { PROPERTY_TEST_CONFIG } from '../utils/PropertyTestGenerators';

describe('Property Test Configuration', () => {
  describe('iteration count configuration', () => {
    it('should be configured with at least 100 iterations', () => {
      expect(PROPERTY_TEST_CONFIG.numRuns).toBeGreaterThanOrEqual(100);
    });

    it('should have a reasonable timeout', () => {
      expect(PROPERTY_TEST_CONFIG.timeout).toBeGreaterThan(0);
      expect(PROPERTY_TEST_CONFIG.timeout).toBeLessThanOrEqual(30000);
    });

    it('should run property tests with configured iteration count', () => {
      let executionCount = 0;

      // Simple property test to verify iteration count
      fc.assert(
        fc.property(fc.integer(), (_num) => {
          executionCount++;
          return true;
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );

      // Verify that the test actually ran the configured number of times
      expect(executionCount).toBe(PROPERTY_TEST_CONFIG.numRuns);
    });
  });

  describe('fast-check integration', () => {
    it('should be able to generate random integers', () => {
      fc.assert(
        fc.property(fc.integer(), (num) => {
          return typeof num === 'number';
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should be able to generate random arrays', () => {
      fc.assert(
        fc.property(fc.array(fc.integer()), (arr) => {
          return Array.isArray(arr);
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });

    it('should be able to generate random buffers', () => {
      fc.assert(
        fc.property(fc.uint8Array(), (arr) => {
          const buffer = Buffer.from(arr);
          return Buffer.isBuffer(buffer);
        }),
        { numRuns: PROPERTY_TEST_CONFIG.numRuns }
      );
    });
  });
});
