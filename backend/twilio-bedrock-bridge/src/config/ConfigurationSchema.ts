/**
 * Configuration Schema and Validation Rules
 * Defines validation rules for all configuration properties
 */

import { ConfigSchema } from './ConfigurationTypes';

export const CONFIG_SCHEMA: ConfigSchema = {
  // Server Configuration
  'server.port': {
    type: 'number',
    required: false,
    default: 8080,
    validation: (value: number) => value > 0 && value <= 65535,
    description: 'Server port number (1-65535)',
  },
  'server.host': {
    type: 'string',
    required: false,
    description: 'Server host address',
  },
  'server.timeout': {
    type: 'number',
    required: false,
    default: 300000,
    validation: (value: number) => value > 0,
    description: 'Server timeout in milliseconds',
  },
  'server.maxConcurrentStreams': {
    type: 'number',
    required: false,
    default: 20,
    validation: (value: number) => value > 0 && value <= 1000,
    description: 'Maximum concurrent streams (1-1000)',
  },
  'server.disableConcurrentStreams': {
    type: 'boolean',
    required: false,
    default: false,
    description: 'Disable concurrent streams',
  },

  // AWS Configuration
  'aws.region': {
    type: 'string',
    required: false,
    default: 'us-east-1',
    validation: (value: string) => /^[a-z0-9-]+$/.test(value),
    description: 'AWS region identifier',
  },
  'aws.profileName': {
    type: 'string',
    required: false,
    description: 'AWS profile name',
  },

  // Bedrock Configuration
  'bedrock.region': {
    type: 'string',
    required: false,
    default: 'us-east-1',
    validation: (value: string) => /^[a-z0-9-]+$/.test(value),
    description: 'Bedrock service region',
  },
  'bedrock.modelId': {
    type: 'string',
    required: false,
    default: 'amazon.nova-sonic-v1:0',
    validation: (value: string) => value.length > 0,
    description: 'Bedrock model identifier',
  },
  'bedrock.requestTimeout': {
    type: 'number',
    required: false,
    default: 300000,
    validation: (value: number) => value > 0,
    description: 'Bedrock request timeout in milliseconds',
  },
  'bedrock.sessionTimeout': {
    type: 'number',
    required: false,
    default: 300000,
    validation: (value: number) => value > 0,
    description: 'Bedrock session timeout in milliseconds',
  },
  'bedrock.maxAudioQueueSize': {
    type: 'number',
    required: false,
    default: 200,
    validation: (value: number) => value > 0 && value <= 10000,
    description: 'Maximum audio queue size (1-10000)',
  },
  'bedrock.maxChunksPerBatch': {
    type: 'number',
    required: false,
    default: 5,
    validation: (value: number) => value > 0 && value <= 100,
    description: 'Maximum chunks per batch (1-100)',
  },
  'bedrock.defaultAckTimeout': {
    type: 'number',
    required: false,
    default: 5000,
    validation: (value: number) => value > 0,
    description: 'Default acknowledgment timeout in milliseconds',
  },

  // Twilio Configuration
  'twilio.authToken': {
    type: 'string',
    required: true,
    validation: (value: string) => value.length >= 32,
    description: 'Twilio authentication token (required, min 32 chars)',
  },
  'twilio.accountSid': {
    type: 'string',
    required: false,
    validation: (value: string) => !value || value.startsWith('AC'),
    description: 'Twilio account SID (optional, must start with AC)',
  },
  'twilio.publicWsHost': {
    type: 'string',
    required: false,
    description: 'Public WebSocket host override',
  },
  'twilio.forceWsProto': {
    type: 'string',
    required: false,
    validation: (value: string) => !value || ['ws', 'wss'].includes(value),
    description: 'Force WebSocket protocol (ws or wss)',
  },

  // Logging Configuration
  'logging.level': {
    type: 'string',
    required: false,
    default: 'INFO',
    validation: (value: string) => ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'].includes(value),
    description: 'Log level (ERROR, WARN, INFO, DEBUG, TRACE)',
  },
  'logging.enableStructuredLogging': {
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable structured JSON logging',
  },
  'logging.enableTraceCorrelation': {
    type: 'boolean',
    required: false,
    default: true,
    description: 'Enable trace correlation in logs',
  },
  'logging.maxLogContentLength': {
    type: 'number',
    required: false,
    default: 200,
    validation: (value: number) => value > 0 && value <= 10000,
    description: 'Maximum log content length (1-10000)',
  },

  // Metrics Configuration
  'metrics.enableCustomMetrics': {
    type: 'boolean',
    required: false,
    default: true,
    description: 'Enable custom application metrics',
  },
  'metrics.enableSystemMetrics': {
    type: 'boolean',
    required: false,
    default: true,
    description: 'Enable system metrics collection',
  },
  'metrics.metricsInterval': {
    type: 'number',
    required: false,
    default: 30000,
    validation: (value: number) => value >= 1000 && value <= 300000,
    description: 'Metrics collection interval in milliseconds (1000-300000)',
  },
  'metrics.maxTrackedConnections': {
    type: 'number',
    required: false,
    default: 10000,
    validation: (value: number) => value > 0 && value <= 100000,
    description: 'Maximum tracked connections (1-100000)',
  },
  'metrics.maxTrackedSessions': {
    type: 'number',
    required: false,
    default: 1000,
    validation: (value: number) => value > 0 && value <= 10000,
    description: 'Maximum tracked sessions (1-10000)',
  },

  // Tracing Configuration
  'tracing.enableXRay': {
    type: 'boolean',
    required: false,
    default: true,
    description: 'Enable AWS X-Ray tracing',
  },
  'tracing.enableOTLP': {
    type: 'boolean',
    required: false,
    default: true,
    description: 'Enable OpenTelemetry Protocol',
  },
  'tracing.otlpEndpoint': {
    type: 'string',
    required: false,
    description: 'OTLP endpoint URL',
  },
  'tracing.sampleRate': {
    type: 'number',
    required: false,
    default: 0.1,
    validation: (value: number) => value >= 0 && value <= 1,
    description: 'Trace sample rate (0.0-1.0)',
  },

  // CloudWatch Configuration
  'cloudWatch.enabled': {
    type: 'boolean',
    required: false,
    default: true,
    description: 'Enable CloudWatch metrics',
  },
  'cloudWatch.region': {
    type: 'string',
    required: false,
    default: 'us-east-1',
    validation: (value: string) => /^[a-z0-9-]+$/.test(value),
    description: 'CloudWatch region',
  },
  'cloudWatch.namespace': {
    type: 'string',
    required: false,
    default: 'TwilioBedrockBridge',
    validation: (value: string) => value.length > 0 && value.length <= 255,
    description: 'CloudWatch namespace (1-255 chars)',
  },
  'cloudWatch.batching.enabled': {
    type: 'boolean',
    required: false,
    default: true,
    description: 'Enable CloudWatch metric batching',
  },
  'cloudWatch.batching.maxBatchSize': {
    type: 'number',
    required: false,
    default: 20,
    validation: (value: number) => value > 0 && value <= 1000,
    description: 'Maximum CloudWatch batch size (1-1000)',
  },
  'cloudWatch.batching.flushIntervalMs': {
    type: 'number',
    required: false,
    default: 30000,
    validation: (value: number) => value >= 1000 && value <= 300000,
    description: 'CloudWatch flush interval in milliseconds (1000-300000)',
  },
  'cloudWatch.batching.maxRetries': {
    type: 'number',
    required: false,
    default: 3,
    validation: (value: number) => value >= 0 && value <= 10,
    description: 'Maximum CloudWatch retry attempts (0-10)',
  },
  'cloudWatch.batching.retryDelayMs': {
    type: 'number',
    required: false,
    default: 1000,
    validation: (value: number) => value >= 100 && value <= 60000,
    description: 'CloudWatch retry delay in milliseconds (100-60000)',
  },

  // Health Check Configuration
  'healthCheck.memoryThresholdMB': {
    type: 'number',
    required: false,
    default: 1024,
    validation: (value: number) => value > 0 && value <= 32768,
    description: 'Memory threshold in MB (1-32768)',
  },
  'healthCheck.eventLoopLagThresholdMS': {
    type: 'number',
    required: false,
    default: 100,
    validation: (value: number) => value > 0 && value <= 10000,
    description: 'Event loop lag threshold in milliseconds (1-10000)',
  },
  'healthCheck.maxActiveSessions': {
    type: 'number',
    required: false,
    default: 100,
    validation: (value: number) => value > 0 && value <= 10000,
    description: 'Maximum active sessions (1-10000)',
  },
  'healthCheck.staleSessionTimeoutMS': {
    type: 'number',
    required: false,
    default: 1800000,
    validation: (value: number) => value > 0,
    description: 'Stale session timeout in milliseconds',
  },

  // Environment Configuration
  'environment.nodeEnv': {
    type: 'string',
    required: false,
    default: 'development',
    validation: (value: string) => ['development', 'test', 'staging', 'production'].includes(value),
    description: 'Node.js environment (development, test, staging, production)',
  },
  'environment.serviceName': {
    type: 'string',
    required: false,
    default: 'twilio-bedrock-bridge',
    validation: (value: string) => value.length > 0,
    description: 'Service name identifier',
  },
  'environment.serviceVersion': {
    type: 'string',
    required: false,
    default: '0.1.0',
    validation: (value: string) => /^\d+\.\d+\.\d+/.test(value),
    description: 'Service version (semantic versioning)',
  },

  // Inference Configuration
  'inference.maxTokens': {
    type: 'number',
    required: false,
    default: 1024,
    validation: (value: number) => value > 0 && value <= 100000,
    description: 'Maximum tokens for inference (1-100000)',
  },
  'inference.topP': {
    type: 'number',
    required: false,
    default: 0.9,
    validation: (value: number) => value > 0 && value <= 1,
    description: 'Top-p sampling parameter (0.0-1.0)',
  },
  'inference.temperature': {
    type: 'number',
    required: false,
    default: 0.7,
    validation: (value: number) => value >= 0 && value <= 2,
    description: 'Temperature parameter (0.0-2.0)',
  },
};

