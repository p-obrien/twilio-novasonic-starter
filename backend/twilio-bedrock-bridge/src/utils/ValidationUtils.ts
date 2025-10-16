/**
 * @fileoverview Comprehensive Input Validation Utilities
 * 
 * Provides runtime validation for external inputs, configuration,
 * and API data with detailed error messages.
 */

import { 
  ValidationResult, 
  isString, 
  isNumber, 
  isBoolean, 
  isObject, 
  isArray,
  isInferenceConfig,
  isAudioInputConfig,
  isAudioOutputConfig,
  isTextConfig,
  isTwilioMessage,
  isTwilioMediaMessage,
  isValidSessionId,
  isValidCorrelationId,
  isValidTimestamp,
  isValidLogLevel,
  validateRequiredFields,
  validateNumericRange,
  validateStringPattern
} from '../types/TypeGuards';
import { ValidationError } from '../errors/ClientErrors';
import { InferenceConfig, AudioInputConfig, AudioOutputConfig, SessionOptions } from '../types/ClientTypes';

/**
 * Schema definition for validation
 */
export interface ValidationSchema {
  [key: string]: ValidationRule;
}

/**
 * Validation rule definition
 */
export interface ValidationRule {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'custom';
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: readonly string[];
  customValidator?: (value: unknown) => ValidationResult;
  schema?: ValidationSchema; // For nested objects
  itemSchema?: ValidationRule; // For array items
}

/**
 * Validation context for error reporting
 */
export interface ValidationContext {
  path: string;
  operation: string;
  correlationId?: string;
}

/**
 * Detailed validation result
 */
export interface DetailedValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/**
 * Validate an object against a schema
 */
