/**
 * Performance Benchmarks - Benchmarks for critical code paths
 * 
 * This module provides comprehensive benchmarks for critical application
 * components including audio processing, session management, memory operations,
 * and observability systems.
 * 
 * Key features:
 * - Audio processing pipeline benchmarks
 * - Session management performance tests
 * - Memory allocation and cleanup benchmarks
 * - Buffer pool performance validation
 * - Observability overhead measurement
 * - Regression detection and reporting
 */

import { Buffer } from 'node:buffer';
import { performanceMonitor, BenchmarkConfig, BenchmarkResult, MetricType } from './performanceMonitor';
import { BufferPool } from '../audio/BufferPool';
import { memoryMonitor } from './memoryMonitor';
import { memoryPressureMonitor } from './memoryPressureMonitor';
import { resourceManager, ResourceType, CleanupPriority } from '../utils/ResourceManager';
import { CorrelationIdManager } from '../utils/correlationId';
import logger from './logger';

/**
 * Benchmark suite configuration
 */
export interface BenchmarkSuiteConfig {
  /** Enable audio processing benchmarks */
  audioProcessing: boolean;
  /** Enable session management benchmarks */
  sessionManagement: boolean;
  /** Enable memory operation benchmarks */
  memoryOperations: boolean;
  /** Enable observability benchmarks */
  observability: boolean;
  /** Number of iterations per benchmark */
  iterations: number;
  /** Warmup iterations */
  warmupIterations: number;
  /** Enable memory tracking */
  trackMemory: boolean;
  /** Maximum duration per benchmark (ms) */
  maxDurationMs: number;
}

/**
 * Benchmark suite results
 */
export interface BenchmarkSuiteResult {
  /** Suite configuration */
  config: BenchmarkSuiteConfig;
  /** Individual benchmark results */
  results: Map<string, BenchmarkResult>;
  /** Suite summary */
  summary: {
    totalBenchmarks: number;
    totalDuration: number;
    averageDuration: number;
    fastestBenchmark: string;
    slowestBenchmark: string;
    memoryEfficient: string;
    memoryIntensive: string;
  };
  /** Performance regression analysis */
  regressions: Array<{
    benchmark: string;
    currentPerformance: number;
    baselinePerformance?: number;
    regressionPercent?: number;
    severity: 'minor' | 'moderate' | 'major';
  }>;
  /** Timestamp */
  timestamp: number;
}

/**
 * Benchmark handle for tracking active benchmarks
 */
export interface BenchmarkHandle {
  /** Benchmark name */
  name: string;
  /** Start timestamp */
  startTime: number;
  /** Metadata */
  metadata?: Record<string, any>;
}

/**
 * Simple benchmark result for individual benchmarks
 */
export interface SimpleBenchmarkResult {
  /** Benchmark name */
  name: string;
  /** Duration in milliseconds */
  duration: number;
  /** Start timestamp */
  startTime: number;
  /** End timestamp */
  endTime: number;
  /** Metadata */
  metadata?: Record<string, any>;
}

/**
 * Performance benchmarks for critical code paths
 */
export class PerformanceBenchmarks {
  private static instance: PerformanceBenchmarks;
  private bufferPool: BufferPool;
  private baselineResults = new Map<string, BenchmarkResult>();
  private activeBenchmarks = new Map<string, BenchmarkHandle>();

  private constructor() {
    this.bufferPool = BufferPool.getInstance();
  }

  /**
   * Gets the singleton instance
   */
  public static getInstance(): PerformanceBenchmarks {
    if (!PerformanceBenchmarks.instance) {
      PerformanceBenchmarks.instance = new PerformanceBenchmarks();
    }
    return PerformanceBenchmarks.instance;
  }

  /**
   * Starts a benchmark and returns a handle
   */
  public startBenchmark(name: string, metadata?: Record<string, any>): BenchmarkHandle {
    if (this.activeBenchmarks.has(name)) {
      logger.warn('Benchmark already active, ending previous benchmark', {
        component: 'performance_benchmarks',
        name
      });
      this.endBenchmark(name);
    }

    const handle: BenchmarkHandle = {
      name,
      startTime: performance.now(),
      metadata
    };

    this.activeBenchmarks.set(name, handle);

    logger.trace('Benchmark started', {
      component: 'performance_benchmarks',
      name,
      startTime: handle.startTime
    });

    return handle;
  }

