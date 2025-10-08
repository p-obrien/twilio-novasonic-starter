/**
 * Performance Monitor - Comprehensive performance monitoring and benchmarking
 * 
 * This module provides real-time performance monitoring, benchmarking capabilities,
 * and performance alerting for critical code paths. It integrates with memory
 * monitoring and provides detailed performance analytics.
 * 
 * Key features:
 * - Real-time performance metrics collection
 * - Benchmarking for critical code paths
 * - Performance regression detection
 * - Memory usage correlation with performance
 * - Automated performance alerting
 * - Performance trend analysis
 */

import { EventEmitter } from 'events';
import { performance, PerformanceObserver } from 'perf_hooks';
import logger from './logger';
import { memoryMonitor } from './memoryMonitor';
import { memoryPressureMonitor, MemoryPressureLevel } from './memoryPressureMonitor';
import { CorrelationIdManager } from '../utils/correlationId';

/**
 * Performance metric types
 */
export enum MetricType {
  LATENCY = 'latency',
  THROUGHPUT = 'throughput',
  CPU_USAGE = 'cpu_usage',
  MEMORY_USAGE = 'memory_usage',
  ERROR_RATE = 'error_rate',
  CUSTOM = 'custom'
}

/**
 * Performance measurement data
 */
export interface PerformanceMeasurement {
  /** Unique measurement ID */
  id: string;
  /** Measurement name/label */
  name: string;
  /** Metric type */
  type: MetricType;
  /** Start timestamp */
  startTime: number;
  /** End timestamp */
  endTime: number;
  /** Duration in milliseconds */
  duration: number;
  /** Associated memory usage */
  memoryUsage?: number;
  /** Custom metadata */
  metadata: Record<string, any>;
  /** Correlation ID */
  correlationId?: string;
}

/**
 * Performance statistics for a metric
 */
export interface PerformanceStats {
  /** Metric name */
  name: string;
  /** Metric type */
  type: MetricType;
  /** Number of measurements */
  count: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Average value */
  average: number;
  /** Median value */
  median: number;
  /** 95th percentile */
  p95: number;
  /** 99th percentile */
  p99: number;
  /** Standard deviation */
  stdDev: number;
  /** Recent trend (increasing/decreasing/stable) */
  trend: 'increasing' | 'decreasing' | 'stable';
  /** Last measurement timestamp */
  lastMeasurement: number;
}

/**
 * Performance benchmark configuration
 */
export interface BenchmarkConfig {
  /** Benchmark name */
  name: string;
  /** Function to benchmark */
  fn: () => Promise<any> | any;
  /** Number of iterations */
  iterations: number;
  /** Warmup iterations */
  warmupIterations?: number;
  /** Maximum duration per iteration (ms) */
  maxDurationMs?: number;
  /** Memory tracking enabled */
  trackMemory?: boolean;
  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Benchmark result
 */
export interface BenchmarkResult {
  /** Benchmark name */
  name: string;
  /** Number of iterations completed */
  iterations: number;
  /** Total duration */
  totalDuration: number;
  /** Average duration per iteration */
  averageDuration: number;
  /** Minimum duration */
  minDuration: number;
  /** Maximum duration */
  maxDuration: number;
  /** Operations per second */
  operationsPerSecond: number;
  /** Memory statistics */
  memory?: {
    startUsage: number;
    endUsage: number;
    peakUsage: number;
    averageUsage: number;
  };
  /** Performance statistics */
  stats: PerformanceStats;
  /** Timestamp */
  timestamp: number;
}

/**
 * Performance alert configuration
 */
export interface PerformanceAlert {
  /** Alert name */
  name: string;
  /** Metric name to monitor */
  metricName: string;
  /** Alert condition */
  condition: {
    /** Threshold value */
    threshold: number;
    /** Comparison operator */
    operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
    /** Window size for evaluation */
    windowSize: number;
  };
  /** Alert severity */
  severity: 'info' | 'warning' | 'error' | 'critical';
  /** Cooldown period (ms) */
  cooldownMs: number;
  /** Last alert time */
  lastAlertTime?: number;
}

/**
 * Performance monitor configuration
 */
export interface PerformanceMonitorConfig {
  /** Enable performance monitoring */
  enabled: boolean;
  /** Maximum measurements to keep in memory */
  maxMeasurements: number;
  /** Measurement retention time (ms) */
  retentionTimeMs: number;
  /** Enable automatic cleanup */
  autoCleanup: boolean;
  /** Cleanup interval (ms) */
  cleanupIntervalMs: number;
  /** Enable performance observer */
  enablePerformanceObserver: boolean;
  /** Enable memory correlation */
  enableMemoryCorrelation: boolean;
  /** Performance alerts */
  alerts: PerformanceAlert[];
}

/**
 * Comprehensive performance monitor
 */
export class PerformanceMonitor extends EventEmitter {
  private static instance: PerformanceMonitor;
  private config: PerformanceMonitorConfig;
  private measurements = new Map<string, PerformanceMeasurement[]>();
  private activeMeasurements = new Map<string, { startTime: number; metadata: Record<string, any> }>();
  private performanceObserver?: PerformanceObserver;
  private cleanupTimer?: NodeJS.Timeout;
  private isMonitoring = false;

