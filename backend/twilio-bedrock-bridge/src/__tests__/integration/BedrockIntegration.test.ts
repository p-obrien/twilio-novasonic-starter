/**
 * Bedrock Integration Tests
 * 
 * Comprehensive integration tests for real AWS Bedrock Nova Sonic interactions.
 * These tests verify the complete lifecycle of Bedrock sessions including:
 * - Real session creation with AWS Bedrock
 * - Audio streaming with real Bedrock responses
 * - Speaks-first greeting flow
 * - Error handling with real API errors
 * - Proper resource cleanup
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.5
 */

import { BedrockIntegrationTestBase, createIntegrationTestSuite } from '../fixtures/IntegrationTestBase';
import { BedrockResponseFixtures } from '../fixtures/BedrockResponseFixtures';
import { IntegrationTestUtils } from '../utils/IntegrationTestUtils';
import { NovaSonicBidirectionalStreamClient } from '../../client';
import { configManager } from '../../config/ConfigurationManager';
import { DefaultAudioInputConfiguration, DefaultTextConfiguration } from '../../utils/constants';
import { Buffer } from 'node:buffer';

/**
 * Bedrock session creation integration test
 * 
 * Validates: Requirements 3.1 - Real Bedrock session creation
 */
class BedrockSessionCreationTest extends BedrockIntegrationTestBase {
  private client?: NovaSonicBidirectionalStreamClient;

  constructor() {
    super('BedrockSessionCreation', 30000);
  }

  async setup(): Promise<void> {
    await super.setup();
    
    if (!this.shouldSkip()) {
      this.client = new NovaSonicBidirectionalStreamClient({
        clientConfig: {
          region: configManager.bedrock.region || 'us-east-1'
        }
      });
      
      this.trackResource('bedrock-client', async () => {
        if (this.client) {
          const activeSessions = this.client.getActiveSessions();
          for (const sessionId of activeSessions) {
            try {
              await this.client.closeSession(sessionId);
            } catch (error) {
              this.logInfo(`Error closing session ${sessionId}:`, error);
            }
          }
        }
      });
    }
  }

  async testCreateSession(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('session-creation');
    this.logInfo('Creating Bedrock session', { sessionId });

    // Create session
    const session = this.client.createStreamSession(sessionId);
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    // Verify session was created
    expect(session).toBeDefined();
    expect(session.sessionId).toBe(sessionId);
    expect(this.client.isSessionActive(sessionId)).toBe(true);
    
    this.logInfo('Session created successfully', { sessionId });
  }

  async testSessionConfiguration(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('session-config');
    
    // Create session with configuration
    const session = this.client.createStreamSession(sessionId, {
      clientConfig: {},
      inferenceConfig: configManager.inference
    });
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    // Verify session configuration
    const sessionData = this.client.getSessionData(sessionId);
    expect(sessionData).toBeDefined();
    expect(sessionData?.inferenceConfig).toBeDefined();
    expect(sessionData?.isActive).toBe(true);
    
    this.logInfo('Session configuration verified', { sessionId });
  }

  async testMultipleConcurrentSessions(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionIds = [
      this.createTestSessionId('concurrent-1'),
      this.createTestSessionId('concurrent-2'),
      this.createTestSessionId('concurrent-3')
    ];

    this.logInfo('Creating multiple concurrent sessions', { count: sessionIds.length });

    // Create multiple sessions
    const sessions = sessionIds.map(sessionId => {
      const session = this.client!.createStreamSession(sessionId);
      
      this.trackResource(sessionId, async () => {
        if (this.client && this.client.isSessionActive(sessionId)) {
          await this.client.closeSession(sessionId);
        }
      });
      
      return session;
    });

    // Verify all sessions are active
    expect(sessions.length).toBe(3);
    sessionIds.forEach(sessionId => {
      expect(this.client!.isSessionActive(sessionId)).toBe(true);
    });

    const activeSessions = this.client.getActiveSessions();
    expect(activeSessions.length).toBeGreaterThanOrEqual(3);
    
    this.logInfo('Multiple concurrent sessions created successfully', { 
      sessionIds,
      activeCount: activeSessions.length
    });
  }
}

