/**
 * Unit tests for MediaMessageHandler
 */

import { MediaMessageHandler } from '../../../handlers/handlers/MediaMessageHandler';
import { MessageHandlerContext } from '../../../handlers/handlers/BaseMessageHandler';
import { TwilioMediaMessage } from '../../../handlers/types/TwilioMessages';
import { ExtendedWebSocket } from '../../../types/SharedTypes';
import { NovaSonicBidirectionalStreamClient } from '../../../client';
import { processTwilioAudioInput } from '../../../audio/AudioProcessor';

// Mock dependencies
jest.mock('../../../audio/AudioProcessor');
jest.mock('../../../audio/AudioBufferManager');
jest.mock('../../../observability/safeTracing', () => ({
  safeTrace: {
    getTracer: jest.fn().mockReturnValue({
      startSpan: jest.fn().mockReturnValue({
        setAttributes: jest.fn(),
        end: jest.fn(),
        recordException: jest.fn(),
        setStatus: jest.fn()
      })
    }),
    isAvailable: jest.fn().mockReturnValue(true)
  }
}));
jest.mock('../../../observability/smartSampling', () => ({
  smartSampler: {
    shouldSample: jest.fn().mockReturnValue({ shouldSample: true }),
    startSpanWithSampling: jest.fn().mockReturnValue({
      setAttributes: jest.fn(),
      end: jest.fn(),
      recordException: jest.fn(),
      setStatus: jest.fn()
    })
  }
}));
jest.mock('../../../observability/logger');
jest.mock('../../../utils/asyncCorrelation', () => ({
  setTimeoutWithCorrelation: (fn: () => void, delay: number) => setTimeout(fn, delay)
}));

describe('MediaMessageHandler', () => {
  let handler: MediaMessageHandler;
  let mockContext: MessageHandlerContext;
  let mockWs: Partial<ExtendedWebSocket>;
  let mockBedrockClient: jest.Mocked<NovaSonicBidirectionalStreamClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

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
      isSessionActive: jest.fn().mockReturnValue(true),
      streamAudioChunk: jest.fn().mockResolvedValue(undefined),
      sendContentEnd: jest.fn(),
      sendPromptEnd: jest.fn()
    } as any;

    // Create handler context
    mockContext = {
      ws: mockWs as ExtendedWebSocket,
      sessionId: 'test-session-id',
      bedrockClient: mockBedrockClient,
      correlationContext: { correlationId: 'test-correlation-id', source: 'websocket', timestamp: Date.now() }
    };

    // Create handler
    handler = new MediaMessageHandler(mockContext);

    // Setup mock audio processor
    (processTwilioAudioInput as jest.Mock).mockReturnValue(Buffer.alloc(320));
  });

  afterEach(() => {
    jest.useRealTimers();
    handler.cleanup();
  });

  describe('handle', () => {
    const createMediaMessage = (track: string = 'inbound'): TwilioMediaMessage => ({
      event: 'media',
      streamSid: 'MZ123456789',
      sequenceNumber: '1',
      media: {
        track,
        timestamp: '2024-01-01T00:00:00Z',
        payload: Buffer.alloc(160).toString('base64')
      }
    });

    it('should process inbound audio frames', async () => {
      const message = createMediaMessage('inbound');
      await handler.handle(message);

      expect(processTwilioAudioInput).toHaveBeenCalled();
      expect(mockBedrockClient.streamAudioChunk).toHaveBeenCalledWith(
        'test-session-id',
        expect.any(Buffer)
      );
    });

    it('should skip outbound audio frames', async () => {
      const message = createMediaMessage('outbound');
      await handler.handle(message);

      expect(processTwilioAudioInput).not.toHaveBeenCalled();
      expect(mockBedrockClient.streamAudioChunk).not.toHaveBeenCalled();
    });

    it('should handle missing media payload', async () => {
      const message = {
        event: 'media',
        streamSid: 'MZ123456789',
        sequenceNumber: '1',
        media: {
          track: 'inbound',
          timestamp: '2024-01-01T00:00:00Z'
          // missing payload
        }
      } as TwilioMediaMessage;

      await handler.handle(message);

      expect(processTwilioAudioInput).not.toHaveBeenCalled();
    });

    it('should activate user turn on first audio', async () => {
      const message = createMediaMessage();
      await handler.handle(message);

      // Verify audio was sent
      expect(mockBedrockClient.streamAudioChunk).toHaveBeenCalled();
    });

    it('should reset silence timer on each audio frame', async () => {
      const message = createMediaMessage();

      await handler.handle(message);
      jest.advanceTimersByTime(1000);

      await handler.handle(message);
      jest.advanceTimersByTime(2500);

      // Turn should still be active (timer was reset)
      expect(mockBedrockClient.sendContentEnd).not.toHaveBeenCalled();

      // Now advance past timeout
      jest.advanceTimersByTime(1000);
      expect(mockBedrockClient.sendContentEnd).toHaveBeenCalled();
    });

    it('should end turn after silence timeout', async () => {
      const message = createMediaMessage();
      await handler.handle(message);

      // Advance time past silence timeout (3000ms)
      jest.advanceTimersByTime(3000);

      expect(mockBedrockClient.sendContentEnd).toHaveBeenCalledWith('test-session-id');

      // Advance additional 100ms for the promptEnd delay
      jest.advanceTimersByTime(100);

      expect(mockBedrockClient.sendPromptEnd).toHaveBeenCalledWith('test-session-id');
    });

    it('should handle processing errors gracefully', async () => {
      (processTwilioAudioInput as jest.Mock).mockImplementation(() => {
        throw new Error('Processing error');
      });

      const message = createMediaMessage();
      await handler.handle(message);

      // Should close WebSocket on processing error
      expect(mockWs.close).toHaveBeenCalledWith(1011, 'Audio processing error');
    });

    it('should skip processing if session is not active', async () => {
      mockBedrockClient.isSessionActive.mockReturnValue(false);

      const message = createMediaMessage();
      await handler.handle(message);

      // Should process audio but not send to Bedrock
      expect(processTwilioAudioInput).toHaveBeenCalled();
      expect(mockBedrockClient.streamAudioChunk).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should clear silence timer on cleanup', () => {
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

      handler.handle(message);
      handler.cleanup();

      // Advance time - turn should not end because timer was cleared
      jest.advanceTimersByTime(5000);
      expect(mockBedrockClient.sendContentEnd).not.toHaveBeenCalled();
    });
  });
});
