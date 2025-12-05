/**
 * Performance Reporter for Jest
 * 
 * Custom Jest reporter that tracks and reports slow tests.
 * Helps identify performance bottlenecks in the test suite.
 * 
 * Requirements: 7.5
 */

import type {
  AggregatedResult,
  Test,
  TestResult,
  Reporter,
  ReporterOnStartOptions
} from '@jest/reporters';

interface SlowTest {
  testPath: string;
  testName: string;
  duration: number;
}

export class PerformanceReporter implements Reporter {
  private slowTests: SlowTest[] = [];
  private readonly slowThreshold: number;
  private totalTests: number = 0;
  private totalDuration: number = 0;

  constructor(
    _globalConfig: any,
    options: { slowThreshold?: number } = {}
  ) {
    this.slowThreshold = options.slowThreshold || 1000; // Default 1 second
  }

  onRunStart(
    _results: AggregatedResult,
    _options: ReporterOnStartOptions
  ): void {
    this.slowTests = [];
    this.totalTests = 0;
    this.totalDuration = 0;
  }

  onTestResult(
    _test: Test,
    testResult: TestResult,
    _results: AggregatedResult
  ): void {
    this.totalTests += testResult.numPassingTests;
    this.totalDuration += testResult.perfStats.runtime;

    // Track slow tests
    testResult.testResults.forEach((result) => {
      if (result.duration && result.duration > this.slowThreshold) {
        this.slowTests.push({
          testPath: testResult.testFilePath,
          testName: result.fullName,
          duration: result.duration
        });
      }
    });
  }

  onRunComplete(): void {
    if (this.slowTests.length === 0) {
      console.log('\n✓ No slow tests detected (all tests < 1s)');
      return;
    }

    // Sort by duration (slowest first)
    this.slowTests.sort((a, b) => b.duration - a.duration);

    console.log('\n⚠️  Slow Tests Detected:');
    console.log('━'.repeat(80));

    this.slowTests.forEach((test, index) => {
      const relativePath = test.testPath.replace(process.cwd(), '.');
      const durationSeconds = (test.duration / 1000).toFixed(2);
      
      console.log(`${index + 1}. ${durationSeconds}s - ${relativePath}`);
      console.log(`   ${test.testName}`);
    });

    console.log('━'.repeat(80));
    console.log(`Total slow tests: ${this.slowTests.length}`);
    console.log(`Threshold: ${this.slowThreshold}ms`);
    
    if (this.totalTests > 0) {
      const avgDuration = (this.totalDuration / this.totalTests).toFixed(2);
      console.log(`Average test duration: ${avgDuration}ms`);
    }
    
    console.log('\nConsider:');
    console.log('  - Using fake timers for time-dependent tests');
    console.log('  - Reusing test fixtures instead of regenerating');
    console.log('  - Reducing mock setup complexity');
    console.log('  - Moving slow tests to integration suite\n');
  }

  getLastError(): void {
    // No-op
  }
}

export default PerformanceReporter;