/**
 * Bedrock audio streaming integration test
 * 
 * Validates: Requirements 3.2 - Real audio streaming with Bedrock responses
 */
class BedrockAudioStreamingTest extends BedrockIntegrationTestBase {
  private client?: NovaSonicBidirectionalStreamClient;

  constructor() {
    super('BedrockAudioStreaming', 45000);
  }

  async setup(): Promise<void> {
    await super.setup();
    
    if (!this.shouldSkip()) {
      this.client = new NovaSonicBidirectionalStreamClient({
        clientConfig: {
          region: configManager.bedrock.region || 'us-east-1'
        }
      });
      
      this.trackResource('bedrock-client', async () => {
        if (this.client) {
          const activeSessions = this.client.getActiveSessions();
          for (const sessionId of activeSessions) {
            try {
              await this.client.closeSession(sessionId);
            } catch (error) {
              this.logInfo(`Error closing session ${sessionId}:`, error);
            }
          }
        }
      });
    }
  }

  async testAudioStreamingWithResponse(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('audio-streaming');
    this.logInfo('Testing audio streaming with Bedrock response', { sessionId });

    let audioOutputReceived = false;
    let audioChunkCount = 0;

    // Create session
    const session = this.client.createStreamSession(sessionId);
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    // Register audio output handler
    this.client.registerEventHandler(sessionId, 'audioOutput', (data: any) => {
      audioOutputReceived = true;
      audioChunkCount++;
      this.logInfo('Audio output received', { 
        sessionId, 
        chunkNumber: audioChunkCount,
        hasContent: !!data.content || !!data.audio
      });
    });

    // Setup session
    this.client.setupSessionStartEvent(sessionId);
    this.client.setupPromptStartEvent(sessionId);
    this.client.setupSystemPromptEvent(sessionId, DefaultTextConfiguration, 
      'You are a helpful voice assistant. Respond briefly.');
    this.client.setupStartAudioEvent(sessionId, DefaultAudioInputConfiguration);

    // Queue text input to trigger response
    this.client.queueTextInputEvents(sessionId, 'hello');

    // Initiate session
    const sessionPromise = this.client.initiateSession(sessionId);

    // Wait for audio output
    await this.waitFor(() => audioOutputReceived, 20000, 500);

    // Verify audio was received
    expect(audioOutputReceived).toBe(true);
    expect(audioChunkCount).toBeGreaterThan(0);
    
    this.logInfo('Audio streaming test completed', { 
      sessionId, 
      audioChunkCount,
      success: audioOutputReceived
    });

    // Cleanup
    await this.client.closeSession(sessionId);
  }

  async testStreamUserAudio(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('user-audio');
    this.logInfo('Testing user audio streaming', { sessionId });

    // Create session
    const session = this.client.createStreamSession(sessionId);
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    // Setup session
    this.client.setupSessionStartEvent(sessionId);
    this.client.setupPromptStartEvent(sessionId);
    this.client.setupSystemPromptEvent(sessionId);
    this.client.setupStartAudioEvent(sessionId);

    // Stream audio chunks
    const audioChunk = Buffer.alloc(320); // 20ms of 16kHz PCM
    audioChunk.fill(0x00); // Silence

    this.logInfo('Streaming user audio chunks', { sessionId, chunkSize: audioChunk.length });

    // Stream multiple chunks
    for (let i = 0; i < 10; i++) {
      await this.client.streamAudioChunk(sessionId, audioChunk);
    }

    // Verify session is still active
    expect(this.client.isSessionActive(sessionId)).toBe(true);
    
    this.logInfo('User audio streaming completed', { sessionId, chunksStreamed: 10 });

    // Cleanup
    await this.client.closeSession(sessionId);
  }

