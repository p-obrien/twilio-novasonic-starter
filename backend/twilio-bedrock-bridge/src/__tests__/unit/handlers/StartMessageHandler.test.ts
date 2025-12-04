/**
 * Unit tests for StartMessageHandler
 */

// Mock dependencies BEFORE imports
jest.mock('../../../security/WebSocketSecurity');
jest.mock('../../../observability/sessionMetrics');
jest.mock('../../../audio/AudioBufferManager');
jest.mock('../../../audio/AudioProcessor');
jest.mock('../../../observability/logger');

import { StartMessageHandler } from '../../../handlers/handlers/StartMessageHandler';
import { MessageHandlerContext } from '../../../handlers/handlers/BaseMessageHandler';
import { TwilioStartMessage } from '../../../handlers/types/TwilioMessages';
import { ExtendedWebSocket } from '../../../types/SharedTypes';
import { NovaSonicBidirectionalStreamClient } from '../../../client';
import { webSocketSecurity } from '../../../security/WebSocketSecurity';
import * as resilience from '../../../resilience';

describe('StartMessageHandler', () => {
  let handler: StartMessageHandler;
  let mockContext: MessageHandlerContext;
  let mockWs: Partial<ExtendedWebSocket>;
  let mockBedrockClient: jest.Mocked<NovaSonicBidirectionalStreamClient>;

  beforeEach(() => {
    // Mock circuit breaker
    const mockCircuitBreaker = {
      execute: jest.fn((fn) => Promise.resolve(fn())),
      reset: jest.fn(),
      getState: jest.fn().mockReturnValue('CLOSED'),
      getMetrics: jest.fn().mockReturnValue({
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        rejectedCalls: 0
      })
    };
    jest.spyOn(resilience, 'getBedrockCircuitBreaker').mockReturnValue(mockCircuitBreaker as any);

    // Create mock WebSocket
    mockWs = {
      id: 'test-ws-id',
      correlationContext: { correlationId: 'test-correlation-id', source: 'websocket', timestamp: Date.now() },
      close: jest.fn(),
      callSid: undefined,
      twilioStreamSid: undefined,
      twilioSampleRate: undefined
    };

    // Create mock Bedrock client
    mockBedrockClient = {
      isSessionActive: jest.fn().mockReturnValue(false),
      createStreamSession: jest.fn(),
      initiateSession: jest.fn().mockResolvedValue(undefined),
      setupSessionStartEvent: jest.fn(),
      setupPromptStartEvent: jest.fn(),
      setupSystemPromptEvent: jest.fn(),
      setupStartAudioEvent: jest.fn(),
      sendTextInput: jest.fn(),
      queueTextInputEvents: jest.fn(),
      getSessionData: jest.fn().mockReturnValue({ queue: [] }),
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

    // Create handler
    handler = new StartMessageHandler(mockContext);

    // Setup default mock returns
    (webSocketSecurity.validateWebSocketMessage as jest.Mock).mockReturnValue({
      isValid: true,
      callSid: 'CA123456789'
    });
  });

  describe('handle', () => {
    const createValidStartMessage = (): TwilioStartMessage => ({
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
    });

    it('should validate start message', async () => {
      const message = createValidStartMessage();
      await handler.handle(message);

      expect(webSocketSecurity.validateWebSocketMessage).toHaveBeenCalledWith(message);
    });

    it('should close WebSocket if validation fails', async () => {
      (webSocketSecurity.validateWebSocketMessage as jest.Mock).mockReturnValue({
        isValid: false,
        reason: 'Invalid CallSid'
      });

      const message = createValidStartMessage();
      await handler.handle(message);

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid start message');
    });

    it('should update WebSocket properties', async () => {
      const message = createValidStartMessage();
      await handler.handle(message);

      expect(mockWs.twilioStreamSid).toBe('MZ123456789');
      expect(mockWs.twilioSampleRate).toBe(8000);
      expect(mockWs.callSid).toBe('CA123456789');
    });

    it('should create Bedrock session if not active', async () => {
      const message = createValidStartMessage();

      // Make session active after creation to allow setup to proceed
      mockBedrockClient.createStreamSession.mockImplementation(() => {
        mockBedrockClient.isSessionActive.mockReturnValue(true);
        return {} as any;
      });

      await handler.handle(message);

      expect(mockBedrockClient.createStreamSession).toHaveBeenCalledWith('test-session-id');

      // Note: initiateSession is called asynchronously in background (not awaited)
      // so we can't reliably test it was called in this synchronous test.
      // The important part is that createStreamSession was called.
    });

    it('should not create Bedrock session if already active', async () => {
      mockBedrockClient.isSessionActive.mockReturnValue(true);

      const message = createValidStartMessage();
      await handler.handle(message);

      expect(mockBedrockClient.createStreamSession).not.toHaveBeenCalled();
    });

    it('should setup session events in correct order and start stream after', async () => {
      const callOrder: string[] = [];
      
      // Track call order to verify events are queued BEFORE stream starts
      mockBedrockClient.createStreamSession.mockImplementation(() => {
        callOrder.push('createStreamSession');
        mockBedrockClient.isSessionActive.mockReturnValue(true);
        return {} as any;
      });
      mockBedrockClient.setupSessionStartEvent.mockImplementation(() => {
        callOrder.push('setupSessionStartEvent');
      });
      mockBedrockClient.setupPromptStartEvent.mockImplementation(() => {
        callOrder.push('setupPromptStartEvent');
      });
      mockBedrockClient.setupSystemPromptEvent.mockImplementation(() => {
        callOrder.push('setupSystemPromptEvent');
      });
      mockBedrockClient.setupStartAudioEvent.mockImplementation(() => {
        callOrder.push('setupStartAudioEvent');
      });
      mockBedrockClient.queueTextInputEvents.mockImplementation(() => {
        callOrder.push('queueTextInputEvents');
      });
      mockBedrockClient.initiateSession.mockImplementation(async () => {
        callOrder.push('initiateSession');
      });

      const message = createValidStartMessage();
      await handler.handle(message);

      // Verify events were queued with correct arguments
      expect(mockBedrockClient.setupSessionStartEvent).toHaveBeenCalledWith('test-session-id');
      expect(mockBedrockClient.setupPromptStartEvent).toHaveBeenCalledWith('test-session-id');
      expect(mockBedrockClient.setupSystemPromptEvent).toHaveBeenCalledWith(
        'test-session-id',
        expect.any(Object),
        expect.any(String)
      );
      expect(mockBedrockClient.setupStartAudioEvent).toHaveBeenCalledWith(
        'test-session-id',
        expect.any(Object)
      );
      expect(mockBedrockClient.queueTextInputEvents).toHaveBeenCalledWith(
        'test-session-id',
        expect.stringContaining('Please say this greeting to the caller:')
      );

      // CRITICAL: Verify initiateSession is called AFTER all events are queued
      // This is essential for speaks-first greeting to work correctly
      const initiateIndex = callOrder.indexOf('initiateSession');
      const lastEventIndex = callOrder.indexOf('queueTextInputEvents');
      expect(initiateIndex).toBeGreaterThan(lastEventIndex);
      
      // Verify the complete call order
      expect(callOrder).toEqual([
        'createStreamSession',
        'setupSessionStartEvent',
        'setupPromptStartEvent',
        'setupSystemPromptEvent',
        'setupStartAudioEvent',
        'queueTextInputEvents',
        'initiateSession'
      ]);
    });

    it('should register event handlers', async () => {
      // Mock createStreamSession to make session active
      mockBedrockClient.createStreamSession.mockImplementation(() => {
        mockBedrockClient.isSessionActive.mockReturnValue(true);
        return {} as any;
      });

      const message = createValidStartMessage();
      await handler.handle(message);

      // Verify event handlers were registered
      expect(mockBedrockClient.registerEventHandler).toHaveBeenCalledWith(
        'test-session-id',
        'contentEnd',
        expect.any(Function)
      );
      expect(mockBedrockClient.registerEventHandler).toHaveBeenCalledWith(
        'test-session-id',
        'audioOutput',
        expect.any(Function)
      );
    });

    it('should guarantee stream starts only after all events are queued (speaks-first fix)', async () => {
      let streamStarted = false;
      let eventsQueuedBeforeStream = true;

      mockBedrockClient.createStreamSession.mockImplementation(() => {
        mockBedrockClient.isSessionActive.mockReturnValue(true);
        return {} as any;
      });

      // Track if events are queued before stream starts
      mockBedrockClient.setupSessionStartEvent.mockImplementation(() => {
        if (streamStarted) eventsQueuedBeforeStream = false;
      });
      mockBedrockClient.setupPromptStartEvent.mockImplementation(() => {
        if (streamStarted) eventsQueuedBeforeStream = false;
      });
      mockBedrockClient.setupSystemPromptEvent.mockImplementation(() => {
        if (streamStarted) eventsQueuedBeforeStream = false;
      });
      mockBedrockClient.setupStartAudioEvent.mockImplementation(() => {
        if (streamStarted) eventsQueuedBeforeStream = false;
      });
      mockBedrockClient.queueTextInputEvents.mockImplementation(() => {
        if (streamStarted) eventsQueuedBeforeStream = false;
      });

      mockBedrockClient.initiateSession.mockImplementation(async () => {
        streamStarted = true;
      });

      const message = createValidStartMessage();
      await handler.handle(message);

      // All events must be queued before stream starts
      expect(eventsQueuedBeforeStream).toBe(true);
      expect(streamStarted).toBe(true);
    });

    it('should handle missing WebSocket ID', async () => {
      mockContext.ws.id = undefined;

      const message = createValidStartMessage();
      await handler.handle(message);

      // Should not create session if ws.id is missing
      expect(mockBedrockClient.createStreamSession).not.toHaveBeenCalled();
    });
  });
});
