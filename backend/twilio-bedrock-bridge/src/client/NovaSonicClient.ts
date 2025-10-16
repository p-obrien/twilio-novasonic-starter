/**
 * @fileoverview Enhanced Nova Sonic Client
 * 
 * This module provides a simplified, enhanced interface for the Nova Sonic bidirectional
 * streaming client. It wraps the core NovaSonicBidirectionalStreamClient with additional
 * convenience methods and improved error handling.
 * 
 * @author Twilio Bedrock Bridge Team
 * @version 1.0.0
 */

import { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2HandlerOptions } from "@smithy/node-http-handler";
import { Provider } from "@smithy/types";
import { NovaSonicClientConfig as BaseNovaSonicClientConfig, TextConfig, InferenceConfig } from '../types/ClientTypes';
import { StreamSession } from '../session/StreamSession';
import logger from '../utils/logger';

// Import the client class directly - we'll handle any circular import issues
import NovaSonicBidirectionalStreamClient from '../client';

/**
 * Configuration interface for the bidirectional stream client
 */
export interface NovaSonicBidirectionalStreamClientConfig {
  requestHandlerConfig?: NodeHttp2HandlerOptions | Provider<NodeHttp2HandlerOptions | void>;
  clientConfig: Partial<BedrockRuntimeClientConfig>;
  inferenceConfig?: InferenceConfig;
  bedrock?: {
    region?: string;
    modelId?: string;
  };
}

/**
 * Configuration for the enhanced Nova Sonic client
 */
export interface NovaSonicClientConfig extends NovaSonicBidirectionalStreamClientConfig {
  /** Bedrock-specific configuration */
  bedrock?: {
    /** AWS region for Bedrock */
    region?: string;
    /** Model ID to use */
    modelId?: string;
  };
  
  /** Enable orchestrator integration */
  enableOrchestrator?: boolean;
  
  /** Enable orchestrator debug logging */
  enableOrchestratorDebug?: boolean;
  
  /** Additional client-specific options */
  clientOptions?: {
    /** Enable automatic session cleanup */
    autoCleanup?: boolean;
    /** Session timeout in milliseconds */
    sessionTimeout?: number;
    /** Enable debug logging */
    enableDebugLogging?: boolean;
  };
}

/**
 * Text processing result from the Nova Sonic model
 */
export interface TextProcessingResult {
  /** Generated text response */
  response: string;
  /** Source of the response (e.g., 'conversation', 'knowledge_base', 'agent') */
  source: string;
  /** Session ID used for processing */
  sessionId: string;
  /** Processing metadata */
  metadata?: {
    /** Input tokens consumed */
    inputTokens?: number;
    /** Output tokens generated */
    outputTokens?: number;
    /** Processing time in milliseconds */
    processingTime?: number;
    /** Error information if processing failed */
    error?: string;
    /** Fallback reason if orchestrator was not used */
    fallbackReason?: string;
  };
}

/**
 * Enhanced Nova Sonic Client
 * 
 * Provides a simplified interface for interacting with AWS Bedrock Nova Sonic
 * with additional convenience methods and improved error handling.
 */
export class NovaSonicClient {
  private readonly client: NovaSonicBidirectionalStreamClient;
  private readonly config: NovaSonicClientConfig;
  private readonly orchestratorEnabled: boolean;

  constructor(config: NovaSonicClientConfig) {
    this.config = config;
    this.orchestratorEnabled = config.enableOrchestrator || false;
    this.client = new NovaSonicBidirectionalStreamClient(config);
    
    if (config.clientOptions?.enableDebugLogging || config.enableOrchestratorDebug) {
      logger.info('Enhanced Nova Sonic Client initialized', {
        debugLogging: config.clientOptions?.enableDebugLogging,
        orchestratorEnabled: this.orchestratorEnabled,
        orchestratorDebug: config.enableOrchestratorDebug
      });
    }
  }

  /**
   * Create a new streaming session
   */
  public createSession(sessionId?: string): StreamSession {
    return this.client.createStreamSession(sessionId, this.config);
  }

  /**
   * Check if a session is currently active
   */
  public isSessionActive(sessionId: string): boolean {
    return this.client.isSessionActive(sessionId);
  }

  /**
   * Get list of all active session IDs
   */
  public getActiveSessions(): string[] {
    return this.client.getActiveSessions();
  }

  /**
   * Close a session gracefully
   */
  public async closeSession(sessionId: string): Promise<void> {
    return this.client.closeSession(sessionId);
  }

  /**
   * Force close a session immediately
   */
  public forceCloseSession(sessionId: string): void {
    this.client.forceCloseSession(sessionId);
  }

  /**
   * Check if orchestrator is enabled
   */
  public isOrchestratorEnabled(): boolean {
    return this.orchestratorEnabled;
  }

