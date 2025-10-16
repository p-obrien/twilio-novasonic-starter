/**
 * Memory Pressure Monitor - Advanced memory monitoring with adaptive behavior
 * 
 * This module provides comprehensive memory pressure monitoring that integrates
 * with the existing memory monitor and buffer pool to implement adaptive behavior
 * based on system memory availability and usage patterns.
 * 
 * Key features:
 * - Real-time memory pressure detection and classification
 * - Adaptive buffer sizing based on memory availability
 * - Automatic cleanup triggers and resource management
 * - Integration with session management for memory-aware operations
 * - Performance monitoring and alerting for memory-related issues
 */

import { EventEmitter } from 'events';
import { memoryMonitor, MemoryHealthStatus } from './memoryMonitor';
import { BufferPool } from '../audio/BufferPool';
import logger from './logger';
import { CorrelationIdManager } from '../utils/correlationId';

/**
 * Memory pressure levels with specific thresholds and behaviors
 */
export enum MemoryPressureLevel {
  LOW = 'low',           // < 60% memory usage - normal operation
  MODERATE = 'moderate', // 60-75% memory usage - start optimization
  HIGH = 'high',         // 75-90% memory usage - aggressive optimization
  CRITICAL = 'critical'  // > 90% memory usage - emergency measures
}

/**
 * Configuration for memory pressure monitoring behavior
 */
export interface MemoryPressureConfig {
  /** Enable memory pressure monitoring */
  enabled: boolean;
  /** Check interval in milliseconds */
  checkIntervalMs: number;
  /** Memory pressure thresholds */
  thresholds: {
    moderate: number;  // 0.0-1.0
    high: number;      // 0.0-1.0
    critical: number;  // 0.0-1.0
  };
  /** Adaptive behavior settings */
  adaptive: {
    /** Enable adaptive buffer sizing */
    bufferSizing: boolean;
    /** Enable adaptive session limits */
    sessionLimits: boolean;
    /** Enable automatic cleanup */
    autoCleanup: boolean;
    /** Enable GC triggering */
    gcTriggering: boolean;
  };
  /** Alert settings */
  alerts: {
    /** Enable CloudWatch alerts */
    cloudWatch: boolean;
    /** Enable log alerts */
    logging: boolean;
    /** Alert cooldown period in milliseconds */
    cooldownMs: number;
  };
}

/**
 * Memory pressure status with detailed information
 */
export interface MemoryPressureStatus {
  /** Current pressure level */
  level: MemoryPressureLevel;
  /** Pressure value (0.0-1.0) */
  pressure: number;
  /** Memory health status from base monitor */
  health: MemoryHealthStatus;
  /** Active adaptations */
  adaptations: {
    bufferPoolReduced: boolean;
    sessionLimitsActive: boolean;
    autoCleanupTriggered: boolean;
    gcForced: boolean;
  };
  /** Recommendations for pressure relief */
  recommendations: string[];
  /** Timestamp of last check */
  timestamp: number;
}

/**
 * Adaptive behavior statistics
 */
export interface AdaptiveBehaviorStats {
  /** Number of times buffer pool was reduced */
  bufferPoolReductions: number;
  /** Number of times session limits were applied */
  sessionLimitApplications: number;
  /** Number of automatic cleanups triggered */
  autoCleanupTriggers: number;
  /** Number of forced garbage collections */
  forcedGcCount: number;
  /** Total memory freed through adaptations (bytes) */
  totalMemoryFreed: number;
  /** Average pressure relief achieved */
  averagePressureRelief: number;
  /** Current memory usage in bytes */
  currentUsage: number;
  /** Maximum memory usage observed */
  maxUsage: number;
  /** Number of adaptations performed */
  adaptationCount: number;
  /** Timestamp of last adaptation */
  lastAdaptation: number;
}

/**
 * Memory pressure monitor with adaptive behavior
 */
export class MemoryPressureMonitor extends EventEmitter {
  private static instance: MemoryPressureMonitor;
  private config: MemoryPressureConfig;
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private currentStatus: MemoryPressureStatus;
  private lastAlertTime = 0;
  private stats: AdaptiveBehaviorStats;
  private bufferPool: BufferPool;
  private pressureHistory: Array<{ timestamp: number; pressure: number }> = [];
  private readonly HISTORY_SIZE = 50;

