/**
 * Base message handler infrastructure for Twilio WebSocket message processing.
 *
 * Provides common functionality and context for all message handlers, including:
 * - Structured logging with correlation context
 * - Consistent error handling
 * - Access to shared resources (WebSocket, Bedrock client, etc.)
 */

import { ExtendedWebSocket } from '../../types/SharedTypes';
import { NovaSonicBidirectionalStreamClient } from '../../client';
import { CorrelationContext } from '../../utils/correlationId';
import logger from '../../observability/logger';
import { TwilioBaseMessage } from '../types/TwilioMessages';

/**
 * Context object passed to all message handlers.
 * Contains all shared resources and state needed for message processing.
 */
export interface MessageHandlerContext {
  /** The WebSocket connection for this session */
  ws: ExtendedWebSocket;
  /** Unique session identifier */
  sessionId: string;
  /** Bedrock client for streaming operations */
  bedrockClient: NovaSonicBidirectionalStreamClient;
  /** Correlation context for distributed tracing */
  correlationContext: CorrelationContext;
}

/**
 * Abstract base class for all Twilio message handlers.
 *
 * Provides common functionality including:
 * - Access to handler context
 * - Structured logging with correlation context
 * - Type-safe message handling interface
 *
 * @template T - The specific Twilio message type this handler processes
 */
export abstract class BaseMessageHandler<T extends TwilioBaseMessage> {
  /**
   * Creates a new message handler.
   * @param context - Shared context for message processing
   */
  constructor(protected readonly context: MessageHandlerContext) {}

  /**
   * Handle a Twilio message of the specific type.
   * Each subclass must implement this method with handler-specific logic.
   *
   * @param message - The Twilio message to process
   */
  abstract handle(message: T): Promise<void>;

  /**
   * Optional cleanup method called when handler is no longer needed.
   * Override this in handlers that maintain state (timers, buffers, etc.).
   */
  cleanup(): void {
    // Default: no cleanup needed
  }

  /**
   * Helper method for structured logging with automatic correlation context.
   *
   * @param level - Log level ('debug', 'info', 'warn', 'error')
   * @param message - Log message
   * @param metadata - Additional metadata to include in log
   */
  protected log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    metadata?: Record<string, unknown>
  ): void {
    logger[level](message, {
      sessionId: this.context.sessionId,
      correlationId: this.context.correlationContext.correlationId,
      callSid: this.context.ws.callSid,
      ...metadata
    });
  }

  /**
   * Get the current session ID.
   */
  protected get sessionId(): string {
    return this.context.sessionId;
  }

  /**
   * Get the WebSocket connection.
   */
  protected get ws(): ExtendedWebSocket {
    return this.context.ws;
  }

  /**
   * Get the Bedrock client.
   */
  protected get bedrockClient(): NovaSonicBidirectionalStreamClient {
    return this.context.bedrockClient;
  }

  /**
   * Check if Bedrock session is active.
   */
  protected isSessionActive(): boolean {
    return this.bedrockClient.isSessionActive(this.sessionId);
  }
}
