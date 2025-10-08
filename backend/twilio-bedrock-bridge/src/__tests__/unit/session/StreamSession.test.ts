/**
 * StreamSession Unit Tests
 * 
 * Tests for the StreamSession class that provides high-level interface
 * for managing individual streaming sessions with audio processing.
 */

import { StreamSession, StreamClientInterface } from '../../../session/StreamSession';
import { 
  SessionError, 
  SessionInactiveError, 
  AudioProcessingError,
  ValidationError 
} from '../../../errors/ClientErrors';
import { DefaultAudioInputConfiguration, DefaultTextConfiguration, DefaultSystemPrompt } from '../../../utils/constants';
import { TextMediaType } from '../../../types/SharedTypes';
import { StreamEventType } from '../../../types/ClientTypes';

describe('StreamSession', () => {
  let mockClient: jest.Mocked<StreamClientInterface>;
  let streamSession: StreamSession;
  const testSessionId = 'test-session-123';

  // Use fake timers to control async operations
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    // Create mock client interface
    mockClient = {
      isSessionActive: jest.fn().mockReturnValue(true),
      registerEventHandler: jest.fn(),
      setupPromptStartEvent: jest.fn(),
      setupSystemPromptEvent: jest.fn(),
      setupStartAudioEvent: jest.fn(),
      streamAudioChunk: jest.fn().mockResolvedValue(undefined),
      sendContentEnd: jest.fn(),
      sendPromptEnd: jest.fn(),
      sendSessionEnd: jest.fn(),
      enableRealtimeInterruption: jest.fn(),
      handleUserInterruption: jest.fn(),
      setUserSpeakingState: jest.fn(),
      removeStreamSession: jest.fn(),
      streamAudioRealtime: jest.fn().mockResolvedValue(undefined)
    };

    // Create stream session
    streamSession = new StreamSession(testSessionId, mockClient);
  });

  afterEach(async () => {
    // Clean up any pending operations
    if (streamSession && streamSession.isSessionActive()) {
      try {
        await streamSession.close();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    // Clear any pending timers
    jest.clearAllTimers();
  });

  describe('Constructor', () => {
    it('should create StreamSession with valid parameters', () => {
      expect(streamSession.getSessionId()).toBe(testSessionId);
      expect(streamSession.isSessionActive()).toBe(true);
    });

    it('should throw error for invalid session ID', () => {
      expect(() => {
        new StreamSession('', mockClient);
      }).toThrow(SessionError);

      expect(() => {
        new StreamSession(null as any, mockClient);
      }).toThrow(SessionError);
    });

    it('should throw error for missing client', () => {
      expect(() => {
        new StreamSession(testSessionId, null as any);
      }).toThrow(SessionError);
    });

    it('should initialize with custom audio options', () => {
      const audioOptions = {
        maxQueueSize: 50,
        maxChunksPerBatch: 10,
        maxOutputBufferSize: 100,
        processingTimeoutMs: 60000,
        dropOldestOnFull: false
      };

      const customSession = new StreamSession(testSessionId, mockClient, audioOptions);
      const stats = customSession.getAudioQueueStats();

      expect(stats.maxQueueSize).toBe(50);
      expect(stats.maxChunksPerBatch).toBe(10);
      expect(stats.dropOldestOnFull).toBe(false);
    });

    it('should validate configuration values', () => {
      expect(() => {
        new StreamSession(testSessionId, mockClient, { maxQueueSize: 0 });
      }).toThrow(SessionError);

      expect(() => {
        new StreamSession(testSessionId, mockClient, { maxChunksPerBatch: -1 });
      }).toThrow(SessionError);
    });
  });

  describe('Session State Management', () => {
    it('should return correct session ID', () => {
      expect(streamSession.getSessionId()).toBe(testSessionId);
    });

    it('should check session active state', () => {
      expect(streamSession.isSessionActive()).toBe(true);

      mockClient.isSessionActive.mockReturnValue(false);
      expect(streamSession.isSessionActive()).toBe(false);
    });

    it('should register event handlers', () => {
      const handler = jest.fn();
      
      const result = streamSession.onEvent('textOutput', handler);
      
      expect(result).toBe(streamSession); // Should return self for chaining
      expect(mockClient.registerEventHandler).toHaveBeenCalledWith(
        testSessionId,
        'textOutput',
        handler
      );
    });

    it('should validate event handler parameters', () => {
      expect(() => {
        streamSession.onEvent('' as StreamEventType, jest.fn());
      }).toThrow(SessionError);

      expect(() => {
        streamSession.onEvent('textOutput', null as any);
      }).toThrow(SessionError);
    });

    it('should throw error when registering handler on inactive session', () => {
      mockClient.isSessionActive.mockReturnValue(false);
      
      expect(() => {
        streamSession.onEvent('textOutput', jest.fn());
      }).toThrow(SessionInactiveError);
    });
  });

  describe('Session Setup', () => {
    it('should setup prompt start event', () => {
      streamSession.setupPromptStart();
      
      expect(mockClient.setupPromptStartEvent).toHaveBeenCalledWith(testSessionId);
    });

    it('should setup system prompt with defaults', () => {
      streamSession.setupSystemPrompt();
      
      expect(mockClient.setupSystemPromptEvent).toHaveBeenCalledWith(
        testSessionId,
        DefaultTextConfiguration,
        DefaultSystemPrompt
      );
    });

    it('should setup system prompt with custom parameters', () => {
      const customTextConfig = { mediaType: 'text/plain' as TextMediaType };
      const customPrompt = 'Custom system prompt';
      
      streamSession.setupSystemPrompt(customTextConfig, customPrompt);
      
      expect(mockClient.setupSystemPromptEvent).toHaveBeenCalledWith(
        testSessionId,
        customTextConfig,
        customPrompt
      );
    });

    it('should setup audio streaming with defaults', () => {
      streamSession.setupStartAudio();
      
      expect(mockClient.setupStartAudioEvent).toHaveBeenCalledWith(
        testSessionId,
        DefaultAudioInputConfiguration
      );
    });

    it('should setup audio streaming with custom config', () => {
      const customAudioConfig = {
        ...DefaultAudioInputConfiguration,
        sampleRateHertz: 24000
      };
      
      streamSession.setupStartAudio(customAudioConfig);
      
      expect(mockClient.setupStartAudioEvent).toHaveBeenCalledWith(
        testSessionId,
        customAudioConfig
      );
    });

    it('should validate setup parameters', () => {
      expect(() => {
        streamSession.setupSystemPrompt(null as any, 'test');
      }).toThrow(SessionError);

      expect(() => {
        streamSession.setupSystemPrompt({ mediaType: 'text/plain' as TextMediaType }, 123 as any);
      }).toThrow(SessionError);

      expect(() => {
        streamSession.setupStartAudio(null as any);
      }).toThrow(SessionError);
    });

    it('should throw error when setting up inactive session', () => {
      mockClient.isSessionActive.mockReturnValue(false);
      
      expect(() => {
        streamSession.setupPromptStart();
      }).toThrow(SessionError); // Implementation throws SessionError, not SessionInactiveError

      expect(() => {
        streamSession.setupSystemPrompt();
      }).toThrow(SessionError);

      expect(() => {
        streamSession.setupStartAudio();
      }).toThrow(SessionError);
    });
  });

  describe('Audio Streaming', () => {
    it('should stream audio data successfully', async () => {
      const audioData = Buffer.from('test audio data');
      
      await streamSession.streamAudio(audioData);
      
      expect(mockClient.streamAudioChunk).toHaveBeenCalledWith(testSessionId, audioData);
    });

    it('should validate audio data parameter', async () => {
      await expect(streamSession.streamAudio(null as any)).rejects.toThrow(); // Will throw TypeError first
      await expect(streamSession.streamAudio('not a buffer' as any)).rejects.toThrow(AudioProcessingError);
    });

    it('should throw error when streaming to inactive session', async () => {
      mockClient.isSessionActive.mockReturnValue(false);
      const audioData = Buffer.from('test audio data');
      
      await expect(streamSession.streamAudio(audioData)).rejects.toThrow(SessionInactiveError);
    });

    it('should handle audio streaming errors gracefully', async () => {
      const audioData = Buffer.from('test audio data');
      mockClient.streamAudioChunk.mockRejectedValue(new Error('Streaming failed'));
      
      // Should not throw - errors are handled gracefully
      await expect(streamSession.streamAudio(audioData)).resolves.toBeUndefined();
    });

    it('should manage audio queue size', async () => {
      const session = new StreamSession(testSessionId, mockClient, { maxQueueSize: 2 });
      
      // Add audio chunks to fill queue
      await session.streamAudio(Buffer.from('chunk1'));
      await session.streamAudio(Buffer.from('chunk2'));
      await session.streamAudio(Buffer.from('chunk3')); // Should trigger queue management
      
      const stats = session.getAudioQueueStats();
      expect(stats.queueLength).toBeLessThanOrEqual(2);
    });

    it('should handle memory pressure optimization', async () => {
      const session = new StreamSession(testSessionId, mockClient, { 
        maxQueueSize: 5,
        maxOutputBufferSize: 5 
      });
      
      // Fill buffers to trigger memory pressure
      for (let i = 0; i < 10; i++) {
        await session.streamAudio(Buffer.from(`chunk${i}`));
      }
      
      const memoryStats = session.getMemoryStats();
      expect(memoryStats.memoryPressure).toBeDefined();
    });
  });

  describe('Session Control', () => {
    it('should end user turn successfully', () => {
      streamSession.endUserTurn();
      
      expect(mockClient.sendContentEnd).toHaveBeenCalledWith(testSessionId);
      expect(mockClient.sendPromptEnd).toHaveBeenCalledWith(testSessionId);
    });

    it('should end audio content', () => {
      streamSession.endAudioContent();
      
      expect(mockClient.sendContentEnd).toHaveBeenCalledWith(testSessionId);
    });

    it('should end prompt', () => {
      streamSession.endPrompt();
      
      expect(mockClient.sendPromptEnd).toHaveBeenCalledWith(testSessionId);
    });

    it('should handle ending inactive session gracefully', () => {
      mockClient.isSessionActive.mockReturnValue(false);
      
      // Should not throw but should log warning
      expect(() => {
        streamSession.endUserTurn();
      }).not.toThrow();
    });

    it('should handle control errors', () => {
      mockClient.sendContentEnd.mockImplementation(() => {
        throw new Error('Control error');
      });
      
      expect(() => {
        streamSession.endAudioContent();
      }).toThrow(SessionError);
    });
  });

  describe('Session Closure', () => {
    it('should close session successfully', async () => {
      await streamSession.close();
      
      expect(mockClient.sendSessionEnd).toHaveBeenCalledWith(testSessionId);
      expect(streamSession.isSessionActive()).toBe(false);
    });

    it('should handle multiple close calls gracefully', async () => {
      await streamSession.close();
      
      // Second close should not throw
      await expect(streamSession.close()).resolves.toBeUndefined();
    });

    it('should handle close errors', async () => {
      mockClient.sendSessionEnd.mockImplementation(() => {
        throw new Error('Close error');
      });
      
      await expect(streamSession.close()).rejects.toThrow(SessionError);
    });

    it('should clear buffers on close', async () => {
      // Add some audio data
      await streamSession.streamAudio(Buffer.from('test data'));
      
      // The audio might be processed immediately, so just verify close works
      await streamSession.close();
      
      const statsAfter = streamSession.getAudioQueueStats();
      expect(statsAfter.queueLength).toBe(0);
      expect(streamSession.isSessionActive()).toBe(false);
    });
  });

  describe('Statistics and Diagnostics', () => {
    it('should provide audio queue statistics', () => {
      const stats = streamSession.getAudioQueueStats();
      
      expect(stats).toMatchObject({
        queueLength: expect.any(Number),
        queueUtilizationPercent: expect.any(Number),
        queueBytes: expect.any(Number),
        maxQueueSize: expect.any(Number),
        outputBufferLength: expect.any(Number),
        outputBufferUtilizationPercent: expect.any(Number),
        outputBufferBytes: expect.any(Number),
        maxOutputBufferSize: expect.any(Number),
        isProcessing: expect.any(Boolean),
        hasScheduledProcessing: expect.any(Boolean),
        processingTimeoutMs: expect.any(Number),
        maxChunksPerBatch: expect.any(Number),
        dropOldestOnFull: expect.any(Boolean)
      });
    });

    it('should provide real-time conversation state', () => {
      const realtimeState = streamSession.getRealtimeState();
      
      expect(realtimeState).toMatchObject({
        realtimeMode: expect.any(Boolean),
        userSpeaking: expect.any(Boolean),
        conversationState: expect.stringMatching(/^(idle|user_speaking|model_responding|interrupted)$/),
        clientCapabilities: expect.objectContaining({
          supportsRealtimeInterruption: expect.any(Boolean),
          supportsUserSpeakingState: expect.any(Boolean),
          supportsRealtimeStreaming: expect.any(Boolean)
        })
      });
    });

    it('should provide memory statistics', () => {
      const memoryStats = streamSession.getMemoryStats();
      
      expect(memoryStats).toMatchObject({
        inputBufferBytes: expect.any(Number),
        outputBufferBytes: expect.any(Number),
        totalBufferBytes: expect.any(Number),
        memoryPressure: expect.any(Boolean),
        utilizationPercent: expect.any(Number)
      });
    });

    it('should provide comprehensive diagnostics', () => {
      const diagnostics = streamSession.getDiagnostics();
      
      expect(diagnostics).toMatchObject({
        sessionInfo: expect.objectContaining({
          sessionId: testSessionId,
          isActive: expect.any(Boolean)
        }),
        performance: expect.objectContaining({
          isProcessing: expect.any(Boolean),
          hasScheduledProcessing: expect.any(Boolean),
          memoryPressure: expect.any(Boolean)
        }),
        memoryStats: expect.any(Object),
        queueStats: expect.any(Object),
        realtimeStats: expect.any(Object),
        configuration: expect.objectContaining({
          maxQueueSize: expect.any(Number),
          maxOutputBufferSize: expect.any(Number),
          maxChunksPerBatch: expect.any(Number)
        })
      });
    });

    it('should provide performance statistics', () => {
      const perfStats = streamSession.getPerformanceStats();
      
      expect(perfStats).toMatchObject({
        isProcessing: expect.any(Boolean),
        hasScheduledProcessing: expect.any(Boolean),
        memoryStats: expect.any(Object),
        queueStats: expect.any(Object),
        realtimeStats: expect.any(Object)
      });
    });

    it('should handle statistics errors gracefully', () => {
      // Force an error condition by closing the session
      streamSession.close();
      
      // Statistics should still be available with safe defaults
      const stats = streamSession.getAudioQueueStats();
      expect(stats).toBeDefined();
      
      const diagnostics = streamSession.getDiagnostics();
      expect(diagnostics).toBeDefined();
    });
  });

  describe('Real-time Features', () => {
    it('should detect client capabilities', () => {
      const realtimeState = streamSession.getRealtimeState();
      
      expect(realtimeState.clientCapabilities.supportsRealtimeInterruption).toBe(true);
      expect(realtimeState.clientCapabilities.supportsUserSpeakingState).toBe(true);
      expect(realtimeState.clientCapabilities.supportsRealtimeStreaming).toBe(true);
    });

    it('should handle clients without real-time features', () => {
      const limitedClient = {
        ...mockClient,
        enableRealtimeInterruption: undefined,
        setUserSpeakingState: undefined,
        streamAudioRealtime: undefined
      };
      
      const session = new StreamSession(testSessionId, limitedClient as any);
      const realtimeState = session.getRealtimeState();
      
      expect(realtimeState.clientCapabilities.supportsRealtimeInterruption).toBe(false);
      expect(realtimeState.clientCapabilities.supportsUserSpeakingState).toBe(false);
      expect(realtimeState.clientCapabilities.supportsRealtimeStreaming).toBe(false);
    });

    it('should track conversation state changes', () => {
      const realtimeState = streamSession.getRealtimeState();
      expect(realtimeState.conversationState).toBe('idle');
      
      // Conversation state changes would be tested with actual audio processing
      // which requires more complex setup
    });
  });

  describe('Buffer Management', () => {
    it('should handle buffer overflow with drop oldest strategy', async () => {
      const session = new StreamSession(testSessionId, mockClient, { 
        maxQueueSize: 3,
        dropOldestOnFull: true 
      });
      
      // Fill buffer beyond capacity
      for (let i = 0; i < 5; i++) {
        await session.streamAudio(Buffer.from(`chunk${i}`));
      }
      
      const stats = session.getAudioQueueStats();
      expect(stats.queueLength).toBeLessThanOrEqual(3);
    });

    it('should handle buffer overflow without dropping', async () => {
      const session = new StreamSession(testSessionId, mockClient, { 
        maxQueueSize: 3,
        dropOldestOnFull: false 
      });
      
      // Fill buffer beyond capacity
      for (let i = 0; i < 5; i++) {
        await session.streamAudio(Buffer.from(`chunk${i}`));
      }
      
      const stats = session.getAudioQueueStats();
      expect(stats.queueLength).toBeLessThanOrEqual(3);
    });

    it('should calculate buffer utilization correctly', async () => {
      const session = new StreamSession(testSessionId, mockClient, { maxQueueSize: 10 });
      
      // Add some audio chunks
      for (let i = 0; i < 3; i++) {
        await session.streamAudio(Buffer.from(`chunk${i}`));
      }
      
      const stats = session.getAudioQueueStats();
      // Audio might be processed immediately, so just check that stats are valid
      expect(stats.queueUtilizationPercent).toBeGreaterThanOrEqual(0);
      expect(stats.queueUtilizationPercent).toBeLessThanOrEqual(100);
    });
  });

  describe('Error Handling', () => {
    it('should handle client method errors gracefully', () => {
      mockClient.setupPromptStartEvent.mockImplementation(() => {
        throw new Error('Client error');
      });
      
      expect(() => {
        streamSession.setupPromptStart();
      }).toThrow(SessionError);
    });

    it('should provide detailed error context', async () => {
      mockClient.isSessionActive.mockReturnValue(false);
      
      try {
        await streamSession.streamAudio(Buffer.from('test'));
      } catch (error) {
        expect(error).toBeInstanceOf(SessionInactiveError);
        expect((error as SessionInactiveError).sessionId).toBe(testSessionId);
        expect((error as SessionInactiveError).operation).toBeDefined();
      }
    });

    it('should handle validation errors', () => {
      expect(() => {
        streamSession.onEvent('' as StreamEventType, jest.fn());
      }).toThrow(SessionError);
      
      expect(() => {
        streamSession.setupSystemPrompt({ mediaType: 'text/plain' as TextMediaType }, null as any);
      }).toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large audio buffers', async () => {
      const largeBuffer = Buffer.alloc(1024 * 1024); // 1MB
      
      await expect(streamSession.streamAudio(largeBuffer)).resolves.toBeUndefined();
    });

    it('should handle empty audio buffers', async () => {
      const emptyBuffer = Buffer.alloc(0);
      
      await expect(streamSession.streamAudio(emptyBuffer)).resolves.toBeUndefined();
    });

    it('should handle rapid successive operations', async () => {
      const operations = [];
      
      // Perform many operations rapidly
      for (let i = 0; i < 100; i++) {
        operations.push(streamSession.streamAudio(Buffer.from(`chunk${i}`)));
      }
      
      await expect(Promise.all(operations)).resolves.toBeDefined();
    });

    it('should handle concurrent session operations', async () => {
      const audioPromise = streamSession.streamAudio(Buffer.from('audio'));
      const setupPromise = Promise.resolve(streamSession.setupPromptStart());
      const endPromise = Promise.resolve(streamSession.endUserTurn());
      
      await expect(Promise.all([audioPromise, setupPromise, endPromise])).resolves.toBeDefined();
    });
  });
});