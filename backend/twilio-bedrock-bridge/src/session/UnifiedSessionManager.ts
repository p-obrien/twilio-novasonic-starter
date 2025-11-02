/**
 * @fileoverview Unified Session Manager Implementation
 *
 * Modern session manager that extends BaseSessionManager to provide
 * comprehensive session lifecycle management with validation and cleanup.
 */

import { randomUUID } from "node:crypto";
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
 * Unified session manager that extends BaseSessionManager
 */
export class UnifiedSessionManager extends BaseSessionManager<UnifiedStreamSession> {
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