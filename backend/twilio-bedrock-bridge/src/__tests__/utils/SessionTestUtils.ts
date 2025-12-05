/**
 * Session Test Utilities
 * 
 * Consolidated utilities for session creation, management, and verification.
 * Provides reusable builders and helpers for testing session lifecycle.
 * 
 * Requirements: 5.2, 5.3
 */

import { UnifiedStreamSession, StreamClientInterface } from '../../session/UnifiedStreamSession';
import { SessionConfig } from '../../session/interfaces';
import { DefaultTextConfiguration, DefaultAudioInputConfiguration } from '../../utils/constants';

/**
 * Mock WebSocket interface for testing
 */
export interface MockWebSocket {
  readyState: number;
  twilioStreamSid?: string;
  _twilioOutSeq?: number;
  send: jest.Mock;
  on: jest.Mock;
  close?: jest.Mock;
  terminate?: jest.Mock;
}

/**
 * Session test configuration options
 */
export interface SessionTestOptions {
  sessionId?: string;
  maxQueueSize?: number;
  processingTimeout?: number;
  enableMetrics?: boolean;
  speaksFirst?: boolean;
  initialPrompt?: string;
  correlationId?: string;
}

export class SessionTestUtils {
  /**
   * Create a mock WebSocket for testing
   * 
   * @param overrides - Optional property overrides
   * @returns Mock WebSocket object
   */
  static createMockWebSocket(overrides?: Partial<MockWebSocket>): MockWebSocket {
    return {
      readyState: 1, // OPEN
      twilioStreamSid: 'test-stream-sid',
      _twilioOutSeq: 0,
      send: jest.fn(),
      on: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      ...overrides
    };
  }

  /**
   * Create a mock stream client for testing
   * 
   * @returns Mock StreamClientInterface
   */
  static createMockStreamClient(): StreamClientInterface {
    return {
      isSessionActive: jest.fn().mockReturnValue(true),
      registerEventHandler: jest.fn(),
      setupPromptStartEvent: jest.fn(),
      setupSystemPromptEvent: jest.fn(),
      setupStartAudioEvent: jest.fn(),
      streamAudioChunk: jest.fn().mockResolvedValue(undefined),
      sendContentEnd: jest.fn(),
      sendPromptEnd: jest.fn(),
      sendSessionEnd: jest.fn(),
      enableRealtimeInterruption: jest.fn(),
      handleUserInterruption: jest.fn(),
      setUserSpeakingState: jest.fn(),
      removeStreamSession: jest.fn(),
      streamAudioRealtime: jest.fn().mockResolvedValue(undefined),
    };
  }

  /**
   * Create a test session with default or custom configuration
   * 
   * @param client - Stream client interface
   * @param options - Session configuration options
   * @returns UnifiedStreamSession instance
   */
  static createTestSession(
    client: StreamClientInterface,
    options: SessionTestOptions = {}
  ): UnifiedStreamSession {
    const {
      sessionId = `test-session-${Date.now()}`,
      maxQueueSize = 100,
      processingTimeout = 30000,
      enableMetrics = true,
      speaksFirst = false,
      initialPrompt,
      correlationId = 'test-correlation-id'
    } = options;

    const config: SessionConfig = {
      sessionId,
      maxQueueSize,
      processingTimeout,
      enableMetrics,
      speaksFirst,
      initialPrompt,
      correlationContext: {
        correlationId,
        parentId: 'test-parent-id',
        traceId: 'test-trace-id'
      }
    };

    return new UnifiedStreamSession(config, client);
  }

