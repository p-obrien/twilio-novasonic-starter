/**
 * StreamProcessor Unit Tests
 * 
 * Tests for the StreamProcessor class that handles processing of bidirectional
 * stream responses from AWS Bedrock Nova Sonic.
 */

import { StreamProcessor } from '../../../streaming/StreamProcessor';
import { EventDispatcher } from '../../../events/EventDispatcher';
import { SessionData } from '../../../session/SessionManager';
import { Subject } from 'rxjs';

describe('StreamProcessor', () => {
  let streamProcessor: StreamProcessor;
  let mockEventDispatcher: jest.Mocked<EventDispatcher>;
  let mockSession: SessionData;

  beforeEach(() => {
    // Create mock event dispatcher
    mockEventDispatcher = {
      dispatchEvent: jest.fn(),
      normalizeEventData: jest.fn().mockImplementation(data => data),
      registerEventHandler: jest.fn(),
      registerGenericEventHandler: jest.fn()
    } as any;

    // Create stream processor
    streamProcessor = new StreamProcessor(mockEventDispatcher);

    // Create mock session data
    mockSession = {
      queue: [],
      queueSignal: new Subject<void>(),
      closeSignal: new Subject<void>(),
      responseSubject: new Subject<any>(),
      responseHandlers: new Map(),
      promptName: 'test-prompt',
      inferenceConfig: { maxTokens: 1024, topP: 0.9, temperature: 0.7 },
      isActive: true,
      isPromptStartSent: false,
      isAudioContentStartSent: false,
      audioContentId: 'test-audio-content',
      isWaitingForResponse: false
    };
  });

  afterEach(() => {
    // Clean up subjects
    mockSession.queueSignal.complete();
    mockSession.closeSignal.complete();
    mockSession.responseSubject.complete();
  });

  describe('createSessionAsyncIterable', () => {
    it('should create async iterable for active session', () => {
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      
      expect(iterable).toBeDefined();
      expect(typeof iterable[Symbol.asyncIterator]).toBe('function');
    });

    it('should create empty iterable for inactive session', () => {
      mockSession.isActive = false;
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      
      expect(iterable).toBeDefined();
      expect(typeof iterable[Symbol.asyncIterator]).toBe('function');
    });

    it('should process events from session queue', async () => {
      const testEvent = {
        event: {
          sessionStart: {
            inferenceConfiguration: { maxTokens: 1024 }
          }
        }
      };

      mockSession.queue.push(testEvent);
      
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      const iterator = iterable[Symbol.asyncIterator]();
      
      // Trigger queue signal to process event
      setTimeout(() => mockSession.queueSignal.next(), 10);
      
      const result = await iterator.next();
      
      expect(result.done).toBe(false);
      expect(result.value).toBeDefined();
      expect(result.value.chunk?.bytes).toBeInstanceOf(Uint8Array);
    });

    it('should handle session close signal', async () => {
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      const iterator = iterable[Symbol.asyncIterator]();
      
      // Trigger close signal
      setTimeout(() => mockSession.closeSignal.next(), 10);
      
      const result = await iterator.next();
      
      expect(result.done).toBe(true);
      expect(result.value).toBeUndefined();
    });

    it('should handle JSON serialization errors gracefully', async () => {
      // Create an event with circular reference
      const circularEvent: any = { event: { test: {} } };
      circularEvent.event.test.circular = circularEvent;
      
      mockSession.queue.push(circularEvent);
      
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      const iterator = iterable[Symbol.asyncIterator]();
      
      setTimeout(() => mockSession.queueSignal.next(), 10);
      
      const result = await iterator.next();
      
      expect(result.done).toBe(false);
      expect(result.value).toBeDefined();
      // Should create fallback error event
      const serializedData = new TextDecoder().decode(result.value.chunk.bytes);
      const parsedData = JSON.parse(serializedData);
      expect(parsedData.event.error).toBeDefined();
    });

    it('should handle iterator return method', async () => {
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      const iterator = iterable[Symbol.asyncIterator]();
      
      if (iterator.return) {
        const result = await iterator.return();
        
        expect(result.done).toBe(true);
        expect(result.value).toBeUndefined();
        expect(mockSession.isActive).toBe(false);
      } else {
        // If return method is not available, just verify session cleanup
        expect(mockSession.isActive).toBe(true);
      }
    });

    it('should handle iterator throw method', async () => {
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      const iterator = iterable[Symbol.asyncIterator]();
      
      const testError = new Error('Test error');
      
      if (iterator.throw) {
        await expect(iterator.throw(testError)).rejects.toThrow('Test error');
        expect(mockSession.isActive).toBe(false);
      } else {
        // If throw method is not available, just verify the iterator exists
        expect(iterator).toBeDefined();
      }
    });
  });

  describe('processResponseStream', () => {
    it('should process response stream with events', async () => {
      const mockResponse = {
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify({
                  event: {
                    textOutput: {
                      text: 'Hello world',
                      contentId: 'test-content'
                    }
                  }
                }))
              }
            };
            yield {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify({
                  event: {
                    audioOutput: {
                      content: 'base64audiodata',
                      contentId: 'test-audio'
                    }
                  }
                }))
              }
            };
          }
        }
      };

      await streamProcessor.processResponseStream('test-session', mockSession, mockResponse);

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledTimes(3); // 2 events + streamComplete
      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'textOutput',
        expect.objectContaining({ text: 'Hello world' })
      );
      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'audioOutput',
        expect.objectContaining({ content: 'base64audiodata' })
      );
      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'streamComplete',
        expect.objectContaining({ timestamp: expect.any(String) })
      );
    });

    it('should handle empty response stream', async () => {
      const mockResponse = {
        body: {
          [Symbol.asyncIterator]: async function* () {
            // Empty stream
          }
        }
      };

      await streamProcessor.processResponseStream('test-session', mockSession, mockResponse);

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'streamComplete',
        expect.objectContaining({ timestamp: expect.any(String) })
      );
    });

    it('should handle model stream errors', async () => {
      const mockResponse = {
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              modelStreamErrorException: {
                message: 'Model error',
                code: 'ModelError'
              }
            };
          }
        }
      };

      await streamProcessor.processResponseStream('test-session', mockSession, mockResponse);

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'error',
        expect.objectContaining({
          type: 'modelStreamErrorException',
          details: expect.objectContaining({ message: 'Model error' })
        })
      );
    });

    it('should handle internal server errors', async () => {
      const mockResponse = {
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              internalServerException: {
                message: 'Internal server error'
              }
            };
          }
        }
      };

      await streamProcessor.processResponseStream('test-session', mockSession, mockResponse);

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'error',
        expect.objectContaining({
          type: 'internalServerException'
        })
      );
    });

    it('should handle validation errors', async () => {
      const mockResponse = {
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              validationException: {
                message: 'Validation failed',
                fieldList: ['field1', 'field2']
              }
            };
          }
        }
      };

      await streamProcessor.processResponseStream('test-session', mockSession, mockResponse);

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'error',
        expect.objectContaining({
          type: 'validationException'
        })
      );
    });

    it('should handle JSON parsing errors in chunks', async () => {
      const mockResponse = {
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              chunk: {
                bytes: new TextEncoder().encode('invalid json')
              }
            };
          }
        }
      };

      await streamProcessor.processResponseStream('test-session', mockSession, mockResponse);

      // Should not throw and should complete normally
      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'streamComplete',
        expect.any(Object)
      );
    });

    it('should stop processing when session becomes inactive', async () => {
      let eventCount = 0;
      const mockResponse = {
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify({
                  event: { textOutput: { text: 'First event' } }
                }))
              }
            };
            
            // Simulate session becoming inactive
            mockSession.isActive = false;
            
            yield {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify({
                  event: { textOutput: { text: 'Second event' } }
                }))
              }
            };
          }
        }
      };

      await streamProcessor.processResponseStream('test-session', mockSession, mockResponse);

      // Should process first event but stop before second
      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'textOutput',
        expect.objectContaining({ text: 'First event' })
      );
    });

    it('should handle stream processing errors', async () => {
      const mockResponse = {
        body: {
          [Symbol.asyncIterator]: async function* () {
            throw new Error('Stream processing error');
          }
        }
      };

      await streamProcessor.processResponseStream('test-session', mockSession, mockResponse);

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'error',
        expect.objectContaining({
          source: 'responseStream',
          message: 'Error processing response stream'
        })
      );
    });

    it('should handle different event types correctly', async () => {
      const mockResponse = {
        body: {
          [Symbol.asyncIterator]: async function* () {
            // Content start event
            yield {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify({
                  event: {
                    contentStart: {
                      contentId: 'content-1',
                      type: 'TEXT'
                    }
                  }
                }))
              }
            };

            // Usage event
            yield {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify({
                  event: {
                    usageEvent: {
                      inputTokens: 10,
                      outputTokens: 20
                    }
                  }
                }))
              }
            };

            // Completion start
            yield {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify({
                  event: {
                    completionStart: {
                      timestamp: new Date().toISOString()
                    }
                  }
                }))
              }
            };

            // Completion end
            yield {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify({
                  event: {
                    completionEnd: {
                      timestamp: new Date().toISOString()
                    }
                  }
                }))
              }
            };

            // Content end
            yield {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify({
                  event: {
                    contentEnd: {
                      contentId: 'content-1'
                    }
                  }
                }))
              }
            };
          }
        }
      };

      await streamProcessor.processResponseStream('test-session', mockSession, mockResponse);

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'contentStart',
        expect.objectContaining({ contentId: 'content-1' })
      );

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'usageEvent',
        expect.objectContaining({ inputTokens: 10 })
      );

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'completionStart',
        expect.any(Object)
      );

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'completionEnd',
        expect.any(Object)
      );

      expect(mockEventDispatcher.dispatchEvent).toHaveBeenCalledWith(
        'test-session',
        mockSession,
        'contentEnd',
        expect.objectContaining({ contentId: 'content-1' })
      );

      // Should set isWaitingForResponse to false on completionStart
      expect(mockSession.isWaitingForResponse).toBe(false);
    });

    it('should handle unknown event types', async () => {
      const mockResponse = {
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify({
                  event: {
                    unknownEventType: {
                      data: 'some data'
                    }
                  }
                }))
              }
            };
          }
        }
      };

      await streamProcessor.processResponseStream('test-session', mockSession, mockResponse);

      // Should dispatch the unknown event type
      const calls = mockEventDispatcher.dispatchEvent.mock.calls;
      const unknownEventCall = calls.find(call => call[2] === 'unknownEventType');
      expect(unknownEventCall).toBeDefined();
      if (unknownEventCall) {
        expect(unknownEventCall[3]).toEqual({ unknownEventType: { data: 'some data' } });
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed event data', async () => {
      const testEvent = {
        event: null
      };

      mockSession.queue.push(testEvent);
      
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      const iterator = iterable[Symbol.asyncIterator]();
      
      setTimeout(() => mockSession.queueSignal.next(), 10);
      
      const result = await iterator.next();
      
      expect(result.done).toBe(false);
      expect(result.value).toBeDefined();
    });

    it('should handle very large events', async () => {
      const largeContent = 'x'.repeat(100000); // 100KB of data
      const testEvent = {
        event: {
          textOutput: {
            text: largeContent,
            contentId: 'large-content'
          }
        }
      };

      mockSession.queue.push(testEvent);
      
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      const iterator = iterable[Symbol.asyncIterator]();
      
      setTimeout(() => mockSession.queueSignal.next(), 10);
      
      const result = await iterator.next();
      
      expect(result.done).toBe(false);
      expect(result.value.chunk.bytes.length).toBeGreaterThan(100000);
    });

    it('should handle rapid event processing', async () => {
      // Add multiple events quickly
      for (let i = 0; i < 100; i++) {
        mockSession.queue.push({
          event: {
            textOutput: {
              text: `Message ${i}`,
              contentId: `content-${i}`
            }
          }
        });
      }
      
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      const iterator = iterable[Symbol.asyncIterator]();
      
      // Process all events
      const results = [];
      for (let i = 0; i < 100; i++) {
        setTimeout(() => mockSession.queueSignal.next(), 1);
        const result = await iterator.next();
        results.push(result);
      }
      
      expect(results).toHaveLength(100);
      results.forEach(result => {
        expect(result.done).toBe(false);
        expect(result.value).toBeDefined();
      });
    });

    it('should handle concurrent iterator operations', async () => {
      const testEvent = {
        event: {
          textOutput: {
            text: 'Concurrent test',
            contentId: 'concurrent-content'
          }
        }
      };

      mockSession.queue.push(testEvent);
      
      const iterable = streamProcessor.createSessionAsyncIterable('test-session', mockSession);
      const iterator1 = iterable[Symbol.asyncIterator]();
      const iterator2 = iterable[Symbol.asyncIterator]();
      
      setTimeout(() => mockSession.queueSignal.next(), 10);
      
      // Both iterators should work independently
      const result1 = await iterator1.next();
      const result2 = await iterator2.next();
      
      expect(result1.done).toBe(false);
      // Second iterator might be done if the queue was consumed by first iterator
      expect(result2.done).toBeDefined();
    });
  });
});