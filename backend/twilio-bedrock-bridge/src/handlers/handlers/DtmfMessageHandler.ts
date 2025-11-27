/**
 * Handler for Twilio 'dtmf' messages.
 *
 * DTMF (Dual-Tone Multi-Frequency) events are sent when the caller presses
 * buttons on their phone keypad (0-9, *, #, A-D).
 *
 * Currently, DTMF events are logged but no specific action is taken.
 */

import { BaseMessageHandler } from './BaseMessageHandler';
import { TwilioDtmfMessage } from '../types/TwilioMessages';

/**
 * Handles Twilio 'dtmf' events.
 *
 * This is a simple handler that logs DTMF events for debugging and monitoring.
 */
export class DtmfMessageHandler extends BaseMessageHandler<TwilioDtmfMessage> {
  /**
   * Handle a Twilio DTMF message.
   *
   * Currently just logs the DTMF digit for debugging purposes.
   * Future implementations could use DTMF for:
   * - Interactive voice response (IVR) menus
   * - Call controls (mute, transfer, etc.)
   * - Authentication (PIN entry)
   * - Custom application logic
   *
   * @param message - The DTMF message from Twilio
   */
  async handle(message: TwilioDtmfMessage): Promise<void> {
    this.log('debug', 'Received Twilio DTMF event', {
      digit: message.dtmf?.digit
    });
    // No specific action required - DTMF events are informational
  }
}
