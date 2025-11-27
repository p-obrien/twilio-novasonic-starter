/**
 * Comprehensive type definitions for Twilio Media Streams WebSocket messages.
 *
 * Reference: https://www.twilio.com/docs/voice/media-streams/websocket-messages
 *
 * These types provide complete type safety for all Twilio message types processed
 * by the WebSocket handler. Each message type has a dedicated interface with all
 * expected fields properly typed.
 */

/**
 * Base interface for all Twilio WebSocket messages.
 * All Twilio messages include an event type and optional sequence number.
 */
export interface TwilioBaseMessage {
  /** The type of Twilio event */
  event: string;
  /** Optional sequence number for message ordering */
  sequenceNumber?: string;
  /** Optional stream SID (present in some message types) */
  streamSid?: string;
}

/**
 * Twilio 'connected' event - sent when WebSocket connection is established.
 * This is the first message received after successful connection.
 */
export interface TwilioConnectedMessage extends TwilioBaseMessage {
  event: 'connected';
  /** Protocol version */
  protocol?: string;
  /** Connection version */
  version?: string;
}

/**
 * Media format configuration from Twilio start message.
 */
export interface TwilioMediaFormat {
  /** Audio encoding format (e.g., 'audio/x-mulaw') */
  encoding: string;
  /** Sample rate in Hz (typically 8000 for Twilio) */
  sampleRate: number;
  /** Number of audio channels (typically 1 for mono) */
  channels: number;
}

/**
 * Start event payload containing call and stream metadata.
 */
export interface TwilioStartPayload {
  /** Unique identifier for this media stream */
  streamSid: string;
  /** Twilio account SID */
  accountSid: string;
  /** Unique identifier for this call */
  callSid: string;
  /** Audio tracks included in stream (e.g., ['inbound', 'outbound']) */
  tracks: string[];
  /** Media format configuration */
  mediaFormat: TwilioMediaFormat;
  /** Custom parameters passed from TwiML */
  customParameters?: Record<string, string>;
  /** Sample rate in Hz (alternative field name) */
  sample_rate_hz?: number;
}

/**
 * Twilio 'start' event - sent at the beginning of a media stream.
 * Contains all metadata about the call and stream configuration.
 */
export interface TwilioStartMessage extends TwilioBaseMessage {
  event: 'start';
  /** Stream ID */
  streamSid: string;
  /** Start event payload */
  start: TwilioStartPayload;
  /** Sequence number */
  sequenceNumber: string;
}

/**
 * Media event payload containing audio data.
 */
export interface TwilioMediaPayload {
  /** Track name ('inbound' or 'outbound') */
  track: string;
  /** Alternative field name for payload */
  chunk?: string;
  /** Timestamp of the audio chunk */
  timestamp: string;
  /** Base64-encoded audio payload (μ-law format) */
  payload: string;
}

/**
 * Twilio 'media' event - contains audio data frames.
 * Sent continuously during active call at ~50 frames/second (20ms frames).
 */
export interface TwilioMediaMessage extends TwilioBaseMessage {
  event: 'media';
  /** Stream ID */
  streamSid: string;
  /** Sequence number */
  sequenceNumber: string;
  /** Media payload containing audio data */
  media: TwilioMediaPayload;
  /** Top-level payload alias (some implementations) */
  payload?: string;
}

/**
 * Stop event payload.
 */
export interface TwilioStopPayload {
  /** Twilio account SID */
  accountSid: string;
  /** Call SID that is ending */
  callSid: string;
}

/**
 * Twilio 'stop' event - sent when media stream ends.
 * Indicates the call has ended or stream has been terminated.
 */
export interface TwilioStopMessage extends TwilioBaseMessage {
  event: 'stop';
  /** Stream ID */
  streamSid: string;
  /** Sequence number */
  sequenceNumber: string;
  /** Stop event payload */
  stop: TwilioStopPayload;
}

/**
 * Mark event payload.
 */
export interface TwilioMarkPayload {
  /** Name of the mark */
  name: string;
}

/**
 * Twilio 'mark' event - custom markers sent from TwiML.
 * Used for synchronization and tracking specific points in the call.
 */
export interface TwilioMarkMessage extends TwilioBaseMessage {
  event: 'mark';
  /** Stream ID */
  streamSid?: string;
  /** Sequence number */
  sequenceNumber: string;
  /** Mark payload */
  mark: TwilioMarkPayload;
}

/**
 * DTMF event payload.
 */
export interface TwilioDtmfPayload {
  /** DTMF digit pressed (0-9, *, #, A-D) */
  digit: string;
}

/**
 * Twilio 'dtmf' event - sent when caller presses phone keypad.
 * Contains the DTMF tone that was detected.
 */
export interface TwilioDtmfMessage extends TwilioBaseMessage {
  event: 'dtmf';
  /** Stream ID */
  streamSid?: string;
  /** Sequence number */
  sequenceNumber: string;
  /** DTMF payload */
  dtmf: TwilioDtmfPayload;
}

/**
 * Union type of all possible Twilio message types.
 * Use this for type-safe message handling with discriminated unions.
 */
export type TwilioMessage =
  | TwilioConnectedMessage
  | TwilioStartMessage
  | TwilioMediaMessage
  | TwilioStopMessage
  | TwilioMarkMessage
  | TwilioDtmfMessage;

/**
 * Type guard to check if a message is a valid Twilio message.
 * @param msg - Unknown message object
 * @returns True if message has required Twilio message structure
 */
export function isTwilioMessage(msg: unknown): msg is TwilioMessage {
  if (!msg || typeof msg !== 'object') {
    return false;
  }

  const message = msg as Record<string, unknown>;
  return typeof message.event === 'string';
}

/**
 * Type guard for TwilioStartMessage.
 */
export function isTwilioStartMessage(msg: TwilioMessage): msg is TwilioStartMessage {
  return msg.event === 'start';
}

/**
 * Type guard for TwilioMediaMessage.
 */
export function isTwilioMediaMessage(msg: TwilioMessage): msg is TwilioMediaMessage {
  return msg.event === 'media';
}

/**
 * Type guard for TwilioStopMessage.
 */
export function isTwilioStopMessage(msg: TwilioMessage): msg is TwilioStopMessage {
  return msg.event === 'stop';
}

/**
 * Type guard for TwilioConnectedMessage.
 */
export function isTwilioConnectedMessage(msg: TwilioMessage): msg is TwilioConnectedMessage {
  return msg.event === 'connected';
}

/**
 * Type guard for TwilioMarkMessage.
 */
export function isTwilioMarkMessage(msg: TwilioMessage): msg is TwilioMarkMessage {
  return msg.event === 'mark';
}

/**
 * Type guard for TwilioDtmfMessage.
 */
export function isTwilioDtmfMessage(msg: TwilioMessage): msg is TwilioDtmfMessage {
  return msg.event === 'dtmf';
}