  /**
   * Create a session builder for fluent configuration
   * 
   * @param client - Stream client interface
   * @returns Session builder
   */
  static sessionBuilder(client: StreamClientInterface) {
    const options: SessionTestOptions = {};

    return {
      withSessionId(id: string) {
        options.sessionId = id;
        return this;
      },
      withMaxQueueSize(size: number) {
        options.maxQueueSize = size;
        return this;
      },
      withProcessingTimeout(timeout: number) {
        options.processingTimeout = timeout;
        return this;
      },
      withMetrics(enabled: boolean) {
        options.enableMetrics = enabled;
        return this;
      },
      withSpeaksFirst(enabled: boolean, prompt?: string) {
        options.speaksFirst = enabled;
        options.initialPrompt = prompt;
        return this;
      },
      withCorrelationId(id: string) {
        options.correlationId = id;
        return this;
      },
      build(): UnifiedStreamSession {
        return SessionTestUtils.createTestSession(client, options);
      }
    };
  }

  /**
   * Setup a session with common event handlers
   * 
   * @param session - Session to setup
   * @param handlers - Event handlers to register
   */
  static setupSessionWithHandlers(
    session: UnifiedStreamSession,
    handlers: {
      onAudioOutput?: (data: unknown) => void;
      onSessionStart?: (data: unknown) => void;
      onContentEnd?: (data: unknown) => void;
      onError?: (data: unknown) => void;
    } = {}
  ): void {
    if (handlers.onAudioOutput) {
      session.onEvent('audioOutput', handlers.onAudioOutput);
    }
    if (handlers.onSessionStart) {
      session.onEvent('sessionStart', handlers.onSessionStart);
    }
    if (handlers.onContentEnd) {
      session.onEvent('contentEnd', handlers.onContentEnd);
    }
    if (handlers.onError) {
      session.onEvent('error', handlers.onError);
    }

    // Setup standard session events
    session.setupPromptStart();
    session.setupSystemPrompt(DefaultTextConfiguration, 'Test system prompt');
    session.setupStartAudio(DefaultAudioInputConfiguration);
  }

  /**
   * Verify session state matches expected values
   * 
   * @param session - Session to verify
   * @param expectedState - Expected state properties
   */
  static verifySessionState(
    session: UnifiedStreamSession,
    expectedState: {
      isActive?: boolean;
      sessionId?: string;
      hasErrors?: boolean;
      queueLength?: number;
      operationCount?: number;
    }
  ): void {
    if (expectedState.isActive !== undefined) {
      expect(session.isActive).toBe(expectedState.isActive);
    }

    if (expectedState.sessionId !== undefined) {
      expect(session.sessionId).toBe(expectedState.sessionId);
    }

    const stats = session.getStats();

    if (expectedState.hasErrors !== undefined) {
      const hasErrors = stats.errorCount > 0;
      expect(hasErrors).toBe(expectedState.hasErrors);
    }

    if (expectedState.queueLength !== undefined) {
      const queueStats = session.getAudioQueueStats();
      expect(queueStats.queueLength).toBe(expectedState.queueLength);
    }

    if (expectedState.operationCount !== undefined) {
      expect(stats.operationCount).toBeGreaterThanOrEqual(expectedState.operationCount);
    }
  }

  /**
   * Verify session cleanup was successful
   * 
   * @param session - Session to verify
   * @param client - Mock client to check cleanup calls
   */
  static verifySessionCleanup(
    session: UnifiedStreamSession,
    client: StreamClientInterface
  ): void {
    // Verify session is inactive
    expect(session.isActive).toBe(false);

    // Verify cleanup was called on client
    expect(client.sendSessionEnd).toHaveBeenCalledWith(session.sessionId);

    // Verify session resources are released
    const stats = session.getStats();
    const queueStats = session.getAudioQueueStats();
    
    // Queue should be empty or processing should be stopped
    expect(queueStats.isProcessing).toBe(false);
  }

