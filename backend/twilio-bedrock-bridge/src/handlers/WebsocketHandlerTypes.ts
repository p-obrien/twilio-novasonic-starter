/**
 * @fileoverview Type definitions for WebSocketHandler dependency injection
 *
 * This file contains interfaces for injecting dependencies into the WebSocketHandler,
 * making it more testable and following SOLID principles.
 */

import { NovaSonicBidirectionalStreamClient } from '../client';
import { webSocketSecurity } from '../security/WebSocketSecurity';
import { WebSocketMetrics } from '../observability/websocketMetrics';
import { SessionMetrics } from '../observability/sessionMetrics';
import { AudioBufferManager } from '../audio/AudioBufferManager';
import { CorrelationIdManager } from '../utils/correlationId';
import logger from '../observability/logger';

/**
 * Audio processing functions interface
 */
export interface AudioProcessors {
  processBedrockAudioOutput: (
    audioOut: any,
    sampleRate: number,
    sessionId: string,
    callSid?: string
  ) => Buffer;
  processTwilioAudioInput: (
    muLawBuf: Buffer,
    sessionId: string,
    callSid?: string
  ) => Buffer;
}

/**
 * Logger interface for dependency injection
 */
export interface Logger {
  debug: (message: string, meta?: any) => void;
  info: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  error: (message: string, meta?: any) => void;
  trace?: (message: string, meta?: any) => void;
}

/**
 * WebSocket security interface
 */
export interface WebSocketSecurityService {
  validateConnection: (req: any) => {
    isValid: boolean;
    callSid?: string;
    accountSid?: string;
    reason?: string;
  };
  validateWebSocketMessage: (msg: any) => {
    isValid: boolean;
    callSid?: string;
    reason?: string;
  };
  addActiveSession: (callSid: string, sessionId: string) => void;
  removeActiveSession: (callSid: string) => void;
  isSessionActive: (callSid: string) => boolean;
}

/**
 * WebSocket metrics service interface
 */
export interface WebSocketMetricsService {
  onConnection: (ws: any) => void;
  onDisconnection: (ws: any) => void;
}

/**
 * Session metrics service interface
 */
export interface SessionMetricsService {
  createSession: (sessionId: string, ws: any, callSid?: string) => void;
  endSession: (sessionId: string) => void;
}

/**
 * Audio buffer manager interface
 */
export interface AudioBufferManagerService {
  getInstance: () => {
    addAudio: (sessionId: string, ws: any, audioData: Buffer) => void;
    getBufferStatus: (sessionId: string) => { bufferBytes: number; bufferMs: number } | null;
    flushAndRemove: (sessionId: string) => void;
  };
}

/**
 * Correlation manager interface
 */
export interface CorrelationManagerService {
  createWebSocketContext: (params: any) => any;
  runWithContext: (context: any, fn: () => void | Promise<void>) => void | Promise<void>;
  setContext: (context: any) => void;
  getCurrentContext: () => any;
  getCurrentCorrelationId: () => string | undefined;
}

/**
 * Smart sampler service interface for distributed tracing
 */
export interface SmartSamplerService {
  shouldSample: (params: {
    operationName: string;
    attributes?: Record<string, any>;
    sessionId?: string;
    callSid?: string;
  }) => {
    shouldSample: boolean;
    reason?: string;
    sampleRate?: number;
  };
  startSpanWithSampling: (tracer: any, spanName: string, params: any) => any;
  getSamplingConfig?: () => any;
}

/**
 * Tracing utilities interface
 */
export interface TracingUtilsService {
  extractTraceContext: (params: any) => any;
  injectTraceContext: (params: any) => void;
}

/**
 * Complete dependencies interface for WebSocketHandler
 * All dependencies are optional to maintain backward compatibility
 */
export interface WebSocketHandlerDependencies {
  /** Bedrock Nova Sonic client for streaming */
  bedrockClient?: NovaSonicBidirectionalStreamClient;

  /** Security service for validating connections and messages */
  security?: WebSocketSecurityService;

  /** WebSocket metrics tracking */
  wsMetrics?: WebSocketMetricsService;

  /** Session metrics tracking */
  sessionMetrics?: SessionMetricsService;

  /** Audio buffer management */
  audioBufferManager?: AudioBufferManagerService;

  /** Audio processing functions */
  audioProcessors?: AudioProcessors;

  /** Logger instance */
  logger?: Logger;

  /** Correlation ID manager */
  correlationManager?: CorrelationManagerService;

  /** Smart sampler for distributed tracing */
  smartSampler?: SmartSamplerService;

  /** Tracing utilities */
  tracingUtils?: TracingUtilsService;
}

/**
 * Default dependencies factory
 * Creates default instances for all dependencies
 */
export function createDefaultDependencies(): Required<WebSocketHandlerDependencies> {
  const { processBedrockAudioOutput, processTwilioAudioInput } = require('../audio/AudioProcessor');
  const { smartSampler, TracingUtils } = require('../observability/smartSampling');

  return {
    bedrockClient: new NovaSonicBidirectionalStreamClient({
      clientConfig: {
        region: require('../config/AppConfig').config.bedrock?.region || 'us-east-1'
      },
      bedrock: {
        region: require('../config/AppConfig').config.bedrock?.region || 'us-east-1',
        modelId: require('../config/AppConfig').config.bedrock?.modelId || 'amazon.nova-sonic-v1:0'
      }
    }),
    security: webSocketSecurity,
    wsMetrics: WebSocketMetrics,
    sessionMetrics: SessionMetrics,
    audioBufferManager: { getInstance: () => AudioBufferManager.getInstance() },
    audioProcessors: {
      processBedrockAudioOutput,
      processTwilioAudioInput
    },
    logger,
    correlationManager: CorrelationIdManager,
    smartSampler,
    tracingUtils: TracingUtils
  };
}
