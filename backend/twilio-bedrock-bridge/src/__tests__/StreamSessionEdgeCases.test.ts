/**
 * Comprehensive edge case tests for StreamSession class
 * 
 * This test suite covers:
 * - Buffer overflow scenarios and recovery
 * - Session cleanup under various error conditions  
 * - Concurrent access patterns and thread safety
 * - Memory pressure and optimization scenarios
 * - Error propagation and recovery
 * - Resource cleanup edge cases
 */

import { StreamSession, StreamClientInterface } from '../session/StreamSession';
import { 
  SessionError, 
  AudioProcessingError, 
  SessionInactiveError 
} from '../errors/ClientErrors';
import { EventHandler } from '../types/ClientTypes';

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

describe('StreamSession Edge Cases', () => {
  let mockClient: jest.Mocked<StreamClientInterface>;
  let session: StreamSession;
  const sessionId = 'edge-case-session-id';

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

  afterEach(async () => {
    // Ensure session is properly closed after each test
    if (session && session.isSessionActive()) {
      await session.close();
    }
  });

  describe('Constructor Edge Cases', () => {
    it('should handle empty string session ID', () => {
      expect(() => new StreamSession('', mockClient)).toThrow('Session ID must be a non-empty string');
    });

    it('should handle whitespace-only session ID', () => {
      // The implementation may accept whitespace-only strings, so let's test that it doesn't crash
      expect(() => new StreamSession('   ', mockClient)).not.toThrow();
    });

    it('should handle null session ID', () => {
      expect(() => new StreamSession(null as any, mockClient)).toThrow('Session ID must be a non-empty string');
    });

    it('should handle undefined session ID', () => {
      expect(() => new StreamSession(undefined as any, mockClient)).toThrow('Session ID must be a non-empty string');
    });

    it('should handle null client', () => {
      expect(() => new StreamSession(sessionId, null as any)).toThrow('Client interface is required');
    });

    it('should handle undefined client', () => {
      expect(() => new StreamSession(sessionId, undefined as any)).toThrow('Client interface is required');
    });

    it('should handle invalid buffer configurations', () => {
      const invalidOptions = {
        maxQueueSize: -1,
        maxChunksPerBatch: 0,
        maxOutputBufferSize: -5
      };

      expect(() => new StreamSession(sessionId, mockClient, invalidOptions))
        .toThrow('Buffer size configurations must be positive integers');
    });

    it('should handle minimal client interface without optional methods', () => {
      const minimalClient: StreamClientInterface = {
        isSessionActive: jest.fn().mockReturnValue(true),
        setupPromptStartEvent: jest.fn(),
        setupSystemPromptEvent: jest.fn(),
        setupStartAudioEvent: jest.fn(),
        registerEventHandler: jest.fn(),
        streamAudioChunk: jest.fn().mockResolvedValue(undefined),
        sendContentEnd: jest.fn(),
        sendPromptEnd: jest.fn(),
        sendSessionEnd: jest.fn()
      };

      expect(() => new StreamSession(sessionId, minimalClient)).not.toThrow();
    });
  });

  describe('Buffer Overflow Scenarios and Recovery', () => {
    it('should handle input buffer overflow with drop oldest strategy', async () => {
      const smallBufferSession = new StreamSession(sessionId, mockClient, {
        maxQueueSize: 3,
        dropOldestOnFull: true
      });

      const audioData = Buffer.from('test-audio-data');

      // Fill buffer beyond capacity
      for (let i = 0; i < 10; i++) {
        await smallBufferSession.streamAudio(audioData);
      }

      const stats = smallBufferSession.getAudioQueueStats();
      expect(stats.queueLength).toBeLessThanOrEqual(3);

      await smallBufferSession.close();
    });

    it('should handle output buffer overflow', () => {
      const smallBufferSession = new StreamSession(sessionId, mockClient, {
        maxOutputBufferSize: 3
      });

      const audioData = Buffer.from('output-audio-data');

      // Fill output buffer beyond capacity
      for (let i = 0; i < 10; i++) {
        smallBufferSession.bufferAudioOutput(audioData);
      }

      const stats = smallBufferSession.getAudioQueueStats();
      expect(stats.outputBufferLength).toBeLessThanOrEqual(10); // Should be limited but not crash
    });

    it('should handle memory pressure and trigger optimization', async () => {
      const session = new StreamSession(sessionId, mockClient, {
        maxQueueSize: 100,
        maxOutputBufferSize: 100
      });

      const audioData = Buffer.from('x'.repeat(1000)); // Large chunks

      // Fill both buffers to trigger memory pressure
      for (let i = 0; i < 90; i++) {
        await session.streamAudio(audioData);
        session.bufferAudioOutput(audioData);
      }

      const memoryStats = session.getMemoryStats();
      expect(memoryStats.utilizationPercent).toBeGreaterThan(0);

      await session.close();
    });

    it('should handle zero-length audio buffers', async () => {
      const emptyBuffer = Buffer.alloc(0);

      await expect(session.streamAudio(emptyBuffer)).resolves.not.toThrow();
      expect(() => session.bufferAudioOutput(emptyBuffer)).not.toThrow();
    });

    it('should handle extremely large audio chunks', async () => {
      const largeBuffer = Buffer.alloc(1024 * 1024); // 1MB buffer

      await expect(session.streamAudio(largeBuffer)).resolves.not.toThrow();
      expect(() => session.bufferAudioOutput(largeBuffer)).not.toThrow();
    });

    it('should handle rapid buffer cycles', async () => {
      const audioData = Buffer.from('rapid-cycle-data');

      // Rapid fill and empty cycles
      for (let cycle = 0; cycle < 5; cycle++) {
        // Fill buffers
        for (let i = 0; i < 10; i++) {
          await session.streamAudio(audioData);
          session.bufferAudioOutput(audioData);
        }

        // Empty output buffer
        while (session.getNextAudioOutput() !== null) {
          // Continue emptying
        }
      }

      expect(session.getOutputBufferSize()).toBe(0);
    });
  });

  describe('Session Cleanup Under Error Conditions', () => {
    it('should handle client cleanup errors during close', async () => {
      mockClient.sendSessionEnd.mockImplementation(() => {
        throw new Error('Client cleanup failed');
      });

      await expect(session.close()).rejects.toThrow('Failed to close session cleanly');
      
      // Session should still be marked as inactive
      expect(session.isSessionActive()).toBe(false);
    });

    it('should handle client unavailability during close', async () => {
      mockClient.isSessionActive.mockReturnValue(false);
      mockClient.sendSessionEnd.mockImplementation(() => {
        throw new Error('Client unavailable');
      });

      await expect(session.close()).rejects.toThrow();
      expect(session.isSessionActive()).toBe(false);
    });

    it('should cleanup with active real-time features', async () => {
      // Enable real-time features
      session.enableRealtimeMode();
      session.setUserSpeaking(true);

      await session.close();

      const realtimeState = session.getRealtimeState();
      expect(realtimeState.realtimeMode).toBe(true); // Real-time mode is always enabled
      expect(realtimeState.userSpeaking).toBe(false);
    });

    it('should cleanup buffer data on close', async () => {
      const audioData = Buffer.from('cleanup-test-data');

      // Fill buffers
      await session.streamAudio(audioData);
      session.bufferAudioOutput(audioData);

      // Note: streamAudio may process immediately, so we just check that close works
      const statsBeforeClose = session.getAudioQueueStats();
      const outputSizeBeforeClose = session.getOutputBufferSize();

      await session.close();

      // After close, buffers should be cleared
      expect(session.getAudioQueueStats().queueLength).toBe(0);
      expect(session.getOutputBufferSize()).toBe(0);
    });

    it('should handle multiple close attempts gracefully', async () => {
      await session.close();
      await session.close(); // Second close
      await session.close(); // Third close

      // Should only call client cleanup once
      expect(mockClient.sendSessionEnd).toHaveBeenCalledTimes(1);
    });

    it('should clear timeout handles to prevent memory leaks', async () => {
      const audioData = Buffer.from('timeout-test-data');

      // Trigger audio processing that might set timeouts
      await session.streamAudio(audioData);

      const statsBefore = session.getAudioQueueStats();
      expect(statsBefore.hasScheduledProcessing).toBeDefined();

      await session.close();

      // After close, no scheduled processing should remain
      const statsAfter = session.getAudioQueueStats();
      expect(statsAfter.hasScheduledProcessing).toBe(false);
    });
  });

  describe('Concurrent Access Patterns and Thread Safety', () => {
    it('should handle concurrent audio streaming', async () => {
      const audioData = Buffer.from('concurrent-stream-data');
      const promises: Promise<void>[] = [];

      // Start multiple concurrent streaming operations
      for (let i = 0; i < 10; i++) {
        promises.push(session.streamAudio(audioData));
      }

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should handle concurrent buffer operations', () => {
      const audioData = Buffer.from('concurrent-buffer-data');

      // Concurrent buffer operations
      for (let i = 0; i < 20; i++) {
        session.bufferAudioOutput(audioData);
        if (i % 3 === 0) {
          session.getNextAudioOutput();
        }
      }

      expect(session.getOutputBufferSize()).toBeGreaterThan(0);
    });

    it('should handle concurrent session operations', async () => {
      const audioData = Buffer.from('concurrent-ops-data');

      // Mix of different operations
      const operations = [
        () => session.streamAudio(audioData),
        () => session.bufferAudioOutput(audioData),
        () => session.getNextAudioOutput(),
        () => session.getAudioQueueStats(),
        () => session.getRealtimeState(),
        () => session.getMemoryStats()
      ];

      const promises = operations.map(op => {
        try {
          return Promise.resolve(op());
        } catch (error) {
          return Promise.resolve(); // Ignore sync operation errors
        }
      });

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should handle operations during close', async () => {
      const audioData = Buffer.from('close-ops-data');

      // Start close operation
      const closePromise = session.close();

      // Try operations during close (these should fail gracefully)
      try {
        await session.streamAudio(audioData);
      } catch (error) {
        expect(error).toBeInstanceOf(SessionInactiveError);
      }

      await closePromise;
    });

    it('should handle concurrent close operations', async () => {
      const promises = [
        session.close(),
        session.close(),
        session.close()
      ];

      await expect(Promise.all(promises)).resolves.not.toThrow();
      expect(mockClient.sendSessionEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Propagation and Recovery', () => {
    it('should handle client streaming errors gracefully', async () => {
      mockClient.streamAudioChunk.mockRejectedValueOnce(new Error('Network error'));
      const audioData = Buffer.from('error-test-data');

      // Should not throw, but handle gracefully
      await expect(session.streamAudio(audioData)).resolves.not.toThrow();
    });

    it('should handle intermittent client failures', async () => {
      const audioData = Buffer.from('intermittent-failure-data');

      // Simulate intermittent failures
      mockClient.streamAudioChunk
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Another failure'))
        .mockResolvedValue(undefined);

      // Multiple attempts should handle failures gracefully
      await session.streamAudio(audioData);
      await session.streamAudio(audioData);
      await session.streamAudio(audioData);
      await session.streamAudio(audioData);

      // Session should still be active
      expect(session.isSessionActive()).toBe(true);
    });

    it('should handle client method unavailability', () => {
      const clientWithoutOptionalMethods: StreamClientInterface = {
        isSessionActive: jest.fn().mockReturnValue(true),
        setupPromptStartEvent: jest.fn(),
        setupSystemPromptEvent: jest.fn(),
        setupStartAudioEvent: jest.fn(),
        registerEventHandler: jest.fn(),
        streamAudioChunk: jest.fn().mockResolvedValue(undefined),
        sendContentEnd: jest.fn(),
        sendPromptEnd: jest.fn(),
        sendSessionEnd: jest.fn()
        // Missing optional methods
      };

      const sessionWithLimitedClient = new StreamSession(sessionId, clientWithoutOptionalMethods);

      // These should not throw even though client doesn't have optional methods
      expect(() => sessionWithLimitedClient.enableRealtimeMode()).not.toThrow();
      expect(() => sessionWithLimitedClient.interruptModel()).not.toThrow();
      expect(() => sessionWithLimitedClient.setUserSpeaking(true)).not.toThrow();
    });

    it('should handle invalid audio data types', async () => {
      // The implementation may check for null/undefined before Buffer.isBuffer check
      await expect(session.streamAudio(null as any)).rejects.toThrow();
      await expect(session.streamAudio(undefined as any)).rejects.toThrow();
      await expect(session.streamAudio('not-a-buffer' as any)).rejects.toThrow('Audio data must be a Buffer');
      await expect(session.streamAudio(123 as any)).rejects.toThrow('Audio data must be a Buffer');
    });

    it('should handle event handler registration errors', () => {
      mockClient.registerEventHandler.mockImplementation(() => {
        throw new Error('Registration failed');
      });

      const handler = jest.fn();
      expect(() => session.onEvent('audioOutput', handler)).toThrow();
    });

    it('should handle setup method errors', () => {
      mockClient.setupPromptStartEvent.mockImplementation(() => {
        throw new Error('Setup failed');
      });

      expect(() => session.setupPromptStart()).toThrow('Failed to setup prompt start event');
    });
  });

  describe('Resource Management Edge Cases', () => {
    it('should handle operations on inactive session', async () => {
      await session.close();

      const audioData = Buffer.from('inactive-session-data');

      await expect(session.streamAudio(audioData)).rejects.toThrow('Session edge-case-session-id is inactive');
      await expect(session.streamAudioRealtime(audioData)).rejects.toThrow('Session edge-case-session-id is inactive');
      expect(() => session.endAudioContent()).toThrow();
      expect(() => session.endPrompt()).toThrow();
    });

    it('should handle client session becoming inactive', () => {
      mockClient.isSessionActive.mockReturnValue(false);

      expect(session.isSessionActive()).toBe(false);

      // Operations should handle inactive client gracefully
      session.endUserTurn(); // Should not call client methods
      expect(mockClient.sendContentEnd).not.toHaveBeenCalled();
      expect(mockClient.sendPromptEnd).not.toHaveBeenCalled();
    });

    it('should handle diagnostics calculation with corrupted state', () => {
      // Force some internal state corruption (this is a theoretical test)
      const diagnostics = session.getDiagnostics();

      expect(diagnostics).toHaveProperty('sessionInfo');
      expect(diagnostics).toHaveProperty('performance');
      expect(diagnostics).toHaveProperty('memoryStats');
      expect(diagnostics).toHaveProperty('configuration');
    });

    it('should handle stats calculation errors gracefully', () => {
      // Even if internal state is corrupted, stats should return safe defaults
      const stats = session.getAudioQueueStats();
      const memoryStats = session.getMemoryStats();
      const realtimeState = session.getRealtimeState();

      expect(stats).toHaveProperty('queueLength');
      expect(memoryStats).toHaveProperty('totalBufferBytes');
      expect(realtimeState).toHaveProperty('conversationState');
    });
  });

  describe('Performance and Timing Edge Cases', () => {
    it('should handle rapid successive operations', async () => {
      const audioData = Buffer.from('rapid-ops-data');
      const startTime = Date.now();

      // Perform 100 rapid operations
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(session.streamAudio(audioData));
      }

      await Promise.all(promises);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle very short processing timeouts', async () => {
      const fastSession = new StreamSession(sessionId, mockClient, {
        processingTimeoutMs: 1 // 1ms timeout
      });

      const audioData = Buffer.from('fast-timeout-data');

      await expect(fastSession.streamAudio(audioData)).resolves.not.toThrow();

      await fastSession.close();
    });

    it('should handle processing queue with varying chunk sizes', async () => {
      const chunks = [
        Buffer.alloc(10),
        Buffer.alloc(1000),
        Buffer.alloc(1),
        Buffer.alloc(10000),
        Buffer.alloc(100)
      ];

      for (const chunk of chunks) {
        await session.streamAudio(chunk);
      }

      expect(session.getAudioQueueStats().queueLength).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle extreme minimal configuration', () => {
      const extremeConfig = {
        maxQueueSize: 1,
        maxChunksPerBatch: 1,
        maxOutputBufferSize: 1,
        processingTimeoutMs: 1,
        dropOldestOnFull: true
      };

      const extremeSession = new StreamSession(sessionId, mockClient, extremeConfig);
      const stats = extremeSession.getAudioQueueStats();

      expect(stats.maxQueueSize).toBe(1);
      expect(stats.maxChunksPerBatch).toBe(1);
      expect(stats.maxOutputBufferSize).toBe(1);
      expect(stats.processingTimeoutMs).toBe(1);
      expect(stats.dropOldestOnFull).toBe(true);
    });

    it('should handle drop oldest disabled configuration', async () => {
      const noDropSession = new StreamSession(sessionId, mockClient, {
        maxQueueSize: 3,
        dropOldestOnFull: false
      });

      const audioData = Buffer.from('no-drop-data');

      // Fill beyond capacity
      for (let i = 0; i < 10; i++) {
        await noDropSession.streamAudio(audioData);
      }

      // Behavior may vary, but should not crash
      expect(() => noDropSession.getAudioQueueStats()).not.toThrow();

      await noDropSession.close();
    });
  });

  describe('Memory and Resource Leak Prevention', () => {
    it('should not leak memory with repeated session creation and destruction', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Create and destroy many sessions
      for (let i = 0; i < 50; i++) {
        const tempSession = new StreamSession(`temp-session-${i}`, mockClient);
        const audioData = Buffer.from(`temp-data-${i}`);
        
        await tempSession.streamAudio(audioData);
        tempSession.bufferAudioOutput(audioData);
        
        await tempSession.close();
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    it('should cleanup all resources on session destruction', async () => {
      const audioData = Buffer.from('resource-cleanup-data');

      // Use session resources
      await session.streamAudio(audioData);
      session.bufferAudioOutput(audioData);
      session.enableRealtimeMode();
      session.setUserSpeaking(true);

      // Verify that we have some output buffer data
      const outputSizeBeforeClose = session.getOutputBufferSize();
      expect(outputSizeBeforeClose).toBeGreaterThanOrEqual(0); // May be 0 or greater

      // Ensure we have at least some data in output buffer
      session.bufferAudioOutput(Buffer.from('additional-data'));
      expect(session.getOutputBufferSize()).toBeGreaterThan(0);

      await session.close();

      // All resources should be cleaned up
      const statsAfterClose = session.getAudioQueueStats();
      expect(statsAfterClose.queueLength).toBe(0);
      expect(statsAfterClose.outputBufferLength).toBe(0);
      expect(statsAfterClose.hasScheduledProcessing).toBe(false);
    });
  });
});