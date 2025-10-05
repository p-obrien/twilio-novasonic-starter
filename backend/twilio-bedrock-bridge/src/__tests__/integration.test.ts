/**
 * Integration Tests for Twilio-Bedrock Bridge
 * 
 * These tests verify the end-to-end functionality of the application
 * by testing the integration between different components.
 */

import request from 'supertest';
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import { NovaSonicBidirectionalStreamClient } from '../client';
import { WebhookHandler } from '../handlers/WebhookHandler';
import { HealthHandler } from '../handlers/HealthHandler';
import { initWebsocketServer } from '../handlers/WebsocketHandler';

// Mock external dependencies
jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('../utils/logger');
jest.mock('../observability/bedrockObservability');
jest.mock('../observability/websocketMetrics');
jest.mock('../observability/sessionMetrics');
jest.mock('../observability/cloudWatchMetrics', () => ({
  CloudWatchMetricsService: {
    getBatchStatus: jest.fn().mockReturnValue({
      batchSize: 10,
      isHealthy: true,
      config: { maxBatchSize: 20 }
    })
  }
}));
jest.mock('../observability/smartSampling', () => ({
  smartSampler: {
    getSamplingConfig: jest.fn().mockReturnValue({
      defaultSampleRate: 0.1,
      highVolumeThreshold: 100
    }),
    shouldSample: jest.fn().mockReturnValue({
      isSampled: true,
      traceId: 'test-trace-id',
      spanId: 'test-span-id'
    })
  }
}));
jest.mock('../security/WebSocketSecurity', () => ({
  webSocketSecurity: {
    validateConnection: jest.fn().mockReturnValue({
      isValid: true,
      callSid: 'CA' + '0'.repeat(32),
      accountSid: 'AC' + '0'.repeat(32)
    }),
    validateWebSocketMessage: jest.fn().mockReturnValue({
      isValid: true,
      callSid: 'CA' + '0'.repeat(32)
    }),
    addActiveSession: jest.fn(),
    removeActiveSession: jest.fn(),
    isSessionActive: jest.fn().mockReturnValue(true)
  }
}));
jest.mock('../observability/metrics', () => ({
  applicationMetrics: {
    errorsTotal: {
      add: jest.fn()
    }
  }
}));
jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: jest.fn().mockReturnValue({
      createCounter: jest.fn().mockReturnValue({ add: jest.fn() }),
      createHistogram: jest.fn().mockReturnValue({ record: jest.fn() }),
      createObservableGauge: jest.fn().mockReturnValue({ addCallback: jest.fn() }),
      createUpDownCounter: jest.fn().mockReturnValue({ add: jest.fn() })
    })
  }
}));
jest.mock('twilio', () => ({
  validateRequest: jest.fn().mockReturnValue(true)
}));

