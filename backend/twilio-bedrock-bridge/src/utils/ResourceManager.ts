/**
 * Resource Manager - Comprehensive resource lifecycle management
 * 
 * This module provides centralized resource management with proper cleanup,
 * timeout-based cleanup for abandoned resources, optimized buffer management,
 * and resource leak detection and monitoring.
 * 
 * Key features:
 * - Automatic resource tracking and lifecycle management
 * - Timeout-based cleanup for abandoned resources
 * - Resource leak detection and monitoring
 * - Integration with memory pressure monitoring
 * - Comprehensive resource statistics and diagnostics
 */

import { EventEmitter } from 'events';
import logger from '../observability/logger';
import { CorrelationIdManager } from './correlationId';
import { memoryPressureMonitor, MemoryPressureLevel } from '../observability/memoryPressureMonitor';

/**
 * Resource types that can be managed
 */
export enum ResourceType {
  SESSION = 'session',
  BUFFER = 'buffer',
  WEBSOCKET = 'websocket',
  STREAM = 'stream',
  TIMER = 'timer',
  FILE_HANDLE = 'file_handle',
  DATABASE_CONNECTION = 'database_connection',
  HTTP_CLIENT = 'http_client',
  CUSTOM = 'custom'
}

/**
 * Resource state during its lifecycle
 */
export enum ResourceState {
  CREATED = 'created',
  ACTIVE = 'active',
  IDLE = 'idle',
  CLEANUP_PENDING = 'cleanup_pending',
  CLEANED_UP = 'cleaned_up',
  LEAKED = 'leaked'
}

/**
 * Resource cleanup priority levels
 */
export enum CleanupPriority {
  LOW = 1,      // Can wait for normal cleanup cycle
  NORMAL = 2,   // Standard cleanup priority
  HIGH = 3,     // Should be cleaned up soon
  CRITICAL = 4, // Must be cleaned up immediately
  EMERGENCY = 5 // Emergency cleanup (memory pressure)
}

/**
 * Resource metadata and tracking information
 */
export interface ResourceInfo {
  /** Unique resource identifier */
  id: string;
  /** Resource type */
  type: ResourceType;
  /** Current state */
  state: ResourceState;
  /** Creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivity: number;
  /** Cleanup priority */
  priority: CleanupPriority;
  /** Memory usage estimate in bytes */
  memoryUsage: number;
  /** Timeout for automatic cleanup (ms) */
  timeoutMs: number;
  /** Correlation context */
  correlationId?: string;
  /** Custom metadata */
  metadata: Record<string, any>;
  /** Cleanup function */
  cleanup: () => Promise<void> | void;
  /** Resource owner/creator */
  owner?: string;
}

/**
 * Resource manager configuration
 */
export interface ResourceManagerConfig {
  /** Enable resource tracking */
  enabled: boolean;
  /** Default timeout for resources (ms) */
  defaultTimeoutMs: number;
  /** Cleanup check interval (ms) */
  cleanupIntervalMs: number;
  /** Maximum resources before warning */
  maxResourcesWarning: number;
  /** Maximum resources before critical alert */
  maxResourcesCritical: number;
  /** Enable leak detection */
  leakDetectionEnabled: boolean;
  /** Leak detection threshold (ms) */
  leakDetectionThresholdMs: number;
  /** Enable automatic cleanup */
  autoCleanupEnabled: boolean;
  /** Memory pressure integration */
  memoryPressureIntegration: boolean;
}

/**
 * Resource statistics and metrics
 */
export interface ResourceStats {
  /** Total resources currently tracked */
  totalResources: number;
  /** Resources by type */
  resourcesByType: Map<ResourceType, number>;
  /** Resources by state */
  resourcesByState: Map<ResourceState, number>;
  /** Total memory usage estimate */
  totalMemoryUsage: number;
  /** Resources created since start */
  totalCreated: number;
  /** Resources cleaned up since start */
  totalCleanedUp: number;
  /** Resources that leaked */
  totalLeaked: number;
  /** Average resource lifetime */
  averageLifetime: number;
  /** Cleanup statistics */
  cleanup: {
    automatic: number;
    manual: number;
    timeout: number;
    memoryPressure: number;
    failed: number;
  };
}

