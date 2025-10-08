/**
 * @fileoverview Base Session Manager Implementation
 * 
 * Provides a base implementation of the unified session manager interface
 * with common functionality for session lifecycle management, cleanup,
 * and monitoring.
 */

import { randomUUID } from "node:crypto";
import logger from '../observability/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { 
  ISession, 
  ISessionManager, 
  SessionCreationOptions, 
  SessionCleanupResult,
  SessionConfig 
} from './interfaces';
import { CLIENT_DEFAULTS } from '../config/ClientConfig';
import { BufferSizeConfig } from '../utils/constants';
import { SessionError, extractErrorDetails } from '../errors/ClientErrors';

/**
 * Base session manager that provides common session management functionality
 */
export abstract class BaseSessionManager<T extends ISession> implements ISessionManager<T> {
  protected readonly sessions = new Map<string, T>();
  protected readonly sessionLastActivity = new Map<string, number>();
  protected readonly sessionCleanupInProgress = new Set<string>();
  protected readonly managerCreatedAt: number;
  
  // Automated cleanup configuration
  private cleanupIntervalHandle?: NodeJS.Timeout;
  private readonly defaultIdleTimeoutMs: number = 300000; // 5 minutes
  private readonly cleanupIntervalMs: number = 60000; // 1 minute
  private isShuttingDown: boolean = false;

  constructor(options: {
    enableAutomaticCleanup?: boolean;
    idleTimeoutMs?: number;
    cleanupIntervalMs?: number;
  } = {}) {
    this.managerCreatedAt = Date.now();
    
    if (options.enableAutomaticCleanup !== false) {
      this.startAutomaticCleanup(
        options.idleTimeoutMs || this.defaultIdleTimeoutMs,
        options.cleanupIntervalMs || this.cleanupIntervalMs
      );
    }
  }

  /**
   * Creates a new session with the specified configuration
   */
  public createSession(options: SessionCreationOptions = {}): T {
    const sessionId = options.sessionId || randomUUID();
    
    if (this.sessions.has(sessionId)) {
      throw new SessionError(`Session ${sessionId} already exists`, sessionId);
    }

    // Build session configuration with defaults
    const config: SessionConfig = {
      sessionId,
      maxQueueSize: options.maxQueueSize ?? CLIENT_DEFAULTS.MAX_AUDIO_QUEUE_SIZE,
      processingTimeout: options.processingTimeout ?? BufferSizeConfig.PROCESSING_TIMEOUT_MS,
      enableMetrics: options.enableMetrics ?? true,
      audioOptions: options.audioOptions,
      inferenceConfig: options.inferenceConfig,
      correlationContext: options.correlationContext || {
        correlationId: CorrelationIdManager.getCurrentCorrelationId() || randomUUID(),
        parentId: CorrelationIdManager.getCurrentContext()?.parentCorrelationId,
        traceId: CorrelationIdManager.getCurrentContext()?.correlationId,
      },
    };

    try {
      const session = this.createSessionInstance(config);
      this.sessions.set(sessionId, session);
      this.updateSessionActivity(sessionId);
      
      logger.info(`Session created successfully`, {
        sessionId,
        maxQueueSize: config.maxQueueSize,
        processingTimeout: config.processingTimeout,
        enableMetrics: config.enableMetrics,
        correlationId: config.correlationContext?.correlationId,
      });
      
      return session;
    } catch (error) {
      logger.error(`Failed to create session`, {
        sessionId,
        error: extractErrorDetails(error),
        correlationId: config.correlationContext?.correlationId,
      });
      throw error;
    }
  }

