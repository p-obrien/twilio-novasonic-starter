/**
 * Coordinator class for dispatching Twilio messages to appropriate handlers.
 *
 * This class implements the Handler Pattern by:
 * 1. Maintaining a registry of message type → handler mappings
 * 2. Dispatching incoming messages to the correct handler based on event type
 * 3. Providing consistent error handling across all handlers
 * 4. Managing handler lifecycle (initialization and cleanup)
 *
 * Benefits:
 * - Each message type has a dedicated, testable handler class
 * - Handler logic is separated from dispatch logic
 * - Easy to add new message types without modifying existing code
 * - Named functions in stack traces for better debugging
 */

import logger from '../observability/logger';
import { extractErrorDetails } from '../errors/ClientErrors';
import { TwilioMessage, TwilioBaseMessage } from './types/TwilioMessages';
import { MessageHandlerContext, BaseMessageHandler } from './handlers/BaseMessageHandler';
import { StartMessageHandler } from './handlers/StartMessageHandler';
import { MediaMessageHandler } from './handlers/MediaMessageHandler';
import { StopMessageHandler } from './handlers/StopMessageHandler';
import { ConnectedMessageHandler } from './handlers/ConnectedMessageHandler';
import { MarkMessageHandler } from './handlers/MarkMessageHandler';
import { DtmfMessageHandler } from './handlers/DtmfMessageHandler';

/**
 * Main message handler coordinator.
 *
 * Dispatches Twilio WebSocket messages to appropriate handler classes.
 */
export class TwilioMessageHandler {
  /** Registry of event type → handler mappings */
  private readonly handlers: Map<string, BaseMessageHandler<TwilioBaseMessage>>;

  /** Handler instances for lifecycle management */
  private readonly startHandler: StartMessageHandler;
  private readonly mediaHandler: MediaMessageHandler;
  private readonly stopHandler: StopMessageHandler;
  private readonly connectedHandler: ConnectedMessageHandler;
  private readonly markHandler: MarkMessageHandler;
  private readonly dtmfHandler: DtmfMessageHandler;

  /**
   * Create a new TwilioMessageHandler.
   *
   * Initializes all handler instances and registers them in the handler map.
   *
   * @param context - Shared context for all message handlers
   */
  constructor(private readonly context: MessageHandlerContext) {
    // Initialize all handlers
    this.startHandler = new StartMessageHandler(context);
    this.mediaHandler = new MediaMessageHandler(context);
    this.stopHandler = new StopMessageHandler(context);
    this.connectedHandler = new ConnectedMessageHandler(context);
    this.markHandler = new MarkMessageHandler(context);
    this.dtmfHandler = new DtmfMessageHandler(context);

    // Register handlers in the dispatch map
    this.handlers = new Map<string, BaseMessageHandler<TwilioBaseMessage>>([
      ['connected', this.connectedHandler],
      ['start', this.startHandler],
      ['media', this.mediaHandler],
      ['stop', this.stopHandler],
      ['mark', this.markHandler],
      ['dtmf', this.dtmfHandler]
    ]);
  }

  /**
   * Dispatch a Twilio message to the appropriate handler.
   *
   * This is the main entry point for message processing. It:
   * 1. Looks up the handler for the message event type
   * 2. Calls the handler's handle() method
   * 3. Provides consistent error handling and logging
   *
   * @param message - The Twilio message to dispatch
   */
  async dispatch(message: TwilioMessage): Promise<void> {
    const handler = this.handlers.get(message.event);

    if (!handler) {
      logger.debug('Unknown Twilio event', {
        event: message.event,
        sessionId: this.context.sessionId,
        correlationId: this.context.correlationContext.correlationId
      });
      return;
    }

    try {
      await handler.handle(message);
    } catch (error) {
      logger.error('Handler execution failed', {
        event: message.event,
        sessionId: this.context.sessionId,
        correlationId: this.context.correlationContext.correlationId,
        callSid: this.context.ws.callSid,
        error: extractErrorDetails(error)
      });
      throw error;
    }
  }

  /**
   * Get the media handler instance.
   *
   * This is exposed for synchronizing turn state between handlers.
   *
   * @returns The media message handler
   */
  getMediaHandler(): MediaMessageHandler {
    return this.mediaHandler;
  }

  /**
   * Get the stop handler instance.
   *
   * @returns The stop message handler
   */
  getStopHandler(): StopMessageHandler {
    return this.stopHandler;
  }

  /**
   * Cleanup all handlers.
   *
   * This should be called when the session is ending to ensure proper cleanup
   * of timers, buffers, and other resources.
   */
  cleanup(): void {
    // Cleanup handlers that maintain state
    this.mediaHandler.cleanup();
    this.stopHandler.cleanup();

    logger.debug('Message handlers cleaned up', {
      sessionId: this.context.sessionId,
      correlationId: this.context.correlationContext.correlationId
    });
  }
}