/**
 * Resource leak detection result
 */
export interface LeakDetectionResult {
  /** Whether leaks were detected */
  leaksDetected: boolean;
  /** Number of potential leaks */
  leakCount: number;
  /** Leaked resources */
  leakedResources: ResourceInfo[];
  /** Total memory potentially leaked */
  leakedMemory: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Comprehensive resource manager
 */
export class ResourceManager extends EventEmitter {
  private static instance: ResourceManager;
  private config: ResourceManagerConfig;
  private resources = new Map<string, ResourceInfo>();
  private cleanupTimer?: NodeJS.Timeout;
  private stats: ResourceStats;
  private isActive = false;
  private cleanupInProgress = new Set<string>();

  private constructor() {
    super();
    this.config = this.loadConfig();
    this.stats = this.initializeStats();
    
    // Listen to memory pressure events
    if (this.config.memoryPressureIntegration) {
      memoryPressureMonitor.on('pressure_high', this.handleHighMemoryPressure.bind(this));
      memoryPressureMonitor.on('pressure_critical', this.handleCriticalMemoryPressure.bind(this));
      memoryPressureMonitor.on('critical_pressure_cleanup_needed', this.handleEmergencyCleanup.bind(this));
    }
  }

  /**
   * Gets the singleton instance
   */
  public static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager();
    }
    return ResourceManager.instance;
  }

  /**
   * Creates a new ResourceManager instance (factory method for testing)
   */
  public static create(): ResourceManager {
    return new ResourceManager();
  }

  /**
   * Starts resource management
   */
  public start(): void {
    if (this.isActive || !this.config.enabled) {
      return;
    }

    this.isActive = true;
    
    if (this.config.autoCleanupEnabled) {
      this.cleanupTimer = setInterval(() => {
        this.performAutomaticCleanup();
      }, this.config.cleanupIntervalMs);
    }

    logger.info('Resource manager started', {
      component: 'resource_manager',
      config: this.config
    });

    this.emit('manager_started');
  }

  /**
   * Stops resource management
   */
  public stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    logger.info('Resource manager stopped', {
      component: 'resource_manager',
      resourcesRemaining: this.resources.size
    });

    this.emit('manager_stopped');
  }

  /**
   * Registers a resource for management (object parameter version)
   */
  public registerResource(resource: Omit<ResourceInfo, 'createdAt' | 'lastActivity' | 'state'>): string;
  
  /**
   * Registers a resource for management (two parameter version for compatibility)
   */
  public registerResource(resourceId: string, resource: any): string;
  
  /**
   * Registers a resource for management
   */
  public registerResource(
    resourceOrId: Omit<ResourceInfo, 'createdAt' | 'lastActivity' | 'state'> | string,
    resource?: any
  ): string {
    let resourceInfo: Omit<ResourceInfo, 'createdAt' | 'lastActivity' | 'state'>;

    // Handle both signatures
    if (typeof resourceOrId === 'string') {
      // Two parameter version: registerResource(resourceId, resource)
      if (!resource) {
        throw new Error('Resource parameter is required when using string resourceId');
      }
      
      resourceInfo = {
        id: resourceOrId,
        type: ResourceType.CUSTOM,
        priority: CleanupPriority.NORMAL,
        memoryUsage: 0,
        timeoutMs: this.config.defaultTimeoutMs,
        metadata: {},
        cleanup: async () => {
          // Default cleanup - just log
          logger.debug('Default cleanup for resource', {
            component: 'resource_manager',
            resourceId: resourceOrId
          });
        },
        ...resource
      };
    } else {
      // Single parameter version: registerResource(resource)
      resourceInfo = resourceOrId;
    }

    // Validate required fields
    if (!resourceInfo.id) {
      throw new Error('Resource ID is required');
    }
    if (!resourceInfo.cleanup || typeof resourceInfo.cleanup !== 'function') {
      throw new Error('Resource cleanup function is required');
    }

    const now = Date.now();
    const fullResourceInfo: ResourceInfo = {
      ...resourceInfo,
      createdAt: now,
      lastActivity: now,
      state: ResourceState.CREATED,
      correlationId: resourceInfo.correlationId || CorrelationIdManager.getCurrentCorrelationId()
    };

    this.resources.set(resourceInfo.id, fullResourceInfo);
    this.stats.totalCreated++;
    this.updateResourceState(resourceInfo.id, ResourceState.ACTIVE);

    logger.debug('Resource registered', {
      component: 'resource_manager',
      resourceId: resourceInfo.id,
      type: resourceInfo.type,
      memoryUsage: resourceInfo.memoryUsage,
      correlationId: fullResourceInfo.correlationId
    });

    this.emit('resource_registered', fullResourceInfo);
    this.checkResourceLimits();

    return resourceInfo.id;
  }

  /**
   * Updates resource activity timestamp
   */
  public updateResourceActivity(resourceId: string): boolean {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      return false;
    }

    resource.lastActivity = Date.now();
    
    // Update state if it was idle
    if (resource.state === ResourceState.IDLE) {
      this.updateResourceState(resourceId, ResourceState.ACTIVE);
    }

    return true;
  }

  /**
   * Updates resource state
   */
  public updateResourceState(resourceId: string, newState: ResourceState): boolean {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      return false;
    }

    const oldState = resource.state;
    resource.state = newState;
    resource.lastActivity = Date.now();

    logger.debug('Resource state updated', {
      component: 'resource_manager',
      resourceId,
      oldState,
      newState,
      correlationId: resource.correlationId
    });

    this.emit('resource_state_changed', { resourceId, oldState, newState, resource });

    return true;
  }

  /**
   * Manually cleans up a specific resource
   */
  public async cleanupResource(resourceId: string, reason = 'manual'): Promise<boolean> {
    return CorrelationIdManager.traceWithCorrelation('resource_manager.cleanup_resource', async () => {
      const resource = this.resources.get(resourceId);
      if (!resource) {
        logger.warn('Attempted to cleanup non-existent resource', {
          component: 'resource_manager',
          resourceId,
          reason
        });
        return false;
      }

      // Prevent concurrent cleanup
      if (this.cleanupInProgress.has(resourceId)) {
        logger.debug('Resource cleanup already in progress', {
          component: 'resource_manager',
          resourceId,
          reason
        });
        return false;
      }

      this.cleanupInProgress.add(resourceId);
      this.updateResourceState(resourceId, ResourceState.CLEANUP_PENDING);

      try {
        // Execute cleanup function
        await resource.cleanup();
        
        // Update statistics
        this.stats.totalCleanedUp++;
        switch (reason) {
          case 'automatic':
            this.stats.cleanup.automatic++;
            break;
          case 'timeout':
            this.stats.cleanup.timeout++;
            break;
          case 'memory_pressure':
            this.stats.cleanup.memoryPressure++;
            break;
          default:
            this.stats.cleanup.manual++;
        }

        // Remove from tracking
        this.resources.delete(resourceId);
        this.cleanupInProgress.delete(resourceId);

        logger.info('Resource cleaned up successfully', {
          component: 'resource_manager',
          resourceId,
          type: resource.type,
          reason,
          lifetime: Date.now() - resource.createdAt,
          correlationId: resource.correlationId
        });

        this.emit('resource_cleaned_up', { resourceId, resource, reason });
        return true;

      } catch (error) {
        this.stats.cleanup.failed++;
        this.cleanupInProgress.delete(resourceId);
        this.updateResourceState(resourceId, ResourceState.LEAKED);

        logger.error('Resource cleanup failed', {
          component: 'resource_manager',
          resourceId,
          type: resource.type,
          reason,
          error: error instanceof Error ? error.message : String(error),
          correlationId: resource.correlationId
        });

        this.emit('resource_cleanup_failed', { resourceId, resource, reason, error });
        return false;
      }
    }, { 
      'resource.id': resourceId,
      'resource.type': this.resources.get(resourceId)?.type,
      'cleanup.reason': reason
    });
  }

  /**
   * Cleans up resources by type
   */
  public async cleanupResourcesByType(type: ResourceType, reason = 'bulk_cleanup'): Promise<number> {
    const resourcesOfType = Array.from(this.resources.values())
      .filter(resource => resource.type === type)
      .map(resource => resource.id);

    let cleanedCount = 0;
    
    for (const resourceId of resourcesOfType) {
      const success = await this.cleanupResource(resourceId, reason);
      if (success) {
        cleanedCount++;
      }
    }

    logger.info('Bulk cleanup by type completed', {
      component: 'resource_manager',
      type,
      totalResources: resourcesOfType.length,
      cleanedCount,
      reason
    });

    return cleanedCount;
  }

  /**
   * Gets resource information
   */
  public getResource(resourceId: string): ResourceInfo | undefined {
    return this.resources.get(resourceId);
  }

  /**
   * Removes a resource from management without cleanup
   */
  public removeResource(resourceId: string): boolean {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      return false;
    }

    this.resources.delete(resourceId);
    this.cleanupInProgress.delete(resourceId);

    logger.debug('Resource removed from management', {
      component: 'resource_manager',
      resourceId,
      type: resource.type,
      correlationId: resource.correlationId
    });

    this.emit('resource_removed', { resourceId, resource });
    return true;
  }

  /**
   * Gets all resources of a specific type
   */
  public getResourcesByType(type: ResourceType): ResourceInfo[] {
    return Array.from(this.resources.values())
      .filter(resource => resource.type === type);
  }

  /**
   * Gets resources by state
   */
  public getResourcesByState(state: ResourceState): ResourceInfo[] {
    return Array.from(this.resources.values())
      .filter(resource => resource.state === state);
  }

  /**
   * Gets current resource statistics
   */
  public getStats(): ResourceStats {
    // Update dynamic statistics
    this.updateDynamicStats();
    return { ...this.stats };
  }

  /**
   * Gets current resource statistics (alias for getStats)
   */
  public getResourceStats(): ResourceStats {
    return this.getStats();
  }

  /**
   * Cleanup method for proper resource management
   */
  public async cleanup(): Promise<void> {
    logger.info('ResourceManager cleanup initiated', {
      component: 'resource_manager',
      totalResources: this.resources.size
    });

    // Stop the manager first
    this.stop();

    // Force cleanup all remaining resources
    await this.forceCleanupAll('manager_cleanup');

    // Clear any remaining state
    this.resources.clear();
    this.cleanupInProgress.clear();

    logger.info('ResourceManager cleanup completed', {
      component: 'resource_manager'
    });
  }

  /**
   * Performs leak detection analysis
   */
  public detectLeaks(): LeakDetectionResult {
    if (!this.config.leakDetectionEnabled) {
      return {
        leaksDetected: false,
        leakCount: 0,
        leakedResources: [],
        leakedMemory: 0,
        recommendations: ['Leak detection is disabled']
      };
    }

    const now = Date.now();
    const threshold = this.config.leakDetectionThresholdMs;
    const leakedResources: ResourceInfo[] = [];

    for (const resource of this.resources.values()) {
      const age = now - resource.createdAt;
      const idleTime = now - resource.lastActivity;

      // Consider a resource leaked if:
      // 1. It's older than the threshold
      // 2. It's been idle for more than half the threshold
      // 3. It's not in cleanup state
      if (age > threshold && 
          idleTime > threshold / 2 && 
          resource.state !== ResourceState.CLEANUP_PENDING) {
        
        // Mark as leaked
        resource.state = ResourceState.LEAKED;
        leakedResources.push(resource);
        this.stats.totalLeaked++;
      }
    }

    const leakedMemory = leakedResources.reduce((sum, resource) => sum + resource.memoryUsage, 0);
    const recommendations: string[] = [];

    if (leakedResources.length > 0) {
      recommendations.push(`Found ${leakedResources.length} potential resource leaks`);
      recommendations.push('Review resource cleanup logic in affected components');
      recommendations.push('Consider reducing resource timeouts');
      
      if (leakedMemory > 10 * 1024 * 1024) { // 10MB
        recommendations.push('Significant memory leak detected - consider immediate cleanup');
      }
    }

    const result: LeakDetectionResult = {
      leaksDetected: leakedResources.length > 0,
      leakCount: leakedResources.length,
      leakedResources,
      leakedMemory,
      recommendations
    };

    if (result.leaksDetected) {
      logger.warn('Resource leaks detected', {
        component: 'resource_manager',
        leakCount: result.leakCount,
        leakedMemory: this.formatBytes(result.leakedMemory),
        recommendations: result.recommendations
      });

      this.emit('leaks_detected', result);
    }

    return result;
  }

  /**
   * Forces cleanup of all resources (emergency cleanup)
   */
  public async forceCleanupAll(reason = 'force_cleanup'): Promise<number> {
    return CorrelationIdManager.traceWithCorrelation('resource_manager.force_cleanup_all', async () => {
      const allResourceIds = Array.from(this.resources.keys());
      let cleanedCount = 0;

      logger.warn('Force cleanup of all resources initiated', {
        component: 'resource_manager',
        totalResources: allResourceIds.length,
        reason
      });

      // Cleanup in parallel with limited concurrency
      const concurrency = 5;
      for (let i = 0; i < allResourceIds.length; i += concurrency) {
        const batch = allResourceIds.slice(i, i + concurrency);
        
        const batchPromises = batch.map(async (resourceId) => {
          try {
            const success = await this.cleanupResource(resourceId, reason);
            return success ? 1 : 0;
          } catch (error) {
            logger.error('Error in force cleanup', {
              component: 'resource_manager',
              resourceId,
              error: error instanceof Error ? error.message : String(error)
            });
            return 0;
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);
        cleanedCount += batchResults
          .filter(result => result.status === 'fulfilled')
          .reduce((sum, result) => sum + (result.value as number), 0);
      }

      logger.info('Force cleanup completed', {
        component: 'resource_manager',
        totalResources: allResourceIds.length,
        cleanedCount,
        remainingResources: this.resources.size,
        reason
      });

      this.emit('force_cleanup_completed', { cleanedCount, reason });
      return cleanedCount;
    }, { 'cleanup.reason': reason });
  }

  // Private methods

  private loadConfig(): ResourceManagerConfig {
    return {
      enabled: process.env.RESOURCE_MANAGEMENT_ENABLED !== 'false',
      defaultTimeoutMs: parseInt(process.env.RESOURCE_DEFAULT_TIMEOUT || '300000'), // 5 minutes
      cleanupIntervalMs: parseInt(process.env.RESOURCE_CLEANUP_INTERVAL || '60000'), // 1 minute
      maxResourcesWarning: parseInt(process.env.RESOURCE_MAX_WARNING || '1000'),
      maxResourcesCritical: parseInt(process.env.RESOURCE_MAX_CRITICAL || '2000'),
      leakDetectionEnabled: process.env.RESOURCE_LEAK_DETECTION !== 'false',
      leakDetectionThresholdMs: parseInt(process.env.RESOURCE_LEAK_THRESHOLD || '600000'), // 10 minutes
      autoCleanupEnabled: process.env.RESOURCE_AUTO_CLEANUP !== 'false',
      memoryPressureIntegration: process.env.RESOURCE_MEMORY_PRESSURE_INTEGRATION !== 'false'
    };
  }

  private initializeStats(): ResourceStats {
    return {
      totalResources: 0,
      resourcesByType: new Map(),
      resourcesByState: new Map(),
      totalMemoryUsage: 0,
      totalCreated: 0,
      totalCleanedUp: 0,
      totalLeaked: 0,
      averageLifetime: 0,
      cleanup: {
        automatic: 0,
        manual: 0,
        timeout: 0,
        memoryPressure: 0,
        failed: 0
      }
    };
  }

  private updateDynamicStats(): void {
    this.stats.totalResources = this.resources.size;
    this.stats.resourcesByType.clear();
    this.stats.resourcesByState.clear();
    this.stats.totalMemoryUsage = 0;

    let totalLifetime = 0;
    const now = Date.now();

    for (const resource of this.resources.values()) {
      // Count by type
      const typeCount = this.stats.resourcesByType.get(resource.type) || 0;
      this.stats.resourcesByType.set(resource.type, typeCount + 1);

      // Count by state
      const stateCount = this.stats.resourcesByState.get(resource.state) || 0;
      this.stats.resourcesByState.set(resource.state, stateCount + 1);

      // Sum memory usage
      this.stats.totalMemoryUsage += resource.memoryUsage;

      // Calculate lifetime for average
      totalLifetime += now - resource.createdAt;
    }

    // Calculate average lifetime
    if (this.resources.size > 0) {
      this.stats.averageLifetime = totalLifetime / this.resources.size;
    }
  }

  private async performAutomaticCleanup(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    const now = Date.now();
    const resourcesToCleanup: string[] = [];

    // Find resources that need cleanup
    for (const [resourceId, resource] of this.resources.entries()) {
      // Skip if cleanup is already in progress
      if (this.cleanupInProgress.has(resourceId)) {
        continue;
      }

      const age = now - resource.createdAt;
      const idleTime = now - resource.lastActivity;

      // Cleanup based on timeout
      if (age > resource.timeoutMs || idleTime > resource.timeoutMs) {
        resourcesToCleanup.push(resourceId);
        continue;
      }

      // Mark as idle if inactive for a while
      if (idleTime > resource.timeoutMs / 2 && resource.state === ResourceState.ACTIVE) {
        this.updateResourceState(resourceId, ResourceState.IDLE);
      }
    }

    // Perform cleanup
    if (resourcesToCleanup.length > 0) {
      logger.debug('Automatic cleanup starting', {
        component: 'resource_manager',
        resourceCount: resourcesToCleanup.length
      });

      for (const resourceId of resourcesToCleanup) {
        await this.cleanupResource(resourceId, 'timeout');
      }
    }

    // Perform leak detection
    if (this.config.leakDetectionEnabled) {
      this.detectLeaks();
    }
  }

  private checkResourceLimits(): void {
    const resourceCount = this.resources.size;

    if (resourceCount >= this.config.maxResourcesCritical) {
      logger.error('Critical resource limit exceeded', {
        component: 'resource_manager',
        resourceCount,
        limit: this.config.maxResourcesCritical
      });
      this.emit('resource_limit_critical', { resourceCount });
    } else if (resourceCount >= this.config.maxResourcesWarning) {
      logger.warn('Resource warning limit exceeded', {
        component: 'resource_manager',
        resourceCount,
        limit: this.config.maxResourcesWarning
      });
      this.emit('resource_limit_warning', { resourceCount });
    }
  }

  private handleHighMemoryPressure(): void {
    logger.info('High memory pressure detected - triggering resource cleanup', {
      component: 'resource_manager'
    });

    // Cleanup idle resources first
    const idleResources = this.getResourcesByState(ResourceState.IDLE);
    for (const resource of idleResources) {
      this.cleanupResource(resource.id, 'memory_pressure');
    }
  }

  private handleCriticalMemoryPressure(): void {
    logger.warn('Critical memory pressure detected - aggressive resource cleanup', {
      component: 'resource_manager'
    });

    // Cleanup all non-critical resources
    const resourcesForCleanup = Array.from(this.resources.values())
      .filter(resource => resource.priority <= CleanupPriority.NORMAL)
      .sort((a, b) => a.priority - b.priority); // Cleanup lower priority first

    for (const resource of resourcesForCleanup) {
      this.cleanupResource(resource.id, 'memory_pressure');
    }
  }

  private handleEmergencyCleanup(): void {
    logger.error('Emergency memory cleanup triggered', {
      component: 'resource_manager'
    });

    // Force cleanup of all resources except critical ones
    this.forceCleanupAll('emergency_memory_pressure');
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
export const resourceManager = ResourceManager.getInstance();

// Event type definitions
export interface ResourceManagerEvents {
  manager_started: () => void;
  manager_stopped: () => void;
  resource_registered: (resource: ResourceInfo) => void;
  resource_removed: (data: { resourceId: string; resource: ResourceInfo }) => void;
  resource_state_changed: (data: { resourceId: string; oldState: ResourceState; newState: ResourceState; resource: ResourceInfo }) => void;
  resource_cleaned_up: (data: { resourceId: string; resource: ResourceInfo; reason: string }) => void;
  resource_cleanup_failed: (data: { resourceId: string; resource: ResourceInfo; reason: string; error: any }) => void;
  resource_limit_warning: (data: { resourceCount: number }) => void;
  resource_limit_critical: (data: { resourceCount: number }) => void;
  leaks_detected: (result: LeakDetectionResult) => void;
  force_cleanup_completed: (data: { cleanedCount: number; reason: string }) => void;
}