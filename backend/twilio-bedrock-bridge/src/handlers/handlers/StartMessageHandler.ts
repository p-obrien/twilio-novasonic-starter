/**
 * Handler for Twilio 'start' messages.
 *
 * Responsible for:
 * - Validating start message and CallSid
 * - Setting up WebSocket properties
 * - Creating and initializing Bedrock session
 * - Registering event handlers for Bedrock responses
 * - Queuing initial session events in correct order
 *
 * This is the most complex handler as it orchestrates the entire session initialization.
 */

import { BaseMessageHandler, MessageHandlerContext } from './BaseMessageHandler';
import { TwilioStartMessage } from '../types/TwilioMessages';
import { webSocketSecurity } from '../../security/WebSocketSecurity';
import { SessionMetrics } from '../../observability/sessionMetrics';
import { CorrelationIdManager } from '../../utils/correlationId';
import { AudioBufferManager } from '../../audio/AudioBufferManager';
import { processBedrockAudioOutput } from '../../audio/AudioProcessor';
import { extractErrorDetails, CircuitBreakerOpenError } from '../../errors/ClientErrors';
import { getBedrockCircuitBreaker } from '../../resilience';
import {
  DefaultAudioInputConfiguration,
  DefaultAudioOutputConfiguration,
  DefaultTextConfiguration
} from '../../utils/constants';
import { wsIdToSessionId } from '../WebsocketHandler';
import { configManager } from '../../config/ConfigurationManager';

/**
 * Handles Twilio 'start' events which initiate media stream sessions.
 */
export class StartMessageHandler extends BaseMessageHandler<TwilioStartMessage> {
  /**
   * Handle a Twilio start message.
   *
   * This performs the complete session initialization sequence:
   * 1. Validate the start message and CallSid
   * 2. Update WebSocket properties
   * 3. Create Bedrock session
   * 4. Setup session events in correct order
   * 5. Register event handlers for Bedrock responses
   *
   * @param message - The start message from Twilio
   */
  async handle(message: TwilioStartMessage): Promise<void> {
    // Step 1: Validate start message
    const validation = await this.validateStartMessage(message);
    if (!validation.isValid) {
      this.log('warn', 'Invalid Twilio start message', {
        reason: validation.reason,
        callSid: message.start?.callSid
      });
      this.ws.close(1008, 'Invalid start message');
      return;
    }

    // Step 2: Update WebSocket properties
    this.updateWebSocketProperties(message, validation.callSid);

    // Step 3: Create and initialize Bedrock session
    if (!this.ws.id) {
      this.log('error', 'WebSocket missing ID, cannot create session');
      return;
    }

    try {
      // Record mapping for correlating websocket <-> bedrock session
      wsIdToSessionId.set(this.ws.id, this.sessionId);
    } catch (e) {
      this.log('debug', 'Failed to set wsIdToSessionId mapping', { wsId: this.ws.id, err: e });
    }

    // Step 4: Create Bedrock session (without starting stream yet)
    // Events must be queued BEFORE the stream starts to ensure proper ordering
    await this.createBedrockSession();

    // Step 5: Queue all session events BEFORE stream starts
    // This ensures sessionStart, promptStart, systemPrompt, audioStart, and textInput('hi')
    // are all queued before the async iterator begins processing
    await this.setupSessionEventsAndHandlers();

    // Step 6: Start the bidirectional stream (events are already queued)
    // This is critical for speaks-first: the greeting trigger (textInput 'hi') must be
    // queued before the stream starts, so Nova Sonic processes it immediately
    await this.startBedrockStream();
  }

  /**
   * Validate the start message structure and security.
   *
   * @param message - The start message to validate
   * @returns Validation result with CallSid if valid
   */
  private async validateStartMessage(
    message: TwilioStartMessage
  ): Promise<{ isValid: boolean; reason?: string; callSid?: string }> {
    const validation = webSocketSecurity.validateWebSocketMessage(message);

    if (!validation.isValid) {
      return {
        isValid: false,
        reason: validation.reason
      };
    }

    return {
      isValid: true,
      callSid: validation.callSid
    };
  }