  private constructor() {
    super();
    this.config = this.loadConfig();
    this.bufferPool = BufferPool.getInstance();
    this.stats = this.initializeStats();
    this.currentStatus = this.createInitialStatus();
    
    // Listen to memory monitor events
    memoryMonitor.on('memory_warning', this.handleMemoryWarning.bind(this));
    memoryMonitor.on('memory_critical', this.handleMemoryCritical.bind(this));
  }

  /**
   * Initializes adaptive behavior statistics
   */
  private initializeStats(): AdaptiveBehaviorStats {
    const memoryUsage = process.memoryUsage();
    
    return {
      bufferPoolReductions: 0,
      sessionLimitApplications: 0,
      autoCleanupTriggers: 0,
      forcedGcCount: 0,
      totalMemoryFreed: 0,
      averagePressureRelief: 0,
      currentUsage: memoryUsage.heapUsed,
      maxUsage: memoryUsage.heapUsed,
      adaptationCount: 0,
      lastAdaptation: 0
    };
  }

  /**
   * Gets the singleton instance
   */
  public static getInstance(): MemoryPressureMonitor {
    if (!MemoryPressureMonitor.instance) {
      MemoryPressureMonitor.instance = new MemoryPressureMonitor();
    }
    return MemoryPressureMonitor.instance;
  }

  /**
   * Starts memory pressure monitoring
   */
  public start(): void {
    if (this.isMonitoring || !this.config.enabled) {
      return;
    }

    this.isMonitoring = true;
    
    // Start base memory monitor if not already running
    if (!memoryMonitor.isActive()) {
      memoryMonitor.start();
    }

    // Start pressure monitoring
    this.monitoringInterval = setInterval(() => {
      this.checkMemoryPressure();
    }, this.config.checkIntervalMs);

    logger.info('Memory pressure monitoring started', {
      component: 'memory_pressure_monitor',
      config: this.config
    });

    this.emit('monitoring_started');
  }

  /**
   * Stops memory pressure monitoring
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

    logger.info('Memory pressure monitoring stopped', {
      component: 'memory_pressure_monitor'
    });

    this.emit('monitoring_stopped');
  }

  /**
   * Gets current memory pressure status
   */
  public getStatus(): MemoryPressureStatus {
    return { ...this.currentStatus };
  }

  /**
   * Gets adaptive behavior statistics
   */
  public getStats(): AdaptiveBehaviorStats {
    const memoryUsage = process.memoryUsage();
    
    // Update current usage and max usage
    const currentUsage = memoryUsage.heapUsed;
    const maxUsage = Math.max(this.stats.maxUsage, currentUsage);
    
    return { 
      ...this.stats,
      currentUsage,
      maxUsage
    };
  }

  /**
   * Forces a memory pressure check and returns the result
   */
  public async checkPressureNow(): Promise<MemoryPressureStatus> {
    return CorrelationIdManager.traceWithCorrelation('memory_pressure.check_now', async () => {
      this.checkMemoryPressure();
      return this.getStatus();
    });
  }

  /**
   * Manually triggers adaptive behavior for a specific pressure level
   */
  public async triggerAdaptiveBehavior(level: MemoryPressureLevel): Promise<boolean> {
    return CorrelationIdManager.traceWithCorrelation('memory_pressure.trigger_adaptive', async () => {
      logger.info('Manually triggering adaptive behavior', {
        component: 'memory_pressure_monitor',
        level
      });

      const success = await this.applyAdaptiveBehavior(level);
      
      if (success) {
        this.emit('adaptive_behavior_triggered', { level, manual: true });
      }

      return success;
    }, { 'pressure_level': level });
  }