  /**
   * Wait for session to reach a specific state
   * 
   * @param session - Session to monitor
   * @param condition - Condition function to check
   * @param timeout - Maximum wait time in ms
   * @returns Promise that resolves when condition is met
   */
  static async waitForSessionState(
    session: UnifiedStreamSession,
    condition: (session: UnifiedStreamSession) => boolean,
    timeout: number = 5000
  ): Promise<void> {
    const startTime = Date.now();

    while (!condition(session)) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for session state');
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Create multiple test sessions for concurrent testing
   * 
   * @param client - Stream client interface
   * @param count - Number of sessions to create
   * @param options - Base options for all sessions
   * @returns Array of sessions
   */
  static createMultipleSessions(
    client: StreamClientInterface,
    count: number,
    options: SessionTestOptions = {}
  ): UnifiedStreamSession[] {
    const sessions: UnifiedStreamSession[] = [];

    for (let i = 0; i < count; i++) {
      const sessionOptions = {
        ...options,
        sessionId: `test-session-${i}-${Date.now()}`
      };
      sessions.push(this.createTestSession(client, sessionOptions));
    }

    return sessions;
  }

  /**
   * Verify sessions are independent (no shared state)
   * 
   * @param sessions - Sessions to verify
   */
  static verifySessionIndependence(sessions: UnifiedStreamSession[]): void {
    // Verify all sessions have unique IDs
    const sessionIds = sessions.map(s => s.sessionId);
    const uniqueIds = new Set(sessionIds);
    expect(uniqueIds.size).toBe(sessions.length);

    // Verify sessions have independent state
    for (let i = 0; i < sessions.length; i++) {
      for (let j = i + 1; j < sessions.length; j++) {
        expect(sessions[i]).not.toBe(sessions[j]);
        expect(sessions[i].sessionId).not.toBe(sessions[j].sessionId);
      }
    }
  }

  /**
   * Simulate session activity for testing
   * 
   * @param session - Session to simulate activity on
   * @param operations - Number of operations to simulate
   */
  static async simulateSessionActivity(
    session: UnifiedStreamSession,
    operations: number = 5
  ): Promise<void> {
    for (let i = 0; i < operations; i++) {
      session.updateActivity();
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Get session diagnostics summary for assertions
   * 
   * @param session - Session to get diagnostics from
   * @returns Simplified diagnostics object
   */
  static getSessionDiagnosticsSummary(session: UnifiedStreamSession): {
    isActive: boolean;
    sessionId: string;
    operationCount: number;
    errorCount: number;
    memoryUsage: number;
    duration: number;
  } {
    const stats = session.getStats();
    
    return {
      isActive: session.isActive,
      sessionId: session.sessionId,
      operationCount: stats.operationCount,
      errorCount: stats.errorCount,
      memoryUsage: stats.memoryUsage,
      duration: stats.duration
    };
  }

  /**
   * Create a session with speaks-first configuration
   * 
   * @param client - Stream client interface
   * @param initialPrompt - Initial greeting prompt
   * @returns Configured session
   */
  static createSpeaksFirstSession(
    client: StreamClientInterface,
    initialPrompt: string = 'Hello! How can I help you today?'
  ): UnifiedStreamSession {
    return this.createTestSession(client, {
      speaksFirst: true,
      initialPrompt
    });
  }

  /**
   * Verify session configuration matches expected values
   * 
   * @param session - Session to verify
   * @param expectedConfig - Expected configuration
   */
  static verifySessionConfig(
    session: UnifiedStreamSession,
    expectedConfig: Partial<SessionConfig>
  ): void {
    const config = session.getConfig();

    if (expectedConfig.maxQueueSize !== undefined) {
      expect(config.maxQueueSize).toBe(expectedConfig.maxQueueSize);
    }

    if (expectedConfig.processingTimeout !== undefined) {
      expect(config.processingTimeout).toBe(expectedConfig.processingTimeout);
    }

    if (expectedConfig.enableMetrics !== undefined) {
      expect(config.enableMetrics).toBe(expectedConfig.enableMetrics);
    }

    if (expectedConfig.speaksFirst !== undefined) {
      expect(config.speaksFirst).toBe(expectedConfig.speaksFirst);
    }

    if (expectedConfig.initialPrompt !== undefined) {
      expect(config.initialPrompt).toBe(expectedConfig.initialPrompt);
    }
  }
}
