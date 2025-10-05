/**
 * @fileoverview Stream Session Management
 * 
 * Provides a high-level interface for managing individual streaming sessions
 */

import { Buffer } from "node:buffer";
import logger from '../utils/logger';
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
 * Represents a single streaming session with audio processing capabilities
 */
export class StreamSession {
  private audioBufferQueue: Buffer[] = [];
  private isProcessingAudio = false;
  private isActive = true;
  private readonly maxQueueSize: number;
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

  constructor(
    private readonly sessionId: string,
    private readonly client: StreamClientInterface,
    audioOptions: AudioStreamOptions = {}
  ) {
    try {
      // Validate required parameters
      if (!sessionId || typeof sessionId !== 'string') {
        throw new SessionError('Session ID must be a non-empty string');
      }
      if (!client) {
        throw new SessionError('Client interface is required', sessionId);
      }

      this.maxQueueSize = audioOptions.maxQueueSize ?? CLIENT_DEFAULTS.MAX_AUDIO_QUEUE_SIZE;
      this.maxChunksPerBatch = audioOptions.maxChunksPerBatch ?? CLIENT_DEFAULTS.MAX_CHUNKS_PER_BATCH;
      this.maxOutputBufferSize = audioOptions.maxOutputBufferSize ?? CLIENT_DEFAULTS.MAX_AUDIO_QUEUE_SIZE;
      this.processingTimeoutMs = audioOptions.processingTimeoutMs ?? BufferSizeConfig.PROCESSING_TIMEOUT_MS;
      this.dropOldestOnFull = audioOptions.dropOldestOnFull ?? true;
      
      // Memory pressure threshold (80% of combined buffer capacity)
      this.memoryPressureThreshold = Math.floor((this.maxQueueSize + this.maxOutputBufferSize) * 0.8);
      
      // Validate configuration values
      if (this.maxQueueSize <= 0 || this.maxChunksPerBatch <= 0 || this.maxOutputBufferSize <= 0) {
        throw new SessionError('Buffer size configurations must be positive integers', sessionId);
      }
      
      // Initialize correlation context for this session
      const parentContext = CorrelationIdManager.getCurrentContext();
      const sessionContext = CorrelationIdManager.createBedrockContext(sessionId, parentContext);
      CorrelationIdManager.setContext(sessionContext);
      
      logger.info(`StreamSession created successfully`, {
        sessionId,
        maxQueueSize: this.maxQueueSize,
        maxChunksPerBatch: this.maxChunksPerBatch,
        maxOutputBufferSize: this.maxOutputBufferSize,
        correlationId: sessionContext.correlationId
      });
    } catch (error) {
      logger.error(`Failed to create StreamSession`, {
        sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      throw error;
    }
  }

  /**
   * Gets the session ID
   */
  public getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Checks if the session is currently active
   */
  public isSessionActive(): boolean {
    return this.isActive && this.client.isSessionActive(this.sessionId);
  }

  /**
   * Registers an event handler for this session
   * @param eventType - Type of event to listen for
   * @param handler - Function to handle the event
   * @returns This session instance for method chaining
   */
  public onEvent(eventType: StreamEventType, handler: EventHandler): StreamSession {
    try {
      this.ensureSessionActive();
      
      if (!eventType || typeof eventType !== 'string') {
        throw new SessionError('Event type must be a non-empty string', this.sessionId);
      }
      if (!handler || typeof handler !== 'function') {
        throw new SessionError('Event handler must be a function', this.sessionId);
      }
      
      this.client.registerEventHandler(this.sessionId, eventType, handler);
      
      logger.debug(`Event handler registered`, {
        sessionId: this.sessionId,
        eventType,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      
      return this;
    } catch (error) {
      logger.error(`Failed to register event handler`, {
        sessionId: this.sessionId,
        eventType,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
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
        
        logger.debug(`Prompt start event setup completed`, {
          sessionId: this.sessionId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        logger.error(`Failed to setup prompt start event`, {
          sessionId: this.sessionId,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        throw new SessionError('Failed to setup prompt start event', this.sessionId, error as Error);
      }
    }, { 'session.id': this.sessionId });
  }

  /**
   * Sets up the system prompt for this session
   * @param textConfig - Text configuration (optional)
   * @param systemPromptContent - System prompt content (optional)
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
        
        logger.debug(`System prompt setup completed`, {
          sessionId: this.sessionId,
          promptLength: systemPromptContent.length,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        logger.error(`Failed to setup system prompt`, {
          sessionId: this.sessionId,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        throw new SessionError('Failed to setup system prompt', this.sessionId, error as Error);
      }
    }, { 
      'session.id': this.sessionId,
      'prompt.length': systemPromptContent.length 
    });
  }

  /**
   * Sets up audio streaming for this session
   * @param audioConfig - Audio configuration (optional)
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
        
        logger.debug(`Audio streaming setup completed`, {
          sessionId: this.sessionId,
          audioConfig: {
            encoding: audioConfig.encoding,
            sampleRateHertz: audioConfig.sampleRateHertz
          },
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        logger.error(`Failed to setup audio streaming`, {
          sessionId: this.sessionId,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        throw new SessionError('Failed to setup audio streaming', this.sessionId, error as Error);
      }
    }, { 'session.id': this.sessionId });
  }

  /**
   * Streams audio data to the session
   * @param audioData - Audio data buffer to stream
   */
  public async streamAudio(audioData: Buffer): Promise<void> {
    return CorrelationIdManager.traceWithCorrelation('session.stream_audio', async () => {
      this.ensureSessionActive();

      if (!Buffer.isBuffer(audioData)) {
        throw new AudioProcessingError('Audio data must be a Buffer', this.sessionId);
      }

      // Use standard buffer management for regular streaming
      this.manageInputBufferSize(this.maxQueueSize);
      
      // Add to queue and trigger processing
      this.audioBufferQueue.push(audioData);
      
      // Check for memory pressure and optimize if needed
      this.optimizeMemoryUsage();
      
      try {
        await this.processAudioQueue();
      } catch (error) {
        logger.error(`Error streaming audio`, {
          sessionId: this.sessionId,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
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
      if (!this.isActive) {
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
        logger.error(`Failed to end user turn`, {
          sessionId: this.sessionId,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
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
      
      logger.debug(`Audio content stream ended`, {
        sessionId: this.sessionId,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
    } catch (error) {
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
      
      logger.debug(`Prompt ended`, {
        sessionId: this.sessionId,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
    } catch (error) {
      logger.error(`Failed to end prompt`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      throw new SessionError('Failed to end prompt', this.sessionId, error as Error);
    }
  }

  /**
   * Closes the session and cleans up resources
   */
  public async close(): Promise<void> {
    return CorrelationIdManager.traceWithCorrelation('session.close', async () => {
      if (!this.isActive) {
        logger.debug(`Session already closed`, {
          sessionId: this.sessionId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }

      const startTime = Date.now();
      const initialStats = this.getAudioQueueStats();

      try {
        this.isActive = false;
        
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
        const duration = Date.now() - startTime;
        logger.error(`Error closing session`, {
          sessionId: this.sessionId,
          duration: `${duration}ms`,
          initialStats,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        
        // Ensure session is marked as inactive even if cleanup fails
        this.isActive = false;
        throw new SessionError('Failed to close session cleanly', this.sessionId, error as Error);
      }
    }, { 'session.id': this.sessionId });
  }

  /**
   * Gets comprehensive audio queue statistics including output buffer
   */
  public getAudioQueueStats(): {
    // Input queue stats
    queueLength: number;
    queueUtilizationPercent: number;
    queueBytes: number;
    maxQueueSize: number;
    
    // Output buffer stats  
    outputBufferLength: number;
    outputBufferUtilizationPercent: number;
    outputBufferBytes: number;
    maxOutputBufferSize: number;
    
    // Processing stats
    isProcessing: boolean;
    hasScheduledProcessing: boolean;
    processingTimeoutMs: number;
    
    // Configuration stats
    maxChunksPerBatch: number;
    dropOldestOnFull: boolean;
  } {
    try {
      const queueBytes = this.audioBufferQueue.reduce((sum, chunk) => sum + chunk.length, 0);
      const outputBufferBytes = this.audioOutputBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      
      return {
        // Input queue stats
        queueLength: this.audioBufferQueue.length,
        queueUtilizationPercent: Math.round((this.audioBufferQueue.length / this.maxQueueSize) * 100),
        queueBytes,
        maxQueueSize: this.maxQueueSize,
        
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
        maxQueueSize: this.maxQueueSize,
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
  public getRealtimeState(): {
    realtimeMode: boolean;
    userSpeaking: boolean;
    lastUserActivity?: number;
    timeSinceLastActivity?: number;
    conversationState: 'idle' | 'user_speaking' | 'model_responding' | 'interrupted';
    clientCapabilities: {
      supportsRealtimeInterruption: boolean;
      supportsUserSpeakingState: boolean;
      supportsRealtimeStreaming: boolean;
    };
  } {
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
      logger.error(`Error calculating real-time state`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      
      return {
        realtimeMode: false,
        userSpeaking: false,
        conversationState: 'idle',
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
  public getMemoryStats(): {
    inputBufferBytes: number;
    outputBufferBytes: number;
    totalBufferBytes: number;
    memoryPressure: boolean;
    utilizationPercent: number;
  } {
    try {
      const inputBufferBytes = this.audioBufferQueue.reduce((sum, chunk) => sum + chunk.length, 0);
      const outputBufferBytes = this.audioOutputBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const totalBufferBytes = inputBufferBytes + outputBufferBytes;
      const totalChunks = this.audioBufferQueue.length + this.audioOutputBuffer.length;
      const memoryPressure = totalChunks >= this.memoryPressureThreshold;
      const utilizationPercent = Math.round((totalChunks / (this.maxQueueSize + this.maxOutputBufferSize)) * 100);

      return {
        inputBufferBytes,
        outputBufferBytes,
        totalBufferBytes,
        memoryPressure,
        utilizationPercent
      };
    } catch (error) {
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
   * Gets comprehensive diagnostics information for monitoring and debugging
   */
  public getDiagnostics() {
    try {
      const memoryStats = this.getMemoryStats();
      
      return {
        sessionInfo: {
          sessionId: this.sessionId,
          isActive: this.isActive,
          correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        },
        performance: {
          isProcessing: this.isProcessingAudio,
          hasScheduledProcessing: this.processingTimeoutHandle !== undefined,
          memoryPressure: memoryStats.memoryPressure,
        },
        memoryStats,
        queueStats: this.getAudioQueueStats(),
        realtimeStats: this.getRealtimeState(),
        configuration: {
          maxQueueSize: this.maxQueueSize,
          maxOutputBufferSize: this.maxOutputBufferSize,
          maxChunksPerBatch: this.maxChunksPerBatch,
          processingTimeoutMs: this.processingTimeoutMs,
          dropOldestOnFull: this.dropOldestOnFull,
          memoryPressureThreshold: this.memoryPressureThreshold,
        }
      };
    } catch (error) {
      logger.error(`Error generating diagnostics`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      
      // Return minimal safe diagnostics on error
      return {
        sessionInfo: {
          sessionId: this.sessionId,
          isActive: false,
        },
        performance: {
          isProcessing: false,
          hasScheduledProcessing: false,
          memoryPressure: false,
        },
        memoryStats: {
          inputBufferBytes: 0,
          outputBufferBytes: 0,
          totalBufferBytes: 0,
          memoryPressure: false,
          utilizationPercent: 0
        },
        queueStats: this.getAudioQueueStats(),
        realtimeStats: this.getRealtimeState(),
        configuration: {
          maxQueueSize: this.maxQueueSize,
          maxOutputBufferSize: this.maxOutputBufferSize,
          maxChunksPerBatch: this.maxChunksPerBatch,
          processingTimeoutMs: this.processingTimeoutMs,
          dropOldestOnFull: this.dropOldestOnFull,
          memoryPressureThreshold: this.memoryPressureThreshold,
        }
      };
    }
  }

  /**
   * Gets performance statistics for monitoring
   */
  public getPerformanceStats() {
    return {
      isProcessing: this.isProcessingAudio,
      hasScheduledProcessing: this.processingTimeoutHandle !== undefined,
      memoryStats: this.getMemoryStats(),
      queueStats: this.getAudioQueueStats(),
      realtimeStats: this.getRealtimeState()
    };
  }

  /**
   * Optimize memory usage by trimming buffers under memory pressure
   */
  private optimizeMemoryUsage(): void {
    try {
      const memoryStats = this.getMemoryStats();
      
      if (memoryStats.memoryPressure) {
        const inputTrimTarget = Math.floor(this.maxQueueSize * 0.5);
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
      logger.error(`Error during memory optimization`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
    }
  }

  /**
   * Processes the audio queue in batches with correlation ID management
   */
  private async processAudioQueue(): Promise<void> {
    if (this.isProcessingAudio || this.audioBufferQueue.length === 0 || !this.isActive) {
      return;
    }

    return CorrelationIdManager.traceWithCorrelation('session.process_audio_queue', async () => {
      this.isProcessingAudio = true;

      try {
        let processedChunks = 0;

        while (
          this.audioBufferQueue.length > 0 && 
          processedChunks < this.maxChunksPerBatch && 
          this.isActive
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
        logger.error(`Error processing audio queue for session ${this.sessionId}:`, error);
        throw new AudioProcessingError('Failed to process audio queue', this.sessionId, error as Error);
      } finally {
        this.isProcessingAudio = false;

        // Schedule next processing if queue has items
        if (this.audioBufferQueue.length > 0 && this.isActive) {
          // Clear any existing timeout to prevent multiple concurrent processing
          if (this.processingTimeoutHandle) {
            clearTimeout(this.processingTimeoutHandle);
          }
          
          // Use configurable timeout to control processing frequency
          this.processingTimeoutHandle = setTimeout(() => {
            this.processingTimeoutHandle = undefined;
            this.processAudioQueue().catch(error => {
              logger.error(`Error in scheduled audio processing`, {
                sessionId: this.sessionId,
                error: extractErrorDetails(error),
                correlationId: CorrelationIdManager.getCurrentCorrelationId()
              });
            });
          }, this.processingTimeoutMs);
        }
      }
    }, { 
      'session.id': this.sessionId,
      'queue.length': this.audioBufferQueue.length 
    });
  }

  /**
   * Buffer audio output (model -> client) and related helpers
   */
  private audioOutputBuffer: Buffer[] = [];
  private readonly maxOutputBufferSize: number;

  /**
   * Buffer model audio output (Nova Sonic can generate faster than real-time)
   */
  public bufferAudioOutput(audioData: Buffer): void {
    CorrelationIdManager.traceWithCorrelation('session.buffer_audio_output', () => {
      if (!this.isActive) {
        logger.debug(`Attempted to buffer audio output on inactive session`, {
          sessionId: this.sessionId,
          audioSize: audioData?.length || 0,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }
      
      if (!Buffer.isBuffer(audioData)) {
        logger.warn(`Invalid audio data provided to bufferAudioOutput`, {
          sessionId: this.sessionId,
          dataType: typeof audioData,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }

      if (audioData.length === 0) {
        logger.debug(`Empty audio buffer received, skipping`, {
          sessionId: this.sessionId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }

      try {
        // Manage output buffer size for fast model responses
        this.manageOutputBufferSize();
        this.audioOutputBuffer.push(audioData);
        
        // Check for memory pressure after adding output data
        this.optimizeMemoryUsage();
        
        logger.trace(`Audio output buffered`, {
          sessionId: this.sessionId,
          audioSize: audioData.length,
          bufferLength: this.audioOutputBuffer.length,
          maxBufferSize: this.maxOutputBufferSize,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        logger.error(`Failed to buffer audio output`, {
          sessionId: this.sessionId,
          audioSize: audioData.length,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        throw new AudioProcessingError('Failed to buffer audio output', this.sessionId, error as Error);
      }
    }, { 
      'session.id': this.sessionId,
      'audio.size': audioData?.length || 0 
    });
  }

  /**
   * Get next audio output chunk for playback
   */
  public getNextAudioOutput(): Buffer | null {
    try {
      const audioChunk = this.audioOutputBuffer.shift() || null;
      
      if (audioChunk) {
        logger.trace(`Audio output chunk retrieved`, {
          sessionId: this.sessionId,
          chunkSize: audioChunk.length,
          remainingBufferLength: this.audioOutputBuffer.length,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      }
      
      return audioChunk;
    } catch (error) {
      logger.error(`Failed to get next audio output`, {
        sessionId: this.sessionId,
        bufferLength: this.audioOutputBuffer.length,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      return null;
    }
  }

  /**
   * Get current output buffer size for monitoring
   */
  public getOutputBufferSize(): number {
    return this.audioOutputBuffer.length;
  }

  /**
   * Clear output buffer (useful for interruptions)
   */
  public clearOutputBuffer(): void {
    try {
      const clearedChunks = this.audioOutputBuffer.length;
      this.audioOutputBuffer.length = 0;
      
      logger.debug(`Audio output buffer cleared`, {
        sessionId: this.sessionId,
        clearedChunks,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
    } catch (error) {
      logger.error(`Failed to clear output buffer`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      // Force clear even if logging fails
      this.audioOutputBuffer.length = 0;
    }
  }

  /**
   * Manage output buffer size for fast model responses
   */
  private manageOutputBufferSize(): void {
    try {
      const currentSize = this.audioOutputBuffer.length;
      
      if (currentSize >= this.maxOutputBufferSize) {
        const droppedChunk = this.audioOutputBuffer.shift();
        logger.warn(`Audio output buffer capacity exceeded, dropping oldest chunk`, {
          sessionId: this.sessionId,
          bufferSize: currentSize,
          maxBufferSize: this.maxOutputBufferSize,
          droppedChunkSize: droppedChunk?.length || 0,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      }

      // Log warning for large buffers (model generating faster than real-time)
      const warningThreshold = Math.floor(this.maxOutputBufferSize * 0.8);
      if (currentSize >= warningThreshold && currentSize < this.maxOutputBufferSize) {
        logger.debug(`Large output buffer detected - model generating faster than real-time`, {
          sessionId: this.sessionId,
          bufferSize: currentSize,
          maxBufferSize: this.maxOutputBufferSize,
          utilizationPercent: Math.round((currentSize / this.maxOutputBufferSize) * 100),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      }
    } catch (error) {
      logger.error(`Error managing output buffer size`, {
        sessionId: this.sessionId,
        bufferLength: this.audioOutputBuffer.length,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      // Continue execution - buffer management errors shouldn't break audio processing
    }
  }

  /**
   * Manage input buffer size with configurable trim strategies
   */
  private manageInputBufferSize(maxSize: number, trimToSize?: number): void {
    try {
      const currentSize = this.audioBufferQueue.length;
      
      if (currentSize >= maxSize) {
        if (trimToSize && trimToSize < maxSize) {
          // Aggressive trimming for real-time mode - remove multiple chunks at once
          const chunksToRemove = currentSize - trimToSize;
          const removedChunks = this.audioBufferQueue.splice(0, chunksToRemove);
          
          logger.warn(`Audio input queue capacity exceeded, aggressive trimming applied`, {
            sessionId: this.sessionId,
            originalSize: currentSize,
            maxSize,
            trimToSize,
            chunksRemoved: chunksToRemove,
            totalBytesRemoved: removedChunks.reduce((sum, chunk) => sum + chunk.length, 0),
            correlationId: CorrelationIdManager.getCurrentCorrelationId()
          });
        } else if (this.dropOldestOnFull) {
          // Standard behavior - drop oldest chunk
          const droppedChunk = this.audioBufferQueue.shift();
          
          logger.warn(`Audio input queue capacity exceeded, dropping oldest chunk`, {
            sessionId: this.sessionId,
            queueSize: currentSize,
            maxSize,
            droppedChunkSize: droppedChunk?.length || 0,
            correlationId: CorrelationIdManager.getCurrentCorrelationId()
          });
        } else {
          // Alternative strategy - drop newest chunk (current one won't be added)
          logger.warn(`Audio input queue capacity exceeded, dropping newest chunk`, {
            sessionId: this.sessionId,
            queueSize: currentSize,
            maxSize,
            strategy: 'drop_newest',
            correlationId: CorrelationIdManager.getCurrentCorrelationId()
          });
          return; // Don't add the current chunk
        }
      }
      
      // Log warning for high buffer utilization
      const warningThreshold = Math.floor(maxSize * 0.7);
      if (currentSize >= warningThreshold && currentSize < maxSize) {
        logger.debug(`High input buffer utilization detected`, {
          sessionId: this.sessionId,
          queueSize: currentSize,
          maxSize,
          utilizationPercent: Math.round((currentSize / maxSize) * 100),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      }
    } catch (error) {
      logger.error(`Error managing input buffer size`, {
        sessionId: this.sessionId,
        queueLength: this.audioBufferQueue.length,
        maxSize,
        trimToSize,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      // Continue execution - buffer management errors shouldn't break audio processing
    }
  }

  /**
   * Stream audio in real-time mode with low latency
   */
  public async streamAudioRealtime(audioData: Buffer): Promise<void> {
    return CorrelationIdManager.traceWithCorrelation('session.stream_audio_realtime', async () => {
      this.ensureSessionActive();
      if (!Buffer.isBuffer(audioData)) {
        throw new AudioProcessingError('Audio data must be a Buffer', this.sessionId);
      }

      // Use real-time buffer management with smaller limits and aggressive trimming
      this.manageInputBufferSize(
        BufferSizeConfig.INPUT_REALTIME_MAX, 
        BufferSizeConfig.INPUT_REALTIME_TRIM_TO
      );
      
      // Use streamAudioRealtime from client if available, otherwise fall back to regular streaming
      if (typeof this.client.streamAudioRealtime === 'function') {
        await this.client.streamAudioRealtime(this.sessionId, audioData);
        return;
      }

      // Fallback: add to queue and process immediately for low latency
      this.audioBufferQueue.push(audioData);
      
      // Check for memory pressure and optimize if needed (more aggressive in realtime mode)
      this.optimizeMemoryUsage();
      
      await this.processAudioQueue();
    }, { 
      'session.id': this.sessionId,
      'audio.size': audioData.length,
      'mode': 'realtime'
    });
  }

  /**
   * Enable real-time interruption mode - allows model to respond while user is speaking
   */
  public enableRealtimeMode(): void {
    CorrelationIdManager.traceWithCorrelation('session.enable_realtime_mode', () => {
      if (!this.isActive) {
        logger.warn(`Attempted to enable real-time mode on inactive session`, {
          sessionId: this.sessionId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }
      
      try {
        const wasRealtimeMode = this.realtimeMode;
        this.realtimeMode = true;
        
        if (typeof this.client.enableRealtimeInterruption === 'function') {
          this.client.enableRealtimeInterruption(this.sessionId);
        }
        
        logger.info(`Real-time mode enabled`, {
          sessionId: this.sessionId,
          wasAlreadyEnabled: wasRealtimeMode,
          clientSupportsRealtime: typeof this.client.enableRealtimeInterruption === 'function',
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        logger.error(`Failed to enable real-time mode`, {
          sessionId: this.sessionId,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        throw new SessionError('Failed to enable real-time mode', this.sessionId, error as Error);
      }
    }, { 'session.id': this.sessionId });
  }

  /**
   * Interrupt the model if it's currently speaking
   */
  public interruptModel(): void {
    CorrelationIdManager.traceWithCorrelation('session.interrupt_model', () => {
      if (!this.isActive) {
        logger.warn(`Attempted to interrupt model on inactive session`, {
          sessionId: this.sessionId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }
      
      try {
        const outputBufferSize = this.audioOutputBuffer.length;
        
        // Clear output buffer when interrupting to stop current model speech
        this.clearOutputBuffer();
        
        if (typeof this.client.handleUserInterruption === 'function') {
          this.client.handleUserInterruption(this.sessionId);
        }
        
        logger.info(`Model interrupted successfully`, {
          sessionId: this.sessionId,
          clearedOutputChunks: outputBufferSize,
          realtimeMode: this.realtimeMode,
          clientSupportsInterruption: typeof this.client.handleUserInterruption === 'function',
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        logger.error(`Failed to interrupt model`, {
          sessionId: this.sessionId,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        throw new SessionError('Failed to interrupt model', this.sessionId, error as Error);
      }
    }, { 'session.id': this.sessionId });
  }

  /**
   * Set user speaking state for voice activity detection
   */
  public setUserSpeaking(speaking: boolean): void {
    CorrelationIdManager.traceWithCorrelation('session.set_user_speaking', () => {
      if (!this.isActive) {
        logger.debug(`Attempted to set user speaking state on inactive session`, {
          sessionId: this.sessionId,
          speaking,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }
      
      if (typeof speaking !== 'boolean') {
        logger.warn(`Invalid speaking state provided`, {
          sessionId: this.sessionId,
          speaking,
          speakingType: typeof speaking,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        return;
      }
      
      try {
        const previousSpeaking = this.userSpeaking;
        const previousActivity = this.lastUserActivity;
        
        this.userSpeaking = speaking;
        this.lastUserActivity = Date.now();
        
        // Trigger interruption if user speaks in real-time mode
        let interruptionTriggered = false;
        if (speaking && this.realtimeMode && !previousSpeaking) {
          this.interruptModel();
          interruptionTriggered = true;
        }
        
        if (typeof this.client.setUserSpeakingState === 'function') {
          this.client.setUserSpeakingState(this.sessionId, speaking);
        }
        
        logger.debug(`User speaking state updated`, {
          sessionId: this.sessionId,
          speaking,
          previousSpeaking,
          realtimeMode: this.realtimeMode,
          interruptionTriggered,
          timeSinceLastActivity: previousActivity ? this.lastUserActivity - previousActivity : 0,
          clientSupportsVAD: typeof this.client.setUserSpeakingState === 'function',
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
      } catch (error) {
        logger.error(`Failed to set user speaking state`, {
          sessionId: this.sessionId,
          speaking,
          error: extractErrorDetails(error),
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        throw new SessionError('Failed to set user speaking state', this.sessionId, error as Error);
      }
    }, { 
      'session.id': this.sessionId,
      'user.speaking': speaking 
    });
  }

  /**
   * Clears the audio buffer queue with memory optimization
   */
  private clearAudioQueue(): void {
    try {
      const clearedChunks = this.audioBufferQueue.length;
      const totalBytes = this.audioBufferQueue.reduce((sum, chunk) => sum + chunk.length, 0);
      
      // Clear array efficiently - setting length to 0 is faster than splice(0)
      this.audioBufferQueue.length = 0;
      
      logger.debug(`Audio input queue cleared`, {
        sessionId: this.sessionId,
        clearedChunks,
        totalBytesCleared: totalBytes,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
    } catch (error) {
      logger.error(`Error clearing audio queue`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      // Force clear even if logging fails
      this.audioBufferQueue.length = 0;
    }
  }

  /**
   * Ensures the session is active, throws error if not
   */
  private ensureSessionActive(): void {
    if (!this.isActive) {
      logger.debug(`Session inactive check failed`, {
        sessionId: this.sessionId,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      throw new SessionInactiveError(this.sessionId);
    }
    
    // Also check if the underlying client session is active
    try {
      if (!this.client.isSessionActive(this.sessionId)) {
        logger.warn(`Client session is inactive while StreamSession is marked active`, {
          sessionId: this.sessionId,
          correlationId: CorrelationIdManager.getCurrentCorrelationId()
        });
        // Mark our session as inactive to prevent future operations
        this.isActive = false;
        throw new SessionInactiveError(this.sessionId);
      }
    } catch (error) {
      if (error instanceof SessionInactiveError) {
        throw error;
      }
      
      logger.error(`Error checking client session status`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      
      // If we can't check client status, assume session is problematic
      throw new SessionError('Unable to verify session status', this.sessionId, error as Error);
    }
  }

  /**
   * Performs a health check on the session and returns status
   */
  public getHealthStatus(): {
    healthy: boolean;
    issues: string[];
    warnings: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check session state
      if (!this.isActive) {
        issues.push('Session is inactive');
      }

      // Check client session state
      try {
        if (!this.client.isSessionActive(this.sessionId)) {
          issues.push('Client session is inactive');
        }
      } catch (error) {
        issues.push('Unable to verify client session status');
      }

      // Check memory usage
      const memoryStats = this.getMemoryStats();
      if (memoryStats.memoryPressure) {
        warnings.push(`High memory usage: ${memoryStats.utilizationPercent}%`);
        recommendations.push('Consider reducing buffer sizes or processing more frequently');
      }

      // Check queue health
      const queueStats = this.getAudioQueueStats();
      if (queueStats.queueUtilizationPercent > 80) {
        warnings.push(`High input queue utilization: ${queueStats.queueUtilizationPercent}%`);
        recommendations.push('Audio processing may be falling behind');
      }

      if (queueStats.outputBufferUtilizationPercent > 80) {
        warnings.push(`High output buffer utilization: ${queueStats.outputBufferUtilizationPercent}%`);
        recommendations.push('Model is generating audio faster than consumption');
      }

      // Check processing state
      if (queueStats.isProcessing && queueStats.queueLength === 0) {
        warnings.push('Processing flag is set but queue is empty');
      }

      // Check real-time features
      const realtimeStats = this.getRealtimeState();
      if (realtimeStats.realtimeMode && !realtimeStats.clientCapabilities.supportsRealtimeInterruption) {
        warnings.push('Real-time mode enabled but client does not support interruption');
        recommendations.push('Verify client implementation supports real-time features');
      }

      // Check for stale activity
      if (realtimeStats.timeSinceLastActivity && realtimeStats.timeSinceLastActivity > 30000) {
        warnings.push(`No user activity for ${Math.round(realtimeStats.timeSinceLastActivity / 1000)}s`);
      }

      const healthy = issues.length === 0;

      return {
        healthy,
        issues,
        warnings,
        recommendations
      };
    } catch (error) {
      logger.error(`Error performing health check`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });

      return {
        healthy: false,
        issues: ['Health check failed due to internal error'],
        warnings: [],
        recommendations: ['Check session logs for detailed error information']
      };
    }
  }

  /**
   * Logs comprehensive session diagnostics for debugging
   */
  public logDiagnostics(level: 'debug' | 'info' | 'warn' = 'debug'): void {
    try {
      const diagnostics = this.getDiagnostics();
      const healthStatus = this.getHealthStatus();

      const logData = {
        sessionId: this.sessionId,
        diagnostics,
        healthStatus,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      };

      switch (level) {
        case 'info':
          logger.info('Session diagnostics', logData);
          break;
        case 'warn':
          logger.warn('Session diagnostics', logData);
          break;
        default:
          logger.debug('Session diagnostics', logData);
          break;
      }
    } catch (error) {
      logger.error(`Failed to log diagnostics`, {
        sessionId: this.sessionId,
        error: extractErrorDetails(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
    }
  }
}