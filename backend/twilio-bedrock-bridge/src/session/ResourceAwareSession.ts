/**
 * Resource-Aware Session Wrapper
 * 
 * This module provides a wrapper around UnifiedStreamSession that integrates
 * with the ResourceManager for proper resource lifecycle management, timeout-based
 * cleanup, and resource leak detection.
 * 
 * Key features:
 * - Automatic resource registration and cleanup
 * - Timeout-based session cleanup
 * - Memory pressure integration
 * - Resource leak detection and prevention
 * - Enhanced session lifecycle management
 */

import { EventEmitter } from 'events';
import { UnifiedStreamSession, StreamClientInterface } from './UnifiedStreamSession';
import { SessionConfig, SessionDiagnostics, ISession } from './interfaces';
import { resourceManager, ResourceType, ResourceState, CleanupPriority } from '../utils/ResourceManager';
import { memoryPressureMonitor, MemoryPressureLevel } from '../observability/memoryPressureMonitor';
import { AudioStreamOptions, EventHandler, StreamEventType } from '../types/ClientTypes';
import logger from '../observability/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { extractErrorDetails } from '../errors/ClientErrors';

/**
 * Resource-aware session configuration
 */
export interface ResourceAwareSessionConfig extends SessionConfig {
  /** Resource cleanup timeout in milliseconds */
  resourceTimeoutMs?: number;
  /** Resource cleanup priority */
  cleanupPriority?: CleanupPriority;
  /** Enable automatic resource management */
  enableResourceManagement?: boolean;
  /** Memory pressure response configuration */
  memoryPressureConfig?: {
    /** Enable memory pressure response */
    enabled: boolean;
    /** Cleanup threshold (LOW, MODERATE, HIGH, CRITICAL) */
    cleanupThreshold: MemoryPressureLevel;
    /** Aggressive cleanup on critical pressure */
    aggressiveCleanup: boolean;
  };
}

/**
 * Resource statistics for the session
 */
export interface SessionResourceStats {
  /** Resource ID in the resource manager */
  resourceId: string;
  /** Current resource state */
  resourceState: ResourceState;
  /** Memory usage estimate */
  memoryUsage: number;
  /** Time since resource creation */
  resourceAge: number;
  /** Time since last activity */
  idleTime: number;
  /** Cleanup priority */
  priority: CleanupPriority;
  /** Whether resource is scheduled for cleanup */
  scheduledForCleanup: boolean;
}

/**
 * Resource-aware session wrapper that provides enhanced lifecycle management
 */
export class ResourceAwareSession extends EventEmitter implements ISession {
  private readonly session: UnifiedStreamSession;
  private readonly config: ResourceAwareSessionConfig;
  private resourceId?: string;
  private isResourceRegistered = false;
  private cleanupTimer?: NodeJS.Timeout;
  private memoryPressureListener?: () => void;

  constructor(
    config: ResourceAwareSessionConfig,
    client: StreamClientInterface,
    audioOptions: AudioStreamOptions = {}
  ) {
    super();
    
    this.config = {
      resourceTimeoutMs: 300000, // 5 minutes default
      cleanupPriority: CleanupPriority.NORMAL,
      enableResourceManagement: true,
      memoryPressureConfig: {
        enabled: true,
        cleanupThreshold: MemoryPressureLevel.HIGH,
        aggressiveCleanup: true
      },
      ...config
    };

    // Create the underlying session
    this.session = new UnifiedStreamSession(config, client, audioOptions);
    
    // Register with resource manager if enabled
    if (this.config.enableResourceManagement) {
      this.registerWithResourceManager();
      this.setupMemoryPressureHandling();
    }

    // Setup automatic timeout cleanup
    this.setupTimeoutCleanup();

    logger.info('ResourceAwareSession created', {
      sessionId: this.sessionId,
      resourceManagement: this.config.enableResourceManagement,
      resourceTimeout: this.config.resourceTimeoutMs,
      cleanupPriority: this.config.cleanupPriority,
      correlationId: config.correlationContext?.correlationId
    });
  }

  // ISession interface implementation - delegate to underlying session

  public get sessionId(): string {
    return this.session.sessionId;
  }

  public get isActive(): boolean {
    return this.session.isActive;
  }

  public get createdAt(): number {
    return this.session.createdAt;
  }

  public onEvent(eventType: StreamEventType, handler: EventHandler): ISession {
    this.session.onEvent(eventType, handler);
    this.updateResourceActivity();
    return this;
  }

