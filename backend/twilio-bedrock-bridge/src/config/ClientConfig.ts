/**
 * @fileoverview Client Configuration Constants
 * 
 * Centralized configuration for the Bedrock streaming client
 */

export const CLIENT_DEFAULTS = {
  // HTTP/2 Handler Configuration
  REQUEST_TIMEOUT: 300000, // 5 minutes
  SESSION_TIMEOUT: 300000, // 5 minutes
  DISABLE_CONCURRENT_STREAMS: false,
  MAX_CONCURRENT_STREAMS: 20,

  // AWS Configuration
  DEFAULT_REGION: "us-east-1",
  MODEL_ID: "amazon.nova-2-sonic-v1:0",

  // Session Configuration
  MAX_AUDIO_QUEUE_SIZE: 200,
  MAX_CHUNKS_PER_BATCH: 5,
  
  // Timeout Configuration
  DEFAULT_ACK_TIMEOUT: 5000, // 5 seconds
  
  // Logging Configuration
  MAX_LOG_CONTENT_LENGTH: 200,
} as const;

export const INFERENCE_DEFAULTS = {
  maxTokens: 1024,
  topP: 0.9,
  temperature: 0.7,
} as const;

export const MEDIA_TYPES = {
  TEXT_PLAIN: "text/plain",
  AUDIO_PCM: "audio/pcm",
} as const;

export const EVENT_TYPES = {
  // Session Events
  SESSION_START: 'sessionStart',
  SESSION_END: 'sessionEnd',
  
  // Prompt Events
  PROMPT_START: 'promptStart',
  PROMPT_END: 'promptEnd',
  
  // Content Events
  CONTENT_START: 'contentStart',
  CONTENT_END: 'contentEnd',
  
  // Output Events
  TEXT_OUTPUT: 'textOutput',
  AUDIO_OUTPUT: 'audioOutput',
  
  // Completion Events
  COMPLETION_START: 'completionStart',
  COMPLETION_END: 'completionEnd',
  
  // System Events
  USAGE_EVENT: 'usageEvent',
  ERROR: 'error',
  STREAM_COMPLETE: 'streamComplete',
  
  // Special Events
  ANY: 'any',
} as const;

export const CONTENT_TYPES = {
  AUDIO: 'AUDIO',
  TEXT: 'TEXT',
  TOOL: 'TOOL',
} as const;