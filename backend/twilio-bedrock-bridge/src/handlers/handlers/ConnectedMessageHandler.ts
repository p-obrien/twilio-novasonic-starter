/**
 * Handler for Twilio 'connected' messages.
 *
 * This is the first message received after WebSocket connection is established.
 * Currently, no action is required for this message type.
 */

import { BaseMessageHandler } from './BaseMessageHandler';
import { TwilioConnectedMessage } from '../types/TwilioMessages';

/**
 * Handles Twilio 'connected' events.
 *
 * This is a simple handler that currently performs no action.
 * The handler is included for completeness and future extensibility.
 */
export class ConnectedMessageHandler extends BaseMessageHandler<TwilioConnectedMessage> {
  /**
   * Handle a Twilio connected message.
   *
   * Currently no action is required for this message type.
   *
   * @param message - The connected message from Twilio
   */
  async handle(message: TwilioConnectedMessage): Promise<void> {
    this.log('debug', 'Received Twilio connected event', {
      protocol: message.protocol,
      version: message.version
    });
    // No action required - connection is already established
  }
}
