/**
 * WebSocket server for Twilio Media Streams.
 *
 * REFACTORED VERSION using Handler Pattern.
 *
 * This module initializes the WebSocket server and routes Twilio messages
 * to appropriate handler classes for processing.
 *
 * Key improvements in this refactored version:
 * - Message handling logic extracted into dedicated handler classes
 * - Each handler is independently testable
 * - Clear separation of concerns
 * - Named functions in stack traces for better debugging
 * - Easier to extend with new message types
 */

// Node.js built-ins
import http, { IncomingMessage } from 'http';

// External packages
import { WebSocketServer } from 'ws';

// Internal modules - client
import { NovaSonicBidirectionalStreamClient } from '../client';

// Internal modules - config
import { configManager } from '../config/ConfigurationManager';

// Internal modules - observability
import logger from '../observability/logger';
import { SessionMetrics } from '../observability/sessionMetrics';
import { WebSocketMetrics } from '../observability/websocketMetrics';

// Internal modules - security
import { webSocketSecurity } from '../security/WebSocketSecurity';

// Internal modules - types
import { isTwilioMessage } from '../types/TypeGuards';
import { ExtendedWebSocket } from '../types/SharedTypes';

// Internal modules - utils
import { CorrelationIdManager } from '../utils/correlationId';
import { sanitizeInput } from '../utils/ValidationUtils';
import { extractErrorDetails } from '../errors/ClientErrors';

// Handler pattern imports
import { TwilioMessageHandler } from './TwilioMessageHandler';
import { MessageHandlerContext } from './handlers/BaseMessageHandler';
import { TwilioMessage } from './types/TwilioMessages';

/**
 * Maps exported for potential external use (kept for parity with original server implementation).
 * They are intentionally permissive in typing since the websocket `ws` object is used as a bag of fields.
 */
export const callSidToSessionId: Map<string, string> = new Map();
export const wsIdToSessionId: Map<string, string> = new Map();

// Enhanced Bedrock client with orchestrator capabilities
// Uses default AWS credential chain (IAM roles in ECS, profiles locally)
const bedrockClient = new NovaSonicBidirectionalStreamClient({
  clientConfig: {
    region: configManager.bedrock?.region || 'us-east-1'
    // credentials will use default credential chain
  },
  bedrock: {
    region: configManager.bedrock?.region || 'us-east-1',
    modelId: configManager.bedrock?.modelId || 'amazon.nova-2-sonic-v1:0'
  }
});

/**
 * Initialize WebSocket server and attach Twilio Media Streams handlers.
 *
 * This function:
 * 1. Creates a WebSocket server with security validation
 * 2. Sets up connection handlers
 * 3. Initializes the handler pattern for message processing
 *
 * @param server - HTTP server to attach WebSocket server to
 */
export function initWebsocketServer(server: http.Server, dependencies?: any): void {
  // Ignore dependencies parameter for now - keeping simple orchestrator-removal approach
  const wss = new WebSocketServer({
    server,
    path: '/media',
    perMessageDeflate: false, // Disable compression for real-time audio streaming
    verifyClient: (info: { req: http.IncomingMessage }) => {
      return verifyWebSocketConnection(info.req);
    }
  });

  // WebSocket connection handling
  wss.on('connection', (ws: ExtendedWebSocket, req: IncomingMessage) => {
    handleWebSocketConnection(ws, req);
  });

  logger.info('WebSocket server initialized on /media path');
}

/**
 * Verify WebSocket connection security.
 *
 * @param req - Incoming HTTP request
 * @returns True if connection is valid, false otherwise
 */
function verifyWebSocketConnection(req: http.IncomingMessage): boolean {
  // Log connection details for debugging
  logger.debug('WebSocket connection attempt', {
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: req.socket.remoteAddress,
    headers: Object.keys(req.headers)
  });

  const validation = webSocketSecurity.validateConnection(req);

  if (!validation.isValid) {
    logger.warn('WebSocket connection rejected', {
      reason: validation.reason,
      ip: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      url: req.url
    });
    return false;
  }

  logger.info('WebSocket connection validated and accepted', {
    callSid: validation.callSid,
    accountSid: validation.accountSid,
    ip: req.socket.remoteAddress,
    url: req.url
  });

  return true;
}

/**
 * Handle a new WebSocket connection.
 *
 * Sets up:
 * - Connection ID and correlation context
 * - Metrics tracking
 * - Message handler
 * - Event listeners (message, close, error)
 *
 * @param ws - The WebSocket connection
 * @param req - The HTTP request that initiated the connection
 */
