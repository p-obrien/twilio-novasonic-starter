/**
 * @fileoverview Unified Stream Session Implementation
 * 
 * Refactored StreamSession that implements the unified session interface
 * while maintaining all existing functionality and improving consistency.
 */

import { Buffer } from "node:buffer";
import logger from '../observability/logger';
import { CLIENT_DEFAULTS } from '../config/ClientConfig';
import { 
  AudioProcessingError, 
  SessionInactiveError, 
  SessionError,
  extractErrorDetails 
} from '../errors/ClientErrors';
import { EventHandler, AudioStreamOptions, StreamEventType } from '../types/ClientTypes';
import { CorrelationIdManager } from '../utils/correlationId';
import {
  DefaultAudioInputConfiguration,
  DefaultTextConfiguration,
  DefaultSystemPrompt,
  BufferSizeConfig
} from "../utils/constants";
import { BaseSession, ISession, SessionConfig, SessionDiagnostics } from './interfaces';
import { SessionErrorHandler, ErrorSeverity, ErrorCategory } from './SessionErrorHandler';

/**
 * Interface for the underlying client that manages sessions
 */
export interface StreamClientInterface {
  // Core session operations
  isSessionActive(sessionId: string): boolean;
  registerEventHandler(sessionId: string, eventType: string, handler: EventHandler): void;
  
  // Session setup operations
  setupPromptStartEvent(sessionId: string): void;
  setupSystemPromptEvent(sessionId: string, textConfig: any, systemPromptContent: string): void;
  setupStartAudioEvent(sessionId: string, audioConfig: any): void;
  
  // Audio streaming operations
  streamAudioChunk(sessionId: string, audioData: Buffer): Promise<void>;
  
  // Session control operations
  sendContentEnd(sessionId: string): void;
  sendPromptEnd(sessionId: string): void;
  sendSessionEnd(sessionId: string): void;
  
  // Real-time conversation features (optional methods)
  enableRealtimeInterruption?(sessionId: string): void;
  handleUserInterruption?(sessionId: string): void;
  setUserSpeakingState?(sessionId: string, speaking: boolean): void;
  
  // Session lifecycle management (optional methods)
  removeStreamSession?(sessionId: string): void;
  streamAudioRealtime?(sessionId: string, audioData: Buffer): Promise<void>;
}

/**
 * Unified streaming session that implements the ISession interface
 * while providing all audio streaming capabilities
 */
export class UnifiedStreamSession extends BaseSession {
  private audioBufferQueue: Buffer[] = [];
  private audioOutputBuffer: Buffer[] = [];
  private isProcessingAudio = false;
  private readonly maxOutputBufferSize: number;
  private readonly maxChunksPerBatch: number;
  private readonly processingTimeoutMs: number;
  private readonly dropOldestOnFull: boolean;
  
  // Real-time conversation state
  private realtimeMode = false;
  private userSpeaking = false;
  private lastUserActivity?: number;
  
  // Performance optimization state
  private processingTimeoutHandle?: NodeJS.Timeout;
  private memoryPressureThreshold: number;
  
  // Error handling
  private readonly errorHandler: SessionErrorHandler;

  constructor(
    config: SessionConfig,
    private readonly client: StreamClientInterface,
    audioOptions: AudioStreamOptions = {}
  ) {
    super(config);
    
    try {
      // Validate required parameters
      if (!client) {
        throw new SessionError('Client interface is required', config.sessionId);
      }

      this.maxChunksPerBatch = audioOptions.maxChunksPerBatch ?? CLIENT_DEFAULTS.MAX_CHUNKS_PER_BATCH;
      this.maxOutputBufferSize = audioOptions.maxOutputBufferSize ?? CLIENT_DEFAULTS.MAX_AUDIO_QUEUE_SIZE;
      this.processingTimeoutMs = audioOptions.processingTimeoutMs ?? BufferSizeConfig.PROCESSING_TIMEOUT_MS;
      this.dropOldestOnFull = audioOptions.dropOldestOnFull ?? true;
      
      // Memory pressure threshold (80% of combined buffer capacity)
      this.memoryPressureThreshold = Math.floor((config.maxQueueSize + this.maxOutputBufferSize) * 0.8);
      
      // Initialize error handler
      this.errorHandler = new SessionErrorHandler();
      
      // Validate configuration values
      if (config.maxQueueSize <= 0 || this.maxChunksPerBatch <= 0 || this.maxOutputBufferSize <= 0) {
        throw new SessionError('Buffer size configurations must be positive integers', config.sessionId);
      }
      
      // Initialize correlation context for this session
      if (config.correlationContext) {
        CorrelationIdManager.setContext({
          correlationId: config.correlationContext.correlationId,
          parentCorrelationId: config.correlationContext.parentId,
          sessionId: config.sessionId,
          timestamp: Date.now(),
          source: 'internal',
        });
      }
      
      logger.info(`UnifiedStreamSession created successfully`, {
        sessionId: config.sessionId,
        maxQueueSize: config.maxQueueSize,
        maxChunksPerBatch: this.maxChunksPerBatch,
        maxOutputBufferSize: this.maxOutputBufferSize,
        correlationId: config.correlationContext?.correlationId
      });
    } catch (error) {
      logger.error(`Failed to create UnifiedStreamSession`, {
        sessionId: config.sessionId,
        error: extractErrorDetails(error),
        correlationId: config.correlationContext?.correlationId
      });
      throw error;
    }
  }

