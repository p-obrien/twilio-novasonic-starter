import express from 'express';
import twilio from 'twilio';
import { parse as parseQuery } from 'querystring';
import logger from '../observability/logger';
import { webSocketSecurity } from '../security/WebSocketSecurity';
import { CorrelationIdManager } from '../utils/correlationId';
import { validateTwilioWebhookPayload, sanitizeInput } from '../utils/ValidationUtils';
import { extractErrorDetails } from '../errors/ClientErrors';
import { isObject, isString } from '../types/TypeGuards';

export type WebhookRequest = express.Request & {
  rawBody?: Buffer | string;
};

/**
 * Logger interface for dependency injection
 */
export interface Logger {
  debug: (message: string, meta?: any) => void;
  info: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  error: (message: string, meta?: any) => void;
}

/**
 * Twilio validator interface for dependency injection
 */
export interface TwilioValidator {
  validateRequest: (
    authToken: string,
    signature: string,
    url: string,
    params: Record<string, any>
  ) => boolean;
}

/**
 * WebSocket security service interface for dependency injection
 */
export interface WebSocketSecurityService {
  addActiveSession: (callSid: string) => void;
  removeActiveSession: (callSid: string) => void;
  isSessionActive: (callSid: string) => boolean;
  validateConnection?: (req: any) => {
    isValid: boolean;
    callSid?: string;
    accountSid?: string;
    reason?: string;
  };
  validateWebSocketMessage?: (msg: any) => {
    isValid: boolean;
    callSid?: string;
    reason?: string;
  };
}

/**
 * Dependencies for WebhookHandler
 */
export interface WebhookHandlerDependencies {
  /** Twilio request validator */
  twilioValidator?: TwilioValidator;

  /** WebSocket security service */
  webSocketSecurity?: WebSocketSecurityService;

  /** Logger instance */
  logger?: Logger;

  /** Correlation manager */
  correlationManager?: typeof CorrelationIdManager;
}

/**
 * Create default dependencies for production use
 */
export function createDefaultWebhookDependencies(): Required<WebhookHandlerDependencies> {
  return {
    twilioValidator: twilio,
    webSocketSecurity,
    logger,
    correlationManager: CorrelationIdManager
  };
}

/** WebhookHandler: requires TWILIO_AUTH_TOKEN and validates Twilio signatures; rejects requests if not configured. */
export class WebhookHandler {
  private readonly twilioValidator: TwilioValidator;
  private readonly webSocketSecurity: WebSocketSecurityService;
  private readonly logger: Logger;
  private readonly correlationManager: typeof CorrelationIdManager;

  constructor(dependencies?: WebhookHandlerDependencies) {
    const defaults = createDefaultWebhookDependencies();
    this.twilioValidator = dependencies?.twilioValidator || defaults.twilioValidator;
    this.webSocketSecurity = dependencies?.webSocketSecurity || defaults.webSocketSecurity;
    this.logger = dependencies?.logger || defaults.logger;
    this.correlationManager = dependencies?.correlationManager || defaults.correlationManager;
  }