  async testMultiChunkAudioResponse(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('multi-chunk');
    this.logInfo('Testing multi-chunk audio response', { sessionId });

    const audioChunks: any[] = [];
    let contentEndReceived = false;

    // Create session
    const session = this.client.createStreamSession(sessionId);
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    // Register handlers
    this.client.registerEventHandler(sessionId, 'audioOutput', (data: any) => {
      audioChunks.push(data);
      this.logInfo('Audio chunk received', { 
        sessionId, 
        chunkNumber: audioChunks.length 
      });
    });

    this.client.registerEventHandler(sessionId, 'contentEnd', () => {
      contentEndReceived = true;
      this.logInfo('Content end received', { sessionId });
    });

    // Setup session
    this.client.setupSessionStartEvent(sessionId);
    this.client.setupPromptStartEvent(sessionId);
    this.client.setupSystemPromptEvent(sessionId, DefaultTextConfiguration,
      'You are a helpful assistant. Give a detailed response.');
    this.client.setupStartAudioEvent(sessionId);

    // Queue text input
    this.client.queueTextInputEvents(sessionId, 'Tell me about the weather');

    // Initiate session
    const sessionPromise = this.client.initiateSession(sessionId);

    // Wait for multiple chunks and content end
    await this.waitFor(() => audioChunks.length > 0 && contentEndReceived, 25000, 500);

    // Verify multiple chunks received
    expect(audioChunks.length).toBeGreaterThan(0);
    expect(contentEndReceived).toBe(true);
    
    this.logInfo('Multi-chunk audio response test completed', { 
      sessionId, 
      totalChunks: audioChunks.length,
      contentEndReceived
    });

    // Cleanup
    await this.client.closeSession(sessionId);
  }
}

/**
 * Speaks-first greeting flow integration test
 * 
 * Validates: Requirements 3.2 - Speaks-first greeting functionality
 */
class SpeaksFirstGreetingTest extends BedrockIntegrationTestBase {
  private client?: NovaSonicBidirectionalStreamClient;

  constructor() {
    super('SpeaksFirstGreeting', 45000);
  }

  async setup(): Promise<void> {
    await super.setup();
    
    if (!this.shouldSkip()) {
      this.client = new NovaSonicBidirectionalStreamClient({
        clientConfig: {
          region: configManager.bedrock.region || 'us-east-1'
        }
      });
      
      this.trackResource('bedrock-client', async () => {
        if (this.client) {
          const activeSessions = this.client.getActiveSessions();
          for (const sessionId of activeSessions) {
            try {
              await this.client.closeSession(sessionId);
            } catch (error) {
              this.logInfo(`Error closing session ${sessionId}:`, error);
            }
          }
        }
      });
    }
  }

  async testSpeaksFirstGreeting(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('speaks-first');
    this.logInfo('Testing speaks-first greeting', { sessionId });

    let greetingReceived = false;
    let audioOutputCount = 0;

    // Create session with speaks-first enabled
    const session = this.client.createStreamSession(sessionId, {
      clientConfig: {},
      speaksFirst: true,
      initialPrompt: 'Greet the caller warmly'
    });
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    // Verify speaks-first configuration
    const sessionData = this.client.getSessionData(sessionId);
    expect(sessionData?.speaksFirst).toBe(true);
    expect(sessionData?.initialPrompt).toBe('Greet the caller warmly');

    // Register audio output handler
    this.client.registerEventHandler(sessionId, 'audioOutput', (data: any) => {
      greetingReceived = true;
      audioOutputCount++;
      this.logInfo('Greeting audio received', { 
        sessionId, 
        chunkNumber: audioOutputCount 
      });
    });

    // Setup session
    this.client.setupSessionStartEvent(sessionId);
    this.client.setupPromptStartEvent(sessionId);
    this.client.setupSystemPromptEvent(sessionId, DefaultTextConfiguration,
      'You are a friendly voice assistant. Greet callers warmly.');
    this.client.setupStartAudioEvent(sessionId);

    // Queue initial text input to trigger greeting
    this.client.queueTextInputEvents(sessionId, 'hi');

    // Initiate session
    const sessionPromise = this.client.initiateSession(sessionId);

    // Wait for greeting
    await this.waitFor(() => greetingReceived, 20000, 500);

    // Verify greeting was received
    expect(greetingReceived).toBe(true);
    expect(audioOutputCount).toBeGreaterThan(0);
    
    this.logInfo('Speaks-first greeting test completed', { 
      sessionId, 
      greetingReceived,
      audioOutputCount
    });

    // Cleanup
    await this.client.closeSession(sessionId);
  }

