/**
 * Tests for WebsocketHandler using Dependency Injection
 */

// Mock observability modules that are directly imported in WebsocketHandler
jest.mock('../observability/safeTracing', () => {
  const mockSpan = {
    setAttributes: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn()
  };

  return {
    safeTrace: {
      getTracer: jest.fn(() => ({
        startSpan: jest.fn(() => mockSpan)
      })),
      isAvailable: jest.fn(() => true)
    }
  };
});

jest.mock('../observability/smartSampling', () => {
  const mockSpan = {
    setAttributes: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn()
  };

  return {
    smartSampler: {
      shouldSample: jest.fn(() => ({ shouldSample: false })),
      startSpanWithSampling: jest.fn(() => mockSpan)
    },
    TracingUtils: {}
  };
});

jest.mock('../utils/asyncCorrelation', () => ({
  setTimeoutWithCorrelation: jest.fn((fn, delay) => setTimeout(fn, delay))
}));

import { WebSocketServer } from 'ws';
import http from 'http';
import { initWebsocketServer } from '../handlers/WebsocketHandler';
import type {
  WebSocketHandlerDependencies,
  WebSocketSecurityService,
  WebSocketMetricsService,
  SessionMetricsService,
  AudioBufferManagerService,
  AudioProcessors,
  Logger,
  CorrelationManagerService
} from '../handlers/WebsocketHandlerTypes';
import type { NovaSonicBidirectionalStreamClient } from '../client';
import { smartSampler } from '../observability/smartSampling';
import { safeTrace } from '../observability/safeTracing';

// Mock WebSocketServer
jest.mock('ws');
const MockWebSocketServer = WebSocketServer as jest.MockedClass<typeof WebSocketServer>;