  /**
   * Ends a benchmark and returns the result
   */
  public endBenchmark(name: string): SimpleBenchmarkResult {
    const handle = this.activeBenchmarks.get(name);
    if (!handle) {
      logger.warn('Attempted to end non-existent benchmark', {
        component: 'performance_benchmarks',
        name
      });
      
      // Return a default result for non-existent benchmarks
      return {
        name,
        duration: 0,
        startTime: 0,
        endTime: performance.now(),
        metadata: {}
      };
    }

    const endTime = performance.now();
    const duration = endTime - handle.startTime;

    const result: SimpleBenchmarkResult = {
      name,
      duration,
      startTime: handle.startTime,
      endTime,
      metadata: handle.metadata
    };

    this.activeBenchmarks.delete(name);

    logger.trace('Benchmark completed', {
      component: 'performance_benchmarks',
      name,
      duration: duration.toFixed(2),
      startTime: handle.startTime,
      endTime
    });

    return result;
  }

  /**
   * Starts a benchmark (alias for startBenchmark for compatibility)
   */
  public start(name: string, metadata?: Record<string, any>): BenchmarkHandle {
    return this.startBenchmark(name, metadata);
  }

  /**
   * Ends a benchmark (alias for endBenchmark for compatibility)
   */
  public end(name: string): SimpleBenchmarkResult {
    return this.endBenchmark(name);
  }

  /**
   * Records a custom metric
   */
  public recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    logger.trace('Custom metric recorded', {
      component: 'performance_benchmarks',
      metric: name,
      value,
      tags
    });

    // Use the performance monitor to record the metric
    const measurementId = performanceMonitor.startMeasurement(name, MetricType.CUSTOM, {
      customValue: value,
      tags: tags || {},
      timestamp: Date.now()
    });

