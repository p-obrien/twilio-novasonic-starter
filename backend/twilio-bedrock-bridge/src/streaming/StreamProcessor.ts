/**
 * @fileoverview Stream Processing for Bedrock Responses
 * 
 * Handles processing of bidirectional stream responses from AWS Bedrock
 */

import { InvokeModelWithBidirectionalStreamInput } from "@aws-sdk/client-bedrock-runtime";
import { firstValueFrom } from 'rxjs';
import { take, filter } from 'rxjs/operators';
import { inspect } from 'util';
import logger from '../observability/logger';
import { SessionData } from '../session/SessionManager';
import { EventDispatcher } from '../events/EventDispatcher';

export class StreamProcessor {
  constructor(private eventDispatcher: EventDispatcher) {}

  /**
   * Creates an async iterable for session events
   */
  createSessionAsyncIterable(sessionId: string, session: SessionData): AsyncIterable<InvokeModelWithBidirectionalStreamInput> {
    if (!session.isActive) {
      logger.warn(`Cannot create async iterable: Session ${sessionId} not active`);
      return this.createEmptyIterable();
    }

    let eventCount = 0;

    return {
      [Symbol.asyncIterator]: () => {
        logger.debug(`AsyncIterable iterator requested for session ${sessionId}`);

        return {
          next: async (): Promise<IteratorResult<InvokeModelWithBidirectionalStreamInput>> => {
            return this.processNextEvent(sessionId, session, eventCount++);
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
        };
      }
    };
  }

  /**
   * Processes the next event in the session queue
   */
  private async processNextEvent(
    sessionId: string, 
    session: SessionData, 
    eventCount: number
  ): Promise<IteratorResult<InvokeModelWithBidirectionalStreamInput>> {
    try {
      // Check if session is still active
      if (!session.isActive) {
        logger.debug(`Iterator closing for session ${sessionId}, done = true`);
        return { value: undefined, done: true };
      }

      // Wait for events or close signal
      await this.waitForEventsOrClose(sessionId, session);

      // Handle empty queue scenarios
      if (session.queue.length === 0) {
        return this.handleEmptyQueue(sessionId, session);
      }

      // Process next event from queue
      const nextEvent = session.queue.shift();
      this.logEventIfNeeded(sessionId, eventCount, nextEvent);

      // Safely serialize the event with proper error handling
      let serializedEvent: string;
      try {
        serializedEvent = JSON.stringify(nextEvent);
      } catch (jsonError) {
        logger.error(`JSON serialization failed for session ${sessionId}:`, {
          error: jsonError,
          eventType: nextEvent?.event ? Object.keys(nextEvent.event)[0] : 'unknown',
          nextEvent: this.sanitizeEventForLogging(nextEvent)
        });
        
        // Create a safe fallback event
        serializedEvent = JSON.stringify({
          event: {
            error: {
              message: 'Event serialization failed',
              originalEventType: nextEvent?.event ? Object.keys(nextEvent.event)[0] : 'unknown'
            }
          }
        });
      }

      return {
        value: {
          chunk: {
            bytes: new TextEncoder().encode(serializedEvent)
          }
        },
        done: false
      };

    } catch (error) {
      logger.error(`Error in session ${sessionId} iterator:`, error);
      session.isActive = false;
      return { value: undefined, done: true };
    }
  }

  /**
   * Waits for events in queue or close signal
   */
  private async waitForEventsOrClose(sessionId: string, session: SessionData): Promise<void> {
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
          logger.debug('Session closed during wait', { sessionId });
          return;
        }
        logger.error(`Error waiting for events: ${sessionId}`, error);
      }
    }
  }

  /**
   * Handles scenarios when the event queue is empty
   */
  private handleEmptyQueue(sessionId: string, session: SessionData): IteratorResult<InvokeModelWithBidirectionalStreamInput> {
    logger.info(`Queue empty for session ${sessionId}, isActive=${session.isActive}, isWaitingForResponse=${session.isWaitingForResponse}`);
    
    if (!session.isActive) {
      logger.debug(`Session inactive, closing iterator: ${sessionId}`);
      return { value: undefined, done: true };
    }

    if (session.isWaitingForResponse) {
      logger.info(`Queue empty but waiting for response: ${sessionId}`);
      // In a real implementation, you might want to wait for the close signal here
    }

    return { value: undefined, done: true };
  }

  /**
   * Logs events selectively to avoid noise from audio events
   */
  private logEventIfNeeded(sessionId: string, eventCount: number, event: any): void {
    try {
      const eventKey = event?.event && Object.keys(event.event)[0];
      const isAudioEvent = eventKey === 'audioInput' || 
        (eventKey === 'contentStart' && event.event.contentStart?.type === 'AUDIO');

      if (!isAudioEvent) {
        const sanitized = this.sanitizeEventForLogging(event);
        logger.debug(`Sending event #${eventCount} for session ${sessionId}:`, sanitized);
      } else {
        logger.trace('session.event.suppressed.send', { sessionId, eventCount, eventType: eventKey });
      }
    } catch (sanErr) {
      logger.debug(`Sending event #${eventCount} for session ${sessionId} (sanitization failed)`);
    }
  }

  /**
   * Sanitizes event data for logging by removing large content
   */
  private sanitizeEventForLogging(event: any): any {
    return this.safeJsonSerialize(event, (k: string, v: any) => {
      if (k === 'content' && typeof v === 'string' && v.length > 200) {
        return `[${v.length} bytes removed]`;
      }
      return v;
    });
  }

  /**
   * Safely serialize objects by handling circular references and non-serializable values
   */
  private safeJsonSerialize(obj: any, replacer?: (key: string, value: any) => any): any {
    const seen = new WeakSet();
    
    try {
      return JSON.parse(JSON.stringify(obj, (key: string, value: any) => {
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        
        // Handle functions and undefined values
        if (typeof value === 'function') {
          return '[Function]';
        }
        if (value === undefined) {
          return '[Undefined]';
        }
        
        // Apply custom replacer if provided
        if (replacer) {
          return replacer(key, value);
        }
        
        return value;
      }));
    } catch (error) {
      logger.warn('Failed to safely serialize object:', error);
      return { error: 'Serialization failed', type: typeof obj };
    }
  }

  /**
   * Creates an empty async iterable for inactive sessions
   */
  private createEmptyIterable(): AsyncIterable<InvokeModelWithBidirectionalStreamInput> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ value: undefined, done: true })
      })
    };
  }

  /**
   * Processes response stream from AWS Bedrock
   */
  async processResponseStream(sessionId: string, session: SessionData, response: any): Promise<void> {
    try {
      logger.info(`Starting to iterate over response.body for session ${sessionId}`);
      let eventCount = 0;
      let hasAnyEvents = false;
      
      for await (const event of response.body) {
        hasAnyEvents = true;
        eventCount++;
        
        if (!session.isActive) {
          logger.info(`Session ${sessionId} is no longer active, stopping response processing`);
          break;
        }

        await this.processResponseEvent(sessionId, session, event, eventCount);
      }

      if (!hasAnyEvents) {
        logger.error(`NO EVENTS RECEIVED FROM BEDROCK for session ${sessionId} - Stream was empty!`);
      }

      logger.info(`Response stream processing complete for session ${sessionId} after ${eventCount} events`);
      this.eventDispatcher.dispatchEvent(sessionId, session, 'streamComplete', {
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      this.handleResponseStreamError(sessionId, session, error);
    }
  }

  /**
   * Processes individual response events
   */
  private async processResponseEvent(sessionId: string, session: SessionData, event: any, eventCount: number): Promise<void> {
    logger.info(`Processing response event #${eventCount} for session ${sessionId}`);
    
    if (event.chunk?.bytes) {
      await this.processChunkEvent(sessionId, session, event);
    } else if (event.modelStreamErrorException) {
      this.handleModelStreamError(sessionId, session, event);
    } else if (event.internalServerException) {
      this.handleInternalServerError(sessionId, session, event);
    } else if (event.validationException) {
      this.handleValidationError(sessionId, session, event);
    } else {
      logger.info(`Unknown event type for session ${sessionId}:`, Object.keys(event));
    }
  }

  /**
   * Processes chunk events containing actual data
   */
  private async processChunkEvent(sessionId: string, session: SessionData, event: any): Promise<void> {
    try {
      const textResponse = new TextDecoder().decode(event.chunk.bytes);
      const jsonResponse = JSON.parse(textResponse);
      const evt = jsonResponse.event || {};
      
      logger.debug(`Raw response for session ${sessionId}:`, JSON.stringify(jsonResponse, null, 2));

      // Dispatch different event types
      this.dispatchEventByType(sessionId, session, evt);

    } catch (e) {
      logger.error(`Error processing response chunk for session ${sessionId}:`, e);
    }
  }

  /**
   * Dispatches events based on their type
   */
  private dispatchEventByType(sessionId: string, session: SessionData, evt: any): void {
    if (evt.contentStart) {
      this.eventDispatcher.dispatchEvent(sessionId, session, 'contentStart', evt.contentStart);
    } else if (evt.textOutput) {
      this.eventDispatcher.dispatchEvent(sessionId, session, 'textOutput', evt.textOutput);
    } else if (evt.audioOutput) {
      this.eventDispatcher.dispatchEvent(sessionId, session, 'audioOutput', evt.audioOutput);
    } else if (evt.usageEvent) {
      logger.debug('Usage event from Nova Sonic', {
        sessionId,
        usageEvent: evt.usageEvent
      });
      this.eventDispatcher.dispatchEvent(sessionId, session, 'usageEvent', evt.usageEvent);
    } else if (evt.completionStart) {
      session.isWaitingForResponse = false;
      this.eventDispatcher.dispatchEvent(sessionId, session, 'completionStart', evt.completionStart);
    } else if (evt.completionEnd) {
      this.eventDispatcher.dispatchEvent(sessionId, session, 'completionEnd', evt.completionEnd);
    } else if (evt.contentEnd) {
      this.eventDispatcher.dispatchEvent(sessionId, session, 'contentEnd', evt.contentEnd);
    } else {
      this.handleUnknownEvent(sessionId, session, evt);
    }
  }

  /**
   * Handles unknown event types
   */
  private handleUnknownEvent(sessionId: string, session: SessionData, evt: any): void {
    const eventKeys = Object.keys(evt || {});
    if (eventKeys.length > 0) {
      this.eventDispatcher.dispatchEvent(sessionId, session, eventKeys[0], evt);
    }
  }

  /**
   * Handles model stream errors
   */
  private handleModelStreamError(sessionId: string, session: SessionData, event: any): void {
    logger.error(`Model stream error for session ${sessionId}:`, event.modelStreamErrorException);
    this.eventDispatcher.dispatchEvent(sessionId, session, 'error', {
      type: 'modelStreamErrorException',
      details: event.modelStreamErrorException
    });
  }

  /**
   * Handles internal server errors
   */
  private handleInternalServerError(sessionId: string, session: SessionData, event: any): void {
    logger.error(`Internal server error for session ${sessionId}:`, event.internalServerException);
    this.eventDispatcher.dispatchEvent(sessionId, session, 'error', {
      type: 'internalServerException',
      details: event.internalServerException
    });
  }

  /**
   * Handles validation errors
   */
  private handleValidationError(sessionId: string, session: SessionData, event: any): void {
    logger.error(`Validation error for session ${sessionId}:`, event.validationException);
    this.eventDispatcher.dispatchEvent(sessionId, session, 'error', {
      type: 'validationException',
      details: event.validationException
    });
  }

  /**
   * Handles response stream processing errors
   */
  private handleResponseStreamError(sessionId: string, session: SessionData, error: any): void {
    logger.error(`Error processing response stream for session ${sessionId}:`, {
      name: (error as any)?.name ?? null,
      message: error instanceof Error ? error.message : String(error),
      code: (error as any)?.code ?? null,
      fault: (error as any)?.$fault ?? null,
      metadata: (error as any)?.$metadata ?? null,
      inspected: inspect(error, { depth: null })
    });

    this.eventDispatcher.dispatchEvent(sessionId, session, 'error', {
      source: 'responseStream',
      message: 'Error processing response stream',
      details: error instanceof Error ? error.message : String(error),
      rawError: error
    });
  }
}