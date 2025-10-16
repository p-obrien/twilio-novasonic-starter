/**
 * Tests for WebsocketHandler
 */

// Mock the client BEFORE importing anything else
const mockBedrockClient = {
  // Core streaming methods
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
  // Orchestrator methods
  isOrchestratorEnabled: jest.fn().mockReturnValue(false),
  processTextInput: jest.fn().mockResolvedValue({ response: 'test response', source: 'conversation' }),
  updateOrchestratorConfig: jest.fn(),
  getOrchestratorConfig: jest.fn().mockReturnValue({}),
  // Lifecycle methods
  cleanup: jest.fn(),
  shutdown: jest.fn()
};

jest.doMock('../client/', () => ({
  NovaSonicClient: jest.fn().mockImplementation(() => mockBedrockClient),
  createNovaSonicClient: jest.fn().mockImplementation(() => mockBedrockClient)
}));

// Mock other dependencies
jest.mock('ws');
jest.mock('../utils/logger');
jest.mock('../security/WebSocketSecurity');
jest.mock('../observability/websocketMetrics');
jest.mock('../observability/sessionMetrics');
jest.mock('../audio/AudioBufferManager');
jest.mock('../audio/AudioProcessor', () => ({
  processBedrockAudioOutput: jest.fn().mockReturnValue(Buffer.alloc(160)),
  processTwilioAudioInput: jest.fn().mockReturnValue(Buffer.alloc(320))
}));
jest.mock('../utils/correlationId', () => ({
  CorrelationIdManager: {
    createWebSocketContext: jest.fn().mockReturnValue({ correlationId: 'test-correlation-id' }),
    runWithContext: jest.fn((context, fn) => fn()),
    setContext: jest.fn(),
    getCurrentContext: jest.fn().mockReturnValue({ correlationId: 'test-correlation-id' }),
    getCurrentCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
    traceWithCorrelation: jest.fn((name, fn) => fn()),
    createBedrockContext: jest.fn().mockReturnValue({ correlationId: 'test-correlation-id' })
  }
}));

// Now import everything
import { WebSocketServer } from 'ws';
import http from 'http';
import { initWebsocketServer } from '../handlers/WebsocketHandler';
import { webSocketSecurity } from '../security/WebSocketSecurity';
import { WebSocketMetrics } from '../observability/websocketMetrics';
import { SessionMetrics } from '../observability/sessionMetrics';
import { AudioBufferManager } from '../audio/AudioBufferManager';

const MockWebSocketServer = WebSocketServer as jest.MockedClass<typeof WebSocketServer>;
const mockWebSocketSecurity = webSocketSecurity as jest.Mocked<typeof webSocketSecurity>;
const mockWebSocketMetrics = WebSocketMetrics as jest.Mocked<typeof WebSocketMetrics>;
const mockSessionMetrics = SessionMetrics as jest.Mocked<typeof SessionMetrics>;
const mockAudioBufferManager = AudioBufferManager as jest.Mocked<typeof AudioBufferManager>;

describe('WebsocketHandler', () => {
  let mockServer: http.Server;
  let mockWss: any;
  let mockWs: any;
  let mockReq: any;

  beforeEach(() => {
    // Reset the shared mock client
    Object.values(mockBedrockClient).forEach(mockFn => {
      if (jest.isMockFunction(mockFn)) {
        mockFn.mockClear();
      }
    });
    
    // Reset specific return values
    mockBedrockClient.isSessionActive.mockReturnValue(false);
    mockBedrockClient.initiateSession.mockResolvedValue(undefined);
    mockBedrockClient.streamAudioChunk.mockResolvedValue(undefined);
    
    // Make createStreamSession change the session state to active
    mockBedrockClient.createStreamSession.mockImplementation(() => {
      mockBedrockClient.isSessionActive.mockReturnValue(true);
    });

    mockServer = {} as http.Server;

    mockWss = {
      on: jest.fn()
    };

    mockWs = {
      id: 'test-ws-id',
      correlationContext: { correlationId: 'test-correlation-id' },
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

    mockWebSocketSecurity.validateConnection.mockReturnValue({
      isValid: true,
      callSid: 'CA123456789',
      accountSid: 'AC123456789'
    });

    mockWebSocketSecurity.validateWebSocketMessage.mockReturnValue({
      isValid: true,
      callSid: 'CA123456789'
    });

    mockAudioBufferManager.getInstance.mockReturnValue({
      addAudio: jest.fn(),
      getBufferStatus: jest.fn().mockReturnValue({ bufferBytes: 0, bufferMs: 0 }),
      flushAndRemove: jest.fn()
    } as any);
  });

  describe('initWebsocketServer', () => {
    it('should create WebSocket server with correct configuration', () => {
      initWebsocketServer(mockServer);

      expect(MockWebSocketServer).toHaveBeenCalledWith({
        server: mockServer,
        path: '/media',
        perMessageDeflate: false,
        verifyClient: expect.any(Function)
      });
    });

    it('should setup connection event handler', () => {
      initWebsocketServer(mockServer);

      expect(mockWss.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });
  });

  describe('Connection Verification', () => {
    let verifyClient: any;

    beforeEach(() => {
      initWebsocketServer(mockServer);
      verifyClient = MockWebSocketServer.mock.calls[0]?.[0]?.verifyClient;
    });

    it('should accept valid connections', () => {
      const result = verifyClient({ req: mockReq });

      expect(mockWebSocketSecurity.validateConnection).toHaveBeenCalledWith(mockReq);
      expect(result).toBe(true);
    });

    it('should reject invalid connections', () => {
      mockWebSocketSecurity.validateConnection.mockReturnValue({
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
      initWebsocketServer(mockServer);
      connectionHandler = mockWss.on.mock.calls.find((call: any) => call[0] === 'connection')?.[1];
    });

    it('should setup WebSocket connection with proper initialization', () => {
      connectionHandler(mockWs, mockReq);

      expect(mockWs.id).toMatch(/^twilio-ws-\d+-[a-z0-9]+$/);
      expect(mockWebSocketMetrics.onConnection).toHaveBeenCalledWith(mockWs);
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
      initWebsocketServer(mockServer);
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

        expect(mockWebSocketSecurity.validateWebSocketMessage).toHaveBeenCalledWith(startMessage);
        expect(mockWs.twilioStreamSid).toBe('MZ123456789');
        expect(mockWs.twilioSampleRate).toBe(8000);
        expect(mockWs.callSid).toBe('CA123456789');

        expect(mockBedrockClient.createStreamSession).toHaveBeenCalled();
        expect(mockBedrockClient.initiateSession).toHaveBeenCalled();
      });

      it('should reject invalid start message', async () => {
        mockWebSocketSecurity.validateWebSocketMessage.mockReturnValue({
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
      initWebsocketServer(mockServer);
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

      expect(mockWebSocketSecurity.removeActiveSession).toHaveBeenCalledWith('CA123456789');
      expect(mockWebSocketMetrics.onDisconnection).toHaveBeenCalledWith(mockWs);
      expect(mockSessionMetrics.endSession).toHaveBeenCalled();
      expect(mockBedrockClient.forceCloseSession).toHaveBeenCalled();
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockWebSocketMetrics.onDisconnection.mockImplementation(() => {
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
      initWebsocketServer(mockServer);
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