  /**
   * Retrieves a session by ID
   */
  public getSession(sessionId: string): T | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Removes a session and cleans up its resources
   */
  public async removeSession(sessionId: string): Promise<SessionCleanupResult> {
    return CorrelationIdManager.traceWithCorrelation('session_manager.remove_session', async () => {
      const startTime = Date.now();
      const session = this.sessions.get(sessionId);
      
      if (!session) {
        logger.warn(`Attempted to remove non-existent session`, { sessionId });
        return {
          sessionId,
          success: false,
          duration: Date.now() - startTime,
          cleanedResources: {
            buffersCleared: 0,
            handlersRemoved: 0,
            timeoutsCleared: 0,
          },
          errors: [new SessionError(`Session ${sessionId} not found`, sessionId)],
        };
      }

      // Mark session for cleanup to prevent concurrent operations
      this.sessionCleanupInProgress.add(sessionId);
      
      const errors: Error[] = [];
      let buffersCleared = 0;
      let handlersRemoved = 0;
      let timeoutsCleared = 0;

      try {
        // Get diagnostics before cleanup for logging
        const diagnostics = session.getDiagnostics();
        buffersCleared = diagnostics.memoryStats.inputBufferBytes + diagnostics.memoryStats.outputBufferBytes;
        
        // Close the session (this should handle internal cleanup)
        await session.close();
        
        // Remove from our tracking maps
        this.sessions.delete(sessionId);
        this.sessionLastActivity.delete(sessionId);
        this.sessionCleanupInProgress.delete(sessionId);
        
        const duration = Date.now() - startTime;
        
        logger.info(`Session removed successfully`, {
          sessionId,
          duration: `${duration}ms`,
          cleanedResources: {
            buffersCleared,
            handlersRemoved,
            timeoutsCleared,
          },
          correlationId: diagnostics.sessionInfo.correlationId,
        });
        
        return {
          sessionId,
          success: true,
          duration,
          cleanedResources: {
            buffersCleared,
            handlersRemoved,
            timeoutsCleared,
          },
        };
      } catch (error) {
        errors.push(error as Error);
        logger.error(`Error during session cleanup`, {
          sessionId,
          error: extractErrorDetails(error),
          duration: Date.now() - startTime,
        });
        
        // Ensure cleanup tracking is cleared even on error
        this.sessionCleanupInProgress.delete(sessionId);
        
        return {
          sessionId,
          success: false,
          duration: Date.now() - startTime,
          cleanedResources: {
            buffersCleared,
            handlersRemoved,
            timeoutsCleared,
          },
          errors,
        };
      }
    }, { 'session.id': sessionId });
  }

  /**
   * Gets all active sessions
   */
  public getAllSessions(): T[] {
    return Array.from(this.sessions.values()).filter(session => session.isActive);
  }

  /**
   * Gets all active session IDs
   */
  public getActiveSessionIds(): string[] {
    return Array.from(this.sessions.entries())
      .filter(([_, session]) => session.isActive)
      .map(([sessionId, _]) => sessionId);
  }