export function validateSchema(
  data: unknown,
  schema: ValidationSchema,
  context: ValidationContext
): DetailedValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (!isObject(data)) {
    errors.push(ValidationError.create(
      `Expected object at ${context.path}`,
      [`Value is not an object: ${typeof data}`],
      context.operation,
      context.correlationId,
      { path: context.path, actualType: typeof data }
    ));
    return { isValid: false, errors, warnings };
  }

  // Validate each field in the schema
  for (const [fieldName, rule] of Object.entries(schema)) {
    const fieldPath = context.path ? `${context.path}.${fieldName}` : fieldName;
    const fieldValue = data[fieldName];
    
    const fieldResult = validateField(fieldValue, rule, {
      ...context,
      path: fieldPath
    });

    if (!fieldResult.isValid) {
      errors.push(...fieldResult.errors);
    }
    warnings.push(...fieldResult.warnings);
  }

  // Check for unexpected fields
  const schemaKeys = new Set(Object.keys(schema));
  const dataKeys = Object.keys(data);
  const unexpectedKeys = dataKeys.filter(key => !schemaKeys.has(key));
  
  if (unexpectedKeys.length > 0) {
    warnings.push(`Unexpected fields at ${context.path}: ${unexpectedKeys.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate a single field against a rule
 */
function validateField(
  value: unknown,
  rule: ValidationRule,
  context: ValidationContext
): DetailedValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Check if field is required
  if (rule.required && (value === undefined || value === null)) {
    errors.push(ValidationError.create(
      `Required field missing: ${context.path}`,
      [`Field '${context.path}' is required but was ${value}`],
      context.operation,
      context.correlationId,
      { path: context.path, rule }
    ));
    return { isValid: false, errors, warnings };
  }

  // Skip validation if field is not required and not present
  if (!rule.required && (value === undefined || value === null)) {
    return { isValid: true, errors, warnings };
  }

  // Validate based on type
  switch (rule.type) {
    case 'string':
      return validateStringField(value, rule, context);
    
    case 'number':
      return validateNumberField(value, rule, context);
    
    case 'boolean':
      return validateBooleanField(value, rule, context);
    
    case 'object':
      return validateObjectField(value, rule, context);
    
    case 'array':
      return validateArrayField(value, rule, context);
    
    case 'custom':
      return validateCustomField(value, rule, context);
    
    default:
      errors.push(ValidationError.create(
        `Unknown validation rule type: ${rule.type}`,
        [`Unsupported rule type '${rule.type}' for field '${context.path}'`],
        context.operation,
        context.correlationId,
        { path: context.path, rule }
      ));
      return { isValid: false, errors, warnings };
  }
}

/**
 * Validate string field
 */
function validateStringField(
  value: unknown,
  rule: ValidationRule,
  context: ValidationContext
): DetailedValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (!isString(value)) {
    errors.push(ValidationError.create(
      `Type mismatch at ${context.path}`,
      [`Expected string but got ${typeof value}`],
      context.operation,
      context.correlationId,
      { path: context.path, expectedType: 'string', actualType: typeof value }
    ));
    return { isValid: false, errors, warnings };
  }

  // Check length constraints
  if (rule.min !== undefined && value.length < rule.min) {
    errors.push(ValidationError.create(
      `String too short at ${context.path}`,
      [`String length ${value.length} is less than minimum ${rule.min}`],
      context.operation,
      context.correlationId,
      { path: context.path, actualLength: value.length, minLength: rule.min }
    ));
  }

  if (rule.max !== undefined && value.length > rule.max) {
    errors.push(ValidationError.create(
      `String too long at ${context.path}`,
      [`String length ${value.length} exceeds maximum ${rule.max}`],
      context.operation,
      context.correlationId,
      { path: context.path, actualLength: value.length, maxLength: rule.max }
    ));
  }

  // Check pattern
  if (rule.pattern && !rule.pattern.test(value)) {
    errors.push(ValidationError.create(
      `Pattern mismatch at ${context.path}`,
      [`String '${value}' does not match required pattern`],
      context.operation,
      context.correlationId,
      { path: context.path, value, pattern: rule.pattern.source }
    ));
  }

  // Check enum values
  if (rule.enum && !rule.enum.includes(value)) {
    errors.push(ValidationError.create(
      `Invalid enum value at ${context.path}`,
      [`Value '${value}' is not one of allowed values: ${rule.enum.join(', ')}`],
      context.operation,
      context.correlationId,
      { path: context.path, value, allowedValues: rule.enum }
    ));
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate number field
 */
function validateNumberField(
  value: unknown,
  rule: ValidationRule,
  context: ValidationContext
): DetailedValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (!isNumber(value)) {
    errors.push(ValidationError.create(
      `Type mismatch at ${context.path}`,
      [`Expected number but got ${typeof value}`],
      context.operation,
      context.correlationId,
      { path: context.path, expectedType: 'number', actualType: typeof value }
    ));
    return { isValid: false, errors, warnings };
  }

  // Check range constraints
  if (rule.min !== undefined && value < rule.min) {
    errors.push(ValidationError.create(
      `Number too small at ${context.path}`,
      [`Value ${value} is less than minimum ${rule.min}`],
      context.operation,
      context.correlationId,
      { path: context.path, value, min: rule.min }
    ));
  }

  if (rule.max !== undefined && value > rule.max) {
    errors.push(ValidationError.create(
      `Number too large at ${context.path}`,
      [`Value ${value} exceeds maximum ${rule.max}`],
      context.operation,
      context.correlationId,
      { path: context.path, value, max: rule.max }
    ));
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate boolean field
 */
function validateBooleanField(
  value: unknown,
  rule: ValidationRule,
  context: ValidationContext
): DetailedValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (!isBoolean(value)) {
    errors.push(ValidationError.create(
      `Type mismatch at ${context.path}`,
      [`Expected boolean but got ${typeof value}`],
      context.operation,
      context.correlationId,
      { path: context.path, expectedType: 'boolean', actualType: typeof value }
    ));
    return { isValid: false, errors, warnings };
  }

  return { isValid: true, errors, warnings };
}

/**
 * Validate object field
 */
function validateObjectField(
  value: unknown,
  rule: ValidationRule,
  context: ValidationContext
): DetailedValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (!isObject(value)) {
    errors.push(ValidationError.create(
      `Type mismatch at ${context.path}`,
      [`Expected object but got ${typeof value}`],
      context.operation,
      context.correlationId,
      { path: context.path, expectedType: 'object', actualType: typeof value }
    ));
    return { isValid: false, errors, warnings };
  }

  // Validate nested schema if provided
  if (rule.schema) {
    const nestedResult = validateSchema(value, rule.schema, context);
    errors.push(...nestedResult.errors);
    warnings.push(...nestedResult.warnings);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate array field
 */
function validateArrayField(
  value: unknown,
  rule: ValidationRule,
  context: ValidationContext
): DetailedValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (!isArray(value)) {
    errors.push(ValidationError.create(
      `Type mismatch at ${context.path}`,
      [`Expected array but got ${typeof value}`],
      context.operation,
      context.correlationId,
      { path: context.path, expectedType: 'array', actualType: typeof value }
    ));
    return { isValid: false, errors, warnings };
  }

  // Check length constraints
  if (rule.min !== undefined && value.length < rule.min) {
    errors.push(ValidationError.create(
      `Array too short at ${context.path}`,
      [`Array length ${value.length} is less than minimum ${rule.min}`],
      context.operation,
      context.correlationId,
      { path: context.path, actualLength: value.length, minLength: rule.min }
    ));
  }

  if (rule.max !== undefined && value.length > rule.max) {
    errors.push(ValidationError.create(
      `Array too long at ${context.path}`,
      [`Array length ${value.length} exceeds maximum ${rule.max}`],
      context.operation,
      context.correlationId,
      { path: context.path, actualLength: value.length, maxLength: rule.max }
    ));
  }

  // Validate array items if schema provided
  if (rule.itemSchema) {
    value.forEach((item, index) => {
      const itemResult = validateField(item, rule.itemSchema!, {
        ...context,
        path: `${context.path}[${index}]`
      });
      errors.push(...itemResult.errors);
      warnings.push(...itemResult.warnings);
    });
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate custom field
 */
function validateCustomField(
  value: unknown,
  rule: ValidationRule,
  context: ValidationContext
): DetailedValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (!rule.customValidator) {
    errors.push(ValidationError.create(
      `Missing custom validator at ${context.path}`,
      [`Custom validation rule specified but no validator function provided`],
      context.operation,
      context.correlationId,
      { path: context.path, rule }
    ));
    return { isValid: false, errors, warnings };
  }

  const result = rule.customValidator(value);
  if (!result.isValid) {
    errors.push(ValidationError.create(
      `Custom validation failed at ${context.path}`,
      result.errors,
      context.operation,
      context.correlationId,
      { path: context.path, value }
    ));
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Pre-defined validation schemas for common types
 */
const InferenceConfigSchema = {
  maxTokens: { type: 'number' as const, required: true, min: 1, max: 100000 },
  topP: { type: 'number' as const, required: true, min: 0, max: 1 },
  temperature: { type: 'number' as const, required: true, min: 0, max: 2 },
  stopSequences: { 
    type: 'array' as const, 
    required: false,
    itemSchema: { type: 'string' as const, min: 1, max: 100 }
  }
};

const AudioInputConfigSchema = {
  format: { type: 'string' as const, required: true, enum: ['pcm', 'mulaw'] as const },
  sampleRate: { type: 'number' as const, required: true, min: 8000, max: 48000 },
  channels: { type: 'number' as const, required: true, min: 1, max: 2 },
  bitsPerSample: { type: 'number' as const, required: true, enum: [8, 16, 24, 32] as any }
};

const SessionOptionsSchema = {
  sessionId: { 
    type: 'string' as const, 
    required: false, 
    pattern: /^[a-zA-Z0-9_-]+$/,
    min: 1,
    max: 100
  },
  inferenceConfig: { 
    type: 'object' as const, 
    required: false,
    schema: InferenceConfigSchema
  },
  enableRealtimeFeatures: { type: 'boolean' as const, required: false }
};

const TwilioWebhookPayloadSchema = {
  CallSid: { type: 'string' as const, required: true, min: 1 },
  From: { type: 'string' as const, required: true, min: 1 },
  To: { type: 'string' as const, required: true, min: 1 },
  CallStatus: { 
    type: 'string' as const, 
    required: true,
    enum: ['queued', 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer', 'canceled'] as const
  }
};

export const ValidationSchemas = {
  InferenceConfig: InferenceConfigSchema,
  AudioInputConfig: AudioInputConfigSchema,
  SessionOptions: SessionOptionsSchema,
  TwilioWebhookPayload: TwilioWebhookPayloadSchema
};

/**
 * Validate inference configuration
 */
export function validateInferenceConfig(
  config: unknown,
  operation: string,
  correlationId?: string
): InferenceConfig {
  const result = validateSchema(config, ValidationSchemas.InferenceConfig, {
    path: 'inferenceConfig',
    operation,
    correlationId
  });

  if (!result.isValid) {
    throw result.errors[0]; // Throw the first validation error
  }

  return config as InferenceConfig;
}

/**
 * Validate audio input configuration
 */
export function validateAudioInputConfig(
  config: unknown,
  operation: string,
  correlationId?: string
): AudioInputConfig {
  const result = validateSchema(config, ValidationSchemas.AudioInputConfig, {
    path: 'audioInputConfig',
    operation,
    correlationId
  });

  if (!result.isValid) {
    throw result.errors[0];
  }

  return config as AudioInputConfig;
}

/**
 * Validate session options
 */
export function validateSessionOptions(
  options: unknown,
  operation: string,
  correlationId?: string
): SessionOptions {
  const result = validateSchema(options, ValidationSchemas.SessionOptions, {
    path: 'sessionOptions',
    operation,
    correlationId
  });

  if (!result.isValid) {
    throw result.errors[0];
  }

  return options as SessionOptions;
}

/**
 * Validate Twilio webhook payload
 */
export function validateTwilioWebhookPayload(
  payload: unknown,
  operation: string,
  correlationId?: string
): Record<string, string> {
  const result = validateSchema(payload, ValidationSchemas.TwilioWebhookPayload, {
    path: 'webhookPayload',
    operation,
    correlationId
  });

  if (!result.isValid) {
    throw result.errors[0];
  }

  return payload as Record<string, string>;
}

/**
 * Sanitize input by removing potentially dangerous content
 */
export function sanitizeInput(input: unknown, visited = new WeakSet()): unknown {
  if (typeof input === 'string') {
    // Remove potential script tags and other dangerous content
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  }

  if (isObject(input)) {
    // Handle circular references
    if (visited.has(input)) {
      return '[Circular Reference]';
    }
    visited.add(input);

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value, visited);
    }
    return sanitized;
  }

  if (isArray(input)) {
    // Handle circular references
    if (visited.has(input)) {
      return '[Circular Reference]';
    }
    visited.add(input);

    return input.map(item => sanitizeInput(item, visited));
  }

  return input;
}