/**
 * @fileoverview Custom Error Classes for Bedrock Client
 * 
 * Provides specific error types for better error handling and debugging
 */

/**
 * Error severity levels for classification
 */
export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

/**
 * Error context information for better debugging
 */
export interface ErrorContext {
  readonly correlationId?: string;
  readonly sessionId?: string;
  readonly operation: string;
  readonly timestamp: number;
  readonly metadata: Record<string, unknown>;
  readonly retryAttempt?: number;
  readonly maxRetries?: number;
}

/**
 * Base error class for all Bedrock client errors
 */
export abstract class BedrockClientError extends Error {
  abstract readonly code: string;
  abstract readonly severity: ErrorSeverity;
  abstract readonly retryable: boolean;
  
  constructor(
    message: string,
    public readonly context: ErrorContext,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get session ID from context for backward compatibility
   */
  get sessionId(): string | undefined {
    return this.context.sessionId;
  }

  /**
   * Get correlation ID from context
   */
  get correlationId(): string | undefined {
    return this.context.correlationId;
  }

  /**
   * Get operation name from context
   */
  get operation(): string {
    return this.context.operation;
  }

  /**
   * Check if this error can be retried
   */
  canRetry(): boolean {
    if (!this.retryable) return false;
    
    const { retryAttempt = 0, maxRetries = 3 } = this.context;
    return retryAttempt < maxRetries;
  }

  /**
   * Create a new error instance for retry with incremented attempt count
   */
  forRetry(): BedrockClientError {
    const newContext: ErrorContext = {
      ...this.context,
      retryAttempt: (this.context.retryAttempt || 0) + 1,
      timestamp: Date.now()
    };
    
    // Use constructor of the actual class
    const ErrorClass = this.constructor as new (message: string, context: ErrorContext, cause?: Error) => BedrockClientError;
    return new ErrorClass(this.message, newContext, this.cause);
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      retryable: this.retryable,
      context: this.context,
      stack: this.stack,
      cause: this.cause ? {
        name: this.cause.name,
        message: this.cause.message,
        stack: this.cause.stack
      } : undefined
    };
  }
}

/**
 * Error thrown when session operations fail
 */
export class SessionError extends BedrockClientError {
  readonly code: string = 'SESSION_ERROR';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly retryable = true;
  
  constructor(message: string, context: ErrorContext | string, cause?: Error) {
    // Handle backward compatibility - if context is a string, treat it as sessionId
    const errorContext: ErrorContext = typeof context === 'string' 
      ? {
          sessionId: context,
          operation: 'session_operation',
          timestamp: Date.now(),
          metadata: {}
        }
      : context;
    
    super(message, errorContext, cause);
  }

  static create(
    message: string,
    operation: string,
    sessionId?: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {},
    cause?: Error
  ): SessionError {
    const context: ErrorContext = {
      correlationId,
      sessionId,
      operation,
      timestamp: Date.now(),
      metadata
    };
    return new SessionError(message, context, cause);
  }
}

/**
 * Error thrown when session is not found
 */
export class SessionNotFoundError extends BedrockClientError {
  readonly code = 'SESSION_NOT_FOUND';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly retryable = false;
  
  constructor(context: ErrorContext) {
    super(`Session ${context.sessionId} not found`, context);
  }

  static create(
    sessionId: string,
    operation: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {}
  ): SessionNotFoundError {
    const context: ErrorContext = {
      correlationId,
      sessionId,
      operation,
      timestamp: Date.now(),
      metadata
    };
    return new SessionNotFoundError(context);
  }
}

/**
 * Error thrown when session already exists
 */
export class SessionAlreadyExistsError extends BedrockClientError {
  readonly code = 'SESSION_ALREADY_EXISTS';
  readonly severity = ErrorSeverity.LOW;
  readonly retryable = false;
  
  constructor(context: ErrorContext) {
    super(`Session ${context.sessionId} already exists`, context);
  }

  static create(
    sessionId: string,
    operation: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {}
  ): SessionAlreadyExistsError {
    const context: ErrorContext = {
      correlationId,
      sessionId,
      operation,
      timestamp: Date.now(),
      metadata
    };
    return new SessionAlreadyExistsError(context);
  }
}

/**
 * Error thrown when session is inactive
 */
export class SessionInactiveError extends BedrockClientError {
  readonly code = 'SESSION_INACTIVE';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly retryable = false;
  
