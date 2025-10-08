import { metrics } from '@opentelemetry/api';
import { CloudWatchMetrics } from './cloudWatchMetrics';
import { isOtelAvailable, isFallbackMode, enableFallbackMode } from './tracing';
import logger from './logger';

// Safe meter initialization with fallback
let meter: any = null;

function initializeMeter() {
  if (isOtelAvailable() && !isFallbackMode()) {
    try {
      meter = metrics.getMeter('twilio-bedrock-bridge', '0.1.0');
    } catch (error) {
      enableFallbackMode(`Failed to initialize metrics: ${error instanceof Error ? error.message : String(error)}`);
      meter = createFallbackMeter();
    }
  } else {
    meter = createFallbackMeter();
  }
}

// Fallback meter that logs metrics instead of sending to OTEL
function createFallbackMeter() {
  // When running tests, avoid emitting fallback metric logs. Jest will complain if
  // console logging happens after tests finish (e.g. from async GC/PerfObserver callbacks).
  const isTest = process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';

  const createFallbackInstrument = (type: string, name: string, options?: any) => {
    if (isTest) {
      // No-op in tests to prevent "Cannot log after tests are done" errors caused by
      // asynchronous metric callbacks firing after Jest's teardown.
      return {
        add: (_value: number, _attributes?: any) => { /* noop during tests */ },
        record: (_value: number, _attributes?: any) => { /* noop during tests */ }
      };
    }

    return {
      add: (value: number, attributes?: any) => {
        logger.debug(`[FALLBACK-METRIC] ${type} ${name}: ${value}`, { attributes, options });
      },
      record: (value: number, attributes?: any) => {
        logger.debug(`[FALLBACK-METRIC] ${type} ${name}: ${value}`, { attributes, options });
      }
    };
  };

  return {
    createCounter: (name: string, options?: any) => createFallbackInstrument('counter', name, options),
    createUpDownCounter: (name: string, options?: any) => createFallbackInstrument('updowncounter', name, options),
    createHistogram: (name: string, options?: any) => createFallbackInstrument('histogram', name, options),
    createGauge: (name: string, options?: any) => createFallbackInstrument('gauge', name, options)
  };
}

// Initialize meter on module load
initializeMeter();

