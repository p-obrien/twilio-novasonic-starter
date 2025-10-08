/**
 * Audio processing module exports
 * 
 * This module provides a unified interface for all audio processing operations
 * in the Twilio-Bedrock bridge application.
 */

export { AudioBuffer, WebSocketLike } from './AudioBuffer';
export { AudioBufferManager } from './AudioBufferManager';
export { BufferPool } from './BufferPool';
export { UnifiedAudioProcessor, unifiedAudioProcessor } from './UnifiedAudioProcessor';
export { AudioProcessingBenchmarker } from './AudioProcessor';
export { audioQualityAnalyzer } from './AudioQualityAnalyzer';

// Re-export commonly used functions for backward compatibility
export {
  muLawBufferToPcm16LE,
  pcm16BufferToMuLaw,
  upsample8kTo16k,
  downsampleWithAntiAliasing,
  processBedrockAudioOutput,
  processTwilioAudioInput
} from './AudioProcessor';

// Re-export streaming functionality
export { streamAudioFrames } from './AudioFrameStreamer';