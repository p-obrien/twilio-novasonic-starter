/**
 * @fileoverview Custom Error Classes for Bedrock Client
 * 
 * Provides specific error types for better error handling and debugging
 */

/**
 * Base error class for all Bedrock client errors
 */
export abstract class BedrockClientError extends Error {
  abstract readonly code: string;
  
  constructor(
    message: string,
    public readonly sessionId?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when session operations fail
 */
export class SessionError extends BedrockClientError {
  readonly code: string = 'SESSION_ERROR';
  
  constructor(message: string, sessionId?: string, cause?: Error) {
    super(message, sessionId, cause);
  }
}

/**
 * Error thrown when session is not found
 */
export class SessionNotFoundError extends SessionError {
  readonly code = 'SESSION_NOT_FOUND';
  
  constructor(sessionId: string) {
    super(`Session ${sessionId} not found`, sessionId);
  }
}

/**
 * Error thrown when session already exists
 */
export class SessionAlreadyExistsError extends SessionError {
  readonly code = 'SESSION_ALREADY_EXISTS';
  
  constructor(sessionId: string) {
    super(`Session ${sessionId} already exists`, sessionId);
  }
}

/**
 * Error thrown when session is inactive
 */
export class SessionInactiveError extends SessionError {
  readonly code = 'SESSION_INACTIVE';
  
  constructor(sessionId: string) {
    super(`Session ${sessionId} is inactive`, sessionId);
  }
}

/**
 * Error thrown when streaming operations fail
 */
export class StreamingError extends BedrockClientError {
  readonly code = 'STREAMING_ERROR';
  
  constructor(message: string, sessionId?: string, cause?: Error) {
    super(message, sessionId, cause);
  }
}

/**
 * Error thrown when audio processing fails
 */
export class AudioProcessingError extends BedrockClientError {
  readonly code = 'AUDIO_PROCESSING_ERROR';
  
  constructor(message: string, sessionId?: string, cause?: Error) {
    super(message, sessionId, cause);
  }
}

/**
 * Error thrown when event acknowledgment times out
 */
export class AckTimeoutError extends BedrockClientError {
  readonly code = 'ACK_TIMEOUT';
  
  constructor(sessionId: string, timeoutMs: number) {
    super(`Event acknowledgment timeout after ${timeoutMs}ms for session ${sessionId}`, sessionId);
  }
}

/**
 * Error thrown when AWS Bedrock operations fail
 */
export class BedrockServiceError extends BedrockClientError {
  readonly code = 'BEDROCK_SERVICE_ERROR';
  
  constructor(
    message: string,
    public readonly serviceErrorType: string,
    sessionId?: string,
    cause?: Error
  ) {
    super(message, sessionId, cause);
  }
}

/**
 * Utility function to create appropriate error from AWS service errors
 */
export function createBedrockServiceError(
  error: any,
  sessionId?: string
): BedrockServiceError {
  const errorType = error.name || error.code || 'UnknownError';
  const message = error.message || 'Unknown Bedrock service error';
  
  return new BedrockServiceError(message, errorType, sessionId, error);
}

/**
 * Type guard to check if error is a BedrockClientError
 */
export function isBedrockClientError(error: any): error is BedrockClientError {
  return error instanceof BedrockClientError;
}

/**
 * Error thrown when configuration is invalid
 */
export class ConfigurationError extends BedrockClientError {
  readonly code = 'CONFIGURATION_ERROR';
  
  constructor(message: string, cause?: Error) {
    super(message, undefined, cause);
  }
}

/**
 * Error thrown when Twilio webhook validation fails
 */
export class TwilioValidationError extends BedrockClientError {
  readonly code = 'TWILIO_VALIDATION_ERROR';
  
  constructor(message: string, cause?: Error) {
    super(message, undefined, cause);
  }
}

/**
 * Error thrown when WebSocket operations fail
 */
export class WebSocketError extends BedrockClientError {
  readonly code = 'WEBSOCKET_ERROR';
  
  constructor(message: string, sessionId?: string, cause?: Error) {
    super(message, sessionId, cause);
  }
}

/**
 * Error thrown when integration operations fail (Knowledge Base, Agent Core, etc.)
 */
export class IntegrationError extends BedrockClientError {
  readonly code = 'INTEGRATION_ERROR';
  
  constructor(
    message: string,
    public readonly component: 'knowledge' | 'agent' | 'orchestrator' | 'classifier',
    public readonly metadata: Record<string, any> = {},
    sessionId?: string,
    cause?: Error
  ) {
    super(message, sessionId, cause);
  }

  /**
   * Get structured error data for logging and metrics
   */
  getStructuredData(): {
    errorType: string;
    component: string;
    message: string;
    sessionId?: string;
    metadata: Record<string, any>;
    timestamp: string;
    correlationId?: string;
  } {
    return {
      errorType: this.code,
      component: this.component,
      message: this.message,
      sessionId: this.sessionId,
      metadata: this.metadata,
      timestamp: new Date().toISOString(),
      correlationId: this.metadata.correlationId
    };
  }

  /**
   * Create a knowledge base integration error
   */
  static knowledgeBase(
    message: string,
    knowledgeBaseId?: string,
    sessionId?: string,
    cause?: Error
  ): IntegrationError {
    return new IntegrationError(
      message,
      'knowledge',
      { knowledgeBaseId },
      sessionId,
      cause
    );
  }

  /**
   * Create an agent core integration error
   */
  static agentCore(
    message: string,
    agentId?: string,
    agentAliasId?: string,
    sessionId?: string,
    cause?: Error
  ): IntegrationError {
    return new IntegrationError(
      message,
      'agent',
      { agentId, agentAliasId },
      sessionId,
      cause
    );
  }

  /**
   * Create an orchestrator integration error
   */
  static orchestrator(
    message: string,
    routingDecision?: string,
    sessionId?: string,
    cause?: Error
  ): IntegrationError {
    return new IntegrationError(
      message,
      'orchestrator',
      { routingDecision },
      sessionId,
      cause
    );
  }

  /**
   * Create an intent classifier integration error
   */
  static classifier(
    message: string,
    inputLength?: number,
    sessionId?: string,
    cause?: Error
  ): IntegrationError {
    return new IntegrationError(
      message,
      'classifier',
      { inputLength },
      sessionId,
      cause
    );
  }
}

/**
 * Type guard to check if error is an IntegrationError
 */
export function isIntegrationError(error: any): error is IntegrationError {
  return error instanceof IntegrationError;
}

/**
 * Utility to extract error details for logging
 */
export function extractErrorDetails(error: any): {
  name: string;
  message: string;
  code?: string;
  sessionId?: string;
  stack?: string;
} {
  return {
    name: error.name || 'UnknownError',
    message: error.message || 'Unknown error',
    code: error.code,
    sessionId: error.sessionId,
    stack: error.stack,
  };
}