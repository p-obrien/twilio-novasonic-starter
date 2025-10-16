/**
 * Test Environment Setup
 * 
 * Configures the testing environment with proper mocks and utilities
 * for audio processing tests.
 */

// Mock logger to prevent console spam during tests
jest.mock('../../observability/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Mock CloudWatch metrics to prevent AWS calls during tests
jest.mock('../../observability/cloudWatchMetrics', () => ({
  CloudWatchMetrics: {
    audioQuality: jest.fn(),
    recordMetric: jest.fn(),
    bedrockRequest: jest.fn(),
  },
}));

// Mock metrics utils to prevent OTEL calls during tests
jest.mock('../../observability/metrics', () => ({
  metricsUtils: {
    recordAudioProcessing: jest.fn(),
    recordCustomMetric: jest.fn(),
    recordBedrockRequest: jest.fn(),
    recordError: jest.fn(),
    recordConversationTurn: jest.fn(),
    recordResponseLatency: jest.fn(),
  },
  applicationMetrics: {
    bedrockRequestsTotal: {
      add: jest.fn(),
    },
    audioChunksProcessed: {
      add: jest.fn(),
    },
    bedrockTokensOutput: {
      add: jest.fn(),
    },
    bedrockTokensInput: {
      add: jest.fn(),
    },
    bedrockErrors: {
      add: jest.fn(),
    },
    bedrockRequestDuration: {
      record: jest.fn(),
    },
  },
}));

// Mock smart sampling to prevent tracing calls during tests
jest.mock('../../observability/smartSampling', () => ({
  smartSampler: {
    shouldSample: jest.fn().mockReturnValue({ shouldSample: false }),
    startSpanWithSampling: jest.fn().mockReturnValue({
      setAttributes: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
    }),
  },
}));

// Mock CloudWatch batcher
jest.mock('../../observability/cloudWatchBatcher', () => ({
  cloudWatchBatcher: {
    addMetrics: jest.fn(),
    getBatchSize: jest.fn().mockReturnValue(0),
  },
}));

// Set test environment
process.env.NODE_ENV = 'test';

// Global test utilities
const globalAny = global as any;

globalAny.createTestBuffer = (size: number, pattern?: number): Buffer => {
  const buffer = Buffer.alloc(size);
  if (pattern !== undefined) {
    buffer.fill(pattern);
  } else {
    // Fill with incrementing pattern for easier debugging
    for (let i = 0; i < size; i++) {
      buffer[i] = i % 256;
    }
  }
  return buffer;
};

globalAny.createMuLawTestBuffer = (size: number): Buffer => {
  const buffer = Buffer.alloc(size);
  // Fill with valid μ-law values (avoid 0x00 and 0xFF which are special)
  for (let i = 0; i < size; i++) {
    buffer[i] = 0x80 + (i % 127); // Valid μ-law range
  }
  return buffer;
};

globalAny.createPcm16TestBuffer = (samples: number): Buffer => {
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    // Create a sine wave pattern for realistic audio data
    const sample = Math.floor(Math.sin(i * 0.1) * 16000);
    buffer.writeInt16LE(sample, i * 2);
  }
  return buffer;
};

globalAny.createMockWebSocket = () => ({
  readyState: 1, // OPEN
  twilioStreamSid: 'test-stream-sid',
  _twilioOutSeq: 0,
  send: jest.fn(),
  on: jest.fn(),
});