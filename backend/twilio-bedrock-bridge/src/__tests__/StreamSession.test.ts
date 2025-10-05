/**
 * Tests for StreamSession class
 */

import { StreamSession, StreamClientInterface } from '../session/StreamSession';
import { AudioStreamOptions } from '../types/ClientTypes';

// Mock dependencies
jest.mock('../utils/logger');
jest.mock('../utils/correlationId', () => ({
  CorrelationIdManager: {
    getCurrentContext: jest.fn().mockReturnValue({ correlationId: 'parent-correlation-id' }),
    createBedrockContext: jest.fn().mockReturnValue({ correlationId: 'bedrock-correlation-id' }),
    setContext: jest.fn(),
    getCurrentCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
    traceWithCorrelation: jest.fn().mockImplementation((name: string, fn: () => any) => fn())
  }
}));

describe('StreamSession', () => {
  let mockClient: jest.Mocked<StreamClientInterface>;
  let session: StreamSession;
  const sessionId = 'test-session-id';

  beforeEach(() => {
    mockClient = {
      isSessionActive: jest.fn().mockReturnValue(true),
      setupPromptStartEvent: jest.fn(),
      setupSystemPromptEvent: jest.fn(),
      setupStartAudioEvent: jest.fn(),
      registerEventHandler: jest.fn(),
      streamAudioChunk: jest.fn().mockResolvedValue(undefined),
      sendContentEnd: jest.fn(),
      sendPromptEnd: jest.fn(),
      sendSessionEnd: jest.fn(),
      removeStreamSession: jest.fn(),
      enableRealtimeInterruption: jest.fn(),
      handleUserInterruption: jest.fn(),
      setUserSpeakingState: jest.fn(),
      streamAudioRealtime: jest.fn().mockResolvedValue(undefined)
    };

    session = new StreamSession(sessionId, mockClient);
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create session with proper initialization', () => {
      expect(session.getSessionId()).toBe(sessionId);
    });

    it('should set up Bedrock correlation context', () => {
      const { CorrelationIdManager } = require('../utils/correlationId');
      
      // Create a new session to trigger the correlation setup
      const testSession = new StreamSession('test-correlation-session', mockClient);
      
      expect(CorrelationIdManager.createBedrockContext).toHaveBeenCalledWith(
        'test-correlation-session',
        { correlationId: 'parent-correlation-id' }
      );
      expect(CorrelationIdManager.setContext).toHaveBeenCalledWith({
        correlationId: 'bedrock-correlation-id'
      });
    });

    it('should throw error for invalid session ID', () => {
      expect(() => new StreamSession('', mockClient)).toThrow('Session ID must be a non-empty string');
    });

    it('should throw error for missing client', () => {
      expect(() => new StreamSession(sessionId, null as any)).toThrow('Client interface is required');
    });
  });

  describe('Session Setup Methods', () => {
    describe('setupPromptStart', () => {
      it('should call client setupPromptStartEvent', () => {
        session.setupPromptStart();

        expect(mockClient.setupPromptStartEvent).toHaveBeenCalledWith(sessionId);
      });
    });

    describe('setupSystemPrompt', () => {
      it('should call client setupSystemPromptEvent with defaults', () => {
        session.setupSystemPrompt();

        expect(mockClient.setupSystemPromptEvent).toHaveBeenCalledWith(
          sessionId,
          expect.any(Object), // DefaultTextConfiguration
          expect.any(String)  // DefaultSystemPrompt
        );
      });

      it('should call client setupSystemPromptEvent with custom parameters', () => {
        const customTextConfig = { mediaType: 'text/plain' };
        const customPrompt = 'Custom system prompt';

        session.setupSystemPrompt(customTextConfig as any, customPrompt);

        expect(mockClient.setupSystemPromptEvent).toHaveBeenCalledWith(
          sessionId,
          customTextConfig,
          customPrompt
        );
      });
    });

    describe('setupStartAudio', () => {
      it('should call client setupStartAudioEvent with defaults', () => {
        session.setupStartAudio();

        expect(mockClient.setupStartAudioEvent).toHaveBeenCalledWith(
          sessionId,
          expect.any(Object) // DefaultAudioInputConfiguration
        );
      });

      it('should call client setupStartAudioEvent with custom config', () => {
        const customAudioConfig = { sampleRateHertz: 16000 };

        session.setupStartAudio(customAudioConfig as any);

        expect(mockClient.setupStartAudioEvent).toHaveBeenCalledWith(
          sessionId,
          customAudioConfig
        );
      });
    });
  });

  describe('Audio Streaming Methods', () => {
    describe('streamAudio', () => {
      it('should stream audio data through client', async () => {
        const audioData = Buffer.from('test-audio-data');

        await session.streamAudio(audioData);

        expect(mockClient.streamAudioChunk).toHaveBeenCalledWith(sessionId, audioData);
      });

      it('should not stream if session is inactive', async () => {
        const audioData = Buffer.from('test-audio-data');
        
        // Close session first
        await session.close();

        await expect(session.streamAudio(audioData)).rejects.toThrow('Session test-session-id is inactive');
      });

      it('should handle non-buffer input', async () => {
        await expect(session.streamAudio('not-a-buffer' as any)).rejects.toThrow('Audio data must be a Buffer');
      });
    });

    describe('streamAudioRealtime', () => {
      it('should stream audio in real-time mode', async () => {
        const audioData = Buffer.from('realtime-audio-data');

        await session.streamAudioRealtime(audioData);

        expect(mockClient.streamAudioRealtime).toHaveBeenCalledWith(sessionId, audioData);
      });

      it('should not stream if session is inactive', async () => {
        const audioData = Buffer.from('realtime-audio-data');
        
        // Close session first
        await session.close();

        await expect(session.streamAudioRealtime(audioData)).rejects.toThrow('Session test-session-id is inactive');
      });
    });
  });

  describe('Audio Output Buffer Methods', () => {
    describe('bufferAudioOutput', () => {
      it('should buffer audio output data', () => {
        const audioData = Buffer.from('output-audio-data');

        session.bufferAudioOutput(audioData);

        expect(session.getOutputBufferSize()).toBe(1);
      });

      it('should not buffer if session is inactive', async () => {
        const audioData = Buffer.from('output-audio-data');
        
        // Close session first
        await session.close();

        session.bufferAudioOutput(audioData);

        expect(session.getOutputBufferSize()).toBe(0);
      });

      it('should manage output buffer size limits', () => {
        const audioData = Buffer.from('output-audio-data');

        // Buffer many chunks to test size management
        for (let i = 0; i < 1000; i++) {
          session.bufferAudioOutput(audioData);
        }

        // Should not exceed maximum buffer size
        expect(session.getOutputBufferSize()).toBeLessThan(1000);
      });
    });

    describe('getNextAudioOutput', () => {
      it('should return next audio chunk from buffer', () => {
        const audioData1 = Buffer.from('audio-1');
        const audioData2 = Buffer.from('audio-2');

        session.bufferAudioOutput(audioData1);
        session.bufferAudioOutput(audioData2);

        const firstChunk = session.getNextAudioOutput();
        const secondChunk = session.getNextAudioOutput();
        const thirdChunk = session.getNextAudioOutput();

        expect(firstChunk).toEqual(audioData1);
        expect(secondChunk).toEqual(audioData2);
        expect(thirdChunk).toBeNull();
      });

      it('should return null when buffer is empty', () => {
        const chunk = session.getNextAudioOutput();

        expect(chunk).toBeNull();
      });
    });

    describe('clearOutputBuffer', () => {
      it('should clear all buffered audio output', () => {
        const audioData = Buffer.from('output-audio-data');

        session.bufferAudioOutput(audioData);
        session.bufferAudioOutput(audioData);
        expect(session.getOutputBufferSize()).toBe(2);

        session.clearOutputBuffer();

        expect(session.getOutputBufferSize()).toBe(0);
        expect(session.getNextAudioOutput()).toBeNull();
      });
    });
  });

  describe('Conversation Control Methods', () => {
    describe('endAudioContent', () => {
      it('should call client sendContentEnd', () => {
        session.endAudioContent();

        expect(mockClient.sendContentEnd).toHaveBeenCalledWith(sessionId);
      });

      it('should not call client if session is inactive', async () => {
        await session.close();

        expect(() => session.endAudioContent()).toThrow('Failed to end audio content stream');
      });
    });

    describe('endPrompt', () => {
      it('should call client sendPromptEnd', () => {
        session.endPrompt();

        expect(mockClient.sendPromptEnd).toHaveBeenCalledWith(sessionId);
      });

      it('should not call client if session is inactive', async () => {
        await session.close();

        expect(() => session.endPrompt()).toThrow('Failed to end prompt');
      });
    });

    describe('endUserTurn', () => {
      it('should end audio content and prompt', () => {
        session.endUserTurn();

        expect(mockClient.sendContentEnd).toHaveBeenCalledWith(sessionId);
        expect(mockClient.sendPromptEnd).toHaveBeenCalledWith(sessionId);
      });

      it('should handle errors gracefully', () => {
        mockClient.sendContentEnd.mockImplementation(() => {
          throw new Error('Test error');
        });

        expect(() => session.endUserTurn()).toThrow('Failed to end user turn');
      });

      it('should not call client methods if session is inactive', async () => {
        await session.close();

        session.endUserTurn();

        expect(mockClient.sendContentEnd).not.toHaveBeenCalled();
        expect(mockClient.sendPromptEnd).not.toHaveBeenCalled();
      });
    });

    describe('interruptModel', () => {
      it('should call client handleUserInterruption', () => {
        session.interruptModel();

        expect(mockClient.handleUserInterruption).toHaveBeenCalledWith(sessionId);
      });

      it('should not call client if session is inactive', async () => {
        await session.close();

        session.interruptModel();

        expect(mockClient.handleUserInterruption).not.toHaveBeenCalled();
      });
    });

    describe('setUserSpeaking', () => {
      it('should call client setUserSpeakingState', () => {
        session.setUserSpeaking(true);

        expect(mockClient.setUserSpeakingState).toHaveBeenCalledWith(sessionId, true);
      });

      it('should not call client if session is inactive', async () => {
        await session.close();

        session.setUserSpeaking(true);

        expect(mockClient.setUserSpeakingState).not.toHaveBeenCalled();
      });
    });
  });

  describe('Real-time Features', () => {
    describe('enableRealtimeMode', () => {
      it('should call client enableRealtimeInterruption', () => {
        session.enableRealtimeMode();

        expect(mockClient.enableRealtimeInterruption).toHaveBeenCalledWith(sessionId);
      });

      it('should not call client if session is inactive', async () => {
        await session.close();

        session.enableRealtimeMode();

        expect(mockClient.enableRealtimeInterruption).not.toHaveBeenCalled();
      });
    });
  });

  describe('Event Handling', () => {
    describe('onEvent', () => {
      it('should register event handler and return session for chaining', () => {
        const handler = jest.fn();

        const result = session.onEvent('audioOutput', handler);

        expect(mockClient.registerEventHandler).toHaveBeenCalledWith(
          sessionId,
          'audioOutput',
          handler
        );
        expect(result).toBe(session);
      });

      it('should allow method chaining', () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();

        const result = session
          .onEvent('audioOutput', handler1)
          .onEvent('contentEnd', handler2);

        expect(result).toBe(session);
        expect(mockClient.registerEventHandler).toHaveBeenCalledTimes(2);
      });

      it('should throw error for invalid event type', () => {
        const handler = jest.fn();

        expect(() => session.onEvent('' as any, handler)).toThrow('Event type must be a non-empty string');
      });

      it('should throw error for invalid handler', () => {
        expect(() => session.onEvent('audioOutput', null as any)).toThrow('Event handler must be a function');
      });
    });
  });

  describe('Session Lifecycle', () => {
    describe('close', () => {
      it('should close session and cleanup resources', async () => {
        await session.close();

        expect(mockClient.sendSessionEnd).toHaveBeenCalledWith(sessionId);
      });

      it('should handle multiple close calls gracefully', async () => {
        await session.close();
        await session.close(); // Second close should not throw

        // Should only call cleanup methods once
        expect(mockClient.sendSessionEnd).toHaveBeenCalledTimes(1);
      });

      it('should handle cleanup errors gracefully', async () => {
        mockClient.sendSessionEnd.mockImplementation(() => {
          throw new Error('Cleanup error');
        });

        await expect(session.close()).rejects.toThrow('Failed to close session cleanly');
      });

      it('should clear audio buffers on close', async () => {
        const audioData = Buffer.from('test-audio');
        
        session.bufferAudioOutput(audioData);
        expect(session.getOutputBufferSize()).toBe(1);

        await session.close();

        expect(session.getOutputBufferSize()).toBe(0);
      });
    });

    describe('isSessionActive', () => {
      it('should return true when session and client are active', () => {
        expect(session.isSessionActive()).toBe(true);
      });

      it('should return false when session is closed', async () => {
        await session.close();

        expect(session.isSessionActive()).toBe(false);
      });

      it('should return false when client session is inactive', () => {
        mockClient.isSessionActive.mockReturnValue(false);

        expect(session.isSessionActive()).toBe(false);
      });
    });
  });

  describe('Statistics and Monitoring', () => {
    describe('getAudioQueueStats', () => {
      it('should return comprehensive queue statistics', () => {
        const stats = session.getAudioQueueStats();

        expect(stats).toHaveProperty('queueLength');
        expect(stats).toHaveProperty('outputBufferLength');
        expect(stats).toHaveProperty('isProcessing');
        expect(stats).toHaveProperty('maxQueueSize');
        expect(stats).toHaveProperty('maxOutputBufferSize');
      });
    });

    describe('getRealtimeState', () => {
      it('should return real-time conversation state', () => {
        const state = session.getRealtimeState();

        expect(state).toHaveProperty('realtimeMode');
        expect(state).toHaveProperty('userSpeaking');
        expect(state).toHaveProperty('conversationState');
        expect(state).toHaveProperty('clientCapabilities');
      });
    });

    describe('getMemoryStats', () => {
      it('should return memory usage statistics', () => {
        const stats = session.getMemoryStats();

        expect(stats).toHaveProperty('inputBufferBytes');
        expect(stats).toHaveProperty('outputBufferBytes');
        expect(stats).toHaveProperty('totalBufferBytes');
        expect(stats).toHaveProperty('memoryPressure');
        expect(stats).toHaveProperty('utilizationPercent');
      });
    });

    describe('getDiagnostics', () => {
      it('should return comprehensive diagnostics', () => {
        const diagnostics = session.getDiagnostics();

        expect(diagnostics).toHaveProperty('sessionInfo');
        expect(diagnostics).toHaveProperty('performance');
        expect(diagnostics).toHaveProperty('memoryStats');
        expect(diagnostics).toHaveProperty('queueStats');
        expect(diagnostics).toHaveProperty('realtimeStats');
        expect(diagnostics).toHaveProperty('configuration');
      });
    });
  });

  describe('Buffer Management', () => {
    it('should handle output buffer overflow by dropping oldest chunks', () => {
      const audioData = Buffer.from('test-audio-data');

      // Buffer many chunks to trigger overflow
      for (let i = 0; i < 1000; i++) {
        session.bufferAudioOutput(audioData);
      }

      // Buffer size should be limited
      const bufferSize = session.getOutputBufferSize();
      expect(bufferSize).toBeLessThan(1000);
      expect(bufferSize).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle client method errors gracefully', async () => {
      mockClient.streamAudioChunk.mockRejectedValue(new Error('Stream error'));
      const audioData = Buffer.from('test-audio-data');

      await expect(session.streamAudio(audioData)).resolves.not.toThrow();
    });

    it('should handle client unavailability', () => {
      mockClient.isSessionActive.mockReturnValue(false);

      session.endUserTurn();

      // Should not call client methods when session is not active
      expect(mockClient.sendContentEnd).not.toHaveBeenCalled();
      expect(mockClient.sendPromptEnd).not.toHaveBeenCalled();
    });
  });

  describe('Configuration Options', () => {
    it('should accept custom audio stream options', () => {
      const options: AudioStreamOptions = {
        maxQueueSize: 50,
        maxChunksPerBatch: 3,
        maxOutputBufferSize: 100,
        processingTimeoutMs: 200,
        dropOldestOnFull: false
      };

      const customSession = new StreamSession('custom-session', mockClient, options);
      const stats = customSession.getAudioQueueStats();

      expect(stats.maxQueueSize).toBe(50);
      expect(stats.maxChunksPerBatch).toBe(3);
      expect(stats.maxOutputBufferSize).toBe(100);
      expect(stats.processingTimeoutMs).toBe(200);
      expect(stats.dropOldestOnFull).toBe(false);
    });

    it('should validate configuration values', () => {
      const invalidOptions: AudioStreamOptions = {
        maxQueueSize: -1,
        maxChunksPerBatch: 0,
        maxOutputBufferSize: -5
      };

      expect(() => new StreamSession('invalid-session', mockClient, invalidOptions))
        .toThrow('Buffer size configurations must be positive integers');
    });
  });
});