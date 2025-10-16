/**
 * @fileoverview Unified Session Manager Implementation
 * 
 * Refactored SessionManager that implements the unified session manager interface
 * while maintaining compatibility with existing functionality.
 */

import { randomUUID } from "node:crypto";
import { Subject } from 'rxjs';
import { InferenceConfig } from "../types/SharedTypes";
import logger from '../observability/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { BaseSessionManager } from './BaseSessionManager';
import { UnifiedStreamSession, StreamClientInterface } from './UnifiedStreamSession';
import { SessionConfig, SessionCreationOptions, SessionCleanupResult } from './interfaces';
import { CLIENT_DEFAULTS } from '../config/ClientConfig';
import { BufferSizeConfig } from '../utils/constants';
import { extractErrorDetails } from '../errors/ClientErrors';

/**
 * Legacy session data interface for backward compatibility
 */
export interface SessionData {
  queue: Array<any>;
  queueSignal: Subject<void>;
  closeSignal: Subject<void>;
  responseSubject: Subject<any>;
  responseHandlers: Map<string, (data: any) => void>;
  promptName: string;
  inferenceConfig: InferenceConfig;
  isActive: boolean;
  isPromptStartSent: boolean;
  isAudioContentStartSent: boolean;
  audioContentId: string;
  isWaitingForResponse: boolean;
  streamCompleteObserved?: boolean;
  sessionEndObserved?: boolean;
}

/**
 * Unified session manager that extends BaseSessionManager and maintains
 * backward compatibility with the existing SessionManager interface
 */
export class UnifiedSessionManager extends BaseSessionManager<UnifiedStreamSession> {
  private legacySessions = new Map<string, SessionData>();
  private readonly client: StreamClientInterface;

  constructor(
    client?: StreamClientInterface,
    options: {
      enableAutomaticCleanup?: boolean;
      idleTimeoutMs?: number;
      cleanupIntervalMs?: number;
    } = {}
  ) {
    super(options);
    this.client = client || this.createMockClient();
    
    logger.debug('UnifiedSessionManager constructor', {
      hasClient: !!this.client,
      clientProvided: !!client,
      usingMockClient: !client
    });
    
    logger.info(`UnifiedSessionManager initialized`, {
      enableAutomaticCleanup: options.enableAutomaticCleanup !== false,
      idleTimeoutMs: options.idleTimeoutMs || 300000,
      cleanupIntervalMs: options.cleanupIntervalMs || 60000,
    });
  }

  /**
   * Creates a mock client for testing purposes
   */
  private createMockClient(): StreamClientInterface {
    const mockClient = {
      // Core session operations
      isSessionActive: () => true,
      registerEventHandler: () => {},
      
      // Session setup operations
      setupPromptStartEvent: () => {},
      setupSystemPromptEvent: () => {},
      setupStartAudioEvent: () => {},
      
      // Audio streaming operations
      streamAudioChunk: () => Promise.resolve(),
      
      // Session control operations
      sendContentEnd: () => {},
      sendPromptEnd: () => {},
      sendSessionEnd: () => {},
      
      // Real-time conversation features (optional methods)
      enableRealtimeInterruption: () => {},
      
      // Legacy methods for backward compatibility
      startConversation: () => Promise.resolve(),
      sendAudioChunk: () => Promise.resolve(),
      endConversation: () => Promise.resolve(),
      onResponse: () => {},
      onError: () => {},
      close: () => Promise.resolve(),
    } as any;
    
    logger.debug('Created mock client for testing', { 
      mockClient: !!mockClient,
      methods: Object.keys(mockClient)
    });
    
    return mockClient;
  }

  /**
   * Creates a session instance (implements BaseSessionManager abstract method)
   */
  protected createSessionInstance(config: SessionConfig): UnifiedStreamSession {
    logger.debug('Creating session instance', {
      sessionId: config.sessionId,
      hasClient: !!this.client,
      clientType: this.client?.constructor?.name
    });
    
    return new UnifiedStreamSession(config, this.client, config.audioOptions);
  }

