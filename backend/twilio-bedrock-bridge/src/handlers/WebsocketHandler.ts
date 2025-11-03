// Node.js built-ins
import http, { IncomingMessage } from 'http';

// External packages
import { WebSocketServer, WebSocket } from 'ws';

// Internal modules - audio
import { AudioBufferManager } from '../audio/AudioBufferManager';
import {
  processBedrockAudioOutput,
  processTwilioAudioInput
} from '../audio/AudioProcessor';

// Internal modules - client
import { NovaSonicBidirectionalStreamClient } from '../client';

// Internal modules - config
import { config } from '../config/AppConfig';

// Internal modules - errors
import { extractErrorDetails } from '../errors/ClientErrors';

// Internal modules - observability
import logger from '../observability/logger';
import { safeTrace } from '../observability/safeTracing';
import { SessionMetrics } from '../observability/sessionMetrics';
import { WebSocketMetrics } from '../observability/websocketMetrics';

// Internal modules - security
import { webSocketSecurity } from '../security/WebSocketSecurity';

// Internal modules - types
import { isTwilioMessage, isObject, isString } from '../types/TypeGuards';
import { ExtendedWebSocket } from '../types/SharedTypes';

// Internal modules - utils
import { setTimeoutWithCorrelation } from '../utils/asyncCorrelation';
import { DefaultAudioInputConfiguration, DefaultAudioOutputConfiguration, DefaultTextConfiguration, UltraLowLatencyConfig } from '../utils/constants';
import { CorrelationIdManager } from '../utils/correlationId';
import { sanitizeInput } from '../utils/ValidationUtils';

// Dependency injection types
import { WebSocketHandlerDependencies, createDefaultDependencies } from './WebsocketHandlerTypes';

/**
 * Maps exported for potential external use (kept for parity with original server implementation).
 * They are intentionally permissive in typing since the websocket `ws` object is used as a bag of fields.
 */
export const callSidToSessionId: Map<string, string> = new Map();
export const wsIdToSessionId: Map<string, string> = new Map();

/**
 * Initialize WebSocket server and attach Twilio Media Streams handlers.
 * This moves the WebSocket-related logic out of server.ts for better separation of concerns.
 * Includes comprehensive security validation for all incoming connections.
 *
 * @param server - HTTP server to attach WebSocket server to
 * @param dependencies - Optional dependencies for dependency injection (defaults to production instances)
 *
 * @example
 * // Production usage (uses defaults):
 * initWebsocketServer(server);
 *
 * @example
 * // Test usage with mocks:
 * initWebsocketServer(server, {
 *   bedrockClient: mockClient,
 *   security: mockSecurity,
 *   logger: mockLogger
 * });
 */
