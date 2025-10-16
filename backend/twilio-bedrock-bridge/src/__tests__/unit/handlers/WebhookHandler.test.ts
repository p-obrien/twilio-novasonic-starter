/**
 * Unit tests for WebhookHandler - Twilio webhook validation
 */

import express from 'express';
import twilio from 'twilio';
import { WebhookHandler, WebhookRequest } from '../../../handlers/WebhookHandler';
import logger from '../../../observability/logger';
import { webSocketSecurity } from '../../../security/WebSocketSecurity';
import { CorrelationIdManager } from '../../../utils/correlationId';
import * as ValidationUtils from '../../../utils/ValidationUtils';

// Mock dependencies
jest.mock('../../../observability/logger');
jest.mock('../../../security/WebSocketSecurity');
jest.mock('../../../utils/correlationId');
jest.mock('../../../utils/ValidationUtils');
jest.mock('twilio');

const mockLogger = logger as jest.Mocked<typeof logger>;
const mockWebSocketSecurity = webSocketSecurity as jest.Mocked<typeof webSocketSecurity>;
const mockCorrelationIdManager = CorrelationIdManager as jest.Mocked<typeof CorrelationIdManager>;
const mockValidationUtils = ValidationUtils as jest.Mocked<typeof ValidationUtils>;
const mockTwilio = twilio as jest.Mocked<typeof twilio>;

