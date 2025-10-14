/**
 * Tests for NovaSonicBidirectionalStreamClient
 */

import { NovaSonicClient as NovaSonicBidirectionalStreamClient } from '../client/';
import { StreamSession } from '../session/StreamSession';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { Subject } from 'rxjs';

// Mock dependencies
jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('@smithy/node-http-handler');
jest.mock('../utils/logger');
jest.mock('../observability/bedrockObservability', () => ({
  bedrockObservability: {
    startSession: jest.fn(),
    recordError: jest.fn(),
    completeSession: jest.fn()
  }
}));
jest.mock('../utils/correlationId', () => ({
  CorrelationIdManager: {
    traceWithCorrelation: jest.fn((name, fn) => fn()),
    createBedrockContext: jest.fn().mockReturnValue({ correlationId: 'test-correlation-id' }),
    setContext: jest.fn(),
    getCurrentContext: jest.fn().mockReturnValue({ correlationId: 'test-correlation-id' })
  }
}));

const MockBedrockRuntimeClient = BedrockRuntimeClient as jest.MockedClass<typeof BedrockRuntimeClient>;

describe('NovaSonicBidirectionalStreamClient', () => {
  let client: NovaSonicBidirectionalStreamClient;
  let mockBedrockClient: any;

  beforeEach(() => {
    // Clear mocks first
    jest.clearAllMocks();
    
    mockBedrockClient = {
      send: jest.fn()
    };

    MockBedrockRuntimeClient.mockImplementation(() => mockBedrockClient);

    client = new NovaSonicBidirectionalStreamClient({
      clientConfig: {
        region: 'us-east-1'
      },
      enableOrchestrator: false
    });
  });

  afterEach(() => {
    // Clean up any active sessions to prevent memory leaks and hanging timers
    if (client && client.getActiveSessions) {
      const activeSessions = client.getActiveSessions();
      activeSessions.forEach(sessionId => {
        try {
          client.forceCloseSession(sessionId);
        } catch (e) {
          // Ignore cleanup errors in tests
        }
      });
    }
  });

  describe('Constructor', () => {
    it('should create client with default configuration', () => {
      // The constructor is called in beforeEach, so we check it was called
      expect(MockBedrockRuntimeClient).toHaveBeenCalledTimes(1);
      expect(client).toBeDefined();
    });

    it('should use provided inference configuration', () => {
      const inferenceConfig = {
        maxTokens: 2048,
        topP: 0.8,
        temperature: 0.5
      };

      const clientWithConfig = new NovaSonicBidirectionalStreamClient({
        clientConfig: { region: 'us-west-2' },
        inferenceConfig
      });

      expect(clientWithConfig).toBeDefined();
    });
  });

  describe('Session Management', () => {
    describe('createStreamSession', () => {
      it('should create new stream session', () => {
        const session = client.createStreamSession('test-session-1');

        expect(session).toBeInstanceOf(StreamSession);
        expect(session.getSessionId()).toBe('test-session-1');
        expect(client.isSessionActive('test-session-1')).toBe(true);
      });

      it('should generate UUID if no session ID provided', () => {
        const session = client.createStreamSession();

        expect(session.getSessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      });

      it('should throw error if session already exists', () => {
        client.createStreamSession('duplicate-session');

        expect(() => {
          client.createStreamSession('duplicate-session');
        }).toThrow('Stream session with ID duplicate-session already exists');
      });
    });

    describe('isSessionActive', () => {
      it('should return true for active sessions', () => {
        client.createStreamSession('active-session');

        expect(client.isSessionActive('active-session')).toBe(true);
      });

      it('should return false for non-existent sessions', () => {
        expect(client.isSessionActive('non-existent')).toBe(false);
      });
    });

    describe('getActiveSessions', () => {
      it('should return list of active session IDs', () => {
        client.createStreamSession('session-1');
        client.createStreamSession('session-2');

        const activeSessions = client.getActiveSessions();

        expect(activeSessions).toContain('session-1');
        expect(activeSessions).toContain('session-2');
        expect(activeSessions).toHaveLength(2);
      });

      it('should return empty array when no sessions', () => {
        expect(client.getActiveSessions()).toEqual([]);
      });
    });
  });

  describe('Session Setup', () => {
    let sessionId: string;

    beforeEach(() => {
      sessionId = 'test-session';
      client.createStreamSession(sessionId);
    });

    describe('setupSessionStartEvent', () => {
      it('should add session start event to queue', () => {
        client.setupSessionStartEvent(sessionId);

        const sessionData = client.getSessionData(sessionId);
        expect(sessionData?.queue).toHaveLength(1);
        expect(sessionData?.queue[0]).toMatchObject({
          event: {
            sessionStart: {
              inferenceConfiguration: expect.objectContaining({
                maxTokens: expect.any(Number),
                topP: expect.any(Number),
                temperature: expect.any(Number)
              })
            }
          }
        });
      });
    });

    describe('setupPromptStartEvent', () => {
      it('should add prompt start event to queue', () => {
        client.setupPromptStartEvent(sessionId);

        const sessionData = client.getSessionData(sessionId);
        expect(sessionData?.queue).toHaveLength(1);
        expect(sessionData?.queue[0]).toMatchObject({
          event: {
            promptStart: expect.objectContaining({
              promptName: expect.any(String),
              textOutputConfiguration: { mediaType: 'text/plain' },
              audioOutputConfiguration: expect.any(Object),
              toolConfiguration: { tools: [] }
            })
          }
        });
        expect(sessionData?.isPromptStartSent).toBe(true);
      });
    });

    describe('setupSystemPromptEvent', () => {
      it('should add system prompt events to queue', () => {
        const systemPrompt = 'You are a helpful assistant';
        client.setupSystemPromptEvent(sessionId, undefined, systemPrompt);

        const sessionData = client.getSessionData(sessionId);
        expect(sessionData?.queue).toHaveLength(3); // contentStart, textInput, contentEnd

        // Check contentStart
        expect(sessionData?.queue[0]).toMatchObject({
          event: {
            contentStart: expect.objectContaining({
              type: 'TEXT',
              role: 'SYSTEM',
              interactive: false
            })
          }
        });

        // Check textInput
        expect(sessionData?.queue[1]).toMatchObject({
          event: {
            textInput: expect.objectContaining({
              content: systemPrompt
            })
          }
        });

        // Check contentEnd
        expect(sessionData?.queue[2]).toMatchObject({
          event: {
            contentEnd: expect.any(Object)
          }
        });
      });
    });

    describe('setupStartAudioEvent', () => {
      it('should add audio content start event to queue', () => {
        client.setupStartAudioEvent(sessionId);

        const sessionData = client.getSessionData(sessionId);
        expect(sessionData?.queue).toHaveLength(1);
        expect(sessionData?.queue[0]).toMatchObject({
          event: {
            contentStart: expect.objectContaining({
              type: 'AUDIO',
              role: 'USER',
              interactive: true,
              audioInputConfiguration: expect.any(Object)
            })
          }
        });
        expect(sessionData?.isAudioContentStartSent).toBe(true);
      });
    });
  });

  describe('Audio Streaming', () => {
    let sessionId: string;

    beforeEach(() => {
      sessionId = 'test-session';
      client.createStreamSession(sessionId);
      client.setupStartAudioEvent(sessionId);
    });

    describe('streamAudioChunk', () => {
      it('should add audio input event to queue', async () => {
        const audioData = Buffer.from('test-audio-data');

        await client.streamAudioChunk(sessionId, audioData);

        const sessionData = client.getSessionData(sessionId);
        expect(sessionData?.queue).toHaveLength(2); // setupStartAudioEvent + streamAudioChunk
        expect(sessionData?.queue[1]).toMatchObject({
          event: {
            audioInput: expect.objectContaining({
              content: audioData.toString('base64')
            })
          }
        });
      });

      it('should throw error for invalid session', async () => {
        const audioData = Buffer.from('test-audio-data');

        await expect(client.streamAudioChunk('invalid-session', audioData))
          .rejects.toThrow('Invalid session invalid-session for audio streaming');
      });

      it('should throw error if audio content not started', async () => {
        const newSessionId = 'new-session';
        client.createStreamSession(newSessionId);
        const audioData = Buffer.from('test-audio-data');

        // The session exists but audioContentId is not set (no setupStartAudioEvent called)
        // The actual implementation checks for !session.audioContentId
        const sessionData = client.getSessionData(newSessionId);
        if (sessionData) {
          sessionData.audioContentId = ''; // Clear the audioContentId to simulate not started
        }

        await expect(client.streamAudioChunk(newSessionId, audioData))
          .rejects.toThrow('Invalid session new-session for audio streaming');
      });
    });

    describe('streamAudioRealtime', () => {
      it('should stream audio in real-time mode', async () => {
        client.enableRealtimeInterruption(sessionId);
        const audioData = Buffer.from('realtime-audio');

        await client.streamAudioRealtime(sessionId, audioData);

        const sessionData = client.getSessionData(sessionId);
        expect(sessionData?.queue.length).toBeGreaterThan(1);
      });
    });
  });

  describe('Session Control', () => {
    let sessionId: string;

    beforeEach(() => {
      sessionId = 'test-session';
      client.createStreamSession(sessionId);
      client.setupPromptStartEvent(sessionId);
      client.setupStartAudioEvent(sessionId);
    });

    describe('sendContentEnd', () => {
      it('should add content end event to queue', () => {
        client.sendContentEnd(sessionId);

        const sessionData = client.getSessionData(sessionId);
        const lastEvent = sessionData?.queue[sessionData.queue.length - 1];
        expect(lastEvent).toMatchObject({
          event: {
            contentEnd: expect.objectContaining({
              promptName: expect.any(String),
              contentName: expect.any(String)
            })
          }
        });
      });

      it('should not add event if audio content not started', () => {
        const newSessionId = 'new-session';
        client.createStreamSession(newSessionId);
        const initialQueueLength = client.getSessionData(newSessionId)?.queue.length || 0;

        client.sendContentEnd(newSessionId);

        const sessionData = client.getSessionData(newSessionId);
        expect(sessionData?.queue).toHaveLength(initialQueueLength);
      });
    });

    describe('sendPromptEnd', () => {
      it('should add prompt end event and set waiting state', () => {
        client.sendPromptEnd(sessionId);

        const sessionData = client.getSessionData(sessionId);
        const lastEvent = sessionData?.queue[sessionData.queue.length - 1];
        expect(lastEvent).toMatchObject({
          event: {
            promptEnd: expect.objectContaining({
              promptName: expect.any(String)
            })
          }
        });
        expect(sessionData?.isWaitingForResponse).toBe(true);
      });
    });

    describe('sendSessionEnd', () => {
      it('should add session end event and cleanup', () => {
        // Get the session data before calling sendSessionEnd
        const sessionDataBefore = client.getSessionData(sessionId);
        expect(sessionDataBefore).toBeDefined();
        
        client.sendSessionEnd(sessionId);

        // After sendSessionEnd, the session should be cleaned up and removed
        const sessionDataAfter = client.getSessionData(sessionId);
        expect(sessionDataAfter).toBeUndefined();
        
        // Check that the session is no longer active
        expect(client.isSessionActive(sessionId)).toBe(false);
      });
    });
  });

  describe('Real-time Features', () => {
    let sessionId: string;

    beforeEach(() => {
      sessionId = 'test-session';
      client.createStreamSession(sessionId);
    });

    describe('enableRealtimeInterruption', () => {
      it('should have real-time mode always enabled by default', () => {
        // Real-time mode should be enabled by default in the unified client
        const sessionData = client.getSessionData(sessionId) as any;
        expect(sessionData.realtimeMode).toBe(true);
        
        // Calling enableRealtimeInterruption should not change anything since it's already enabled
        client.enableRealtimeInterruption(sessionId);
        expect(sessionData.realtimeMode).toBe(true);
      });
    });

    describe('handleUserInterruption', () => {
      it('should add user interruption event', () => {
        client.handleUserInterruption(sessionId);

        const sessionData = client.getSessionData(sessionId);
        const lastEvent = sessionData?.queue[sessionData.queue.length - 1];
        expect(lastEvent).toMatchObject({
          event: {
            userInterruption: expect.objectContaining({
              timestamp: expect.any(String),
              reason: 'user_speaking'
            })
          }
        });
      });
    });

    describe('setUserSpeakingState', () => {
      it('should update user speaking state', () => {
        client.setUserSpeakingState(sessionId, true);

        const sessionData = client.getSessionData(sessionId) as any;
        expect(sessionData.userSpeaking).toBe(true);
        expect(sessionData.lastUserActivity).toBeGreaterThan(0);
      });

      it('should trigger interruption in real-time mode', () => {
        client.enableRealtimeInterruption(sessionId);
        const sessionData = client.getSessionData(sessionId) as any;
        sessionData.modelSpeaking = true;

        const initialQueueLength = sessionData.queue.length;
        client.setUserSpeakingState(sessionId, true);

        expect(sessionData.queue.length).toBeGreaterThan(initialQueueLength);
      });
    });
  });

  describe('Event Handling', () => {
    let sessionId: string;

    beforeEach(() => {
      sessionId = 'test-session';
      client.createStreamSession(sessionId);
    });

    describe('registerEventHandler', () => {
      it('should register event handler for session', () => {
        const handler = jest.fn();

        client.registerEventHandler(sessionId, 'audioOutput', handler);

        const sessionData = client.getSessionData(sessionId);
        expect(sessionData?.responseHandlers.get('audioOutput')).toBe(handler);
      });

      it('should throw error for non-existent session', () => {
        const handler = jest.fn();

        expect(() => {
          client.registerEventHandler('non-existent', 'audioOutput', handler);
        }).toThrow('Session non-existent not found');
      });
    });
  });

  describe('Session Cleanup', () => {
    let sessionId: string;

    beforeEach(() => {
      sessionId = 'test-session';
      client.createStreamSession(sessionId);
    });

    describe('closeSession', () => {
      it('should close session gracefully', async () => {
        await client.closeSession(sessionId);

        expect(client.isSessionActive(sessionId)).toBe(false);
      });

      it('should handle cleanup in progress', async () => {
        // Start cleanup
        const closePromise1 = client.closeSession(sessionId);
        const closePromise2 = client.closeSession(sessionId);

        await Promise.all([closePromise1, closePromise2]);

        expect(client.isSessionActive(sessionId)).toBe(false);
      });
    });

    describe('forceCloseSession', () => {
      it('should force close session immediately', () => {
        client.forceCloseSession(sessionId);

        expect(client.isSessionActive(sessionId)).toBe(false);
      });

      it('should handle non-existent session', () => {
        expect(() => {
          client.forceCloseSession('non-existent');
        }).not.toThrow();
      });
    });
  });

  describe('Activity Tracking', () => {
    let sessionId: string;

    beforeEach(() => {
      sessionId = 'test-session';
      client.createStreamSession(sessionId);
    });

    it('should track last activity time', () => {
      const beforeTime = Date.now();
      
      // Simulate activity
      client.setupPromptStartEvent(sessionId);
      
      const afterTime = Date.now();
      const lastActivity = client.getLastActivityTime(sessionId);
      
      expect(lastActivity).toBeGreaterThanOrEqual(beforeTime);
      expect(lastActivity).toBeLessThanOrEqual(afterTime);
    });

    it('should return 0 for non-existent session', () => {
      expect(client.getLastActivityTime('non-existent')).toBe(0);
    });
  });
});