  /**
   * Update WebSocket properties with data from start message.
   *
   * @param message - The start message
   * @param callSid - Validated CallSid
   */
  private updateWebSocketProperties(message: TwilioStartMessage, callSid?: string): void {
    const streamSid = message.start.streamSid;
    this.ws.twilioStreamSid = streamSid;
    this.ws.twilioSampleRate = Number(message.start.sample_rate_hz || 8000);

    // Update with validated CallSid
    if (callSid) {
      this.ws.callSid = callSid;

      // Update correlation context with CallSid information
      const updatedContext = CorrelationIdManager.createWebSocketContext({
        callSid: callSid,
        streamSid: streamSid,
        sessionId: this.sessionId,
        parentCorrelationId: this.ws.correlationContext?.correlationId
      });
      this.ws.correlationContext = updatedContext;
      CorrelationIdManager.setContext(updatedContext);

      // Update session tracking with CallSid
      SessionMetrics.endSession(this.sessionId); // End temporary session
      SessionMetrics.createSession(this.sessionId, this.ws, callSid); // Create new session with CallSid
    }

    this.log('info', 'Twilio start event validated', {
      streamSid: streamSid,
      sampleRate: this.ws.twilioSampleRate,
      callSid: this.ws.callSid
    });
  }

  /**
   * Create the Bedrock session without starting the stream.
   * 
   * This separates session creation from stream initiation to allow
   * events to be queued BEFORE the stream starts processing them.
   * This is critical for the speaks-first greeting to work correctly.
   */
  private async createBedrockSession(): Promise<void> {
    if (this.isSessionActive()) {
      this.log('debug', 'Bedrock session already active for sessionId');
      return;
    }

    this.log('info', 'Creating Bedrock session for Twilio call');

    try {
      this.log('debug', 'Calling createStreamSession');
      this.bedrockClient.createStreamSession(this.sessionId);
      this.log('info', 'createStreamSession completed - session created, stream not yet started');
    } catch (createErr) {
      const errorDetails = extractErrorDetails(createErr);
      this.log('error', 'Failed to create Bedrock session', errorDetails);
      throw createErr;
    }
  }

  /**
   * Start the Bedrock bidirectional stream.
   * 
   * IMPORTANT: This should only be called AFTER all session events have been queued
   * via setupSessionEventsAndHandlers(). This ensures the async iterator processes
   * events in the correct order, which is critical for the speaks-first greeting.
   * 
   * Event order that must be queued before this is called:
   * 1. sessionStart
   * 2. promptStart
   * 3. systemPrompt (contentStart/textInput/contentEnd)
   * 4. audioContentStart (USER/AUDIO)
   * 5. textInput 'hi' (contentStart/textInput/contentEnd) - triggers greeting
   */
  private async startBedrockStream(): Promise<void> {
    this.log('debug', 'Starting initiateSession (background) for Bedrock - all events already queued', { ts: Date.now() });

    // Wrap initiateSession with circuit breaker for resilience
    const circuitBreaker = getBedrockCircuitBreaker();
    circuitBreaker
      .execute(() => this.bedrockClient.initiateSession(this.sessionId))
      .catch((e: unknown) => {
        const errorDetails = extractErrorDetails(e);

        // Handle circuit breaker open error specifically
        if (e instanceof CircuitBreakerOpenError) {
          this.log('warn', 'Bedrock circuit breaker is OPEN - closing WebSocket', {
            retryAfterMs: e.getRetryAfterMs(),
            retryAfterSeconds: e.getRetryAfterSeconds(),
            ...errorDetails
          });

          // Close WebSocket with 1013 (Try Again Later) status code
          // This tells Twilio that the service is temporarily unavailable
          this.ws.close(1013, 'Service temporarily unavailable - please try again later');
        } else {
          this.log('error', 'Bedrock initiateSession failed (async)', errorDetails);

          // Close WebSocket with 1011 (Internal Server Error) for other errors
          this.ws.close(1011, 'Internal server error');
        }
      });
  }

