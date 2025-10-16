import { AudioType, AudioMediaType, TextMediaType } from "../types/SharedTypes";

export const DefaultInferenceConfiguration = {
  maxTokens: 1024,
  topP: 0.9,
  temperature: 0.7,
};

export const DefaultAudioInputConfiguration = {
  audioType: "SPEECH" as AudioType,
  encoding: "base64",
  mediaType: "audio/lpcm" as AudioMediaType,
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
};

export const DefaultToolSchema = {
  "type": "object",
  "properties": {},
  "required": []
};

export const WeatherToolSchema = {
  "type": "object",
  "properties": {
    "latitude": {
      "type": "string",
      "description": "Geographical WGS84 latitude of the location."
    },
    "longitude": {
      "type": "string",
      "description": "Geographical WGS84 longitude of the location."
    }
  },
  "required": ["latitude", "longitude"]
};

export const DefaultTextConfiguration = { mediaType: "text/plain" as TextMediaType };

export const DefaultSystemPrompt = "You are a friend. The user and you will engage in a spoken " +
  "dialog exchanging the transcripts of a natural real-time conversation. Keep your responses short, " +
  "generally two or three sentences for chatty scenarios.";

export const RealtimeSystemPrompt = "You are a conversational AI assistant engaging in real-time spoken dialog. " +
  "You can interrupt and be interrupted naturally, just like human conversation. Respond immediately when you " +
  "have something relevant to say - don't wait for the user to finish completely. Keep responses very brief " +
  "and conversational. Use natural speech patterns with occasional 'mm-hmm', 'right', or 'I see' to show " +
  "you're actively listening. If interrupted, stop speaking immediately and listen.";

export const DefaultAudioOutputConfiguration = {
  ...DefaultAudioInputConfiguration,
  sampleRateHertz: 16000,  // Match bedrock-harness output configuration
  voiceId: "tiffany",
};

// Audio sample rates (Hz)
export const AudioSampleRates = {
  TWILIO_MULAW: 8000,           // Twilio μ-law sample rate
  BEDROCK_PCM: 16000,           // Bedrock PCM sample rate
  BEDROCK_DEFAULT: 24000,       // Default Bedrock sample rate
  MAX_SUPPORTED: 48000,         // Maximum supported sample rate
} as const;

// Memory management thresholds (percentages as decimals)
export const MemoryThresholds = {
  PRESSURE_THRESHOLD: 0.8,      // 80% - trigger memory pressure handling
  TRIM_TARGET: 0.5,             // 50% - target size when trimming buffers
  WARNING_THRESHOLD: 0.7,       // 70% - log warning for high utilization
  OUTPUT_WARNING: 0.8,          // 80% - warn for output buffer utilization
} as const;

// Audio processing constants
export const AudioProcessing = {
  BYTES_PER_SAMPLE_16BIT: 2,    // 16-bit samples = 2 bytes
  MIN_CHUNK_DURATION_MS: 10,    // Minimum chunk duration for processing
  SILENCE_PADDING_VALUE: 0,     // Value for silent padding
} as const;

// Ultra-low latency timing configuration
export const UltraLowLatencyConfig = {
  // Master timer interval - single 20ms timer for all operations
  MASTER_TIMER_MS: 20,           // Single timer matching Twilio's expectation
  
  // Input processing - immediate send, no buffering
  INPUT_IMMEDIATE_SEND: true,    // Send to Bedrock immediately on receive
  INPUT_MAX_BUFFER_MS: 0,        // No input buffering for ultra-low latency
  
  // Output processing - synchronized with master timer
  OUTPUT_FRAME_SIZE: 160,        // 20ms at 8kHz μ-law (160 bytes)
  OUTPUT_MAX_BUFFER_MS: 100,     // Keep total buffering under 100ms
  OUTPUT_SYNC_TO_TIMER: true,    // Synchronize output to master timer
  
  // Processing optimization
  CHUNK_SIZE_MS: 20,             // Process in 20ms chunks
  BATCH_SIZE: 1,                 // Process immediately, no batching
  PROCESSING_TIMEOUT_MS: 5000,   // Reduced timeout for faster failure detection
} as const;

// Buffer size configurations for different scenarios
export const BufferSizeConfig = {
  // Input audio buffering (user speech) - ELIMINATED for ultra-low latency
  INPUT_REALTIME_MAX: 1,         // Minimal buffer - send immediately
  INPUT_REALTIME_TRIM_TO: 1,     // No trimming needed
  INPUT_STANDARD_MAX: 1,         // No buffering in any mode
  
  // Output audio buffering (model speech) - Reduced for low latency
  OUTPUT_BUFFER_MAX: 5,          // Reduced from 1000 to 5 frames (100ms max)
  OUTPUT_BUFFER_WARNING: 3,      // Warn at 3 frames (60ms)
  
  // Processing batch sizes - Optimized for immediate processing
  PROCESSING_BATCH_SIZE: 1,      // Process immediately, no batching
  PROCESSING_TIMEOUT_MS: 5000,   // Reduced timeout (was 30 seconds)
};