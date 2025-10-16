/**
 * Observability System Initialization
 * 
 * Centralized initialization and shutdown for all observability components
 */

import { initializeTracing, shutdownTracing } from './tracing';
import { fargateXRayTracer } from './xrayTracing';
import { memoryMonitor } from './memoryMonitor';
import { observabilityConfig } from './config';
import logger from './logger';

export interface ObservabilityInitOptions {
  enableMemoryMonitoring?: boolean;
  enableTracing?: boolean;
  enableXRay?: boolean;
  memoryMonitoringInterval?: number;
}

/**
 * Initialize all observability components
 */
export async function initializeObservability(options: ObservabilityInitOptions = {}): Promise<void> {
  const {
    enableMemoryMonitoring = true,
    enableTracing = true,
    enableXRay = observabilityConfig.tracing.enableXRay,
    memoryMonitoringInterval = 30000
  } = options;

  logger.info('Initializing observability system', {
    component: 'observability_init',
    enableMemoryMonitoring,
    enableTracing,
    enableXRay,
    memoryMonitoringInterval
  });

  try {
    // Initialize tracing first
    if (enableTracing) {
      initializeTracing();
      logger.info('Tracing initialization completed');
    }

    // Initialize X-Ray if enabled
    if (enableXRay) {
      fargateXRayTracer.initialize();
      logger.info('X-Ray initialization completed');
    }

    // Initialize memory monitoring
    if (enableMemoryMonitoring) {
      setupMemoryMonitoring(memoryMonitoringInterval);
      logger.info('Memory monitoring initialization completed');
    }

    // Set up graceful shutdown handlers
    setupShutdownHandlers();

    logger.info('Observability system initialized successfully', {
      component: 'observability_init',
      tracingActive: enableTracing,
      xrayActive: fargateXRayTracer.isActive(),
      memoryMonitoringActive: memoryMonitor.isActive()
    });

  } catch (error) {
    logger.error('Failed to initialize observability system', {
      component: 'observability_init',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Setup memory monitoring with event handlers
 */
function setupMemoryMonitoring(interval: number): void {
  // Configure memory monitoring interval if provided
  if (interval !== 30000) {
    process.env.MEMORY_CHECK_INTERVAL_MS = interval.toString();
  }

  // Set up event handlers for memory events
  memoryMonitor.on('memory_warning', (health) => {
    logger.warn('Memory usage warning detected', {
      component: 'memory_monitor',
      status: health.status,
      heapUsed: Math.round(health.usage.heapUsed / 1024 / 1024),
      trend: health.trend,
      warnings: health.warnings,
      recommendations: health.recommendations
    });
  });

  memoryMonitor.on('memory_critical', (health) => {
    logger.error('Critical memory usage detected', {
      component: 'memory_monitor',
      status: health.status,
      heapUsed: Math.round(health.usage.heapUsed / 1024 / 1024),
      rss: Math.round(health.usage.rss / 1024 / 1024),
      trend: health.trend,
      leakSuspected: health.leakSuspected,
      warnings: health.warnings,
      recommendations: health.recommendations
    });

    // Emit custom metric for critical memory usage
    try {
      const { applicationMetrics } = require('./metrics');
      applicationMetrics.errorsTotal.add(1, {
        error_type: 'memory_critical',
        component: 'memory_monitor',
        severity: 'high'
      });
    } catch (error) {
      // Ignore metrics errors during critical memory situations
    }
  });

  memoryMonitor.on('gc_completed', (data) => {
    const heapFreedMB = Math.round(data.heapFreed / 1024 / 1024);
    logger.info('Garbage collection completed', {
      component: 'memory_monitor',
      heapFreedMB,
      heapBeforeMB: Math.round(data.beforeGc.heapUsed / 1024 / 1024),
      heapAfterMB: Math.round(data.afterGc.heapUsed / 1024 / 1024)
    });
  });

  memoryMonitor.on('auto_cleanup_completed', (data) => {
    logger.info('Automatic memory cleanup completed', {
      component: 'memory_monitor',
      type: data.type,
      success: data.success
    });
  });

  // Start memory monitoring
  memoryMonitor.start();
}

/**
 * Setup graceful shutdown handlers
 */
function setupShutdownHandlers(): void {
  const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down observability system gracefully`, {
      component: 'observability_shutdown'
    });

    try {
      await shutdownObservability();
      logger.info('Observability system shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during observability shutdown', {
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(1);
    }
  };

  // Handle various shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon restart

  // Handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception detected', {
      component: 'observability_error_handler',
      error: error.message,
      stack: error.stack
    });

    // Try to get memory status during crash
    try {
      const memoryHealth = memoryMonitor.getMemoryHealth();
      logger.error('Memory status at crash', {
        component: 'observability_error_handler',
        memoryStatus: memoryHealth.status,
        heapUsed: Math.round(memoryHealth.usage.heapUsed / 1024 / 1024),
        leakSuspected: memoryHealth.leakSuspected
      });
    } catch (memError) {
      // Ignore memory check errors during crash
    }

    // Attempt graceful shutdown
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection detected', {
      component: 'observability_error_handler',
      reason: reason instanceof Error ? reason.message : String(reason),
      promise: promise.toString()
    });

    // Don't exit on unhandled rejection, just log it
  });
}

/**
 * Shutdown all observability components
 */
export async function shutdownObservability(): Promise<void> {
  logger.info('Shutting down observability system', {
    component: 'observability_shutdown'
  });

  const shutdownPromises: Promise<void>[] = [];

  // Stop memory monitoring
  if (memoryMonitor.isActive()) {
    memoryMonitor.stop();
    logger.info('Memory monitoring stopped');
  }

  // Shutdown X-Ray
  if (fargateXRayTracer.isActive()) {
    fargateXRayTracer.shutdown();
    logger.info('X-Ray tracing stopped');
  }

  // Shutdown tracing
  shutdownPromises.push(shutdownTracing());

  // Wait for all shutdowns to complete
  await Promise.allSettled(shutdownPromises);

  logger.info('Observability system shutdown completed');
}

/**
 * Get observability system status
 */
export function getObservabilityStatus(): {
  tracing: { available: boolean; method: string };
  memoryMonitoring: { active: boolean; status: string };
  xray: { active: boolean };
} {
  const { isTracingAvailable, getActiveTracer } = require('./tracing');

  return {
    tracing: {
      available: isTracingAvailable(),
      method: getActiveTracer()
    },
    memoryMonitoring: {
      active: memoryMonitor.isActive(),
      status: memoryMonitor.getMemoryHealth().status
    },
    xray: {
      active: fargateXRayTracer.isActive()
    }
  };
}

/**
 * Force memory cleanup (useful for testing or emergency situations)
 */
export function forceMemoryCleanup(): boolean {
  logger.info('Forcing memory cleanup', { component: 'observability_cleanup' });

  const success = memoryMonitor.forceGarbageCollection();

  if (success) {
    logger.info('Memory cleanup completed successfully');
  } else {
    logger.warn('Memory cleanup failed or was skipped');
  }

  return success;
}

/**
 * Get comprehensive observability metrics
 */
export function getObservabilityMetrics(): {
  memory: ReturnType<typeof memoryMonitor.getMemoryStats>;
  memoryHealth: ReturnType<typeof memoryMonitor.getMemoryHealth>;
  system: {
    uptime: number;
    nodeVersion: string;
    platform: string;
    arch: string;
  };
} {
  return {
    memory: memoryMonitor.getMemoryStats(),
    memoryHealth: memoryMonitor.getMemoryHealth(),
    system: {
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    }
  };
}