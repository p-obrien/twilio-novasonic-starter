// Initialize tracing FIRST - before any other imports
import { initializeTracing, shutdownTracing } from './observability/tracing';
initializeTracing();

// CloudWatch batching is automatically initialized via singleton pattern
// See: src/observability/cloudWatchBatcher.ts

import express from 'express';
import http from 'http';

import { Buffer } from 'node:buffer';
import { safeTrace } from './observability/safeTracing';
import { smartSampler } from './observability/smartSampling';

import { WebhookHandler, WebhookRequest } from './handlers/WebhookHandler';
import { HealthHandler } from './handlers/HealthHandler';
import logger from './utils/logger';
import { initWebsocketServer } from './handlers/WebsocketHandler';
import { webSocketSecurity } from './security/WebSocketSecurity';
import { correlationMiddleware } from './utils/correlationId';


// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);



// Capture raw body for webhook validation
const saveRawBody = (req: any, _res: any, buf: Buffer) => {
  if (buf && buf.length) req.rawBody = buf;
};

// Add correlation ID middleware for all requests (temporarily disabled for health check debugging)
// app.use(correlationMiddleware());

app.use('/webhook', express.json({ type: ['application/json', 'application/*+json'], verify: saveRawBody }));
app.use('/webhook', express.urlencoded({ extended: true, verify: saveRawBody }));


// WebSocket server for Twilio Media Streams (Twilio connects to /media)
initWebsocketServer(server);

// Webhook and health endpoints
app.post('/webhook', (req: any, res: any) => {
  const tracer = safeTrace.getTracer('twilio-bedrock-bridge');

  // Use smart sampling for webhook requests with safe tracing
  const span = safeTrace.isAvailable() 
    ? smartSampler.startSpanWithSampling(tracer as any, 'webhook.handle', {
        attributes: {
          'http.method': req.method,
          'http.url': req.url,
          'twilio.call_sid': req.body?.CallSid,
          'twilio.account_sid': req.body?.AccountSid,
        },
        callSid: req.body?.CallSid
      })
    : tracer.startSpan('webhook.handle'); // Fallback span

  try {
    logger.info('Received Twilio webhook', {
      callSid: req.body?.CallSid,
      accountSid: req.body?.AccountSid
    });
    WebhookHandler.handle(req as WebhookRequest, res);
    span.setStatus({ code: 1 }); // OK
  } catch (error) {
    span.setStatus({ code: 2, message: (error as Error).message }); // ERROR
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
});

// Kubernetes health check endpoints
app.get('/health/readiness', HealthHandler.getReadiness);
app.get('/health/liveness', HealthHandler.getLiveness);
app.get('/health', HealthHandler.getReadiness); // General health endpoint


// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  const forceExitTimer = setTimeout(() => {
    logger.error('Forcing shutdown due to timeout');
    process.exit(1);
  }, 10000);

  try {
    // Close HTTP server
    await new Promise(resolve => server.close(resolve));

    // Shutdown observability resources
    const { bedrockObservability } = await import('./observability/bedrockObservability');
    const { WebSocketMetrics } = await import('./observability/websocketMetrics');
    const { SessionMetrics } = await import('./observability/sessionMetrics');
    const { cloudWatchBatcher } = await import('./observability/cloudWatchBatcher');

    bedrockObservability.shutdown();
    WebSocketMetrics.cleanup();
    SessionMetrics.shutdown();

    // Shutdown CloudWatch batcher (flush remaining metrics)
    await cloudWatchBatcher.shutdown();

    // Shutdown tracing
    await shutdownTracing();

    clearTimeout(forceExitTimer);
    logger.info('Server shut down gracefully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