// Application metrics with comprehensive monitoring
export const applicationMetrics = {
  // HTTP request metrics are now provided by OTEL auto-instrumentation
  // Standard metrics: http_server_duration, http_server_request_size, etc.

  // WebSocket metrics
  websocketConnectionsActive: meter.createUpDownCounter('twilio_bridge_websocket_connections_active', {
    description: 'Number of active WebSocket connections',
    unit: '1',
  }),

  websocketConnectionsTotal: meter.createCounter('twilio_bridge_websocket_connections_total', {
    description: 'Total number of WebSocket connections established',
    unit: '1',
  }),

  websocketMessagesTotal: meter.createCounter('twilio_bridge_websocket_messages_total', {
    description: 'Total number of WebSocket messages processed',
    unit: '1',
  }),

  websocketMessageSize: meter.createHistogram('twilio_bridge_websocket_message_size_bytes', {
    description: 'WebSocket message size in bytes',
    unit: 'By',
  }),

  websocketConnectionDuration: meter.createHistogram('twilio_bridge_websocket_connection_duration_seconds', {
    description: 'WebSocket connection duration in seconds',
    unit: 's',
  }),

  // Bedrock API metrics
  bedrockRequestsTotal: meter.createCounter('twilio_bridge_bedrock_requests_total', {
    description: 'Total number of Bedrock API requests',
    unit: '1',
  }),

  bedrockRequestDuration: meter.createHistogram('twilio_bridge_bedrock_request_duration_seconds', {
    description: 'Bedrock API request duration in seconds',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30],
    },
  }),

  bedrockErrors: meter.createCounter('twilio_bridge_bedrock_errors_total', {
    description: 'Total number of Bedrock API errors',
    unit: '1',
  }),

  bedrockTokensInput: meter.createCounter('twilio_bridge_bedrock_tokens_input_total', {
    description: 'Total number of input tokens sent to Bedrock',
    unit: '1',
  }),

  bedrockTokensOutput: meter.createCounter('twilio_bridge_bedrock_tokens_output_total', {
    description: 'Total number of output tokens received from Bedrock',
    unit: '1',
  }),

  bedrockStreamingLatency: meter.createHistogram('twilio_bridge_bedrock_streaming_latency_seconds', {
    description: 'Time to first token from Bedrock streaming response',
    unit: 's',
  }),

  // Audio processing metrics
  audioChunksProcessed: meter.createCounter('twilio_bridge_audio_chunks_processed_total', {
    description: 'Total number of audio chunks processed',
    unit: '1',
  }),

  audioProcessingDuration: meter.createHistogram('twilio_bridge_audio_processing_duration_seconds', {
    description: 'Audio processing duration in seconds',
    unit: 's',
  }),

  audioChunkSize: meter.createHistogram('twilio_bridge_audio_chunk_size_bytes', {
    description: 'Audio chunk size in bytes',
    unit: 'By',
  }),

  audioSampleRate: meter.createHistogram('twilio_bridge_audio_sample_rate_hz', {
    description: 'Audio sample rate in Hz',
    unit: 'Hz',
  }),

  // Twilio-specific metrics
  twilioCallsActive: meter.createUpDownCounter('twilio_bridge_calls_active', {
    description: 'Number of active Twilio calls',
    unit: '1',
  }),

  twilioCallsTotal: meter.createCounter('twilio_bridge_calls_total', {
    description: 'Total number of Twilio calls processed',
    unit: '1',
  }),

  twilioCallDuration: meter.createHistogram('twilio_bridge_call_duration_seconds', {
    description: 'Twilio call duration in seconds',
    unit: 's',
  }),

  twilioWebhookEvents: meter.createCounter('twilio_bridge_webhook_events_total', {
    description: 'Total number of Twilio webhook events received',
    unit: '1',
  }),

  // System metrics (using histograms instead of observable gauges for compatibility)
  memoryUsage: meter.createHistogram('twilio_bridge_memory_usage_bytes', {
    description: 'Memory usage in bytes',
    unit: 'By',
  }),

  cpuUsage: meter.createHistogram('twilio_bridge_cpu_usage_percent', {
    description: 'CPU usage percentage',
    unit: '%',
  }),

  eventLoopLag: meter.createHistogram('twilio_bridge_event_loop_lag_seconds', {
    description: 'Node.js event loop lag in seconds',
    unit: 's',
  }),

  gcDuration: meter.createHistogram('twilio_bridge_gc_duration_seconds', {
    description: 'Garbage collection duration in seconds',
    unit: 's',
  }),

  activeHandles: meter.createHistogram('twilio_bridge_active_handles', {
    description: 'Number of active handles',
    unit: '1',
  }),

  // Error metrics
  errorsTotal: meter.createCounter('twilio_bridge_errors_total', {
    description: 'Total number of errors by type',
    unit: '1',
  }),

  // Business metrics
  conversationTurns: meter.createCounter('twilio_bridge_conversation_turns_total', {
    description: 'Total number of conversation turns',
    unit: '1',
  }),

  responseLatency: meter.createHistogram('twilio_bridge_response_latency_seconds', {
    description: 'End-to-end response latency from user input to audio output',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
    },
  }),
};

// System monitoring state
let lastCpuUsage = process.cpuUsage();
let lastEventLoopCheck = process.hrtime.bigint();

