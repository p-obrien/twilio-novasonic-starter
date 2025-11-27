/**
 * Handler for Twilio 'stop' messages.
 *
 * Responsible for:
 * - Flushing and cleaning up audio buffers
 * - Ending current user turn if active
 * - Closing WebSocket connection gracefully
 *
 * This handler ensures clean shutdown of the media stream session.
 */

import { BaseMessageHandler, MessageHandlerContext } from './BaseMessageHandler';
import { TwilioStopMessage } from '../types/TwilioMessages';
import { AudioBufferManager } from '../../audio/AudioBufferManager';
import { setTimeoutWithCorrelation } from '../../utils/asyncCorrelation';

/**
 * Handles Twilio 'stop' events which terminate media stream sessions.
 */
export class StopMessageHandler extends BaseMessageHandler<TwilioStopMessage> {
  /** Flag to track if user turn is active (managed by MediaMessageHandler via shared context) */
  private isUserTurnActive = false;

  /**
   * Handle a Twilio stop message.
   *
   * Processing flow:
   * 1. Log the stop event
   * 2. Flush and remove audio buffer
   * 3. End current user turn if active
   * 4. Close WebSocket connection
   *
   * @param message - The stop message from Twilio
   */
  async handle(message: TwilioStopMessage): Promise<void> {
    this.log('info', 'Received Twilio stop event', {
      streamSid: this.ws.twilioStreamSid
    });

    // Flush and clean up audio buffer for outbound audio
    await this.flushAudioBuffer();

    // End the current user turn properly before closing
    this.endCurrentUserTurn();

    // Close WebSocket connection
    this.closeWebSocket();
  }

  /**
   * Flush and remove the audio buffer for this session.
   */
  private async flushAudioBuffer(): Promise<void> {
    try {
      const audioBufferManager = AudioBufferManager.getInstance();
      audioBufferManager.flushAndRemove(this.sessionId);
      this.log('debug', 'Audio buffer flushed and removed');
    } catch (e) {
      this.log('warn', 'Failed to flush audio buffer on stop', { err: e });
    }
  }

  /**
   * End the current user turn if active.
   */
  private endCurrentUserTurn(): void {
    if (!this.isUserTurnActive || !this.sessionId || !this.isSessionActive()) {
      this.log('debug', 'Skipping turn end on stop - not active or no session', {
        isUserTurnActive: this.isUserTurnActive,
        hasSessionId: !!this.sessionId,
        isSessionActive: this.sessionId ? this.isSessionActive() : false
      });
      return;
    }

    try {
      this.log('info', 'Ending user turn due to stop event');

      // End audio content (step 8 in Nova Sonic flow)
      this.bedrockClient.sendContentEnd(this.sessionId);
      this.log('info', 'Sent contentEnd for session');

      // Wait a brief moment then signal prompt end (step 9 in Nova Sonic flow)
      setTimeoutWithCorrelation(() => {
        if (this.isSessionActive()) {
          this.bedrockClient.sendPromptEnd(this.sessionId);
          this.log('info', 'Sent promptEnd for session - model should now respond');
        }
      }, 100);

      this.isUserTurnActive = false;
      this.log('debug', 'User turn ended');
    } catch (endErr) {
      this.log('warn', 'Failed to end user turn on stop', { err: endErr });
    }
  }

  /**
   * Close the WebSocket connection.
   */
  private closeWebSocket(): void {
    try {
      this.ws.close();
      this.log('debug', 'WebSocket closed after stop event');
    } catch (e) {
      this.log('warn', 'Failed to close WebSocket after stop', { err: e });
    }
  }

  /**
   * Set the user turn active state.
   * This is called by the MediaMessageHandler to synchronize turn state.
   *
   * @param active - Whether user turn is active
   */
  setUserTurnActive(active: boolean): void {
    this.isUserTurnActive = active;
  }
}
