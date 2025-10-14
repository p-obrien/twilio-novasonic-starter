/**
 * Re-export all types for easier imports
 */

// Existing types
export * from './SharedTypes';

// Client types (avoiding conflicts)
export type {
  NovaSonicClientConfig,
  AudioInputConfig,
  AudioOutputConfig,
  TextConfig,
  SessionState,
  EventHandler,
  EventData,
  AudioStreamOptions,
  SessionOptions,
  StreamEventType,
  ErrorEventData,
  UsageEventData,
  TextOutputEventData,
  AudioOutputEventData,
  SessionCleanupCallback,
  ClientHooks,
  AudioBufferConfig,
  RealtimeConversationState,
  AudioQueueStats
} from './ClientTypes';

// Integration types
export * from './IntegrationTypes';