// System metrics collection (using periodic recording instead of callbacks)
function recordSystemMetrics() {
  try {
    // Memory metrics
    const memUsage = process.memoryUsage();
    applicationMetrics.memoryUsage.record(memUsage.heapUsed, { type: 'heap_used' });
    applicationMetrics.memoryUsage.record(memUsage.heapTotal, { type: 'heap_total' });
    applicationMetrics.memoryUsage.record(memUsage.rss, { type: 'rss' });
    applicationMetrics.memoryUsage.record(memUsage.external, { type: 'external' });
    applicationMetrics.memoryUsage.record(memUsage.arrayBuffers, { type: 'array_buffers' });

    // CPU metrics
    const currentCpuUsage = process.cpuUsage(lastCpuUsage);
    const totalTime = (currentCpuUsage.user + currentCpuUsage.system) / 1000; // Convert to milliseconds
    const elapsedTime = process.uptime() * 1000; // Convert to milliseconds
    const cpuPercent = (totalTime / elapsedTime) * 100;
    
    applicationMetrics.cpuUsage.record(cpuPercent, { type: 'total' });
    applicationMetrics.cpuUsage.record((currentCpuUsage.user / 1000) / elapsedTime * 100, { type: 'user' });
    applicationMetrics.cpuUsage.record((currentCpuUsage.system / 1000) / elapsedTime * 100, { type: 'system' });
    
    lastCpuUsage = process.cpuUsage();

    // Event loop lag
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1e9; // Convert to seconds
      applicationMetrics.eventLoopLag.record(lag);
    });

    // Active handles
    // @ts-ignore - _getActiveHandles is internal but useful for monitoring
    const handles = process._getActiveHandles ? process._getActiveHandles().length : 0;
    applicationMetrics.activeHandles.record(handles);
  } catch (error) {
    logger.debug('Error recording system metrics', { error: error instanceof Error ? error.message : String(error) });
  }
}

// Record system metrics every 30 seconds
setInterval(recordSystemMetrics, 30000);