export function initWebsocketServer(
  server: http.Server,
  dependencies?: WebSocketHandlerDependencies
): void {
  // Merge provided dependencies with defaults
  const defaults = createDefaultDependencies();
  const deps = {
    bedrockClient: dependencies?.bedrockClient || defaults.bedrockClient,
    security: dependencies?.security || defaults.security,
    wsMetrics: dependencies?.wsMetrics || defaults.wsMetrics,
    sessionMetrics: dependencies?.sessionMetrics || defaults.sessionMetrics,
    audioBufferManager: dependencies?.audioBufferManager || defaults.audioBufferManager,
    audioProcessors: dependencies?.audioProcessors || defaults.audioProcessors,
    logger: dependencies?.logger || defaults.logger,
    correlationManager: dependencies?.correlationManager || defaults.correlationManager,
    smartSampler: dependencies?.smartSampler || defaults.smartSampler,
    tracingUtils: dependencies?.tracingUtils || defaults.tracingUtils
  };
  const wss = new WebSocketServer({ 
    server, 
    path: '/media',
    perMessageDeflate: false, // Disable compression for real-time audio streaming
    verifyClient: (info: { req: http.IncomingMessage }) => {
      // Log connection details for debugging
      deps.logger.debug('WebSocket connection attempt', {
        url: info.req.url,
        userAgent: info.req.headers['user-agent'],
        ip: info.req.socket.remoteAddress,
        headers: Object.keys(info.req.headers)
      });

      const validation = deps.security.validateConnection(info.req);

      if (!validation.isValid) {
        deps.logger.warn('WebSocket connection rejected', {
          reason: validation.reason,
          ip: info.req.socket.remoteAddress,
          userAgent: info.req.headers['user-agent'],
          url: info.req.url
        });
        return false;
      }

      deps.logger.info('WebSocket connection validated and accepted', {
        callSid: validation.callSid,
        accountSid: validation.accountSid,
        ip: info.req.socket.remoteAddress,
        url: info.req.url
      });

      return true;
    }
  });

  // WebSocket connection handling
  wss.on('connection', (ws: ExtendedWebSocket, req: IncomingMessage) => {
    const tempWsId = `twilio-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // Create initial correlation context for WebSocket connection
    const wsCorrelationContext = deps.correlationManager.createWebSocketContext({
      sessionId: tempWsId
    });
    
    // Run WebSocket handling within correlation context
    deps.correlationManager.runWithContext(wsCorrelationContext, () => {
      deps.logger.info('Secure Twilio WebSocket connected', { 
        id: tempWsId, 
        ip: req.socket.remoteAddress
      });

      ws.id = tempWsId;
      ws.correlationContext = wsCorrelationContext;
    
    // Initialize WebSocket metrics tracking
    deps.wsMetrics.onConnection(ws);
    
    // Initialize session tracking with temporary ID
    deps.sessionMetrics.createSession(tempWsId, ws);
    // CallSid and AccountSid will be set when we receive the 'start' message
    let sessionId: string = '';

    // Turn management variables
    let lastAudioTime = 0;
    let turnEndTimer: NodeJS.Timeout | null = null;
    let isUserTurnActive = false;
    const SILENCE_TIMEOUT_MS = 3000; // End turn after 3 seconds of silence (increased for better UX)

    // Ultra-low latency: eliminate input buffering - send immediately to Bedrock
    // No audio buffering - process and send each frame immediately

    // Cleanup function to prevent memory leaks
    const cleanupTimers = () => {
      if (turnEndTimer) {
        clearTimeout(turnEndTimer);
        turnEndTimer = null;
      }
      // No audio buffer timer needed - processing is immediate
    };

    // Ultra-low latency: send audio immediately to Bedrock (no buffering)
    const sendAudioImmediately = async (audioData: Buffer) => {
      const sessionId = ws.id;
      if (!sessionId || !deps.bedrockClient.isSessionActive(sessionId)) {
        deps.logger.debug('No active Bedrock session for immediate audio', { client: tempWsId, sessionId });
        return;
      }

      try {
        // Send audio chunk immediately to Bedrock (non-blocking)
        deps.bedrockClient.streamAudioChunk(sessionId, audioData).catch((streamErr) => {
          deps.logger.warn('Failed to forward immediate audio chunk to Bedrock', { client: tempWsId, sessionId, err: streamErr });
        });

        deps.logger.debug('Forwarded immediate audio chunk to Bedrock', {
          client: tempWsId,
          sessionId,
          bytes: audioData.length,
          latencyMode: 'immediate'
        });

      } catch (err) {
        deps.logger.warn('Error sending immediate audio', { client: tempWsId, err });
      }
    };

    // Function to end the current user turn (similar to harness pattern)
    const endCurrentUserTurn = () => {
      if (!isUserTurnActive || !sessionId || !deps.bedrockClient.isSessionActive(sessionId)) {
        deps.logger.debug('Skipping turn end - not active or no session', {
          isUserTurnActive,
          hasSessionId: !!sessionId,
          isSessionActive: sessionId ? deps.bedrockClient.isSessionActive(sessionId) : false
        });
        return;
      }

      try {
        deps.logger.info('Ending user turn due to silence timeout', { sessionId, client: tempWsId });

        // End audio content (step 8 in Nova Sonic flow)
        deps.bedrockClient.sendContentEnd(sessionId);
        deps.logger.info('Sent contentEnd for session', { sessionId });

        // Wait a brief moment then signal prompt end (step 9 in Nova Sonic flow)
        setTimeoutWithCorrelation(() => {
          if (deps.bedrockClient.isSessionActive(sessionId)) {
            deps.bedrockClient.sendPromptEnd(sessionId);
            deps.logger.info('Sent promptEnd for session - model should now respond', { sessionId });
          }
        }, 100);

        isUserTurnActive = false;
        deps.logger.debug('User turn ended, waiting for model response', { sessionId });

      } catch (endErr) {
        deps.logger.warn('Failed to end user turn', { sessionId, err: endErr });
      }
    };

    ws._twilioInSeq = 0;
    ws._twilioOutSeq = 0;
    ws.twilioStreamSid = undefined;
    ws.twilioSampleRate = undefined;

    ws.on('message', async (raw: Buffer | string) => {
      // Ensure we're running within the WebSocket's correlation context
      deps.correlationManager.runWithContext(ws.correlationContext || { correlationId: 'unknown', source: 'websocket', timestamp: Date.now() }, async () => {
        let msg: unknown;
        try {
          msg = JSON.parse(raw.toString());
        } catch (parseError) {
          deps.logger.warn('Failed to parse WebSocket message', { 
            client: tempWsId, 
            error: extractErrorDetails(parseError),
            rawLength: raw.length 
          });
          ws.close(1003, 'Invalid JSON message');
          return;
        }

        // Validate message structure
        if (!isTwilioMessage(msg)) {
          deps.logger.warn('Invalid Twilio message structure', { 
            client: tempWsId, 
            message: sanitizeInput(msg) 
          });
          ws.close(1003, 'Invalid message structure');
          return;
        }

        deps.logger.debug('Received Twilio media frame', { 
          client: tempWsId, 
          event: msg.event, 
          streamSid: isObject(msg.start) && isString(msg.start.streamSid) ? msg.start.streamSid : 
                    isString(msg.streamSid) ? msg.streamSid : 
                    ws.twilioStreamSid, 
          seq: msg.sequenceNumber || null 
        });

      switch (msg.event) {
        case 'connected':
          break;

        case 'start': {
          // Validate the start message contains valid CallSid and session is active
          const messageValidation = deps.security.validateWebSocketMessage(msg);
          if (!messageValidation.isValid) {
            deps.logger.warn('Invalid Twilio start message', {
              reason: messageValidation.reason,
              client: tempWsId,
              callSid: msg.start?.callSid
            });
            ws.close(1008, 'Invalid start message');
            return;
          }

          let streamSid = msg.start.streamSid;
          ws.twilioStreamSid = streamSid;
          ws.twilioSampleRate = Number(msg.start.sample_rate_hz || 8000);
          
          // Update the WebSocket with the validated CallSid
          if (messageValidation.callSid) {
            ws.callSid = messageValidation.callSid;
            
            // Update correlation context with CallSid information
            const updatedContext = deps.correlationManager.createWebSocketContext({
              callSid: messageValidation.callSid,
              streamSid: streamSid,
              sessionId: tempWsId,
              parentCorrelationId: ws.correlationContext?.correlationId
            });
            ws.correlationContext = updatedContext;
            deps.correlationManager.setContext(updatedContext);
            
            // Update session tracking with CallSid
            deps.sessionMetrics.endSession(tempWsId); // End temporary session
            deps.sessionMetrics.createSession(tempWsId, ws, messageValidation.callSid); // Create new session with CallSid
          }

          deps.logger.info('Twilio start event validated', { 
            streamSid: streamSid, 
            sampleRate: ws.twilioSampleRate,
            callSid: ws.callSid
          });

          // Ensure we have a Bedrock session for this websocket connection.
          // Use the websocket's assigned id as the session id so it's easy to correlate.
          if (ws.id) {
            sessionId = ws.id;
            // Record mapping for correlating websocket <-> bedrock session
            try {
              wsIdToSessionId.set(ws.id, sessionId);
            } catch (e) {
            deps.logger.debug('Failed to set wsIdToSessionId mapping', { wsId: ws.id, err: e });
          }
          try {
            if (!deps.bedrockClient.isSessionActive(sessionId)) {
              deps.logger.info('Creating and initiating Bedrock session for Twilio call', { sessionId });
              try {
                deps.logger.debug('Calling createStreamSession', { sessionId });
                deps.bedrockClient.createStreamSession(sessionId);
                deps.logger.info('createStreamSession completed', { sessionId });
                // Start the bidirectional stream in background; don't await since it runs until session end.
                deps.logger.debug('Starting initiateSession (background) for Bedrock', { sessionId, ts: Date.now() });
                deps.bedrockClient.initiateSession(sessionId).catch((e: unknown) => {
                    const errorDetails = extractErrorDetails(e);
                  deps.logger.error('Bedrock initiateSession failed (async)', { 
                    sessionId, 
                    ...errorDetails
                  });
                });
              } catch (createErr) {
                const errorDetails = extractErrorDetails(createErr);
                deps.logger.warn('Failed to create/initiate Bedrock session (sync)', { sessionId, ...errorDetails });
              }
            } else {
              deps.logger.debug('Bedrock session already active for sessionId', { sessionId });
            }

            // Tell the model we will start sending audio (use default audio input config)
            try {
              // Verify session is active before setting up events
              if (!deps.bedrockClient.isSessionActive(sessionId)) {
                deps.logger.error('Session is not active, cannot setup events', { sessionId });
                return;
              }

              // Diagnostic: log session info before sending prompt/content events to help debug ValidationException
              deps.logger.debug('Setting up session events', { sessionId });

              // Setup session events in the correct order: promptStart → systemPrompt → audioStart
              try {
                // CRITICAL: sessionStart MUST be the first event
                deps.bedrockClient.setupSessionStartEvent(sessionId);
                deps.logger.info('Queued sessionStart for Bedrock session', { sessionId });

                // First: enqueue promptStart to initialize the prompt
                deps.bedrockClient.setupPromptStartEvent(sessionId);
                deps.logger.info('Queued promptStart for Bedrock session', { sessionId });

                // Second: enqueue SYSTEM role text prompt (required as first content)
                const twilioSystemPrompt = 'You are a helpful voice assistant on a phone call. When you detect user speech, always respond with a clear, concise spoken acknowledgment or answer. Keep responses brief and conversational, as if speaking naturally on a phone call. Always respond when the user speaks to you.';
                deps.bedrockClient.setupSystemPromptEvent(sessionId, DefaultTextConfiguration, twilioSystemPrompt);
                deps.logger.info('Queued systemPrompt for Bedrock session', { sessionId });

                // Third: queue audio contentStart for user input
                deps.bedrockClient.setupStartAudioEvent(sessionId, DefaultAudioInputConfiguration);
                deps.logger.info('Queued audio contentStart for Bedrock session', { sessionId });
              } catch (setupErr) {
                deps.logger.error('Failed to setup Bedrock session events', { sessionId, error: setupErr, message: (setupErr as any)?.message });
              }
            } catch (audioStartErr) {
              deps.logger.error('Failed to queue audio contentStart for Bedrock session', { sessionId, error: audioStartErr, message: (audioStartErr as any)?.message });
            }

            // Register handler for when model response ends to prepare for next user turn
            deps.bedrockClient.registerEventHandler(sessionId, 'contentEnd', (data: unknown) => {
              const contentEnd = data as { role?: string; type?: string };
              // Check if this is the end of assistant audio content
              if (contentEnd?.role === 'ASSISTANT' && contentEnd?.type === 'AUDIO') {
                deps.logger.debug('Model finished speaking, ready for next user turn', { sessionId });
                
                // Flush any remaining audio in the buffer
                try {
                  const audioBufferManager = deps.audioBufferManager.getInstance();
                  const bufferStatus = audioBufferManager.getBufferStatus(sessionId);
                  if (bufferStatus && bufferStatus.bufferBytes > 0) {
                    deps.logger.debug('Flushing remaining audio buffer after model finished speaking', { 
                      sessionId, 
                      remainingBytes: bufferStatus.bufferBytes,
                      remainingMs: bufferStatus.bufferMs 
                    });
                  }
                } catch (e) {
                  deps.logger.warn('Failed to flush audio buffer after contentEnd', { sessionId, err: e });
                }
                
                // Reset turn state to allow new user input
                isUserTurnActive = false;
              }
            });

            // Register handler to forward Nova Sonic audioOutput events to Twilio using buffered streaming
            deps.bedrockClient.registerEventHandler(sessionId, 'audioOutput', (data: unknown) => {
              const audioOut = data as { audio?: string; sampleRateHz?: number; sample_rate_hz?: number };
              const timestamp = Date.now();
              deps.logger.debug('audioOutput handler invoked', { 
                sessionId, 
                timestamp,
                keys: Object.keys(audioOut || {}), 
                sampleRateHint: audioOut?.sampleRateHz ?? audioOut?.sample_rate_hz,
                defaultRate: DefaultAudioOutputConfiguration.sampleRateHertz
              });
              try {
                // Process audio output using the dedicated audio processor
                // Use the configured output sample rate (16kHz) as the default
                const muBuf = deps.audioProcessors.processBedrockAudioOutput(audioOut, DefaultAudioOutputConfiguration.sampleRateHertz || 16000, sessionId, ws.callSid);
                deps.logger.debug('Processed audioOutput to μ-law', { 
                  sessionId, 
                  muBytes: muBuf.length,
                  muDurationMs: Math.round((muBuf.length / 8000) * 1000),
                  timestamp
                });

                // Add audio to session buffer for proper timing
                const audioBufferManager = deps.audioBufferManager.getInstance();
                
                const audioRealDurationMs = Math.round((muBuf.length / 8000) * 1000);
                const timeSinceLastAudioMs = timestamp - (ws._lastAudioTimestamp || timestamp);
                ws._lastAudioTimestamp = timestamp;
                
                deps.logger.debug('Adding Nova Sonic audio to buffer with proper timing', {
                  sessionId,
                  audioBytes: muBuf.length,
                  audioRealDurationMs,
                  timeSinceLastAudioMs,
                  generationRate: audioRealDurationMs > 0 ? (timeSinceLastAudioMs / audioRealDurationMs).toFixed(2) + 'x' : 'unknown',
                  isFasterThanRealtime: timeSinceLastAudioMs < audioRealDurationMs,
                  mode: 'buffered_timing'
                });
                
                audioBufferManager.addAudio(sessionId, ws, muBuf);

              } catch (err) {
                deps.logger.warn('Failed to forward audioOutput to Twilio', { client: sessionId, err, inspected: (err as any)?.stack ?? null });
              }
            });

          } catch (err) {
            deps.logger.warn('Error ensuring Bedrock session for Twilio start', { err });
          }
          } // Close if (ws.id) block

          break;
        }

        case 'media': {
          const media = msg.media;
          const payloadB64 = media?.payload || media?.chunk || msg.payload;
          if (!media || !payloadB64) {
            deps.logger.warn('Missing media.payload from Twilio media frame', { client: tempWsId });
            return;
          }

          // Only forward inbound audio (Twilio may send inbound/outbound frames)
          const track = (media.track || '').toString().toLowerCase();
          const isInbound = track.includes('inbound') || track === 'inbound' || track === 'inbound_audio' || !track;
          if (!isInbound) {
            deps.logger.debug('Skipping non-inbound media frame', { client: tempWsId, track });
            return;
          }

          // Use smart sampling for high-volume media processing with safe tracing
          const tracer = safeTrace.getTracer('twilio-bedrock-bridge');
          const samplingDecision = deps.smartSampler.shouldSample({
            operationName: 'websocket.message.media',
            attributes: {
              'websocket.direction': 'inbound',
              'websocket.message_type': 'media',
              'media.track': track
            },
            sessionId: ws.id,
            callSid: ws.callSid
          });

          // Create span only if sampled and tracing is available
          const span = (samplingDecision.shouldSample && safeTrace.isAvailable()) ?
            deps.smartSampler.startSpanWithSampling(tracer as any, 'websocket.message.media', {
              attributes: {
                'websocket.direction': 'inbound',
                'websocket.message_type': 'media',
                'media.track': track
              },
              sessionId: ws.id,
              callSid: ws.callSid
            }) : tracer.startSpan('websocket.message.media'); // Fallback span

          try {

            const muLawBuf = Buffer.from(payloadB64, 'base64');
            // Process inbound audio using the dedicated audio processor
            const pcm16le_16k = deps.audioProcessors.processTwilioAudioInput(muLawBuf, ws.id || tempWsId, ws.callSid);
            
            deps.logger.debug('Processed inbound audio', {
              client: tempWsId,
              inputBytes: muLawBuf.length,
              outputBytes: pcm16le_16k.length,
              outputSamples: pcm16le_16k.length / 2,
              sampled: samplingDecision.shouldSample
            });

            if (span) {
              span.setAttributes({
                'audio.input_bytes': muLawBuf.length,
                'audio.output_bytes': pcm16le_16k.length,
                'audio.output_samples': pcm16le_16k.length / 2
              });
            }

            // Track audio activity for turn management
            lastAudioTime = Date.now();
            if (!isUserTurnActive) {
              isUserTurnActive = true;
              deps.logger.debug('User turn started', { sessionId: ws.id, client: tempWsId });
            }

            // Reset silence timer with correlation context
            if (turnEndTimer) {
              clearTimeout(turnEndTimer);
            }
            turnEndTimer = setTimeoutWithCorrelation(endCurrentUserTurn, SILENCE_TIMEOUT_MS);

            // Ultra-low latency: send audio immediately to Bedrock (no buffering)
            sendAudioImmediately(pcm16le_16k);

            // End span if it was created
            if (span) {
              span.end();
            }
          } catch (procErr) {
            deps.logger.warn('Error processing Twilio media frame', { client: tempWsId, err: procErr });
            // End span with error if it was created
            if (span) {
              span.recordException(procErr);
              span.setStatus({ code: 2, message: procErr instanceof Error ? procErr.message : String(procErr) });
              span.end();
            }
          }
          break;
        }

        case 'stop': {
          deps.logger.info('Received Twilio stop event', { client: tempWsId, streamSid: ws.twilioStreamSid });

          // Use centralized cleanup function
          cleanupTimers();

          // No buffered audio to flush - immediate processing mode

          // Flush and clean up audio buffer for outbound audio
          try {
            const audioBufferManager = deps.audioBufferManager.getInstance();
            audioBufferManager.flushAndRemove(sessionId);
          } catch (e) {
            deps.logger.warn('Failed to flush audio buffer on stop', { sessionId, err: e });
          }

          // End the current user turn properly before closing
          endCurrentUserTurn();

          try { ws.close(); } catch (e) { deps.logger.warn('Failed to close ws after stop', e); }
          break;
        }

        case 'mark':
          deps.logger.debug('Received Twilio mark event', { client: tempWsId, mark: msg.mark });
          break;
        case 'dtmf':
          deps.logger.debug('Received Twilio DTMF event', { client: tempWsId, dtmf: msg.dtmf });
          break;

        default:
          deps.logger.debug('Unknown Twilio event on /media', msg);
          break;
      }
      });
    });

    ws.on('close', async (code: number, reason: string) => {
      // Run close handler within correlation context
      deps.correlationManager.runWithContext(ws.correlationContext || { correlationId: 'unknown', source: 'websocket', timestamp: Date.now() }, async () => {
        const clientForLogs = sessionId ?? tempWsId;
        deps.logger.info('WebSocket closed', { client: clientForLogs, code, reason });

      // Use centralized cleanup function
      cleanupTimers();

      // No buffered audio to flush - immediate processing mode

      // Clean up session mappings
      try { 
        if (ws.id) {
          wsIdToSessionId.delete(ws.id);
        }
        if (ws.callSid) {
          callSidToSessionId.delete(ws.callSid);
        }
      } catch { }
      
      // Clean up security session tracking
      if (ws.callSid) {
        deps.security.removeActiveSession(ws.callSid);
        deps.logger.debug('Removed active session from security tracking', { callSid: ws.callSid });
      }

      // Clean up Bedrock session
      if (sessionId && deps.bedrockClient.isSessionActive(sessionId)) {
        try {
          deps.bedrockClient.forceCloseSession(sessionId);
          deps.logger.info('Ended Bedrock session', { sessionId });
        } catch (endErr) {
          deps.logger.warn('Failed to end Bedrock session', { sessionId, err: endErr });
        }
      }

      // Clean up session metrics
      try {
        deps.sessionMetrics.endSession(sessionId || tempWsId);
      } catch (metricsErr) {
        deps.logger.warn('Failed to end session metrics', { sessionId: sessionId || tempWsId, err: metricsErr });
      }

      // Clean up WebSocket metrics
      try {
        deps.wsMetrics.onDisconnection(ws);
      } catch (wsMetricsErr) {
        deps.logger.warn('Failed to cleanup WebSocket metrics', { err: wsMetricsErr });
      }
      });
    });

    ws.on('error', (error: Error) => {
      // Run error handler within correlation context
      deps.correlationManager.runWithContext(ws.correlationContext || { correlationId: 'unknown', source: 'websocket', timestamp: Date.now() }, () => {
        deps.logger.error('WebSocket error', { 
          client: sessionId || tempWsId, 
          error: extractErrorDetails(error) 
        });
      });
    });
    });
  });

  deps.logger.info('WebSocket server initialized on /media path');
}