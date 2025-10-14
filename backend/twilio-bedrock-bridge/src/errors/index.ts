/**
 * @fileoverview Error Classes Export Module
 * 
 * Centralized exports for all error classes used in the Twilio Bedrock Bridge
 */

export {
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
  IntegrationError,
  createBedrockServiceError,
  isBedrockClientError,
  isIntegrationError,
  extractErrorDetails
} from './ClientErrors';