/**
 * @fileoverview Type Guards and Runtime Validation Utilities
 * 
 * Provides type guards and validation functions for external data
 * to improve type safety and runtime validation.
 */

import { InferenceConfig, AudioInputConfig, AudioOutputConfig, TextConfig } from './ClientTypes';
import { TwilioMediaMessage, TwilioMessage, TwilioEvent } from './SharedTypes';

/**
 * Type guard for checking if a value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard for checking if a value is a number
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Type guard for checking if a value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Type guard for checking if a value is an object (not null)
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard for checking if a value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Type guard for InferenceConfig
 */
export function isInferenceConfig(value: unknown): value is InferenceConfig {
  if (!isObject(value)) return false;
  
  return (
    isNumber(value.maxTokens) &&
    isNumber(value.topP) &&
    value.topP >= 0 && value.topP <= 1 &&
    isNumber(value.temperature) &&
    value.temperature >= 0 && value.temperature <= 2 &&
    (value.stopSequences === undefined || isArray(value.stopSequences))
  );
}

/**
 * Type guard for AudioInputConfig
 */
export function isAudioInputConfig(value: unknown): value is AudioInputConfig {
  if (!isObject(value)) return false;
  
  return (
    isString(value.format) &&
    isNumber(value.sampleRate) &&
    value.sampleRate > 0 &&
    isNumber(value.channels) &&
    value.channels > 0 &&
    isNumber(value.bitsPerSample) &&
    value.bitsPerSample > 0
  );
}

/**
 * Type guard for AudioOutputConfig
 */
export function isAudioOutputConfig(value: unknown): value is AudioOutputConfig {
  if (!isObject(value)) return false;
  
  return (
    isString(value.format) &&
    isNumber(value.sampleRate) &&
    value.sampleRate > 0
  );
}

/**
 * Type guard for TextConfig
 */
export function isTextConfig(value: unknown): value is TextConfig {
  if (!isObject(value)) return false;
  
  return isString(value.mediaType);
}

/**
 * Type guard for TwilioEvent
 */
export function isTwilioEvent(value: unknown): value is TwilioEvent {
  return isString(value);
}

/**
 * Type guard for TwilioMessage
 */
export function isTwilioMessage(value: unknown): value is TwilioMessage {
  if (!isObject(value)) return false;
  
  return isTwilioEvent(value.event);
}

/**
 * Type guard for TwilioMediaMessage (enhanced version)
 */
export function isTwilioMediaMessage(value: unknown): value is TwilioMediaMessage {
  if (!isObject(value)) return false;
  
  return (
    value.event === 'media' &&
    isObject(value.media) &&
    (value.media.chunk !== undefined || value.media.payload !== undefined)
  );
}

/**
 * Type guard for checking if an error has a specific structure
 */
export function isErrorWithMessage(error: unknown): error is { message: string } {
  return isObject(error) && isString(error.message);
}

/**
 * Type guard for checking if an error has a code property
 */
export function isErrorWithCode(error: unknown): error is { code: string } {
  return isObject(error) && isString(error.code);
}

/**
 * Type guard for checking if an error has a name property
 */
export function isErrorWithName(error: unknown): error is { name: string } {
  return isObject(error) && isString(error.name);
}

/**
 * Type guard for AWS service errors
 */
export function isAWSServiceError(error: unknown): error is {
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
  retryable?: boolean;
} {
  return (
    isObject(error) &&
    isString(error.name) &&
    isString(error.message) &&
    // Must have at least one AWS-specific property
    (isString(error.code) || isNumber(error.statusCode) || isBoolean(error.retryable)) &&
    (error.code === undefined || isString(error.code)) &&
    (error.statusCode === undefined || isNumber(error.statusCode)) &&
    (error.retryable === undefined || isBoolean(error.retryable))
  );
}

/**
 * Type guard for WebSocket message data
 */
export function isWebSocketMessageData(value: unknown): value is string | Buffer | ArrayBuffer {
  return (
    isString(value) ||
    Buffer.isBuffer(value) ||
    value instanceof ArrayBuffer
  );
}

/**
 * Type guard for session ID validation
 */
export function isValidSessionId(value: unknown): value is string {
  return isString(value) && value.length > 0 && /^[a-zA-Z0-9_-]+$/.test(value);
}

/**
 * Type guard for correlation ID validation
 */
export function isValidCorrelationId(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

/**
 * Type guard for checking if a value is a valid timestamp
 */
export function isValidTimestamp(value: unknown): value is number {
  return isNumber(value) && value > 0 && value <= Date.now() + 86400000; // Allow up to 24 hours in future
}

/**
 * Type guard for checking if a value is a valid log level
 */
export function isValidLogLevel(value: unknown): value is 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE' {
  return isString(value) && ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'].includes(value);
}

/**
 * Validation result type
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates an object against a schema using type guards
 */
export function validateObject<T>(
  value: unknown,
  typeGuard: (value: unknown) => value is T,
  fieldName: string = 'object'
): ValidationResult {
  if (typeGuard(value)) {
    return { isValid: true, errors: [] };
  }
  
  return {
    isValid: false,
    errors: [`${fieldName} is not valid`]
  };
}

/**
 * Validates required fields in an object
 */
export function validateRequiredFields(
  obj: Record<string, unknown>,
  requiredFields: string[]
): ValidationResult {
  const errors: string[] = [];
  
  for (const field of requiredFields) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      errors.push(`Required field '${field}' is missing or null`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates that a value is within a numeric range
 */
export function validateNumericRange(
  value: unknown,
  min: number,
  max: number,
  fieldName: string
): ValidationResult {
  if (!isNumber(value)) {
    return {
      isValid: false,
      errors: [`${fieldName} must be a number`]
    };
  }
  
  if (value < min || value > max) {
    return {
      isValid: false,
      errors: [`${fieldName} must be between ${min} and ${max}`]
    };
  }
  
  return { isValid: true, errors: [] };
}

/**
 * Validates that a string matches a pattern
 */
export function validateStringPattern(
  value: unknown,
  pattern: RegExp,
  fieldName: string
): ValidationResult {
  if (!isString(value)) {
    return {
      isValid: false,
      errors: [`${fieldName} must be a string`]
    };
  }
  
  if (!pattern.test(value)) {
    return {
      isValid: false,
      errors: [`${fieldName} does not match required pattern`]
    };
  }
  
  return { isValid: true, errors: [] };
}