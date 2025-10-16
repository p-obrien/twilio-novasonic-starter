// Node.js built-ins
import http, { IncomingMessage } from 'http';

<<<<<<< HEAD
import logger from '../utils/logger';
import { NovaSonicClient } from '../client/';
import { DefaultAudioInputConfiguration, DefaultAudioOutputConfiguration, DefaultTextConfiguration } from '../utils/constants';
import { CorrelationIdManager } from '../utils/correlationId';
import { setTimeoutWithCorrelation } from '../utils/asyncCorrelation';
import { config } from '../config/AppConfig';
=======
// External packages
import { WebSocketServer, WebSocket } from 'ws';

// Internal modules - audio
import { AudioBufferManager } from '../audio/AudioBufferManager';
>>>>>>> origin/main
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
import { smartSampler, TracingUtils } from '../observability/smartSampling';
<<<<<<< HEAD
import { safeTrace } from '../observability/safeTracing';
import { processDTMFCommand } from '../utils/orchestratorIntegration';
=======
import { WebSocketMetrics } from '../observability/websocketMetrics';

// Internal modules - security
import { webSocketSecurity } from '../security/WebSocketSecurity';

// Internal modules - types
import { isTwilioMessage, isObject, isString } from '../types/TypeGuards';
import { ExtendedWebSocket } from '../types/SharedTypes';

// Internal modules - utils
import { setTimeoutWithCorrelation } from '../utils/asyncCorrelation';
import { DefaultAudioInputConfiguration, DefaultAudioOutputConfiguration, DefaultTextConfiguration } from '../utils/constants';
import { CorrelationIdManager } from '../utils/correlationId';
import { sanitizeInput } from '../utils/ValidationUtils';
>>>>>>> origin/main

/**
 * Maps exported for potential external use (kept for parity with original server implementation).
 * They are intentionally permissive in typing since the websocket `ws` object is used as a bag of fields.
 */
export const callSidToSessionId: Map<string, string> = new Map();
export const wsIdToSessionId: Map<string, string> = new Map();

// Enhanced Bedrock client with orchestrator capabilities
// Uses default AWS credential chain (IAM roles in ECS, profiles locally)
const bedrockClient = new NovaSonicClient({
  clientConfig: { 
    region: config.bedrock?.region || 'us-east-1'
    // credentials will use default credential chain
  },
  bedrock: {
<<<<<<< HEAD
    region: config.bedrock.region,
    modelId: config.bedrock.modelId
  },
  // Enable orchestrator if integration is configured
  enableOrchestrator: config.integration.enabled,
  enableOrchestratorDebug: config.logging.level === 'DEBUG' || config.logging.level === 'TRACE'
=======
    region: config.bedrock?.region || 'us-east-1',
    modelId: config.bedrock?.modelId || 'amazon.nova-sonic-v1:0'
  }
>>>>>>> origin/main
});

/**
 * Process text input through the orchestrator (example usage)
 * This demonstrates how text-based interactions can be routed through
 * the knowledge base, agent, or conversation systems.
 * 
 * @param textInput The text input to process
 * @param sessionId The session identifier
 * @returns Promise resolving to the processed response
 */
