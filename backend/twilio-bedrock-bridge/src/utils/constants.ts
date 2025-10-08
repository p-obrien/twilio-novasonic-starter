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

// Buffer size configurations for different scenarios
export const BufferSizeConfig = {
  // Input audio buffering (user speech)
  INPUT_REALTIME_MAX: 10,        // Small buffer for low-latency interruption detection
  INPUT_REALTIME_TRIM_TO: 5,     // Trim to this size when buffer is full
  INPUT_STANDARD_MAX: 200,       // Standard buffer size for regular mode
  
  // Output audio buffering (model speech) - Nova Sonic can generate faster than real-time
  OUTPUT_BUFFER_MAX: 1000,       // Large buffer to handle fast model responses
  OUTPUT_BUFFER_WARNING: 800,    // Warn when buffer gets large
  
  // Processing batch sizes
  PROCESSING_BATCH_SIZE: 5,      // Max chunks to process per batch
  PROCESSING_TIMEOUT_MS: 30000,  // Timeout for processing operations (30 seconds)
};