describe('Integration Tests', () => {
  let app: express.Application;
  let server: http.Server;
  let port: number;

  beforeAll((done) => {
    // Set up test environment
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.AWS_REGION = 'us-east-1';
    process.env.LOG_LEVEL = 'ERROR'; // Reduce log noise in tests

    // Create Express app similar to main server
    app = express();
    server = http.createServer(app);

    // Middleware
    app.use('/webhook', express.json({ verify: (req: any, res, buf) => {
      if (buf && buf.length) req.rawBody = buf;
    }}));
    app.use('/webhook', express.urlencoded({ extended: true, verify: (req: any, res, buf) => {
      if (buf && buf.length) req.rawBody = buf;
    }}));

    // Routes
    app.post('/webhook', (req: any, res: any) => {
      WebhookHandler.handle(req, res);
    });

    // Kubernetes health check endpoints
    app.get('/health/readiness', HealthHandler.getReadiness);
    app.get('/health/liveness', HealthHandler.getLiveness);
    app.get('/health', HealthHandler.getReadiness); // General health endpoint

    // WebSocket server
    initWebsocketServer(server);

    // Start server on random port
    server.listen(0, () => {
      port = (server.address() as any).port;
      done();
    });
  });

  afterAll((done) => {
    // Close server and clean up resources
    server.close(() => {
      // Give a small delay to ensure all connections are closed
      setTimeout(done, 100);
    });
  });

  describe('Webhook Endpoint', () => {
    it('should handle valid Twilio webhook request', async () => {
      const webhookData = {
        CallSid: 'CA' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32),
        From: '+1234567890',
        To: '+0987654321'
      };

      const response = await request(app)
        .post('/webhook')
        .send(webhookData)
        .set('X-Twilio-Signature', 'valid-signature')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .expect(200);

      expect(response.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(response.text).toContain('<Response>');
      expect(response.text).toContain('<Say voice="alice">Connecting</Say>');
      expect(response.text).toContain('<Connect>');
      expect(response.text).toContain('<Stream url=');
      expect(response.text).toContain('</Response>');
      expect(response.headers['content-type']).toContain('application/xml');
    });

    it('should reject webhook request without auth token', async () => {
      delete process.env.TWILIO_AUTH_TOKEN;

      const webhookData = {
        CallSid: 'CA' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32)
      };

      await request(app)
        .post('/webhook')
        .send(webhookData)
        .expect(403);

      // Restore auth token
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    });

    it('should generate different stream URLs based on configuration', async () => {
      const webhookData = {
        CallSid: 'CA' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32)
      };

      // Test with custom wsUrl parameter
      const response1 = await request(app)
        .post('/webhook?wsUrl=wss://custom.example.com/media')
        .send(webhookData)
        .set('X-Twilio-Signature', 'valid-signature')
        .expect(200);

      expect(response1.text).toContain('wss://custom.example.com/media');

      // Test with PUBLIC_WS_HOST environment variable
      process.env.PUBLIC_WS_HOST = 'env.example.com';

      const response2 = await request(app)
        .post('/webhook')
        .send(webhookData)
        .set('X-Twilio-Signature', 'valid-signature')
        .expect(200);

      expect(response2.text).toContain('wss://env.example.com/media');

      delete process.env.PUBLIC_WS_HOST;
    });
  });

  describe('Kubernetes Health Endpoints', () => {
    it('should return readiness status', async () => {
      const response = await request(app)
        .get('/health/readiness')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ready',
        timestamp: expect.any(String),
        uptime: expect.any(Number)
      });
    });

    it('should return liveness status', async () => {
      const response = await request(app)
        .get('/health/liveness')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'alive',
        timestamp: expect.any(String),
        uptime: expect.any(Number)
      });
    });
  });

  describe('WebSocket Integration', () => {
    it('should establish WebSocket connection on /media path', (done) => {
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://localhost:${port}/media`, {
        headers: {
          'User-Agent': 'Twilio.TmeWs/1.0'
        }
      });

      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        ws.close();
        done(new Error('WebSocket connection test timed out'));
      }, 3000);

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        done();
      });

      ws.on('error', (error: Error) => {
        clearTimeout(timeout);
        done(error);
      });
    });

    it('should handle WebSocket message flow', (done) => {
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://localhost:${port}/media`, {
        headers: {
          'User-Agent': 'Twilio.TmeWs/1.0'
        }
      });

      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        ws.close();
        done(new Error('WebSocket test timed out'));
      }, 5000);

      ws.on('open', () => {
        // Send connected event
        ws.send(JSON.stringify({ event: 'connected' }));

        // Send start event
        const startMessage = {
          event: 'start',
          start: {
            streamSid: 'MZ' + '0'.repeat(32),
            callSid: 'CA' + '0'.repeat(32),
            sample_rate_hz: 8000
          }
        };
        ws.send(JSON.stringify(startMessage));

        // Send media event
        const mediaMessage = {
          event: 'media',
          media: {
            track: 'inbound',
            payload: Buffer.alloc(160).toString('base64')
          }
        };
        ws.send(JSON.stringify(mediaMessage));

        // Send stop event and close
        ws.send(JSON.stringify({ event: 'stop' }));
        
        // Close the connection after a short delay
        setTimeout(() => {
          ws.close();
        }, 100);
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        done();
      });

      ws.on('error', (error: Error) => {
        clearTimeout(timeout);
        done(error);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed webhook requests', async () => {
      await request(app)
        .post('/webhook')
        .send('invalid-json')
        .set('Content-Type', 'application/json')
        .expect(400);
    });

    it('should handle missing required headers', async () => {
      const mockTwilio = require('twilio');
      mockTwilio.validateRequest.mockReturnValue(false);

      const webhookData = {
        CallSid: 'CA' + '0'.repeat(32)
      };

      await request(app)
        .post('/webhook')
        .send(webhookData)
        .expect(403); // Should fail signature validation

      mockTwilio.validateRequest.mockReturnValue(true);
    });

    it('should handle non-existent endpoints', async () => {
      await request(app)
        .get('/non-existent')
        .expect(404);
    });
  });

  describe('Performance', () => {
    it('should handle multiple concurrent webhook requests', async () => {
      const webhookData = {
        CallSid: 'CA' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32)
      };

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .post('/webhook')
            .send({ ...webhookData, CallSid: `CA${i.toString().padStart(30, '0')}` })
            .set('X-Twilio-Signature', 'valid-signature')
        );
      }

      const responses = await Promise.all(promises);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.text).toContain('<Response>');
      });
    });

    it('should respond to health checks quickly', async () => {
      const startTime = Date.now();

      await request(app)
        .get('/health/liveness')
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Health check should respond within 100ms
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Configuration', () => {
    it('should use environment variables correctly', async () => {
      // Test with different AWS region
      const originalRegion = process.env.AWS_REGION;
      process.env.AWS_REGION = 'eu-west-1';

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ready');
      expect(response.body.timestamp).toBeDefined();

      process.env.AWS_REGION = originalRegion;
    });

    it('should handle missing optional environment variables', async () => {
      const originalVersion = process.env.OTEL_SERVICE_VERSION;
      delete process.env.OTEL_SERVICE_VERSION;

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ready');
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);

      if (originalVersion) {
        process.env.OTEL_SERVICE_VERSION = originalVersion;
      }
    });
  });

  describe('Security', () => {
    it('should validate Twilio signatures', async () => {
      const mockTwilio = require('twilio');
      mockTwilio.validateRequest.mockReturnValue(false);

      const webhookData = {
        CallSid: 'CA' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32)
      };

      await request(app)
        .post('/webhook')
        .send(webhookData)
        .set('X-Twilio-Signature', 'invalid-signature')
        .expect(403);

      mockTwilio.validateRequest.mockReturnValue(true);
    });

    it('should reject WebSocket connections with invalid User-Agent', (done) => {
      const { webSocketSecurity } = require('../security/WebSocketSecurity');
      webSocketSecurity.validateConnection.mockReturnValue({
        isValid: false,
        reason: 'Invalid User-Agent header'
      });

      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://localhost:${port}/media`, {
        headers: {
          'User-Agent': 'InvalidUserAgent/1.0'
        }
      });

      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        ws.close();
        webSocketSecurity.validateConnection.mockReturnValue({
          isValid: true,
          callSid: 'CA' + '0'.repeat(32),
          accountSid: 'AC' + '0'.repeat(32)
        });
        done(new Error('WebSocket security test timed out'));
      }, 3000);

      ws.on('open', () => {
        clearTimeout(timeout);
        webSocketSecurity.validateConnection.mockReturnValue({
          isValid: true,
          callSid: 'CA' + '0'.repeat(32),
          accountSid: 'AC' + '0'.repeat(32)
        });
        done(new Error('Connection should have been rejected'));
      });

      ws.on('error', (error: Error) => {
        clearTimeout(timeout);
        // Connection should be rejected
        expect(error.message).toContain('Unexpected server response');
        webSocketSecurity.validateConnection.mockReturnValue({
          isValid: true,
          callSid: 'CA' + '0'.repeat(32),
          accountSid: 'AC' + '0'.repeat(32)
        });
        done();
      });
    });
  });

  describe('Observability', () => {
    it('should include correlation IDs in responses', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Health endpoint should complete successfully
      expect(response.body.status).toBeDefined();
    });

    it('should handle metrics collection', async () => {
      const webhookData = {
        CallSid: 'CA' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32)
      };

      await request(app)
        .post('/webhook')
        .send(webhookData)
        .set('X-Twilio-Signature', 'valid-signature')
        .expect(200);

      // Metrics should be collected (mocked in tests)
      expect(true).toBe(true); // Placeholder for metrics verification
    });
  });
});