/**
 * Reusable Test Fixtures
 * 
 * Provides cached, reusable test data to improve test performance.
 * Expensive operations are computed once and reused across tests.
 * 
 * Requirements: 7.3
 */

import { Buffer } from 'node:buffer';
import { AudioTestUtils } from '../utils/AudioTestUtils';

/**
 * Cached audio fixtures for reuse across tests
 * These are computed once and reused to avoid expensive regeneration
 */
export class AudioFixtures {
  private static _sineWave440Hz: Buffer | null = null;
  private static _sineWave1000Hz: Buffer | null = null;
  private static _silence: Buffer | null = null;
  private static _whiteNoise: Buffer | null = null;
  private static _muLawBuffer: Buffer | null = null;
  private static _pcm16Buffer: Buffer | null = null;

  /**
   * Get a 440Hz sine wave (1 second at 8kHz)
   * Cached for reuse across tests
   */
  static get sineWave440Hz(): Buffer {
    if (!this._sineWave440Hz) {
      this._sineWave440Hz = AudioTestUtils.generateSineWave(440, 1000, 8000);
    }
    return this._sineWave440Hz;
  }

  /**
   * Get a 1000Hz sine wave (1 second at 8kHz)
   * Cached for reuse across tests
   */
  static get sineWave1000Hz(): Buffer {
    if (!this._sineWave1000Hz) {
      this._sineWave1000Hz = AudioTestUtils.generateSineWave(1000, 1000, 8000);
    }
    return this._sineWave1000Hz;
  }

  /**
   * Get silence buffer (1 second at 8kHz)
   * Cached for reuse across tests
   */
  static get silence(): Buffer {
    if (!this._silence) {
      this._silence = AudioTestUtils.generateSilence(1000, 8000);
    }
    return this._silence;
  }

  /**
   * Get white noise buffer (1 second at 8kHz)
   * Cached for reuse across tests
   */
  static get whiteNoise(): Buffer {
    if (!this._whiteNoise) {
      this._whiteNoise = AudioTestUtils.generateWhiteNoise(1000, 8000);
    }
    return this._whiteNoise;
  }

  /**
   * Get standard μ-law test buffer (160 bytes)
   * Cached for reuse across tests
   */
  static get muLawBuffer(): Buffer {
    if (!this._muLawBuffer) {
      this._muLawBuffer = AudioTestUtils.createMuLawBuffer(160);
    }
    return this._muLawBuffer;
  }

  /**
   * Get standard PCM16 test buffer (160 samples = 320 bytes)
   * Cached for reuse across tests
   */
  static get pcm16Buffer(): Buffer {
    if (!this._pcm16Buffer) {
      this._pcm16Buffer = AudioTestUtils.createPcm16Buffer(160);
    }
    return this._pcm16Buffer;
  }

  /**
   * Clear all cached fixtures
   * Call this if you need to reset fixtures during testing
   */
  static clearCache(): void {
    this._sineWave440Hz = null;
    this._sineWave1000Hz = null;
    this._silence = null;
    this._whiteNoise = null;
    this._muLawBuffer = null;
    this._pcm16Buffer = null;
  }
}

/**
 * Cached session fixtures for reuse across tests
 */
export class SessionFixtures {
  private static _mockWebSocket: any = null;
  private static _mockRequest: any = null;
  private static _mockResponse: any = null;

  /**
   * Get a standard mock WebSocket
   * Cached for reuse across tests
   */
  static get mockWebSocket(): any {
    if (!this._mockWebSocket) {
      this._mockWebSocket = {
        readyState: 1,
        twilioStreamSid: 'MZ' + '0'.repeat(32),
        _twilioOutSeq: 0,
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
        removeAllListeners: jest.fn()
      };
    }
    return this._mockWebSocket;
  }

  /**
   * Get a standard mock request
   * Cached for reuse across tests
   */
  static get mockRequest(): any {
    if (!this._mockRequest) {
      this._mockRequest = {
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
        query: {}
      };
    }
    return this._mockRequest;
  }

  /**
   * Get a standard mock response
   * Cached for reuse across tests
   */
  static get mockResponse(): any {
    if (!this._mockResponse) {
      this._mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis()
      };
    }
    return this._mockResponse;
  }

  /**
   * Clear all cached fixtures
   */
  static clearCache(): void {
    this._mockWebSocket = null;
    this._mockRequest = null;
    this._mockResponse = null;
  }

  /**
   * Reset mock function calls without clearing cache
   * Use this between tests to reset call counts
   */
  static resetMocks(): void {
    if (this._mockWebSocket) {
      jest.clearAllMocks();
    }
  }
}

/**
 * Standard test constants
 */
export const TestConstants = {
  CALL_SID: 'CA' + '0'.repeat(32),
  ACCOUNT_SID: 'AC' + '0'.repeat(32),
  STREAM_SID: 'MZ' + '0'.repeat(32),
  CORRELATION_ID: 'test-correlation-id',
  
  // Audio constants
  MULAW_CHUNK_SIZE: 160,
  PCM16_CHUNK_SIZE: 320,
  SAMPLE_RATE_8KHZ: 8000,
  SAMPLE_RATE_16KHZ: 16000,
  
  // Timing constants
  FRAME_DURATION_MS: 20,
  SILENCE_TIMEOUT_MS: 3000,
  SESSION_TIMEOUT_MS: 30000,
  
  // Test timeouts
  UNIT_TEST_TIMEOUT: 5000,
  INTEGRATION_TEST_TIMEOUT: 30000,
  PROPERTY_TEST_TIMEOUT: 10000
};

/**
 * Performance test utilities
 */
export class PerformanceFixtures {
  /**
   * Measure execution time of a function
   * Returns time in milliseconds
   */
  static async measureTime(fn: () => Promise<any> | any): Promise<number> {
    const start = Date.now();
    await fn();
    return Date.now() - start;
  }

  /**
   * Run a function multiple times and return statistics
   */
  static async benchmark(
    fn: () => Promise<any> | any,
    iterations: number = 100
  ): Promise<{
    min: number;
    max: number;
    average: number;
    median: number;
    total: number;
  }> {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const time = await this.measureTime(fn);
      times.push(time);
    }

    times.sort((a, b) => a - b);

    return {
      min: times[0],
      max: times[times.length - 1],
      average: times.reduce((sum, t) => sum + t, 0) / times.length,
      median: times[Math.floor(times.length / 2)],
      total: times.reduce((sum, t) => sum + t, 0)
    };
  }

  /**
   * Assert that a function completes within a time limit
   */
  static async assertPerformance(
    fn: () => Promise<any> | any,
    maxTimeMs: number,
    description: string = 'Operation'
  ): Promise<void> {
    const time = await this.measureTime(fn);
    
    if (time > maxTimeMs) {
      throw new Error(
        `${description} took ${time}ms, expected < ${maxTimeMs}ms`
      );
    }
  }
}