  /**
   * Validate and sanitize the greeting message.
   * 
   * Ensures the greeting message:
   * - Is not empty
   * - Does not exceed maximum length (500 characters)
   * - Is truncated with warning if too long
   * 
   * @param message - The greeting message to validate
   * @returns Validated and sanitized greeting message
   */
  private validateGreetingMessage(message: string): string {
    const MAX_GREETING_LENGTH = 500;
    
    // Check if message is empty or only whitespace
    if (!message || message.trim().length === 0) {
      const defaultMessage = 'Hello! How can I help you today?';
      this.log('warn', 'Greeting message is empty, using default', {
        defaultMessage,
        sessionId: this.sessionId
      });
      return defaultMessage;
    }
    
    // Check if message exceeds maximum length
    if (message.length > MAX_GREETING_LENGTH) {
      const truncatedMessage = message.substring(0, MAX_GREETING_LENGTH);
      this.log('warn', 'Greeting message too long, truncating', {
        originalLength: message.length,
        maxLength: MAX_GREETING_LENGTH,
        truncatedLength: truncatedMessage.length,
        sessionId: this.sessionId,
        originalMessage: message.substring(0, 100) + '...',
        truncatedMessage: truncatedMessage.substring(0, 100) + '...'
      });
      return truncatedMessage;
    }
    
    // Message is valid
    return message;
  }