async function processTextThroughOrchestrator(textInput: string, sessionId: string): Promise<string> {
  try {
    if (bedrockClient.isOrchestratorEnabled()) {
      logger.debug('Processing text through orchestrator', {
        sessionId,
        inputLength: textInput.length,
      });

      const result = await bedrockClient.processTextInput(textInput, sessionId);
      
      logger.info('Text processed successfully', {
        sessionId,
        source: result.source,
        responseLength: result.response.length,
      });

      return result.response;
    } else {
      logger.debug('Orchestrator not enabled, using fallback response', { sessionId });
      return 'I understand your message. The orchestrator integration is not currently enabled.';
    }
  } catch (error) {
    logger.error('Failed to process text through orchestrator', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'I apologize, but I encountered an issue processing your request.';
  }
}

/**
 * Initialize WebSocket server and attach Twilio Media Streams handlers.
 * This moves the WebSocket-related logic out of server.ts for better separation of concerns.
 * Includes comprehensive security validation for all incoming connections.
 */
export function initWebsocketServer(server: http.Server): void {
  const wss = new WebSocketServer({ 
    server, 
    path: '/media',
    perMessageDeflate: false, // Disable compression for real-time audio streaming
    verifyClient: (info: { req: http.IncomingMessage }) => {
      // Log connection details for debugging
      logger.debug('WebSocket connection attempt', {
        url: info.req.url,
        userAgent: info.req.headers['user-agent'],
        ip: info.req.socket.remoteAddress,
        headers: Object.keys(info.req.headers)
      });

      const validation = webSocketSecurity.validateConnection(info.req);
      
      if (!validation.isValid) {
        logger.warn('WebSocket connection rejected', {
          reason: validation.reason,
          ip: info.req.socket.remoteAddress,
          userAgent: info.req.headers['user-agent'],
          url: info.req.url
        });
        return false;
      }
      
      logger.info('WebSocket connection validated and accepted', {
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
    const wsCorrelationContext = CorrelationIdManager.createWebSocketContext({
      sessionId: tempWsId
    });
    
    // Run WebSocket handling within correlation context
    CorrelationIdManager.runWithContext(wsCorrelationContext, () => {
      logger.info('Secure Twilio WebSocket connected', { 
        id: tempWsId, 
        ip: req.socket.remoteAddress
      });

      ws.id = tempWsId;
      ws.correlationContext = wsCorrelationContext;
    
    // Initialize WebSocket metrics tracking
    WebSocketMetrics.onConnection(ws);
    
    // Initialize session tracking with temporary ID
    SessionMetrics.createSession(tempWsId, ws);
    // CallSid and AccountSid will be set when we receive the 'start' message
    let sessionId: string = '';

    // Turn management variables
    let lastAudioTime = 0;
    let turnEndTimer: NodeJS.Timeout | null = null;
    let isUserTurnActive = false;
    const SILENCE_TIMEOUT_MS = 3000; // End turn after 3 seconds of silence (increased for better UX)

    // Audio buffering for smoother streaming
    let audioBuffer: Buffer[] = [];
    let audioBufferTimer: NodeJS.Timeout | null = null;
    const AUDIO_BUFFER_MS = 100; // Buffer audio for 100ms before sending

    // Cleanup function to prevent memory leaks
    const cleanupTimers = () => {
      if (turnEndTimer) {
        clearTimeout(turnEndTimer);
        turnEndTimer = null;
      }
      if (audioBufferTimer) {
        clearTimeout(audioBufferTimer);
        audioBufferTimer = null;
      }
      // Clear audio buffer to prevent memory accumulation
      audioBuffer.length = 0;
    };



    // Function to flush buffered audio to Bedrock
    const flushAudioBuffer = async () => {
      if (audioBuffer.length === 0) return;

      const sessionId = ws.id;
      if (!sessionId || !bedrockClient.isSessionActive(sessionId)) {
        logger.debug('No active Bedrock session for buffered audio', { client: tempWsId, sessionId });
        audioBuffer = []; // Clear buffer
        return;
      }

      try {
        // Concatenate all buffered chunks for more efficient streaming
        const combinedBuffer = Buffer.concat(audioBuffer);
        audioBuffer = []; // Clear buffer immediately

        // Clear timer
        if (audioBufferTimer) {
          clearTimeout(audioBufferTimer);
          audioBufferTimer = null;
        }

        // Send combined buffer to Bedrock (non-blocking)
<<<<<<< HEAD
        bedrockClient.streamAudioChunk(sessionId, combinedBuffer).catch((streamErr: any) => {
          logger.warn('Failed to forward buffered audio chunk to Bedrock', { client: tempWsId, sessionId, err: streamErr });
        });
=======
        if (sessionId) {
          bedrockClient.streamAudioChunk(sessionId, combinedBuffer).catch((streamErr) => {
            logger.warn('Failed to forward buffered audio chunk to Bedrock', { client: tempWsId, sessionId, err: streamErr });
          });
        }
>>>>>>> origin/main

        logger.debug('Forwarded buffered audio chunk to Bedrock', {
          client: tempWsId,
          sessionId,
          bytes: combinedBuffer.length
        });

      } catch (err) {
        logger.warn('Error flushing audio buffer', { client: tempWsId, err });
        audioBuffer = []; // Clear buffer on error
      }
    };

    // Function to end the current user turn (similar to harness pattern)
    const endCurrentUserTurn = () => {
      if (!isUserTurnActive || !sessionId || !bedrockClient.isSessionActive(sessionId)) {
        logger.debug('Skipping turn end - not active or no session', {
          isUserTurnActive,
          hasSessionId: !!sessionId,
          isSessionActive: sessionId ? bedrockClient.isSessionActive(sessionId) : false
        });
        return;
      }

      try {
        logger.info('Ending user turn due to silence timeout', { sessionId, client: tempWsId });

        // End audio content (step 8 in Nova Sonic flow)
        bedrockClient.sendContentEnd(sessionId);
        logger.info('Sent contentEnd for session', { sessionId });

        // Wait a brief moment then signal prompt end (step 9 in Nova Sonic flow)
        setTimeoutWithCorrelation(() => {
          if (bedrockClient.isSessionActive(sessionId)) {
            bedrockClient.sendPromptEnd(sessionId);
            logger.info('Sent promptEnd for session - model should now respond', { sessionId });
          }
        }, 100);

        isUserTurnActive = false;
        logger.debug('User turn ended, waiting for model response', { sessionId });

      } catch (endErr) {
        logger.warn('Failed to end user turn', { sessionId, err: endErr });
      }
    };

    ws._twilioInSeq = 0;
    ws._twilioOutSeq = 0;
    ws.twilioStreamSid = undefined;
    ws.twilioSampleRate = undefined;


    ws.on('message', async (raw: Buffer | string) => {
      // Ensure we're running within the WebSocket's correlation context
      CorrelationIdManager.runWithContext(ws.correlationContext || { correlationId: 'unknown', source: 'websocket', timestamp: Date.now() }, async () => {
        let msg: unknown;
        try {
          msg = JSON.parse(raw.toString());
        } catch (parseError) {
          logger.warn('Failed to parse WebSocket message', { 
            client: tempWsId, 
            error: extractErrorDetails(parseError),
            rawLength: raw.length 
          });
          ws.close(1003, 'Invalid JSON message');
          return;
        }

        // Validate message structure
        if (!isTwilioMessage(msg)) {
          logger.warn('Invalid Twilio message structure', { 
            client: tempWsId, 
            message: sanitizeInput(msg) 
          });
          ws.close(1003, 'Invalid message structure');
          return;
        }

        logger.debug('Received Twilio media frame', { 
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
          const messageValidation = webSocketSecurity.validateWebSocketMessage(msg);
          if (!messageValidation.isValid) {
            logger.warn('Invalid Twilio start message', {
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
            const updatedContext = CorrelationIdManager.createWebSocketContext({
              callSid: messageValidation.callSid,
              streamSid: streamSid,
              sessionId: tempWsId,
              parentCorrelationId: ws.correlationContext?.correlationId
            });
            ws.correlationContext = updatedContext;
            CorrelationIdManager.setContext(updatedContext);
            
            // Update session tracking with CallSid
            SessionMetrics.endSession(tempWsId); // End temporary session
            SessionMetrics.createSession(tempWsId, ws, messageValidation.callSid); // Create new session with CallSid
          }

          logger.info('Twilio start event validated', { 
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
            logger.debug('Failed to set wsIdToSessionId mapping', { wsId: ws.id, err: e });
          }
          try {
            if (!bedrockClient.isSessionActive(sessionId)) {
              logger.info('Creating and initiating Bedrock session for Twilio call', { sessionId });
              try {
                logger.debug('Calling createStreamSession', { sessionId });
                bedrockClient.createStreamSession(sessionId);
                logger.info('createStreamSession completed', { sessionId });
                // Start the bidirectional stream in background; don't await since it runs until session end.
                logger.debug('Starting initiateSession (background) for Bedrock', { sessionId, ts: Date.now() });
                bedrockClient.initiateSession(sessionId).catch((e: unknown) => {
                    const errorDetails = extractErrorDetails(e);
                  logger.error('Bedrock initiateSession failed (async)', { 
                    sessionId, 
                    ...errorDetails
                  });
                });
              } catch (createErr) {
                const errorDetails = extractErrorDetails(createErr);
                logger.warn('Failed to create/initiate Bedrock session (sync)', { sessionId, ...errorDetails });
              }
            } else {
              logger.debug('Bedrock session already active for sessionId', { sessionId });
            }

            // Tell the model we will start sending audio (use default audio input config)
            try {
              // Verify session is active before setting up events
              if (!bedrockClient.isSessionActive(sessionId)) {
                logger.error('Session is not active, cannot setup events', { sessionId });
                return;
              }

              // Diagnostic: log session info before sending prompt/content events to help debug ValidationException
              logger.debug('Setting up session events', { sessionId });

              // Setup session events in the correct order: promptStart → systemPrompt → audioStart
              try {
                // CRITICAL: sessionStart MUST be the first event
                bedrockClient.setupSessionStartEvent(sessionId);
                logger.info('Queued sessionStart for Bedrock session', { sessionId });

                // First: enqueue promptStart to initialize the prompt
                bedrockClient.setupPromptStartEvent(sessionId);
                logger.info('Queued promptStart for Bedrock session', { sessionId });

                // Second: enqueue SYSTEM role text prompt (required as first content)
                const twilioSystemPrompt = 'You are a helpful voice assistant on a phone call. When you detect user speech, always respond with a clear, concise spoken acknowledgment or answer. Keep responses brief and conversational, as if speaking naturally on a phone call. Always respond when the user speaks to you.';
                bedrockClient.setupSystemPromptEvent(sessionId, DefaultTextConfiguration, twilioSystemPrompt);
                logger.info('Queued systemPrompt for Bedrock session', { sessionId });

                // Third: queue audio contentStart for user input
                bedrockClient.setupStartAudioEvent(sessionId, DefaultAudioInputConfiguration);
                logger.info('Queued audio contentStart for Bedrock session', { sessionId });
              } catch (setupErr) {
                logger.error('Failed to setup Bedrock session events', { sessionId, error: setupErr, message: (setupErr as any)?.message });
              }
            } catch (audioStartErr) {
              logger.error('Failed to queue audio contentStart for Bedrock session', { sessionId, error: audioStartErr, message: (audioStartErr as any)?.message });
            }

            // Register handler for when model response ends to prepare for next user turn
            bedrockClient.registerEventHandler(sessionId, 'contentEnd', (data: unknown) => {
              const contentEnd = data as { role?: string; type?: string };
              // Check if this is the end of assistant audio content
              if (contentEnd?.role === 'ASSISTANT' && contentEnd?.type === 'AUDIO') {
                logger.debug('Model finished speaking, ready for next user turn', { sessionId });
                
                // Flush any remaining audio in the buffer
                try {
                  const audioBufferManager = AudioBufferManager.getInstance();
                  const bufferStatus = audioBufferManager.getBufferStatus(sessionId);
                  if (bufferStatus && bufferStatus.bufferBytes > 0) {
                    logger.debug('Flushing remaining audio buffer after model finished speaking', { 
                      sessionId, 
                      remainingBytes: bufferStatus.bufferBytes,
                      remainingMs: bufferStatus.bufferMs 
                    });
                    // Note: We don't remove the buffer here, just flush remaining audio
                    // The buffer will continue to be available for the next response
                  }
                } catch (e) {
                  logger.warn('Failed to flush audio buffer after contentEnd', { sessionId, err: e });
                }
                
                // Reset turn state to allow new user input
                isUserTurnActive = false;
              }
            });

            // Register handler to forward Nova Sonic audioOutput events to Twilio using buffered streaming
            bedrockClient.registerEventHandler(sessionId, 'audioOutput', (data: unknown) => {
              const audioOut = data as { audio?: string; sampleRateHz?: number; sample_rate_hz?: number };
              const timestamp = Date.now();
              logger.debug('audioOutput handler invoked', { 
                sessionId, 
                timestamp,
                keys: Object.keys(audioOut || {}), 
                sampleRateHint: audioOut?.sampleRateHz ?? audioOut?.sample_rate_hz,
                defaultRate: DefaultAudioOutputConfiguration.sampleRateHertz
              });
              try {
                // Process audio output using the dedicated audio processor
                // Use the configured output sample rate (16kHz) as the default
                const muBuf = processBedrockAudioOutput(audioOut, DefaultAudioOutputConfiguration.sampleRateHertz || 16000, sessionId, ws.callSid);
                logger.debug('Processed audioOutput to μ-law', { 
                  sessionId, 
                  muBytes: muBuf.length,
                  muDurationMs: Math.round((muBuf.length / 8000) * 1000),
                  timestamp
                });

                // Add audio to session buffer for consistent frame timing
                const audioBufferManager = AudioBufferManager.getInstance();
                audioBufferManager.addAudio(sessionId, ws, muBuf);

              } catch (err) {
                logger.warn('Failed to forward audioOutput to Twilio', { client: sessionId, err, inspected: (err as any)?.stack ?? null });
              }
            });

          } catch (err) {
            logger.warn('Error ensuring Bedrock session for Twilio start', { err });
          }
          } // Close if (ws.id) block

          break;
        }

        case 'media': {
          const media = msg.media;
          const payloadB64 = media?.payload || media?.chunk || msg.payload;
          if (!media || !payloadB64) {
            logger.warn('Missing media.payload from Twilio media frame', { client: tempWsId });
            return;
          }

          // Only forward inbound audio (Twilio may send inbound/outbound frames)
          const track = (media.track || '').toString().toLowerCase();
          const isInbound = track.includes('inbound') || track === 'inbound' || track === 'inbound_audio' || !track;
          if (!isInbound) {
            logger.trace('Skipping non-inbound media frame', { client: tempWsId, track });
            return;
          }

          // Use smart sampling for high-volume media processing with safe tracing
          const tracer = safeTrace.getTracer('twilio-bedrock-bridge');
          const samplingDecision = smartSampler.shouldSample({
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
            smartSampler.startSpanWithSampling(tracer as any, 'websocket.message.media', {
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
            const pcm16le_16k = processTwilioAudioInput(muLawBuf, ws.id, ws.callSid);
            
            logger.debug('Processed inbound audio', {
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
              logger.debug('User turn started', { sessionId: ws.id, client: tempWsId });
            }

            // Reset silence timer with correlation context
            if (turnEndTimer) {
              clearTimeout(turnEndTimer);
            }
            turnEndTimer = setTimeoutWithCorrelation(endCurrentUserTurn, SILENCE_TIMEOUT_MS);

            // Buffer audio for smoother streaming to Bedrock
            audioBuffer.push(pcm16le_16k);

            // Clear existing timer and set new one
            if (audioBufferTimer) {
              clearTimeout(audioBufferTimer);
            }

            // Send buffered audio after a short delay or when buffer gets large
            const shouldFlushImmediately = audioBuffer.length >= 5; // Flush if we have 5+ chunks

            if (shouldFlushImmediately) {
              flushAudioBuffer();
            } else {
              audioBufferTimer = setTimeoutWithCorrelation(flushAudioBuffer, AUDIO_BUFFER_MS);
            }

            // End span if it was created
            if (span) {
              span.end();
            }
          } catch (procErr) {
            logger.warn('Error processing Twilio media frame', { client: tempWsId, err: procErr });
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
          logger.info('Received Twilio stop event', { client: tempWsId, streamSid: ws.twilioStreamSid });

          // Use centralized cleanup function
          cleanupTimers();

          // Flush any remaining audio before ending turn
          if (audioBuffer.length > 0) {
            flushAudioBuffer().catch(() => { });
          }

          // Flush and clean up audio buffer for outbound audio
          try {
            const audioBufferManager = AudioBufferManager.getInstance();
            audioBufferManager.flushAndRemove(sessionId);
          } catch (e) {
            logger.warn('Failed to flush audio buffer on stop', { sessionId, err: e });
          }

          // End the current user turn properly before closing
          endCurrentUserTurn();

          try { ws.close(); } catch (e) { logger.warn('Failed to close ws after stop', e); }
          break;
        }

        case 'mark':
          logger.debug('Received Twilio mark event', { client: tempWsId, mark: msg.mark });
          break;
        case 'dtmf':
          logger.debug('Received Twilio DTMF event', { client: tempWsId, dtmf: msg.dtmf });
          
          // Example: DTMF could trigger orchestrator-based text processing
          // This demonstrates how DTMF commands can be routed through the orchestrator
          if (msg.dtmf && bedrockClient.isOrchestratorEnabled()) {
            const dtmfDigit = msg.dtmf.digit;
            
            // Use the utility function to process DTMF commands
            processDTMFCommand(bedrockClient, dtmfDigit, sessionId)
              .then(response => {
                logger.info('DTMF command processed through orchestrator', { 
                  sessionId, 
                  dtmfDigit,
                  response: response.substring(0, 100) + (response.length > 100 ? '...' : '')
                });
                // In a real implementation, you might:
                // 1. Convert this response to speech using TTS
                // 2. Send it back through the WebSocket as audio
                // 3. Store it for later retrieval
                // 4. Trigger additional workflows based on the response
              })
              .catch(error => {
                logger.error('DTMF command processing failed', { sessionId, dtmfDigit, error });
              });
          }
          break;

        default:
          logger.debug('Unknown Twilio event on /media', msg);
          break;
      }
      });
    });

    ws.on('close', async (code: number, reason: string) => {
      // Run close handler within correlation context
      CorrelationIdManager.runWithContext(ws.correlationContext || { correlationId: 'unknown', source: 'websocket', timestamp: Date.now() }, async () => {
        const clientForLogs = sessionId ?? tempWsId;
        logger.info('WebSocket closed', { client: clientForLogs, code, reason });

      // Use centralized cleanup function
      cleanupTimers();

      // Flush any remaining audio before closing
      if (audioBuffer.length > 0) {
        flushAudioBuffer().catch(() => { }); // Best effort
      }

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
        webSocketSecurity.removeActiveSession(ws.callSid);
        logger.debug('Removed active session from security tracking', { callSid: ws.callSid });
      }
      
      // Clean up audio buffer for this session
      try {
        const audioBufferManager = AudioBufferManager.getInstance();
        audioBufferManager.flushAndRemove(sessionId);
      } catch (e) {
        logger.warn('Failed to clean up audio buffer on websocket close', { sessionId, err: e });
      }

      // Clean up WebSocket metrics tracking
      try {
        WebSocketMetrics.onDisconnection(ws);
      } catch (e) {
        logger.warn('Failed to clean up WebSocket metrics', { sessionId, err: e });
      }
      
      // Clean up session tracking
      try {
        SessionMetrics.endSession(sessionId || tempWsId);
      } catch (e) {
        logger.warn('Failed to clean up session tracking', { sessionId, err: e });
      }

      // Clean up Bedrock session associated with this websocket if present
      try {
        if (sessionId && bedrockClient.isSessionActive(sessionId)) {
          logger.debug('Forcing close of Bedrock session due to websocket close', { sessionId, wsId: ws.id, wsReadyState: ws.readyState });
          bedrockClient.forceCloseSession(sessionId);
          logger.info('Forced closed Bedrock session for websocket', { sessionId });
        } else {
          logger.debug('No active Bedrock session to force-close on websocket close', { sessionId });
        }
      } catch (e) {
        logger.warn('Failed to force close Bedrock session on websocket close', { sessionId, err: e, inspected: (e as any)?.stack ?? null });
      }

      // Remove all event listeners to prevent memory leaks
      try {
        ws.removeAllListeners?.();
      } catch (e) {
        logger.warn('Failed to remove WebSocket event listeners', { sessionId, err: e });
      }
      });
    });

    ws.on('error', (err: Error) => {
      CorrelationIdManager.runWithContext(ws.correlationContext || { correlationId: 'unknown', source: 'websocket', timestamp: Date.now() }, () => {
        logger.warn('WebSocket error', { client: tempWsId, err });
      });
    });

    });
  });
}