  private constructor() {
    super();
    this.config = this.loadConfig();
    
    if (this.config.enablePerformanceObserver) {
      this.setupPerformanceObserver();
    }
  }

  /**
   * Gets the singleton instance
   */
  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Starts performance monitoring
   */
  public start(): void {
    if (this.isMonitoring || !this.config.enabled) {
      return;
    }

    this.isMonitoring = true;
    
    if (this.config.autoCleanup) {
      this.cleanupTimer = setInterval(() => {
        this.performCleanup();
      }, this.config.cleanupIntervalMs);
    }

    logger.info('Performance monitoring started', {
      component: 'performance_monitor',
      config: this.config
    });

    this.emit('monitoring_started');
  }

  /**
   * Stops performance monitoring
   */
  public stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }

    logger.info('Performance monitoring stopped', {
      component: 'performance_monitor',
      totalMeasurements: Array.from(this.measurements.values())
        .reduce((sum, measurements) => sum + measurements.length, 0)
    });

    this.emit('monitoring_stopped');
  }

  /**
   * Starts a performance measurement
   */
  public startMeasurement(name: string, type: MetricType = MetricType.LATENCY, metadata: Record<string, any> = {}): string {
    const measurementId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = performance.now();
    
    this.activeMeasurements.set(measurementId, {
      startTime,
      metadata: {
        ...metadata,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      }
    });

    logger.trace('Performance measurement started', {
      component: 'performance_monitor',
      measurementId,
      name,
      type
    });

    return measurementId;
  }

  /**
   * Ends a performance measurement
   */
  public endMeasurement(measurementId: string, name: string, type: MetricType = MetricType.LATENCY): PerformanceMeasurement | null {
    const activeMeasurement = this.activeMeasurements.get(measurementId);
    if (!activeMeasurement) {
      logger.warn('Attempted to end non-existent measurement', {
        component: 'performance_monitor',
        measurementId,
        name
      });
      return null;
    }

    const endTime = performance.now();
    const duration = endTime - activeMeasurement.startTime;
    
    // Get current memory usage if correlation is enabled
    let memoryUsage: number | undefined;
    if (this.config.enableMemoryCorrelation) {
      const memoryHealth = memoryMonitor.getMemoryHealth();
      memoryUsage = memoryHealth.usage.heapUsed;
    }

    const measurement: PerformanceMeasurement = {
      id: measurementId,
      name,
      type,
      startTime: activeMeasurement.startTime,
      endTime,
      duration,
      memoryUsage,
      metadata: activeMeasurement.metadata,
      correlationId: activeMeasurement.metadata.correlationId
    };

    // Store measurement
    if (!this.measurements.has(name)) {
      this.measurements.set(name, []);
    }
    
    const measurements = this.measurements.get(name)!;
    measurements.push(measurement);
    
    // Limit measurements per metric
    if (measurements.length > this.config.maxMeasurements) {
      measurements.shift();
    }

    // Clean up active measurement
    this.activeMeasurements.delete(measurementId);

    // Check alerts
    this.checkAlerts(name, measurement);

    logger.trace('Performance measurement completed', {
      component: 'performance_monitor',
      measurementId,
      name,
      type,
      duration: duration.toFixed(2),
      memoryUsage
    });

    this.emit('measurement_completed', measurement);
    return measurement;
  }

  /**
   * Measures the performance of a function
   */
  public async measureFunction<T>(
    name: string, 
    fn: () => Promise<T> | T, 
    type: MetricType = MetricType.LATENCY,
    metadata: Record<string, any> = {}
  ): Promise<{ result: T; measurement: PerformanceMeasurement }> {
    return CorrelationIdManager.traceWithCorrelation('performance_monitor.measure_function', async () => {
      const measurementId = this.startMeasurement(name, type, metadata);
      
      try {
        const result = await fn();
        const measurement = this.endMeasurement(measurementId, name, type);
        
        if (!measurement) {
          throw new Error('Failed to complete measurement');
        }
        
        return { result, measurement };
      } catch (error) {
        // End measurement even on error
        this.endMeasurement(measurementId, name, type);
        throw error;
      }
    }, { 'measurement.name': name, 'measurement.type': type });
  }

  /**
   * Runs a performance benchmark
   */
  public async runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    return CorrelationIdManager.traceWithCorrelation('performance_monitor.run_benchmark', async () => {
      logger.info('Starting performance benchmark', {
        component: 'performance_monitor',
        name: config.name,
        iterations: config.iterations,
        warmupIterations: config.warmupIterations || 0
      });

      const measurements: PerformanceMeasurement[] = [];
      let memoryStats: BenchmarkResult['memory'] | undefined;

      // Track memory if enabled
      if (config.trackMemory) {
        const startMemory = memoryMonitor.getMemoryHealth().usage.heapUsed;
        memoryStats = {
          startUsage: startMemory,
          endUsage: startMemory,
          peakUsage: startMemory,
          averageUsage: startMemory
        };
      }

      // Warmup iterations
      if (config.warmupIterations && config.warmupIterations > 0) {
        for (let i = 0; i < config.warmupIterations; i++) {
          try {
            await config.fn();
          } catch (error) {
            logger.warn('Warmup iteration failed', {
              component: 'performance_monitor',
              benchmark: config.name,
              iteration: i,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      // Actual benchmark iterations
      const startTime = performance.now();
      let totalMemoryUsage = 0;
      let memoryMeasurements = 0;

      for (let i = 0; i < config.iterations; i++) {
        const measurementId = this.startMeasurement(
          `${config.name}_iteration_${i}`,
          MetricType.LATENCY,
          { ...config.metadata, iteration: i }
        );

        try {
          const iterationStart = performance.now();
          await config.fn();
          const iterationEnd = performance.now();
          const iterationDuration = iterationEnd - iterationStart;

          // Check max duration
          if (config.maxDurationMs && iterationDuration > config.maxDurationMs) {
            logger.warn('Benchmark iteration exceeded max duration', {
              component: 'performance_monitor',
              benchmark: config.name,
              iteration: i,
              duration: iterationDuration,
              maxDuration: config.maxDurationMs
            });
          }

          const measurement = this.endMeasurement(measurementId, `${config.name}_iteration`, MetricType.LATENCY);
          if (measurement) {
            measurements.push(measurement);
          }

          // Track memory
          if (memoryStats) {
            const currentMemory = memoryMonitor.getMemoryHealth().usage.heapUsed;
            memoryStats.peakUsage = Math.max(memoryStats.peakUsage, currentMemory);
            totalMemoryUsage += currentMemory;
            memoryMeasurements++;
          }

        } catch (error) {
          this.endMeasurement(measurementId, `${config.name}_iteration`, MetricType.LATENCY);
          logger.error('Benchmark iteration failed', {
            component: 'performance_monitor',
            benchmark: config.name,
            iteration: i,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const endTime = performance.now();
      const totalDuration = endTime - startTime;

      // Finalize memory stats
      if (memoryStats && memoryMeasurements > 0) {
        memoryStats.endUsage = memoryMonitor.getMemoryHealth().usage.heapUsed;
        memoryStats.averageUsage = totalMemoryUsage / memoryMeasurements;
      }

      // Calculate statistics
      const durations = measurements.map(m => m.duration);
      const stats = this.calculateStats(`${config.name}_benchmark`, MetricType.LATENCY, durations);

      const result: BenchmarkResult = {
        name: config.name,
        iterations: measurements.length,
        totalDuration,
        averageDuration: durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0,
        minDuration: durations.length > 0 ? Math.min(...durations) : 0,
        maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
        operationsPerSecond: measurements.length > 0 ? (measurements.length / totalDuration) * 1000 : 0,
        memory: memoryStats,
        stats,
        timestamp: Date.now()
      };

      logger.info('Performance benchmark completed', {
        component: 'performance_monitor',
        name: config.name,
        result: {
          iterations: result.iterations,
          averageDuration: result.averageDuration.toFixed(2),
          operationsPerSecond: result.operationsPerSecond.toFixed(2),
          memoryUsage: memoryStats ? this.formatBytes(memoryStats.averageUsage) : 'N/A'
        }
      });

      this.emit('benchmark_completed', result);
      return result;
    }, { 'benchmark.name': config.name });
  }

  /**
   * Gets performance statistics for a metric
   */
  public getStats(name: string): PerformanceStats | null {
    const measurements = this.measurements.get(name);
    if (!measurements || measurements.length === 0) {
      return null;
    }

    const durations = measurements.map(m => m.duration);
    return this.calculateStats(name, measurements[0].type, durations);
  }

  /**
   * Gets all performance statistics
   */
  public getAllStats(): Map<string, PerformanceStats> {
    const allStats = new Map<string, PerformanceStats>();
    
    for (const [name, measurements] of this.measurements.entries()) {
      if (measurements.length > 0) {
        const durations = measurements.map(m => m.duration);
        const stats = this.calculateStats(name, measurements[0].type, durations);
        allStats.set(name, stats);
      }
    }

    return allStats;
  }

  /**
   * Clears all measurements
   */
  public clearMeasurements(): void {
    this.measurements.clear();
    this.activeMeasurements.clear();
    
    logger.info('All performance measurements cleared', {
      component: 'performance_monitor'
    });

    this.emit('measurements_cleared');
  }

  /**
   * Gets system performance overview
   */
  public getSystemPerformance(): {
    memory: ReturnType<typeof memoryMonitor.getMemoryHealth>;
    memoryPressure: ReturnType<typeof memoryPressureMonitor.getStatus>;
    measurements: {
      total: number;
      active: number;
      byType: Map<MetricType, number>;
    };
    uptime: number;
  } {
    const measurementsByType = new Map<MetricType, number>();
    let totalMeasurements = 0;

    for (const measurements of this.measurements.values()) {
      totalMeasurements += measurements.length;
      for (const measurement of measurements) {
        const count = measurementsByType.get(measurement.type) || 0;
        measurementsByType.set(measurement.type, count + 1);
      }
    }

    return {
      memory: memoryMonitor.getMemoryHealth(),
      memoryPressure: memoryPressureMonitor.getStatus(),
      measurements: {
        total: totalMeasurements,
        active: this.activeMeasurements.size,
        byType: measurementsByType
      },
      uptime: process.uptime() * 1000 // Convert to milliseconds
    };
  }

  // Private methods

  private loadConfig(): PerformanceMonitorConfig {
    return {
      enabled: process.env.PERFORMANCE_MONITORING !== 'false',
      maxMeasurements: parseInt(process.env.PERFORMANCE_MAX_MEASUREMENTS || '1000'),
      retentionTimeMs: parseInt(process.env.PERFORMANCE_RETENTION_MS || '3600000'), // 1 hour
      autoCleanup: process.env.PERFORMANCE_AUTO_CLEANUP !== 'false',
      cleanupIntervalMs: parseInt(process.env.PERFORMANCE_CLEANUP_INTERVAL || '300000'), // 5 minutes
      enablePerformanceObserver: process.env.PERFORMANCE_OBSERVER !== 'false',
      enableMemoryCorrelation: process.env.PERFORMANCE_MEMORY_CORRELATION !== 'false',
      alerts: [] // Would be loaded from configuration
    };
  }

  private setupPerformanceObserver(): void {
    try {
      this.performanceObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const entry of entries) {
          this.emit('performance_entry', entry);
        }
      });

      this.performanceObserver.observe({ entryTypes: ['measure'] });
      
      logger.debug('Performance observer initialized', {
        component: 'performance_monitor'
      });
    } catch (error) {
      logger.warn('Failed to setup performance observer', {
        component: 'performance_monitor',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private calculateStats(name: string, type: MetricType, values: number[]): PerformanceStats {
    if (values.length === 0) {
      return {
        name,
        type,
        count: 0,
        min: 0,
        max: 0,
        average: 0,
        median: 0,
        p95: 0,
        p99: 0,
        stdDev: 0,
        trend: 'stable',
        lastMeasurement: 0
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const count = values.length;
    const min = sorted[0];
    const max = sorted[count - 1];
    const average = values.reduce((sum, val) => sum + val, 0) / count;
    
    const median = count % 2 === 0 
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];
    
    const p95 = sorted[Math.floor(count * 0.95)];
    const p99 = sorted[Math.floor(count * 0.99)];
    
    // Calculate standard deviation
    const variance = values.reduce((sum, val) => sum + Math.pow(val - average, 2), 0) / count;
    const stdDev = Math.sqrt(variance);
    
    // Calculate trend (simple approach using recent vs older measurements)
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (count >= 10) {
      const recentAvg = values.slice(-5).reduce((sum, val) => sum + val, 0) / 5;
      const olderAvg = values.slice(0, 5).reduce((sum, val) => sum + val, 0) / 5;
      const change = (recentAvg - olderAvg) / olderAvg;
      
      if (change > 0.1) trend = 'increasing';
      else if (change < -0.1) trend = 'decreasing';
    }

    return {
      name,
      type,
      count,
      min,
      max,
      average,
      median,
      p95,
      p99,
      stdDev,
      trend,
      lastMeasurement: Date.now()
    };
  }

  private checkAlerts(metricName: string, measurement: PerformanceMeasurement): void {
    for (const alert of this.config.alerts) {
      if (alert.metricName === metricName) {
        this.evaluateAlert(alert, measurement);
      }
    }
  }

  private evaluateAlert(alert: PerformanceAlert, measurement: PerformanceMeasurement): void {
    const now = Date.now();
    
    // Check cooldown
    if (alert.lastAlertTime && (now - alert.lastAlertTime) < alert.cooldownMs) {
      return;
    }

    // Get recent measurements for window evaluation
    const measurements = this.measurements.get(alert.metricName) || [];
    const windowMeasurements = measurements.slice(-alert.condition.windowSize);
    
    if (windowMeasurements.length < alert.condition.windowSize) {
      return; // Not enough data
    }

    // Calculate window average
    const windowAverage = windowMeasurements.reduce((sum, m) => sum + m.duration, 0) / windowMeasurements.length;
    
    // Check condition
    let triggered = false;
    switch (alert.condition.operator) {
      case 'gt':
        triggered = windowAverage > alert.condition.threshold;
        break;
      case 'lt':
        triggered = windowAverage < alert.condition.threshold;
        break;
      case 'gte':
        triggered = windowAverage >= alert.condition.threshold;
        break;
      case 'lte':
        triggered = windowAverage <= alert.condition.threshold;
        break;
      case 'eq':
        triggered = Math.abs(windowAverage - alert.condition.threshold) < 0.001;
        break;
    }

    if (triggered) {
      alert.lastAlertTime = now;
      
      const alertData = {
        alert: alert.name,
        metric: alert.metricName,
        value: windowAverage,
        threshold: alert.condition.threshold,
        severity: alert.severity,
        timestamp: now
      };

      const logLevel = alert.severity === 'critical' ? 'error' : 
                       alert.severity === 'warning' ? 'warn' : 
                       alert.severity === 'info' ? 'info' : 'error';
      logger[logLevel]('Performance alert triggered', {
        component: 'performance_monitor',
        ...alertData
      });

      this.emit('alert_triggered', alertData);
    }
  }

  private performCleanup(): void {
    const now = Date.now();
    let totalCleaned = 0;

    for (const [name, measurements] of this.measurements.entries()) {
      const beforeCount = measurements.length;
      
      // Remove old measurements
      const filtered = measurements.filter(m => 
        (now - m.endTime) < this.config.retentionTimeMs
      );
      
      this.measurements.set(name, filtered);
      totalCleaned += beforeCount - filtered.length;
    }

    if (totalCleaned > 0) {
      logger.debug('Performance measurements cleaned up', {
        component: 'performance_monitor',
        cleanedCount: totalCleaned,
        retentionTime: this.config.retentionTimeMs
      });
    }
  }

  private formatBytes(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);
    
    return `${size.toFixed(1)} ${sizes[i]}`;
  }
}

// Export singleton instance
export const performanceMonitor = PerformanceMonitor.getInstance();

// Event type definitions
export interface PerformanceMonitorEvents {
  monitoring_started: () => void;
  monitoring_stopped: () => void;
  measurement_completed: (measurement: PerformanceMeasurement) => void;
  benchmark_completed: (result: BenchmarkResult) => void;
  measurements_cleared: () => void;
  alert_triggered: (alert: any) => void;
  performance_entry: (entry: any) => void;
}