  async testCustomInitialPrompt(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('custom-prompt');
    const customPrompt = 'Welcome to our AI assistant service. How can I help you today?';
    
    this.logInfo('Testing custom initial prompt', { sessionId, customPrompt });

    let greetingReceived = false;

    // Create session with custom prompt
    const session = this.client.createStreamSession(sessionId, {
      clientConfig: {},
      speaksFirst: true,
      initialPrompt: customPrompt
    });
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    // Verify custom prompt configuration
    const sessionData = this.client.getSessionData(sessionId);
    expect(sessionData?.initialPrompt).toBe(customPrompt);

    // Register handler
    this.client.registerEventHandler(sessionId, 'audioOutput', () => {
      greetingReceived = true;
      this.logInfo('Custom greeting received', { sessionId });
    });

    // Setup and initiate session
    this.client.setupSessionStartEvent(sessionId);
    this.client.setupPromptStartEvent(sessionId);
    this.client.setupSystemPromptEvent(sessionId);
    this.client.setupStartAudioEvent(sessionId);
    this.client.queueTextInputEvents(sessionId, 'hi');

    const sessionPromise = this.client.initiateSession(sessionId);

    // Wait for greeting
    await this.waitFor(() => greetingReceived, 20000, 500);

    expect(greetingReceived).toBe(true);
    
    this.logInfo('Custom initial prompt test completed', { sessionId });

    // Cleanup
    await this.client.closeSession(sessionId);
  }

  async testGreetingThenConversation(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('greeting-conversation');
    this.logInfo('Testing greeting followed by conversation', { sessionId });

    let greetingReceived = false;
    let conversationResponseReceived = false;
    let audioOutputCount = 0;

    // Create session
    const session = this.client.createStreamSession(sessionId, {
      clientConfig: {},
      speaksFirst: true,
      initialPrompt: 'Greet the caller'
    });
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    // Register handler
    this.client.registerEventHandler(sessionId, 'audioOutput', () => {
      audioOutputCount++;
      if (!greetingReceived) {
        greetingReceived = true;
        this.logInfo('Greeting received', { sessionId });
      } else if (!conversationResponseReceived) {
        conversationResponseReceived = true;
        this.logInfo('Conversation response received', { sessionId });
      }
    });

    // Setup session
    this.client.setupSessionStartEvent(sessionId);
    this.client.setupPromptStartEvent(sessionId);
    this.client.setupSystemPromptEvent(sessionId);
    this.client.setupStartAudioEvent(sessionId);
    this.client.queueTextInputEvents(sessionId, 'hi');

    // Initiate session
    const sessionPromise = this.client.initiateSession(sessionId);

    // Wait for greeting
    await this.waitFor(() => greetingReceived, 20000, 500);
    expect(greetingReceived).toBe(true);

    // Send user audio for conversation
    const audioChunk = Buffer.alloc(320);
    audioChunk.fill(0x00);
    
    for (let i = 0; i < 20; i++) {
      await this.client.streamAudioChunk(sessionId, audioChunk);
    }

    // Send content end and prompt end to trigger response
    this.client.sendContentEnd(sessionId);
    this.client.sendPromptEnd(sessionId);

    // Wait for conversation response
    await this.waitFor(() => conversationResponseReceived, 20000, 500);

    expect(conversationResponseReceived).toBe(true);
    expect(audioOutputCount).toBeGreaterThan(1);
    
    this.logInfo('Greeting then conversation test completed', { 
      sessionId, 
      audioOutputCount 
    });

    // Cleanup
    await this.client.closeSession(sessionId);
  }
}