  /**
   * Setup session events and register event handlers for Bedrock responses.
   *
   * CRITICAL: Events must be queued in exact order:
   * 1. sessionStart
   * 2. promptStart
   * 3. systemPrompt
   * 4. audioContentStart
   * 5. sendTextInput (triggers speaks-first greeting)
   */
  private async setupSessionEventsAndHandlers(): Promise<void> {
    const startTime = Date.now();
    this.log('info', '=== SPEAKS-FIRST DEBUG: Starting session setup ===', {
      sessionId: this.sessionId,
      timestamp: startTime
    });

    try {
      // Verify session is active before setting up events
      if (!this.isSessionActive()) {
        this.log('error', 'SPEAKS-FIRST DEBUG: Session is not active, cannot setup events');
        return;
      }

      this.log('debug', 'SPEAKS-FIRST DEBUG: Session is active, proceeding with setup');

      // CRITICAL: sessionStart MUST be the first event
      const t1 = Date.now();
      this.bedrockClient.setupSessionStartEvent(this.sessionId);
      this.log('info', 'SPEAKS-FIRST DEBUG: [1/5] Queued sessionStart for Bedrock session', {
        elapsedMs: Date.now() - t1,
        totalElapsedMs: Date.now() - startTime
      });

      // First: enqueue promptStart to initialize the prompt
      const t2 = Date.now();
      this.bedrockClient.setupPromptStartEvent(this.sessionId);
      this.log('info', 'SPEAKS-FIRST DEBUG: [2/5] Queued promptStart for Bedrock session', {
        elapsedMs: Date.now() - t2,
        totalElapsedMs: Date.now() - startTime
      });

      // Second: enqueue SYSTEM role text prompt (required as first content)
      // Generic conversational prompt without greeting-specific instructions
      const t3 = Date.now();
      const twilioSystemPrompt =
        `You are a helpful voice assistant on a phone call. ` +
        `Keep all responses brief and conversational, as if speaking naturally on a phone call. ` +
        `Be friendly, helpful, and respond naturally to whatever the caller says.`;
      this.bedrockClient.setupSystemPromptEvent(
        this.sessionId,
        DefaultTextConfiguration,
        twilioSystemPrompt
      );
      
      // Log system prompt content (truncated for readability)
      const truncatedPrompt = twilioSystemPrompt.length > 100 
        ? twilioSystemPrompt.substring(0, 100) + '...' 
        : twilioSystemPrompt;
      this.log('info', 'System prompt configured for session', {
        sessionId: this.sessionId,
        promptLength: twilioSystemPrompt.length,
        promptContent: truncatedPrompt,
        callSid: this.ws.callSid
      });
      
      this.log('info', 'SPEAKS-FIRST DEBUG: [3/5] Queued systemPrompt for Bedrock session', {
        promptLength: twilioSystemPrompt.length,
        elapsedMs: Date.now() - t3,
        totalElapsedMs: Date.now() - startTime
      });

      // Third: queue audio contentStart for user input
      const t4 = Date.now();
      this.bedrockClient.setupStartAudioEvent(this.sessionId, DefaultAudioInputConfiguration);
      this.log('info', 'SPEAKS-FIRST DEBUG: [4/5] Queued audio contentStart for Bedrock session', {
        audioConfig: {
          encoding: DefaultAudioInputConfiguration.encoding,
          sampleRateHertz: DefaultAudioInputConfiguration.sampleRateHertz
        },
        elapsedMs: Date.now() - t4,
        totalElapsedMs: Date.now() - startTime
      });

      // Fourth: trigger speaks-first by queueing initial text input BEFORE registering handlers
      // This makes Nova Sonic 2 generate an immediate greeting before user speaks
      // Use explicit greeting instruction instead of "hi" to avoid confusion with user input
      // CRITICAL: This must be queued BEFORE the session stream starts
      const t5 = Date.now();
      const rawGreetingMessage = configManager.conversation.greetingMessage;
      const greetingMessage = this.validateGreetingMessage(rawGreetingMessage);
      const triggerText = `Please say this greeting to the caller: "${greetingMessage}"`;
      
      // Log trigger text being queued (truncated for readability)
      const truncatedTrigger = triggerText.length > 150 
        ? triggerText.substring(0, 150) + '...' 
        : triggerText;
      this.log('info', 'Queueing speaks-first trigger text', {
        sessionId: this.sessionId,
        triggerLength: triggerText.length,
        triggerText: truncatedTrigger,
        greetingMessageLength: greetingMessage.length,
        callSid: this.ws.callSid
      });
      
      this.log('info', 'SPEAKS-FIRST DEBUG: [5/5] About to queue text input events to trigger greeting', {
        triggerText,
        greetingMessage,
        totalElapsedMs: Date.now() - startTime
      });
      
      // Record greeting start time for observability
      const sessionData = this.bedrockClient.getSessionData(this.sessionId);
      if (sessionData) {
        const greetingStartTime = Date.now();
        sessionData.greetingStartTime = greetingStartTime;
        
        this.log('info', 'Greeting delivery starting', {
          sessionId: this.sessionId,
          greetingStartTime,
          timestamp: new Date(greetingStartTime).toISOString(),
          callSid: this.ws.callSid
        });
      }
      
      // Queue the text input events directly (don't use sendTextInput which checks if session is active)
      this.bedrockClient.queueTextInputEvents(this.sessionId, triggerText);
      
      this.log('info', 'SPEAKS-FIRST DEBUG: [5/5] Text input events queued - greeting should be generated when stream starts', {
        triggerText,
        greetingMessage,
        elapsedMs: Date.now() - t5,
        totalElapsedMs: Date.now() - startTime
      });

      // Register event handlers AFTER queueing all events
      // This ensures we can capture the audioOutput events from the greeting
      this.log('info', 'SPEAKS-FIRST DEBUG: Registering event handlers after queueing all events');
      this.registerEventHandlers();
      this.log('info', 'SPEAKS-FIRST DEBUG: Event handlers registered successfully');

      // Verify event sequence
      this.verifyEventSequence();

      this.log('info', '=== SPEAKS-FIRST DEBUG: Session setup complete ===', {
        totalElapsedMs: Date.now() - startTime,
        sessionId: this.sessionId
      });

    } catch (setupErr) {
      this.log('error', 'SPEAKS-FIRST DEBUG: Failed to setup Bedrock session events', {
        error: setupErr,
        message: (setupErr as Error)?.message,
        stack: (setupErr as Error)?.stack,
        totalElapsedMs: Date.now() - startTime
      });
      return;
    }
  }

