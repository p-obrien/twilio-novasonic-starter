/**
 * Unified Configuration Types
 * Consolidates all configuration interfaces into a single type system
 */

import { InferenceConfig } from '../types/SharedTypes';

// Server Configuration
export interface ServerConfig {
  port: number;
  host?: string;
  timeout: number;
  maxConcurrentStreams: number;
  disableConcurrentStreams: boolean;
}

// AWS Configuration
export interface AWSConfig {
  region: string;
  profileName?: string;
  availabilityZone?: string;
}

// Bedrock Configuration
export interface BedrockConfig {
  region: string;
  modelId: string;
  requestTimeout: number;
  sessionTimeout: number;
  maxAudioQueueSize: number;
  maxChunksPerBatch: number;
  defaultAckTimeout: number;
}

// Twilio Configuration
export interface TwilioConfig {
  authToken: string;
  accountSid?: string;
  publicWsHost?: string;
  forceWsProto?: string;
}

// Logging Configuration
export interface LoggingConfig {
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';
  enableStructuredLogging: boolean;
  enableTraceCorrelation: boolean;
  maxLogContentLength: number;
}

// Metrics Configuration
export interface MetricsConfig {
  enableCustomMetrics: boolean;
  enableSystemMetrics: boolean;
  metricsInterval: number;
  maxTrackedConnections: number;
  maxTrackedSessions: number;
}

// Tracing Configuration
export interface TracingConfig {
  enableXRay: boolean;
  enableOTLP: boolean;
  otlpEndpoint?: string;
  sampleRate: number;
  sampling: {
    websocketMessages: number;
    audioChunks: number;
    bedrockStreaming: number;
    healthChecks: number;
    errors: number;
    bedrockRequests: number;
    sessionLifecycle: number;
    customRules: Array<{
      operationName: string;
      sampleRate: number;
      attributes?: Record<string, string>;
    }>;
  };
}

// CloudWatch Configuration
export interface CloudWatchConfig {
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
}

// Health Check Configuration
export interface HealthCheckConfig {
  memoryThresholdMB: number;
  eventLoopLagThresholdMS: number;
  maxActiveSessions: number;
  staleSessionTimeoutMS: number;
}

// Environment Configuration
export interface EnvironmentConfig {
  nodeEnv: 'development' | 'test' | 'staging' | 'production';
  serviceName: string;
  serviceVersion: string;
  isECS: boolean;
  isFargate: boolean;
  isKubernetes: boolean;
  isEKS: boolean;
  isLocal: boolean;
  platform: string;
  namespace?: string;
  podName?: string;
  clusterName?: string;
}

// Unified Application Configuration
export interface UnifiedConfig {
  server: ServerConfig;
  aws: AWSConfig;
  bedrock: BedrockConfig;
  twilio: TwilioConfig;
  logging: LoggingConfig;
  metrics: MetricsConfig;
  tracing: TracingConfig;
  cloudWatch: CloudWatchConfig;
  healthCheck: HealthCheckConfig;
  environment: EnvironmentConfig;
  inference: InferenceConfig;
}

// Configuration Schema for validation
export interface ConfigSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required: boolean;
    default?: any;
    validation?: (value: any) => boolean;
    description: string;
  };
}

// Default values
export const DEFAULT_CONFIG: Partial<UnifiedConfig> = {
  server: {
    port: 8080,
    timeout: 300000,
    maxConcurrentStreams: 20,
    disableConcurrentStreams: false,
  },
  aws: {
    region: 'us-east-1',
  },
  bedrock: {
    region: 'us-east-1',
    modelId: 'amazon.nova-sonic-v1:0',
    requestTimeout: 300000,
    sessionTimeout: 300000,
    maxAudioQueueSize: 200,
    maxChunksPerBatch: 5,
    defaultAckTimeout: 5000,
  },
  logging: {
    level: 'INFO',
    enableStructuredLogging: false,
    enableTraceCorrelation: true,
    maxLogContentLength: 200,
  },
  metrics: {
    enableCustomMetrics: true,
    enableSystemMetrics: true,
    metricsInterval: 30000,
    maxTrackedConnections: 10000,
    maxTrackedSessions: 1000,
  },
  tracing: {
    enableXRay: true,
    enableOTLP: true,
    sampleRate: 0.1,
    sampling: {
      websocketMessages: 0.01,
      audioChunks: 0.005,
      bedrockStreaming: 0.02,
      healthChecks: 0.001,
      errors: 1.0,
      bedrockRequests: 0.5,
      sessionLifecycle: 0.8,
      customRules: [],
    },
  },
  cloudWatch: {
    enabled: true,
    region: 'us-east-1',
    namespace: 'TwilioBedrockBridge',
    batching: {
      enabled: true,
      maxBatchSize: 20,
      flushIntervalMs: 30000,
      maxRetries: 3,
      retryDelayMs: 1000,
    },
  },
  healthCheck: {
    memoryThresholdMB: 1024,
    eventLoopLagThresholdMS: 100,
    maxActiveSessions: 100,
    staleSessionTimeoutMS: 1800000, // 30 minutes
  },
  environment: {
    nodeEnv: 'development',
    serviceName: 'twilio-bedrock-bridge',
    serviceVersion: '0.1.0',
    isECS: false,
    isFargate: false,
    isKubernetes: false,
    isEKS: false,
    isLocal: true,
    platform: 'local',
  },
};