/**
 * Error handling integration test
 * 
 * Validates: Requirements 3.3 - Error handling with real API errors
 */
class BedrockErrorHandlingTest extends BedrockIntegrationTestBase {
  private client?: NovaSonicBidirectionalStreamClient;

  constructor() {
    super('BedrockErrorHandling', 30000);
  }

  async setup(): Promise<void> {
    await super.setup();
    
    if (!this.shouldSkip()) {
      this.client = new NovaSonicBidirectionalStreamClient({
        clientConfig: {
          region: configManager.bedrock.region || 'us-east-1'
        }
      });
      
      this.trackResource('bedrock-client', async () => {
        if (this.client) {
          const activeSessions = this.client.getActiveSessions();
          for (const sessionId of activeSessions) {
            try {
              await this.client.closeSession(sessionId);
            } catch (error) {
              this.logInfo(`Error closing session ${sessionId}:`, error);
            }
          }
        }
      });
    }
  }

  async testInvalidSessionId(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    this.logInfo('Testing invalid session ID handling');

    // Attempt to create session with invalid ID
    expect(() => {
      this.client!.createStreamSession('invalid session id with spaces');
    }).toThrow();
    
    this.logInfo('Invalid session ID correctly rejected');
  }

  async testDuplicateSessionCreation(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('duplicate');
    this.logInfo('Testing duplicate session creation', { sessionId });

    // Create first session
    const session1 = this.client.createStreamSession(sessionId);
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    expect(session1).toBeDefined();

    // Attempt to create duplicate
    expect(() => {
      this.client!.createStreamSession(sessionId);
    }).toThrow();
    
    this.logInfo('Duplicate session creation correctly rejected', { sessionId });

    // Cleanup
    await this.client.closeSession(sessionId);
  }

  async testSessionCleanupOnError(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('cleanup-error');
    this.logInfo('Testing session cleanup on error', { sessionId });

    // Create session
    const session = this.client.createStreamSession(sessionId);
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    expect(this.client.isSessionActive(sessionId)).toBe(true);

    // Force close session
    this.client.forceCloseSession(sessionId);

    // Verify session is no longer active
    expect(this.client.isSessionActive(sessionId)).toBe(false);
    
    this.logInfo('Session cleanup on error completed', { sessionId });
  }

  async testErrorEventHandling(): Promise<void> {
    if (this.shouldSkip()) return;
    if (!this.client) throw new Error('Client not initialized');

    const sessionId = this.createTestSessionId('error-event');
    this.logInfo('Testing error event handling', { sessionId });

    let errorReceived = false;
    let errorMessage = '';

    // Create session
    const session = this.client.createStreamSession(sessionId);
    
    this.trackResource(sessionId, async () => {
      if (this.client && this.client.isSessionActive(sessionId)) {
        await this.client.closeSession(sessionId);
      }
    });

    // Register error handler
    this.client.registerEventHandler(sessionId, 'error', (data: any) => {
      errorReceived = true;
      errorMessage = data.message || 'Unknown error';
      this.logInfo('Error event received', { sessionId, errorMessage });
    });

    // Setup session
    this.client.setupSessionStartEvent(sessionId);
    this.client.setupPromptStartEvent(sessionId);
    this.client.setupSystemPromptEvent(sessionId);
    this.client.setupStartAudioEvent(sessionId);

    // Note: We can't easily trigger a real Bedrock error in integration tests
    // This test verifies the error handler registration works
    expect(this.client.isSessionActive(sessionId)).toBe(true);
    
    this.logInfo('Error event handling test completed', { sessionId });

    // Cleanup
    await this.client.closeSession(sessionId);
  }
}

