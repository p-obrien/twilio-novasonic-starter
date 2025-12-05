/**
 * Bedrock Response Fixtures
 * 
 * Reusable fixtures for Bedrock API responses used in integration tests.
 * These fixtures represent realistic response structures from AWS Bedrock Nova Sonic.
 * 
 * Requirements: 3.4, 3.5
 */

/**
 * Audio output event from Bedrock
 */
export interface BedrockAudioOutputEvent {
  audioOutput: {
    audio: string; // Base64 encoded audio
    sampleRateHz: number;
  };
}

/**
 * Content end event from Bedrock
 */
export interface BedrockContentEndEvent {
  contentEnd: Record<string, never>;
}

/**
 * Error event from Bedrock
 */
export interface BedrockErrorEvent {
  error: {
    message: string;
    code: string;
  };
}

/**
 * Session start event from Bedrock
 */
export interface BedrockSessionStartEvent {
  sessionStart: {
    sessionId: string;
  };
}

/**
 * Bedrock response fixtures
 */
export class BedrockResponseFixtures {
  /**
   * Create a simple audio output event
   * 
   * @param audioData - Audio buffer to encode
   * @param sampleRate - Sample rate in Hz (default: 16000)
   * @returns Audio output event
   */
  static createAudioOutputEvent(
    audioData: Buffer,
    sampleRate: number = 16000
  ): BedrockAudioOutputEvent {
    return {
      audioOutput: {
        audio: audioData.toString('base64'),
        sampleRateHz: sampleRate
      }
    };
  }

  /**
   * Create a content end event
   * 
   * @returns Content end event
   */
  static createContentEndEvent(): BedrockContentEndEvent {
    return {
      contentEnd: {}
    };
  }

  /**
   * Create an error event
   * 
   * @param message - Error message
   * @param code - Error code
   * @returns Error event
   */
  static createErrorEvent(
    message: string,
    code: string = 'InternalServerError'
  ): BedrockErrorEvent {
    return {
      error: {
        message,
        code
      }
    };
  }

  /**
   * Create a session start event
   * 
   * @param sessionId - Session identifier
   * @returns Session start event
   */
  static createSessionStartEvent(sessionId: string): BedrockSessionStartEvent {
    return {
      sessionStart: {
        sessionId
      }
    };
  }

