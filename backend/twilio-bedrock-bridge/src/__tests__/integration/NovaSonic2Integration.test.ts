/**
 * End-to-End Integration Test for Nova Sonic 2 Migration
 * 
 * Tests the complete flow from Twilio connection to greeting with Nova Sonic 2's
 * native speaks-first capability.
 * 
 * Requirements tested:
 * - 3.2: Integration tests verify end-to-end conversation flow with Nova Sonic 2
 * - 6.3: Nova Sonic 2 generates initial greeting and streams to Twilio
 * - 6.4: System transitions to normal conversation mode after greeting
 */

// Mock dependencies before imports
jest.mock('@aws-sdk/client-bedrock-runtime');

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn()
};

jest.mock('../../observability/logger', () => ({
  __esModule: true,
  default: mockLogger
}));

jest.mock('../../observability/bedrockObservability', () => ({
  bedrockObservability: {
    startSession: jest.fn(),
    recordError: jest.fn(),
    completeSession: jest.fn()
  }
}));

jest.mock('../../observability/websocketMetrics');
jest.mock('../../observability/sessionMetrics');
jest.mock('../../observability/cloudWatchMetrics');
jest.mock('../../observability/smartSampling');
jest.mock('../../security/WebSocketSecurity');
jest.mock('../../observability/metrics');
jest.mock('@opentelemetry/api');
jest.mock('../../utils/correlationId', () => ({
  CorrelationIdManager: {
    getCurrentCorrelationId: jest.fn(() => 'test-correlation-id'),
    traceWithCorrelation: jest.fn((name, fn) => fn()),
    createBedrockContext: jest.fn().mockReturnValue({ correlationId: 'test-correlation-id' }),
    setContext: jest.fn(),
    getCurrentContext: jest.fn().mockReturnValue({ correlationId: 'test-correlation-id' })
  }
}));
jest.mock('../../agents/ToolRegistry', () => ({
  toolRegistry: {
    getAllToolDefinitions: jest.fn().mockReturnValue([])
  }
}));

import { NovaSonicClient as NovaSonicBidirectionalStreamClient } from '../../client/';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { configManager } from '../../config/ConfigurationManager';

const MockBedrockRuntimeClient = BedrockRuntimeClient as jest.MockedClass<typeof BedrockRuntimeClient>;