// Utility functions for recording metrics
export const metricsUtils = {
  // HTTP metrics are now handled by OTEL auto-instrumentation
  // Keeping this for backward compatibility but it's a no-op
  recordHttpRequest: (method: string, route: string, statusCode: number, duration: number, requestSize?: number, responseSize?: number) => {
    // HTTP metrics are automatically collected by OTEL Express instrumentation
    // This method is kept for backward compatibility but does nothing
  },

  // WebSocket metrics helpers
  recordWebSocketConnection: (action: 'connect' | 'disconnect', duration?: number, callSid?: string) => {
    if (action === 'connect') {
      applicationMetrics.websocketConnectionsActive.add(1);
      applicationMetrics.websocketConnectionsTotal.add(1);
    } else {
      applicationMetrics.websocketConnectionsActive.add(-1);
      if (duration !== undefined) {
        applicationMetrics.websocketConnectionDuration.record(duration);
      }
    }
    
    // Also send to CloudWatch (batched)
    CloudWatchMetrics.websocketConnection(action, callSid);
  },

  recordWebSocketMessage: (direction: 'inbound' | 'outbound', messageType: string, size: number, callSid?: string) => {
    const labels = { direction, message_type: messageType };
    applicationMetrics.websocketMessagesTotal.add(1, labels);
    applicationMetrics.websocketMessageSize.record(size, labels);
    
    // Also send to CloudWatch (batched)
    CloudWatchMetrics.websocketMessage(direction, messageType, size, callSid);
  },

  // Bedrock metrics helpers
  recordBedrockRequest: (modelId: string, operation: string, duration: number, success: boolean, inputTokens?: number, outputTokens?: number, streamingLatency?: number) => {
    const labels = { model_id: modelId, operation, success: success.toString() };
    
    applicationMetrics.bedrockRequestsTotal.add(1, labels);
    applicationMetrics.bedrockRequestDuration.record(duration, labels);
    
    if (!success) {
      applicationMetrics.bedrockErrors.add(1, labels);
    }
    
    if (inputTokens !== undefined) {
      applicationMetrics.bedrockTokensInput.add(inputTokens, labels);
    }
    if (outputTokens !== undefined) {
      applicationMetrics.bedrockTokensOutput.add(outputTokens, labels);
    }
    if (streamingLatency !== undefined) {
      applicationMetrics.bedrockStreamingLatency.record(streamingLatency, labels);
    }
    
    // Also send to CloudWatch (batched)
    CloudWatchMetrics.bedrockRequest(modelId, operation, duration * 1000, success, inputTokens, outputTokens);
  },

  // Audio metrics helpers
  recordAudioProcessing: (operation: string, duration: number, chunkSize: number, sampleRate?: number, callSid?: string) => {
    const labels = { operation };
    
    applicationMetrics.audioChunksProcessed.add(1, labels);
    applicationMetrics.audioProcessingDuration.record(duration, labels);
    applicationMetrics.audioChunkSize.record(chunkSize, labels);
    
    if (sampleRate !== undefined) {
      applicationMetrics.audioSampleRate.record(sampleRate, labels);
    }
    
    // Also send to CloudWatch (batched)
    CloudWatchMetrics.audioProcessing(operation, duration * 1000, chunkSize, sampleRate, callSid);
  },

  // Twilio metrics helpers
  recordTwilioCall: (action: 'start' | 'end', callSid: string, duration?: number) => {
    const labels = { call_sid: callSid };
    
    if (action === 'start') {
      applicationMetrics.twilioCallsActive.add(1, labels);
      applicationMetrics.twilioCallsTotal.add(1, labels);
    } else {
      applicationMetrics.twilioCallsActive.add(-1, labels);
      if (duration !== undefined) {
        applicationMetrics.twilioCallDuration.record(duration, labels);
      }
    }
  },

  recordTwilioWebhook: (eventType: string, callSid?: string) => {
    const labels = { event_type: eventType, call_sid: callSid || 'unknown' };
    applicationMetrics.twilioWebhookEvents.add(1, labels);
  },

  // Error metrics helpers
  recordError: (errorType: string, component: string, severity: 'low' | 'medium' | 'high' | 'critical', callSid?: string) => {
    const labels = { error_type: errorType, component, severity };
    applicationMetrics.errorsTotal.add(1, labels);
    
    // Also send to CloudWatch (batched)
    CloudWatchMetrics.error(errorType, component, severity, callSid);
  },

  // Business metrics helpers
  recordConversationTurn: (callSid: string, turnNumber: number, responseLatencyMs?: number) => {
    const labels = { call_sid: callSid, turn_number: turnNumber.toString() };
    applicationMetrics.conversationTurns.add(1, labels);
    
    // Also send to CloudWatch (batched)
    if (responseLatencyMs !== undefined) {
      CloudWatchMetrics.conversationTurn(callSid, turnNumber, responseLatencyMs);
    }
  },

  recordResponseLatency: (callSid: string, latency: number, stage: string) => {
    const labels = { call_sid: callSid, stage };
    applicationMetrics.responseLatency.record(latency, labels);
  },

  // Custom metrics helper for audio quality
  recordCustomMetric: (metricName: string, value: number, labels: Record<string, string>) => {
    // Try to record to OTEL if available
    try {
      const histogram = meter.createHistogram(`twilio_bridge_${metricName}`, {
        description: `Custom metric: ${metricName}`,
        unit: '1'
      });
      histogram.record(value, labels);
    } catch (error) {
      // Fallback to logging if OTEL is not available
      logger.debug(`Custom metric: ${metricName}`, { value, labels });
    }
  },

  // GC metrics helper
  recordGarbageCollection: (type: string, duration: number) => {
    const labels = { gc_type: type };
    applicationMetrics.gcDuration.record(duration, labels);
  },
};

// Initialize GC monitoring if available
if (global.gc) {
  const { PerformanceObserver } = require('perf_hooks');
  const obs = new PerformanceObserver((list: any) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'gc') {
        metricsUtils.recordGarbageCollection(entry.detail?.kind || 'unknown', entry.duration / 1000);
      }
    }
  });
  obs.observe({ entryTypes: ['gc'] });
}

export { meter };