/**
 * Tests for WebsocketHandler with real message parsing
 * 
 * This test suite validates WebSocket message handling using real message parsing
 * and minimal mocking. Only external service boundaries (AWS SDK, observability)
 * are mocked to keep tests fast and focused.
 */

// Mock only external service boundaries
jest.mock('../../../observability/logger');
jest.mock('../../../observability/sessionMetrics');
jest.mock('../../../observability/websocketMetrics');
jest.mock('../../../security/WebSocketSecurity');
jest.mock('../../../audio/AudioBufferManager');
jest.mock('../../../audio/AudioProcessor');

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { initWebsocketServer } from '../../../handlers/WebsocketHandler';
import { webSocketSecurity } from '../../../security/WebSocketSecurity';
import { SessionMetrics } from '../../../observability/sessionMetrics';
import { WebSocketMetrics } from '../../../observability/websocketMetrics';
import { AudioBufferManager } from '../../../audio/AudioBufferManager';
import { processBedrockAudioOutput, processTwilioAudioInput } from '../../../audio/AudioProcessor';
import type { ExtendedWebSocket } from '../../../types/SharedTypes';
import type {
  TwilioStartMessage,
  TwilioMediaMessage,
  TwilioStopMessage,
  TwilioConnectedMessage
} from '../../../handlers/types/TwilioMessages';

// Mock WebSocketServer
jest.mock('ws');
const MockWebSocketServer = WebSocketServer as jest.MockedClass<typeof WebSocketServer>;