/**
 * Get all required configuration keys
 */
export function getRequiredConfigKeys(): string[] {
  return Object.entries(CONFIG_SCHEMA)
    .filter(([, schema]) => schema.required)
    .map(([key]) => key);
}

/**
 * Get configuration key by environment variable name
 */
export function getConfigKeyFromEnvVar(envVar: string): string | undefined {
  const envVarMappings: Record<string, string> = {
    'PORT': 'server.port',
    'HOST': 'server.host',
    'AWS_REGION': 'aws.region',
    'AWS_PROFILE_NAME': 'aws.profileName',
    'BEDROCK_REGION': 'bedrock.region',
    'BEDROCK_MODEL_ID': 'bedrock.modelId',
    'TWILIO_AUTH_TOKEN': 'twilio.authToken',
    'TWILIO_ACCOUNT_SID': 'twilio.accountSid',
    'PUBLIC_WS_HOST': 'twilio.publicWsHost',
    'FORCE_WS_PROTO': 'twilio.forceWsProto',
    'LOG_LEVEL': 'logging.level',
    'NODE_ENV': 'environment.nodeEnv',
    'OTEL_SERVICE_NAME': 'environment.serviceName',
    'OTEL_SERVICE_VERSION': 'environment.serviceVersion',
    'MAX_TOKENS': 'inference.maxTokens',
    'TOP_P': 'inference.topP',
    'TEMPERATURE': 'inference.temperature',
    'ENABLE_XRAY': 'tracing.enableXRay',
    'CLOUDWATCH_ENABLED': 'cloudWatch.enabled',
  };

  return envVarMappings[envVar];
}