  constructor(context: ErrorContext | string) {
    // Handle backward compatibility - if context is a string, treat it as sessionId
    const errorContext: ErrorContext = typeof context === 'string' 
      ? {
          sessionId: context,
          operation: 'session_inactive_check',
          timestamp: Date.now(),
          metadata: {}
        }
      : context;
    
    super(`Session ${errorContext.sessionId} is inactive`, errorContext);
  }

  static create(
    sessionId: string,
    operation: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {}
  ): SessionInactiveError {
    const context: ErrorContext = {
      correlationId,
      sessionId,
      operation,
      timestamp: Date.now(),
      metadata
    };
    return new SessionInactiveError(context);
  }
}

/**
 * Error thrown when streaming operations fail
 */
export class StreamingError extends BedrockClientError {
  readonly code = 'STREAMING_ERROR';
  readonly severity = ErrorSeverity.HIGH;
  readonly retryable = true;
  
  constructor(message: string, context: ErrorContext, cause?: Error) {
    super(message, context, cause);
  }

  static create(
    message: string,
    operation: string,
    sessionId?: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {},
    cause?: Error
  ): StreamingError {
    const context: ErrorContext = {
      correlationId,
      sessionId,
      operation,
      timestamp: Date.now(),
      metadata
    };
    return new StreamingError(message, context, cause);
  }
}

/**
 * Error thrown when audio processing fails
 */
export class AudioProcessingError extends BedrockClientError {
  readonly code = 'AUDIO_PROCESSING_ERROR';
  readonly severity = ErrorSeverity.HIGH;
  readonly retryable = true;
  
  constructor(message: string, context: ErrorContext | string, cause?: Error) {
    // Handle backward compatibility - if context is a string, treat it as sessionId
    const errorContext: ErrorContext = typeof context === 'string' 
      ? {
          sessionId: context,
          operation: 'audio_processing',
          timestamp: Date.now(),
          metadata: {}
        }
      : context;
    
    super(message, errorContext, cause);
  }

  static create(
    message: string,
    operation: string,
    sessionId?: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {},
    cause?: Error
  ): AudioProcessingError {
    const context: ErrorContext = {
      correlationId,
      sessionId,
      operation,
      timestamp: Date.now(),
      metadata
    };
    return new AudioProcessingError(message, context, cause);
  }
}

/**
 * Error thrown when event acknowledgment times out
 */
export class AckTimeoutError extends BedrockClientError {
  readonly code = 'ACK_TIMEOUT';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly retryable = true;
  
  constructor(context: ErrorContext, public readonly timeoutMs: number) {
    super(`Event acknowledgment timeout after ${timeoutMs}ms for session ${context.sessionId}`, context);
  }

  static create(
    sessionId: string,
    timeoutMs: number,
    operation: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {}
  ): AckTimeoutError {
    const context: ErrorContext = {
      correlationId,
      sessionId,
      operation,
      timestamp: Date.now(),
      metadata: { ...metadata, timeoutMs }
    };
    return new AckTimeoutError(context, timeoutMs);
  }
}

/**
 * Error thrown when AWS Bedrock operations fail
 */
export class BedrockServiceError extends BedrockClientError {
  readonly code = 'BEDROCK_SERVICE_ERROR';
  readonly severity = ErrorSeverity.HIGH;
  readonly retryable: boolean;
  
  constructor(
    message: string,
    context: ErrorContext,
    public readonly serviceErrorType: string,
    cause?: Error
  ) {
    super(message, context, cause);
    // Determine if error is retryable based on service error type
    this.retryable = this.isRetryableServiceError(serviceErrorType);
  }

  private isRetryableServiceError(errorType: string): boolean {
    const retryableErrors = [
      'ThrottlingException',
      'InternalServerException',
      'ServiceUnavailableException',
      'TooManyRequestsException'
    ];
    return retryableErrors.includes(errorType);
  }

  static create(
    message: string,
    serviceErrorType: string,
    operation: string,
    sessionId?: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {},
    cause?: Error
  ): BedrockServiceError {
    const context: ErrorContext = {
      correlationId,
      sessionId,
      operation,
      timestamp: Date.now(),
      metadata: { ...metadata, serviceErrorType }
    };
    return new BedrockServiceError(message, context, serviceErrorType, cause);
  }
}

/**
 * Utility function to create appropriate error from AWS service errors
 */
export function createBedrockServiceError(
  error: unknown,
  operation: string,
  sessionId?: string,
  correlationId?: string
): BedrockServiceError {
  const errorType = getErrorProperty(error, 'name') || getErrorProperty(error, 'code') || 'UnknownError';
  const message = getErrorProperty(error, 'message') || 'Unknown Bedrock service error';
  
  const metadata: Record<string, unknown> = {};
  if (hasProperty(error, 'statusCode')) {
    metadata.statusCode = error.statusCode;
  }
  if (hasProperty(error, 'retryable')) {
    metadata.retryable = error.retryable;
  }
  
  return BedrockServiceError.create(
    message,
    errorType,
    operation,
    sessionId,
    correlationId,
    metadata,
    error instanceof Error ? error : undefined
  );
}