  /**
   * Process text input through orchestrator (if enabled) or fallback
   */
  public async processTextInput(
    text: string,
    sessionId: string,
    context?: any
  ): Promise<TextProcessingResult> {
    const startTime = Date.now();
    
    try {
      // For now, return a basic conversation response
      // This should be updated when orchestrator integration is added
      const processingTime = Date.now() - startTime;
      
      logger.info(`Text input processed for session ${sessionId}`, {
        processingTime,
        textLength: text.length,
        hasContext: !!context
      });
      
      return {
        response: `I understand your message: "${text}". The orchestrator integration is not currently enabled.`,
        source: 'conversation',
        sessionId,
        metadata: {
          processingTime,
          inputTokens: Math.ceil(text.length / 4), // Rough token estimate
          outputTokens: Math.ceil(text.length / 4),
          fallbackReason: 'orchestrator_disabled'
        }
      };
      
    } catch (error) {
      logger.error(`Error processing text input for session ${sessionId}:`, error);
      return {
        response: 'I apologize, but I encountered an issue processing your request.',
        source: 'error',
        sessionId,
        metadata: {
          processingTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * Process text input and get a response (convenience method)
   * 
   * This method creates a temporary session, processes the text,
   * and returns the result. For streaming audio, use createSession() instead.
   */
  public async processText(
    text: string,
    options?: {
      sessionId?: string;
      inferenceConfig?: InferenceConfig;
      textConfig?: TextConfig;
    }
  ): Promise<TextProcessingResult> {
    const sessionId = options?.sessionId || `text-${Date.now()}`;
    return this.processTextInput(text, sessionId);
  }

  /**
   * Enable real-time interruption for a session
   */
  public enableRealtimeInterruption(sessionId: string): void {
    this.client.enableRealtimeInterruption(sessionId);
  }

  /**
   * Handle user interruption of model response
   */
  public handleUserInterruption(sessionId: string): void {
    this.client.handleUserInterruption(sessionId);
  }

  /**
   * Set user speaking state for voice activity detection
   */
  public setUserSpeakingState(sessionId: string, speaking: boolean): void {
    this.client.setUserSpeakingState(sessionId, speaking);
  }

  /**
   * Stream audio for real-time processing
   */
  public async streamAudioRealtime(sessionId: string, audioData: Buffer): Promise<void> {
    return this.client.streamAudioRealtime(sessionId, audioData);
  }

  /**
   * Register an event handler for a session
   */
  public registerEventHandler(sessionId: string, eventType: string, handler: (data: any) => void): void {
    this.client.registerEventHandler(sessionId, eventType, handler);
  }

  /**
   * Get session statistics and health information
   */
  public getSessionStats(sessionId: string): {
    isActive: boolean;
    lastActivity: number;
    isCleanupInProgress: boolean;
  } {
    return {
      isActive: this.client.isSessionActive(sessionId),
      lastActivity: this.client.getLastActivityTime(sessionId),
      isCleanupInProgress: this.client.isCleanupInProgress(sessionId)
    };
  }

  /**
   * Shutdown the client and clean up all resources
   */
  public shutdown(): void {
    logger.info('Shutting down Enhanced Nova Sonic Client');
    this.client.shutdown();
  }

  /**
   * Stream an audio chunk for a session (delegates to underlying client)
   */
  public async streamAudioChunk(sessionId: string, audioData: Buffer): Promise<void> {
    return this.client.streamAudioChunk(sessionId, audioData);
  }

  /**
   * Send content end for a session (delegates to underlying client)
   */
  public sendContentEnd(sessionId: string): void {
    this.client.sendContentEnd(sessionId);
  }

  /**
   * Send prompt end for a session (delegates to underlying client)
   */
  public sendPromptEnd(sessionId: string): void {
    this.client.sendPromptEnd(sessionId);
  }

  /**
   * Create a stream session (alias for createSession for backward compatibility)
   */
  public createStreamSession(sessionId?: string): StreamSession {
    return this.createSession(sessionId);
  }

  /**
   * Initiate a session (delegates to underlying client)
   */
  public async initiateSession(sessionId: string): Promise<void> {
    return this.client.initiateSession(sessionId);
  }

  /**
   * Setup session start event (delegates to underlying client)
   */
  public setupSessionStartEvent(sessionId: string): void {
    this.client.setupSessionStartEvent(sessionId);
  }

  /**
   * Setup prompt start event (delegates to underlying client)
   */
  public setupPromptStartEvent(sessionId: string): void {
    this.client.setupPromptStartEvent(sessionId);
  }

  /**
   * Setup system prompt event (delegates to underlying client)
   */
  public setupSystemPromptEvent(sessionId: string, textConfig?: any, systemPrompt?: string): void {
    this.client.setupSystemPromptEvent(sessionId, textConfig, systemPrompt);
  }

  /**
   * Setup start audio event (delegates to underlying client)
   */
  public setupStartAudioEvent(sessionId: string, audioConfig?: any): void {
    this.client.setupStartAudioEvent(sessionId, audioConfig);
  }

  /**
   * Update orchestrator configuration (placeholder)
   */
  public updateOrchestratorConfig(config: any): void {
    // Placeholder for orchestrator configuration updates
    logger.debug('Orchestrator config update requested (not implemented)', { config });
  }

  /**
   * Get orchestrator configuration (placeholder)
   */
  public getOrchestratorConfig(): any {
    // Placeholder for orchestrator configuration retrieval
    return {};
  }

  /**
   * Get session data (delegates to underlying client for testing)
   */
  public getSessionData(sessionId: string): any {
    return this.client.getSessionData(sessionId);
  }

  /**
   * Get last activity time (delegates to underlying client)
   */
  public getLastActivityTime(sessionId: string): number {
    return this.client.getLastActivityTime(sessionId);
  }

  /**
   * Send session end (delegates to underlying client)
   */
  public sendSessionEnd(sessionId: string): void {
    this.client.sendSessionEnd(sessionId);
  }

  /**
   * Cleanup method (alias for shutdown)
   */
  public cleanup(): void {
    this.shutdown();
  }

  /**
   * Get the underlying client instance (for advanced usage)
   */
  public getUnderlyingClient(): NovaSonicBidirectionalStreamClient {
    return this.client;
  }
}

/**
 * Factory function to create a new Nova Sonic client
 */
export function createNovaSonicClient(config: NovaSonicClientConfig): NovaSonicClient {
  return new NovaSonicClient(config);
}

/**
 * Default export
 */
export default NovaSonicClient;