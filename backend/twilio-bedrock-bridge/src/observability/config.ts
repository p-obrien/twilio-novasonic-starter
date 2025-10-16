/**
 * Observability Configuration
 * Centralized configuration for all observability settings
 */

import { otelCapabilities, currentEnvironment } from '../utils/environment';

export interface ObservabilityConfig {
  // Service identification
  serviceName: string;
  serviceVersion: string;
  environment: string;
  
  // Logging configuration
  logging: {
    level: string;
    enableStructuredLogging: boolean;
    enableTraceCorrelation: boolean;
  };
  
  // Metrics configuration
  metrics: {
    enableCustomMetrics: boolean;
    enableSystemMetrics: boolean;
    metricsInterval: number; // in milliseconds
    maxTrackedConnections: number;
    maxTrackedSessions: number;
  };
  
  // Tracing configuration
  tracing: {
    enableXRay: boolean;
    enableOTLP: boolean;
    otlpEndpoint?: string;
    sampleRate: number;
    sampling: {
      // High-volume operation sampling rates (reduce noise)
      websocketMessages: number;
      audioChunks: number;
      bedrockStreaming: number;
      healthChecks: number;
      // Critical operation sampling (always trace important operations)
      errors: number;
      bedrockRequests: number;
      sessionLifecycle: number;
      // Custom sampling rules
      customRules: Array<{
        operationName: string;
        sampleRate: number;
        attributes?: Record<string, string>;
      }>;
    };
  };
  
  // CloudWatch configuration
  cloudWatch: {
    enabled: boolean;
    region: string;
    namespace: string;
    batching: {
      enabled: boolean;
      maxBatchSize: number;
      flushIntervalMs: number;
      maxRetries: number;
      retryDelayMs: number;
    };
  };
  
  // Health check configuration
  healthCheck: {
    memoryThresholdMB: number;
    eventLoopLagThresholdMS: number;
    maxActiveSessions: number;
    staleSessionTimeoutMS: number;
  };
}

