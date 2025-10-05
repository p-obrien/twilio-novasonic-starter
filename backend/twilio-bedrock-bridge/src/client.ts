/**
 * @fileoverview AWS Bedrock Nova Sonic Bidirectional Streaming Client
 * 
 * This module provides a comprehensive client for interacting with Amazon Bedrock's Nova Sonic model
 * through bidirectional streaming. It enables real-time audio processing and conversation management
 * with support for multiple concurrent sessions.
 * 
 * Key Features:
 * - Bidirectional streaming with AWS Bedrock Nova Sonic model
 * - Session-based conversation management
 * - Real-time audio streaming with buffering and queue management
 * - Event-driven architecture with RxJS observables
 * - Comprehensive error handling and logging
 * - Support for multiple concurrent sessions
 * 
 * @author Twilio Bedrock Bridge Team
 * @version 1.0.0
 */

import {
  BedrockRuntimeClient,
  BedrockRuntimeClientConfig,
  InvokeModelWithBidirectionalStreamCommand,
  InvokeModelWithBidirectionalStreamInput,
} from "@aws-sdk/client-bedrock-runtime";
import {
  NodeHttp2Handler,
  NodeHttp2HandlerOptions,
} from "@smithy/node-http-handler";
import { Provider } from "@smithy/types";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { Subject, firstValueFrom } from 'rxjs';
import { take, filter } from 'rxjs/operators';
import { inspect } from 'util';

import { InferenceConfig } from "./types/SharedTypes";
import { bedrockObservability } from './observability/bedrockObservability';
import {
  DefaultAudioInputConfiguration,
  DefaultAudioOutputConfiguration,
  DefaultSystemPrompt,
  DefaultTextConfiguration,
  BufferSizeConfig
} from "./utils/constants";
import logger from './utils/logger';
import { CorrelationIdManager } from './utils/correlationId';
import { setTimeoutWithCorrelation } from './utils/asyncCorrelation';
import { config } from './config/AppConfig';
import { StreamSession } from './session/StreamSession';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface NovaSonicBidirectionalStreamClientConfig {
  requestHandlerConfig?: NodeHttp2HandlerOptions | Provider<NodeHttp2HandlerOptions | void>;
  clientConfig: Partial<BedrockRuntimeClientConfig>;
  inferenceConfig?: InferenceConfig;
  bedrock?: {
    region?: string;
    modelId?: string;
  };
}

interface SessionData {
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
  // Observability flags
  streamCompleteObserved?: boolean;
  sessionEndObserved?: boolean;
  // Real-time conversation features
  realtimeMode?: boolean;
  userSpeaking?: boolean;
  modelSpeaking?: boolean;
  lastUserActivity?: number;
  lastModelActivity?: number;
}



// ============================================================================
// MAIN CLIENT CLASS
// ============================================================================

export class NovaSonicBidirectionalStreamClient {
  // ============================================================================
  // PRIVATE PROPERTIES
  // ============================================================================

  private readonly bedrockRuntimeClient: BedrockRuntimeClient;
  private readonly inferenceConfig: InferenceConfig;
  private readonly activeSessions = new Map<string, SessionData>();
  private readonly streamSessions = new Map<string, StreamSession>();
  private readonly sessionLastActivity = new Map<string, number>();
  private readonly sessionCleanupInProgress = new Set<string>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly SESSION_TIMEOUT_MS = 300000; // 5 minutes
  private readonly CLEANUP_INTERVAL_MS = 60000; // 1 minute

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  constructor(config: NovaSonicBidirectionalStreamClientConfig) {
    this.bedrockRuntimeClient = this.createBedrockClient(config);
    this.inferenceConfig = this.createInferenceConfig(config.inferenceConfig);
    this.startPeriodicCleanup();
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  /**
   * Check if a session is currently active
   */
  public isSessionActive(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    return !!session && session.isActive;
  }

  /**
   * Get list of all active session IDs
   */
  public getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Get last activity timestamp for a session
   */
  public getLastActivityTime(sessionId: string): number {
    return this.sessionLastActivity.get(sessionId) || 0;
  }

  /**
   * Check if cleanup is in progress for a session
   */
  public isCleanupInProgress(sessionId: string): boolean {
    return this.sessionCleanupInProgress.has(sessionId);
  }

  /**
   * Get session data for testing purposes
   */
  public getSessionData(sessionId: string): SessionData | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Create a new streaming session
   */
  public createStreamSession(
    sessionId: string = randomUUID(),
    config?: NovaSonicBidirectionalStreamClientConfig
  ): StreamSession {
    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Stream session with ID ${sessionId} already exists`);
    }

    const session = this.createSessionData(sessionId, config?.inferenceConfig);
    this.activeSessions.set(sessionId, session);

    const streamSession = new StreamSession(sessionId, this);
    this.streamSessions.set(sessionId, streamSession);

    return streamSession;
  }

  // ============================================================================
  // SESSION MANAGEMENT METHODS
  // ============================================================================

  /**
   * Initiate a bidirectional streaming session
   */
  public async initiateSession(sessionId: string): Promise<void> {
    return CorrelationIdManager.traceWithCorrelation('bedrock.initiate_session', async () => {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Stream session ${sessionId} not found`);
      }