  /**
   * Gets memory pressure trend analysis
   */
  public getPressureTrend(): {
    trend: 'increasing' | 'decreasing' | 'stable';
    rate: number;
    confidence: number;
  } {
    if (this.pressureHistory.length < 5) {
      return { trend: 'stable', rate: 0, confidence: 0 };
    }

    const recent = this.pressureHistory.slice(-10);
    const pressures = recent.map(h => h.pressure);
    
    // Calculate linear regression to determine trend
    const n = pressures.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = pressures.reduce((sum, p) => sum + p, 0);
    const sumXY = pressures.reduce((sum, p, i) => sum + (i * p), 0);
    const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const confidence = Math.min(1, n / 10); // Higher confidence with more data points
    
    let trend: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(slope) < 0.01) {
      trend = 'stable';
    } else if (slope > 0) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }

    return {
      trend,
      rate: Math.abs(slope),
      confidence
    };
  }

  /**
   * Calculates optimal buffer sizes based on current memory pressure
   */
  public getOptimalBufferSizes(): Map<number, number> {
    const pressure = this.currentStatus.pressure;
    const originalSizes = [160, 320, 640, 1024, 2048, 4096, 8192, 16384];
    const optimalSizes = new Map<number, number>();

    // Reduce buffer pool sizes based on pressure
    let reductionFactor = 1.0;
    
    switch (this.currentStatus.level) {
      case MemoryPressureLevel.LOW:
        reductionFactor = 1.0; // No reduction
        break;
      case MemoryPressureLevel.MODERATE:
        reductionFactor = 0.8; // 20% reduction
        break;
      case MemoryPressureLevel.HIGH:
        reductionFactor = 0.6; // 40% reduction
        break;
      case MemoryPressureLevel.CRITICAL:
        reductionFactor = 0.4; // 60% reduction
        break;
    }

    for (const size of originalSizes) {
      const optimalCount = Math.max(1, Math.floor(10 * reductionFactor)); // Base pool size of 10
      optimalSizes.set(size, optimalCount);
    }

    return optimalSizes;
  }

  // Private methods

  private loadConfig(): MemoryPressureConfig {
    return {
      enabled: process.env.MEMORY_PRESSURE_MONITORING !== 'false',
      checkIntervalMs: parseInt(process.env.MEMORY_PRESSURE_CHECK_INTERVAL || '15000'), // 15 seconds
      thresholds: {
        moderate: parseFloat(process.env.MEMORY_PRESSURE_MODERATE || '0.6'),
        high: parseFloat(process.env.MEMORY_PRESSURE_HIGH || '0.75'),
        critical: parseFloat(process.env.MEMORY_PRESSURE_CRITICAL || '0.9')
      },
      adaptive: {
        bufferSizing: process.env.ADAPTIVE_BUFFER_SIZING !== 'false',
        sessionLimits: process.env.ADAPTIVE_SESSION_LIMITS !== 'false',
        autoCleanup: process.env.ADAPTIVE_AUTO_CLEANUP !== 'false',
        gcTriggering: process.env.ADAPTIVE_GC_TRIGGERING !== 'false'
      },
      alerts: {
        cloudWatch: process.env.MEMORY_PRESSURE_CLOUDWATCH_ALERTS !== 'false',
        logging: process.env.MEMORY_PRESSURE_LOG_ALERTS !== 'false',
        cooldownMs: parseInt(process.env.MEMORY_PRESSURE_ALERT_COOLDOWN || '300000') // 5 minutes
      }
    };
  }



  private createInitialStatus(): MemoryPressureStatus {
    const health = memoryMonitor.getMemoryHealth();
    
    return {
      level: MemoryPressureLevel.LOW,
      pressure: 0,
      health,
      adaptations: {
        bufferPoolReduced: false,
        sessionLimitsActive: false,
        autoCleanupTriggered: false,
        gcForced: false
      },
      recommendations: [],
      timestamp: Date.now()
    };
  }

  private checkMemoryPressure(): void {
    const health = memoryMonitor.getMemoryHealth();
    const pressure = this.calculatePressure(health);
    const level = this.determinePressureLevel(pressure);
    
    // Update pressure history
    this.pressureHistory.push({ timestamp: Date.now(), pressure });
    if (this.pressureHistory.length > this.HISTORY_SIZE) {
      this.pressureHistory = this.pressureHistory.slice(-this.HISTORY_SIZE);
    }

    // Update buffer pool with current pressure
    this.bufferPool.updateMemoryPressure(pressure);

    const previousLevel = this.currentStatus.level;
    
    // Update current status
    this.currentStatus = {
      level,
      pressure,
      health,
      adaptations: {
        bufferPoolReduced: false,
        sessionLimitsActive: false,
        autoCleanupTriggered: false,
        gcForced: false
      },
      recommendations: this.generateRecommendations(level, health),
      timestamp: Date.now()
    };

    // Apply adaptive behavior if pressure level changed or is high
    if (level !== previousLevel || level !== MemoryPressureLevel.LOW) {
      this.applyAdaptiveBehavior(level);
    }

    // Emit events based on pressure level
    this.emitPressureEvents(level, previousLevel);

    // Log periodic status
    if (this.pressureHistory.length % 4 === 0) { // Every 4 checks (1 minute at 15s intervals)
      logger.debug('Memory pressure check completed', {
        component: 'memory_pressure_monitor',
        level,
        pressure: pressure.toFixed(3),
        heapUsed: this.formatBytes(health.usage.heapUsed),
        trend: this.getPressureTrend().trend
      });
    }
  }

  private calculatePressure(health: MemoryHealthStatus): number {
    // Calculate pressure based on multiple factors
    const heapPressure = health.usage.heapUsed / health.thresholds.heapUsedCritical;
    const rssPressure = health.usage.rss / health.thresholds.rssCritical;
    const externalPressure = health.usage.external / health.thresholds.externalWarning;
    
    // Weighted average with heap being most important
    const pressure = (heapPressure * 0.6) + (rssPressure * 0.3) + (externalPressure * 0.1);
    
    return Math.max(0, Math.min(1, pressure));
  }

  private determinePressureLevel(pressure: number): MemoryPressureLevel {
    if (pressure >= this.config.thresholds.critical) {
      return MemoryPressureLevel.CRITICAL;
    } else if (pressure >= this.config.thresholds.high) {
      return MemoryPressureLevel.HIGH;
    } else if (pressure >= this.config.thresholds.moderate) {
      return MemoryPressureLevel.MODERATE;
    } else {
      return MemoryPressureLevel.LOW;
    }
  }

  private async applyAdaptiveBehavior(level: MemoryPressureLevel): Promise<boolean> {
    let adaptationsApplied = false;
    const beforeMemory = process.memoryUsage();

    try {
      // Apply buffer pool reduction
      if (this.config.adaptive.bufferSizing && level >= MemoryPressureLevel.MODERATE) {
        const optimalSizes = this.getOptimalBufferSizes();
        // Note: BufferPool doesn't have a direct resize method, but updateMemoryPressure handles this
        this.currentStatus.adaptations.bufferPoolReduced = true;
        this.stats.bufferPoolReductions++;
        adaptationsApplied = true;
      }

      // Trigger garbage collection for high pressure
      if (this.config.adaptive.gcTriggering && level >= MemoryPressureLevel.HIGH) {
        const gcSuccess = memoryMonitor.forceGarbageCollection();
        if (gcSuccess) {
          this.currentStatus.adaptations.gcForced = true;
          this.stats.forcedGcCount++;
          adaptationsApplied = true;
        }
      }

      // Trigger automatic cleanup for critical pressure
      if (this.config.adaptive.autoCleanup && level === MemoryPressureLevel.CRITICAL) {
        this.currentStatus.adaptations.autoCleanupTriggered = true;
        this.stats.autoCleanupTriggers++;
        adaptationsApplied = true;
        
        // Emit event for session manager to perform cleanup
        this.emit('critical_pressure_cleanup_needed', {
          level,
          pressure: this.currentStatus.pressure
        });
      }

      // Calculate memory freed
      const afterMemory = process.memoryUsage();
      const memoryFreed = beforeMemory.heapUsed - afterMemory.heapUsed;
      if (memoryFreed > 0) {
        this.stats.totalMemoryFreed += memoryFreed;
      }

      if (adaptationsApplied) {
        logger.info('Adaptive behavior applied', {
          component: 'memory_pressure_monitor',
          level,
          adaptations: this.currentStatus.adaptations,
          memoryFreed: this.formatBytes(memoryFreed)
        });
      }

      return adaptationsApplied;
    } catch (error) {
      logger.error('Error applying adaptive behavior', {
        component: 'memory_pressure_monitor',
        level,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  private generateRecommendations(level: MemoryPressureLevel, health: MemoryHealthStatus): string[] {
    const recommendations: string[] = [];

    switch (level) {
      case MemoryPressureLevel.MODERATE:
        recommendations.push('Consider reducing buffer pool sizes');
        recommendations.push('Monitor session count and cleanup idle sessions');
        break;
        
      case MemoryPressureLevel.HIGH:
        recommendations.push('Trigger garbage collection');
        recommendations.push('Reduce concurrent session limits');
        recommendations.push('Clear unnecessary caches');
        break;
        
      case MemoryPressureLevel.CRITICAL:
        recommendations.push('Immediate cleanup of idle sessions required');
        recommendations.push('Consider restarting the application');
        recommendations.push('Alert operations team');
        break;
    }

    // Add specific recommendations based on memory health
    if (health.leakSuspected) {
      recommendations.push('Memory leak suspected - investigate and consider restart');
    }

    if (health.usage.external > health.thresholds.externalWarning) {
      recommendations.push('High external memory usage - check for buffer leaks');
    }

    return recommendations;
  }

  private emitPressureEvents(currentLevel: MemoryPressureLevel, previousLevel: MemoryPressureLevel): void {
    // Emit level change events
    if (currentLevel !== previousLevel) {
      this.emit('pressure_level_changed', {
        from: previousLevel,
        to: currentLevel,
        pressure: this.currentStatus.pressure
      });
    }

    // Emit specific level events
    switch (currentLevel) {
      case MemoryPressureLevel.MODERATE:
        this.emit('pressure_moderate', this.currentStatus);
        break;
      case MemoryPressureLevel.HIGH:
        this.emit('pressure_high', this.currentStatus);
        break;
      case MemoryPressureLevel.CRITICAL:
        this.emit('pressure_critical', this.currentStatus);
        this.sendAlert('Critical memory pressure detected');
        break;
    }
  }

  private sendAlert(message: string): void {
    const now = Date.now();
    
    // Check cooldown period
    if (now - this.lastAlertTime < this.config.alerts.cooldownMs) {
      return;
    }

    this.lastAlertTime = now;

    if (this.config.alerts.logging) {
      logger.error(message, {
        component: 'memory_pressure_monitor',
        status: this.currentStatus,
        stats: this.stats
      });
    }

    // CloudWatch alerts would be implemented here
    if (this.config.alerts.cloudWatch) {
      // TODO: Implement CloudWatch metric publishing
    }

    this.emit('alert_sent', { message, timestamp: now });
  }

  private handleMemoryWarning(health: MemoryHealthStatus): void {
    logger.warn('Memory warning received from base monitor', {
      component: 'memory_pressure_monitor',
      health: health.status,
      warnings: health.warnings
    });
  }

  private handleMemoryCritical(health: MemoryHealthStatus): void {
    logger.error('Critical memory status received from base monitor', {
      component: 'memory_pressure_monitor',
      health: health.status,
      warnings: health.warnings,
      recommendations: health.recommendations
    });

    // Force immediate pressure check
    this.checkMemoryPressure();
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
export const memoryPressureMonitor = MemoryPressureMonitor.getInstance();

// Event type definitions
export interface MemoryPressureEvents {
  monitoring_started: () => void;
  monitoring_stopped: () => void;
  pressure_level_changed: (data: { from: MemoryPressureLevel; to: MemoryPressureLevel; pressure: number }) => void;
  pressure_moderate: (status: MemoryPressureStatus) => void;
  pressure_high: (status: MemoryPressureStatus) => void;
  pressure_critical: (status: MemoryPressureStatus) => void;
  adaptive_behavior_triggered: (data: { level: MemoryPressureLevel; manual?: boolean }) => void;
  critical_pressure_cleanup_needed: (data: { level: MemoryPressureLevel; pressure: number }) => void;
  alert_sent: (data: { message: string; timestamp: number }) => void;
}