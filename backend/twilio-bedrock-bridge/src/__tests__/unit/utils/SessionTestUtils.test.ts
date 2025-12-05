/**
 * Unit tests for SessionTestUtils
 * 
 * Verifies that session test utilities work correctly for creating
 * and managing test sessions.
 */

import { SessionTestUtils } from '../../utils/SessionTestUtils';
import { StreamClientInterface } from '../../../session/UnifiedStreamSession';

describe('SessionTestUtils', () => {
  let mockClient: StreamClientInterface;

  beforeEach(() => {
    mockClient = SessionTestUtils.createMockStreamClient();
  });

  describe('Mock Creation', () => {
    it('should create mock WebSocket', () => {
      const ws = SessionTestUtils.createMockWebSocket();
      
      expect(ws.readyState).toBe(1);
      expect(ws.twilioStreamSid).toBe('test-stream-sid');
      expect(ws.send).toBeDefined();
      expect(ws.on).toBeDefined();
    });

    it('should create mock WebSocket with overrides', () => {
      const ws = SessionTestUtils.createMockWebSocket({
        readyState: 3,
        twilioStreamSid: 'custom-sid'
      });
      
      expect(ws.readyState).toBe(3);
      expect(ws.twilioStreamSid).toBe('custom-sid');
    });

    it('should create mock stream client', () => {
      const client = SessionTestUtils.createMockStreamClient();
      
      expect(client.isSessionActive).toBeDefined();
      expect(client.registerEventHandler).toBeDefined();
      expect(client.streamAudioChunk).toBeDefined();
    });
  });

  describe('Session Creation', () => {
    it('should create test session with defaults', () => {
      const session = SessionTestUtils.createTestSession(mockClient);
      
      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.isActive).toBe(true);
    });

    it('should create test session with custom options', () => {
      const session = SessionTestUtils.createTestSession(mockClient, {
        sessionId: 'custom-session-id',
        maxQueueSize: 200,
        processingTimeout: 60000
      });
      
      expect(session.sessionId).toBe('custom-session-id');
      
      const config = session.getConfig();
      expect(config.maxQueueSize).toBe(200);
      expect(config.processingTimeout).toBe(60000);
    });

    it('should create speaks-first session', () => {
      const session = SessionTestUtils.createSpeaksFirstSession(
        mockClient,
        'Hello! How can I help?'
      );
      
      expect(session).toBeDefined();
      
      const config = session.getConfig();
      expect(config.speaksFirst).toBe(true);
      expect(config.initialPrompt).toBe('Hello! How can I help?');
    });
  });

  describe('Session Builder', () => {
    it('should build session with fluent API', () => {
      const session = SessionTestUtils.sessionBuilder(mockClient)
        .withSessionId('builder-session')
        .withMaxQueueSize(150)
        .withMetrics(true)
        .build();
      
      expect(session.sessionId).toBe('builder-session');
      
      const config = session.getConfig();
      expect(config.maxQueueSize).toBe(150);
      expect(config.enableMetrics).toBe(true);
    });

    it('should build speaks-first session', () => {
      const session = SessionTestUtils.sessionBuilder(mockClient)
        .withSpeaksFirst(true, 'Greeting')
        .build();
      
      const config = session.getConfig();
      expect(config.speaksFirst).toBe(true);
      expect(config.initialPrompt).toBe('Greeting');
    });
  });

  describe('Session State Verification', () => {
    it('should verify session is active', () => {
      const session = SessionTestUtils.createTestSession(mockClient);
      
      SessionTestUtils.verifySessionState(session, {
        isActive: true
      });
    });

    it('should verify session ID', () => {
      const session = SessionTestUtils.createTestSession(mockClient, {
        sessionId: 'verify-test'
      });
      
      SessionTestUtils.verifySessionState(session, {
        sessionId: 'verify-test'
      });
    });

    it('should verify no errors initially', () => {
      const session = SessionTestUtils.createTestSession(mockClient);
      
      SessionTestUtils.verifySessionState(session, {
        hasErrors: false
      });
    });
  });

  describe('Session Configuration Verification', () => {
    it('should verify session configuration', () => {
      const session = SessionTestUtils.createTestSession(mockClient, {
        maxQueueSize: 150,
        processingTimeout: 45000,
        enableMetrics: false
      });
      
      SessionTestUtils.verifySessionConfig(session, {
        maxQueueSize: 150,
        processingTimeout: 45000,
        enableMetrics: false
      });
    });

    it('should verify speaks-first configuration', () => {
      const session = SessionTestUtils.createSpeaksFirstSession(mockClient, 'Test prompt');
      
      SessionTestUtils.verifySessionConfig(session, {
        speaksFirst: true,
        initialPrompt: 'Test prompt'
      });
    });
  });

  describe('Multiple Sessions', () => {
    it('should create multiple sessions', () => {
      const sessions = SessionTestUtils.createMultipleSessions(mockClient, 3);
      
      expect(sessions).toHaveLength(3);
      sessions.forEach(session => {
        expect(session.isActive).toBe(true);
      });
    });

    it('should verify session independence', () => {
      const sessions = SessionTestUtils.createMultipleSessions(mockClient, 3);
      
      SessionTestUtils.verifySessionIndependence(sessions);
    });

    it('should create sessions with custom options', () => {
      const sessions = SessionTestUtils.createMultipleSessions(mockClient, 2, {
        maxQueueSize: 200
      });
      
      sessions.forEach(session => {
        const config = session.getConfig();
        expect(config.maxQueueSize).toBe(200);
      });
    });
  });

  describe('Session Diagnostics', () => {
    it('should get diagnostics summary', () => {
      const session = SessionTestUtils.createTestSession(mockClient);
      
      const summary = SessionTestUtils.getSessionDiagnosticsSummary(session);
      
      expect(summary.isActive).toBe(true);
      expect(summary.sessionId).toBeDefined();
      expect(summary.operationCount).toBeGreaterThanOrEqual(0);
      expect(summary.errorCount).toBe(0);
      expect(summary.memoryUsage).toBeGreaterThanOrEqual(0);
      expect(summary.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Session Cleanup', () => {
    it('should verify cleanup', async () => {
      const session = SessionTestUtils.createTestSession(mockClient);
      
      await session.close();
      
      SessionTestUtils.verifySessionCleanup(session, mockClient);
    });
  });
});