  /**
   * Creates a new session with optional configuration parameter (overrides base method)
   * Supports both new signature: createSession(options) and legacy signature: createSession(sessionId, config)
   */
  public createSession(sessionIdOrOptions?: string | SessionCreationOptions, legacyConfig?: any): UnifiedStreamSession {
    let options: SessionCreationOptions;

    // Handle legacy signature: createSession(sessionId, config)
    if (typeof sessionIdOrOptions === 'string') {
      const sessionId = sessionIdOrOptions;
      options = {
        sessionId,
        ...this.normalizeLegacyConfig(legacyConfig),
      };
    } 
    // Handle new signature: createSession(options)
    else {
      options = sessionIdOrOptions || {};
    }

    // Provide default values for all configuration options
    const sessionConfig: SessionCreationOptions = {
      sessionId: options.sessionId,
      maxQueueSize: options.maxQueueSize ?? CLIENT_DEFAULTS.MAX_AUDIO_QUEUE_SIZE,
      processingTimeout: options.processingTimeout ?? BufferSizeConfig.PROCESSING_TIMEOUT_MS,
      enableMetrics: options.enableMetrics ?? true,
      audioOptions: options.audioOptions,
      inferenceConfig: options.inferenceConfig,
      correlationContext: options.correlationContext,
    };

    // Validate configuration parameters
    this.validateSessionConfig(sessionConfig);

    // Call parent createSession with validated options
    return super.createSession(sessionConfig);
  }

  /**
   * Normalizes legacy configuration format to new format
   */
  private normalizeLegacyConfig(legacyConfig: any): Partial<SessionCreationOptions> {
    if (!legacyConfig) {
      return {};
    }

    const normalized: Partial<SessionCreationOptions> = {};

    // Map legacy properties to new format
    if (legacyConfig.sessionId) {
      normalized.sessionId = legacyConfig.sessionId;
    }

    if (legacyConfig.maxQueueSize !== undefined) {
      normalized.maxQueueSize = legacyConfig.maxQueueSize;
    }

    if (legacyConfig.processingTimeout !== undefined) {
      normalized.processingTimeout = legacyConfig.processingTimeout;
    }

    if (legacyConfig.enableMetrics !== undefined) {
      normalized.enableMetrics = legacyConfig.enableMetrics;
    }

    if (legacyConfig.audioOptions) {
      normalized.audioOptions = legacyConfig.audioOptions;
    }

    if (legacyConfig.inferenceConfig) {
      normalized.inferenceConfig = legacyConfig.inferenceConfig;
    }

    // Handle legacy correlationContext format
    if (legacyConfig.correlationContext) {
      normalized.correlationContext = this.normalizeCorrelationContext(legacyConfig.correlationContext);
    }

    // Handle direct correlation properties
    if (legacyConfig.correlationId) {
      normalized.correlationContext = {
        correlationId: legacyConfig.correlationId,
        parentId: legacyConfig.parentId,
        traceId: legacyConfig.traceId,
      };
    }

    return normalized;
  }

  /**
   * Normalizes correlation context to ensure required properties
   */
  private normalizeCorrelationContext(context: any): any {
    if (!context || typeof context !== 'object') {
      return undefined;
    }

    return {
      correlationId: context.correlationId || randomUUID(),
      parentId: context.parentId,
      traceId: context.traceId || context.correlationId,
      timestamp: context.timestamp || Date.now(),
      source: context.source || 'session-manager',
      ...context, // Preserve any additional properties
    };
  }

