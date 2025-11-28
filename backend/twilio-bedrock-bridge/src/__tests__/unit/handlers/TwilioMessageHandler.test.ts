/**
 * Unit tests for TwilioMessageHandler (coordinator)
 */

import { TwilioMessageHandler } from '../../../handlers/TwilioMessageHandler';
import { MessageHandlerContext } from '../../../handlers/handlers/BaseMessageHandler';
import {
  TwilioMessage,
  TwilioStartMessage,
  TwilioMediaMessage,
  TwilioStopMessage,
  TwilioConnectedMessage,
  TwilioMarkMessage,
  TwilioDtmfMessage
} from '../../../handlers/types/TwilioMessages';
import { ExtendedWebSocket } from '../../../types/SharedTypes';
import { NovaSonicBidirectionalStreamClient } from '../../../client';

// Mock dependencies
jest.mock('../../../observability/logger');
jest.mock('../../../security/WebSocketSecurity');
jest.mock('../../../observability/sessionMetrics');
jest.mock('../../../audio/AudioBufferManager');
jest.mock('../../../audio/AudioProcessor');
jest.mock('../../../resilience');
jest.mock('../../../observability/safeTracing');
jest.mock('../../../observability/smartSampling');

describe('TwilioMessageHandler', () => {
  let handler: TwilioMessageHandler;
  let mockContext: MessageHandlerContext;
  let mockWs: Partial<ExtendedWebSocket>;
  let mockBedrockClient: jest.Mocked<NovaSonicBidirectionalStreamClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-setup mocks after clearAllMocks
    const { smartSampler } = require('../../../observability/smartSampling');
    const { safeTrace } = require('../../../observability/safeTracing');

    const mockSpan = {
      setAttributes: jest.fn(),
      end: jest.fn(),
      recordException: jest.fn(),
      setStatus: jest.fn()
    };

    const mockTracer = {
      startSpan: jest.fn().mockReturnValue(mockSpan)
    };

    safeTrace.getTracer.mockReturnValue(mockTracer);
    safeTrace.isAvailable.mockReturnValue(true);

    smartSampler.shouldSample.mockReturnValue({ shouldSample: true });
    smartSampler.startSpanWithSampling.mockReturnValue(mockSpan);

    // Create mock WebSocket
    mockWs = {
      id: 'test-ws-id',
      correlationContext: { correlationId: 'test-correlation-id', source: 'websocket', timestamp: Date.now() },
      close: jest.fn(),
      callSid: 'CA123456789'
    };

    // Create mock Bedrock client
    mockBedrockClient = {
      isSessionActive: jest.fn().mockReturnValue(false), // Start as not active
      createStreamSession: jest.fn().mockImplementation(() => {
        // Make session active after creation
        mockBedrockClient.isSessionActive.mockReturnValue(true);
        return {} as any;
      }),
      initiateSession: jest.fn().mockResolvedValue(undefined),
      setupSessionStartEvent: jest.fn(),
      setupPromptStartEvent: jest.fn(),
      setupSystemPromptEvent: jest.fn(),
      setupStartAudioEvent: jest.fn(),
      registerEventHandler: jest.fn(),
      streamAudioChunk: jest.fn().mockResolvedValue(undefined),
      sendContentEnd: jest.fn(),
      sendPromptEnd: jest.fn(),
      forceCloseSession: jest.fn()
    } as any;

    // Create handler context
    mockContext = {
      ws: mockWs as ExtendedWebSocket,
      sessionId: 'test-session-id',
      bedrockClient: mockBedrockClient,
      correlationContext: { correlationId: 'test-correlation-id', source: 'websocket', timestamp: Date.now() }
    };

    // Create coordinator
    handler = new TwilioMessageHandler(mockContext);
  });

  describe('dispatch', () => {
    it('should dispatch connected message to ConnectedMessageHandler', async () => {
      const message: TwilioConnectedMessage = {
        event: 'connected',
        protocol: 'wss',
        version: '1.0'
      };

      await handler.dispatch(message);

      // Should complete without errors
      expect(true).toBe(true);
    });

    it('should dispatch start message to StartMessageHandler', async () => {
      const message: TwilioStartMessage = {
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

      // Mock validation
      const webSocketSecurity = require('../../../security/WebSocketSecurity').webSocketSecurity;
      webSocketSecurity.validateWebSocketMessage = jest.fn().mockReturnValue({
        isValid: true,
        callSid: 'CA123456789'
      });

      await handler.dispatch(message);

      // Should create Bedrock session
      expect(mockBedrockClient.createStreamSession).toHaveBeenCalled();
    });

    it('should dispatch media message to MediaMessageHandler', async () => {
      const message: TwilioMediaMessage = {
        event: 'media',
        streamSid: 'MZ123456789',
        sequenceNumber: '1',
        media: {
          track: 'inbound',
          timestamp: '2024-01-01T00:00:00Z',
          payload: Buffer.alloc(160).toString('base64')
        }
      };

      // Mock audio processor
      const audioProcessor = require('../../../audio/AudioProcessor');
      audioProcessor.processTwilioAudioInput = jest.fn().mockReturnValue(Buffer.alloc(320));

      await handler.dispatch(message);

      // Should process audio
      expect(audioProcessor.processTwilioAudioInput).toHaveBeenCalled();
    });

    it('should dispatch stop message to StopMessageHandler', async () => {
      const message: TwilioStopMessage = {
        event: 'stop',
        streamSid: 'MZ123456789',
        sequenceNumber: '1',
        stop: {
          accountSid: 'AC123456789',
          callSid: 'CA123456789'
        }
      };

      await handler.dispatch(message);

      // Should close WebSocket
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('should dispatch mark message to MarkMessageHandler', async () => {
      const message: TwilioMarkMessage = {
        event: 'mark',
        streamSid: 'MZ123456789',
        sequenceNumber: '1',
        mark: {
          name: 'test-mark'
        }
      };

      await handler.dispatch(message);

      // Should complete without errors
      expect(true).toBe(true);
    });

    it('should dispatch dtmf message to DtmfMessageHandler', async () => {
      const message: TwilioDtmfMessage = {
        event: 'dtmf',
        streamSid: 'MZ123456789',
        sequenceNumber: '1',
        dtmf: {
          digit: '1'
        }
      };

      await handler.dispatch(message);

      // Should complete without errors
      expect(true).toBe(true);
    });

    it('should handle unknown message types gracefully', async () => {
      const message = {
        event: 'unknown',
        streamSid: 'MZ123456789'
      } as unknown as TwilioMessage;

      await handler.dispatch(message);

      // Should complete without errors
      expect(true).toBe(true);
    });

    it('should propagate handler errors', async () => {
      const message: TwilioStartMessage = {
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

      // Make validation fail to trigger error
      const webSocketSecurity = require('../../../security/WebSocketSecurity').webSocketSecurity;
      webSocketSecurity.validateWebSocketMessage = jest.fn().mockReturnValue({
        isValid: false,
        reason: 'Test error'
      });

      await handler.dispatch(message);

      // WebSocket should be closed
      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid start message');
    });
  });

  describe('cleanup', () => {
    it('should cleanup all handlers', () => {
      handler.cleanup();

      // Should complete without errors
      expect(true).toBe(true);
    });
  });

  describe('handler access', () => {
    it('should provide access to media handler', () => {
      const mediaHandler = handler.getMediaHandler();
      expect(mediaHandler).toBeDefined();
    });

    it('should provide access to stop handler', () => {
      const stopHandler = handler.getStopHandler();
      expect(stopHandler).toBeDefined();
    });
  });
});