  /**
   * Checks if a session exists and is active
   */
  public isSessionActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && session.isActive && !this.sessionCleanupInProgress.has(sessionId);
  }

  /**
   * Cleans up idle sessions based on timeout
   */
  public async cleanupIdleSessions(idleTimeoutMs: number): Promise<SessionCleanupResult[]> {
    return CorrelationIdManager.traceWithCorrelation('session_manager.cleanup_idle_sessions', async () => {
      const idleSessions = Array.from(this.sessions.entries())
        .filter(([sessionId, session]) => {
          return session.isActive && 
                 session.isIdle(idleTimeoutMs) && 
                 !this.sessionCleanupInProgress.has(sessionId);
        })
        .map(([sessionId, _]) => sessionId);

      if (idleSessions.length === 0) {
        logger.debug(`No idle sessions found for cleanup`, { idleTimeoutMs });
        return [];
      }

      logger.info(`Cleaning up idle sessions`, {
        idleSessionCount: idleSessions.length,
        idleTimeoutMs,
        sessionIds: idleSessions,
      });

      const cleanupResults = await Promise.allSettled(
        idleSessions.map(sessionId => this.removeSession(sessionId))
      );

      return cleanupResults.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          const sessionId = idleSessions[index];
          logger.error(`Failed to cleanup idle session`, {
            sessionId,
            error: extractErrorDetails(result.reason),
          });
          
          return {
            sessionId,
            success: false,
            duration: 0,
            cleanedResources: {
              buffersCleared: 0,
              handlersRemoved: 0,
              timeoutsCleared: 0,
            },
            errors: [result.reason],
          };
        }
      });
    }, { 'idle_timeout_ms': idleTimeoutMs });
  }

  /**
   * Performs complete cleanup of all sessions
   */
  public async cleanup(): Promise<SessionCleanupResult[]> {
    return CorrelationIdManager.traceWithCorrelation('session_manager.cleanup_all', async () => {
      const allSessionIds = Array.from(this.sessions.keys());
      
      if (allSessionIds.length === 0) {
        logger.debug(`No sessions to cleanup`);
        return [];
      }

      logger.info(`Cleaning up all sessions`, {
        totalSessions: allSessionIds.length,
        sessionIds: allSessionIds,
      });

      const cleanupResults = await Promise.allSettled(
        allSessionIds.map(sessionId => this.removeSession(sessionId))
      );

      return cleanupResults.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          const sessionId = allSessionIds[index];
          logger.error(`Failed to cleanup session during manager cleanup`, {
            sessionId,
            error: extractErrorDetails(result.reason),
          });
          
          return {
            sessionId,
            success: false,
            duration: 0,
            cleanedResources: {
              buffersCleared: 0,
              handlersRemoved: 0,
              timeoutsCleared: 0,
            },
            errors: [result.reason],
          };
        }
      });
    });
  }

  /**
   * Gets manager statistics
   */
  public getManagerStats() {
    const allSessions = Array.from(this.sessions.values());
    const activeSessions = allSessions.filter(session => session.isActive);
    const now = Date.now();
    
    const totalMemoryUsage = activeSessions.reduce((total, session) => {
      const stats = session.getStats();
      return total + stats.memoryUsage;
    }, 0);
    
    const averageSessionAge = activeSessions.length > 0 
      ? activeSessions.reduce((total, session) => total + (now - session.createdAt), 0) / activeSessions.length
      : 0;
    
    const idleSessions = activeSessions.filter(session => session.isIdle(30000)); // 30 second idle threshold

    return {
      totalSessions: allSessions.length,
      activeSessions: activeSessions.length,
      idleSessions: idleSessions.length,
      totalMemoryUsage,
      averageSessionAge,
    };
  }

  /**
   * Updates session activity timestamp
   */
  protected updateSessionActivity(sessionId: string): void {
    this.sessionLastActivity.set(sessionId, Date.now());
  }

  /**
   * Gets last activity time for session
   */
  protected getLastActivityTime(sessionId: string): number {
    return this.sessionLastActivity.get(sessionId) || 0;
  }

  /**
   * Checks if cleanup is in progress for a session
   */
  protected isCleanupInProgress(sessionId: string): boolean {
    return this.sessionCleanupInProgress.has(sessionId);
  }

  /**
   * Starts automatic cleanup of idle sessions
   */
  private startAutomaticCleanup(idleTimeoutMs: number, intervalMs: number): void {
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
    }

    this.cleanupIntervalHandle = setInterval(async () => {
      if (this.isShuttingDown) {
        return;
      }

      try {
        const cleanupResults = await this.cleanupIdleSessions(idleTimeoutMs);
        if (cleanupResults.length > 0) {
          logger.info(`Automatic cleanup completed`, {
            cleanedSessions: cleanupResults.length,
            successfulCleanups: cleanupResults.filter(r => r.success).length,
            failedCleanups: cleanupResults.filter(r => !r.success).length,
          });
        }
      } catch (error) {
        logger.error(`Error during automatic session cleanup`, {
          error: extractErrorDetails(error),
        });
      }
    }, intervalMs);

    logger.info(`Automatic session cleanup started`, {
      idleTimeoutMs,
      intervalMs,
    });
  }

  /**
   * Stops automatic cleanup
   */
  public stopAutomaticCleanup(): void {
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = undefined;
      logger.info(`Automatic session cleanup stopped`);
    }
  }

  /**
   * Shuts down the session manager and cleans up all resources
   */
  public async shutdown(): Promise<void> {
    return CorrelationIdManager.traceWithCorrelation('session_manager.shutdown', async () => {
      this.isShuttingDown = true;
      
      logger.info(`Session manager shutdown initiated`, {
        totalSessions: this.sessions.size,
        activeSessions: this.getActiveSessionIds().length,
      });

      // Stop automatic cleanup
      this.stopAutomaticCleanup();

      // Clean up all sessions
      const cleanupResults = await this.cleanup();
      
      const successfulCleanups = cleanupResults.filter(r => r.success).length;
      const failedCleanups = cleanupResults.filter(r => !r.success).length;

      logger.info(`Session manager shutdown completed`, {
        totalCleanups: cleanupResults.length,
        successfulCleanups,
        failedCleanups,
      });

      if (failedCleanups > 0) {
        logger.warn(`Some sessions failed to cleanup during shutdown`, {
          failedCleanups,
          failedSessionIds: cleanupResults.filter(r => !r.success).map(r => r.sessionId),
        });
      }
    });
  }

  /**
   * Optimized session lookup with caching and validation
   */
  public getSessionOptimized(sessionId: string): T | undefined {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return undefined;
    }

    // Validate session is still active
    if (!session.isActive) {
      // Remove inactive session from cache
      this.sessions.delete(sessionId);
      this.sessionLastActivity.delete(sessionId);
      logger.debug(`Removed inactive session from cache`, { sessionId });
      return undefined;
    }

    // Update activity tracking
    this.updateSessionActivity(sessionId);
    return session;
  }

  /**
   * Batch session operations for better performance
   */
  public async batchRemoveSessions(sessionIds: string[]): Promise<SessionCleanupResult[]> {
    return CorrelationIdManager.traceWithCorrelation('session_manager.batch_remove_sessions', async () => {
      logger.info(`Batch removing sessions`, {
        sessionCount: sessionIds.length,
        sessionIds,
      });

      const cleanupPromises = sessionIds.map(sessionId => this.removeSession(sessionId));
      const results = await Promise.allSettled(cleanupPromises);

      return results.map((result, index) => {
        const sessionId = sessionIds[index];
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          logger.error(`Failed to remove session in batch operation`, {
            sessionId,
            error: extractErrorDetails(result.reason),
          });
          
          return {
            sessionId,
            success: false,
            duration: 0,
            cleanedResources: {
              buffersCleared: 0,
              handlersRemoved: 0,
              timeoutsCleared: 0,
            },
            errors: [result.reason],
          };
        }
      });
    }, { 'session_count': sessionIds.length });
  }

  /**
   * Gets sessions by state for efficient filtering
   */
  public getSessionsByState(): {
    active: T[];
    idle: T[];
    processing: T[];
    errored: T[];
  } {
    const active: T[] = [];
    const idle: T[] = [];
    const processing: T[] = [];
    const errored: T[] = [];

    const now = Date.now();
    const idleThreshold = 30000; // 30 seconds

    for (const session of this.sessions.values()) {
      if (!session.isActive) {
        continue;
      }

      const stats = session.getStats();
      const diagnostics = session.getDiagnostics();

      if (stats.errorCount > 0) {
        errored.push(session);
      } else if (diagnostics.performance.isProcessing) {
        processing.push(session);
      } else if (session.isIdle(idleThreshold)) {
        idle.push(session);
      } else {
        active.push(session);
      }
    }

    return { active, idle, processing, errored };
  }

  /**
   * Performs health check on all sessions
   */
  public performHealthCheck(): {
    healthy: number;
    unhealthy: number;
    issues: Array<{
      sessionId: string;
      issue: string;
      severity: 'warning' | 'error';
    }>;
  } {
    const issues: Array<{
      sessionId: string;
      issue: string;
      severity: 'warning' | 'error';
    }> = [];

    let healthy = 0;
    let unhealthy = 0;

    for (const session of this.sessions.values()) {
      try {
        const diagnostics = session.getDiagnostics();
        const stats = session.getStats();
        
        let sessionHealthy = true;

        // Check for high error rate
        if (stats.errorCount > 10) {
          issues.push({
            sessionId: session.sessionId,
            issue: `High error count: ${stats.errorCount}`,
            severity: 'error',
          });
          sessionHealthy = false;
        }

        // Check for memory pressure
        if (diagnostics.memoryStats.memoryPressure) {
          issues.push({
            sessionId: session.sessionId,
            issue: `Memory pressure detected: ${diagnostics.memoryStats.utilizationPercent}% utilization`,
            severity: 'warning',
          });
        }

        // Check for long idle time
        if (session.isIdle(300000)) { // 5 minutes
          issues.push({
            sessionId: session.sessionId,
            issue: `Session idle for over 5 minutes`,
            severity: 'warning',
          });
        }

        if (sessionHealthy) {
          healthy++;
        } else {
          unhealthy++;
        }
      } catch (error) {
        issues.push({
          sessionId: session.sessionId,
          issue: `Health check failed: ${error}`,
          severity: 'error',
        });
        unhealthy++;
      }
    }

    return { healthy, unhealthy, issues };
  }

  /**
   * Abstract method that subclasses must implement to create session instances
   */
  protected abstract createSessionInstance(config: SessionConfig): T;
}