  /**
   * Registers an event handler for this session (overrides base implementation)
   */
  public onEvent(eventType: StreamEventType, handler: EventHandler): ISession {
    try {
      this.ensureSessionActive();
      
      if (!eventType || typeof eventType !== 'string') {
        throw new SessionError('Event type must be a non-empty string', this.sessionId);
      }
      if (!handler || typeof handler !== 'function') {
        throw new SessionError('Event handler must be a function', this.sessionId);
      }
      
      // Register with both the client and our internal handler system
      this.client.registerEventHandler(this.sessionId, eventType, handler);
      super.onEvent(eventType, handler);
      
      logger.debug(`Event handler registered`, {
        sessionId: this.sessionId,
        eventType,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      
      return this;
    } catch (error) {
      this.incrementErrorCount();
      this.errorHandler.handleError(
        error as Error,
        this.sessionId,
        'register_event_handler',
        { eventType }
      );
      throw error;
    }
  }

  /**
   * Sets up the prompt start event for this session
   */
  public setupPromptStart(): void {
    CorrelationIdManager.traceWithCorrelation('session.setup_prompt_start', () => {
      try {
        this.ensureSessionActive();
        this.client.setupPromptStartEvent(this.sessionId);
        this.updateActivity();
        
        logger.debug(`Prompt start event setup completed`, {
          sessionId: this.sessionId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        this.incrementErrorCount();
        this.errorHandler.handleError(
          error as Error,
          this.sessionId,
          'setup_prompt_start'
        );
        throw new SessionError('Failed to setup prompt start event', this.sessionId, error as Error);
      }
    }, { 'session.id': this.sessionId });
  }

  /**
   * Sets up the system prompt for this session
   */
  public setupSystemPrompt(
    textConfig: typeof DefaultTextConfiguration = DefaultTextConfiguration,
    systemPromptContent: string = DefaultSystemPrompt
  ): void {
    CorrelationIdManager.traceWithCorrelation('session.setup_system_prompt', () => {
      try {
        this.ensureSessionActive();
        
        if (!textConfig || typeof textConfig !== 'object') {
          throw new SessionError('Text configuration must be a valid object', this.sessionId);
        }
        if (typeof systemPromptContent !== 'string') {
          throw new SessionError('System prompt content must be a string', this.sessionId);
        }
        
        this.client.setupSystemPromptEvent(this.sessionId, textConfig, systemPromptContent);
        this.updateActivity();
        
        logger.debug(`System prompt setup completed`, {
          sessionId: this.sessionId,
          promptLength: systemPromptContent.length,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        this.incrementErrorCount();
        this.errorHandler.handleError(
          error as Error,
          this.sessionId,
          'setup_system_prompt',
          { promptLength: systemPromptContent.length }
        );
        throw new SessionError('Failed to setup system prompt', this.sessionId, error as Error);
      }
    }, { 
      'session.id': this.sessionId,
      'prompt.length': systemPromptContent.length 
    });
  }

  /**
   * Sets up audio streaming for this session
   */
  public setupStartAudio(
    audioConfig: typeof DefaultAudioInputConfiguration = DefaultAudioInputConfiguration
  ): void {
    CorrelationIdManager.traceWithCorrelation('session.setup_start_audio', () => {
      try {
        this.ensureSessionActive();
        
        if (!audioConfig || typeof audioConfig !== 'object') {
          throw new SessionError('Audio configuration must be a valid object', this.sessionId);
        }
        
        this.client.setupStartAudioEvent(this.sessionId, audioConfig);
        this.updateActivity();
        
        logger.debug(`Audio streaming setup completed`, {
          sessionId: this.sessionId,
          audioConfig: {
            encoding: audioConfig.encoding,
            sampleRateHertz: audioConfig.sampleRateHertz
          },
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        this.incrementErrorCount();
        this.errorHandler.handleError(
          error as Error,
          this.sessionId,
          'setup_start_audio',
          { audioConfig }
        );
        throw new SessionError('Failed to setup audio streaming', this.sessionId, error as Error);
      }
    }, { 'session.id': this.sessionId });
  }

  /**
   * Streams audio data to the session
   */
  public async streamAudio(audioData: Buffer): Promise<void> {
    return CorrelationIdManager.traceWithCorrelation('session.stream_audio', async () => {
      this.ensureSessionActive();

      if (!Buffer.isBuffer(audioData)) {
        throw new AudioProcessingError('Audio data must be a Buffer', this.sessionId);
      }

      // Use standard buffer management for regular streaming
      this.manageInputBufferSize(this.config.maxQueueSize);
      
      // Add to queue and trigger processing
      this.audioBufferQueue.push(audioData);
      this.updateActivity();
      
      // Check for memory pressure and optimize if needed
      this.optimizeMemoryUsage();
      
      try {
        await this.errorHandler.executeWithRetry(
          () => this.processAudioQueue(),
          this.sessionId,
          'process_audio_queue',
          { audioSize: audioData.length }
        );
      } catch (error) {
        this.incrementErrorCount();
        this.errorHandler.handleError(
          error as Error,
          this.sessionId,
          'stream_audio',
          { audioSize: audioData.length }
        );
        // Don't re-throw to allow graceful degradation
      }
    }, { 
      'session.id': this.sessionId,
      'audio.size': audioData.length 
    });
  }

  /**
   * Ends the current user turn by closing audio content and signaling prompt end
   */
  public endUserTurn(): void {
    CorrelationIdManager.traceWithCorrelation('session.end_user_turn', () => {
      if (!this.isSessionActive) {
        logger.warn(`Attempted to end user turn on inactive session`, {
          sessionId: this.sessionId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }

      try {
        if (this.client.isSessionActive(this.sessionId)) {
          this.endAudioContent();
          this.endPrompt();
          this.updateActivity();
          
          logger.debug(`User turn ended successfully`, {
            sessionId: this.sessionId,
            queueLength: this.audioBufferQueue.length,
            outputBufferLength: this.audioOutputBuffer.length,
            correlationId: CorrelationIdManager.getCurrentCorrelationId()
          });
        } else {
          logger.warn(`Cannot end user turn - client session is inactive`, {
            sessionId: this.sessionId,
            correlationId: CorrelationIdManager.getCurrentCorrelationId()
          });
        }
      } catch (error) {
        this.incrementErrorCount();
        this.errorHandler.handleError(
          error as Error,
          this.sessionId,
          'end_user_turn'
        );
        throw new AudioProcessingError('Failed to end user turn', this.sessionId, error as Error);
      }
    }, { 'session.id': this.sessionId });
  }

  /**
   * Ends the audio content stream
   */
  public endAudioContent(): void {
    try {
      this.ensureSessionActive();
      this.client.sendContentEnd(this.sessionId);
      this.updateActivity();
      
      logger.debug(`Audio content stream ended`, {
        sessionId: this.sessionId,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
    } catch (error) {
      this.incrementErrorCount();
      logger.error(`Failed to end audio content stream`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      throw new SessionError('Failed to end audio content stream', this.sessionId, error as Error);
    }
  }

  /**
   * Signals the end of the prompt
   */
  public endPrompt(): void {
    try {
      this.ensureSessionActive();
      this.client.sendPromptEnd(this.sessionId);
      this.updateActivity();
      
      logger.debug(`Prompt ended`, {
        sessionId: this.sessionId,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
    } catch (error) {
      this.incrementErrorCount();
      logger.error(`Failed to end prompt`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      throw new SessionError('Failed to end prompt', this.sessionId, error as Error);
    }
  }

  /**
   * Closes the session and cleans up resources (implements ISession interface)
   */
  public async close(): Promise<void> {
    return CorrelationIdManager.traceWithCorrelation('session.close', async () => {
      if (!this.isSessionActive) {
        logger.debug(`Session already closed`, {
          sessionId: this.sessionId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }

      const startTime = Date.now();
      const initialStats = this.getAudioQueueStats();

      try {
        this.isSessionActive = false;
        
        // Clear any pending timeouts to prevent memory leaks
        if (this.processingTimeoutHandle) {
          clearTimeout(this.processingTimeoutHandle);
          this.processingTimeoutHandle = undefined;
        }
        
        // Clear buffers and log cleanup stats
        this.clearAudioQueue();
        this.clearOutputBuffer();
        
        // Reset real-time state
        this.realtimeMode = false;
        this.userSpeaking = false;
        this.lastUserActivity = undefined;
        
        // Reset processing state
        this.isProcessingAudio = false;
        
        // Send session end to client
        this.client.sendSessionEnd(this.sessionId);
        
        const duration = Date.now() - startTime;
        logger.info(`Session closed successfully`, {
          sessionId: this.sessionId,
          duration: `${duration}ms`,
          finalStats: {
            inputQueueCleared: initialStats.queueLength,
            outputBufferCleared: initialStats.outputBufferLength,
            wasProcessing: initialStats.isProcessing
          },
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        this.incrementErrorCount();
        const duration = Date.now() - startTime;
        
        this.errorHandler.handleError(
          error as Error,
          this.sessionId,
          'close_session',
          { duration, initialStats }
        );
        
        // Ensure session is marked as inactive even if cleanup fails
        this.isSessionActive = false;
        
        // Clear error tracking since session is closing
        this.errorHandler.clearErrorTracking(this.sessionId);
        
        throw new SessionError('Failed to close session cleanly', this.sessionId, error as Error);
      }
    }, { 'session.id': this.sessionId });
  }

  /**
   * Gets comprehensive diagnostics information (implements ISession interface)
   */
  public getDiagnostics(): SessionDiagnostics {
    try {
      const memoryStats = this.getMemoryStats();
      const queueStats = this.getAudioQueueStats();
      const realtimeStats = this.getRealtimeState();
      const errorStats = this.errorHandler.getErrorStats(this.sessionId);
      
      return {
        sessionInfo: {
          sessionId: this.sessionId,
          isActive: this.isSessionActive,
          correlationId: CorrelationIdManager.getCurrentCorrelationId(),
          createdAt: this.createdAt,
        },
        performance: {
          isProcessing: this.isProcessingAudio,
          hasScheduledProcessing: this.processingTimeoutHandle !== undefined,
          memoryPressure: memoryStats.memoryPressure,
          operationCount: this.operationCounter,
          errorCount: this.errorCounter,
        },
        memoryStats,
        errorStats: {
          totalErrors: errorStats.totalErrors,
          lastErrorCategory: errorStats.lastError?.category,
          lastErrorSeverity: errorStats.lastError?.severity,
          hasRecentErrors: !!(errorStats.lastError && 
            (Date.now() - errorStats.lastError.timestamp) < 300000),
        },
        configuration: this.config,
      };
    } catch (error) {
      this.incrementErrorCount();
      this.errorHandler.handleError(
        error as Error,
        this.sessionId,
        'get_diagnostics'
      );
      
      // Return minimal safe diagnostics on error
      return {
        sessionInfo: {
          sessionId: this.sessionId,
          isActive: false,
          createdAt: this.createdAt,
        },
        performance: {
          isProcessing: false,
          hasScheduledProcessing: false,
          memoryPressure: false,
          operationCount: this.operationCounter,
          errorCount: this.errorCounter,
        },
        memoryStats: {
          inputBufferBytes: 0,
          outputBufferBytes: 0,
          totalBufferBytes: 0,
          memoryPressure: false,
          utilizationPercent: 0
        },
        errorStats: {
          totalErrors: this.errorCounter,
          hasRecentErrors: false,
        },
        configuration: this.config,
      };
    }
  }

  /**
   * Calculates current memory usage (implements BaseSession abstract method)
   */
  protected calculateMemoryUsage(): number {
    try {
      const inputBufferBytes = this.audioBufferQueue.reduce((sum, chunk) => sum + chunk.length, 0);
      const outputBufferBytes = this.audioOutputBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      return inputBufferBytes + outputBufferBytes;
    } catch (error) {
      logger.error(`Error calculating memory usage`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
      });
      return 0;
    }
  }

  /**
   * Gets comprehensive audio queue statistics including output buffer
   */
  public getAudioQueueStats() {
    try {
      const queueBytes = this.audioBufferQueue.reduce((sum, chunk) => sum + chunk.length, 0);
      const outputBufferBytes = this.audioOutputBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      
      return {
        // Input queue stats
        queueLength: this.audioBufferQueue.length,
        queueUtilizationPercent: Math.round((this.audioBufferQueue.length / this.config.maxQueueSize) * 100),
        queueBytes,
        maxQueueSize: this.config.maxQueueSize,
        
        // Output buffer stats
        outputBufferLength: this.audioOutputBuffer.length,
        outputBufferUtilizationPercent: Math.round((this.audioOutputBuffer.length / this.maxOutputBufferSize) * 100),
        outputBufferBytes,
        maxOutputBufferSize: this.maxOutputBufferSize,
        
        // Processing stats
        isProcessing: this.isProcessingAudio,
        hasScheduledProcessing: this.processingTimeoutHandle !== undefined,
        processingTimeoutMs: this.processingTimeoutMs,
        
        // Configuration stats
        maxChunksPerBatch: this.maxChunksPerBatch,
        dropOldestOnFull: this.dropOldestOnFull,
      };
    } catch (error) {
      this.incrementErrorCount();
      logger.error(`Error calculating audio queue stats`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      
      // Return safe defaults on error
      return {
        queueLength: 0,
        queueUtilizationPercent: 0,
        queueBytes: 0,
        maxQueueSize: this.config.maxQueueSize,
        outputBufferLength: 0,
        outputBufferUtilizationPercent: 0,
        outputBufferBytes: 0,
        maxOutputBufferSize: this.maxOutputBufferSize,
        isProcessing: false,
        hasScheduledProcessing: false,
        processingTimeoutMs: this.processingTimeoutMs,
        maxChunksPerBatch: this.maxChunksPerBatch,
        dropOldestOnFull: this.dropOldestOnFull,
      };
    }
  }

  /**
   * Gets comprehensive real-time conversation state with diagnostics
   */
  public getRealtimeState() {
    try {
      const now = Date.now();
      const timeSinceLastActivity = this.lastUserActivity ? now - this.lastUserActivity : undefined;
      
      // Determine conversation state
      let conversationState: 'idle' | 'user_speaking' | 'model_responding' | 'interrupted';
      if (this.userSpeaking) {
        conversationState = 'user_speaking';
      } else if (this.audioOutputBuffer.length > 0) {
        conversationState = 'model_responding';
      } else if (this.realtimeMode && timeSinceLastActivity && timeSinceLastActivity < 1000) {
        conversationState = 'interrupted';
      } else {
        conversationState = 'idle';
      }
      
      return {
        realtimeMode: this.realtimeMode,
        userSpeaking: this.userSpeaking,
        lastUserActivity: this.lastUserActivity,
        timeSinceLastActivity,
        conversationState,
        clientCapabilities: {
          supportsRealtimeInterruption: typeof this.client.enableRealtimeInterruption === 'function',
          supportsUserSpeakingState: typeof this.client.setUserSpeakingState === 'function',
          supportsRealtimeStreaming: typeof this.client.streamAudioRealtime === 'function',
        }
      };
    } catch (error) {
      this.incrementErrorCount();
      logger.error(`Error calculating real-time state`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      
      return {
        realtimeMode: false,
        userSpeaking: false,
        conversationState: 'idle' as const,
        clientCapabilities: {
          supportsRealtimeInterruption: false,
          supportsUserSpeakingState: false,
          supportsRealtimeStreaming: false,
        }
      };
    }
  }

  /**
   * Gets memory usage statistics for monitoring
   */
  public getMemoryStats() {
    try {
      const inputBufferBytes = this.audioBufferQueue.reduce((sum, chunk) => sum + chunk.length, 0);
      const outputBufferBytes = this.audioOutputBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const totalBufferBytes = inputBufferBytes + outputBufferBytes;
      const totalChunks = this.audioBufferQueue.length + this.audioOutputBuffer.length;
      const memoryPressure = totalChunks >= this.memoryPressureThreshold;
      const utilizationPercent = Math.round((totalChunks / (this.config.maxQueueSize + this.maxOutputBufferSize)) * 100);

      return {
        inputBufferBytes,
        outputBufferBytes,
        totalBufferBytes,
        memoryPressure,
        utilizationPercent
      };
    } catch (error) {
      this.incrementErrorCount();
      logger.error(`Error calculating memory stats`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      
      return {
        inputBufferBytes: 0,
        outputBufferBytes: 0,
        totalBufferBytes: 0,
        memoryPressure: false,
        utilizationPercent: 0
      };
    }
  }

  /**
   * Gets detailed error information for the session
   */
  public getErrorInfo(): {
    errorStats: ReturnType<SessionErrorHandler['getErrorStats']>;
    hasRecentErrors: boolean;
    isHealthy: boolean;
    recommendations: string[];
  } {
    const errorStats = this.errorHandler.getErrorStats(this.sessionId);
    const hasRecentErrors = !!(errorStats.lastError && 
      (Date.now() - errorStats.lastError.timestamp) < 300000); // 5 minutes
    
    const isHealthy = errorStats.totalErrors < 5 && !hasRecentErrors;
    
    const recommendations: string[] = [];
    
    if (errorStats.totalErrors > 10) {
      recommendations.push('Consider restarting the session due to high error count');
    }
    
    if (hasRecentErrors && errorStats.lastError?.severity === ErrorSeverity.CRITICAL) {
      recommendations.push('Immediate attention required due to critical error');
    }
    
    if (errorStats.lastError?.category === ErrorCategory.RESOURCE_EXHAUSTION) {
      recommendations.push('Check memory usage and consider reducing buffer sizes');
    }

    return {
      errorStats,
      hasRecentErrors,
      isHealthy,
      recommendations,
    };
  }

  /**
   * Buffer audio output (model -> client)
   */
  public bufferAudioOutput(audioData: Buffer): void {
    CorrelationIdManager.traceWithCorrelation('session.buffer_audio_output', () => {
      if (!this.isSessionActive) {
        logger.warn(`Attempted to buffer audio output on inactive session`, {
          sessionId: this.sessionId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }

      try {
        if (!Buffer.isBuffer(audioData)) {
          throw new AudioProcessingError('Audio data must be a Buffer', this.sessionId);
        }

        // Manage output buffer size
        this.manageOutputBufferSize();
        
        this.audioOutputBuffer.push(audioData);
        this.updateActivity();
        
        logger.trace(`Audio output buffered`, {
          sessionId: this.sessionId,
          audioSize: audioData.length,
          outputBufferLength: this.audioOutputBuffer.length,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        this.incrementErrorCount();
        this.errorHandler.handleError(
          error as Error,
          this.sessionId,
          'buffer_audio_output',
          { audioSize: audioData.length }
        );
        throw error;
      }
    }, { 
      'session.id': this.sessionId,
      'audio.size': audioData.length 
    });
  }

  // Private helper methods

  private ensureSessionActive(): void {
    if (!this.isSessionActive) {
      throw new SessionInactiveError(`Session ${this.sessionId} is not active`);
    }
  }

  private manageInputBufferSize(maxSize: number): void {
    if (this.audioBufferQueue.length >= maxSize) {
      if (this.dropOldestOnFull) {
        const dropped = this.audioBufferQueue.shift();
        logger.debug(`Dropped oldest audio chunk due to full queue`, {
          sessionId: this.sessionId,
          queueLength: this.audioBufferQueue.length,
          droppedSize: dropped?.length || 0,
        });
      } else {
        throw new AudioProcessingError(`Audio queue is full (${maxSize} chunks)`, this.sessionId);
      }
    }
  }

  private manageOutputBufferSize(): void {
    if (this.audioOutputBuffer.length >= this.maxOutputBufferSize) {
      if (this.dropOldestOnFull) {
        const dropped = this.audioOutputBuffer.shift();
        logger.debug(`Dropped oldest output audio chunk due to full buffer`, {
          sessionId: this.sessionId,
          outputBufferLength: this.audioOutputBuffer.length,
          droppedSize: dropped?.length || 0,
        });
      } else {
        throw new AudioProcessingError(`Audio output buffer is full (${this.maxOutputBufferSize} chunks)`, this.sessionId);
      }
    }
  }

  private optimizeMemoryUsage(): void {
    try {
      const memoryStats = this.getMemoryStats();
      
      if (memoryStats.memoryPressure) {
        const inputTrimTarget = Math.floor(this.config.maxQueueSize * 0.5);
        const outputTrimTarget = Math.floor(this.maxOutputBufferSize * 0.5);
        
        let trimmedInput = 0;
        let trimmedOutput = 0;
        
        // Trim input buffer if over target
        if (this.audioBufferQueue.length > inputTrimTarget) {
          const toRemove = this.audioBufferQueue.length - inputTrimTarget;
          this.audioBufferQueue.splice(0, toRemove);
          trimmedInput = toRemove;
        }
        
        // Trim output buffer if over target
        if (this.audioOutputBuffer.length > outputTrimTarget) {
          const toRemove = this.audioOutputBuffer.length - outputTrimTarget;
          this.audioOutputBuffer.splice(0, toRemove);
          trimmedOutput = toRemove;
        }
        
        if (trimmedInput > 0 || trimmedOutput > 0) {
          logger.info(`Memory optimization applied due to pressure`, {
            sessionId: this.sessionId,
            trimmedInputChunks: trimmedInput,
            trimmedOutputChunks: trimmedOutput,
            beforeUtilization: memoryStats.utilizationPercent,
            afterUtilization: this.getMemoryStats().utilizationPercent,
            correlationId: CorrelationIdManager.getCurrentCorrelationId()
          });
        }
      }
    } catch (error) {
      this.incrementErrorCount();
      this.errorHandler.handleError(
        error as Error,
        this.sessionId,
        'optimize_memory_usage'
      );
    }
  }

  private async processAudioQueue(): Promise<void> {
    if (this.isProcessingAudio || this.audioBufferQueue.length === 0 || !this.isSessionActive) {
      return;
    }

    return CorrelationIdManager.traceWithCorrelation('session.process_audio_queue', async () => {
      this.isProcessingAudio = true;

      try {
        let processedChunks = 0;

        while (
          this.audioBufferQueue.length > 0 && 
          processedChunks < this.maxChunksPerBatch && 
          this.isSessionActive
        ) {
          const audioChunk = this.audioBufferQueue.shift();
          if (audioChunk) {
            await this.client.streamAudioChunk(this.sessionId, audioChunk);
            processedChunks++;
          }
        }

        logger.trace(`Processed ${processedChunks} audio chunks for session ${this.sessionId}`, {
          queueLength: this.audioBufferQueue.length,
          processedChunks,
          maxChunksPerBatch: this.maxChunksPerBatch
        });

      } catch (error) {
        this.incrementErrorCount();
        this.errorHandler.handleError(
          error as Error,
          this.sessionId,
          'process_audio_queue_batch'
        );
        throw new AudioProcessingError('Failed to process audio queue', this.sessionId, error as Error);
      } finally {
        this.isProcessingAudio = false;

        // Schedule next processing if queue has items
        if (this.audioBufferQueue.length > 0 && this.isSessionActive) {
          // Clear any existing timeout to prevent multiple concurrent processing
          if (this.processingTimeoutHandle) {
            clearTimeout(this.processingTimeoutHandle);
          }
          
          // Use configurable timeout to control processing frequency
          this.processingTimeoutHandle = setTimeout(() => {
            this.processingTimeoutHandle = undefined;
            this.processAudioQueue().catch(error => {
              this.incrementErrorCount();
              this.errorHandler.handleError(
                error as Error,
                this.sessionId,
                'scheduled_audio_processing'
              );
            });
          }, this.processingTimeoutMs);
        }
      }
    }, { 
      'session.id': this.sessionId,
      'queue.length': this.audioBufferQueue.length 
    });
  }

  private clearAudioQueue(): void {
    const clearedCount = this.audioBufferQueue.length;
    this.audioBufferQueue.length = 0;
    
    if (clearedCount > 0) {
      logger.debug(`Cleared audio input queue`, {
        sessionId: this.sessionId,
        clearedChunks: clearedCount,
      });
    }
  }

  private clearOutputBuffer(): void {
    const clearedCount = this.audioOutputBuffer.length;
    this.audioOutputBuffer.length = 0;
    
    if (clearedCount > 0) {
      logger.debug(`Cleared audio output buffer`, {
        sessionId: this.sessionId,
        clearedChunks: clearedCount,
      });
    }
  }
}