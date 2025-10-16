/**
 * @fileoverview Event Dispatching System
 * 
 * Handles event normalization, dispatching, and handler management
 */

import logger from '../observability/logger';
import { SessionData } from '../session/SessionManager';
import { isObject } from '../types/TypeGuards';

/**
 * Event data structure for normalized events
 */
export interface NormalizedEventData {
  contentId?: string;
  contentName?: string;
  additionalModelFields?: string;
  parsedAdditionalModelFields?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Event handler function type
 */
export type EventHandler<T = unknown> = (data: T) => void;

/**
 * Generic event handler that receives event type and data
 */
export type GenericEventHandler = (event: { type: string; data: unknown }) => void;

export class EventDispatcher {
  /**
   * Normalizes event data for consistent handling
   * - Ensures both contentId and contentName are populated
   * - Attempts to parse additionalModelFields into parsedAdditionalModelFields
   */
  normalizeEventData(obj: unknown): NormalizedEventData {
    if (!isObject(obj)) return obj as NormalizedEventData;
    
    try {
      const id = obj.contentId ?? obj.contentName;
      if (id) {
        obj.contentId = id;
        obj.contentName = id;
      }
      
      if (typeof obj.additionalModelFields === 'string' && !obj.parsedAdditionalModelFields) {
        try { 
          obj.parsedAdditionalModelFields = JSON.parse(obj.additionalModelFields); 
        } catch { 
          // Ignore parsing errors for additionalModelFields
        }
      }
    } catch (e) {
      // Non-fatal normalization error, continue processing
      logger.debug('Event normalization error:', e);
    }
    
    return obj;
  }

  /**
   * Dispatches events to registered handlers for a specific session
   */
  dispatchEvent(sessionId: string, session: SessionData, eventType: string, data: unknown): void {
    if (!session) {
      logger.warn(`Cannot dispatch event ${eventType}: session ${sessionId} not found`);
      return;
    }

    const normalizedData = this.normalizeEventData(data);

    // Publish to responseSubject for internal observers
    this.publishToResponseSubject(sessionId, session, eventType, normalizedData);

    // Dispatch to specific event handlers
    this.dispatchToEventHandlers(sessionId, session, eventType, normalizedData);

    // Dispatch to generic 'any' handlers
    this.dispatchToAnyHandlers(sessionId, session, eventType, normalizedData);
  }

  /**
   * Publishes event to the session's response subject
   */
  private publishToResponseSubject(sessionId: string, session: SessionData, eventType: string, data: NormalizedEventData): void {
    try {
      if (session.responseSubject && typeof session.responseSubject.next === 'function') {
        session.responseSubject.next({ type: eventType, data });
      }
    } catch (e) {
      logger.debug(`Failed to publish to responseSubject for session ${sessionId}:`, e);
    }
  }

  /**
   * Dispatches to specific event type handlers
   */
  private dispatchToEventHandlers(sessionId: string, session: SessionData, eventType: string, data: NormalizedEventData): void {
    const handler = session.responseHandlers.get(eventType);
    if (handler) {
      try {
        handler(data);
      } catch (e) {
        logger.error(`Error in ${eventType} handler for session ${sessionId}:`, e);
      }
    }
  }

  /**
   * Dispatches to generic 'any' event handlers
   */
  private dispatchToAnyHandlers(sessionId: string, session: SessionData, eventType: string, data: NormalizedEventData): void {
    const anyHandler = session.responseHandlers.get('any');
    if (anyHandler) {
      try {
        anyHandler({ type: eventType, data });
      } catch (e) {
        logger.error(`Error in 'any' handler for session ${sessionId}:`, e);
      }
    }
  }

  /**
   * Registers an event handler for a session
   */
  registerEventHandler<T = unknown>(session: SessionData, eventType: string, handler: EventHandler<T>): void {
    session.responseHandlers.set(eventType, handler as EventHandler<unknown>);
  }

  /**
   * Registers a generic event handler that receives all events with their types
   */
  registerGenericEventHandler(session: SessionData, handler: GenericEventHandler): void {
    session.responseHandlers.set('any', handler as EventHandler<unknown>);
  }
}