/**
 * Memory Monitor for tracking and managing application memory usage
 * 
 * Provides memory monitoring, leak detection, and automatic cleanup
 * with configurable thresholds and alerting.
 */

import { EventEmitter } from 'events';
import { observabilityConfig } from './config';
import logger from './logger';

export interface MemoryUsageInfo {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface MemoryThresholds {
  heapUsedWarning: number;    // Warning threshold in bytes
  heapUsedCritical: number;   // Critical threshold in bytes
  rssWarning: number;         // RSS warning threshold in bytes
  rssCritical: number;        // RSS critical threshold in bytes
  externalWarning: number;    // External memory warning threshold
}

export interface MemoryHealthStatus {
  status: 'healthy' | 'warning' | 'critical';
  usage: MemoryUsageInfo;
  thresholds: MemoryThresholds;
  warnings: string[];
  recommendations: string[];
  trend: 'stable' | 'increasing' | 'decreasing';
  leakSuspected: boolean;
}

export interface MemoryMonitorConfig {
  enabled: boolean;
  checkIntervalMs: number;
  historySize: number;
  gcThreshold: number;        // Trigger GC when heap usage exceeds this percentage
  alertThreshold: number;     // Alert when memory usage exceeds this percentage
  leakDetectionEnabled: boolean;
  leakDetectionSamples: number;
  autoCleanupEnabled: boolean;
}

export class MemoryMonitor extends EventEmitter {
  private static instance: MemoryMonitor;
  private config: MemoryMonitorConfig;
  private thresholds: MemoryThresholds;
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private memoryHistory: Array<{ timestamp: number; usage: MemoryUsageInfo }> = [];
  private lastGcTime = 0;
  private gcCooldownMs = 30000; // 30 seconds between GC calls

  private constructor() {
    super();
    this.config = this.loadConfig();
    this.thresholds = this.calculateThresholds();
  }

  public static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  /**
   * Start memory monitoring
   */
  public start(): void {
    if (this.isMonitoring || !this.config.enabled) {
      return;
    }

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, this.config.checkIntervalMs);

    logger.info('Memory monitoring started', {
      component: 'memory_monitor',
      config: this.config,
      thresholds: this.thresholds
    });

    this.emit('monitoring_started');
  }