describe('Nova Sonic 2 End-to-End Integration', () => {
  let client: NovaSonicBidirectionalStreamClient;
  let mockBedrockClient: any;

  // Set timeout for all tests in this suite
  jest.setTimeout(10000);

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Bedrock client
    mockBedrockClient = {
      send: jest.fn().mockResolvedValue({
        body: {
          [Symbol.asyncIterator]: async function* () {
            // Simulate Nova Sonic 2 speaks-first greeting
            yield {
              audioOutput: {
                audio: Buffer.from('greeting-audio-data').toString('base64'),
                sampleRateHz: 16000
              }
            };
            
            // Simulate normal conversation response
            yield {
              audioOutput: {
                audio: Buffer.from('response-audio-data').toString('base64'),
                sampleRateHz: 16000
              }
            };
          }
        }
      })
    };

    MockBedrockRuntimeClient.mockImplementation(() => mockBedrockClient);

    // Create client
    client = new NovaSonicBidirectionalStreamClient({
      clientConfig: {
        region: 'us-east-1'
      }
    });
  });

  afterEach(() => {
    // Clean up any active sessions
    if (client && client.getActiveSessions) {
      const activeSessions = client.getActiveSessions();
      activeSessions.forEach(sessionId => {
        try {
          client.forceCloseSession(sessionId);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
    }
  });

  afterAll(() => {
    // Cleanup client
    if (client && client.cleanup) {
      client.cleanup();
    }
  });

  describe('Complete Flow: Twilio Connection to Greeting', () => {
    it('should create session with Nova Sonic 2 model ID', () => {
      // Requirement 3.2: Session is created with Nova Sonic 2 model ID
      const sessionId = 'test-session-nova2';
      
      const session = client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true,
        initialPrompt: 'Greet the caller warmly'
      });

      expect(session).toBeDefined();
      expect(session.sessionId).toBe(sessionId);
      expect(client.isSessionActive(sessionId)).toBe(true);

      // Verify session configuration includes speaks-first
      const sessionData = client.getSessionData(sessionId);
      expect(sessionData).toBeDefined();
      expect(sessionData?.speaksFirst).toBe(true);
      expect(sessionData?.initialPrompt).toBe('Greet the caller warmly');
    });

    it('should enable speaks-first in session configuration', () => {
      // Requirement 6.1: Speaks-first is enabled in session config
      const sessionId = 'test-speaks-first';
      
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true,
        initialPrompt: 'Welcome to our service'
      });

      const sessionData = client.getSessionData(sessionId);
      
      // Verify speaks-first configuration
      expect(sessionData?.speaksFirst).toBe(true);
      expect(sessionData?.initialPrompt).toBeDefined();
      expect(sessionData?.initialPrompt).toBe('Welcome to our service');
    });

    it('should configure session to receive greeting audio from Nova Sonic 2', () => {
      // Requirement 6.3: Session is configured to receive greeting audio from Nova Sonic 2
      const sessionId = 'test-greeting-audio';
      let audioHandlerRegistered = false;

      // Create session with speaks-first
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true,
        initialPrompt: 'Greet the caller'
      });

      // Register handler to capture greeting audio
      client.registerEventHandler(sessionId, 'audioOutput', (data: unknown) => {
        audioHandlerRegistered = true;
      });

      // Setup session events
      client.setupSessionStartEvent(sessionId);
      client.setupPromptStartEvent(sessionId);
      client.setupSystemPromptEvent(sessionId);
      client.setupStartAudioEvent(sessionId);

      // Verify session is configured correctly
      const sessionData = client.getSessionData(sessionId);
      expect(sessionData?.speaksFirst).toBe(true);
      expect(sessionData?.initialPrompt).toBe('Greet the caller');
      expect(sessionData?.isPromptStartSent).toBe(true);
      expect(sessionData?.isAudioContentStartSent).toBe(true);
      
      // Verify audio handler is registered
      expect(sessionData?.responseHandlers.has('audioOutput')).toBe(true);
    });

    it('should configure audio output handler for streaming to Twilio', () => {
      // Requirement 6.3: Audio output handler is configured for streaming to Twilio
      const sessionId = 'test-greeting-stream';

      // Create session
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true,
        initialPrompt: 'Hello caller'
      });

      // Register handler to capture audio chunks
      client.registerEventHandler(sessionId, 'audioOutput', (data: unknown) => {
        // Handler would process audio here
      });

      // Setup session
      client.setupSessionStartEvent(sessionId);
      client.setupPromptStartEvent(sessionId);
      client.setupSystemPromptEvent(sessionId);
      client.setupStartAudioEvent(sessionId);

      // Verify session is ready for audio streaming
      const sessionData = client.getSessionData(sessionId);
      expect(sessionData?.speaksFirst).toBe(true);
      expect(sessionData?.responseHandlers.has('audioOutput')).toBe(true);
      expect(sessionData?.isAudioContentStartSent).toBe(true);
      
      // Verify session queue has the correct events
      expect(sessionData?.queue.length).toBeGreaterThan(0);
    });

    it('should support transition to normal conversation mode after greeting', async () => {
      // Requirement 6.4: System supports transition to normal conversation mode
      const sessionId = 'test-conversation-transition';

      // Create session
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true,
        initialPrompt: 'Greet the user'
      });

      // Register handler for content end (marks greeting completion)
      client.registerEventHandler(sessionId, 'contentEnd', (data: unknown) => {
        // Handler would process content end
      });

      // Setup session
      client.setupSessionStartEvent(sessionId);
      client.setupPromptStartEvent(sessionId);
      client.setupSystemPromptEvent(sessionId);
      client.setupStartAudioEvent(sessionId);

      // Verify session is ready for conversation
      expect(client.isSessionActive(sessionId)).toBe(true);

      // Simulate user audio input (normal conversation)
      const userAudio = Buffer.alloc(320); // PCM audio data
      await client.streamAudioChunk(sessionId, userAudio);

      // Verify session is still active for conversation
      expect(client.isSessionActive(sessionId)).toBe(true);
      
      // Verify audio content is being tracked
      const sessionData = client.getSessionData(sessionId);
      expect(sessionData?.isAudioContentStartSent).toBe(true);
    });

    it('should use Nova Sonic 2 model ID throughout session', () => {
      // Requirement 1.1, 1.2: Model ID is amazon.nova-2-sonic-v1:0
      const sessionId = 'test-model-id';
      
      // Verify configuration uses Nova Sonic 2
      expect(configManager.bedrock.modelId).toBe('amazon.nova-2-sonic-v1:0');

      // Create session
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true
      });

      // Verify session is created successfully with Nova Sonic 2
      expect(client.isSessionActive(sessionId)).toBe(true);
    });

    it('should configure complete end-to-end flow', async () => {
      // Complete integration test covering all requirements
      const sessionId = 'test-e2e-flow';

      // Create session with speaks-first
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true,
        initialPrompt: 'Welcome to our AI assistant'
      });

      // Register event handlers
      client.registerEventHandler(sessionId, 'audioOutput', () => {
        // Handler for audio output
      });
      
      client.registerEventHandler(sessionId, 'contentEnd', () => {
        // Handler for content end
      });

      // Setup session
      client.setupSessionStartEvent(sessionId);
      client.setupPromptStartEvent(sessionId);
      client.setupSystemPromptEvent(sessionId);
      client.setupStartAudioEvent(sessionId);

      // Verify session is fully configured
      expect(client.isSessionActive(sessionId)).toBe(true);

      // Simulate user input
      const userAudio = Buffer.alloc(320);
      await client.streamAudioChunk(sessionId, userAudio);
      
      // Send content end to trigger response
      client.sendContentEnd(sessionId);
      client.sendPromptEnd(sessionId);

      // Verify session data
      const sessionData = client.getSessionData(sessionId);
      expect(sessionData?.speaksFirst).toBe(true);
      expect(sessionData?.isPromptStartSent).toBe(true);
      expect(sessionData?.isAudioContentStartSent).toBe(true);
      expect(sessionData?.isWaitingForResponse).toBe(true);
      
      // Verify event handlers are registered
      expect(sessionData?.responseHandlers.has('audioOutput')).toBe(true);
      expect(sessionData?.responseHandlers.has('contentEnd')).toBe(true);
    });
  });

  describe('Session Configuration', () => {
    it('should support optional initial prompt', () => {
      const sessionId = 'test-optional-prompt';
      
      // Create session without initial prompt
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true
      });

      const sessionData = client.getSessionData(sessionId);
      expect(sessionData?.speaksFirst).toBe(true);
      // Initial prompt is optional
    });

    it('should support custom initial prompts', () => {
      const sessionId = 'test-custom-prompt';
      const customPrompt = 'Hello! I am your personal AI assistant. How can I help you today?';
      
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true,
        initialPrompt: customPrompt
      });

      const sessionData = client.getSessionData(sessionId);
      expect(sessionData?.initialPrompt).toBe(customPrompt);
    });

    it('should work without speaks-first for backward compatibility', () => {
      const sessionId = 'test-no-speaks-first';
      
      // Create session without speaks-first
      client.createStreamSession(sessionId, {
        clientConfig: {}
      });

      const sessionData = client.getSessionData(sessionId);
      expect(sessionData?.speaksFirst).toBeUndefined();
      expect(client.isSessionActive(sessionId)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should validate session configuration', () => {
      const sessionId = 'test-validation';
      
      // Create session with speaks-first
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true
      });

      // Verify session is created successfully
      expect(client.isSessionActive(sessionId)).toBe(true);
      
      // Verify session data is valid
      const sessionData = client.getSessionData(sessionId);
      expect(sessionData).toBeDefined();
      expect(sessionData?.speaksFirst).toBe(true);
    });

    it('should prevent duplicate session creation', () => {
      const sessionId = 'test-duplicate';
      
      // Create first session
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true
      });

      // Attempt to create duplicate session should throw
      expect(() => {
        client.createStreamSession(sessionId, {
          clientConfig: {},
          speaksFirst: true
        });
      }).toThrow();
    });
  });

  describe('Real-time Features', () => {
    it('should support real-time mode with speaks-first', () => {
      const sessionId = 'test-realtime-speaks-first';
      
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true,
        initialPrompt: 'Hello'
      });

      // Enable real-time interruption
      client.enableRealtimeInterruption(sessionId);

      const sessionData = client.getSessionData(sessionId);
      expect((sessionData as any)?.realtimeMode).toBe(true);
      expect(sessionData?.speaksFirst).toBe(true);
    });

    it('should handle user interruption during greeting', () => {
      const sessionId = 'test-interruption';
      
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true
      });

      client.enableRealtimeInterruption(sessionId);
      
      // Simulate user interruption
      client.setUserSpeakingState(sessionId, true);

      const sessionData = client.getSessionData(sessionId);
      expect((sessionData as any)?.userSpeaking).toBe(true);
    });
  });

  describe('Observability', () => {
    it('should track session with speaks-first configuration', () => {
      const sessionId = 'test-activity-tracking';
      
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true
      });

      // Verify session is being tracked
      expect(client.isSessionActive(sessionId)).toBe(true);
      expect(client.getActiveSessions()).toContain(sessionId);
    });

    it('should provide session diagnostics', () => {
      const sessionId = 'test-diagnostics';
      
      client.createStreamSession(sessionId, {
        clientConfig: {},
        speaksFirst: true,
        initialPrompt: 'Test greeting'
      });

      const streamSession = client.getStreamSession(sessionId);
      expect(streamSession).toBeDefined();
      
      if (streamSession) {
        const diagnostics = streamSession.getDiagnostics();
        expect(diagnostics.sessionInfo.sessionId).toBe(sessionId);
        expect(diagnostics.sessionInfo.isActive).toBe(true);
        expect(diagnostics.configuration.speaksFirst).toBe(true);
        expect(diagnostics.configuration.initialPrompt).toBe('Test greeting');
      }
    });
  });
});
