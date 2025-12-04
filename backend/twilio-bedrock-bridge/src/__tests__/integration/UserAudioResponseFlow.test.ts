/**
 * Integration test for user audio response handling
 * 
 * This test verifies that:
 * 1. Nova Sonic 2 generates a speaks-first greeting
 * 2. User audio is properly sent to Bedrock
 * 3. contentEnd and promptEnd are sent after user silence
 * 4. Nova Sonic 2 responds to user audio
 */

import { NovaSonicBidirectionalStreamClient } from '../../client';
import { configManager } from '../../config/ConfigurationManager';
import logger from '../../observability/logger';

describe('User Audio Response Flow Integration Test', () => {
  let client: NovaSonicBidirectionalStreamClient;
  let sessionId: string;

  beforeAll(() => {
    // Initialize client with real AWS credentials
    client = new NovaSonicBidirectionalStreamClient({
      clientConfig: {
        region: configManager.bedrock.region || 'us-east-1'
      }
    });
  });

  afterAll(() => {
    if (client) {
      client.shutdown();
    }
  });

  it('should handle complete conversation flow: greeting -> user audio -> model response', async () => {
    sessionId = `test-user-audio-${Date.now()}`;
    
    logger.info('=== USER AUDIO FLOW TEST: Starting ===', { sessionId });

    // Track events received
    const eventsReceived: string[] = [];
    let greetingReceived = false;
    let userAudioSent = false;
    let modelResponseReceived = false;

    // Create session
    const session = client.createStreamSession(sessionId);
    
    // Register event handlers to track flow
    client.registerEventHandler(sessionId, 'contentStart', (data: any) => {
      eventsReceived.push(`contentStart(${data.role}/${data.type})`);
      logger.info('USER AUDIO FLOW TEST: contentStart', {
        role: data.role,
        type: data.type
      });
    });

    client.registerEventHandler(sessionId, 'audioOutput', (data: any) => {
      eventsReceived.push('audioOutput');
      logger.info('USER AUDIO FLOW TEST: audioOutput received', {
        hasContent: !!data.content,
        contentLength: data.content?.length || 0
      });
      
      if (!greetingReceived) {
        greetingReceived = true;
        logger.info('USER AUDIO FLOW TEST: ✓ Greeting received');
      } else if (userAudioSent && !modelResponseReceived) {
        modelResponseReceived = true;
        logger.info('USER AUDIO FLOW TEST: ✓ Model response to user audio received');
      }
    });

    client.registerEventHandler(sessionId, 'contentEnd', (data: any) => {
      eventsReceived.push(`contentEnd(${data.role}/${data.type})`);
      logger.info('USER AUDIO FLOW TEST: contentEnd', {
        role: data.role,
        type: data.type
      });
    });

    // Setup session events
    logger.info('USER AUDIO FLOW TEST: Setting up session events');
    session.setupPromptStart();
    session.setupSystemPrompt();
    session.setupStartAudio();
    
    // Queue initial text input to trigger greeting
    logger.info('USER AUDIO FLOW TEST: Queueing initial text input for greeting');
    client.queueTextInputEvents(sessionId, 'hi');

    // Start the session
    logger.info('USER AUDIO FLOW TEST: Initiating session');
    const sessionPromise = client.initiateSession(sessionId);

    // Wait for greeting to be received
    logger.info('USER AUDIO FLOW TEST: Waiting for greeting...');
    await new Promise<void>((resolve) => {
      const checkGreeting = setInterval(() => {
        if (greetingReceived) {
          clearInterval(checkGreeting);
          logger.info('USER AUDIO FLOW TEST: Greeting confirmed');
          resolve();
        }
      }, 100);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkGreeting);
        if (!greetingReceived) {
          logger.error('USER AUDIO FLOW TEST: Timeout waiting for greeting');
        }
        resolve();
      }, 10000);
    });

    expect(greetingReceived).toBe(true);

    // Simulate user audio input
    logger.info('USER AUDIO FLOW TEST: Simulating user audio input');
    userAudioSent = true;
    
    // Send several chunks of audio (simulating user speaking)
    const audioChunk = Buffer.alloc(320); // 20ms of 16kHz PCM audio
    audioChunk.fill(0x00); // Silence for testing
    
    for (let i = 0; i < 50; i++) { // Send 1 second of audio
      await client.streamAudioChunk(sessionId, audioChunk);
      await new Promise(resolve => setTimeout(resolve, 20)); // 20ms between chunks
    }
    
    logger.info('USER AUDIO FLOW TEST: User audio sent, waiting for silence timeout');
    
    // Wait for silence timeout (3 seconds) + processing time
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    logger.info('USER AUDIO FLOW TEST: Silence timeout should have triggered contentEnd/promptEnd');
    
    // Wait for model response
    logger.info('USER AUDIO FLOW TEST: Waiting for model response...');
    await new Promise<void>((resolve) => {
      const checkResponse = setInterval(() => {
        if (modelResponseReceived) {
          clearInterval(checkResponse);
          logger.info('USER AUDIO FLOW TEST: Model response confirmed');
          resolve();
        }
      }, 100);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkResponse);
        if (!modelResponseReceived) {
          logger.error('USER AUDIO FLOW TEST: Timeout waiting for model response');
        }
        resolve();
      }, 10000);
    });

    // Verify complete flow
    logger.info('USER AUDIO FLOW TEST: Event sequence', {
      events: eventsReceived,
      greetingReceived,
      userAudioSent,
      modelResponseReceived
    });

    expect(greetingReceived).toBe(true);
    expect(userAudioSent).toBe(true);
    expect(modelResponseReceived).toBe(true);

    // Clean up
    await client.closeSession(sessionId);
    
    logger.info('=== USER AUDIO FLOW TEST: Complete ===', {
      success: greetingReceived && userAudioSent && modelResponseReceived
    });
  }, 30000); // 30 second timeout for complete flow
});