  /**
   * Verify that events are queued in the correct order for speaks-first
   */
  private verifyEventSequence(): void {
    try {
      const sessionData = this.bedrockClient.getSessionData(this.sessionId);
      if (!sessionData) {
        this.log('warn', 'SPEAKS-FIRST DEBUG: Cannot verify event sequence - session data not found');
        return;
      }

      const queue = sessionData.queue;
      this.log('info', 'SPEAKS-FIRST DEBUG: Verifying event sequence', {
        queueLength: queue.length,
        expectedMinimum: 8 // sessionStart, promptStart, 3x systemPrompt, audioContentStart, 3x textInput
      });

      // Extract event types from queue
      const eventTypes = queue.map((item: any) => {
        const eventKey = item?.event && Object.keys(item.event)[0];
        const event = item?.event?.[eventKey];
        
        if (eventKey === 'contentStart') {
          return `${eventKey}(${event?.role}/${event?.type})`;
        } else if (eventKey === 'textInput') {
          return `${eventKey}(${event?.content?.substring(0, 20) || 'empty'})`;
        }
        return eventKey;
      });

      this.log('info', 'SPEAKS-FIRST DEBUG: Event sequence in queue', {
        sequence: eventTypes,
        queueLength: queue.length
      });

      // Verify expected order
      const expectedSequence = [
        'sessionStart',
        'promptStart',
        'contentStart(SYSTEM/TEXT)',
        'textInput',
        'contentEnd',
        'contentStart(USER/AUDIO)',
        'contentStart(USER/TEXT)',
        'textInput',
        'contentEnd'
      ];

      let isValid = true;
      const issues: string[] = [];

      // Check if we have minimum required events
      if (queue.length < 8) {
        issues.push(`Queue has only ${queue.length} events, expected at least 8`);
        isValid = false;
      }

      // Check first few events match expected sequence
      for (let i = 0; i < Math.min(expectedSequence.length, eventTypes.length); i++) {
        if (!eventTypes[i].startsWith(expectedSequence[i].split('(')[0])) {
          issues.push(`Event ${i}: expected ${expectedSequence[i]}, got ${eventTypes[i]}`);
          isValid = false;
        }
      }

      if (isValid) {
        this.log('info', 'SPEAKS-FIRST DEBUG: ✓ Event sequence is valid');
      } else {
        this.log('warn', 'SPEAKS-FIRST DEBUG: ✗ Event sequence has issues', {
          issues,
          actualSequence: eventTypes
        });
      }
    } catch (err) {
      this.log('warn', 'SPEAKS-FIRST DEBUG: Error verifying event sequence', {
        error: (err as Error)?.message
      });
    }
  }

  /**
   * Register handlers for Bedrock response events.
   */
  private registerEventHandlers(): void {
    this.log('debug', 'SPEAKS-FIRST DEBUG: Registering contentEnd handler');
    
    // Register handler for when model response ends to prepare for next user turn
    this.bedrockClient.registerEventHandler(this.sessionId, 'contentEnd', (data: unknown) => {
      const contentEnd = data as { role?: string; type?: string };
      this.log('info', 'SPEAKS-FIRST DEBUG: contentEnd event received', {
        role: contentEnd?.role,
        type: contentEnd?.type,
        sessionId: this.sessionId
      });
      
      // Check if this is the end of assistant audio content
      if (contentEnd?.role === 'ASSISTANT' && contentEnd?.type === 'AUDIO') {
        this.log('info', 'SPEAKS-FIRST DEBUG: ===== MODEL FINISHED SPEAKING =====', {
          sessionId: this.sessionId,
          message: 'Greeting complete - session is now ready to receive user audio'
        });

        // Mark greeting as delivered for observability
        const sessionData = this.bedrockClient.getSessionData(this.sessionId);
        if (sessionData && !sessionData.greetingDelivered) {
          const now = Date.now();
          sessionData.greetingDelivered = true;
          sessionData.greetingEndTime = now;
          
          // Calculate greeting duration if start time was recorded
          const greetingDuration = sessionData.greetingStartTime 
            ? now - sessionData.greetingStartTime 
            : undefined;
          
          this.log('info', 'Greeting delivery complete - session ready for conversation', {
            sessionId: this.sessionId,
            greetingEndTime: now,
            greetingEndTimestamp: new Date(now).toISOString(),
            greetingDurationMs: greetingDuration,
            greetingDuration: greetingDuration ? `${greetingDuration}ms` : 'unknown',
            greetingStartTime: sessionData.greetingStartTime,
            callSid: this.ws.callSid
          });
        }

        // Verify session is still active and ready for user input
        this.log('info', 'SPEAKS-FIRST DEBUG: Session state after greeting', {
          sessionId: this.sessionId,
          isActive: sessionData?.isActive,
          isAudioContentStartSent: sessionData?.isAudioContentStartSent,
          audioContentId: sessionData?.audioContentId,
          queueLength: sessionData?.queue.length,
          greetingDelivered: sessionData?.greetingDelivered
        });

        // Flush any remaining audio in the buffer
        try {
          const audioBufferManager = AudioBufferManager.getInstance();
          const bufferStatus = audioBufferManager.getBufferStatus(this.sessionId);
          if (bufferStatus && bufferStatus.bufferBytes > 0) {
            this.log('debug', 'Flushing remaining audio buffer after model finished speaking', {
              remainingBytes: bufferStatus.bufferBytes,
              remainingMs: bufferStatus.bufferMs
            });
          }
        } catch (e) {
          this.log('warn', 'Failed to flush audio buffer after contentEnd', { err: e });
        }
      }
    });

    this.log('debug', 'SPEAKS-FIRST DEBUG: Registering audioOutput handler');
    
    // Register handler to forward Nova Sonic audioOutput events to Twilio using buffered streaming
    this.bedrockClient.registerEventHandler(this.sessionId, 'audioOutput', (data: unknown) => {
      this.log('info', 'SPEAKS-FIRST DEBUG: audioOutput event received - calling handleAudioOutput');
      this.handleAudioOutput(data);
    });
    
    this.log('info', 'SPEAKS-FIRST DEBUG: All event handlers registered successfully');
  }

