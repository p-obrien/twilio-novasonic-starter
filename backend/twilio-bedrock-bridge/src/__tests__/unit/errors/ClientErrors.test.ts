/**
 * ClientErrors Unit Tests
 * 
 * Tests for the custom error classes used throughout the Bedrock streaming
 * system for better error handling and debugging.
 */

import {
  BedrockClientError,
  SessionError,
  SessionNotFoundError,
  SessionAlreadyExistsError,
  SessionInactiveError,
  StreamingError,
  AudioProcessingError,
  AckTimeoutError,
  BedrockServiceError,
  ConfigurationError,
  TwilioValidationError,
  WebSocketError,
  ValidationError,
  ErrorSeverity,
  ErrorContext,
  isBedrockClientError,
  extractErrorDetails,
  createBedrockServiceError
} from '../../../errors/ClientErrors';

describe('ClientErrors', () => {
  const mockContext: ErrorContext = {
    correlationId: 'test-correlation-123',
    sessionId: 'test-session-456',
    operation: 'test-operation',
    timestamp: Date.now(),
    metadata: { key: 'value' }
  };

  describe('BedrockClientError Base Class', () => {
    class TestBedrockError extends BedrockClientError {
      readonly code = 'TEST_ERROR';
      readonly severity = ErrorSeverity.MEDIUM;
      readonly retryable = true;
    }

    it('should create error with proper properties', () => {
      const error = new TestBedrockError('Test message', mockContext);
      
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(true);
      expect(error.context).toBe(mockContext);
      expect(error.sessionId).toBe('test-session-456');
      expect(error.correlationId).toBe('test-correlation-123');
      expect(error.operation).toBe('test-operation');
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new TestBedrockError('Test message', mockContext, cause);
      
      expect(error.cause).toBe(cause);
    });

    it('should check retry capability correctly', () => {
      const retryableError = new TestBedrockError('Retryable', mockContext);
      expect(retryableError.canRetry()).toBe(true);
      
      const nonRetryableContext = { ...mockContext, retryAttempt: 5, maxRetries: 3 };
      const exhaustedError = new TestBedrockError('Exhausted', nonRetryableContext);
      expect(exhaustedError.canRetry()).toBe(false);
    });

    it('should create retry instance with incremented attempt', () => {
      const originalError = new TestBedrockError('Original', mockContext);
      const retryError = originalError.forRetry();
      
      expect(retryError.context.retryAttempt).toBe(1);
      expect(retryError.message).toBe('Original');
      expect(retryError.code).toBe('TEST_ERROR');
    });

    it('should convert to JSON correctly', () => {
      const cause = new Error('Cause error');
      const error = new TestBedrockError('Test message', mockContext, cause);
      const json = error.toJSON();
      
      expect(json).toMatchObject({
        name: 'TestBedrockError',
        code: 'TEST_ERROR',
        message: 'Test message',
        severity: ErrorSeverity.MEDIUM,
        retryable: true,
        context: mockContext,
        cause: {
          name: 'Error',
          message: 'Cause error'
        }
      });
      expect(json.stack).toBeDefined();
    });
  });

  describe('SessionError', () => {
    it('should create session error with context object', () => {
      const error = SessionError.create(
        'Session failed',
        'test-operation',
        'session-123',
        'correlation-456',
        { detail: 'test' }
      );
      
      expect(error.code).toBe('SESSION_ERROR');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(true);
      expect(error.sessionId).toBe('session-123');
      expect(error.correlationId).toBe('correlation-456');
      expect(error.context.metadata.detail).toBe('test');
    });

    it('should create session error with backward compatibility', () => {
      const error = new SessionError('Test message', 'session-123');
      
      expect(error.sessionId).toBe('session-123');
      expect(error.operation).toBe('session_operation');
    });

    it('should create session error with cause', () => {
      const cause = new Error('Original error');
      const error = new SessionError('Test message', mockContext, cause);
      
      expect(error.cause).toBe(cause);
    });
  });

  describe('SessionNotFoundError', () => {
    it('should create session not found error', () => {
      const error = SessionNotFoundError.create(
        'session-123',
        'find-session',
        'correlation-456'
      );
      
      expect(error.code).toBe('SESSION_NOT_FOUND');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('Session session-123 not found');
      expect(error.sessionId).toBe('session-123');
    });
  });

  describe('SessionAlreadyExistsError', () => {
    it('should create session already exists error', () => {
      const error = SessionAlreadyExistsError.create(
        'session-123',
        'create-session',
        'correlation-456'
      );
      
      expect(error.code).toBe('SESSION_ALREADY_EXISTS');
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('Session session-123 already exists');
    });
  });

  describe('SessionInactiveError', () => {
    it('should create session inactive error with context', () => {
      const error = SessionInactiveError.create(
        'session-123',
        'check-session',
        'correlation-456'
      );
      
      expect(error.code).toBe('SESSION_INACTIVE');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('Session session-123 is inactive');
    });

    it('should create session inactive error with backward compatibility', () => {
      const error = new SessionInactiveError('session-123');
      
      expect(error.sessionId).toBe('session-123');
      expect(error.operation).toBe('session_inactive_check');
    });
  });

  describe('StreamingError', () => {
    it('should create streaming error', () => {
      const error = StreamingError.create(
        'Streaming failed',
        'stream-audio',
        'session-123',
        'correlation-456',
        { streamType: 'bidirectional' }
      );
      
      expect(error.code).toBe('STREAMING_ERROR');
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.retryable).toBe(true);
      expect(error.message).toBe('Streaming failed');
      expect(error.context.metadata.streamType).toBe('bidirectional');
    });
  });

  describe('AudioProcessingError', () => {
    it('should create audio processing error with context', () => {
      const error = AudioProcessingError.create(
        'Audio processing failed',
        'process-audio',
        'session-123',
        'correlation-456',
        { sampleRate: 16000 }
      );
      
      expect(error.code).toBe('AUDIO_PROCESSING_ERROR');
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.retryable).toBe(true);
      expect(error.context.metadata.sampleRate).toBe(16000);
    });

    it('should create audio processing error with backward compatibility', () => {
      const error = new AudioProcessingError('Audio failed', 'session-123');
      
      expect(error.sessionId).toBe('session-123');
      expect(error.operation).toBe('audio_processing');
    });
  });

  describe('AckTimeoutError', () => {
    it('should create ack timeout error', () => {
      const error = AckTimeoutError.create(
        'session-123',
        5000,
        'wait-for-ack',
        'correlation-456'
      );
      
      expect(error.code).toBe('ACK_TIMEOUT');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(true);
      expect(error.timeoutMs).toBe(5000);
      expect(error.message).toBe('Event acknowledgment timeout after 5000ms for session session-123');
    });
  });

  describe('BedrockServiceError', () => {
    it('should create bedrock service error', () => {
      const error = BedrockServiceError.create(
        'Service unavailable',
        'ServiceUnavailableException',
        'invoke-model',
        'session-123',
        'correlation-456',
        { statusCode: 503 }
      );
      
      expect(error.code).toBe('BEDROCK_SERVICE_ERROR');
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.retryable).toBe(true); // ServiceUnavailableException is retryable
      expect(error.serviceErrorType).toBe('ServiceUnavailableException');
    });

    it('should determine retryability correctly', () => {
      const retryableError = BedrockServiceError.create(
        'Throttled',
        'ThrottlingException',
        'invoke-model'
      );
      expect(retryableError.retryable).toBe(true);
      
      const nonRetryableError = BedrockServiceError.create(
        'Validation failed',
        'ValidationException',
        'invoke-model'
      );
      expect(nonRetryableError.retryable).toBe(false);
    });
  });

  describe('ConfigurationError', () => {
    it('should create configuration error', () => {
      const error = ConfigurationError.create(
        'Invalid configuration',
        'validate-config',
        'correlation-456',
        { configKey: 'bedrock.modelId' }
      );
      
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.severity).toBe(ErrorSeverity.CRITICAL);
      expect(error.retryable).toBe(false);
    });
  });

  describe('TwilioValidationError', () => {
    it('should create twilio validation error', () => {
      const error = TwilioValidationError.create(
        'Invalid webhook signature',
        'validate-webhook',
        'correlation-456',
        { signature: 'invalid' }
      );
      
      expect(error.code).toBe('TWILIO_VALIDATION_ERROR');
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.retryable).toBe(false);
    });
  });

  describe('WebSocketError', () => {
    it('should create websocket error', () => {
      const error = WebSocketError.create(
        'Connection failed',
        'websocket-connect',
        'session-123',
        'correlation-456',
        { readyState: 3 }
      );
      
      expect(error.code).toBe('WEBSOCKET_ERROR');
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.retryable).toBe(true);
    });
  });

  describe('ValidationError', () => {
    it('should create validation error', () => {
      const validationErrors = ['Field is required', 'Invalid format'];
      const error = ValidationError.create(
        'Validation failed',
        validationErrors,
        'validate-input',
        'correlation-456',
        { field: 'sessionId' }
      );
      
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(false);
      expect(error.validationErrors).toEqual(validationErrors);
    });
  });

  describe('Utility Functions', () => {
    describe('isBedrockClientError', () => {
      it('should identify BedrockClientError instances', () => {
        const bedrockError = SessionError.create('Test', 'test-op');
        const regularError = new Error('Regular error');
        
        expect(isBedrockClientError(bedrockError)).toBe(true);
        expect(isBedrockClientError(regularError)).toBe(false);
        expect(isBedrockClientError(null)).toBe(false);
        expect(isBedrockClientError(undefined)).toBe(false);
        expect(isBedrockClientError('string')).toBe(false);
      });
    });

    describe('extractErrorDetails', () => {
      it('should extract details from BedrockClientError', () => {
        const error = SessionError.create(
          'Test error',
          'test-operation',
          'session-123',
          'correlation-456'
        );
        
        const details = extractErrorDetails(error);
        
        expect(details).toMatchObject({
          name: 'SessionError',
          message: 'Test error',
          code: 'SESSION_ERROR',
          sessionId: 'session-123',
          correlationId: 'correlation-456',
          severity: ErrorSeverity.MEDIUM,
          retryable: true
        });
        expect(details.stack).toBeDefined();
        expect(details.context).toBeDefined();
      });

      it('should extract details from regular Error', () => {
        const error = new Error('Regular error');
        error.name = 'CustomError';
        
        const details = extractErrorDetails(error);
        
        expect(details).toMatchObject({
          name: 'CustomError',
          message: 'Regular error'
        });
        expect(details.stack).toBeDefined();
      });

      it('should handle non-error objects', () => {
        const details1 = extractErrorDetails('string error');
        expect(details1.name).toBe('UnknownError');
        expect(details1.message).toBe('Unknown error');
        
        const details2 = extractErrorDetails(null);
        expect(details2.name).toBe('UnknownError');
        
        const details3 = extractErrorDetails({ message: 'Object error', code: 'OBJ_ERROR' });
        expect(details3.message).toBe('Object error');
        expect(details3.code).toBe('OBJ_ERROR');
      });
    });

    describe('createBedrockServiceError', () => {
      it('should create error from AWS service error', () => {
        const awsError = {
          name: 'ThrottlingException',
          message: 'Request was throttled',
          statusCode: 429,
          retryable: true
        };
        
        const error = createBedrockServiceError(
          awsError,
          'invoke-model',
          'session-123',
          'correlation-456'
        );
        
        expect(error.serviceErrorType).toBe('ThrottlingException');
        expect(error.message).toBe('Request was throttled');
        expect(error.retryable).toBe(true);
        expect(error.context.metadata.statusCode).toBe(429);
      });

      it('should handle errors without standard properties', () => {
        const unknownError = { someProperty: 'value' };
        
        const error = createBedrockServiceError(
          unknownError,
          'invoke-model',
          'session-123'
        );
        
        expect(error.serviceErrorType).toBe('UnknownError');
        expect(error.message).toBe('Unknown Bedrock service error');
      });

      it('should handle Error instances', () => {
        const jsError = new Error('JavaScript error');
        jsError.name = 'CustomError';
        
        const error = createBedrockServiceError(
          jsError,
          'invoke-model',
          'session-123'
        );
        
        expect(error.serviceErrorType).toBe('CustomError');
        expect(error.message).toBe('JavaScript error');
        expect(error.cause).toBe(jsError);
      });
    });
  });

  describe('Error Inheritance and Polymorphism', () => {
    it('should maintain proper inheritance chain', () => {
      const sessionError = SessionError.create('Test', 'test-op');
      
      expect(sessionError instanceof SessionError).toBe(true);
      expect(sessionError instanceof BedrockClientError).toBe(true);
      expect(sessionError instanceof Error).toBe(true);
    });

    it('should have proper error names', () => {
      const errors = [
        SessionError.create('Test', 'test-op'),
        SessionNotFoundError.create('session-123', 'find'),
        StreamingError.create('Test', 'stream'),
        AudioProcessingError.create('Test', 'process')
      ];
      
      expect(errors[0].name).toBe('SessionError');
      expect(errors[1].name).toBe('SessionNotFoundError');
      expect(errors[2].name).toBe('StreamingError');
      expect(errors[3].name).toBe('AudioProcessingError');
    });

    it('should maintain stack traces', () => {
      const error = SessionError.create('Test', 'test-op');
      
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('SessionError');
    });
  });

  describe('Retry Logic', () => {
    it('should handle retry attempts correctly', () => {
      const context: ErrorContext = {
        ...mockContext,
        retryAttempt: 0,
        maxRetries: 3
      };
      
      let error: BedrockClientError = new SessionError('Test', context);
      
      expect(error.canRetry()).toBe(true);
      
      error = error.forRetry();
      expect(error.context.retryAttempt).toBe(1);
      expect(error.canRetry()).toBe(true);
      
      error = error.forRetry();
      expect(error.context.retryAttempt).toBe(2);
      expect(error.canRetry()).toBe(true);
      
      error = error.forRetry();
      expect(error.context.retryAttempt).toBe(3);
      expect(error.canRetry()).toBe(false);
    });

    it('should respect non-retryable errors', () => {
      const error = SessionNotFoundError.create('session-123', 'find');
      
      expect(error.retryable).toBe(false);
      expect(error.canRetry()).toBe(false);
    });
  });

  describe('Error Context', () => {
    it('should preserve context through retry', () => {
      const originalContext: ErrorContext = {
        correlationId: 'correlation-123',
        sessionId: 'session-456',
        operation: 'test-operation',
        timestamp: Date.now(),
        metadata: { important: 'data' },
        retryAttempt: 0,
        maxRetries: 3
      };
      
      const error = new SessionError('Test', originalContext);
      const retryError = error.forRetry();
      
      expect(retryError.context.correlationId).toBe('correlation-123');
      expect(retryError.context.sessionId).toBe('session-456');
      expect(retryError.context.operation).toBe('test-operation');
      expect(retryError.context.metadata.important).toBe('data');
      expect(retryError.context.retryAttempt).toBe(1);
      expect(retryError.context.maxRetries).toBe(3);
    });

    it('should update timestamp on retry', () => {
      const originalTimestamp = Date.now() - 1000;
      const context: ErrorContext = {
        ...mockContext,
        timestamp: originalTimestamp
      };
      
      const error = new SessionError('Test', context);
      const retryError = error.forRetry();
      
      expect(retryError.context.timestamp).toBeGreaterThan(originalTimestamp);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing context properties gracefully', () => {
      const minimalContext: ErrorContext = {
        operation: 'test',
        timestamp: Date.now(),
        metadata: {}
      };
      
      const error = new SessionError('Test', minimalContext);
      
      expect(error.sessionId).toBeUndefined();
      expect(error.correlationId).toBeUndefined();
      expect(error.operation).toBe('test');
    });

    it('should handle very long error messages', () => {
      const longMessage = 'x'.repeat(10000);
      const error = SessionError.create(longMessage, 'test-op');
      
      expect(error.message).toBe(longMessage);
      expect(error.toJSON().message).toBe(longMessage);
    });

    it('should handle complex metadata', () => {
      const complexMetadata = {
        nested: {
          object: {
            with: ['arrays', 'and', 'values'],
            numbers: [1, 2, 3],
            boolean: true
          }
        },
        circular: {} as any
      };
      complexMetadata.circular = complexMetadata;
      
      const context: ErrorContext = {
        ...mockContext,
        metadata: complexMetadata
      };
      
      expect(() => {
        const error = new SessionError('Test', context);
        error.toJSON();
      }).not.toThrow();
    });
  });
});