    // Immediately end the measurement with the custom value
    performanceMonitor.endMeasurement(measurementId, name, MetricType.CUSTOM);
  }

  /**
   * Runs the complete benchmark suite
   */
  public async runBenchmarkSuite(config: Partial<BenchmarkSuiteConfig> = {}): Promise<BenchmarkSuiteResult> {
    const fullConfig: BenchmarkSuiteConfig = {
      audioProcessing: true,
      sessionManagement: true,
      memoryOperations: true,
      observability: true,
      iterations: 1000,
      warmupIterations: 100,
      trackMemory: true,
      maxDurationMs: 10000,
      ...config
    };

    logger.info('Starting performance benchmark suite', {
      component: 'performance_benchmarks',
      config: fullConfig
    });

    const startTime = Date.now();
    const results = new Map<string, BenchmarkResult>();

    try {
      // Audio processing benchmarks
      if (fullConfig.audioProcessing) {
        const audioBenchmarks = await this.runAudioProcessingBenchmarks(fullConfig);
        for (const [name, result] of audioBenchmarks.entries()) {
          results.set(name, result);
        }
      }

      // Session management benchmarks
      if (fullConfig.sessionManagement) {
        const sessionBenchmarks = await this.runSessionManagementBenchmarks(fullConfig);
        for (const [name, result] of sessionBenchmarks.entries()) {
          results.set(name, result);
        }
      }

      // Memory operation benchmarks
      if (fullConfig.memoryOperations) {
        const memoryBenchmarks = await this.runMemoryOperationBenchmarks(fullConfig);
        for (const [name, result] of memoryBenchmarks.entries()) {
          results.set(name, result);
        }
      }

      // Observability benchmarks
      if (fullConfig.observability) {
        const observabilityBenchmarks = await this.runObservabilityBenchmarks(fullConfig);
        for (const [name, result] of observabilityBenchmarks.entries()) {
          results.set(name, result);
        }
      }

      const totalDuration = Date.now() - startTime;
      const summary = this.calculateSummary(results, totalDuration);
      const regressions = this.detectRegressions(results);

      const suiteResult: BenchmarkSuiteResult = {
        config: fullConfig,
        results,
        summary,
        regressions,
        timestamp: Date.now()
      };

      logger.info('Performance benchmark suite completed', {
        component: 'performance_benchmarks',
        summary,
        regressionCount: regressions.length,
        duration: totalDuration
      });

      return suiteResult;
    } catch (error) {
      logger.error('Error running benchmark suite', {
        component: 'performance_benchmarks',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Runs audio processing benchmarks
   */
  public async runAudioProcessingBenchmarks(config: BenchmarkSuiteConfig): Promise<Map<string, BenchmarkResult>> {
    const results = new Map<string, BenchmarkResult>();

    // Buffer allocation benchmark
    const bufferAllocationConfig: BenchmarkConfig = {
      name: 'audio_buffer_allocation',
      fn: () => {
        const buffer = Buffer.allocUnsafe(320); // 20ms PCM16LE at 8kHz
        buffer.fill(0);
        return buffer;
      },
      iterations: config.iterations,
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'audio_processing', operation: 'buffer_allocation' }
    };
    results.set('audio_buffer_allocation', await performanceMonitor.runBenchmark(bufferAllocationConfig));

    // Buffer pool acquisition benchmark
    const bufferPoolConfig: BenchmarkConfig = {
      name: 'buffer_pool_acquisition',
      fn: () => {
        const buffer = this.bufferPool.acquire(320);
        this.bufferPool.release(buffer);
      },
      iterations: config.iterations,
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'audio_processing', operation: 'buffer_pool' }
    };
    results.set('buffer_pool_acquisition', await performanceMonitor.runBenchmark(bufferPoolConfig));

    // μ-law encoding benchmark
    const mulawEncodingConfig: BenchmarkConfig = {
      name: 'mulaw_encoding',
      fn: () => {
        const pcmBuffer = Buffer.alloc(320);
        // Fill with sample PCM data
        for (let i = 0; i < pcmBuffer.length; i += 2) {
          pcmBuffer.writeInt16LE(Math.sin(i / 10) * 32767, i);
        }
        
        // Simulate μ-law encoding
        const mulawBuffer = Buffer.alloc(160);
        for (let i = 0; i < 160; i++) {
          const pcmSample = pcmBuffer.readInt16LE(i * 2);
          // Simplified μ-law encoding
          const sign = pcmSample < 0 ? 0x80 : 0x00;
          const magnitude = Math.abs(pcmSample);
          const encoded = sign | (magnitude >> 8);
          mulawBuffer[i] = encoded;
        }
        
        return mulawBuffer;
      },
      iterations: config.iterations,
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'audio_processing', operation: 'mulaw_encoding' }
    };
    results.set('mulaw_encoding', await performanceMonitor.runBenchmark(mulawEncodingConfig));

    // Audio chunk processing benchmark
    const audioChunkConfig: BenchmarkConfig = {
      name: 'audio_chunk_processing',
      fn: () => {
        const chunks: Buffer[] = [];
        
        // Create multiple audio chunks
        for (let i = 0; i < 10; i++) {
          const chunk = Buffer.alloc(160);
          chunk.fill(i);
          chunks.push(chunk);
        }
        
        // Process chunks (concatenate and validate)
        const combined = Buffer.concat(chunks);
        const processed = Buffer.alloc(combined.length);
        combined.copy(processed);
        
        return processed;
      },
      iterations: Math.floor(config.iterations / 10), // Fewer iterations for complex operations
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'audio_processing', operation: 'chunk_processing' }
    };
    results.set('audio_chunk_processing', await performanceMonitor.runBenchmark(audioChunkConfig));

    return results;
  }

  /**
   * Runs session management benchmarks
   */
  public async runSessionManagementBenchmarks(config: BenchmarkSuiteConfig): Promise<Map<string, BenchmarkResult>> {
    const results = new Map<string, BenchmarkResult>();

    // Session creation benchmark
    const sessionCreationConfig: BenchmarkConfig = {
      name: 'session_creation',
      fn: () => {
        const sessionId = `bench_session_${Date.now()}_${Math.random()}`;
        const sessionData = {
          id: sessionId,
          createdAt: Date.now(),
          isActive: true,
          metadata: { benchmark: true }
        };
        
        // Simulate session initialization
        const correlationId = CorrelationIdManager.generateCorrelationId();
        CorrelationIdManager.setContext({
          correlationId,
          sessionId,
          timestamp: Date.now(),
          source: 'internal'
        });
        
        return sessionData;
      },
      iterations: config.iterations,
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'session_management', operation: 'creation' }
    };
    results.set('session_creation', await performanceMonitor.runBenchmark(sessionCreationConfig));

    // Resource registration benchmark
    const resourceRegistrationConfig: BenchmarkConfig = {
      name: 'resource_registration',
      fn: () => {
        const resourceId = `bench_resource_${Date.now()}_${Math.random()}`;
        
        return resourceManager.registerResource({
          id: resourceId,
          type: ResourceType.CUSTOM,
          priority: CleanupPriority.LOW,
          memoryUsage: 1024,
          timeoutMs: 60000,
          metadata: { benchmark: true },
          cleanup: async () => {
            // Minimal cleanup for benchmark
          }
        });
      },
      iterations: Math.floor(config.iterations / 10),
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'session_management', operation: 'resource_registration' }
    };
    results.set('resource_registration', await performanceMonitor.runBenchmark(resourceRegistrationConfig));

    // Correlation ID operations benchmark
    const correlationIdConfig: BenchmarkConfig = {
      name: 'correlation_id_operations',
      fn: () => {
        const correlationId = CorrelationIdManager.generateCorrelationId();
        CorrelationIdManager.setContext({
          correlationId,
          sessionId: 'benchmark',
          timestamp: Date.now(),
          source: 'internal'
        });
        
        const context = CorrelationIdManager.getCurrentCorrelationId();
        const currentId = CorrelationIdManager.getCurrentCorrelationId();
        
        return { correlationId, context, currentId };
      },
      iterations: config.iterations,
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'session_management', operation: 'correlation_id' }
    };
    results.set('correlation_id_operations', await performanceMonitor.runBenchmark(correlationIdConfig));

    return results;
  }

  /**
   * Runs memory operation benchmarks
   */
  public async runMemoryOperationBenchmarks(config: BenchmarkSuiteConfig): Promise<Map<string, BenchmarkResult>> {
    const results = new Map<string, BenchmarkResult>();

    // Memory monitoring benchmark
    const memoryMonitoringConfig: BenchmarkConfig = {
      name: 'memory_monitoring',
      fn: () => {
        const health = memoryMonitor.getMemoryHealth();
        const stats = memoryMonitor.getMemoryStats();
        return { health, stats };
      },
      iterations: config.iterations,
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'memory_operations', operation: 'monitoring' }
    };
    results.set('memory_monitoring', await performanceMonitor.runBenchmark(memoryMonitoringConfig));

    // Memory pressure detection benchmark
    const memoryPressureConfig: BenchmarkConfig = {
      name: 'memory_pressure_detection',
      fn: () => {
        const status = memoryPressureMonitor.getStatus();
        const trend = memoryPressureMonitor.getPressureTrend();
        return { status, trend };
      },
      iterations: config.iterations,
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'memory_operations', operation: 'pressure_detection' }
    };
    results.set('memory_pressure_detection', await performanceMonitor.runBenchmark(memoryPressureConfig));

    // Buffer pool statistics benchmark
    const bufferPoolStatsConfig: BenchmarkConfig = {
      name: 'buffer_pool_stats',
      fn: () => {
        const stats = this.bufferPool.getStats();
        return stats;
      },
      iterations: config.iterations,
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'memory_operations', operation: 'buffer_pool_stats' }
    };
    results.set('buffer_pool_stats', await performanceMonitor.runBenchmark(bufferPoolStatsConfig));

    // Large buffer allocation benchmark
    const largeBufferConfig: BenchmarkConfig = {
      name: 'large_buffer_allocation',
      fn: () => {
        const buffers: Buffer[] = [];
        
        // Allocate multiple large buffers
        for (let i = 0; i < 10; i++) {
          buffers.push(Buffer.alloc(64 * 1024)); // 64KB each
        }
        
        // Fill with data
        buffers.forEach((buffer, index) => {
          buffer.fill(index);
        });
        
        // Clean up
        buffers.length = 0;
        
        return buffers.length;
      },
      iterations: Math.floor(config.iterations / 100), // Much fewer iterations for large allocations
      warmupIterations: Math.floor(config.warmupIterations / 10),
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'memory_operations', operation: 'large_buffer_allocation' }
    };
    results.set('large_buffer_allocation', await performanceMonitor.runBenchmark(largeBufferConfig));

    return results;
  }

  /**
   * Runs observability benchmarks
   */
  public async runObservabilityBenchmarks(config: BenchmarkSuiteConfig): Promise<Map<string, BenchmarkResult>> {
    const results = new Map<string, BenchmarkResult>();

    // Logging benchmark
    const loggingConfig: BenchmarkConfig = {
      name: 'logging_operations',
      fn: () => {
        logger.debug('Benchmark log message', {
          component: 'performance_benchmarks',
          iteration: Math.random(),
          timestamp: Date.now()
        });
      },
      iterations: config.iterations,
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'observability', operation: 'logging' }
    };
    results.set('logging_operations', await performanceMonitor.runBenchmark(loggingConfig));

    // Performance measurement benchmark
    const performanceMeasurementConfig: BenchmarkConfig = {
      name: 'performance_measurement',
      fn: () => {
        const measurementId = performanceMonitor.startMeasurement('benchmark_test', MetricType.LATENCY);
        
        // Simulate some work
        const start = Date.now();
        while (Date.now() - start < 1) {
          // Busy wait for 1ms
        }
        
        return performanceMonitor.endMeasurement(measurementId, 'benchmark_test', MetricType.LATENCY);
      },
      iterations: Math.floor(config.iterations / 10),
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'observability', operation: 'performance_measurement' }
    };
    results.set('performance_measurement', await performanceMonitor.runBenchmark(performanceMeasurementConfig));

    // Correlation tracing benchmark
    const correlationTracingConfig: BenchmarkConfig = {
      name: 'correlation_tracing',
      fn: async () => {
        return CorrelationIdManager.traceWithCorrelation('benchmark_trace', async () => {
          // Simulate async work
          await new Promise(resolve => setTimeout(resolve, 1));
          return 'traced_result';
        }, { benchmark: true });
      },
      iterations: Math.floor(config.iterations / 10),
      warmupIterations: config.warmupIterations,
      trackMemory: config.trackMemory,
      maxDurationMs: config.maxDurationMs,
      metadata: { category: 'observability', operation: 'correlation_tracing' }
    };
    results.set('correlation_tracing', await performanceMonitor.runBenchmark(correlationTracingConfig));

    return results;
  }

  /**
   * Sets baseline results for regression detection
   */
  public setBaseline(results: Map<string, BenchmarkResult>): void {
    this.baselineResults.clear();
    for (const [name, result] of results.entries()) {
      this.baselineResults.set(name, result);
    }
    
    logger.info('Performance baseline set', {
      component: 'performance_benchmarks',
      benchmarkCount: results.size
    });
  }

  /**
   * Runs a quick performance health check
   */
  public async runHealthCheck(): Promise<{
    healthy: boolean;
    issues: string[];
    recommendations: string[];
    quickStats: Map<string, number>;
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    const quickStats = new Map<string, number>();

    try {
      // Quick buffer allocation test
      const bufferStart = Date.now();
      const buffer = Buffer.alloc(1024);
      buffer.fill(0);
      quickStats.set('buffer_allocation_ms', Date.now() - bufferStart);

      // Quick memory check
      const memoryStart = Date.now();
      const memoryHealth = memoryMonitor.getMemoryHealth();
      quickStats.set('memory_check_ms', Date.now() - memoryStart);

      // Quick correlation ID test
      const correlationStart = Date.now();
      const correlationId = CorrelationIdManager.generateCorrelationId();
      quickStats.set('correlation_id_ms', Date.now() - correlationStart);

      // Analyze results
      if (quickStats.get('buffer_allocation_ms')! > 10) {
        issues.push('Buffer allocation is slower than expected');
        recommendations.push('Check memory pressure and buffer pool status');
      }

      if (quickStats.get('memory_check_ms')! > 50) {
        issues.push('Memory monitoring is slower than expected');
        recommendations.push('Consider reducing memory monitoring frequency');
      }

      if (memoryHealth.status !== 'healthy') {
        issues.push(`Memory status is ${memoryHealth.status}`);
        recommendations.push('Review memory usage and consider cleanup');
      }

      const healthy = issues.length === 0;

      logger.info('Performance health check completed', {
        component: 'performance_benchmarks',
        healthy,
        issueCount: issues.length,
        quickStats: Object.fromEntries(quickStats)
      });

      return {
        healthy,
        issues,
        recommendations,
        quickStats
      };
    } catch (error) {
      logger.error('Error during performance health check', {
        component: 'performance_benchmarks',
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        healthy: false,
        issues: ['Health check failed with error'],
        recommendations: ['Investigate system stability'],
        quickStats
      };
    }
  }

  // Private methods

  private calculateSummary(results: Map<string, BenchmarkResult>, totalDuration: number) {
    const benchmarkArray = Array.from(results.values());
    
    if (benchmarkArray.length === 0) {
      return {
        totalBenchmarks: 0,
        totalDuration,
        averageDuration: 0,
        fastestBenchmark: '',
        slowestBenchmark: '',
        memoryEfficient: '',
        memoryIntensive: ''
      };
    }

    const averageDuration = benchmarkArray.reduce((sum, result) => sum + result.averageDuration, 0) / benchmarkArray.length;
    
    const fastest = benchmarkArray.reduce((min, result) => 
      result.averageDuration < min.averageDuration ? result : min
    );
    
    const slowest = benchmarkArray.reduce((max, result) => 
      result.averageDuration > max.averageDuration ? result : max
    );

    // Find memory efficient and intensive benchmarks
    const withMemory = benchmarkArray.filter(result => result.memory);
    let memoryEfficient = '';
    let memoryIntensive = '';
    
    if (withMemory.length > 0) {
      const mostEfficient = withMemory.reduce((min, result) => 
        (result.memory?.averageUsage || 0) < (min.memory?.averageUsage || 0) ? result : min
      );
      
      const mostIntensive = withMemory.reduce((max, result) => 
        (result.memory?.averageUsage || 0) > (max.memory?.averageUsage || 0) ? result : max
      );
      
      memoryEfficient = mostEfficient.name;
      memoryIntensive = mostIntensive.name;
    }

    return {
      totalBenchmarks: benchmarkArray.length,
      totalDuration,
      averageDuration,
      fastestBenchmark: fastest.name,
      slowestBenchmark: slowest.name,
      memoryEfficient,
      memoryIntensive
    };
  }

  private detectRegressions(results: Map<string, BenchmarkResult>) {
    const regressions: Array<{
      benchmark: string;
      currentPerformance: number;
      baselinePerformance?: number;
      regressionPercent?: number;
      severity: 'minor' | 'moderate' | 'major';
    }> = [];

    for (const [name, result] of results.entries()) {
      const baseline = this.baselineResults.get(name);
      const regression = {
        benchmark: name,
        currentPerformance: result.averageDuration,
        baselinePerformance: baseline?.averageDuration,
        regressionPercent: undefined as number | undefined,
        severity: 'minor' as 'minor' | 'moderate' | 'major'
      };

      if (baseline) {
        const change = (result.averageDuration - baseline.averageDuration) / baseline.averageDuration;
        regression.regressionPercent = change * 100;

        // Determine severity
        if (change > 0.5) { // 50% slower
          regression.severity = 'major';
        } else if (change > 0.2) { // 20% slower
          regression.severity = 'moderate';
        } else if (change > 0.1) { // 10% slower
          regression.severity = 'minor';
        }

        // Only include if there's a regression
        if (change > 0.1) {
          regressions.push(regression);
        }
      } else {
        // No baseline, just record current performance
        regressions.push(regression);
      }
    }

    return regressions;
  }
}

// Export singleton instance
export const performanceBenchmarks = PerformanceBenchmarks.getInstance();