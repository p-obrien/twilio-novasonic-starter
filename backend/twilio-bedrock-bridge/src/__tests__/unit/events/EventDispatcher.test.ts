/**
 * EventDispatcher Unit Tests
 * 
 * Tests for the EventDispatcher class that handles event normalization,
 * dispatching, and handler management for Bedrock streaming sessions.
 */

import { EventDispatcher, NormalizedEventData } from '../../../events/EventDispatcher';
import { SessionData } from '../../../session/SessionManager';
import { Subject } from 'rxjs';

describe('EventDispatcher', () => {
  let eventDispatcher: EventDispatcher;
  let mockSession: SessionData;

  beforeEach(() => {
    eventDispatcher = new EventDispatcher();
    
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

  describe('normalizeEventData', () => {
    it('should normalize event data with contentId and contentName', () => {
      const eventData = {
        contentId: 'test-content-id',
        text: 'Hello world'
      };

      const normalized = eventDispatcher.normalizeEventData(eventData);

      expect(normalized.contentId).toBe('test-content-id');
      expect(normalized.contentName).toBe('test-content-id');
      expect(normalized.text).toBe('Hello world');
    });

    it('should use contentName when contentId is missing', () => {
      const eventData = {
        contentName: 'test-content-name',
        text: 'Hello world'
      };

      const normalized = eventDispatcher.normalizeEventData(eventData);

      expect(normalized.contentId).toBe('test-content-name');
      expect(normalized.contentName).toBe('test-content-name');
    });

    it('should parse additionalModelFields JSON string', () => {
      const eventData = {
        contentId: 'test-content',
        additionalModelFields: '{"key": "value", "number": 42}'
      };

      const normalized = eventDispatcher.normalizeEventData(eventData);

      expect(normalized.parsedAdditionalModelFields).toEqual({
        key: 'value',
        number: 42
      });
    });

    it('should handle invalid JSON in additionalModelFields gracefully', () => {
      const eventData = {
        contentId: 'test-content',
        additionalModelFields: 'invalid json {'
      };

      const normalized = eventDispatcher.normalizeEventData(eventData);

      expect(normalized.parsedAdditionalModelFields).toBeUndefined();
      expect(normalized.additionalModelFields).toBe('invalid json {');
    });

    it('should not overwrite existing parsedAdditionalModelFields', () => {
      const existingParsed = { existing: 'data' };
      const eventData = {
        contentId: 'test-content',
        additionalModelFields: '{"new": "data"}',
        parsedAdditionalModelFields: existingParsed
      };

      const normalized = eventDispatcher.normalizeEventData(eventData);

      expect(normalized.parsedAdditionalModelFields).toBe(existingParsed);
    });

    it('should handle non-object input gracefully', () => {
      const primitiveInputs = [
        null,
        undefined,
        'string',
        123,
        true,
        []
      ];

      primitiveInputs.forEach(input => {
        const normalized = eventDispatcher.normalizeEventData(input);
        expect(normalized).toBe(input);
      });
    });

    it('should handle normalization errors gracefully', () => {
      // Create an object that will cause errors during normalization
      const problematicData = {
        get contentId() {
          throw new Error('Property access error');
        }
      };

      expect(() => {
        eventDispatcher.normalizeEventData(problematicData);
      }).not.toThrow();
    });
  });

  describe('dispatchEvent', () => {
    it('should dispatch event to specific handler', () => {
      const handler = jest.fn();
      const eventData = { text: 'Hello world', contentId: 'test-content' };
      
      mockSession.responseHandlers.set('textOutput', handler);
      
      eventDispatcher.dispatchEvent('test-session', mockSession, 'textOutput', eventData);
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello world',
          contentId: 'test-content',
          contentName: 'test-content'
        })
      );
    });

    it('should dispatch event to any handler', () => {
      const anyHandler = jest.fn();
      const eventData = { text: 'Hello world' };
      
      mockSession.responseHandlers.set('any', anyHandler);
      
      eventDispatcher.dispatchEvent('test-session', mockSession, 'textOutput', eventData);
      
      expect(anyHandler).toHaveBeenCalledWith({
        type: 'textOutput',
        data: expect.objectContaining({ text: 'Hello world' })
      });
    });

    it('should dispatch to both specific and any handlers', () => {
      const specificHandler = jest.fn();
      const anyHandler = jest.fn();
      const eventData = { text: 'Hello world' };
      
      mockSession.responseHandlers.set('textOutput', specificHandler);
      mockSession.responseHandlers.set('any', anyHandler);
      
      eventDispatcher.dispatchEvent('test-session', mockSession, 'textOutput', eventData);
      
      expect(specificHandler).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Hello world' })
      );
      expect(anyHandler).toHaveBeenCalledWith({
        type: 'textOutput',
        data: expect.objectContaining({ text: 'Hello world' })
      });
    });

    it('should publish to responseSubject', () => {
      const subjectSpy = jest.spyOn(mockSession.responseSubject, 'next');
      const eventData = { text: 'Hello world' };
      
      eventDispatcher.dispatchEvent('test-session', mockSession, 'textOutput', eventData);
      
      expect(subjectSpy).toHaveBeenCalledWith({
        type: 'textOutput',
        data: expect.objectContaining({ text: 'Hello world' })
      });
    });

    it('should handle missing session gracefully', () => {
      expect(() => {
        eventDispatcher.dispatchEvent('test-session', null as any, 'textOutput', {});
      }).not.toThrow();
    });

    it('should handle handler errors gracefully', () => {
      const errorHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      
      mockSession.responseHandlers.set('textOutput', errorHandler);
      
      expect(() => {
        eventDispatcher.dispatchEvent('test-session', mockSession, 'textOutput', {});
      }).not.toThrow();
      
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle responseSubject errors gracefully', () => {
      // Mock responseSubject to throw error
      mockSession.responseSubject.next = jest.fn().mockImplementation(() => {
        throw new Error('Subject error');
      });
      
      expect(() => {
        eventDispatcher.dispatchEvent('test-session', mockSession, 'textOutput', {});
      }).not.toThrow();
    });

    it('should handle missing responseSubject gracefully', () => {
      const sessionWithoutSubject = {
        ...mockSession,
        responseSubject: null as any
      };
      
      expect(() => {
        eventDispatcher.dispatchEvent('test-session', sessionWithoutSubject, 'textOutput', {});
      }).not.toThrow();
    });

    it('should normalize event data before dispatching', () => {
      const handler = jest.fn();
      const eventData = {
        contentName: 'test-content',
        additionalModelFields: '{"parsed": true}'
      };
      
      mockSession.responseHandlers.set('textOutput', handler);
      
      eventDispatcher.dispatchEvent('test-session', mockSession, 'textOutput', eventData);
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          contentId: 'test-content',
          contentName: 'test-content',
          parsedAdditionalModelFields: { parsed: true }
        })
      );
    });
  });

  describe('registerEventHandler', () => {
    it('should register event handler for session', () => {
      const handler = jest.fn();
      
      eventDispatcher.registerEventHandler(mockSession, 'textOutput', handler);
      
      expect(mockSession.responseHandlers.get('textOutput')).toBe(handler);
    });

    it('should overwrite existing handler', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      eventDispatcher.registerEventHandler(mockSession, 'textOutput', handler1);
      eventDispatcher.registerEventHandler(mockSession, 'textOutput', handler2);
      
      expect(mockSession.responseHandlers.get('textOutput')).toBe(handler2);
    });

    it('should register multiple different handlers', () => {
      const textHandler = jest.fn();
      const audioHandler = jest.fn();
      
      eventDispatcher.registerEventHandler(mockSession, 'textOutput', textHandler);
      eventDispatcher.registerEventHandler(mockSession, 'audioOutput', audioHandler);
      
      expect(mockSession.responseHandlers.get('textOutput')).toBe(textHandler);
      expect(mockSession.responseHandlers.get('audioOutput')).toBe(audioHandler);
    });
  });

  describe('registerGenericEventHandler', () => {
    it('should register generic event handler', () => {
      const genericHandler = jest.fn();
      
      eventDispatcher.registerGenericEventHandler(mockSession, genericHandler);
      
      expect(mockSession.responseHandlers.get('any')).toBe(genericHandler);
    });

    it('should overwrite existing generic handler', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      eventDispatcher.registerGenericEventHandler(mockSession, handler1);
      eventDispatcher.registerGenericEventHandler(mockSession, handler2);
      
      expect(mockSession.responseHandlers.get('any')).toBe(handler2);
    });
  });

  describe('Event Flow Integration', () => {
    it('should handle complete event flow', () => {
      const textHandler = jest.fn();
      const audioHandler = jest.fn();
      const anyHandler = jest.fn();
      const subjectSpy = jest.spyOn(mockSession.responseSubject, 'next');
      
      // Register handlers
      eventDispatcher.registerEventHandler(mockSession, 'textOutput', textHandler);
      eventDispatcher.registerEventHandler(mockSession, 'audioOutput', audioHandler);
      eventDispatcher.registerGenericEventHandler(mockSession, anyHandler);
      
      // Dispatch text event
      const textData = { text: 'Hello', contentName: 'text-content' };
      eventDispatcher.dispatchEvent('test-session', mockSession, 'textOutput', textData);
      
      // Verify text event handling (before audio event)
      expect(textHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello',
          contentId: 'text-content',
          contentName: 'text-content'
        })
      );
      expect(audioHandler).toHaveBeenCalledTimes(0);
      
      // Dispatch audio event
      const audioData = { content: 'base64audio', contentName: 'audio-content' };
      eventDispatcher.dispatchEvent('test-session', mockSession, 'audioOutput', audioData);
      
      // Verify audio event handling (after audio event)
      expect(audioHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'base64audio',
          contentId: 'audio-content',
          contentName: 'audio-content'
        })
      );
      
      // Verify any handler received both events
      expect(anyHandler).toHaveBeenCalledTimes(2);
      expect(anyHandler).toHaveBeenCalledWith({
        type: 'textOutput',
        data: expect.objectContaining({ text: 'Hello' })
      });
      expect(anyHandler).toHaveBeenCalledWith({
        type: 'audioOutput',
        data: expect.objectContaining({ content: 'base64audio' })
      });
      
      // Verify responseSubject received both events
      expect(subjectSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle events without registered handlers', () => {
      const subjectSpy = jest.spyOn(mockSession.responseSubject, 'next');
      
      eventDispatcher.dispatchEvent('test-session', mockSession, 'unknownEvent', { data: 'test' });
      
      // Should still publish to subject even without handlers
      expect(subjectSpy).toHaveBeenCalledWith({
        type: 'unknownEvent',
        data: expect.objectContaining({ data: 'test' })
      });
    });

    it('should handle rapid event dispatching', () => {
      const handler = jest.fn();
      mockSession.responseHandlers.set('testEvent', handler);
      
      // Dispatch many events rapidly
      for (let i = 0; i < 1000; i++) {
        eventDispatcher.dispatchEvent('test-session', mockSession, 'testEvent', { index: i });
      }
      
      expect(handler).toHaveBeenCalledTimes(1000);
    });

    it('should handle concurrent event dispatching', () => {
      const handler = jest.fn();
      mockSession.responseHandlers.set('testEvent', handler);
      
      // Dispatch events concurrently
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          Promise.resolve().then(() => {
            eventDispatcher.dispatchEvent('test-session', mockSession, 'testEvent', { index: i });
          })
        );
      }
      
      return Promise.all(promises).then(() => {
        expect(handler).toHaveBeenCalledTimes(100);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle malformed event data', () => {
      const handler = jest.fn();
      const anyHandler = jest.fn();
      mockSession.responseHandlers.set('testEvent', handler);
      mockSession.responseHandlers.set('any', anyHandler);
      
      const malformedData = [
        null,
        undefined,
        { circular: {} },
        { get prop() { throw new Error('Property error'); } }
      ];
      
      // Create circular reference - safely access the object
      const circularObj = malformedData[2];
      if (circularObj && typeof circularObj === 'object') {
        circularObj.circular = circularObj;
      }
      
      malformedData.forEach((data, index) => {
        expect(() => {
          eventDispatcher.dispatchEvent('test-session', mockSession, 'testEvent', data);
        }).not.toThrow();
      });
      
      // Should have called the handler for each event
      expect(handler).toHaveBeenCalledTimes(malformedData.length);
      expect(anyHandler).toHaveBeenCalledTimes(malformedData.length);
    });

    it('should handle very large event data', () => {
      const handler = jest.fn();
      mockSession.responseHandlers.set('testEvent', handler);
      
      const largeData = {
        text: 'x'.repeat(100000), // 100KB of text
        contentId: 'large-content'
      };
      
      expect(() => {
        eventDispatcher.dispatchEvent('test-session', mockSession, 'testEvent', largeData);
      }).not.toThrow();
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          text: largeData.text,
          contentId: 'large-content'
        })
      );
    });

    it('should handle handler that modifies event data', () => {
      const modifyingHandler = jest.fn().mockImplementation((data: any) => {
        data.modified = true;
        delete data.text;
      });
      const secondHandler = jest.fn();
      
      mockSession.responseHandlers.set('testEvent', modifyingHandler);
      mockSession.responseHandlers.set('any', secondHandler);
      
      const eventData = { text: 'original', contentId: 'test' };
      
      eventDispatcher.dispatchEvent('test-session', mockSession, 'testEvent', eventData);
      
      expect(modifyingHandler).toHaveBeenCalled();
      expect(secondHandler).toHaveBeenCalledWith({
        type: 'testEvent',
        data: expect.objectContaining({
          modified: true,
          contentId: 'test'
        })
      });
    });

    it('should handle session with corrupted responseHandlers', () => {
      // Corrupt the responseHandlers map
      const corruptedSession = {
        ...mockSession,
        responseHandlers: null as any
      };
      
      expect(() => {
        eventDispatcher.dispatchEvent('test-session', corruptedSession, 'testEvent', {});
      }).toThrow(); // This should throw because responseHandlers is null
    });

    it('should handle session with invalid responseSubject', () => {
      const sessionWithInvalidSubject = {
        ...mockSession,
        responseSubject: { next: 'not a function' } as any
      };
      
      expect(() => {
        eventDispatcher.dispatchEvent('test-session', sessionWithInvalidSubject, 'testEvent', {});
      }).not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle high-frequency event dispatching efficiently', () => {
      const handler = jest.fn();
      mockSession.responseHandlers.set('testEvent', handler);
      
      const startTime = Date.now();
      
      // Dispatch 10,000 events
      for (let i = 0; i < 10000; i++) {
        eventDispatcher.dispatchEvent('test-session', mockSession, 'testEvent', { index: i });
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(handler).toHaveBeenCalledTimes(10000);
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });

    it('should handle complex event data normalization efficiently', () => {
      const handler = jest.fn();
      mockSession.responseHandlers.set('testEvent', handler);
      
      const complexData = {
        contentName: 'complex-content',
        additionalModelFields: JSON.stringify({
          nested: {
            deep: {
              structure: {
                with: ['arrays', 'and', 'objects'],
                numbers: [1, 2, 3, 4, 5],
                boolean: true
              }
            }
          }
        }),
        largeText: 'x'.repeat(10000)
      };
      
      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        eventDispatcher.dispatchEvent('test-session', mockSession, 'testEvent', complexData);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(handler).toHaveBeenCalledTimes(100);
      expect(duration).toBeLessThan(500); // Should complete efficiently
    });
  });
});