function handleWebSocketConnection(ws: ExtendedWebSocket, req: IncomingMessage): void {
  const tempWsId = `twilio-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Create initial correlation context for WebSocket connection
  const wsCorrelationContext = CorrelationIdManager.createWebSocketContext({
    sessionId: tempWsId
  });

  // Run WebSocket handling within correlation context
  CorrelationIdManager.runWithContext(wsCorrelationContext, () => {
    setupWebSocketConnection(ws, req, tempWsId, wsCorrelationContext);
  });
}

/**
 * Setup WebSocket connection properties and event handlers.
 *
 * @param ws - The WebSocket connection
 * @param req - The HTTP request
 * @param sessionId - Unique session identifier
 * @param correlationContext - Correlation context for tracing
 */
function setupWebSocketConnection(
  ws: ExtendedWebSocket,
  req: IncomingMessage,
  sessionId: string,
  correlationContext: any
): void {
  logger.info('Secure Twilio WebSocket connected', {
    id: sessionId,
    ip: req.socket.remoteAddress
  });

  // Initialize WebSocket properties
  ws.id = sessionId;
  ws.correlationContext = correlationContext;
  ws._twilioInSeq = 0;
  ws._twilioOutSeq = 0;
  ws.twilioStreamSid = undefined;
  ws.twilioSampleRate = undefined;

  // Initialize metrics tracking
  WebSocketMetrics.onConnection(ws);
  SessionMetrics.createSession(sessionId, ws);

  // Create handler context
  const context: MessageHandlerContext = {
    ws,
    sessionId,
    bedrockClient,
    correlationContext
  };

  // Create message handler coordinator
  const messageHandler = new TwilioMessageHandler(context);

  // Setup event handlers
  ws.on('message', createMessageHandler(ws, messageHandler));
  ws.on('close', createCloseHandler(ws, sessionId, messageHandler));
  ws.on('error', createErrorHandler(ws, sessionId));
}

/**
 * Create message handler function for WebSocket 'message' events.
 *
 * This function returns a handler that:
 * 1. Parses the raw message
 * 2. Validates message structure
 * 3. Dispatches to appropriate handler via TwilioMessageHandler
 *
 * @param ws - The WebSocket connection
 * @param handler - The message handler coordinator
 * @returns Message event handler function
 */
function createMessageHandler(ws: ExtendedWebSocket, handler: TwilioMessageHandler) {
  return async (raw: Buffer | string) => {
    CorrelationIdManager.runWithContext(
      ws.correlationContext || {
        correlationId: 'unknown',
        source: 'websocket',
        timestamp: Date.now()
      },
      async () => {
        try {
          // Parse message
          const msg = JSON.parse(raw.toString());

          // Validate message structure
          if (!isTwilioMessage(msg)) {
            logger.warn('Invalid Twilio message structure', {
              client: ws.id,
              message: sanitizeInput(msg)
            });
            ws.close(1003, 'Invalid message structure');
            return;
          }

          logger.debug('Received Twilio media frame', {
            client: ws.id,
            event: msg.event,
            streamSid: msg.streamSid || ws.twilioStreamSid,
            seq: msg.sequenceNumber || null
          });

          // Dispatch message to appropriate handler
          await handler.dispatch(msg as TwilioMessage);
        } catch (parseError) {
          logger.warn('Failed to parse WebSocket message', {
            client: ws.id,
            error: extractErrorDetails(parseError),
            rawLength: raw.length
          });
          ws.close(1003, 'Invalid JSON message');
        }
      }
    );
  };
}

/**
 * Create close handler function for WebSocket 'close' events.
 *
 * Handles cleanup when WebSocket connection closes:
 * - Cleanup message handlers
 * - Cleanup session mappings
 * - Remove security session tracking
 * - End Bedrock session
 * - End metrics tracking
 *
 * @param ws - The WebSocket connection
 * @param sessionId - Session identifier
 * @param handler - The message handler coordinator
 * @returns Close event handler function
 */
function createCloseHandler(
  ws: ExtendedWebSocket,
  sessionId: string,
  handler: TwilioMessageHandler
) {
  return async (code: number, reason: string) => {
    CorrelationIdManager.runWithContext(
      ws.correlationContext || {
        correlationId: 'unknown',
        source: 'websocket',
        timestamp: Date.now()
      },
      async () => {
        logger.info('WebSocket closed', { sessionId, code, reason });

        // Cleanup handlers
        handler.cleanup();

        // Cleanup session resources
        cleanupSession(ws, sessionId);
      }
    );
  };
}

/**
 * Create error handler function for WebSocket 'error' events.
 *
 * @param ws - The WebSocket connection
 * @param sessionId - Session identifier
 * @returns Error event handler function
 */
function createErrorHandler(ws: ExtendedWebSocket, sessionId: string) {
  return (error: Error) => {
    CorrelationIdManager.runWithContext(
      ws.correlationContext || {
        correlationId: 'unknown',
        source: 'websocket',
        timestamp: Date.now()
      },
      () => {
        logger.error('WebSocket error', {
          sessionId,
          error: extractErrorDetails(error)
        });
      }
    );
  };
}

/**
 * Cleanup session resources when WebSocket closes.
 *
 * @param ws - The WebSocket connection
 * @param sessionId - Session identifier
 */
function cleanupSession(ws: ExtendedWebSocket, sessionId: string): void {
  // Clean up session mappings
  try {
    if (ws.id) {
      wsIdToSessionId.delete(ws.id);
    }
    if (ws.callSid) {
      callSidToSessionId.delete(ws.callSid);
    }
  } catch (e) {
    // Ignore cleanup errors
  }

  // Clean up security session tracking
  if (ws.callSid) {
    webSocketSecurity.removeActiveSession(ws.callSid);
    logger.debug('Removed active session from security tracking', { callSid: ws.callSid });
  }

  // Clean up Bedrock session
  if (sessionId && bedrockClient.isSessionActive(sessionId)) {
    try {
      bedrockClient.forceCloseSession(sessionId);
      logger.info('Ended Bedrock session', { sessionId });
    } catch (endErr) {
      logger.warn('Failed to end Bedrock session', { sessionId, err: endErr });
    }
  }

  // Clean up session metrics
  SessionMetrics.endSession(sessionId);

  // Clean up WebSocket metrics
  WebSocketMetrics.onDisconnection(ws);
}