  public handle(req: WebhookRequest, res: express.Response): void {
    this.correlationManager.traceWithCorrelation('webhook.handle', () => {
      const correlationContext = this.correlationManager.getCurrentContext();
      this.logger.info('webhook.request.received', {
        path: req.originalUrl,
        ip: req.ip,
        correlationId: correlationContext?.correlationId,
        callSid: correlationContext?.callSid
      });

    // Require TWILIO_AUTH_TOKEN to be set — reject requests if it's missing.
    const rawAuth = process.env.TWILIO_AUTH_TOKEN;
    const authToken = rawAuth ? rawAuth.trim().replace(/^"(.*)"$/, '$1') : rawAuth;
    if (!authToken) {
      this.logger.error('webhook.missing_auth_token', { path: req.originalUrl, ip: req.ip });
      res.status(403).send('Twilio signature validation not configured');
      return;
    }


    const signature = String(req.headers['x-twilio-signature'] || '');
    const url = this.buildValidationUrl(req);

    const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    let bodyForValidation: string | Record<string, unknown>;
    if (req.rawBody && contentType === 'application/x-www-form-urlencoded') {
      bodyForValidation = parseQuery(req.rawBody.toString());
    } else if (req.rawBody) {
      bodyForValidation = req.rawBody.toString();
    } else {
      bodyForValidation = req.body || {};
    }

    // Perform signature validation using the injected validator
    // In tests, this will be a mock that can be controlled per-test
    try {
      const ok = this.twilioValidator.validateRequest(authToken, signature, url, bodyForValidation as Record<string, any>);
      if (!ok) {
        this.logger.warn('webhook.invalid_signature', { ip: req.ip, path: req.originalUrl });
        res.status(403).send('Invalid Twilio signature');
        return;
      }
    } catch (err) {
      this.logger.warn('webhook.signature_validation_error', { err });
      res.status(500).send('Signature validation error');
      return;
    }

    // Validate and extract CallSid from the request body
    try {
      const validatedPayload = validateTwilioWebhookPayload(
        bodyForValidation,
        'webhook_validation',
        this.correlationManager.getCurrentCorrelationId()
      );

      const callSid = validatedPayload.CallSid;
      // Register this call session as active for WebSocket validation
      this.webSocketSecurity.addActiveSession(callSid);
      this.logger.info('webhook.session.registered', { callSid });
    } catch (validationError) {
      this.logger.warn('webhook.validation_failed', {
        error: extractErrorDetails(validationError),
        body: sanitizeInput(bodyForValidation)
      });

      // Fallback to extract CallSid without validation for backward compatibility
      const callSid = isObject(bodyForValidation) && isString(bodyForValidation.CallSid)
        ? bodyForValidation.CallSid
        : undefined;

      if (callSid) {
        this.webSocketSecurity.addActiveSession(callSid);
        this.logger.info('webhook.session.registered_fallback', { callSid });
      } else {
        this.logger.warn('webhook.missing_callsid', { body: sanitizeInput(bodyForValidation) });
      }
    }

    const streamUrl = this.buildStreamUrl(req);
    const callSid = (req.body as any)?.CallSid;
    res.set('Content-Type', 'application/xml');
    res.send(this.generateTwiMLResponse(streamUrl));
    this.logger.info('webhook.twiML.sent', { streamUrl, callSid });
    }, { 'twilio.call_sid': (req.body as any)?.CallSid });
  }

  /**
   * Build WebSocket stream URL for TwiML response.
   *
   * Order of resolution:
   *  - ?wsUrl query parameter (most explicit)
   *  - process.env.PUBLIC_WS_HOST (useful in proxied/deployed environments)
   *  - x-forwarded headers or req.get('host')
   */
  private buildStreamUrl(req: express.Request): string {
    const qs = req.query as Record<string, any>;

    // 1) Query override
    if (qs && qs.wsUrl) {
      const raw = Array.isArray(qs.wsUrl) ? qs.wsUrl[0] : String(qs.wsUrl);
      return raw.endsWith('/media') ? raw : `${raw.replace(/\/+$/, '')}/media`;
    }

    // 2) Env override (PUBLIC_WS_HOST)
    const envHost = process.env.PUBLIC_WS_HOST;
    if (envHost) {
      const proto = (process.env.FORCE_WS_PROTO || 'wss') as string;
      return `${proto}://${envHost.replace(/\/+$/, '')}/media`;
    }

    // 3) Construct from request (supports proxies via x-forwarded-*)
    const forwardedProto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const forwardedHost = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:8080';
    const wsProto = (forwardedProto === 'https' || forwardedProto === 'wss') ? 'wss' : 'ws';

    return `${wsProto}://${forwardedHost}/media`;
  }

  /**
   * Build the full request URL (including query string) used when validating Twilio signatures.
   * This mirrors common reverse-proxy headers so validation works when the app is behind a load
   * balancer or proxy that sets x-forwarded-* headers.
   */
  private buildValidationUrl(req: express.Request): string {
    const proto = ((req.headers['x-forwarded-proto'] as string) || req.protocol || 'https').replace('wss', 'https');
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:8080';
    return `${proto}://${host}${req.originalUrl}`;
  }

  /**
   * Generate a compact TwiML response with a Stream element and parameters.
   */
  private generateTwiMLResponse(streamUrl: string): string {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const params = {
      sessionId,
      audioFormat: 'mulaw',
      sampleRate: '8000',
      encoding: 'base64',
      channels: '1',
      debugMode: 'true'
    };

    const paramsXml = Object.entries(params)
      .map(([k, v]) => `      <Parameter name="${k}" value="${v}" />`)
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting</Say>
  <Connect>
    <Stream url="${streamUrl}" track="inbound_track">
${paramsXml}
    </Stream>
  </Connect>
</Response>`;
  }
}