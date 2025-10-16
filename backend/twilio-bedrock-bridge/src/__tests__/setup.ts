/**
 * Test Setup Configuration
 * 
 * This file configures the test environment and provides common utilities
 * for all test files.
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'ERROR';
process.env.AWS_REGION = 'us-east-1';
process.env.TWILIO_AUTH_TOKEN = 'test-auth-token-123456789abcdef';
process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-opentofu-kb-setup-123';
process.env.TWILIO_ACCOUNT_SID = 'AC' + '0'.repeat(32);
process.env.CLOUDWATCH_ENABLED = 'false'; // Disable CloudWatch in tests by default
process.env.ENABLE_XRAY = 'false'; // Disable X-Ray in tests

// Mock OpenTelemetry API to prevent initialization issues
jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: jest.fn(() => ({
      createCounter: jest.fn(() => ({ add: jest.fn() })),
      createUpDownCounter: jest.fn(() => ({ add: jest.fn() })),
      createHistogram: jest.fn(() => ({ record: jest.fn() })),
      createGauge: jest.fn(() => ({ record: jest.fn() })),
      createObservableGauge: jest.fn(() => ({ addCallback: jest.fn() }))
    }))
  },
  trace: {
    getTracer: jest.fn(() => ({
      startSpan: jest.fn(() => ({ 
        end: jest.fn(),
        setAttributes: jest.fn(),
        setStatus: jest.fn(),
        recordException: jest.fn()
      }))
    }))
  },
  SpanKind: {
    CLIENT: 1,
    SERVER: 2,
    PRODUCER: 3,
    CONSUMER: 4,
    INTERNAL: 5
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2
  }
}));

// Mock global.gc for memory tests
Object.defineProperty(global, 'gc', {
  value: jest.fn(),
  writable: true,
  configurable: true
});

// Mock console methods to reduce noise in tests
const originalConsole = { ...console };

beforeAll(() => {
  // Suppress console output during tests unless explicitly needed
  console.log = jest.fn();
  console.info = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  // Restore console methods
  Object.assign(console, originalConsole);
});

// Global test utilities
global.createMockWebSocket = () => ({
  readyState: 1,
  twilioStreamSid: 'MZ' + '0'.repeat(32),
  _twilioOutSeq: 0,
  send: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
  removeAllListeners: jest.fn()
});

global.createMockRequest = (overrides = {}) => ({
  headers: {
    'x-twilio-signature': 'valid-signature',
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': 'Twilio.TmeWs/1.0'
  },
  originalUrl: '/webhook',
  protocol: 'https',
  get: jest.fn().mockReturnValue('example.com'),
  ip: '127.0.0.1',
  rawBody: Buffer.from('CallSid=CA' + '0'.repeat(32) + '&AccountSid=AC' + '0'.repeat(32)),
  body: {
    CallSid: 'CA' + '0'.repeat(32),
    AccountSid: 'AC' + '0'.repeat(32)
  },
  query: {},
  ...overrides
});

global.createMockResponse = () => ({
  status: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis()
});

// Common test data
global.TEST_CALL_SID = 'CA' + '0'.repeat(32);
global.TEST_ACCOUNT_SID = 'AC' + '0'.repeat(32);
global.TEST_STREAM_SID = 'MZ' + '0'.repeat(32);

// Audio test data generators
global.generateTestAudio = (length: number = 320, frequency: number = 440, sampleRate: number = 8000) => {
  const buffer = Buffer.alloc(length);
  for (let i = 0; i < length; i += 2) {
    const sample = Math.sin(2 * Math.PI * frequency * (i / 2) / sampleRate) * 16000;
    buffer.writeInt16LE(sample, i);
  }
  return buffer;
};

global.generateSilentAudio = (length: number = 320) => {
  return Buffer.alloc(length, 0);
};

global.generateNoisyAudio = (length: number = 320) => {
  const buffer = Buffer.alloc(length);
  for (let i = 0; i < length; i += 2) {
    const noise = (Math.random() - 0.5) * 32767;
    buffer.writeInt16LE(noise, i);
  }
  return buffer;
};

// Async test utilities
global.waitFor = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

global.waitForCondition = async (condition: () => boolean, timeout: number = 5000, interval: number = 100) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return true;
    }
    await global.waitFor(interval);
  }
  throw new Error(`Condition not met within ${timeout}ms`);
};

// Mock cleanup utilities
global.clearAllMocks = () => {
  jest.clearAllMocks();
  jest.clearAllTimers();
};

// Error testing utilities
global.expectToThrowAsync = async (asyncFn: () => Promise<any>, expectedError?: string | RegExp): Promise<Error> => {
  try {
    await asyncFn();
    throw new Error('Expected function to throw, but it did not');
  } catch (error) {
    const err = error as Error;
    if (expectedError) {
      if (typeof expectedError === 'string') {
        expect(err.message).toContain(expectedError);
      } else {
        expect(err.message).toMatch(expectedError);
      }
    }
    return err;
  }
};

// Performance testing utilities
global.measurePerformance = async (fn: () => Promise<any> | any, iterations: number = 1) => {
  const times: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await fn();
    const end = Date.now();
    times.push(end - start);
  }
  
  return {
    min: Math.min(...times),
    max: Math.max(...times),
    average: times.reduce((sum, time) => sum + time, 0) / times.length,
    total: times.reduce((sum, time) => sum + time, 0),
    times
  };
};

// Memory testing utilities
global.getMemoryUsage = () => {
  const usage = process.memoryUsage();
  return {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
    rss: Math.round(usage.rss / 1024 / 1024), // MB
    external: Math.round(usage.external / 1024 / 1024) // MB
  };
};

// Extend Jest matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(min: number, max: number): R;
      toBeValidUUID(): R;
      toBeValidCallSid(): R;
      toBeValidStreamSid(): R;
    }
  }
  
  var createMockWebSocket: () => any;
  var createMockRequest: (overrides?: any) => any;
  var createMockResponse: () => any;
  var TEST_CALL_SID: string;
  var TEST_ACCOUNT_SID: string;
  var TEST_STREAM_SID: string;
  var generateTestAudio: (length?: number, frequency?: number, sampleRate?: number) => Buffer;
  var generateSilentAudio: (length?: number) => Buffer;
  var generateNoisyAudio: (length?: number) => Buffer;
  var waitFor: (ms: number) => Promise<void>;
  var waitForCondition: (condition: () => boolean, timeout?: number, interval?: number) => Promise<boolean>;
  var clearAllMocks: () => void;
  var expectToThrowAsync: (asyncFn: () => Promise<any>, expectedError?: string | RegExp) => Promise<Error>;
  var measurePerformance: (fn: () => Promise<any> | any, iterations?: number) => Promise<{
    min: number;
    max: number;
    average: number;
    total: number;
    times: number[];
  }>;
  var getMemoryUsage: () => {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
}

// Custom Jest matchers
expect.extend({
  toBeWithinRange(received: number, min: number, max: number) {
    const pass = received >= min && received <= max;
    return {
      message: () => `expected ${received} to be within range ${min}-${max}`,
      pass
    };
  },
  
  toBeValidUUID(received: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);
    return {
      message: () => `expected ${received} to be a valid UUID`,
      pass
    };
  },
  
  toBeValidCallSid(received: string) {
    const callSidRegex = /^CA[0-9a-f]{32}$/i;
    const pass = callSidRegex.test(received);
    return {
      message: () => `expected ${received} to be a valid Twilio CallSid`,
      pass
    };
  },
  
  toBeValidStreamSid(received: string) {
    const streamSidRegex = /^MZ[0-9a-f]{32}$/i;
    const pass = streamSidRegex.test(received);
    return {
      message: () => `expected ${received} to be a valid Twilio StreamSid`,
      pass
    };
  }
});

export {};