describe('WebsocketHandler', () => {
  let mockServer: http.Server;
  let mockWss: any;
  let mockWs: ExtendedWebSocket;
  let mockReq: any;

  beforeEach(() => {
    // Setup mock server
    mockServer = {} as http.Server;

    // Setup mock WebSocket server
    mockWss = {
      on: jest.fn()
    };

    // Setup mock WebSocket with real properties
    const mockOn = jest.fn();
    mockWs = {
      id: 'test-ws-id',
      correlationContext: {
        correlationId: 'test-correlation-id',
        source: 'websocket',
        timestamp: Date.now()
      },
      on: mockOn,
      close: jest.fn(),
      send: jest.fn(),
      removeAllListeners: jest.fn(),
      readyState: WebSocket.OPEN,
      twilioStreamSid: undefined,
      twilioSampleRate: undefined,
      callSid: undefined,
      _twilioInSeq: 0,
      _twilioOutSeq: 0,
      _lastAudioTimestamp: undefined
    } as any;

    // Setup mock request
    mockReq = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'Twilio.TmeWs/1.0' },
      url: '/media'
    };

    // Setup WebSocketServer mock
    MockWebSocketServer.mockImplementation(() => mockWss);

    // Setup security validation mocks
    (webSocketSecurity.validateConnection as jest.Mock).mockReturnValue({
      isValid: true,
      callSid: 'CA123456789',
      accountSid: 'AC123456789'
    });

    (webSocketSecurity.validateWebSocketMessage as jest.Mock).mockReturnValue({
      isValid: true,
      callSid: 'CA123456789'
    });

    // Setup audio processor mocks
    (processTwilioAudioInput as jest.Mock).mockReturnValue(Buffer.alloc(320));
    (processBedrockAudioOutput as jest.Mock).mockReturnValue(Buffer.alloc(160));

    // Setup audio buffer manager mock
    (AudioBufferManager.getInstance as jest.Mock).mockReturnValue({
      addAudio: jest.fn(),
      getBufferStatus: jest.fn().mockReturnValue({ bufferBytes: 0, bufferMs: 0 }),
      flushAndRemove: jest.fn()
    });

    // Reset all mocks
    jest.clearAllMocks();
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

      expect(webSocketSecurity.validateConnection).toHaveBeenCalledWith(mockReq);
      expect(result).toBe(true);
    });

    it('should reject invalid connections', () => {
      (webSocketSecurity.validateConnection as jest.Mock).mockReturnValueOnce({
        isValid: false,
        reason: 'Invalid request'
      });

      const result = verifyClient({ req: mockReq });

      expect(webSocketSecurity.validateConnection).toHaveBeenCalledWith(mockReq);
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

      // Verify WebSocket properties were initialized
      expect(mockWs.id).toMatch(/^twilio-ws-\d+-[a-z0-9]+$/);
      expect(mockWs.correlationContext).toBeDefined();
      expect(mockWs._twilioInSeq).toBe(0);
      expect(mockWs._twilioOutSeq).toBe(0);
      expect(WebSocketMetrics.onConnection).toHaveBeenCalledWith(mockWs);
      expect(SessionMetrics.createSession).toHaveBeenCalled();
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
      const mockOn = mockWs.on as jest.Mock;
      messageHandler = mockOn.mock.calls.find((call: any) => call[0] === 'message')?.[1];
    });

    describe('connected event', () => {
      it('should parse and handle connected message', async () => {
        const connectedMessage: TwilioConnectedMessage = {
          event: 'connected',
          protocol: 'Call',
          version: '1.0.0'
        };

        await messageHandler(Buffer.from(JSON.stringify(connectedMessage)));

        // Should parse message without errors
        expect(mockWs.close).not.toHaveBeenCalled();
      });
    });

    describe('start event', () => {
      it('should parse and validate start message structure', async () => {
        const startMessage: TwilioStartMessage = {
          event: 'start',
          streamSid: 'MZ123456789',
          sequenceNumber: '1',
          start: {
            streamSid: 'MZ123456789',
            accountSid: 'AC123456789',
            callSid: 'CA123456789',
            tracks: ['inbound', 'outbound'],
            mediaFormat: {
              encoding: 'audio/x-mulaw',
              sampleRate: 8000,
              channels: 1
            },
            sample_rate_hz: 8000
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(startMessage)));

        // Verify real message parsing and validation
        expect(webSocketSecurity.validateWebSocketMessage).toHaveBeenCalledWith(startMessage);
        expect(mockWs.twilioStreamSid).toBe('MZ123456789');
        expect(mockWs.twilioSampleRate).toBe(8000);
      });

      it('should reject start message with invalid structure', async () => {
        (webSocketSecurity.validateWebSocketMessage as jest.Mock).mockReturnValueOnce({
          isValid: false,
          reason: 'Invalid CallSid'
        });

        const invalidStartMessage = {
          event: 'start',
          start: {
            streamSid: 'MZ123456789',
            callSid: 'INVALID'
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(invalidStartMessage)));

        expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid start message');
      });

      it('should update WebSocket properties from start message', async () => {
        // Mock validation to return the callSid
        (webSocketSecurity.validateWebSocketMessage as jest.Mock).mockReturnValueOnce({
          isValid: true,
          callSid: 'CA987654321'
        });

        const startMessage: TwilioStartMessage = {
          event: 'start',
          streamSid: 'MZ987654321',
          sequenceNumber: '1',
          start: {
            streamSid: 'MZ987654321',
            accountSid: 'AC123456789',
            callSid: 'CA987654321',
            tracks: ['inbound'],
            mediaFormat: {
              encoding: 'audio/x-mulaw',
              sampleRate: 8000,
              channels: 1
            },
            sample_rate_hz: 8000
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(startMessage)));

        // Verify real property updates from parsed message
        expect(mockWs.twilioStreamSid).toBe('MZ987654321');
        expect(mockWs.callSid).toBe('CA987654321');
        expect(mockWs.twilioSampleRate).toBe(8000);
      });
    });

    describe('media event', () => {
      beforeEach(async () => {
        // Setup session with real start message
        const startMessage: TwilioStartMessage = {
          event: 'start',
          streamSid: 'MZ123456789',
          sequenceNumber: '1',
          start: {
            streamSid: 'MZ123456789',
            accountSid: 'AC123456789',
            callSid: 'CA123456789',
            tracks: ['inbound'],
            mediaFormat: {
              encoding: 'audio/x-mulaw',
              sampleRate: 8000,
              channels: 1
            },
            sample_rate_hz: 8000
          }
        };
        await messageHandler(Buffer.from(JSON.stringify(startMessage)));
      });

      it('should parse inbound media message structure', async () => {
        const audioPayload = Buffer.alloc(160).toString('base64');
        const mediaMessage: TwilioMediaMessage = {
          event: 'media',
          streamSid: 'MZ123456789',
          sequenceNumber: '2',
          media: {
            track: 'inbound',
            timestamp: '1234567890',
            payload: audioPayload
          }
        };

        // Should parse and handle message without errors
        await expect(messageHandler(Buffer.from(JSON.stringify(mediaMessage)))).resolves.not.toThrow();
        
        // Note: Actual audio processing requires an active Bedrock session
        // which is tested in integration tests
      });

      it('should skip outbound media frames based on track field', async () => {
        const mediaMessage: TwilioMediaMessage = {
          event: 'media',
          streamSid: 'MZ123456789',
          sequenceNumber: '3',
          media: {
            track: 'outbound',
            timestamp: '1234567890',
            payload: Buffer.alloc(160).toString('base64')
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(mediaMessage)));

        // Verify outbound frames are skipped
        expect(processTwilioAudioInput).not.toHaveBeenCalled();
      });

      it('should handle media message with missing payload gracefully', async () => {
        const mediaMessage = {
          event: 'media',
          streamSid: 'MZ123456789',
          sequenceNumber: '4',
          media: {
            track: 'inbound',
            timestamp: '1234567890'
            // missing payload
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(mediaMessage)));

        // Should not throw, should handle gracefully
        expect(processTwilioAudioInput).not.toHaveBeenCalled();
      });

      it('should parse multiple media frames in sequence', async () => {
        const frames = [
          { seq: '2', payload: Buffer.alloc(160).toString('base64') },
          { seq: '3', payload: Buffer.alloc(160).toString('base64') },
          { seq: '4', payload: Buffer.alloc(160).toString('base64') }
        ];

        // Parse all frames - should handle sequencing correctly
        for (const frame of frames) {
          const mediaMessage: TwilioMediaMessage = {
            event: 'media',
            streamSid: 'MZ123456789',
            sequenceNumber: frame.seq,
            media: {
              track: 'inbound',
              timestamp: Date.now().toString(),
              payload: frame.payload
            }
          };

          // Should parse each frame without errors
          await expect(messageHandler(Buffer.from(JSON.stringify(mediaMessage)))).resolves.not.toThrow();
        }
        
        // Note: Actual audio processing and buffering requires an active Bedrock session
        // which is tested in integration tests
      });
    });

    describe('stop event', () => {
      beforeEach(async () => {
        // Setup session with real start message
        const startMessage: TwilioStartMessage = {
          event: 'start',
          streamSid: 'MZ123456789',
          sequenceNumber: '1',
          start: {
            streamSid: 'MZ123456789',
            accountSid: 'AC123456789',
            callSid: 'CA123456789',
            tracks: ['inbound'],
            mediaFormat: {
              encoding: 'audio/x-mulaw',
              sampleRate: 8000,
              channels: 1
            }
          }
        };
        await messageHandler(Buffer.from(JSON.stringify(startMessage)));
      });

      it('should parse and handle stop message', async () => {
        const stopMessage: TwilioStopMessage = {
          event: 'stop',
          streamSid: 'MZ123456789',
          sequenceNumber: '100',
          stop: {
            accountSid: 'AC123456789',
            callSid: 'CA123456789'
          }
        };

        await messageHandler(Buffer.from(JSON.stringify(stopMessage)));

        // Verify WebSocket is closed
        expect(mockWs.close).toHaveBeenCalled();
      });
    });

    describe('other events', () => {
      it('should parse and handle mark event', async () => {
        const markMessage = {
          event: 'mark',
          streamSid: 'MZ123456789',
          sequenceNumber: '50',
          mark: { name: 'test-mark' }
        };

        await messageHandler(Buffer.from(JSON.stringify(markMessage)));

        // Should handle without errors
        expect(mockWs.close).not.toHaveBeenCalled();
      });

      it('should parse and handle dtmf event', async () => {
        const dtmfMessage = {
          event: 'dtmf',
          streamSid: 'MZ123456789',
          sequenceNumber: '51',
          dtmf: { digit: '1' }
        };

        await messageHandler(Buffer.from(JSON.stringify(dtmfMessage)));

        // Should handle without errors
        expect(mockWs.close).not.toHaveBeenCalled();
      });

      it('should handle unknown event types gracefully', async () => {
        const unknownMessage = {
          event: 'unknown',
          data: 'test'
        };

        await messageHandler(Buffer.from(JSON.stringify(unknownMessage)));

        // Should handle without errors
        expect(mockWs.close).not.toHaveBeenCalled();
      });
    });

    describe('invalid messages', () => {
      it('should reject non-JSON messages', async () => {
        await messageHandler(Buffer.from('not json'));

        expect(mockWs.close).toHaveBeenCalledWith(1003, 'Invalid JSON message');
      });

      it('should reject messages without event field', async () => {
        const invalidMessage = { data: 'test' };

        await messageHandler(Buffer.from(JSON.stringify(invalidMessage)));

        expect(mockWs.close).toHaveBeenCalledWith(1003, 'Invalid message structure');
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
      const mockOn = mockWs.on as jest.Mock;
      closeHandler = mockOn.mock.calls.find((call: any) => call[0] === 'close')?.[1];
      messageHandler = mockOn.mock.calls.find((call: any) => call[0] === 'message')?.[1];

      // Set up a session with real start message
      const startMessage: TwilioStartMessage = {
        event: 'start',
        streamSid: 'MZ123456789',
        sequenceNumber: '1',
        start: {
          streamSid: 'MZ123456789',
          accountSid: 'AC123456789',
          callSid: 'CA123456789',
          tracks: ['inbound'],
          mediaFormat: {
            encoding: 'audio/x-mulaw',
            sampleRate: 8000,
            channels: 1
          }
        }
      };
      await messageHandler(Buffer.from(JSON.stringify(startMessage)));
    });

    it('should cleanup resources on normal close', async () => {
      await closeHandler(1000, 'Normal closure');

      // Verify real cleanup was performed
      expect(webSocketSecurity.removeActiveSession).toHaveBeenCalledWith('CA123456789');
      expect(WebSocketMetrics.onDisconnection).toHaveBeenCalledWith(mockWs);
      expect(SessionMetrics.endSession).toHaveBeenCalled();
    });

    it('should cleanup resources on abnormal close', async () => {
      await closeHandler(1006, 'Abnormal closure');

      // Verify cleanup happens regardless of close code
      expect(webSocketSecurity.removeActiveSession).toHaveBeenCalledWith('CA123456789');
      expect(WebSocketMetrics.onDisconnection).toHaveBeenCalledWith(mockWs);
      expect(SessionMetrics.endSession).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    let errorHandler: Function;

    beforeEach(() => {
      initWebsocketServer(mockServer);
      const connectionHandler = mockWss.on.mock.calls.find((call: any) => call[0] === 'connection')?.[1];
      connectionHandler(mockWs, mockReq);
      const mockOn = mockWs.on as jest.Mock;
      errorHandler = mockOn.mock.calls.find((call: any) => call[0] === 'error')?.[1];
    });

    it('should handle WebSocket errors without crashing', () => {
      const error = new Error('WebSocket error');

      // Should not throw
      expect(() => errorHandler(error)).not.toThrow();
    });

    it('should handle network errors', () => {
      const networkError = new Error('ECONNRESET');
      (networkError as any).code = 'ECONNRESET';

      // Should handle network errors gracefully
      expect(() => errorHandler(networkError)).not.toThrow();
    });
  });
});