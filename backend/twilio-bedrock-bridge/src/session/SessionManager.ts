/**
 * @fileoverview Session Management for Bedrock Streaming
 * 
 * Handles session lifecycle, cleanup, and state management
 */

import { randomUUID } from "node:crypto";
import { Subject } from 'rxjs';
import { InferenceConfig } from "../types/SharedTypes";
import logger from '../utils/logger';

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

export class SessionManager {
  private activeSessions = new Map<string, SessionData>();
  private sessionLastActivity = new Map<string, number>();
  private sessionCleanupInProgress = new Set<string>();

  /**
   * Creates a new session with default configuration
   */
  createSession(sessionId: string, inferenceConfig: InferenceConfig): SessionData {
    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const session: SessionData = {
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

    this.activeSessions.set(sessionId, session);
    this.updateSessionActivity(sessionId);
    
    logger.info(`Session ${sessionId} created`);
    return session;
  }

  /**
   * Retrieves session data by ID
   */
  getSession(sessionId: string): SessionData | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Checks if session is active
   */
  isSessionActive(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    return !!session && session.isActive;
  }

  /**
   * Gets all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.entries())
      .filter(([_, session]) => session.isActive)
      .map(([sessionId, _]) => sessionId);
  }

  /**
   * Updates session activity timestamp
   */
  updateSessionActivity(sessionId: string): void {
    this.sessionLastActivity.set(sessionId, Date.now());
  }

  /**
   * Gets last activity time for session
   */
  getLastActivityTime(sessionId: string): number {
    return this.sessionLastActivity.get(sessionId) || 0;
  }

  /**
   * Marks session for cleanup
   */
  markForCleanup(sessionId: string): void {
    this.sessionCleanupInProgress.add(sessionId);
  }

  /**
   * Checks if cleanup is in progress
   */
  isCleanupInProgress(sessionId: string): boolean {
    return this.sessionCleanupInProgress.has(sessionId);
  }

  /**
   * Removes session and cleans up resources
   */
  removeSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.isActive = false;
      session.queueSignal.complete();
      session.closeSignal.complete();
      session.responseSubject.complete();
    }

    this.activeSessions.delete(sessionId);
    this.sessionLastActivity.delete(sessionId);
    this.sessionCleanupInProgress.delete(sessionId);
    
    logger.info(`Session ${sessionId} removed`);
  }
}