  /**
   * Validates session configuration parameters
   */
  private validateSessionConfig(config: SessionCreationOptions): void {
    // Validate maxQueueSize
    if (config.maxQueueSize !== undefined && (config.maxQueueSize < 1 || config.maxQueueSize > 10000)) {
      throw new Error(`Invalid maxQueueSize: ${config.maxQueueSize}. Must be between 1 and 10000.`);
    }

    // Validate processingTimeout
    if (config.processingTimeout !== undefined && (config.processingTimeout < 1000 || config.processingTimeout > 300000)) {
      throw new Error(`Invalid processingTimeout: ${config.processingTimeout}. Must be between 1000ms and 300000ms.`);
    }

    // Validate sessionId format if provided
    if (config.sessionId && typeof config.sessionId !== 'string') {
      throw new Error(`Invalid sessionId: must be a string`);
    }

    // Validate sessionId length and format
    if (config.sessionId && (config.sessionId.length < 1 || config.sessionId.length > 128)) {
      throw new Error(`Invalid sessionId length: ${config.sessionId.length}. Must be between 1 and 128 characters.`);
    }

    // Validate correlationContext if provided
    if (config.correlationContext) {
      if (!config.correlationContext.correlationId || typeof config.correlationContext.correlationId !== 'string') {
        throw new Error(`Invalid correlationContext: correlationId must be a non-empty string`);
      }
    }

    // Validate audioOptions if provided
    if (config.audioOptions) {
      this.validateAudioOptions(config.audioOptions);
    }

    // Validate inferenceConfig if provided
    if (config.inferenceConfig) {
      this.validateInferenceConfig(config.inferenceConfig);
    }
  }

  /**
   * Validates audio options configuration
   */
  private validateAudioOptions(audioOptions: any): void {
    if (audioOptions.maxQueueSize && (audioOptions.maxQueueSize < 1 || audioOptions.maxQueueSize > 10000)) {
      throw new Error(`Invalid audio maxQueueSize: ${audioOptions.maxQueueSize}. Must be between 1 and 10000.`);
    }

    if (audioOptions.maxChunksPerBatch && (audioOptions.maxChunksPerBatch < 1 || audioOptions.maxChunksPerBatch > 100)) {
      throw new Error(`Invalid audio maxChunksPerBatch: ${audioOptions.maxChunksPerBatch}. Must be between 1 and 100.`);
    }

    if (audioOptions.processingTimeoutMs && (audioOptions.processingTimeoutMs < 100 || audioOptions.processingTimeoutMs > 60000)) {
      throw new Error(`Invalid audio processingTimeoutMs: ${audioOptions.processingTimeoutMs}. Must be between 100ms and 60000ms.`);
    }
  }

  /**
   * Validates inference configuration
   */
  private validateInferenceConfig(inferenceConfig: InferenceConfig): void {
    if (inferenceConfig.maxTokens && (inferenceConfig.maxTokens < 1 || inferenceConfig.maxTokens > 100000)) {
      throw new Error(`Invalid inferenceConfig.maxTokens: ${inferenceConfig.maxTokens}. Must be between 1 and 100000.`);
    }

    if (inferenceConfig.temperature && (inferenceConfig.temperature < 0 || inferenceConfig.temperature > 2)) {
      throw new Error(`Invalid inferenceConfig.temperature: ${inferenceConfig.temperature}. Must be between 0 and 2.`);
    }

    if (inferenceConfig.topP && (inferenceConfig.topP < 0 || inferenceConfig.topP > 1)) {
      throw new Error(`Invalid inferenceConfig.topP: ${inferenceConfig.topP}. Must be between 0 and 1.`);
    }
  }

  /**
   * Provides test-friendly default configurations
   */
  public static getTestDefaults(): SessionCreationOptions {
    return {
      maxQueueSize: 100,
      processingTimeout: 30000,
      enableMetrics: true,
      audioOptions: {
        maxQueueSize: 100,
        maxChunksPerBatch: 10,
        dropOldestOnFull: true,
        processingTimeoutMs: 5000,
        realtimeMode: false,
      },
      inferenceConfig: {
        maxTokens: 1000,
        temperature: 0.7,
        topP: 0.9,
      },
      correlationContext: {
        correlationId: 'test-correlation-id',
        parentId: 'test-parent-id',
        traceId: 'test-trace-id',
      },
    };
  }

