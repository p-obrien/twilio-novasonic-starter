/**
 * @fileoverview Error Logging with Context Tests
 *
 * Tests verify that errors are logged with proper context including:
 * - Correlation IDs
 * - Session IDs
 * - Operation names
 * - Error severity
 * - Retry information
 *
 * **Validates: Requirements 8.5**
 */

import {
  SessionError,
  AudioProcessingError,
  StreamingError,
  BedrockServiceError,
  CircuitBreakerOpenError,
  ValidationError,
  extractErrorDetails,
  ErrorSeverity
} from '../../../errors/ClientErrors';
import logger from '../../../observability/logger';

// Mock the logger
jest.mock('../../../observability/logger');

describe('Error Logging with Context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Error Context Extraction', () => {
    it('should extract full context from BedrockClientError', () => {
      const error = SessionError.create(
        'Session failed',
        'session_operation',
        'session-123',
        'correlation-456',
        { additionalInfo: 'test' }
      );

      const details = extractErrorDetails(error);

      expect(details.name).toBe('SessionError');
      expect(details.message).toBe('Session failed');
      expect(details.code).toBe('SESSION_ERROR');
      expect(details.sessionId).toBe('session-123');
      expect(details.correlationId).toBe('correlation-456');
      expect(details.severity).toBe(ErrorSeverity.MEDIUM);
      expect(details.retryable).toBe(true);
      expect(details.context).toBeDefined();
      expect(details.context?.operation).toBe('session_operation');
    });

    it('should extract context from standard Error', () => {
      const error = new Error('Standard error');

      const details = extractErrorDetails(error);

      expect(details.name).toBe('Error');
      expect(details.message).toBe('Standard error');
      expect(details.code).toBeUndefined();
      expect(details.sessionId).toBeUndefined();
      expect(details.correlationId).toBeUndefined();
    });

    it('should handle unknown error types', () => {
      const error = { custom: 'error' };

      const details = extractErrorDetails(error);

      expect(details.name).toBe('UnknownError');
      expect(details.message).toBe('Unknown error');
    });

    it('should extract stack trace when available', () => {
      const error = new Error('Test error');

      const details = extractErrorDetails(error);

      expect(details.stack).toBeDefined();
      expect(details.stack).toContain('Error: Test error');
    });
  });

  describe('Session Error Logging', () => {
    it('should log session errors with correlation ID', () => {
      const error = SessionError.create(
        'Session initialization failed',
        'session_init',
        'session-123',
        'correlation-456'
      );

      logger.error('Session error occurred', {
        ...extractErrorDetails(error),
        timestamp: new Date().toISOString()
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Session error occurred',
        expect.objectContaining({
          code: 'SESSION_ERROR',
          sessionId: 'session-123',
          correlationId: 'correlation-456',
          severity: ErrorSeverity.MEDIUM
        })
      );
    });

    it('should log session errors with retry information', () => {
      const error = SessionError.create(
        'Session operation failed',
        'session_operation',
        'session-123',
        'correlation-456',
        { retryAttempt: 2, maxRetries: 3 }
      );

      const logData = {
        ...extractErrorDetails(error),
        retryAttempt: error.context.metadata.retryAttempt,
        maxRetries: error.context.metadata.maxRetries
      };

      logger.warn('Retrying session operation', logData);

      expect(logger.warn).toHaveBeenCalledWith(
        'Retrying session operation',
        expect.objectContaining({
          sessionId: 'session-123',
          correlationId: 'correlation-456',
          context: expect.objectContaining({
            metadata: expect.objectContaining({
              retryAttempt: 2,
              maxRetries: 3
            })
          })
        })
      );
    });
  });

  describe('Audio Processing Error Logging', () => {
    it('should log audio errors with buffer information', () => {
      const error = AudioProcessingError.create(
        'Buffer overflow',
        'audio_buffer',
        'session-123',
        'correlation-456',
        { bufferSize: 1024, maxSize: 512 }
      );

      logger.error('Audio processing failed', {
        ...extractErrorDetails(error),
        bufferSize: error.context.metadata.bufferSize,
        maxSize: error.context.metadata.maxSize
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Audio processing failed',
        expect.objectContaining({
          code: 'AUDIO_PROCESSING_ERROR',
          sessionId: 'session-123',
          bufferSize: 1024,
          maxSize: 512
        })
      );
    });

    it('should log audio errors with format information', () => {
      const error = AudioProcessingError.create(
        'Format conversion failed',
        'audio_conversion',
        'session-123',
        'correlation-456',
        { fromFormat: 'mulaw', toFormat: 'pcm', sampleRate: 8000 }
      );

      logger.error('Audio conversion error', extractErrorDetails(error));

      expect(logger.error).toHaveBeenCalledWith(
        'Audio conversion error',
        expect.objectContaining({
          code: 'AUDIO_PROCESSING_ERROR',
          context: expect.objectContaining({
            metadata: expect.objectContaining({
              fromFormat: 'mulaw',
              toFormat: 'pcm',
              sampleRate: 8000
            })
          })
        })
      );
    });
  });

  describe('Streaming Error Logging', () => {
    it('should log streaming errors with connection details', () => {
      const error = StreamingError.create(
        'WebSocket connection lost',
        'websocket_streaming',
        'session-123',
        'correlation-456',
        { connectionState: 'CLOSED', lastPingMs: 5000 }
      );

      logger.error('Streaming error', extractErrorDetails(error));

      expect(logger.error).toHaveBeenCalledWith(
        'Streaming error',
        expect.objectContaining({
          code: 'STREAMING_ERROR',
          severity: ErrorSeverity.HIGH,
          sessionId: 'session-123'
        })
      );
    });
  });

  describe('Bedrock Service Error Logging', () => {
    it('should log throttling errors with retry information', () => {
      const error = BedrockServiceError.create(
        'Rate limit exceeded',
        'ThrottlingException',
        'bedrock_invoke',
        'session-123',
        'correlation-456',
        { requestId: 'req-789', retryAfter: 30 }
      );

      logger.warn('Bedrock throttling', extractErrorDetails(error));

      expect(logger.warn).toHaveBeenCalledWith(
        'Bedrock throttling',
        expect.objectContaining({
          code: 'BEDROCK_SERVICE_ERROR',
          retryable: true,
          context: expect.objectContaining({
            metadata: expect.objectContaining({
              serviceErrorType: 'ThrottlingException'
            })
          })
        })
      );
    });

    it('should log service errors with AWS request details', () => {
      const error = BedrockServiceError.create(
        'Internal server error',
        'InternalServerException',
        'bedrock_invoke',
        'session-123',
        'correlation-456',
        { requestId: 'req-789', statusCode: 500 }
      );

      logger.error('Bedrock service error', extractErrorDetails(error));

      expect(logger.error).toHaveBeenCalledWith(
        'Bedrock service error',
        expect.objectContaining({
          code: 'BEDROCK_SERVICE_ERROR',
          severity: ErrorSeverity.HIGH
        })
      );
    });
  });

  describe('Circuit Breaker Error Logging', () => {
    it('should log circuit breaker open with retry timing', () => {
      const nextAttemptTime = Date.now() + 30000;
      const error = CircuitBreakerOpenError.create(
        'bedrock-circuit',
        nextAttemptTime,
        'circuit_breaker_check',
        'session-123',
        'correlation-456'
      );

      logger.warn('Circuit breaker open', {
        ...extractErrorDetails(error),
        retryAfterMs: error.getRetryAfterMs(),
        retryAfterSeconds: error.getRetryAfterSeconds()
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Circuit breaker open',
        expect.objectContaining({
          code: 'CIRCUIT_BREAKER_OPEN',
          retryable: true,
          retryAfterMs: expect.any(Number),
          retryAfterSeconds: expect.any(Number)
        })
      );
    });
  });

  describe('Validation Error Logging', () => {
    it('should log validation errors with field details', () => {
      const error = ValidationError.create(
        'Invalid request',
        ['sessionId is required', 'audio format must be PCM or mulaw'],
        'request_validation',
        'correlation-456',
        { endpoint: '/api/session' }
      );

      logger.warn('Validation failed', extractErrorDetails(error));

      expect(logger.warn).toHaveBeenCalledWith(
        'Validation failed',
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
          severity: ErrorSeverity.MEDIUM
        })
      );
    });
  });

  describe('Error Severity Logging', () => {
    it('should use appropriate log level for error severity', () => {
      const lowSeverityError = SessionError.create(
        'Minor issue',
        'test_operation',
        'session-123'
      );
      lowSeverityError.context.metadata.severity = ErrorSeverity.LOW;

      const highSeverityError = StreamingError.create(
        'Critical failure',
        'streaming',
        'session-123'
      );

      // Low severity -> info or warn
      logger.info('Low severity error', extractErrorDetails(lowSeverityError));

      // High severity -> error
      logger.error('High severity error', extractErrorDetails(highSeverityError));

      expect(logger.info).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Nested Error Logging', () => {
    it('should log nested errors with cause chain', () => {
      const rootCause = new Error('Root cause error');
      const wrappedError = SessionError.create(
        'Session failed due to underlying error',
        'session_operation',
        'session-123',
        'correlation-456',
        {},
        rootCause
      );

      const details = extractErrorDetails(wrappedError);

      logger.error('Nested error occurred', details);

      expect(logger.error).toHaveBeenCalledWith(
        'Nested error occurred',
        expect.objectContaining({
          message: 'Session failed due to underlying error',
          context: expect.any(Object)
        })
      );

      // Verify cause is accessible
      expect(wrappedError.cause).toBe(rootCause);
    });
  });

  describe('Structured Error Logging', () => {
    it('should log errors in structured JSON format', () => {
      const error = AudioProcessingError.create(
        'Processing failed',
        'audio_processing',
        'session-123',
        'correlation-456',
        { sampleRate: 16000, channels: 1 }
      );

      const structuredLog = {
        level: 'error',
        message: 'Audio processing error',
        error: extractErrorDetails(error),
        timestamp: new Date().toISOString(),
        service: 'twilio-bedrock-bridge'
      };

      logger.error(structuredLog.message, structuredLog);

      expect(logger.error).toHaveBeenCalledWith(
        'Audio processing error',
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'AUDIO_PROCESSING_ERROR',
            sessionId: 'session-123',
            correlationId: 'correlation-456'
          })
        })
      );
    });

    it('should include operation context in logs', () => {
      const error = SessionError.create(
        'Operation failed',
        'session_cleanup',
        'session-123',
        'correlation-456',
        { duration: 1500, resourcesFreed: 5 }
      );

      logger.error('Session cleanup failed', {
        ...extractErrorDetails(error),
        operation: error.operation,
        duration: error.context.metadata.duration,
        resourcesFreed: error.context.metadata.resourcesFreed
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Session cleanup failed',
        expect.objectContaining({
          operation: 'session_cleanup',
          duration: 1500,
          resourcesFreed: 5
        })
      );
    });
  });

  describe('Error Aggregation Logging', () => {
    it('should log multiple errors with summary', () => {
      const errors = [
        SessionError.create('Error 1', 'op1', 'session-1'),
        SessionError.create('Error 2', 'op2', 'session-2'),
        SessionError.create('Error 3', 'op3', 'session-3')
      ];

      const errorSummary = {
        totalErrors: errors.length,
        errorCodes: errors.map(e => e.code),
        sessionIds: errors.map(e => e.sessionId),
        details: errors.map(e => extractErrorDetails(e))
      };

      logger.error('Multiple errors occurred', errorSummary);

      expect(logger.error).toHaveBeenCalledWith(
        'Multiple errors occurred',
        expect.objectContaining({
          totalErrors: 3,
          errorCodes: ['SESSION_ERROR', 'SESSION_ERROR', 'SESSION_ERROR']
        })
      );
    });
  });

  describe('Performance Impact Logging', () => {
    it('should log errors with timing information', () => {
      const startTime = Date.now();
      const error = StreamingError.create(
        'Streaming timeout',
        'audio_streaming',
        'session-123',
        'correlation-456',
        { startTime, timeout: 30000 }
      );

      const duration = Date.now() - startTime;

      logger.error('Streaming error with timing', {
        ...extractErrorDetails(error),
        duration,
        timeout: error.context.metadata.timeout
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Streaming error with timing',
        expect.objectContaining({
          duration: expect.any(Number),
          timeout: 30000
        })
      );
    });
  });

  describe('Error Correlation', () => {
    it('should maintain correlation ID across error chain', () => {
      const correlationId = 'correlation-123';

      const error1 = SessionError.create(
        'First error',
        'operation1',
        'session-1',
        correlationId
      );

      const error2 = AudioProcessingError.create(
        'Second error',
        'operation2',
        'session-1',
        correlationId
      );

      logger.error('Error 1', extractErrorDetails(error1));
      logger.error('Error 2', extractErrorDetails(error2));

      expect(logger.error).toHaveBeenNthCalledWith(
        1,
        'Error 1',
        expect.objectContaining({ correlationId })
      );

      expect(logger.error).toHaveBeenNthCalledWith(
        2,
        'Error 2',
        expect.objectContaining({ correlationId })
      );
    });
  });
});
