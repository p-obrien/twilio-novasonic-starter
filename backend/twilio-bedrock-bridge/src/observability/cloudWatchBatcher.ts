/**
 * Optimized CloudWatch Metrics Batcher
 * 
 * High-performance batching system with lazy loading, adaptive sizing,
 * and comprehensive performance monitoring for observability overhead.
 */

import logger from './logger';
import { observabilityConfig } from './config';

// Lazy-loaded AWS SDK imports for better startup performance
let CloudWatchClient: any;
let PutMetricDataCommand: any;
let StandardUnit: any;

interface BatchedMetric {
  metricName: string;
  value: number;
  unit: string;
  dimensions?: Array<{ Name: string; Value: string }>;
  timestamp?: Date;
}

interface BatchConfig {
  maxBatchSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  adaptiveSizing: boolean;
  performanceMonitoring: boolean;
}

interface BatchPerformanceStats {
  totalBatches: number;
  totalMetrics: number;
  averageBatchSize: number;
  averageFlushTime: number;
  successRate: number;
  lastFlushTime: number;
  overhead: {
    batchingTimeMs: number;
    networkTimeMs: number;
    totalTimeMs: number;
  };
}

export class CloudWatchBatcher {
  private cloudWatch: any = null; // Lazy-loaded CloudWatch client
  private namespace: string;
  private region: string;
  private batch: BatchedMetric[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private config: BatchConfig;
  private isShuttingDown = false;
  private performanceStats: BatchPerformanceStats;
  private lastAdaptiveResize = 0;

  constructor(
    namespace: string = observabilityConfig.cloudWatch.namespace,
    region: string = observabilityConfig.cloudWatch.region,
    config: Partial<BatchConfig> = {}
  ) {
    this.namespace = namespace;
    this.region = region;
    this.config = {
      maxBatchSize: observabilityConfig.cloudWatch.batching.maxBatchSize,
      flushIntervalMs: observabilityConfig.cloudWatch.batching.flushIntervalMs,
      maxRetries: observabilityConfig.cloudWatch.batching.maxRetries,
      retryDelayMs: observabilityConfig.cloudWatch.batching.retryDelayMs,
      adaptiveSizing: true,
      performanceMonitoring: true,
      ...config
    };

    // Initialize performance stats
    this.performanceStats = {
      totalBatches: 0,
      totalMetrics: 0,
      averageBatchSize: 0,
      averageFlushTime: 0,
      successRate: 1.0,
      lastFlushTime: 0,
      overhead: {
        batchingTimeMs: 0,
        networkTimeMs: 0,
        totalTimeMs: 0
      }
    };

    // Only start if CloudWatch batching is enabled
    if (observabilityConfig.cloudWatch.enabled && observabilityConfig.cloudWatch.batching.enabled) {
      this.startFlushTimer();
      logger.info('Optimized CloudWatch batcher initialized', {
        namespace: this.namespace,
        region,
        adaptiveSizing: this.config.adaptiveSizing,
        performanceMonitoring: this.config.performanceMonitoring,
        maxBatchSize: this.config.maxBatchSize
      });
    } else {
      logger.debug('CloudWatch batching disabled', {
        cloudWatchEnabled: observabilityConfig.cloudWatch.enabled,
        batchingEnabled: observabilityConfig.cloudWatch.batching.enabled
      });
    }
  }

  /**
   * Add a metric to the batch with performance monitoring
   */
  addMetric(metric: BatchedMetric): void {
    const startTime = this.config.performanceMonitoring ? performance.now() : 0;

    // Fast path: Skip if CloudWatch or batching is disabled
    if (!observabilityConfig.cloudWatch.enabled || !observabilityConfig.cloudWatch.batching.enabled) {
      return;
    }

    if (this.isShuttingDown) {
      logger.warn('CloudWatch batcher shutting down, dropping metric', { 
        metricName: metric.metricName,
        component: 'cloudwatch_batcher'
      });
      return;
    }

    // Optimized metric addition with minimal object creation
    this.batch.push({
      metricName: metric.metricName,
      value: metric.value,
      unit: metric.unit,
      dimensions: metric.dimensions,
      timestamp: metric.timestamp || new Date()
    });

    // Update performance stats
    if (this.config.performanceMonitoring) {
      this.performanceStats.overhead.batchingTimeMs += performance.now() - startTime;
    }

    // Adaptive batch sizing based on performance
    const shouldFlush = this.shouldFlushBatch();
    if (shouldFlush) {
      this.flush();
    }
  }

  /**
   * Intelligent batch flushing decision with adaptive sizing
   */
  private shouldFlushBatch(): boolean {
    const batchSize = this.batch.length;
    
    // Always flush if at max capacity
    if (batchSize >= this.config.maxBatchSize) {
      return true;
    }

    // Adaptive sizing: flush smaller batches if performance is good
    if (this.config.adaptiveSizing && batchSize >= this.getAdaptiveBatchSize()) {
      return true;
    }

    return false;
  }

  /**
   * Calculate adaptive batch size based on performance metrics
   */
  private getAdaptiveBatchSize(): number {
    // Only adjust every 30 seconds to avoid thrashing
    const now = Date.now();
    if (now - this.lastAdaptiveResize < 30000) {
      return this.config.maxBatchSize;
    }

    this.lastAdaptiveResize = now;

    // If we have good performance (fast flushes, high success rate), use smaller batches for lower latency
    if (this.performanceStats.averageFlushTime < 1000 && this.performanceStats.successRate > 0.95) {
      return Math.max(10, Math.floor(this.config.maxBatchSize * 0.6));
    }

    // If performance is poor, use larger batches to reduce overhead
    if (this.performanceStats.averageFlushTime > 3000 || this.performanceStats.successRate < 0.8) {
      return this.config.maxBatchSize;
    }

    // Default to 75% of max batch size
    return Math.floor(this.config.maxBatchSize * 0.75);
  }

  /**
   * Add multiple metrics at once
   */
  addMetrics(metrics: BatchedMetric[]): void {
    for (const metric of metrics) {
      this.addMetric(metric);
    }
  }

  /**
   * Optimized batch flushing with performance monitoring
   */
  async flush(): Promise<void> {
    if (this.batch.length === 0) {
      return;
    }

    const flushStartTime = this.config.performanceMonitoring ? performance.now() : 0;
    const metricsToSend = this.batch.splice(0); // More efficient than spread operator
    
    // Reset timer since we're flushing now
    this.resetFlushTimer();

    try {
      await this.sendMetrics(metricsToSend);
      
      // Update performance stats on success
      if (this.config.performanceMonitoring) {
        this.updatePerformanceStats(metricsToSend.length, performance.now() - flushStartTime, true);
      }
    } catch (error) {
      // Update performance stats on failure
      if (this.config.performanceMonitoring) {
        this.updatePerformanceStats(metricsToSend.length, performance.now() - flushStartTime, false);
      }
      throw error;
    }
  }

  /**
   * Update performance statistics
   */
  private updatePerformanceStats(batchSize: number, flushTime: number, success: boolean): void {
    this.performanceStats.totalBatches++;
    this.performanceStats.totalMetrics += batchSize;
    this.performanceStats.lastFlushTime = Date.now();

    // Update rolling averages
    const alpha = 0.1; // Exponential moving average factor
    this.performanceStats.averageBatchSize = 
      (1 - alpha) * this.performanceStats.averageBatchSize + alpha * batchSize;
    this.performanceStats.averageFlushTime = 
      (1 - alpha) * this.performanceStats.averageFlushTime + alpha * flushTime;
    this.performanceStats.successRate = 
      (1 - alpha) * this.performanceStats.successRate + alpha * (success ? 1 : 0);

    this.performanceStats.overhead.totalTimeMs += flushTime;
  }

  /**
   * Lazy-load CloudWatch client for better startup performance
   */
  private async getCloudWatchClient(): Promise<any> {
    if (!this.cloudWatch) {
      // Lazy load AWS SDK modules
      if (!CloudWatchClient) {
        const awsSdk = await import('@aws-sdk/client-cloudwatch');
        CloudWatchClient = awsSdk.CloudWatchClient;
        PutMetricDataCommand = awsSdk.PutMetricDataCommand;
        StandardUnit = awsSdk.StandardUnit;
      }
      
      this.cloudWatch = new CloudWatchClient({ region: this.region });
    }
    return this.cloudWatch;
  }

  /**
   * Optimized metrics sending with performance monitoring
   */
  private async sendMetrics(metrics: BatchedMetric[], attempt: number = 1): Promise<void> {
    const networkStartTime = this.config.performanceMonitoring ? performance.now() : 0;
    
    try {
      const cloudWatch = await this.getCloudWatchClient();
      
      // Optimized metric data transformation
      const metricData = metrics.map(metric => ({
        MetricName: metric.metricName,
        Value: metric.value,
        Unit: metric.unit,
        Dimensions: metric.dimensions,
        Timestamp: metric.timestamp
      }));

      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: metricData
      });

      const result = await cloudWatch.send(command);
      
      // Update network performance stats
      if (this.config.performanceMonitoring) {
        this.performanceStats.overhead.networkTimeMs += performance.now() - networkStartTime;
      }
      
      logger.debug('CloudWatch metrics batch sent', {
        namespace: this.namespace,
        metricsCount: metrics.length,
        attempt,
        requestId: result.$metadata?.requestId,
        component: 'cloudwatch_batcher'
      });

    } catch (error) {
      logger.error('CloudWatch metrics batch failed', {
        namespace: this.namespace,
        metricsCount: metrics.length,
        attempt,
        error: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code,
        component: 'cloudwatch_batcher'
      });

      // Optimized retry logic with exponential backoff
      if (attempt < this.config.maxRetries) {
        const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
        
        logger.info('Retrying CloudWatch metrics batch', {
          namespace: this.namespace,
          metricsCount: metrics.length,
          nextAttempt: attempt + 1,
          delayMs: delay,
          component: 'cloudwatch_batcher'
        });

        // Use setTimeout for non-blocking retry
        setTimeout(() => {
          this.sendMetrics(metrics, attempt + 1).catch(retryError => {
            logger.error('Retry failed for CloudWatch metrics', {
              error: retryError instanceof Error ? retryError.message : String(retryError),
              component: 'cloudwatch_batcher'
            });
          });
        }, delay);
      } else {
        logger.error('CloudWatch metrics batch failed after all retries', {
          namespace: this.namespace,
          metricsCount: metrics.length,
          maxRetries: this.config.maxRetries,
          component: 'cloudwatch_batcher'
        });
        throw error;
      }
    }
  }

  /**
   * Start the automatic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.batch.length > 0) {
        logger.debug('Auto-flushing CloudWatch metrics batch', {
          batchSize: this.batch.length,
          intervalMs: this.config.flushIntervalMs
        });
        this.flush();
      }
    }, this.config.flushIntervalMs);
  }

  /**
   * Reset the flush timer
   */
  private resetFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    if (!this.isShuttingDown) {
      this.startFlushTimer();
    }
  }

  /**
   * Get current batch size
   */
  getBatchSize(): number {
    return this.batch.length;
  }

  /**
   * Get batch configuration
   */
  getConfig(): BatchConfig {
    return { ...this.config };
  }

  /**
   * Update batch configuration
   */
  updateConfig(newConfig: Partial<BatchConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Restart timer if flush interval changed
    if (newConfig.flushIntervalMs !== undefined) {
      this.resetFlushTimer();
    }

    logger.info('CloudWatch batcher configuration updated', {
      namespace: this.namespace,
      config: this.config
    });
  }

  /**
   * Graceful shutdown - flush remaining metrics and stop timer
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down CloudWatch batcher', {
      namespace: this.namespace,
      remainingMetrics: this.batch.length
    });

    this.isShuttingDown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining metrics
    if (this.batch.length > 0) {
      await this.flush();
    }

    logger.info('CloudWatch batcher shutdown complete', {
      namespace: this.namespace
    });
  }

  /**
   * Comprehensive health check with performance metrics
   */
  getHealthStatus(): {
    isHealthy: boolean;
    batchSize: number;
    isShuttingDown: boolean;
    config: BatchConfig;
    performance: BatchPerformanceStats;
  } {
    return {
      isHealthy: !this.isShuttingDown && this.flushTimer !== null,
      batchSize: this.batch.length,
      isShuttingDown: this.isShuttingDown,
      config: this.config,
      performance: { ...this.performanceStats }
    };
  }

  /**
   * Get detailed performance metrics for observability monitoring
   */
  getPerformanceMetrics(): {
    batchingOverheadMs: number;
    networkOverheadMs: number;
    totalOverheadMs: number;
    throughputMetricsPerSecond: number;
    averageLatencyMs: number;
    successRate: number;
    adaptiveBatchSize: number;
  } {
    const uptimeSeconds = process.uptime();
    const throughput = uptimeSeconds > 0 ? this.performanceStats.totalMetrics / uptimeSeconds : 0;
    
    return {
      batchingOverheadMs: this.performanceStats.overhead.batchingTimeMs,
      networkOverheadMs: this.performanceStats.overhead.networkTimeMs,
      totalOverheadMs: this.performanceStats.overhead.totalTimeMs,
      throughputMetricsPerSecond: throughput,
      averageLatencyMs: this.performanceStats.averageFlushTime,
      successRate: this.performanceStats.successRate,
      adaptiveBatchSize: this.getAdaptiveBatchSize()
    };
  }
}

// Singleton instance for the application
export const cloudWatchBatcher = new CloudWatchBatcher();

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down CloudWatch batcher');
  await cloudWatchBatcher.shutdown();
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down CloudWatch batcher');
  await cloudWatchBatcher.shutdown();
});