  /**
   * Handle audioOutput events from Bedrock.
   *
   * @param data - Audio output event data from Bedrock
   */
  private handleAudioOutput(data: unknown): void {
    const audioOut = data as { audio?: string; content?: string; sampleRateHz?: number; sample_rate_hz?: number };
    const timestamp = Date.now();

    this.log('info', 'SPEAKS-FIRST DEBUG: audioOutput handler invoked', {
      timestamp,
      keys: Object.keys(audioOut || {}),
      hasAudio: !!audioOut?.audio,
      hasContent: !!audioOut?.content,
      audioLength: audioOut?.audio?.length || audioOut?.content?.length || 0,
      sampleRateHint: audioOut?.sampleRateHz ?? audioOut?.sample_rate_hz,
      defaultRate: DefaultAudioOutputConfiguration.sampleRateHertz
    });

    try {
      // Process audio output using the dedicated audio processor
      // Use the configured output sample rate (16kHz) as the default
      this.log('debug', 'SPEAKS-FIRST DEBUG: Calling processBedrockAudioOutput');
      const muBuf = processBedrockAudioOutput(
        audioOut,
        DefaultAudioOutputConfiguration.sampleRateHertz || 16000,
        this.sessionId,
        this.ws.callSid
      );

      this.log('info', 'SPEAKS-FIRST DEBUG: Processed audioOutput to μ-law', {
        muBytes: muBuf.length,
        muDurationMs: Math.round((muBuf.length / 8000) * 1000),
        timestamp
      });

      // Add audio to session buffer for proper timing
      const audioBufferManager = AudioBufferManager.getInstance();

      const audioRealDurationMs = Math.round((muBuf.length / 8000) * 1000);
      const timeSinceLastAudioMs = timestamp - (this.ws._lastAudioTimestamp || timestamp);
      this.ws._lastAudioTimestamp = timestamp;

      this.log('info', 'SPEAKS-FIRST DEBUG: Adding Nova Sonic audio to buffer with proper timing', {
        audioBytes: muBuf.length,
        audioRealDurationMs,
        timeSinceLastAudioMs,
        generationRate:
          audioRealDurationMs > 0
            ? (timeSinceLastAudioMs / audioRealDurationMs).toFixed(2) + 'x'
            : 'unknown',
        isFasterThanRealtime: timeSinceLastAudioMs < audioRealDurationMs,
        mode: 'buffered_timing'
      });

      audioBufferManager.addAudio(this.sessionId, this.ws, muBuf);
      
      this.log('info', 'SPEAKS-FIRST DEBUG: Audio successfully added to buffer and should be streaming to Twilio');
    } catch (err) {
      this.log('error', 'SPEAKS-FIRST DEBUG: Failed to forward audioOutput to Twilio', {
        err,
        message: (err as Error)?.message,
        stack: (err as Error)?.stack
      });
    }
  }
}