  /**
   * Create a mock Bedrock streaming response
   * 
   * @param events - Array of events to stream
   * @returns Mock response with async iterator
   */
  static createStreamingResponse(
    events: Array<
      | BedrockAudioOutputEvent
      | BedrockContentEndEvent
      | BedrockErrorEvent
      | BedrockSessionStartEvent
    >
  ): any {
    return {
      body: {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        }
      }
    };
  }

  /**
   * Create a greeting response (speaks-first scenario)
   * 
   * @param greetingAudio - Audio buffer for greeting
   * @param sampleRate - Sample rate in Hz
   * @returns Streaming response with greeting
   */
  static createGreetingResponse(
    greetingAudio: Buffer,
    sampleRate: number = 16000
  ): any {
    const events: any[] = [
      this.createAudioOutputEvent(greetingAudio, sampleRate),
      this.createContentEndEvent()
    ];
    return this.createStreamingResponse(events);
  }

  /**
   * Create a multi-chunk audio response
   * 
   * @param audioChunks - Array of audio buffers
   * @param sampleRate - Sample rate in Hz
   * @returns Streaming response with multiple audio chunks
   */
  static createMultiChunkResponse(
    audioChunks: Buffer[],
    sampleRate: number = 16000
  ): any {
    const events: any[] = audioChunks.map(chunk =>
      this.createAudioOutputEvent(chunk, sampleRate)
    );
    events.push(this.createContentEndEvent());
    
    return this.createStreamingResponse(events);
  }

  /**
   * Create an error response
   * 
   * @param errorMessage - Error message
   * @param errorCode - Error code
   * @returns Streaming response with error
   */
  static createErrorResponse(
    errorMessage: string,
    errorCode: string = 'InternalServerError'
  ): any {
    return this.createStreamingResponse([
      this.createErrorEvent(errorMessage, errorCode)
    ]);
  }

  /**
   * Create a complete conversation response
   * Includes session start, audio output, and content end
   * 
   * @param sessionId - Session identifier
   * @param audioData - Audio buffer
   * @param sampleRate - Sample rate in Hz
   * @returns Complete conversation response
   */
  static createConversationResponse(
    sessionId: string,
    audioData: Buffer,
    sampleRate: number = 16000
  ): any {
    const events: any[] = [
      this.createSessionStartEvent(sessionId),
      this.createAudioOutputEvent(audioData, sampleRate),
      this.createContentEndEvent()
    ];
    return this.createStreamingResponse(events);
  }

  /**
   * Create a realistic greeting audio buffer
   * Generates a simple sine wave as placeholder audio
   * 
   * @param durationMs - Duration in milliseconds
   * @param sampleRate - Sample rate in Hz
   * @returns Audio buffer
   */
  static createGreetingAudioBuffer(
    durationMs: number = 2000,
    sampleRate: number = 16000
  ): Buffer {
    const samples = Math.floor((durationMs / 1000) * sampleRate);
    const buffer = Buffer.alloc(samples * 2); // 16-bit PCM
    
    // Generate simple sine wave at 440 Hz (A4 note)
    const frequency = 440;
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const value = Math.sin(2 * Math.PI * frequency * t) * 0.3; // 30% amplitude
      const sample = Math.floor(value * 32767); // Convert to 16-bit
      buffer.writeInt16LE(sample, i * 2);
    }
    
    return buffer;
  }

  /**
   * Create a realistic response audio buffer
   * 
   * @param durationMs - Duration in milliseconds
   * @param sampleRate - Sample rate in Hz
   * @returns Audio buffer
   */
  static createResponseAudioBuffer(
    durationMs: number = 1000,
    sampleRate: number = 16000
  ): Buffer {
    const samples = Math.floor((durationMs / 1000) * sampleRate);
    const buffer = Buffer.alloc(samples * 2); // 16-bit PCM
    
    // Generate simple sine wave at 523 Hz (C5 note)
    const frequency = 523;
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const value = Math.sin(2 * Math.PI * frequency * t) * 0.3;
      const sample = Math.floor(value * 32767);
      buffer.writeInt16LE(sample, i * 2);
    }
    
    return buffer;
  }

  /**
   * Create silence audio buffer
   * 
   * @param durationMs - Duration in milliseconds
   * @param sampleRate - Sample rate in Hz
   * @returns Audio buffer filled with zeros
   */
  static createSilenceBuffer(
    durationMs: number = 500,
    sampleRate: number = 16000
  ): Buffer {
    const samples = Math.floor((durationMs / 1000) * sampleRate);
    return Buffer.alloc(samples * 2); // All zeros
  }

  /**
   * Create a realistic multi-turn conversation
   * 
   * @param sessionId - Session identifier
   * @param turnCount - Number of conversation turns
   * @returns Array of streaming responses
   */
  static createMultiTurnConversation(
    sessionId: string,
    turnCount: number = 3
  ): any[] {
    const responses: any[] = [];
    
    // First turn: greeting
    responses.push(
      this.createConversationResponse(
        sessionId,
        this.createGreetingAudioBuffer(2000),
        16000
      )
    );
    
    // Subsequent turns: responses
    for (let i = 1; i < turnCount; i++) {
      responses.push(
        this.createStreamingResponse([
          this.createAudioOutputEvent(
            this.createResponseAudioBuffer(1000 + i * 500),
            16000
          ),
          this.createContentEndEvent()
        ])
      );
    }
    
    return responses;
  }

  /**
   * Create a throttled response (simulates slow streaming)
   * 
   * @param audioChunks - Array of audio buffers
   * @param delayMs - Delay between chunks in milliseconds
   * @param sampleRate - Sample rate in Hz
   * @returns Streaming response with delays
   */
  static createThrottledResponse(
    audioChunks: Buffer[],
    delayMs: number = 100,
    sampleRate: number = 16000
  ): any {
    return {
      body: {
        async *[Symbol.asyncIterator]() {
          for (const chunk of audioChunks) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            yield {
              audioOutput: {
                audio: chunk.toString('base64'),
                sampleRateHz: sampleRate
              }
            };
          }
          yield { contentEnd: {} };
        }
      }
    };
  }

  /**
   * Create a response that times out
   * Useful for testing timeout handling
   * 
   * @param timeoutMs - Timeout duration in milliseconds
   * @returns Streaming response that never completes
   */
  static createTimeoutResponse(timeoutMs: number = 5000): any {
    return {
      body: {
        async *[Symbol.asyncIterator]() {
          await new Promise(resolve => setTimeout(resolve, timeoutMs));
          // Never yields anything - simulates timeout
        }
      }
    };
  }

  /**
   * Create a response with intermittent errors
   * 
   * @param audioChunks - Array of audio buffers
   * @param errorAfterChunk - Chunk index after which to throw error
   * @param sampleRate - Sample rate in Hz
   * @returns Streaming response that errors mid-stream
   */
  static createIntermittentErrorResponse(
    audioChunks: Buffer[],
    errorAfterChunk: number,
    sampleRate: number = 16000
  ): any {
    return {
      body: {
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < audioChunks.length; i++) {
            if (i === errorAfterChunk) {
              yield {
                error: {
                  message: 'Stream interrupted',
                  code: 'StreamInterrupted'
                }
              };
              return;
            }
            
            yield {
              audioOutput: {
                audio: audioChunks[i].toString('base64'),
                sampleRateHz: sampleRate
              }
            };
          }
          
          yield { contentEnd: {} };
        }
      }
    };
  }

  /**
   * Create a realistic speaks-first scenario
   * Includes session start, greeting, and readiness for user input
   * 
   * @param sessionId - Session identifier
   * @returns Complete speaks-first response
   */
  static createSpeaksFirstScenario(sessionId: string): any {
    const events: any[] = [
      this.createSessionStartEvent(sessionId),
      this.createAudioOutputEvent(
        this.createGreetingAudioBuffer(2500),
        16000
      ),
      this.createContentEndEvent()
    ];
    return this.createStreamingResponse(events);
  }

  /**
   * Create empty response (no audio)
   * 
   * @returns Streaming response with only content end
   */
  static createEmptyResponse(): any {
    const events: any[] = [
      this.createContentEndEvent()
    ];
    return this.createStreamingResponse(events);
  }

  /**
   * Create a large audio response
   * Useful for testing buffer management
   * 
   * @param durationSeconds - Duration in seconds
   * @param sampleRate - Sample rate in Hz
   * @returns Streaming response with large audio
   */
  static createLargeAudioResponse(
    durationSeconds: number = 10,
    sampleRate: number = 16000
  ): any {
    // Split into 1-second chunks
    const chunks: Buffer[] = [];
    for (let i = 0; i < durationSeconds; i++) {
      chunks.push(this.createResponseAudioBuffer(1000, sampleRate));
    }
    
    return this.createMultiChunkResponse(chunks, sampleRate);
  }
}