  /**
   * Stop memory monitoring
   */
  public stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    logger.info('Memory monitoring stopped', { component: 'memory_monitor' });
    this.emit('monitoring_stopped');
  }

  /**
   * Get current memory usage and health status
   */
  public getMemoryHealth(): MemoryHealthStatus {
    const usage = this.getCurrentMemoryUsage();
    const warnings: string[] = [];
    const recommendations: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    // Check heap usage
    if (usage.heapUsed >= this.thresholds.heapUsedCritical) {
      status = 'critical';
      warnings.push(`Heap usage critical: ${this.formatBytes(usage.heapUsed)} / ${this.formatBytes(this.thresholds.heapUsedCritical)}`);
      recommendations.push('Consider restarting the application or reducing memory usage');
    } else if (usage.heapUsed >= this.thresholds.heapUsedWarning) {
      if (status === 'healthy') status = 'warning';
      warnings.push(`Heap usage high: ${this.formatBytes(usage.heapUsed)} / ${this.formatBytes(this.thresholds.heapUsedWarning)}`);
      recommendations.push('Monitor memory usage and consider garbage collection');
    }

    // Check RSS usage
    if (usage.rss >= this.thresholds.rssCritical) {
      status = 'critical';
      warnings.push(`RSS usage critical: ${this.formatBytes(usage.rss)} / ${this.formatBytes(this.thresholds.rssCritical)}`);
    } else if (usage.rss >= this.thresholds.rssWarning) {
      if (status === 'healthy') status = 'warning';
      warnings.push(`RSS usage high: ${this.formatBytes(usage.rss)} / ${this.formatBytes(this.thresholds.rssWarning)}`);
    }

    // Check external memory
    if (usage.external >= this.thresholds.externalWarning) {
      if (status === 'healthy') status = 'warning';
      warnings.push(`External memory high: ${this.formatBytes(usage.external)}`);
      recommendations.push('Check for external memory leaks (buffers, native modules)');
    }

    const trend = this.calculateMemoryTrend();
    const leakSuspected = this.detectMemoryLeak();

    if (leakSuspected) {
      status = 'critical';
      warnings.push('Memory leak suspected - consistent upward trend detected');
      recommendations.push('Investigate potential memory leaks and consider application restart');
    }

    return {
      status,
      usage,
      thresholds: this.thresholds,
      warnings,
      recommendations,
      trend,
      leakSuspected
    };
  }

  /**
   * Force garbage collection if available and conditions are met
   */
  public forceGarbageCollection(): boolean {
    const now = Date.now();
    
    // Check cooldown period
    if (now - this.lastGcTime < this.gcCooldownMs) {
      logger.debug('GC skipped - cooldown period active', {
        component: 'memory_monitor',
        cooldownRemaining: this.gcCooldownMs - (now - this.lastGcTime)
      });
      return false;
    }

    // Check if GC is available
    if (!global.gc) {
      logger.warn('Garbage collection not available - start Node.js with --expose-gc flag', {
        component: 'memory_monitor'
      });
      return false;
    }

    const beforeGc = this.getCurrentMemoryUsage();
    
    try {
      global.gc();
      this.lastGcTime = now;
      
      const afterGc = this.getCurrentMemoryUsage();
      const heapFreed = beforeGc.heapUsed - afterGc.heapUsed;
      
      logger.info('Garbage collection completed', {
        component: 'memory_monitor',
        heapFreed: this.formatBytes(heapFreed),
        heapBefore: this.formatBytes(beforeGc.heapUsed),
        heapAfter: this.formatBytes(afterGc.heapUsed)
      });

      this.emit('gc_completed', { beforeGc, afterGc, heapFreed });
      return true;
    } catch (error) {
      logger.error('Garbage collection failed', {
        component: 'memory_monitor',
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get memory usage statistics
   */
  public getMemoryStats(): {
    current: MemoryUsageInfo;
    peak: MemoryUsageInfo;
    average: MemoryUsageInfo;
    historySize: number;
  } {
    const current = this.getCurrentMemoryUsage();
    
    if (this.memoryHistory.length === 0) {
      return {
        current,
        peak: current,
        average: current,
        historySize: 0
      };
    }

    const allUsages = this.memoryHistory.map(h => h.usage);
    
    const peak: MemoryUsageInfo = {
      rss: Math.max(...allUsages.map(u => u.rss)),
      heapTotal: Math.max(...allUsages.map(u => u.heapTotal)),
      heapUsed: Math.max(...allUsages.map(u => u.heapUsed)),
      external: Math.max(...allUsages.map(u => u.external)),
      arrayBuffers: Math.max(...allUsages.map(u => u.arrayBuffers))
    };

    const average: MemoryUsageInfo = {
      rss: Math.round(allUsages.reduce((sum, u) => sum + u.rss, 0) / allUsages.length),
      heapTotal: Math.round(allUsages.reduce((sum, u) => sum + u.heapTotal, 0) / allUsages.length),
      heapUsed: Math.round(allUsages.reduce((sum, u) => sum + u.heapUsed, 0) / allUsages.length),
      external: Math.round(allUsages.reduce((sum, u) => sum + u.external, 0) / allUsages.length),
      arrayBuffers: Math.round(allUsages.reduce((sum, u) => sum + u.arrayBuffers, 0) / allUsages.length)
    };

    return {
      current,
      peak,
      average,
      historySize: this.memoryHistory.length
    };
  }

  /**
   * Clear memory history
   */
  public clearHistory(): void {
    this.memoryHistory = [];
    logger.debug('Memory history cleared', { component: 'memory_monitor' });
  }

  /**
   * Check if monitoring is active
   */
  public isActive(): boolean {
    return this.isMonitoring;
  }

  // Private methods

  private loadConfig(): MemoryMonitorConfig {
    return {
      enabled: process.env.MEMORY_MONITORING_ENABLED !== 'false',
      checkIntervalMs: parseInt(process.env.MEMORY_CHECK_INTERVAL_MS || '30000'), // 30 seconds
      historySize: parseInt(process.env.MEMORY_HISTORY_SIZE || '100'),
      gcThreshold: parseFloat(process.env.MEMORY_GC_THRESHOLD || '0.8'), // 80%
      alertThreshold: parseFloat(process.env.MEMORY_ALERT_THRESHOLD || '0.9'), // 90%
      leakDetectionEnabled: process.env.MEMORY_LEAK_DETECTION !== 'false',
      leakDetectionSamples: parseInt(process.env.MEMORY_LEAK_SAMPLES || '10'),
      autoCleanupEnabled: process.env.MEMORY_AUTO_CLEANUP !== 'false'
    };
  }

  private calculateThresholds(): MemoryThresholds {
    const baseHeapLimit = observabilityConfig.healthCheck.memoryThresholdMB * 1024 * 1024;
    
    return {
      heapUsedWarning: Math.round(baseHeapLimit * 0.8),     // 80% of threshold
      heapUsedCritical: baseHeapLimit,                      // 100% of threshold
      rssWarning: Math.round(baseHeapLimit * 1.2),          // 120% of heap threshold
      rssCritical: Math.round(baseHeapLimit * 1.5),         // 150% of heap threshold
      externalWarning: Math.round(baseHeapLimit * 0.3)      // 30% of heap threshold
    };
  }

  private getCurrentMemoryUsage(): MemoryUsageInfo {
    return process.memoryUsage();
  }

  private checkMemoryUsage(): void {
    const usage = this.getCurrentMemoryUsage();
    const timestamp = Date.now();

    // Add to history
    this.memoryHistory.push({ timestamp, usage });
    
    // Trim history to configured size
    if (this.memoryHistory.length > this.config.historySize) {
      this.memoryHistory = this.memoryHistory.slice(-this.config.historySize);
    }

    const health = this.getMemoryHealth();

    // Emit events based on status
    if (health.status === 'critical') {
      this.emit('memory_critical', health);
      
      if (this.config.autoCleanupEnabled) {
        this.performAutoCleanup(health);
      }
    } else if (health.status === 'warning') {
      this.emit('memory_warning', health);
      
      // Auto GC if enabled and threshold exceeded
      if (this.config.autoCleanupEnabled && 
          usage.heapUsed >= this.thresholds.heapUsedWarning * this.config.gcThreshold) {
        this.forceGarbageCollection();
      }
    }

    // Log periodic status
    if (this.memoryHistory.length % 10 === 0) { // Every 10 checks
      logger.debug('Memory usage check', {
        component: 'memory_monitor',
        status: health.status,
        heapUsed: this.formatBytes(usage.heapUsed),
        rss: this.formatBytes(usage.rss),
        trend: health.trend
      });
    }
  }

  private calculateMemoryTrend(): 'stable' | 'increasing' | 'decreasing' {
    if (this.memoryHistory.length < 5) {
      return 'stable';
    }

    const recent = this.memoryHistory.slice(-5);
    const heapUsages = recent.map(h => h.usage.heapUsed);
    
    let increasing = 0;
    let decreasing = 0;

    for (let i = 1; i < heapUsages.length; i++) {
      if (heapUsages[i] > heapUsages[i - 1]) {
        increasing++;
      } else if (heapUsages[i] < heapUsages[i - 1]) {
        decreasing++;
      }
    }

    if (increasing >= 3) return 'increasing';
    if (decreasing >= 3) return 'decreasing';
    return 'stable';
  }

  private detectMemoryLeak(): boolean {
    if (!this.config.leakDetectionEnabled || 
        this.memoryHistory.length < this.config.leakDetectionSamples) {
      return false;
    }

    const samples = this.memoryHistory.slice(-this.config.leakDetectionSamples);
    const heapUsages = samples.map(s => s.usage.heapUsed);
    
    // Check for consistent upward trend
    let consecutiveIncreases = 0;
    let totalIncrease = 0;

    for (let i = 1; i < heapUsages.length; i++) {
      if (heapUsages[i] > heapUsages[i - 1]) {
        consecutiveIncreases++;
        totalIncrease += heapUsages[i] - heapUsages[i - 1];
      } else {
        consecutiveIncreases = 0;
      }
    }

    // Leak suspected if:
    // 1. More than 70% of samples show increase
    // 2. Total increase is more than 100MB
    const increaseRatio = consecutiveIncreases / (heapUsages.length - 1);
    const significantIncrease = totalIncrease > 100 * 1024 * 1024; // 100MB

    return increaseRatio > 0.7 && significantIncrease;
  }

  private performAutoCleanup(health: MemoryHealthStatus): void {
    logger.warn('Performing automatic memory cleanup', {
      component: 'memory_monitor',
      status: health.status,
      warnings: health.warnings
    });

    // Force garbage collection
    const gcSuccess = this.forceGarbageCollection();
    
    if (gcSuccess) {
      this.emit('auto_cleanup_completed', { type: 'gc', success: true });
    } else {
      this.emit('auto_cleanup_completed', { type: 'gc', success: false });
    }

    // Additional cleanup could be added here:
    // - Clear caches
    // - Close idle connections
    // - Reduce buffer sizes
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
export const memoryMonitor = MemoryMonitor.getInstance();

// Event type definitions for TypeScript
export interface MemoryMonitorEvents {
  monitoring_started: () => void;
  monitoring_stopped: () => void;
  memory_warning: (health: MemoryHealthStatus) => void;
  memory_critical: (health: MemoryHealthStatus) => void;
  gc_completed: (data: { beforeGc: MemoryUsageInfo; afterGc: MemoryUsageInfo; heapFreed: number }) => void;
  auto_cleanup_completed: (data: { type: string; success: boolean }) => void;
}
