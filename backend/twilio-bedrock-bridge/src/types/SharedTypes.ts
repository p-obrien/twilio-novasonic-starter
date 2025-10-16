/**
 * Shared configuration types for model inference and media handling.
 *
 * Improvements:
 * - Grouped related types and added JSDoc for maintainability.
 * - Added small runtime helpers (type guards + normalizers) to centralize parsing logic
 *   for Twilio message variants and reduce duplication across the codebase.
 */

import { WebSocket } from 'ws';
import { CorrelationContext } from '../utils/correlationId';

/**
 * InferenceConfig contains model generation settings.
 * Keep these required so callers must explicitly provide values; they are read-only to
 * encourage immutability at the call site.
 */
export interface InferenceConfig {
  readonly maxTokens: number;
  readonly topP: number;
  readonly temperature: number;
  readonly enableMetrics?: boolean;
}

/* Content / media type aliases */
export type ContentType = 'AUDIO' | 'TEXT' | 'TOOL';
export type AudioType = 'SPEECH';
export type AudioMediaType = 'audio/lpcm' | 'audio/pcm' | 'audio/mulaw';
export type TextMediaType = 'text/plain' | 'application/json';

/* Configuration objects for different content channels */
export interface AudioConfiguration {
  readonly audioType: AudioType;
  readonly mediaType: AudioMediaType;
  readonly sampleRateHertz: number;
  readonly sampleSizeBits: number;
  readonly channelCount: number;
  readonly encoding: string; // e.g. "mulaw", "pcm_s16le"
  readonly voiceId?: string;
}

export interface TextConfiguration {
  readonly mediaType: TextMediaType;
}

export interface ToolConfiguration {
  readonly toolUseId: string;
  readonly type: 'TEXT';
  readonly textInputConfiguration: {
    readonly mediaType: 'text/plain';
  };
}

/* ============================
   Twilio WebSocket message types
   Reference: https://www.twilio.com/docs/voice/media-streams/websocket-messages#media-message
   ============================ */

/**
 * Allowed Twilio event names as a union for safer checks.
 * Including a catch-all `string` in runtime-parsing contexts is possible, but using
 * the specific union here improves type-safety where we expect known events.
 */
export type TwilioEvent = 'start' | 'media' | 'stop' | 'mark' | 'dtmf' | 'connected' | string;

/**
 * Canonical shape for Twilio's `media` payload object. Twilio examples vary between
 * `chunk` and `payload` names, and can include per-frame sample rate metadata.
 */
export interface TwilioRawMedia {
  // Twilio track names vary; restrict common values but allow strings to remain permissive.
  track?: 'inbound' | 'outbound' | 'inbound_audio' | 'outbound_audio' | string;

  // Base64 payload used by Twilio examples. Field name varies between `chunk` and `payload`.
  chunk?: string; // commonly base64-encoded μ-law (mulaw)
  payload?: string; // alternative name used in some examples

  // Optional timestamp and sample rate metadata
  timestamp?: string;
  sample_rate_hz?: number;
  sampleRateHz?: number;
}

/**
 * `media` event message from Twilio. The Twilio service uses several field-name variants
 * for sequence and payload fields; these are all accepted so normalization can happen
 * in a single place (helpers below).
 */
export interface TwilioMediaMessage {
  event: 'media';

  // Sequence number may be numeric or string and can be provided under several names.
  sequenceNumber?: string | number;
  seq?: string | number;
  sequence_number?: string | number;

  // Top-level payload alias sometimes used by other clients
  payload?: string;

  // The actual media frame content
  media: TwilioRawMedia;

  // streamSid may be present on media and start/stop events
  streamSid?: string;
}

/**
 * Generic Twilio message shape for other events (start/stop/etc).
 * Use specific interfaces for known events where helpful.
 */
export interface TwilioMessage {
  event: TwilioEvent;
  [key: string]: any;
}

/* ============================
   Small runtime helpers
   - Centralizes parsing logic to avoid duplicated parsing in server code
   - Lightweight and allocation-free where possible
   ============================ */

/**
 * Type guard for Twilio media messages.
 * Use this to narrow types before accessing `media` fields in server logic.
 */
export function isTwilioMediaMessage(msg: any): msg is TwilioMediaMessage {
  return !!msg && msg.event === 'media' && typeof msg.media === 'object' && msg.media !== null;
}

/**
 * Extract the base64-encoded payload from a TwilioMediaMessage.
 * Returns payload string or undefined if not present.
 *
 * Priority:
 * 1) media.chunk
 * 2) media.payload
 * 3) top-level payload
 */
export function extractTwilioBase64Payload(msg: TwilioMediaMessage | any): string | undefined {
  if (!msg || typeof msg !== 'object') return undefined;
  const media = (msg as TwilioMediaMessage).media as TwilioRawMedia | undefined;
  return media?.chunk ?? media?.payload ?? (msg.payload as string | undefined);
}

/**
 * Normalize sequence number to a string (if present).
 * Handles the common variants: `sequenceNumber`, `seq`, `sequence_number`.
 */
export function normalizeTwilioSequenceNumber(msg: any): string | undefined {
  if (!msg || typeof msg !== 'object') return undefined;
  const raw = msg.sequenceNumber ?? msg.seq ?? msg.sequence_number;
  if (raw === undefined || raw === null) return undefined;
  return typeof raw === 'number' ? String(raw) : String(raw);
}

/* ============================
   WebSocket Extensions
   ============================ */

/**
 * Extended WebSocket interface with Twilio-specific properties
 * This extends the standard WebSocket with properties needed for our application
 */
export interface ExtendedWebSocket extends WebSocket {
  /** Unique identifier for this WebSocket connection */
  id?: string;
  /** Correlation context for request tracking */
  correlationContext?: CorrelationContext;
  /** Twilio incoming sequence number */
  _twilioInSeq?: number;
  /** Twilio outgoing sequence number */
  _twilioOutSeq?: number;
  /** Twilio stream SID */
  twilioStreamSid?: string;
  /** Twilio sample rate */
  twilioSampleRate?: number;
  /** Twilio call SID */
  callSid?: string;
  /** Timestamp of last audio output for rate limiting */
  _lastAudioTimestamp?: number;
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Error context interface for consistent error handling
 */
export interface ErrorContext {
  /** Session identifier */
  sessionId?: string;
  /** Call SID */
  callSid?: string;
  /** Correlation ID */
  correlationId?: string;
  /** Error severity level */
  severity?: ErrorSeverity;
  /** Additional context metadata */
  metadata?: Record<string, any>;
}

/**
 * Conversation context for managing conversation state
 */
export interface ConversationContext {
  /** Unique conversation identifier */
  conversationId: string;
  /** Current session ID */
  sessionId?: string;
  /** Call SID from Twilio */
  callSid?: string;
  /** Stream SID from Twilio */
  streamSid?: string;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Conversation history */
  messages: ConversationMessage[];
  /** Current conversation state */
  state: 'active' | 'paused' | 'ended';
  /** Conversation start time */
  startTime: number;
  /** Last activity timestamp */
  lastActivity: number;
  /** Metadata for the conversation */
  metadata?: Record<string, any>;
}

/**
 * Individual conversation message
 */
export interface ConversationMessage {
  /** Unique message identifier */
  id: string;
  /** Message role */
  role: 'user' | 'assistant' | 'system';
  /** Message content */
  content: string;
  /** Message timestamp */
  timestamp: number;
  /** Message type */
  type: 'text' | 'audio';
  /** Additional metadata */
  metadata?: Record<string, any>;
}