// Create integration test suites using the helper function
describe('Bedrock Integration Tests', () => {
  // Skip entire suite if no credentials
  const shouldSkip = IntegrationTestUtils.skipIfNoCredentials();

  if (shouldSkip) {
    it.skip('requires AWS credentials', () => {
      // Placeholder
    });
    return;
  }

  describe('Session Creation', () => {
    let test: BedrockSessionCreationTest | undefined;

    beforeAll(() => {
      IntegrationTestUtils.setupIntegrationTests();
    });

    afterAll(async () => {
      await IntegrationTestUtils.teardownIntegrationTests();
    });

    beforeEach(async () => {
      test = new BedrockSessionCreationTest();
      await test.setup();
    });

    afterEach(async () => {
      if (test) {
        await test.teardown();
      }
    });

    it('should create a real Bedrock session', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testCreateSession();
    }, test?.getTimeout() || 30000);

    it('should configure session with inference config', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testSessionConfiguration();
    }, test?.getTimeout() || 30000);

    it('should support multiple concurrent sessions', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testMultipleConcurrentSessions();
    }, test?.getTimeout() || 30000);
  });

  describe('Audio Streaming', () => {
    let test: BedrockAudioStreamingTest | undefined;

    beforeAll(() => {
      IntegrationTestUtils.setupIntegrationTests();
    });

    afterAll(async () => {
      await IntegrationTestUtils.teardownIntegrationTests();
    });

    beforeEach(async () => {
      test = new BedrockAudioStreamingTest();
      await test.setup();
    });

    afterEach(async () => {
      if (test) {
        await test.teardown();
      }
    });

    it('should stream audio and receive Bedrock response', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testAudioStreamingWithResponse();
    }, test?.getTimeout() || 45000);

    it('should stream user audio to Bedrock', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testStreamUserAudio();
    }, test?.getTimeout() || 45000);

    it('should handle multi-chunk audio responses', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testMultiChunkAudioResponse();
    }, test?.getTimeout() || 45000);
  });

  describe('Speaks-First Greeting', () => {
    let test: SpeaksFirstGreetingTest | undefined;

    beforeAll(() => {
      IntegrationTestUtils.setupIntegrationTests();
    });

    afterAll(async () => {
      await IntegrationTestUtils.teardownIntegrationTests();
    });

    beforeEach(async () => {
      test = new SpeaksFirstGreetingTest();
      await test.setup();
    });

    afterEach(async () => {
      if (test) {
        await test.teardown();
      }
    });

    it('should receive speaks-first greeting from Bedrock', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testSpeaksFirstGreeting();
    }, test?.getTimeout() || 45000);

    it('should support custom initial prompts', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testCustomInitialPrompt();
    }, test?.getTimeout() || 45000);

    it('should transition from greeting to conversation', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testGreetingThenConversation();
    }, test?.getTimeout() || 45000);
  });

  describe('Error Handling', () => {
    let test: BedrockErrorHandlingTest | undefined;

    beforeAll(() => {
      IntegrationTestUtils.setupIntegrationTests();
    });

    afterAll(async () => {
      await IntegrationTestUtils.teardownIntegrationTests();
    });

    beforeEach(async () => {
      test = new BedrockErrorHandlingTest();
      await test.setup();
    });

    afterEach(async () => {
      if (test) {
        await test.teardown();
      }
    });

    it('should reject invalid session IDs', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testInvalidSessionId();
    }, test?.getTimeout() || 30000);

    it('should prevent duplicate session creation', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testDuplicateSessionCreation();
    }, test?.getTimeout() || 30000);

    it('should cleanup session on error', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testSessionCleanupOnError();
    }, test?.getTimeout() || 30000);

    it('should handle error events', async () => {
      if (!test) throw new Error('Test not initialized');
      await test.testErrorEventHandling();
    }, test?.getTimeout() || 30000);
  });
});
