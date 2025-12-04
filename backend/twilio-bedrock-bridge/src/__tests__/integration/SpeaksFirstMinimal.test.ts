/**
 * Minimal reproduction test for speaks-first functionality
 * 
 * This test verifies that Nova Sonic 2 can generate a greeting
 * when triggered with sendTextInput without requiring user audio first.
 */

import NovaSonicBidirectionalStreamClient from '../../client';
import { configManager } from '../../config/ConfigurationManager';
import logger from '../../observability/logger';

describe('Speaks-First Minimal Reproduction', () => {
  let client: NovaSonicBidirectionalStreamClient;
  const testTimeout = 30000; // 30 seconds

  beforeAll(() => {
    // Initialize client with real AWS credentials
    client = new NovaSonicBidirectionalStreamClient({
      clientConfig: {
        region: configManager.bedrock.region || 'us-east-1',
      },
      inferenceConfig: configManager.inference
    });
  });

  afterAll(() => {
    if (client) {
      client.shutdown();
    }
  });

  it('should receive audioOutput events when sendTextInput is called', async () => {
    const sessionId = `test-speaks-first-${Date.now()}`;
    
    logger.info('=== MINIMAL TEST: Starting speaks-first test ===', { sessionId });

    // Track events received
    const eventsReceived: string[] = [];
    let audioOutputReceived = false;
    let audioOutputCount = 0;

    // Create session
    logger.info('MINIMAL TEST: Creating stream session');
    const session = client.createStreamSession(sessionId);

    // Register event handlers
    logger.info('MINIMAL TEST: Registering event handlers');
    
    session.onEvent('contentStart', (data: any) => {
      eventsReceived.push(`contentStart(${data.role}/${data.type})`);
      logger.info('MINIMAL TEST: contentStart event', { role: data.role, type: data.type });
    });

    session.onEvent('audioOutput', (data: any) => {
      audioOutputReceived = true;
      audioOutputCount++;
      eventsReceived.push('audioOutput');
      logger.info('MINIMAL TEST: ✓ audioOutput event received!', {
        count: audioOutputCount,
        hasContent: !!(data as any).content || !!(data as any).audio,
        contentLength: ((data as any).content || (data as any).audio || '').length
      });
    });

    session.onEvent('textOutput', (data: any) => {
      eventsReceived.push('textOutput');
      logger.info('MINIMAL TEST: textOutput event', { 
        content: (data as any).content?.substring(0, 100) 
      });
    });

    session.onEvent('completionStart', () => {
      eventsReceived.push('completionStart');
      logger.info('MINIMAL TEST: completionStart event');
    });

    session.onEvent('completionEnd', () => {
      eventsReceived.push('completionEnd');
      logger.info('MINIMAL TEST: completionEnd event');
    });

    session.onEvent('contentEnd', (data: any) => {
      eventsReceived.push(`contentEnd(${data.role}/${data.type})`);
      logger.info('MINIMAL TEST: contentEnd event', { role: data.role, type: data.type });
    });

    session.onEvent('error', (data: any) => {
      eventsReceived.push('error');
      logger.error('MINIMAL TEST: Error event received', data);
    });

    // Setup session events
    logger.info('MINIMAL TEST: Setting up session events');
    session.setupPromptStart();
    session.setupSystemPrompt(
      undefined,
      'You are a helpful voice assistant. Respond briefly and naturally.'
    );
    session.setupStartAudio();

    // Queue text input BEFORE initiating session (this is the key for speaks-first)
    logger.info('MINIMAL TEST: Queueing text input to trigger greeting');
    client.queueTextInputEvents(sessionId, 'hi');

    // Initiate session in background - the queued text input will trigger the greeting
    logger.info('MINIMAL TEST: Initiating Bedrock session');
    client.initiateSession(sessionId).catch(err => {
      logger.error('MINIMAL TEST: Session initiation error', err);
    });

    // Wait for audioOutput events
    logger.info('MINIMAL TEST: Waiting for audioOutput events...');
    const maxWaitTime = 15000; // 15 seconds
    const checkInterval = 500; // Check every 500ms
    let waited = 0;

    while (!audioOutputReceived && waited < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
      
      if (waited % 2000 === 0) {
        logger.info('MINIMAL TEST: Still waiting for audioOutput...', {
          waitedMs: waited,
          eventsReceived: eventsReceived.length,
          events: eventsReceived
        });
      }
    }

    logger.info('=== MINIMAL TEST: Test complete ===', {
      audioOutputReceived,
      audioOutputCount,
      totalEventsReceived: eventsReceived.length,
      eventsReceived,
      waitedMs: waited
    });

    // Cleanup
    await session.close();

    // Assertions
    expect(audioOutputReceived).toBe(true);
    expect(audioOutputCount).toBeGreaterThan(0);
    expect(eventsReceived).toContain('audioOutput');
  }, testTimeout);

  it('should work with different initial text inputs', async () => {
    const testInputs = ['hi', 'hello', 'greet the caller'];
    
    for (const initialText of testInputs) {
      const sessionId = `test-speaks-first-${initialText}-${Date.now()}`;
      
      logger.info(`=== MINIMAL TEST: Testing with input "${initialText}" ===`, { sessionId });

      let audioOutputReceived = false;

      // Create session
      const session = client.createStreamSession(sessionId);

      // Register audio output handler
      session.onEvent('audioOutput', () => {
        audioOutputReceived = true;
        logger.info(`MINIMAL TEST: ✓ audioOutput received for input "${initialText}"`);
      });

      // Setup session
      session.setupPromptStart();
      session.setupSystemPrompt(
        undefined,
        'You are a helpful voice assistant. Respond briefly.'
      );
      session.setupStartAudio();

      // Queue text input BEFORE initiating session
      client.queueTextInputEvents(sessionId, initialText);

      // Initiate session
      client.initiateSession(sessionId).catch(err => {
        logger.error('MINIMAL TEST: Session initiation error', err);
      });

      // Wait for response
      const maxWaitTime = 10000;
      const checkInterval = 500;
      let waited = 0;

      while (!audioOutputReceived && waited < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waited += checkInterval;
      }

      logger.info(`MINIMAL TEST: Result for "${initialText}"`, {
        audioOutputReceived,
        waitedMs: waited
      });

      // Cleanup
      await session.close();

      // Assertion
      expect(audioOutputReceived).toBe(true);
    }
  }, testTimeout * 3);
});