// Default configuration
const defaultConfig: ObservabilityConfig = {
  serviceName: process.env.OTEL_SERVICE_NAME || 'twilio-bedrock-bridge',
  serviceVersion: process.env.OTEL_SERVICE_VERSION || '0.1.0',
  environment: process.env.NODE_ENV || 'development',
  
  logging: {
    level: process.env.LOG_LEVEL || 'INFO',
    enableStructuredLogging: process.env.NODE_ENV === 'production',
    enableTraceCorrelation: true,
  },
  
  metrics: {
    enableCustomMetrics: true,
    enableSystemMetrics: true,
    metricsInterval: 30000, // 30 seconds
    maxTrackedConnections: 10000,
    maxTrackedSessions: 1000,
  },
  
  tracing: {
    enableXRay: process.env.ENABLE_XRAY !== 'false',
    enableOTLP: true,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
    sampleRate: parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG || '0.1'), // 10% default sampling
    sampling: {
      // High-volume operations - sample sparingly to reduce noise
      websocketMessages: parseFloat(process.env.OTEL_SAMPLE_WEBSOCKET_MESSAGES || '0.01'), // 1%
      audioChunks: parseFloat(process.env.OTEL_SAMPLE_AUDIO_CHUNKS || '0.005'), // 0.5%
      bedrockStreaming: parseFloat(process.env.OTEL_SAMPLE_BEDROCK_STREAMING || '0.02'), // 2%
      healthChecks: parseFloat(process.env.OTEL_SAMPLE_HEALTH_CHECKS || '0.001'), // 0.1%
      
      // Critical operations - sample heavily to capture important traces
      errors: parseFloat(process.env.OTEL_SAMPLE_ERRORS || '1.0'), // 100% - always trace errors
      bedrockRequests: parseFloat(process.env.OTEL_SAMPLE_BEDROCK_REQUESTS || '0.5'), // 50%
      sessionLifecycle: parseFloat(process.env.OTEL_SAMPLE_SESSION_LIFECYCLE || '0.8'), // 80%
      
      // Custom rules for specific scenarios
      customRules: [
        {
          operationName: 'webhook.handle',
          sampleRate: parseFloat(process.env.OTEL_SAMPLE_WEBHOOK || '0.3'), // 30%
        },
        {
          operationName: 'bedrock.initiate_session',
          sampleRate: parseFloat(process.env.OTEL_SAMPLE_BEDROCK_INITIATE || '0.8'), // 80%
        }
      ]
    }
  },
  
  cloudWatch: {
    // Enable CloudWatch by default, or when OTEL is unreliable (like in Fargate)
    enabled: process.env.CLOUDWATCH_ENABLED !== 'false' || otelCapabilities.shouldSkipOTEL,
    region: process.env.AWS_REGION || currentEnvironment.region || 'us-east-1',
    namespace: 'TwilioBedrockBridge',
    batching: {
      enabled: process.env.CLOUDWATCH_BATCHING_ENABLED !== 'false',
      // Use larger batches and faster flush in environments where OTEL is unreliable
      maxBatchSize: parseInt(process.env.CLOUDWATCH_BATCH_SIZE || (otelCapabilities.shouldSkipOTEL ? '50' : '20')),
      flushIntervalMs: parseInt(process.env.CLOUDWATCH_FLUSH_INTERVAL_MS || (otelCapabilities.shouldSkipOTEL ? '15000' : '30000')),
      maxRetries: parseInt(process.env.CLOUDWATCH_MAX_RETRIES || '3'),
      retryDelayMs: parseInt(process.env.CLOUDWATCH_RETRY_DELAY_MS || '1000'),
    },
  },
  
  healthCheck: {
    memoryThresholdMB: 1024, // 1GB
    eventLoopLagThresholdMS: 100,
    maxActiveSessions: 100,
    staleSessionTimeoutMS: 30 * 60 * 1000, // 30 minutes
  },
};

// Configuration validation
function validateConfig(config: ObservabilityConfig): void {
  if (!config.serviceName) {
    throw new Error('Service name is required');
  }
  
  if (config.metrics.maxTrackedConnections <= 0) {
    throw new Error('maxTrackedConnections must be positive');
  }
  
  if (config.metrics.maxTrackedSessions <= 0) {
    throw new Error('maxTrackedSessions must be positive');
  }
  
  if (config.tracing.sampleRate < 0 || config.tracing.sampleRate > 1) {
    throw new Error('Sample rate must be between 0 and 1');
  }
  
  if (config.healthCheck.memoryThresholdMB <= 0) {
    throw new Error('Memory threshold must be positive');
  }
}

// Load and validate configuration
export function loadObservabilityConfig(): ObservabilityConfig {
  const config = { ...defaultConfig };
  
  // Override with environment-specific settings
  if (process.env.OBSERVABILITY_CONFIG) {
    try {
      const envConfig = JSON.parse(process.env.OBSERVABILITY_CONFIG);
      Object.assign(config, envConfig);
    } catch (error) {
      console.warn('Failed to parse OBSERVABILITY_CONFIG environment variable:', error);
    }
  }
  
  validateConfig(config);
  return config;
}

// Export singleton instance
export const observabilityConfig = loadObservabilityConfig();

// Log configuration on startup (skip in test environment)
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  console.log('Observability configuration loaded:', {
    service: `${observabilityConfig.serviceName}@${observabilityConfig.serviceVersion}`,
    environment: observabilityConfig.environment,
    logging: observabilityConfig.logging.level,
    xray: observabilityConfig.tracing.enableXRay,
    cloudWatch: observabilityConfig.cloudWatch.enabled,
    cloudWatchRegion: observabilityConfig.cloudWatch.region,
    customMetrics: observabilityConfig.metrics.enableCustomMetrics,
  });
}