describe('WebhookHandler', () => {
  let mockRequest: Partial<WebhookRequest>;
  let mockResponse: Partial<express.Response>;
  let mockSend: jest.Mock;
  let mockStatus: jest.Mock;
  let mockSet: jest.Mock;

  const originalEnv = process.env;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
    
    // Create mock response
    mockSend = jest.fn().mockReturnThis();
    mockStatus = jest.fn().mockReturnThis();
    mockSet = jest.fn().mockReturnThis();
    
    mockResponse = {
      status: mockStatus,
      send: mockSend,
      set: mockSet,
    };

    // Default mock request
    mockRequest = {
      originalUrl: '/webhook',
      ip: '127.0.0.1',
      headers: {
        'x-twilio-signature': 'valid-signature',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: {
        CallSid: 'CA1234567890abcdef1234567890abcdef',
        From: '+1234567890',
        To: '+0987654321',
        CallStatus: 'in-progress'
      },
      rawBody: Buffer.from('CallSid=CA1234567890abcdef1234567890abcdef&From=%2B1234567890&To=%2B0987654321&CallStatus=in-progress'),
      get: jest.fn().mockReturnValue('localhost:3000'),
      query: {}
    } as any;

    // Mock CorrelationIdManager
    mockCorrelationIdManager.traceWithCorrelation.mockImplementation((name, fn) => fn());
    mockCorrelationIdManager.getCurrentContext.mockReturnValue({
      correlationId: 'test-correlation-id',
      callSid: 'CA1234567890abcdef1234567890abcdef',
      timestamp: Date.now(),
      source: 'webhook'
    });
    mockCorrelationIdManager.getCurrentCorrelationId.mockReturnValue('test-correlation-id');

    // Mock validation utils
    mockValidationUtils.validateTwilioWebhookPayload.mockReturnValue({
      CallSid: 'CA1234567890abcdef1234567890abcdef',
      From: '+1234567890',
      To: '+0987654321',
      CallStatus: 'in-progress'
    });
    mockValidationUtils.sanitizeInput.mockImplementation((input) => input);

    // Mock Twilio signature validation
    mockTwilio.validateRequest.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Authentication and Authorization', () => {
    it('should reject requests when TWILIO_AUTH_TOKEN is missing', () => {
      delete process.env.TWILIO_AUTH_TOKEN;

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockSend).toHaveBeenCalledWith('Twilio signature validation not configured');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'webhook.missing_auth_token',
        { path: '/webhook', ip: '127.0.0.1' }
      );
    });

    it('should reject requests when TWILIO_AUTH_TOKEN is empty string', () => {
      process.env.TWILIO_AUTH_TOKEN = '';

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockSend).toHaveBeenCalledWith('Twilio signature validation not configured');
    });

    it('should reject requests when TWILIO_AUTH_TOKEN is only whitespace', () => {
      process.env.TWILIO_AUTH_TOKEN = '   ';

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockSend).toHaveBeenCalledWith('Twilio signature validation not configured');
    });

    it('should handle quoted auth tokens correctly', () => {
      process.env.TWILIO_AUTH_TOKEN = '"test-auth-token"';

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
        'test-auth-token',
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      );
    });

    it('should handle unquoted auth tokens correctly', () => {
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
        'test-auth-token',
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('Signature Validation', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    });

    it('should validate Twilio signature successfully', () => {
      mockTwilio.validateRequest.mockReturnValue(true);

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
        'test-auth-token',
        'valid-signature',
        'https://localhost:3000/webhook',
        expect.any(Object)
      );
      expect(mockStatus).not.toHaveBeenCalledWith(403);
    });

    it('should reject requests with invalid signature', () => {
      mockTwilio.validateRequest.mockReturnValue(false);

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockSend).toHaveBeenCalledWith('Invalid Twilio signature');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'webhook.invalid_signature',
        { ip: '127.0.0.1', path: '/webhook' }
      );
    });

    it('should handle signature validation errors gracefully', () => {
      mockTwilio.validateRequest.mockImplementation(() => {
        throw new Error('Signature validation failed');
      });

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockSend).toHaveBeenCalledWith('Signature validation error');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'webhook.signature_validation_error',
        { err: expect.any(Error) }
      );
    });

    it('should skip signature validation in test environment', () => {
      process.env.NODE_ENV = 'test';
      mockTwilio.validateRequest.mockReturnValue(false); // Would normally fail

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockTwilio.validateRequest).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'webhook.signature_validation_skipped',
        { reason: 'test_environment', signature: 'present' }
      );
      expect(mockStatus).not.toHaveBeenCalledWith(403);
    });

    it('should skip signature validation when JEST_WORKER_ID is set', () => {
      process.env.JEST_WORKER_ID = '1';
      mockTwilio.validateRequest.mockReturnValue(false); // Would normally fail

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockTwilio.validateRequest).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'webhook.signature_validation_skipped',
        { reason: 'test_environment', signature: 'present' }
      );
    });

    it('should handle missing signature header', () => {
      mockRequest.headers!['x-twilio-signature'] = undefined;

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
        'test-auth-token',
        '',
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('Request Body Processing', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
      // Don't set NODE_ENV=test here so signature validation runs
    });

    it('should process form-encoded body correctly', () => {
      mockRequest.headers!['content-type'] = 'application/x-www-form-urlencoded';
      mockRequest.rawBody = Buffer.from('CallSid=CA123&From=%2B1234567890');

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        { CallSid: 'CA123', From: '+1234567890' }
      );
    });

    it('should process raw body as string for non-form content', () => {
      mockRequest.headers!['content-type'] = 'application/json';
      mockRequest.rawBody = Buffer.from('{"test": "data"}');

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        '{"test": "data"}'
      );
    });

    it('should fallback to req.body when rawBody is missing', () => {
      mockRequest.rawBody = undefined;
      mockRequest.body = { CallSid: 'CA123', From: '+1234567890' };

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        { CallSid: 'CA123', From: '+1234567890' }
      );
    });

    it('should handle content-type with charset', () => {
      mockRequest.headers!['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
      mockRequest.rawBody = Buffer.from('CallSid=CA123');

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      // Should still parse as form data
      expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        { CallSid: 'CA123' }
      );
    });
  });

  describe('Payload Validation and Session Management', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
      process.env.NODE_ENV = 'test';
    });

    it('should validate payload and register session successfully', () => {
      const validPayload = {
        CallSid: 'CA1234567890abcdef1234567890abcdef',
        From: '+1234567890',
        To: '+0987654321',
        CallStatus: 'in-progress'
      };
      mockValidationUtils.validateTwilioWebhookPayload.mockReturnValue(validPayload);

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockValidationUtils.validateTwilioWebhookPayload).toHaveBeenCalledWith(
        expect.any(Object),
        'webhook_validation',
        'test-correlation-id'
      );
      expect(mockWebSocketSecurity.addActiveSession).toHaveBeenCalledWith('CA1234567890abcdef1234567890abcdef');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'webhook.session.registered',
        { callSid: 'CA1234567890abcdef1234567890abcdef' }
      );
    });

    it('should handle validation errors with fallback session registration', () => {
      const validationError = new Error('Validation failed');
      mockValidationUtils.validateTwilioWebhookPayload.mockImplementation(() => {
        throw validationError;
      });
      mockRequest.body = { CallSid: 'CA1234567890abcdef1234567890abcdef' };

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'webhook.validation_failed',
        expect.objectContaining({
          error: expect.any(Object),
          body: expect.any(Object)
        })
      );
      expect(mockWebSocketSecurity.addActiveSession).toHaveBeenCalledWith('CA1234567890abcdef1234567890abcdef');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'webhook.session.registered_fallback',
        { callSid: 'CA1234567890abcdef1234567890abcdef' }
      );
    });

    it('should handle missing CallSid in fallback scenario', () => {
      mockValidationUtils.validateTwilioWebhookPayload.mockImplementation(() => {
        throw new Error('Validation failed');
      });
      
      // Clear previous mock calls
      jest.clearAllMocks();
      mockSend.mockReturnThis();
      mockStatus.mockReturnThis();
      mockSet.mockReturnThis();
      
      // Create a request without CallSid in both body and rawBody
      const requestWithoutCallSid = {
        ...mockRequest,
        body: { From: '+1234567890' }, // No CallSid
        rawBody: Buffer.from('From=%2B1234567890') // No CallSid in raw body either
      };

      WebhookHandler.handle(requestWithoutCallSid as WebhookRequest, mockResponse as express.Response);

      expect(mockWebSocketSecurity.addActiveSession).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'webhook.missing_callsid',
        { body: expect.any(Object) }
      );
    });

    it('should handle non-object body in fallback scenario', () => {
      mockValidationUtils.validateTwilioWebhookPayload.mockImplementation(() => {
        throw new Error('Validation failed');
      });
      
      // Clear previous mock calls
      jest.clearAllMocks();
      mockSend.mockReturnThis();
      mockStatus.mockReturnThis();
      mockSet.mockReturnThis();
      
      // Create a request with non-form content type and no CallSid
      const requestWithInvalidBody = {
        ...mockRequest,
        headers: {
          ...mockRequest.headers,
          'content-type': 'application/json' // Not form-encoded
        },
        body: { From: '+1234567890' }, // No CallSid
        rawBody: Buffer.from('{"From": "+1234567890"}') // JSON without CallSid
      };

      WebhookHandler.handle(requestWithInvalidBody as WebhookRequest, mockResponse as express.Response);

      expect(mockWebSocketSecurity.addActiveSession).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'webhook.missing_callsid',
        { body: '{"From": "+1234567890"}' }
      );
    });
  });

  describe('URL Building', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
      process.env.NODE_ENV = 'test';
    });

    describe('buildStreamUrl', () => {
      it('should use wsUrl query parameter when provided', () => {
        mockRequest.query = { wsUrl: 'wss://custom.example.com/stream' };

        WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

        const twimlResponse = mockSend.mock.calls[0][0];
        expect(twimlResponse).toContain('wss://custom.example.com/stream');
      });

      it('should append /media to wsUrl if not present', () => {
        mockRequest.query = { wsUrl: 'wss://custom.example.com' };

        WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

        const twimlResponse = mockSend.mock.calls[0][0];
        expect(twimlResponse).toContain('wss://custom.example.com/media');
      });

      it('should handle wsUrl with trailing slash', () => {
        mockRequest.query = { wsUrl: 'wss://custom.example.com/' };

        WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

        const twimlResponse = mockSend.mock.calls[0][0];
        expect(twimlResponse).toContain('wss://custom.example.com/media');
      });

      it('should handle array wsUrl parameter', () => {
        mockRequest.query = { wsUrl: ['wss://first.com', 'wss://second.com'] };

        WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

        const twimlResponse = mockSend.mock.calls[0][0];
        expect(twimlResponse).toContain('wss://first.com/media');
      });

      it('should use PUBLIC_WS_HOST environment variable', () => {
        process.env.PUBLIC_WS_HOST = 'production.example.com';
        mockRequest.query = {};

        WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

        const twimlResponse = mockSend.mock.calls[0][0];
        expect(twimlResponse).toContain('wss://production.example.com/media');
      });

      it('should use FORCE_WS_PROTO with PUBLIC_WS_HOST', () => {
        process.env.PUBLIC_WS_HOST = 'production.example.com';
        process.env.FORCE_WS_PROTO = 'ws';
        mockRequest.query = {};

        WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

        const twimlResponse = mockSend.mock.calls[0][0];
        expect(twimlResponse).toContain('ws://production.example.com/media');
      });

      it('should construct URL from request headers', () => {
        const mockReq = {
          ...mockRequest,
          protocol: 'https',
          get: jest.fn().mockReturnValue('example.com:443'),
          query: {}
        } as any;

        WebhookHandler.handle(mockReq, mockResponse as express.Response);

        const twimlResponse = mockSend.mock.calls[0][0];
        expect(twimlResponse).toContain('wss://example.com:443/media');
      });

      it('should use x-forwarded headers for proxied requests', () => {
        mockRequest.headers = {
          ...mockRequest.headers,
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'proxy.example.com'
        };
        mockRequest.query = {};

        WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

        const twimlResponse = mockSend.mock.calls[0][0];
        expect(twimlResponse).toContain('wss://proxy.example.com/media');
      });

      it('should use ws protocol for http requests', () => {
        const mockReq = {
          ...mockRequest,
          protocol: 'http',
          get: jest.fn().mockReturnValue('localhost:3000'),
          query: {}
        } as any;

        WebhookHandler.handle(mockReq, mockResponse as express.Response);

        const twimlResponse = mockSend.mock.calls[0][0];
        expect(twimlResponse).toContain('ws://localhost:3000/media');
      });
    });

    describe('buildValidationUrl', () => {
      beforeEach(() => {
        // Don't set NODE_ENV=test for these tests so signature validation runs
        delete process.env.NODE_ENV;
        delete process.env.JEST_WORKER_ID;
      });

      it('should build validation URL with x-forwarded headers', () => {
        mockRequest.headers = {
          ...mockRequest.headers,
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'proxy.example.com'
        };
        mockRequest.originalUrl = '/webhook?param=value';

        WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

        expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          'https://proxy.example.com/webhook?param=value',
          expect.any(Object)
        );
      });

      it('should convert wss protocol to https for validation', () => {
        mockRequest.headers = {
          ...mockRequest.headers,
          'x-forwarded-proto': 'wss'
        };
        mockRequest.get = jest.fn().mockReturnValue('example.com');

        WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

        expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          'https://example.com/webhook',
          expect.any(Object)
        );
      });

      it('should fallback to request properties when headers missing', () => {
        const mockReq = {
          ...mockRequest,
          protocol: 'https',
          get: jest.fn().mockReturnValue('localhost:3000')
        } as any;

        WebhookHandler.handle(mockReq, mockResponse as express.Response);

        expect(mockTwilio.validateRequest).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          'https://localhost:3000/webhook',
          expect.any(Object)
        );
      });
    });
  });

  describe('TwiML Response Generation', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
      process.env.NODE_ENV = 'test';
    });

    it('should generate valid TwiML response', () => {
      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockSet).toHaveBeenCalledWith('Content-Type', 'application/xml');
      
      const twimlResponse = mockSend.mock.calls[0][0];
      expect(twimlResponse).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twimlResponse).toContain('<Response>');
      expect(twimlResponse).toContain('<Say voice="alice">Connecting</Say>');
      expect(twimlResponse).toContain('<Connect>');
      expect(twimlResponse).toContain('<Stream url=');
      expect(twimlResponse).toContain('track="inbound_track"');
      expect(twimlResponse).toContain('</Stream>');
      expect(twimlResponse).toContain('</Connect>');
      expect(twimlResponse).toContain('</Response>');
    });

    it('should include required stream parameters', () => {
      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      const twimlResponse = mockSend.mock.calls[0][0];
      expect(twimlResponse).toContain('name="audioFormat" value="mulaw"');
      expect(twimlResponse).toContain('name="sampleRate" value="8000"');
      expect(twimlResponse).toContain('name="encoding" value="base64"');
      expect(twimlResponse).toContain('name="channels" value="1"');
      expect(twimlResponse).toContain('name="debugMode" value="true"');
    });

    it('should generate unique session ID', () => {
      // Mock Date.now and Math.random for predictable session IDs
      const mockNow = jest.spyOn(Date, 'now').mockReturnValue(1234567890);
      const mockRandom = jest.spyOn(Math, 'random').mockReturnValue(0.123456789);

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      const twimlResponse = mockSend.mock.calls[0][0];
      expect(twimlResponse).toContain('name="sessionId" value="session_1234567890_');

      mockNow.mockRestore();
      mockRandom.mockRestore();
    });

    it('should log TwiML response details', () => {
      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'webhook.twiML.sent',
        expect.objectContaining({
          streamUrl: expect.any(String),
          callSid: 'CA1234567890abcdef1234567890abcdef'
        })
      );
    });
  });

  describe('Logging and Observability', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
      process.env.NODE_ENV = 'test';
    });

    it('should log request received with correlation context', () => {
      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'webhook.request.received',
        {
          path: '/webhook',
          ip: '127.0.0.1',
          correlationId: 'test-correlation-id',
          callSid: 'CA1234567890abcdef1234567890abcdef'
        }
      );
    });

    it('should use correlation tracing', () => {
      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockCorrelationIdManager.traceWithCorrelation).toHaveBeenCalledWith(
        'webhook.handle',
        expect.any(Function),
        { 'twilio.call_sid': 'CA1234567890abcdef1234567890abcdef' }
      );
    });

    it('should handle missing correlation context gracefully', () => {
      mockCorrelationIdManager.getCurrentContext.mockReturnValue(undefined);

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'webhook.request.received',
        expect.objectContaining({
          correlationId: undefined,
          callSid: undefined
        })
      );
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    });

    it('should not proceed after authentication failure', () => {
      delete process.env.TWILIO_AUTH_TOKEN;

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockWebSocketSecurity.addActiveSession).not.toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should not proceed after signature validation failure', () => {
      mockTwilio.validateRequest.mockReturnValue(false);

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockWebSocketSecurity.addActiveSession).not.toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should not proceed after signature validation error', () => {
      mockTwilio.validateRequest.mockImplementation(() => {
        throw new Error('Validation error');
      });

      WebhookHandler.handle(mockRequest as WebhookRequest, mockResponse as express.Response);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockWebSocketSecurity.addActiveSession).not.toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    });
  });
});