describe('WebsocketHandler', () => {
  let mockServer: http.Server;
  let mockWss: any;
  let mockWs: any;
  let mockReq: any;
  let dependencies: WebSocketHandlerDependencies;

  // Mock implementations conforming to dependency interfaces
  let mockBedrockClient: jest.Mocked<NovaSonicBidirectionalStreamClient>;
  let mockSecurity: jest.Mocked<WebSocketSecurityService>;
  let mockWsMetrics: jest.Mocked<WebSocketMetricsService>;
  let mockSessionMetrics: jest.Mocked<SessionMetricsService>;
  let mockAudioBufferManager: jest.Mocked<AudioBufferManagerService>;
  let mockAudioProcessors: jest.Mocked<AudioProcessors>;
  let mockLogger: jest.Mocked<Logger>;
  let mockCorrelationManager: jest.Mocked<CorrelationManagerService>;

  beforeEach(() => {
    // Reset observability mocks (needed because jest config has resetMocks: true)
    (smartSampler.shouldSample as jest.Mock).mockReturnValue({ shouldSample: false });
    (smartSampler.startSpanWithSampling as jest.Mock).mockReturnValue({
      setAttributes: jest.fn(),
      recordException: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn()
    });
    (safeTrace.getTracer as jest.Mock).mockReturnValue({
      startSpan: jest.fn(() => ({
        setAttributes: jest.fn(),
        recordException: jest.fn(),
        setStatus: jest.fn(),
        end: jest.fn()
      }))
    });
    (safeTrace.isAvailable as jest.Mock).mockReturnValue(true);

    // Create mock Bedrock client
    mockBedrockClient = {
      isSessionActive: jest.fn().mockReturnValue(false),
      createStreamSession: jest.fn(),
      initiateSession: jest.fn().mockResolvedValue(undefined),
      setupSessionStartEvent: jest.fn(),
      setupPromptStartEvent: jest.fn(),
      setupSystemPromptEvent: jest.fn(),
      setupStartAudioEvent: jest.fn(),
      registerEventHandler: jest.fn(),
      streamAudioChunk: jest.fn().mockResolvedValue(undefined),
      sendContentEnd: jest.fn(),
      sendPromptEnd: jest.fn(),
      forceCloseSession: jest.fn(),
      getSessionData: jest.fn(),
      getLastActivityTime: jest.fn().mockReturnValue(Date.now()),
      isCleanupInProgress: jest.fn().mockReturnValue(false)
    } as any;

    // Make createStreamSession change the session state to active and return a mock session
    mockBedrockClient.createStreamSession.mockImplementation(() => {
      mockBedrockClient.isSessionActive.mockReturnValue(true);
      return {} as any; // Return mock StreamSession object
    });

    // Create mock security service
    mockSecurity = {
      validateConnection: jest.fn().mockReturnValue({
        isValid: true,
        callSid: 'CA123456789',
        accountSid: 'AC123456789'
      }),
      validateWebSocketMessage: jest.fn().mockReturnValue({
        isValid: true,
        callSid: 'CA123456789'
      }),
      addActiveSession: jest.fn(),
      removeActiveSession: jest.fn(),
      isSessionActive: jest.fn().mockReturnValue(false)
    };

    // Create mock WebSocket metrics
    mockWsMetrics = {
      onConnection: jest.fn(),
      onDisconnection: jest.fn()
    };

    // Create mock session metrics
    mockSessionMetrics = {
      createSession: jest.fn(),
      endSession: jest.fn()
    };

    // Create mock audio buffer manager
    mockAudioBufferManager = {
      getInstance: jest.fn().mockReturnValue({
        addAudio: jest.fn(),
        getBufferStatus: jest.fn().mockReturnValue({ bufferBytes: 0, bufferMs: 0 }),
        flushAndRemove: jest.fn()
      })
    };

    // Create mock audio processors
    mockAudioProcessors = {
      processBedrockAudioOutput: jest.fn().mockReturnValue(Buffer.alloc(160)),
      processTwilioAudioInput: jest.fn().mockReturnValue(Buffer.alloc(320))
    };

    // Create mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn()
    };

    // Create mock correlation manager
    mockCorrelationManager = {
      createWebSocketContext: jest.fn().mockReturnValue({
        correlationId: 'test-correlation-id',
        source: 'websocket',
        timestamp: Date.now()
      }),
      runWithContext: jest.fn((context, fn) => fn()),
      setContext: jest.fn(),
      getCurrentContext: jest.fn().mockReturnValue({
        correlationId: 'test-correlation-id'
      }),
      getCurrentCorrelationId: jest.fn().mockReturnValue('test-correlation-id')
    };

    // Assemble dependencies
    dependencies = {
      bedrockClient: mockBedrockClient,
      security: mockSecurity,
      wsMetrics: mockWsMetrics,
      sessionMetrics: mockSessionMetrics,
      audioBufferManager: mockAudioBufferManager,
      audioProcessors: mockAudioProcessors,
      logger: mockLogger,
      correlationManager: mockCorrelationManager
    };

    mockServer = {} as http.Server;

    mockWss = {
      on: jest.fn()
    };

    mockWs = {
      id: 'test-ws-id',
      correlationContext: {
        correlationId: 'test-correlation-id',
        source: 'websocket',
        timestamp: Date.now()
      },
      on: jest.fn(),
      close: jest.fn(),
      removeAllListeners: jest.fn(),
      readyState: 1,
      twilioStreamSid: 'MZ123456789',
      twilioSampleRate: 8000,
      callSid: 'CA123456789',
      _twilioInSeq: 0,
      _twilioOutSeq: 0
    };

    mockReq = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'Twilio.TmeWs/1.0' },
      url: '/media'
    };

    // Setup mocks
    MockWebSocketServer.mockImplementation(() => mockWss);

    // Reset mock calls
    jest.clearAllMocks();
  });

  describe('initWebsocketServer', () => {
    it('should create WebSocket server with correct configuration', () => {
      initWebsocketServer(mockServer, dependencies);

      expect(MockWebSocketServer).toHaveBeenCalledWith({
        server: mockServer,
        path: '/media',
        perMessageDeflate: false,
        verifyClient: expect.any(Function)
      });
    });

    it('should setup connection event handler', () => {
      initWebsocketServer(mockServer, dependencies);

      expect(mockWss.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });
  });

  describe('Connection Verification', () => {
    let verifyClient: any;

    beforeEach(() => {
      initWebsocketServer(mockServer, dependencies);
      verifyClient = MockWebSocketServer.mock.calls[0]?.[0]?.verifyClient;
    });

    it('should accept valid connections', () => {
      const result = verifyClient({ req: mockReq });

      expect(mockSecurity.validateConnection).toHaveBeenCalledWith(mockReq);
      expect(result).toBe(true);
    });

    it('should reject invalid connections', () => {
      mockSecurity.validateConnection.mockReturnValue({
        isValid: false,
        reason: 'Invalid User-Agent'
      });

      const result = verifyClient({ req: mockReq });

      expect(result).toBe(false);
    });
  });

  describe('WebSocket Connection Handling', () => {
    let connectionHandler: Function;

    beforeEach(() => {
      initWebsocketServer(mockServer, dependencies);
      connectionHandler = mockWss.on.mock.calls.find((call: any) => call[0] === 'connection')?.[1];
    });

    it('should setup WebSocket connection with proper initialization', () => {
      connectionHandler(mockWs, mockReq);

      expect(mockWs.id).toMatch(/^twilio-ws-\d+-[a-z0-9]+$/);
      expect(mockWsMetrics.onConnection).toHaveBeenCalledWith(mockWs);
      expect(mockSessionMetrics.createSession).toHaveBeenCalledWith(
        expect.any(String),
        mockWs
      );
    });

    it('should setup message event handler', () => {
      connectionHandler(mockWs, mockReq);

      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should setup close event handler', () => {
      connectionHandler(mockWs, mockReq);

      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should setup error event handler', () => {
      connectionHandler(mockWs, mockReq);

      expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('Message Handling', () => {
    let messageHandler: Function;

    beforeEach(() => {
      initWebsocketServer(mockServer, dependencies);
      const connectionHandler = mockWss.on.mock.calls.find((call: any) => call[0] === 'connection')?.[1];
      connectionHandler(mockWs, mockReq);
      messageHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'message')?.[1];
    });

    describe('connected event', () => {
      it('should handle connected event', async () => {
        const message = JSON.stringify({ event: 'connected' });

        await messageHandler(Buffer.from(message));

        // Should not throw or cause errors
        expect(true).toBe(true);
      });
    });

    describe('start event', () => {
      it('should handle valid start event', async () => {
        const startMessage = {
          event: 'start',
          start: {
            streamSid: 'MZ123456789',
            callSid: 'CA123456789',
            sample_rate_hz: 8000
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(startMessage)));

        expect(mockSecurity.validateWebSocketMessage).toHaveBeenCalledWith(startMessage);
        expect(mockWs.twilioStreamSid).toBe('MZ123456789');
        expect(mockWs.twilioSampleRate).toBe(8000);
        expect(mockWs.callSid).toBe('CA123456789');

        expect(mockBedrockClient.createStreamSession).toHaveBeenCalled();
        expect(mockBedrockClient.initiateSession).toHaveBeenCalled();
      });

      it('should reject invalid start message', async () => {
        mockSecurity.validateWebSocketMessage.mockReturnValue({
          isValid: false,
          reason: 'Invalid CallSid'
        });

        const startMessage = {
          event: 'start',
          start: {
            streamSid: 'MZ123456789',
            callSid: 'INVALID'
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(startMessage)));

        expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid start message');
      });

      it('should setup Bedrock session events', async () => {
        const startMessage = {
          event: 'start',
          start: {
            streamSid: 'MZ123456789',
            callSid: 'CA123456789'
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(startMessage)));

        expect(mockBedrockClient.setupSessionStartEvent).toHaveBeenCalled();
        expect(mockBedrockClient.setupPromptStartEvent).toHaveBeenCalled();
        expect(mockBedrockClient.setupSystemPromptEvent).toHaveBeenCalled();
        expect(mockBedrockClient.setupStartAudioEvent).toHaveBeenCalled();
      });

      it('should register event handlers for Bedrock responses', async () => {
        const startMessage = {
          event: 'start',
          start: {
            streamSid: 'MZ123456789',
            callSid: 'CA123456789'
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(startMessage)));

        expect(mockBedrockClient.registerEventHandler).toHaveBeenCalledWith(
          expect.any(String),
          'contentEnd',
          expect.any(Function)
        );
        expect(mockBedrockClient.registerEventHandler).toHaveBeenCalledWith(
          expect.any(String),
          'audioOutput',
          expect.any(Function)
        );
      });
    });

    describe('media event', () => {
      beforeEach(async () => {
        // Setup session first
        const startMessage = {
          event: 'start',
          start: {
            streamSid: 'MZ123456789',
            callSid: 'CA123456789'
          }
        };
        await messageHandler(Buffer.from(JSON.stringify(startMessage)));
      });

      it('should process inbound media frames', async () => {
        const mediaMessage = {
          event: 'media',
          media: {
            track: 'inbound',
            payload: Buffer.alloc(160).toString('base64') // μ-law audio data
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(mediaMessage)));

        // Should process audio without errors
        expect(true).toBe(true);
      });

      it('should skip non-inbound media frames', async () => {
        const mediaMessage = {
          event: 'media',
          media: {
            track: 'outbound',
            payload: Buffer.alloc(160).toString('base64')
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(mediaMessage)));

        // Should not process outbound frames
        expect(mockBedrockClient.streamAudioChunk).not.toHaveBeenCalled();
      });

      it('should handle missing media payload', async () => {
        const mediaMessage = {
          event: 'media',
          media: {
            track: 'inbound'
            // missing payload
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(mediaMessage)));

        // Should handle gracefully without throwing
        expect(true).toBe(true);
      });
    });

    describe('stop event', () => {
      beforeEach(async () => {
        // Setup session first
        const startMessage = {
          event: 'start',
          start: {
            streamSid: 'MZ123456789',
            callSid: 'CA123456789'
          }
        };
        await messageHandler(Buffer.from(JSON.stringify(startMessage)));
      });

      it('should handle stop event and cleanup', async () => {
        const stopMessage = { event: 'stop' };

        await messageHandler(Buffer.from(JSON.stringify(stopMessage)));

        expect(mockWs.close).toHaveBeenCalled();
      });
    });

    describe('other events', () => {
      it('should handle mark event', async () => {
        const markMessage = {
          event: 'mark',
          mark: { name: 'test-mark' }
        };

        await messageHandler(Buffer.from(JSON.stringify(markMessage)));

        // Should handle without errors
        expect(true).toBe(true);
      });

      it('should handle dtmf event', async () => {
        const dtmfMessage = {
          event: 'dtmf',
          dtmf: { digit: '1' }
        };

        await messageHandler(Buffer.from(JSON.stringify(dtmfMessage)));

        // Should handle without errors
        expect(true).toBe(true);
      });

      it('should handle unknown events', async () => {
        const unknownMessage = {
          event: 'unknown',
          data: 'test'
        };

        await messageHandler(Buffer.from(JSON.stringify(unknownMessage)));

        // Should handle without errors
        expect(true).toBe(true);
      });
    });
  });

  describe('Connection Close Handling', () => {
    let closeHandler: Function;
    let messageHandler: Function;

    beforeEach(async () => {
      initWebsocketServer(mockServer, dependencies);
      const connectionHandler = mockWss.on.mock.calls.find((call: any) => call[0] === 'connection')?.[1];
      connectionHandler(mockWs, mockReq);
      closeHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'close')?.[1];
      messageHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'message')?.[1];

      // Set up a session first by sending a start message
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MZ123456789',
          callSid: 'CA123456789'
        }
      };
      await messageHandler(Buffer.from(JSON.stringify(startMessage)));
    });

    it('should cleanup resources on close', async () => {
      await closeHandler(1000, 'Normal closure');

      expect(mockSecurity.removeActiveSession).toHaveBeenCalledWith('CA123456789');
      expect(mockWsMetrics.onDisconnection).toHaveBeenCalledWith(mockWs);
      expect(mockSessionMetrics.endSession).toHaveBeenCalled();
      expect(mockBedrockClient.forceCloseSession).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockWsMetrics.onDisconnection.mockImplementation(() => {
        throw new Error('Cleanup error');
      });

      await closeHandler(1000, 'Normal closure');

      // Should not throw despite cleanup error
      expect(true).toBe(true);
    });
  });

  describe('Error Handling', () => {
    let errorHandler: Function;

    beforeEach(() => {
      initWebsocketServer(mockServer, dependencies);
      const connectionHandler = mockWss.on.mock.calls.find((call: any) => call[0] === 'connection')?.[1];
      connectionHandler(mockWs, mockReq);
      errorHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'error')?.[1];
    });

    it('should handle WebSocket errors', () => {
      const error = new Error('WebSocket error');

      errorHandler(error);

      // Should handle error without throwing
      expect(true).toBe(true);
    });
  });
});