/**
 * Handler for Twilio 'mark' messages.
 *
 * Mark events are custom markers sent from TwiML and can be used for
 * synchronization and tracking specific points in the call.
 *
 * Currently, marks are logged but no specific action is taken.
 */

import { BaseMessageHandler } from './BaseMessageHandler';
import { TwilioMarkMessage } from '../types/TwilioMessages';

/**
 * Handles Twilio 'mark' events.
 *
 * This is a simple handler that logs mark events for debugging and monitoring.
 */
export class MarkMessageHandler extends BaseMessageHandler<TwilioMarkMessage> {
  /**
   * Handle a Twilio mark message.
   *
   * Currently just logs the mark for debugging purposes.
   * Future implementations could use marks for:
   * - Synchronizing media playback
   * - Tracking TwiML execution flow
   * - Triggering custom application logic
   *
   * @param message - The mark message from Twilio
   */
  async handle(message: TwilioMarkMessage): Promise<void> {
    this.log('debug', 'Received Twilio mark event', {
      mark: message.mark
    });
    // No specific action required - marks are informational
  }
}