  public async close(): Promise<void> {
    return CorrelationIdManager.traceWithCorrelation('resource_aware_session.close', async () => {
      logger.info('Closing resource-aware session', {
        sessionId: this.sessionId,
        resourceId: this.resourceId,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });

      try {
        // Clean up timers first
        this.cleanupTimers();
        
        // Remove memory pressure listener
        this.cleanupMemoryPressureHandling();
        
        // Close the underlying session
        await this.session.close();
        
        // Clean up resource registration
        await this.cleanupResourceRegistration();
        
        this.emit('session_closed', { sessionId: this.sessionId });
        
        logger.info('Resource-aware session closed successfully', {
          sessionId: this.sessionId,
          resourceId: this.resourceId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        logger.error('Error closing resource-aware session', {
          sessionId: this.sessionId,
          resourceId: this.resourceId,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        throw error;
      }
    }, { 'session.id': this.sessionId });
  }

  public getStats() {
    const sessionStats = this.session.getStats();
    const resourceStats = this.getResourceStats();
    
    return {
      ...sessionStats,
      resource: resourceStats
    };
  }

  public getDiagnostics(): SessionDiagnostics & { resource?: SessionResourceStats } {
    const sessionDiagnostics = this.session.getDiagnostics();
    const resourceStats = this.getResourceStats();
    
    return {
      ...sessionDiagnostics,
      resource: resourceStats
    };
  }

  public updateActivity(): void {
    this.session.updateActivity();
    this.updateResourceActivity();
  }

  public isIdle(thresholdMs: number): boolean {
    return this.session.isIdle(thresholdMs);
  }

  public getConfig(): ResourceAwareSessionConfig {
    return { ...this.config };
  }

  // UnifiedStreamSession methods - delegate with resource tracking

  public setupPromptStart(): void {
    this.session.setupPromptStart();
    this.updateResourceActivity();
  }

  public setupSystemPrompt(textConfig?: any, systemPromptContent?: string): void {
    this.session.setupSystemPrompt(textConfig, systemPromptContent);
    this.updateResourceActivity();
  }

  public setupStartAudio(audioConfig?: any): void {
    this.session.setupStartAudio(audioConfig);
    this.updateResourceActivity();
  }

  public async streamAudio(audioData: Buffer): Promise<void> {
    await this.session.streamAudio(audioData);
    this.updateResourceActivity();
  }

  public endUserTurn(): void {
    this.session.endUserTurn();
    this.updateResourceActivity();
  }

  public endAudioContent(): void {
    this.session.endAudioContent();
    this.updateResourceActivity();
  }

  public endPrompt(): void {
    this.session.endPrompt();
    this.updateResourceActivity();
  }

  public bufferAudioOutput(audioData: Buffer): void {
    this.session.bufferAudioOutput(audioData);
    this.updateResourceActivity();
  }

  public getAudioQueueStats() {
    return this.session.getAudioQueueStats();
  }

  public getRealtimeState() {
    return this.session.getRealtimeState();
  }

  public getMemoryStats() {
    return this.session.getMemoryStats();
  }

  public getErrorInfo() {
    return this.session.getErrorInfo();
  }

  // Resource management methods

  /**
   * Gets resource statistics for this session
   */
  public getResourceStats(): SessionResourceStats | undefined {
    if (!this.resourceId || !this.isResourceRegistered) {
      return undefined;
    }

    const resource = resourceManager.getResource(this.resourceId);
    if (!resource) {
      return undefined;
    }

    const now = Date.now();
    
    return {
      resourceId: this.resourceId,
      resourceState: resource.state,
      memoryUsage: resource.memoryUsage,
      resourceAge: now - resource.createdAt,
      idleTime: now - resource.lastActivity,
      priority: resource.priority,
      scheduledForCleanup: resource.state === ResourceState.CLEANUP_PENDING
    };
  }

  /**
   * Forces resource cleanup for this session
   */
  public async forceResourceCleanup(reason = 'manual'): Promise<boolean> {
    if (!this.resourceId || !this.isResourceRegistered) {
      logger.warn('Cannot force cleanup - resource not registered', {
        sessionId: this.sessionId,
        resourceId: this.resourceId
      });
      return false;
    }

    logger.info('Forcing resource cleanup', {
      sessionId: this.sessionId,
      resourceId: this.resourceId,
      reason
    });

    try {
      const success = await resourceManager.cleanupResource(this.resourceId, reason);
      
      if (success) {
        this.isResourceRegistered = false;
        this.resourceId = undefined;
        this.emit('resource_cleaned_up', { sessionId: this.sessionId, reason });
      }
      
      return success;
    } catch (error) {
      logger.error('Error forcing resource cleanup', {
        sessionId: this.sessionId,
        resourceId: this.resourceId,
        reason,
        error: extractErrorDetails(error)
      });
      return false;
    }
  }

  /**
   * Updates resource cleanup priority
   */
  public updateCleanupPriority(priority: CleanupPriority): boolean {
    if (!this.resourceId || !this.isResourceRegistered) {
      return false;
    }

    const resource = resourceManager.getResource(this.resourceId);
    if (!resource) {
      return false;
    }

    resource.priority = priority;
    this.config.cleanupPriority = priority;
    
    logger.debug('Updated cleanup priority', {
      sessionId: this.sessionId,
      resourceId: this.resourceId,
      newPriority: priority
    });

    return true;
  }

  // Private methods

  private registerWithResourceManager(): void {
    try {
      const memoryUsage = this.calculateInitialMemoryUsage();
      
      this.resourceId = resourceManager.registerResource({
        id: `session_${this.sessionId}`,
        type: ResourceType.SESSION,
        priority: this.config.cleanupPriority!,
        memoryUsage,
        timeoutMs: this.config.resourceTimeoutMs!,
        correlationId: this.config.correlationContext?.correlationId,
        metadata: {
          sessionType: 'UnifiedStreamSession',
          maxQueueSize: this.config.maxQueueSize,
          processingTimeout: this.config.processingTimeout
        },
        cleanup: this.performResourceCleanup.bind(this),
        owner: 'ResourceAwareSession'
      });

      this.isResourceRegistered = true;
      
      logger.debug('Session registered with resource manager', {
        sessionId: this.sessionId,
        resourceId: this.resourceId,
        memoryUsage,
        timeout: this.config.resourceTimeoutMs
      });
    } catch (error) {
      logger.error('Failed to register session with resource manager', {
        sessionId: this.sessionId,
        error: extractErrorDetails(error)
      });
    }
  }

  private async cleanupResourceRegistration(): Promise<void> {
    if (!this.resourceId || !this.isResourceRegistered) {
      return;
    }

    try {
      await resourceManager.cleanupResource(this.resourceId, 'session_close');
      this.isResourceRegistered = false;
      this.resourceId = undefined;
    } catch (error) {
      logger.error('Error cleaning up resource registration', {
        sessionId: this.sessionId,
        resourceId: this.resourceId,
        error: extractErrorDetails(error)
      });
    }
  }

  private async performResourceCleanup(): Promise<void> {
    logger.info('Performing resource cleanup for session', {
      sessionId: this.sessionId,
      resourceId: this.resourceId
    });

    try {
      // Close the session if it's still active
      if (this.session.isActive) {
        await this.session.close();
      }
      
      // Clean up timers and listeners
      this.cleanupTimers();
      this.cleanupMemoryPressureHandling();
      
      this.emit('resource_cleanup_completed', { sessionId: this.sessionId });
    } catch (error) {
      logger.error('Error in resource cleanup', {
        sessionId: this.sessionId,
        error: extractErrorDetails(error)
      });
      throw error;
    }
  }

  private updateResourceActivity(): void {
    if (this.resourceId && this.isResourceRegistered) {
      resourceManager.updateResourceActivity(this.resourceId);
    }
  }

  private setupTimeoutCleanup(): void {
    if (this.config.resourceTimeoutMs && this.config.resourceTimeoutMs > 0) {
      this.cleanupTimer = setTimeout(() => {
        logger.warn('Session timeout reached - initiating cleanup', {
          sessionId: this.sessionId,
          timeout: this.config.resourceTimeoutMs
        });
        
        this.forceResourceCleanup('timeout');
      }, this.config.resourceTimeoutMs);
    }
  }

  private setupMemoryPressureHandling(): void {
    if (!this.config.memoryPressureConfig?.enabled) {
      return;
    }

    const handleMemoryPressure = (level: MemoryPressureLevel) => {
      if (level >= this.config.memoryPressureConfig!.cleanupThreshold) {
        logger.info('Memory pressure detected - considering session cleanup', {
          sessionId: this.sessionId,
          pressureLevel: level,
          threshold: this.config.memoryPressureConfig!.cleanupThreshold
        });

        if (this.config.memoryPressureConfig!.aggressiveCleanup && 
            level === MemoryPressureLevel.CRITICAL) {
          this.forceResourceCleanup('memory_pressure_critical');
        } else if (this.session.isIdle(60000)) { // 1 minute idle
          this.forceResourceCleanup('memory_pressure_idle');
        }
      }
    };

    // Listen to memory pressure events
    memoryPressureMonitor.on('pressure_high', () => handleMemoryPressure(MemoryPressureLevel.HIGH));
    memoryPressureMonitor.on('pressure_critical', () => handleMemoryPressure(MemoryPressureLevel.CRITICAL));
    
    this.memoryPressureListener = () => handleMemoryPressure(MemoryPressureLevel.CRITICAL);
    memoryPressureMonitor.on('critical_pressure_cleanup_needed', this.memoryPressureListener);
  }

  private cleanupTimers(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private cleanupMemoryPressureHandling(): void {
    if (this.memoryPressureListener) {
      memoryPressureMonitor.removeListener('critical_pressure_cleanup_needed', this.memoryPressureListener);
      this.memoryPressureListener = undefined;
    }
  }

  private calculateInitialMemoryUsage(): number {
    // Estimate initial memory usage based on configuration
    const baseSessionSize = 1024; // Base session overhead
    const queueSize = this.config.maxQueueSize * 320; // Assume 320 bytes per audio chunk
    const configSize = JSON.stringify(this.config).length;
    
    return baseSessionSize + queueSize + configSize;
  }
}

// Event type definitions
export interface ResourceAwareSessionEvents {
  session_closed: (data: { sessionId: string }) => void;
  resource_cleaned_up: (data: { sessionId: string; reason: string }) => void;
  resource_cleanup_completed: (data: { sessionId: string }) => void;
}