  /**
   * Creates a session with test-friendly defaults
   */
  public createTestSession(sessionId?: string, overrides?: Partial<SessionCreationOptions>): UnifiedStreamSession {
    const defaults = UnifiedSessionManager.getTestDefaults();
    const config: SessionCreationOptions = {
      ...defaults,
      ...overrides,
      sessionId: sessionId || `test-session-${randomUUID()}`,
    };

    return this.createSession(config);
  }

  /**
   * Creates a new session with legacy SessionData for backward compatibility
   */
  public createLegacySession(sessionId: string, inferenceConfig: InferenceConfig): SessionData {
    if (this.legacySessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    // Create the unified session first
    const unifiedSession = this.createSession({
      sessionId,
      inferenceConfig,
      enableMetrics: true,
    });

    // Create legacy session data structure
    const legacySession: SessionData = {
      queue: [],
      queueSignal: new Subject<void>(),
      closeSignal: new Subject<void>(),
      responseSubject: new Subject<any>(),
      responseHandlers: new Map(),
      promptName: randomUUID(),
      inferenceConfig,
      isActive: true,
      isPromptStartSent: false,
      isAudioContentStartSent: false,
      audioContentId: randomUUID(),
      isWaitingForResponse: false
    };

    this.legacySessions.set(sessionId, legacySession);
    this.updateSessionActivity(sessionId);
    
    logger.info(`Legacy session ${sessionId} created with unified backend`);
    return legacySession;
  }

  /**
   * Retrieves legacy session data by ID
   */
  public getLegacySession(sessionId: string): SessionData | undefined {
    return this.legacySessions.get(sessionId);
  }

  /**
   * Checks if session is active (legacy compatibility)
   */
  public isLegacySessionActive(sessionId: string): boolean {
    const legacySession = this.legacySessions.get(sessionId);
    const unifiedSession = this.getSession(sessionId);
    return !!(legacySession && legacySession.isActive && unifiedSession && unifiedSession.isActive);
  }

  /**
   * Gets all active session IDs (legacy compatibility)
   */
  public getLegacyActiveSessions(): string[] {
    return Array.from(this.legacySessions.entries())
      .filter(([sessionId, session]) => {
        const unifiedSession = this.getSession(sessionId);
        return session.isActive && unifiedSession && unifiedSession.isActive;
      })
      .map(([sessionId, _]) => sessionId);
  }

  /**
   * Marks session for cleanup (legacy compatibility)
   */
  public markForCleanup(sessionId: string): void {
    this.sessionCleanupInProgress.add(sessionId);
  }

  /**
   * Removes session and cleans up resources (enhanced version)
   */
  public async removeLegacySession(sessionId: string): Promise<void> {
    return CorrelationIdManager.traceWithCorrelation('session_manager.remove_legacy_session', async () => {
      const legacySession = this.legacySessions.get(sessionId);
      const unifiedSession = this.getSession(sessionId);
      
      try {
        // Clean up legacy session data
        if (legacySession) {
          legacySession.isActive = false;
          legacySession.queueSignal.complete();
          legacySession.closeSignal.complete();
          legacySession.responseSubject.complete();
          this.legacySessions.delete(sessionId);
        }

        // Clean up unified session
        if (unifiedSession) {
          await this.removeSession(sessionId);
        }
        
        logger.info(`Legacy session ${sessionId} removed successfully`);
      } catch (error) {
        logger.error(`Error removing legacy session ${sessionId}:`, error);
        throw error;
      }
    }, { 'session.id': sessionId });
  }

  /**
   * Enhanced session creation with both unified and legacy support
   */
  public createEnhancedSession(options: SessionCreationOptions & {
    createLegacyData?: boolean;
    inferenceConfig?: InferenceConfig;
  }): {
    unifiedSession: UnifiedStreamSession;
    legacySession?: SessionData;
  } {
    const sessionId = options.sessionId || randomUUID();
    
    // Create unified session
    const unifiedSession = this.createSession({
      ...options,
      sessionId,
    });

    let legacySession: SessionData | undefined;

    // Create legacy session data if requested
    if (options.createLegacyData && options.inferenceConfig) {
      legacySession = {
        queue: [],
        queueSignal: new Subject<void>(),
        closeSignal: new Subject<void>(),
        responseSubject: new Subject<any>(),
        responseHandlers: new Map(),
        promptName: randomUUID(),
        inferenceConfig: options.inferenceConfig,
        isActive: true,
        isPromptStartSent: false,
        isAudioContentStartSent: false,
        audioContentId: randomUUID(),
        isWaitingForResponse: false
      };

      this.legacySessions.set(sessionId, legacySession);
    }

    logger.info(`Enhanced session created`, {
      sessionId,
      hasLegacyData: !!legacySession,
      correlationId: unifiedSession.getConfig().correlationContext?.correlationId,
    });

    return {
      unifiedSession,
      legacySession,
    };
  }

  /**
   * Gets comprehensive manager statistics including legacy sessions
   */
  public getEnhancedManagerStats() {
    const baseStats = this.getManagerStats();
    const legacySessionCount = this.legacySessions.size;
    const activeLegacySessions = Array.from(this.legacySessions.values())
      .filter(session => session.isActive).length;

    return {
      ...baseStats,
      legacySessions: {
        total: legacySessionCount,
        active: activeLegacySessions,
        inactive: legacySessionCount - activeLegacySessions,
      },
      compatibility: {
        unifiedSessionsWithLegacyData: Array.from(this.sessions.keys())
          .filter(sessionId => this.legacySessions.has(sessionId)).length,
        orphanedLegacySessions: Array.from(this.legacySessions.keys())
          .filter(sessionId => !this.sessions.has(sessionId)).length,
      }
    };
  }

  /**
   * Performs cleanup of both unified and legacy sessions
   */
  public async cleanupAll(): Promise<void> {
    return CorrelationIdManager.traceWithCorrelation('session_manager.cleanup_all', async () => {
      const allSessionIds = new Set([
        ...this.sessions.keys(),
        ...this.legacySessions.keys()
      ]);

      logger.info(`Cleaning up all sessions`, {
        totalUnifiedSessions: this.sessions.size,
        totalLegacySessions: this.legacySessions.size,
        uniqueSessionIds: allSessionIds.size,
      });

      const cleanupPromises = Array.from(allSessionIds).map(async (sessionId) => {
        try {
          await this.removeLegacySession(sessionId);
        } catch (error) {
          logger.error(`Failed to cleanup session ${sessionId}:`, error);
        }
      });

      await Promise.allSettled(cleanupPromises);
      
      // Clear any remaining tracking data
      this.legacySessions.clear();
      this.sessionCleanupInProgress.clear();
      
      logger.info(`Session cleanup completed`);
    });
  }

  /**
   * Migrates legacy sessions to unified sessions
   */
  public migrateLegacySession(sessionId: string): UnifiedStreamSession | null {
    const legacySession = this.legacySessions.get(sessionId);
    if (!legacySession) {
      logger.warn(`No legacy session found for migration: ${sessionId}`);
      return null;
    }

    // Check if unified session already exists
    let unifiedSession = this.getSession(sessionId);
    if (unifiedSession) {
      logger.info(`Unified session already exists for ${sessionId}`);
      return unifiedSession;
    }

    try {
      // Create unified session with legacy session's configuration
      unifiedSession = this.createSession({
        sessionId,
        inferenceConfig: legacySession.inferenceConfig,
        enableMetrics: true,
        maxQueueSize: CLIENT_DEFAULTS.MAX_AUDIO_QUEUE_SIZE,
        processingTimeout: BufferSizeConfig.PROCESSING_TIMEOUT_MS,
      });

      logger.info(`Successfully migrated legacy session to unified session`, {
        sessionId,
        correlationId: unifiedSession.getConfig().correlationContext?.correlationId,
      });

      return unifiedSession;
    } catch (error) {
      logger.error(`Failed to migrate legacy session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Validates session consistency between unified and legacy systems
   */
  public validateSessionConsistency(): {
    consistent: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for orphaned legacy sessions
    const orphanedLegacy = Array.from(this.legacySessions.keys())
      .filter(sessionId => !this.sessions.has(sessionId));
    
    if (orphanedLegacy.length > 0) {
      issues.push(`Found ${orphanedLegacy.length} orphaned legacy sessions: ${orphanedLegacy.join(', ')}`);
      recommendations.push('Consider migrating orphaned legacy sessions or cleaning them up');
    }

    // Check for unified sessions without legacy data (if expected)
    const unifiedWithoutLegacy = Array.from(this.sessions.keys())
      .filter(sessionId => !this.legacySessions.has(sessionId));
    
    if (unifiedWithoutLegacy.length > 0) {
      logger.debug(`Found ${unifiedWithoutLegacy.length} unified sessions without legacy data (this may be expected)`);
    }

    // Check for inactive sessions that should be cleaned up
    const inactiveSessions = Array.from(this.sessions.entries())
      .filter(([_, session]) => !session.isActive)
      .map(([sessionId, _]) => sessionId);
    
    if (inactiveSessions.length > 0) {
      issues.push(`Found ${inactiveSessions.length} inactive sessions that should be cleaned up`);
      recommendations.push('Run cleanup to remove inactive sessions');
    }

    const consistent = issues.length === 0;

    logger.info(`Session consistency validation completed`, {
      consistent,
      totalIssues: issues.length,
      totalRecommendations: recommendations.length,
    });

    return {
      consistent,
      issues,
      recommendations,
    };
  }

  /**
   * Optimized session state management with consistent state transitions
   */
  public manageSessionState(sessionId: string, newState: 'active' | 'idle' | 'processing' | 'closing'): boolean {
    const session = this.getSession(sessionId);
    const legacySession = this.legacySessions.get(sessionId);

    if (!session) {
      logger.warn(`Cannot manage state for non-existent session`, { sessionId, newState });
      return false;
    }

    try {
      // Update unified session state
      switch (newState) {
        case 'active':
          session.updateActivity();
          if (legacySession) {
            legacySession.isActive = true;
          }
          break;
          
        case 'idle':
          // Session remains active but is considered idle
          if (legacySession) {
            legacySession.isWaitingForResponse = false;
          }
          break;
          
        case 'processing':
          session.updateActivity();
          if (legacySession) {
            legacySession.isWaitingForResponse = true;
          }
          break;
          
        case 'closing':
          if (legacySession) {
            legacySession.isActive = false;
          }
          // Note: session.close() should be called separately
          break;
      }

      logger.debug(`Session state updated`, {
        sessionId,
        newState,
        hasLegacySession: !!legacySession,
      });

      return true;
    } catch (error) {
      logger.error(`Failed to manage session state`, {
        sessionId,
        newState,
        error: extractErrorDetails(error),
      });
      return false;
    }
  }

  /**
   * Bulk session operations for better performance
   */
  public async bulkSessionOperation<T>(
    sessionIds: string[],
    operation: (session: UnifiedStreamSession) => Promise<T>,
    options: {
      concurrency?: number;
      continueOnError?: boolean;
    } = {}
  ): Promise<Array<{ sessionId: string; result?: T; error?: Error }>> {
    return CorrelationIdManager.traceWithCorrelation('session_manager.bulk_session_operation', async () => {
      const { concurrency = 5, continueOnError = true } = options;
      const results: Array<{ sessionId: string; result?: T; error?: Error }> = [];

      logger.info(`Starting bulk session operation`, {
        sessionCount: sessionIds.length,
        concurrency,
        continueOnError,
      });

      // Process sessions in batches to control concurrency
      for (let i = 0; i < sessionIds.length; i += concurrency) {
        const batch = sessionIds.slice(i, i + concurrency);
        
        const batchPromises = batch.map(async (sessionId) => {
          try {
            const session = this.getSession(sessionId);
            if (!session) {
              return { sessionId, error: new Error(`Session ${sessionId} not found`) };
            }

            const result = await operation(session);
            return { sessionId, result };
          } catch (error) {
            const errorResult = { sessionId, error: error as Error };
            
            if (!continueOnError) {
              throw error;
            }
            
            logger.error(`Error in bulk operation for session ${sessionId}`, {
              error: extractErrorDetails(error),
            });
            
            return errorResult;
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push({
              sessionId: 'unknown',
              error: result.reason,
            });
          }
        }
      }

      const successCount = results.filter(r => !r.error).length;
      const errorCount = results.filter(r => r.error).length;

      logger.info(`Bulk session operation completed`, {
        totalSessions: sessionIds.length,
        successCount,
        errorCount,
      });

      return results;
    }, { 'session_count': sessionIds.length });
  }

  /**
   * Advanced session cleanup with configurable strategies
   */
  public async advancedCleanup(strategy: {
    maxIdleTime?: number;
    maxErrorCount?: number;
    maxMemoryUsage?: number;
    forceCleanupInactive?: boolean;
  } = {}): Promise<{
    cleanedSessions: SessionCleanupResult[];
    summary: {
      totalCleaned: number;
      cleanedByIdleTime: number;
      cleanedByErrorCount: number;
      cleanedByMemoryUsage: number;
      cleanedByInactivity: number;
    };
  }> {
    return CorrelationIdManager.traceWithCorrelation('session_manager.advanced_cleanup', async () => {
      const {
        maxIdleTime = 300000, // 5 minutes
        maxErrorCount = 10,
        maxMemoryUsage = 50 * 1024 * 1024, // 50MB
        forceCleanupInactive = true,
      } = strategy;

      const sessionsToClean: Array<{ sessionId: string; reason: string }> = [];

      // Analyze all sessions
      for (const [sessionId, session] of Array.from(this.sessions.entries())) {
        try {
          const stats = session.getStats();
          const diagnostics = session.getDiagnostics();

          // Check idle time
          if (session.isIdle(maxIdleTime)) {
            sessionsToClean.push({ sessionId, reason: 'idle_timeout' });
            continue;
          }

          // Check error count
          if (stats.errorCount >= maxErrorCount) {
            sessionsToClean.push({ sessionId, reason: 'high_error_count' });
            continue;
          }

          // Check memory usage
          if (stats.memoryUsage >= maxMemoryUsage) {
            sessionsToClean.push({ sessionId, reason: 'high_memory_usage' });
            continue;
          }

          // Check if inactive
          if (forceCleanupInactive && !session.isActive) {
            sessionsToClean.push({ sessionId, reason: 'inactive' });
            continue;
          }
        } catch (error) {
          logger.error(`Error analyzing session for cleanup`, {
            sessionId,
            error: extractErrorDetails(error),
          });
          sessionsToClean.push({ sessionId, reason: 'analysis_error' });
        }
      }

      logger.info(`Advanced cleanup analysis completed`, {
        totalSessions: this.sessions.size,
        sessionsToClean: sessionsToClean.length,
        reasons: sessionsToClean.reduce((acc, { reason }) => {
          acc[reason] = (acc[reason] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      });

      // Perform cleanup
      const cleanupResults = await this.batchRemoveSessions(
        sessionsToClean.map(s => s.sessionId)
      );

      // Generate summary
      const summary = {
        totalCleaned: cleanupResults.filter(r => r.success).length,
        cleanedByIdleTime: sessionsToClean.filter(s => s.reason === 'idle_timeout').length,
        cleanedByErrorCount: sessionsToClean.filter(s => s.reason === 'high_error_count').length,
        cleanedByMemoryUsage: sessionsToClean.filter(s => s.reason === 'high_memory_usage').length,
        cleanedByInactivity: sessionsToClean.filter(s => s.reason === 'inactive').length,
      };

      return {
        cleanedSessions: cleanupResults,
        summary,
      };
    });
  }
}