      try {
        // Start custom observability tracking
        bedrockObservability.startSession(sessionId, config.bedrock.modelId);

      this.setupSessionStartEvent(sessionId);
      const asyncIterable = this.createSessionAsyncIterable(sessionId);

      logger.info(`Starting bidirectional stream for session ${sessionId}`);

      // Debug: log the command being sent
      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId: config.bedrock.modelId,
        body: asyncIterable,
      });

      logger.debug(`Bedrock command created for session ${sessionId}:`, {
        modelId: command.input.modelId,
        bodyType: typeof command.input.body,
        bodyConstructor: command.input.body?.constructor?.name
      });

      const response = await this.bedrockRuntimeClient.send(command);

      logger.info(`Stream established for session ${sessionId}`);

      // Add error handling around response processing to prevent instrumentation issues
      try {
        await this.processResponseStream(sessionId, response);
      } catch (responseError) {
        // Check if this is an instrumentation error that we can work around
        if (responseError instanceof Error &&
          (responseError.message.includes('SharedArrayBuffer, ArrayBuffer or ArrayBufferView') ||
            responseError.message.includes('TextDecoder'))) {
          logger.warn(`OpenTelemetry instrumentation error detected for session ${sessionId}, continuing with response processing:`, {
            error: responseError.message,
            name: responseError.name
          });

          // Try to continue processing the response without instrumentation interference
          // by processing the raw response stream
          await this.processResponseStreamRaw(sessionId, response);
        } else {
          throw responseError;
        }
      }

    } catch (error) {
      logger.error(`Error in initiateSession for ${sessionId}:`, {
        error,
        errorName: (error as any)?.name,
        errorMessage: (error as any)?.message,
        errorCode: (error as any)?.code,
        errorStack: (error as any)?.stack
      });
      
      // Record error in custom observability
      bedrockObservability.recordError(sessionId, error instanceof Error ? error : new Error(String(error)));
      bedrockObservability.completeSession(sessionId, 'error');
      
      this.handleSessionError(sessionId, error);
    }
    }, { 'session.id': sessionId });
  }

  /**
   * Close a session gracefully
   */
  public async closeSession(sessionId: string): Promise<void> {
    if (this.sessionCleanupInProgress.has(sessionId)) {
      logger.warn(`Cleanup already in progress for session ${sessionId}`);
      return;
    }

    this.sessionCleanupInProgress.add(sessionId);
    try {
      logger.info(`Closing session ${sessionId}`);
      this.sendContentEnd(sessionId);
      this.sendPromptEnd(sessionId);
      this.sendSessionEnd(sessionId);
    } catch (error) {
      logger.error(`Error closing session ${sessionId}:`, error);
      this.forceCleanupSession(sessionId);
    } finally {
      this.sessionCleanupInProgress.delete(sessionId);
    }
  }

  /**
   * Force close a session immediately
   */
  public forceCloseSession(sessionId: string): void {
    if (this.sessionCleanupInProgress.has(sessionId) || !this.activeSessions.has(sessionId)) {
      return;
    }

    this.sessionCleanupInProgress.add(sessionId);
    try {
      this.forceCleanupSession(sessionId);
    } finally {
      this.sessionCleanupInProgress.delete(sessionId);
    }
  }

  /**
   * Remove stream session from tracking
   */
  public removeStreamSession(sessionId: string): void {
    this.streamSessions.delete(sessionId);
    logger.debug(`Removed StreamSession tracking for ${sessionId}`);
  }

  // ============================================================================
  // REAL-TIME CONVERSATION METHODS
  // ============================================================================

  /**
   * Enable real-time interruption for a session
   */
  public enableRealtimeInterruption(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    (session as any).realtimeMode = true;
    session.isWaitingForResponse = false;

    logger.info(`Real-time interruption enabled for session ${sessionId}`);
  }

  /**
   * Handle user interruption of model response
   */
  public handleUserInterruption(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEventToSessionQueue(sessionId, {
      event: {
        userInterruption: {
          timestamp: new Date().toISOString(),
          reason: "user_speaking"
        }
      }
    });

    session.isWaitingForResponse = false;
    logger.info(`User interruption handled for session ${sessionId}`);
  }

  /**
   * Set user speaking state for voice activity detection
   */
  public setUserSpeakingState(sessionId: string, speaking: boolean): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    (session as any).userSpeaking = speaking;
    (session as any).lastUserActivity = Date.now();

    // Trigger interruption if user speaks while model is responding in real-time mode
    if (speaking && (session as any).modelSpeaking && (session as any).realtimeMode) {
      this.handleUserInterruption(sessionId);
    }

    logger.debug(`User speaking state: ${speaking} for session ${sessionId}`);
  }

  /**
   * Stream audio for real-time processing
   */
  public async streamAudioRealtime(sessionId: string, audioData: Buffer): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    await this.streamAudioChunk(sessionId, audioData);
  }


  // ============================================================================
  // EVENT HANDLING METHODS
  // ============================================================================

  /**
   * Register an event handler for a session
   */
  public registerEventHandler(sessionId: string, eventType: string, handler: (data: any) => void): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.responseHandlers.set(eventType, handler);
  }

  // ============================================================================
  // SESSION SETUP METHODS
  // ============================================================================

  public setupSessionStartEvent(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Create a clean copy of inference config to avoid any reference issues
    const cleanInferenceConfig = {
      maxTokens: session.inferenceConfig.maxTokens,
      topP: session.inferenceConfig.topP,
      temperature: session.inferenceConfig.temperature
    };

    this.addEventToSessionQueue(sessionId, {
      event: {
        sessionStart: {
          inferenceConfiguration: cleanInferenceConfig
        }
      }
    });
  }

  public setupPromptStartEvent(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEventToSessionQueue(sessionId, {
      event: {
        promptStart: {
          promptName: session.promptName,
          textOutputConfiguration: { mediaType: "text/plain" },
          audioOutputConfiguration: DefaultAudioOutputConfiguration,
          toolConfiguration: { tools: [] },
        },
      }
    });
    session.isPromptStartSent = true;
  }

  public setupSystemPromptEvent(
    sessionId: string,
    textConfig: typeof DefaultTextConfiguration = DefaultTextConfiguration,
    systemPromptContent: string = DefaultSystemPrompt
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const textPromptID = randomUUID();

    // Content start
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentStart: {
          promptName: session.promptName,
          contentName: textPromptID,
          type: "TEXT",
          interactive: false,
          role: "SYSTEM",
          textInputConfiguration: textConfig,
        },
      }
    });

    // Text input
    this.addEventToSessionQueue(sessionId, {
      event: {
        textInput: {
          promptName: session.promptName,
          contentName: textPromptID,
          content: systemPromptContent,
        },
      }
    });

    // Content end
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentEnd: {
          promptName: session.promptName,
          contentName: textPromptID,
        },
      }
    });
  }

  public setupStartAudioEvent(
    sessionId: string,
    audioConfig: typeof DefaultAudioInputConfiguration = DefaultAudioInputConfiguration
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEventToSessionQueue(sessionId, {
      event: {
        contentStart: {
          promptName: session.promptName,
          contentName: session.audioContentId,
          type: "AUDIO",
          interactive: true,
          role: "USER",
          audioInputConfiguration: audioConfig,
        },
      }
    });
    session.isAudioContentStartSent = true;
  }

  // ============================================================================
  // AUDIO STREAMING METHODS
  // ============================================================================

  /**
   * Stream an audio chunk for a session
   */
  public async streamAudioChunk(sessionId: string, audioData: Buffer): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive || !session.audioContentId) {
      throw new Error(`Invalid session ${sessionId} for audio streaming`);
    }

    const base64Data = audioData.toString('base64');
    this.addEventToSessionQueue(sessionId, {
      event: {
        audioInput: {
          promptName: session.promptName,
          contentName: session.audioContentId,
          content: base64Data,
        },
      }
    });
  }

  // ============================================================================
  // SESSION CONTROL METHODS
  // ============================================================================

  public sendContentEnd(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session?.isAudioContentStartSent) return;

    this.addEventToSessionQueue(sessionId, {
      event: {
        contentEnd: {
          promptName: session.promptName,
          contentName: session.audioContentId,
        }
      }
    });
  }

  public sendPromptEnd(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session?.isPromptStartSent) return;

    this.addEventToSessionQueue(sessionId, {
      event: {
        promptEnd: {
          promptName: session.promptName
        }
      }
    });

    session.isWaitingForResponse = true;
    logger.info(`Set isWaitingForResponse=true for session ${sessionId}`);
  }

  public sendSessionEnd(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEventToSessionQueue(sessionId, {
      event: { sessionEnd: {} }
    });

    this.sendFallbackEndSequence(sessionId, session);
    this.cleanupSession(sessionId, session);
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Create Bedrock client with optimized HTTP/2 configuration
   */
  private createBedrockClient(config: NovaSonicBidirectionalStreamClientConfig): BedrockRuntimeClient {
    const nodeHttp2Handler = new NodeHttp2Handler({
      requestTimeout: 300000,
      sessionTimeout: 300000,
      disableConcurrentStreams: false,
      maxConcurrentStreams: 20,
      ...config.requestHandlerConfig,
    });

    const clientConfig: any = {
      ...config.clientConfig,
      region: config.clientConfig.region || config.bedrock?.region || "us-east-1",
      requestHandler: nodeHttp2Handler
    };

    if ((config.clientConfig as any).credentials) {
      clientConfig.credentials = (config.clientConfig as any).credentials;
    }

    return new BedrockRuntimeClient(clientConfig);
  }

  /**
   * Create inference configuration with defaults
   */
  private createInferenceConfig(config?: InferenceConfig): InferenceConfig {
    return config ?? {
      maxTokens: 1024,
      topP: 0.9,
      temperature: 0.7,
    };
  }

  /**
   * Create session data structure
   */
  private createSessionData(sessionId: string, inferenceConfig?: InferenceConfig): SessionData {
    return {
      queue: [],
      queueSignal: new Subject<void>(),
      closeSignal: new Subject<void>(),
      responseSubject: new Subject<any>(),
      responseHandlers: new Map(),
      promptName: randomUUID(),
      inferenceConfig: inferenceConfig ?? this.inferenceConfig,
      isActive: true,
      isPromptStartSent: false,
      isAudioContentStartSent: false,
      audioContentId: randomUUID(),
      isWaitingForResponse: false
    };
  }

  /**
   * Update session activity timestamp
   */
  private updateSessionActivity(sessionId: string): void {
    this.sessionLastActivity.set(sessionId, Date.now());
  }

  /**
   * Sanitize event for logging to avoid circular references and large content
   */
  private sanitizeEventForLogging(event: any): any {
    try {
      return JSON.parse(JSON.stringify(event, (k: string, v: any) => {
        // Remove large content for logging
        if (k === 'content' && typeof v === 'string' && v.length > 200) {
          return `[${v.length} bytes removed]`;
        }
        // Handle potential circular references
        if (typeof v === 'object' && v !== null) {
          if (v.constructor && v.constructor.name && v.constructor.name !== 'Object' && v.constructor.name !== 'Array') {
            return `[${v.constructor.name} object]`;
          }
        }
        return v;
      }));
    } catch (e) {
      return '[Unable to serialize for logging]';
    }
  }

  /**
   * Normalize data for event handlers
   */
  private normalizeForHandlers(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;

    try {
      const id = obj.contentId ?? obj.contentName;
      if (id) {
        obj.contentId = id;
        obj.contentName = id;
      }

      if (typeof obj.additionalModelFields === 'string' && !obj.parsedAdditionalModelFields) {
        try {
          obj.parsedAdditionalModelFields = JSON.parse(obj.additionalModelFields);
        } catch { /* ignore */ }
      }
    } catch (e) {
      // Non-fatal normalization error
    }

    return obj;
  }

  /**
   * Handle session errors
   */
  private handleSessionError(sessionId: string, error: any): void {
    logger.error(`Error in session ${sessionId}:`, {
      error,
      message: error instanceof Error ? error.message : String(error),
      name: (error as any)?.name,
      code: (error as any)?.code,
      statusCode: (error as any)?.$metadata?.httpStatusCode,
      requestId: (error as any)?.$metadata?.requestId,
      metadata: (error as any)?.$metadata
    });

    this.dispatchEventForSession(sessionId, 'error', {
      source: 'bidirectionalStream',
      error
    });

    const session = this.activeSessions.get(sessionId);
    if (session?.isActive) {
      this.closeSession(sessionId);
    }
  }

  /**
   * Send fallback end sequence for session termination
   */
  private sendFallbackEndSequence(sessionId: string, session: SessionData): void {
    try {
      if (session.isPromptStartSent) {
        this.addEventToSessionQueue(sessionId, {
          event: { promptEnd: { promptName: session.promptName } }
        });
      }

      if (session.isAudioContentStartSent && session.audioContentId) {
        this.addEventToSessionQueue(sessionId, {
          event: {
            contentEnd: {
              promptName: session.promptName,
              contentName: session.audioContentId
            }
          }
        });
      }
    } catch (error) {
      logger.warn(`End-sequence failed for session ${sessionId}:`, error);
    }
  }

  /**
   * Clean up session resources
   */
  private cleanupSession(sessionId: string, session: SessionData): void {
    session.isActive = false;

    // Clean up RxJS subjects to prevent memory leaks
    try {
      session.closeSignal.next();
      session.closeSignal.complete();
      session.responseSubject.complete();
      session.queueSignal.complete();
    } catch (e) {
      logger.warn(`Error cleaning up RxJS subjects for session ${sessionId}:`, e);
    }

    // Clear event handlers map
    session.responseHandlers.clear();

    // Clear session queue to free memory
    session.queue.length = 0;

    // Remove from tracking maps
    this.activeSessions.delete(sessionId);
    this.sessionLastActivity.delete(sessionId);
    this.streamSessions.delete(sessionId);

    logger.info(`Session ${sessionId} cleaned up`);
  }

  /**
   * Force cleanup session without graceful shutdown
   */
  private forceCleanupSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    logger.info(`Force closing session ${sessionId}`);
    this.cleanupSession(sessionId, session);
  }

  /**
   * Buffer model audio output
   */
  private bufferModelAudioOutput(sessionId: string, audioContent: string): void {
    const streamSession = this.streamSessions.get(sessionId);
    if (!streamSession || !audioContent) return;

    try {
      const audioBuffer = Buffer.from(audioContent, 'base64');
      streamSession.bufferAudioOutput(audioBuffer);
      logger.debug(`Buffered ${audioBuffer.length} bytes for session ${sessionId}`);
    } catch (error) {
      logger.error(`Error buffering audio for session ${sessionId}:`, error);
    }
  }

  /**
   * Start periodic cleanup of inactive sessions
   */
  private startPeriodicCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveSessions();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Clean up inactive sessions to prevent memory leaks
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now();
    const sessionsToCleanup: string[] = [];

    for (const [sessionId, lastActivity] of this.sessionLastActivity.entries()) {
      if (now - lastActivity > this.SESSION_TIMEOUT_MS) {
        const session = this.activeSessions.get(sessionId);
        if (session && !session.isActive) {
          sessionsToCleanup.push(sessionId);
        }
      }
    }

    for (const sessionId of sessionsToCleanup) {
      logger.info(`Cleaning up inactive session: ${sessionId}`);
      this.forceCloseSession(sessionId);
    }

    if (sessionsToCleanup.length > 0) {
      logger.info(`Cleaned up ${sessionsToCleanup.length} inactive sessions`);
    }
  }

  /**
   * Shutdown the client and clean up all resources
   */
  public shutdown(): void {
    // Stop periodic cleanup
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Force close all active sessions
    const activeSessions = Array.from(this.activeSessions.keys());
    for (const sessionId of activeSessions) {
      this.forceCloseSession(sessionId);
    }

    logger.info('NovaSonicBidirectionalStreamClient shutdown complete');
  }

  /**
   * Dispatch events to session handlers
   */
  private dispatchEventForSession(sessionId: string, eventType: string, data: any): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const normalizedData = this.normalizeForHandlers(data);

    // Mark terminal events
    if (eventType === 'streamComplete') {
      session.streamCompleteObserved = true;
    }
    if (eventType === 'sessionEnd') {
      session.sessionEndObserved = true;
      session.streamCompleteObserved = true;
    }

    // Publish to response subject
    try {
      session.responseSubject?.next({ type: eventType, data: normalizedData });
    } catch (e) {
      logger.debug(`Failed to publish to responseSubject for session ${sessionId}: ${e}`);
    }

    // Call registered handlers
    const handler = session.responseHandlers.get(eventType);
    if (handler) {
      try {
        handler(normalizedData);
      } catch (e) {
        logger.error(`Error in ${eventType} handler for session ${sessionId}:`, e);
      }
    }

    // Call 'any' handlers
    const anyHandler = session.responseHandlers.get('any');
    if (anyHandler) {
      try {
        anyHandler({ type: eventType, data: normalizedData });
      } catch (e) {
        logger.error(`Error in 'any' handler for session ${sessionId}:`, e);
      }
    }
  }

  /**
   * Dispatch events (alias for backward compatibility)
   */
  private dispatchEvent(sessionId: string, eventType: string, data: any): void {
    this.dispatchEventForSession(sessionId, eventType, data);
    
    // Record event in custom observability
    bedrockObservability.recordEvent(sessionId, eventType, data);
    
    // Handle special events
    if (eventType === 'usageEvent' && data) {
      logger.info('Usage event received', {
        sessionId,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.totalTokens
      });
      
      bedrockObservability.recordUsage(sessionId, {
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.totalTokens
      });
    } else if (eventType === 'streamComplete') {
      bedrockObservability.completeSession(sessionId, 'completed');
    } else if (eventType === 'error') {
      bedrockObservability.recordError(sessionId, data.message || 'Unknown error', data);
    }
  }

  /**
   * Add event to session queue
   */
  private addEventToSessionQueue(sessionId: string, event: any): void {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    const eventKey = event?.event && Object.keys(event.event)[0];
    const isAudioEvent = eventKey === 'audioInput' ||
      (eventKey === 'contentStart' && event.event.contentStart?.type === 'AUDIO');

    // Validate that the event can be serialized before adding to queue
    try {
      JSON.stringify(event);
    } catch (serializationError) {
      logger.error(`Event serialization failed for session ${sessionId}:`, {
        error: serializationError,
        eventType: eventKey,
        sessionId
      });

      // Create a safe fallback event
      const safeEvent = {
        event: {
          error: {
            message: 'Original event could not be serialized',
            eventType: eventKey,
            timestamp: new Date().toISOString()
          }
        }
      };

      session.queue.push(safeEvent);
      session.queueSignal.next();
      return;
    }

    if (!isAudioEvent) {
      logger.debug(`Adding event to queue for session ${sessionId}:`, event);
    } else {
      logger.trace('session.event.suppressed', { sessionId, eventType: eventKey });
    }

    this.updateSessionActivity(sessionId);
    session.queue.push(event);
    session.queueSignal.next();
  }

  /**
   * Wait for event acknowledgment
   */
  private async waitForEventAck(sessionId: string, matchFn: (evt: any) => boolean, timeoutMs: number = 5000): Promise<any> {
    const session = this.activeSessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found for ack`);

    try {
      const ack = await Promise.race([
        firstValueFrom(session.responseSubject.pipe(
          filter((evt: any) => {
            try {
              return matchFn(evt);
            } catch (e) {
              logger.debug(`waitForEventAck: matchFn threw for session ${sessionId}: ${e}`);
              return false;
            }
          }),
          take(1)
        )),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ack timeout')), timeoutMs))
      ]);

      logger.debug(`waitForEventAck: ack received for session ${sessionId}`, { ack });
      return ack;
    } catch (err) {
      const observed = {
        streamCompleteObserved: session.streamCompleteObserved ?? false,
        sessionEndObserved: session.sessionEndObserved ?? false
      };
      logger.warn(`waitForEventAck: timeout for session ${sessionId}`, {
        error: err instanceof Error ? err.message : String(err),
        observed
      });
      throw err;
    }
  }

  /**
   * Create async iterable for session
   */
  private createSessionAsyncIterable(sessionId: string): AsyncIterable<InvokeModelWithBidirectionalStreamInput> {
    if (!this.isSessionActive(sessionId)) {
      logger.warn(`Cannot create async iterable: Session ${sessionId} not active`);
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ value: undefined, done: true })
        })
      };
    }

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Cannot create async iterable: Session ${sessionId} not found`);
    }

    let eventCount = 0;

    // Create an async iterable that appears as a simple object to instrumentation
    const asyncIterable = {
      // Make it look like a simple request body to instrumentation
      toJSON: () => ({
        type: 'bidirectional-stream',
        sessionId: sessionId,
        modelId: 'amazon.nova-sonic-v1:0'
      }),

      // Return a JSON string instead of a description to avoid parsing errors
      toString: () => JSON.stringify({
        type: 'bidirectional-stream',
        sessionId: sessionId,
        modelId: 'amazon.nova-sonic-v1:0'
      }),

      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<InvokeModelWithBidirectionalStreamInput>> => {
          try {
            if (!session.isActive || !this.activeSessions.has(sessionId)) {
              return { value: undefined, done: true };
            }

            if (session.queue.length === 0) {
              try {
                await Promise.race([
                  firstValueFrom(session.queueSignal.pipe(take(1))),
                  firstValueFrom(session.closeSignal.pipe(take(1))).then(() => {
                    throw new Error("Stream closed");
                  })
                ]);
              } catch (error) {
                if (error instanceof Error && (error.message === "Stream closed" || !session.isActive)) {
                  return { value: undefined, done: true };
                }
              }
            }

            if (session.queue.length === 0) {
              if (!session.isActive) {
                return { value: undefined, done: true };
              }
              if (session.isWaitingForResponse) {
                try {
                  await firstValueFrom(session.closeSignal.pipe(take(1)));
                  return { value: undefined, done: true };
                } catch (error) {
                  return { value: undefined, done: true };
                }
              }
              return { value: undefined, done: true };
            }

            const nextEvent = session.queue.shift();
            eventCount++;

            this.logEventSending(sessionId, eventCount, nextEvent);

            let serializedEvent: string;
            try {
              serializedEvent = JSON.stringify(nextEvent);
            } catch (jsonError) {
              logger.error(`JSON serialization failed for session ${sessionId}:`, {
                error: jsonError,
                eventType: nextEvent?.event ? Object.keys(nextEvent.event)[0] : 'unknown',
                eventStructure: this.sanitizeEventForLogging(nextEvent)
              });
              throw jsonError;
            }

            const encodedBytes = new TextEncoder().encode(serializedEvent);

            const result: IteratorResult<InvokeModelWithBidirectionalStreamInput> = {
              value: {
                chunk: {
                  bytes: encodedBytes
                }
              },
              done: false
            };

            // Debug: log what we're yielding
            logger.debug(`Yielding from async iterator for session ${sessionId}:`, {
              eventCount,
              serializedEventLength: serializedEvent.length,
              serializedEventPreview: serializedEvent.substring(0, 200),
              encodedBytesLength: encodedBytes.length,
              isUint8Array: encodedBytes instanceof Uint8Array
            });

            return result;
          } catch (error) {
            logger.error(`Error in session ${sessionId} iterator:`, error);
            session.isActive = false;
            return { value: undefined, done: true };
          }
        },

        return: async (): Promise<IteratorResult<InvokeModelWithBidirectionalStreamInput>> => {
          logger.debug(`Iterator return() called for session ${sessionId}`);
          session.isActive = false;
          return { value: undefined, done: true };
        },

        throw: async (error: any): Promise<IteratorResult<InvokeModelWithBidirectionalStreamInput>> => {
          logger.error(`Iterator throw() called for session ${sessionId}:`, error);
          session.isActive = false;
          throw error;
        }
      })
    };

    return asyncIterable;
  }

  /**
   * Log event sending with audio event suppression
   */
  private logEventSending(sessionId: string, eventCount: number, nextEvent: any): void {
    try {
      const eventKey = nextEvent?.event && Object.keys(nextEvent.event)[0];
      const isAudioEvent = eventKey === 'audioInput' ||
        (eventKey === 'contentStart' && nextEvent.event.contentStart?.type === 'AUDIO');

      if (!isAudioEvent) {
        const sanitized = JSON.parse(JSON.stringify(nextEvent, (k: string, v: any) => {
          if (k === 'content' && typeof v === 'string' && v.length > 200) {
            return `[${v.length} bytes removed]`;
          }
          return v;
        }));
        logger.debug(`Sending event #${eventCount} for session ${sessionId}:`, sanitized);
      } else {
        logger.trace('session.event.suppressed.send', { sessionId, eventCount, eventType: eventKey });
      }
    } catch (sanErr) {
      logger.debug(`Sending event #${eventCount} for session ${sessionId} (sanitization failed)`);
    }
  }

  /**
   * Process the response stream from AWS Bedrock (fallback method without instrumentation)
   */
  private async processResponseStreamRaw(sessionId: string, response: any): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    try {
      logger.info(`Starting raw response stream processing for session ${sessionId}`);
      let eventCount = 0;
      let hasAnyEvents = false;

      // Process the response stream directly without letting instrumentation interfere
      for await (const event of response.body) {
        hasAnyEvents = true;
        eventCount++;

        if (!session.isActive) {
          logger.info('Session no longer active, stopping response processing', { sessionId });
          break;
        }

        // Process events directly without extensive logging to avoid instrumentation issues
        if (event.chunk?.bytes) {
          try {
            const textResponse = new TextDecoder().decode(event.chunk.bytes);
            const jsonResponse = JSON.parse(textResponse);
            const evt = jsonResponse.event || {};

            // Dispatch events with minimal processing
            if (evt.contentStart) {
              this.dispatchEvent(sessionId, 'contentStart', evt.contentStart);
            } else if (evt.textOutput) {
              this.dispatchEvent(sessionId, 'textOutput', evt.textOutput);
            } else if (evt.audioOutput) {
              if (evt.audioOutput.content) {
                this.bufferModelAudioOutput(sessionId, evt.audioOutput.content);
              }
              this.dispatchEvent(sessionId, 'audioOutput', evt.audioOutput);
            } else if (evt.completionStart) {
              session.isWaitingForResponse = false;
              this.dispatchEvent(sessionId, 'completionStart', evt.completionStart);
            } else if (evt.completionEnd) {
              this.dispatchEvent(sessionId, 'completionEnd', evt.completionEnd);
            } else if (evt.contentEnd) {
              this.dispatchEvent(sessionId, 'contentEnd', evt.contentEnd);
            }
          } catch (e) {
            logger.error(`Error processing raw response chunk for session ${sessionId}:`, e);
            continue;
          }
        }
      }

      logger.info(`Raw response stream processing complete for session ${sessionId} after ${eventCount} events`);
      this.dispatchEvent(sessionId, 'streamComplete', {
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error(`Error in raw response stream processing for session ${sessionId}:`, error);
      this.dispatchEvent(sessionId, 'error', {
        source: 'rawResponseStream',
        message: 'Error processing raw response stream',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Process the response stream from AWS Bedrock
   */
  private async processResponseStream(sessionId: string, response: any): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    try {
      logger.info(`*** Starting to iterate over response.body for session ${sessionId} ***`);
      let eventCount = 0;
      let hasAnyEvents = false;

      for await (const event of response.body) {
        hasAnyEvents = true;
        eventCount++;
        logger.info(`*** Processing response event #${eventCount} for session ${sessionId} ***`);
        logger.info(`*** Event keys: ***`, Object.keys(event || {}));
        if (!session.isActive) {
          logger.info('Session no longer active, stopping response processing', { sessionId });
          break;
        }
        if (event.chunk?.bytes) {
          try {
            this.updateSessionActivity(sessionId);

            // Debug: log the raw bytes to understand what we're receiving
            logger.debug(`Raw chunk bytes for session ${sessionId}:`, {
              bytesType: typeof event.chunk.bytes,
              bytesConstructor: event.chunk.bytes?.constructor?.name,
              bytesLength: event.chunk.bytes?.length || event.chunk.bytes?.byteLength,
              isUint8Array: event.chunk.bytes instanceof Uint8Array,
              isBuffer: Buffer.isBuffer(event.chunk.bytes),
              firstFewBytes: event.chunk.bytes instanceof Uint8Array ? Array.from(event.chunk.bytes.slice(0, 10)) : 'not-uint8array'
            });

            // Ensure we have proper bytes for TextDecoder
            let bytesToDecode = event.chunk.bytes;
            if (!(bytesToDecode instanceof Uint8Array) && !Buffer.isBuffer(bytesToDecode)) {
              logger.warn(`Converting bytes to Uint8Array for session ${sessionId}`, {
                originalType: typeof bytesToDecode,
                originalConstructor: bytesToDecode?.constructor?.name
              });

              // Try to convert to Uint8Array if possible
              if (bytesToDecode && typeof bytesToDecode === 'object' && 'length' in bytesToDecode) {
                bytesToDecode = new Uint8Array(bytesToDecode);
              } else {
                logger.error(`Cannot convert bytes to proper format for session ${sessionId}`);
                continue;
              }
            }

            const textResponse = new TextDecoder().decode(bytesToDecode);

            // Debug: log the decoded text
            logger.debug(`Decoded text response for session ${sessionId}:`, {
              textType: typeof textResponse,
              textLength: textResponse.length,
              textPreview: textResponse.substring(0, 200),
              isValidJson: (() => {
                try { JSON.parse(textResponse); return true; } catch { return false; }
              })()
            });

            try {
              const jsonResponse = JSON.parse(textResponse);
              const evt = jsonResponse.event || {};

              // Debug: log all raw responses to see what we're getting
              logger.debug(`Raw response for session ${sessionId}:`, JSON.stringify(jsonResponse, null, 2));

              // Use this.normalizeForHandlers to normalize content identifiers and parse additionalModelFields

              if (evt.contentStart) {
                evt.contentStart = this.normalizeForHandlers(evt.contentStart);
                this.dispatchEvent(sessionId, 'contentStart', evt.contentStart);
              } else if (evt.textOutput) {
                evt.textOutput = this.normalizeForHandlers(evt.textOutput);
                this.dispatchEvent(sessionId, 'textOutput', evt.textOutput);
              } else if (evt.audioOutput) {
                evt.audioOutput = this.normalizeForHandlers(evt.audioOutput);

                // Buffer audio output for fast model responses (Nova Sonic can generate faster than real-time)
                if (evt.audioOutput.content) {
                  this.bufferModelAudioOutput(sessionId, evt.audioOutput.content);
                }

                this.dispatchEvent(sessionId, 'audioOutput', evt.audioOutput);
              } else if (evt.usageEvent) {
                this.dispatchEvent(sessionId, 'usageEvent', evt.usageEvent);
              } else if (evt.completionStart) {
                // Clear waiting flag when we start receiving a response
                const session = this.activeSessions.get(sessionId);
                if (session) {
                  session.isWaitingForResponse = false;
                  logger.debug(`Received completionStart, no longer waiting for response: ${sessionId}`);
                }
                this.dispatchEvent(sessionId, 'completionStart', evt.completionStart);
              } else if (evt.completionEnd) {
                this.dispatchEvent(sessionId, 'completionEnd', evt.completionEnd);
              } else if (evt.toolUse) {
                // Forward toolUse for observability / potential client-side handling
                logger.info(`ToolUse event received for session ${sessionId}; forwarding to handlers.`);
                evt.toolUse = this.normalizeForHandlers(evt.toolUse);
                this.dispatchEvent(sessionId, 'toolUse', evt.toolUse);
              } else if (evt.toolResult) {
                // Note: toolResult is not documented in Nova output events, but keeping for compatibility
                evt.toolResult = this.normalizeForHandlers(evt.toolResult);
                this.dispatchEvent(sessionId, 'toolResult', evt.toolResult);
              } else if (evt.contentEnd && evt.contentEnd.type === 'TOOL') {
                logger.info(`Tool content ended for session ${sessionId}; server-side tool execution disabled. Ignoring tool result.`);
              } else if (evt.contentEnd) {
                evt.contentEnd = this.normalizeForHandlers(evt.contentEnd);
                this.dispatchEvent(sessionId, 'contentEnd', evt.contentEnd);
              } else {
                // Handle other events
                const eventKeys = Object.keys(evt || {});
                logger.debug(`Event keys for session ${sessionId}: `, eventKeys);
                logger.debug(`Handling other events`);
                if (eventKeys.length > 0) {
                  this.dispatchEvent(sessionId, eventKeys[0], evt);
                } else if (Object.keys(jsonResponse).length > 0) {
                  this.dispatchEvent(sessionId, 'unknown', jsonResponse);
                }
              }
            } catch (e) {
              logger.error(`JSON parsing failed for Bedrock response in session ${sessionId}:`, {
                error: e,
                message: (e as any)?.message,
                textResponse: textResponse,
                textResponseLength: textResponse?.length,
                textResponseType: typeof textResponse,
                firstChars: textResponse?.substring(0, 100),
                lastChars: textResponse?.length > 100 ? textResponse?.substring(textResponse.length - 100) : null,
                rawBytesInfo: {
                  type: typeof event.chunk.bytes,
                  constructor: event.chunk.bytes?.constructor?.name,
                  length: event.chunk.bytes?.length || event.chunk.bytes?.byteLength
                }
              });

              // Continue processing other events instead of crashing the session
              continue;
            }
          } catch (e) {
            logger.error(`Error processing response chunk for session ${sessionId}: `, e);
          }
        } else if (event.modelStreamErrorException) {
          logger.error(`Model stream error for session ${sessionId}: `, event.modelStreamErrorException);
          this.dispatchEvent(sessionId, 'error', {
            type: 'modelStreamErrorException',
            details: event.modelStreamErrorException
          });
        } else if (event.internalServerException) {
          logger.error(`Internal server error for session ${sessionId}: `, event.internalServerException);
          this.dispatchEvent(sessionId, 'error', {
            type: 'internalServerException',
            details: event.internalServerException
          });
        } else if (event.validationException) {
          logger.error(`*** VALIDATION ERROR for session ${sessionId}: ***`, event.validationException);
          this.dispatchEvent(sessionId, 'error', {
            type: 'validationException',
            details: event.validationException
          });
        } else {
          // Log any other event types we might be missing
          logger.info(`*** Unknown event type for session ${sessionId}: ***`, Object.keys(event));
          logger.info(`*** Event details: ***`, event);
        }
      }

      if (!hasAnyEvents) {
        logger.error(`*** NO EVENTS RECEIVED FROM BEDROCK for session ${sessionId} - Stream was empty! ***`);
      }
      logger.info(`*** Response stream processing complete for session ${sessionId} after ${eventCount || 0} events ***`);
      this.dispatchEvent(sessionId, 'streamComplete', {
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      // Expanded diagnostic logging to capture ValidationException details and any attached metadata.
      logger.error(`Error processing response stream for session ${sessionId}:`, {
        name: (error as any)?.name ?? null,
        message: error instanceof Error ? error.message : String(error),
        code: (error as any)?.code ?? null,
        fault: (error as any)?.$fault ?? null,
        metadata: (error as any)?.$metadata ?? null,
        inspected: inspect(error, { depth: null })
      });
      // Also emit the raw error object to session handlers for downstream telemetry/alerts
      this.dispatchEvent(sessionId, 'error', {
        source: 'responseStream',
        message: 'Error processing response stream',
        details: error instanceof Error ? error.message : String(error),
        rawError: (error as any)
      });
    }
  }

}