/**
 * Type guard to check if error is a BedrockClientError
 */
export function isBedrockClientError(error: unknown): error is BedrockClientError {
  return error instanceof BedrockClientError;
}

/**
 * Error thrown when configuration is invalid
 */
export class ConfigurationError extends BedrockClientError {
  readonly code = 'CONFIGURATION_ERROR';
  readonly severity = ErrorSeverity.CRITICAL;
  readonly retryable = false;
  
  constructor(message: string, context: ErrorContext, cause?: Error) {
    super(message, context, cause);
  }

  static create(
    message: string,
    operation: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {},
    cause?: Error
  ): ConfigurationError {
    const context: ErrorContext = {
      correlationId,
      operation,
      timestamp: Date.now(),
      metadata
    };
    return new ConfigurationError(message, context, cause);
  }
}

/**
 * Error thrown when Twilio webhook validation fails
 */
export class TwilioValidationError extends BedrockClientError {
  readonly code = 'TWILIO_VALIDATION_ERROR';
  readonly severity = ErrorSeverity.HIGH;
  readonly retryable = false;
  
  constructor(message: string, context: ErrorContext, cause?: Error) {
    super(message, context, cause);
  }

  static create(
    message: string,
    operation: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {},
    cause?: Error
  ): TwilioValidationError {
    const context: ErrorContext = {
      correlationId,
      operation,
      timestamp: Date.now(),
      metadata
    };
    return new TwilioValidationError(message, context, cause);
  }
}

/**
 * Error thrown when WebSocket operations fail
 */
export class WebSocketError extends BedrockClientError {
  readonly code = 'WEBSOCKET_ERROR';
  readonly severity = ErrorSeverity.HIGH;
  readonly retryable = true;
  
  constructor(message: string, context: ErrorContext, cause?: Error) {
    super(message, context, cause);
  }

  static create(
    message: string,
    operation: string,
    sessionId?: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {},
    cause?: Error
  ): WebSocketError {
    const context: ErrorContext = {
      correlationId,
      sessionId,
      operation,
      timestamp: Date.now(),
      metadata
    };
    return new WebSocketError(message, context, cause);
  }
}

/**
 * Utility to extract error details for logging
 */
export function extractErrorDetails(error: unknown): {
  name: string;
  message: string;
  code?: string;
  sessionId?: string;
  correlationId?: string;
  severity?: ErrorSeverity;
  retryable?: boolean;
  stack?: string;
  context?: ErrorContext;
} {
  if (isBedrockClientError(error)) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      sessionId: error.sessionId,
      correlationId: error.correlationId,
      severity: error.severity,
      retryable: error.retryable,
      stack: error.stack,
      context: error.context
    };
  }

  return {
    name: getErrorProperty(error, 'name') || 'UnknownError',
    message: getErrorProperty(error, 'message') || 'Unknown error',
    code: getErrorProperty(error, 'code'),
    sessionId: getErrorProperty(error, 'sessionId'),
    stack: getErrorProperty(error, 'stack')
  };
}

/**
 * Helper function to safely get a property from an unknown error object
 */
function getErrorProperty(error: unknown, property: string): string | undefined {
  if (hasProperty(error, property)) {
    const value = error[property];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

/**
 * Type guard to check if an object has a specific property
 */
function hasProperty<T extends string>(
  obj: unknown,
  property: T
): obj is Record<T, unknown> {
  return typeof obj === 'object' && obj !== null && property in obj;
}

/**
 * Validation error for input validation failures
 */
export class ValidationError extends BedrockClientError {
  readonly code = 'VALIDATION_ERROR';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly retryable = false;
  
  constructor(
    message: string,
    context: ErrorContext,
    public readonly validationErrors: string[],
    cause?: Error
  ) {
    super(message, context, cause);
  }

  static create(
    message: string,
    validationErrors: string[],
    operation: string,
    correlationId?: string,
    metadata: Record<string, unknown> = {},
    cause?: Error
  ): ValidationError {
    const context: ErrorContext = {
      correlationId,
      operation,
      timestamp: Date.now(),
      metadata: { ...metadata, validationErrors }
    };
    return new ValidationError(message, context, validationErrors, cause);
  }
}