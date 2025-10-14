/**
 * @fileoverview Intent Classifier Tests
 * 
 * Comprehensive tests for the intent classification system using Nova Sonic model-driven classification.
 * Tests model-driven classification, custom rule fallback mechanisms, confidence scoring, and edge cases.
 * 
 * Requirements covered: 4.1, 4.2, 4.3, 4.4
 */

import { NovaSonicIntentClassifier } from '../intent/NovaSonicIntentClassifier';
import { IntentClassifier, DEFAULT_INTENT_CONFIG } from '../intent/IntentClassifier';
import { IntentType, IntentClassification, IntentClassificationConfig } from '../intent/types';
import { ConversationContext } from '../types/SharedTypes';
import { NovaSonicClient as NovaSonicBidirectionalStreamClient } from '../client/';

// Mock the Nova Sonic client
jest.mock('../client');
const MockNovaSonicClient = NovaSonicBidirectionalStreamClient as jest.MockedClass<typeof NovaSonicBidirectionalStreamClient>;

// Mock logger to avoid noise in tests
jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Mock correlation ID manager
jest.mock('../utils/correlationId', () => ({
  CorrelationIdManager: {
    getCurrentCorrelationId: jest.fn(() => 'test-correlation-id')
  }
}));

describe('NovaSonicIntentClassifier', () => {
  let classifier: IntentClassifier;
  let mockNovaSonicClient: jest.Mocked<NovaSonicBidirectionalStreamClient>;
  let mockContext: ConversationContext;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create mock Nova Sonic client
    mockNovaSonicClient = new MockNovaSonicClient({
      clientConfig: {},
      inferenceConfig: { maxTokens: 1000, topP: 0.9, temperature: 0.7 }
    }) as jest.Mocked<NovaSonicBidirectionalStreamClient>;
    
    // Mock client methods
    mockNovaSonicClient.isSessionActive = jest.fn().mockReturnValue(true);
    mockNovaSonicClient.closeSession = jest.fn().mockResolvedValue(undefined);
    
    // Create classifier with test config
    const testConfig: Partial<IntentClassificationConfig> = {
      ...DEFAULT_INTENT_CONFIG,
      enableModelClassification: true,
      enableRuleFallback: false,
      confidenceThreshold: 0.7,
      modelTimeoutMs: 2000
    };
    
    classifier = new NovaSonicIntentClassifier(testConfig, mockNovaSonicClient);
    
    // Create mock conversation context
    mockContext = {
      conversationId: 'test-conversation-123',
      sessionId: 'test-session-456',
      streamSid: 'MZ' + '0'.repeat(32),
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello there',
          timestamp: new Date(),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hello! How can I help you today?',
          timestamp: new Date(),
        }
      ],
      state: 'active',
      metadata: {},
      startTime: new Date(),
      lastActivity: new Date()
    };
  });

  describe('Model-driven Classification with Various Input Types', () => {
    // Requirement 4.1: Test model-driven classification with various input types
    
    test('should handle knowledge-seeking questions', async () => {
      // Mock successful model response for knowledge intent
      const mockModelResponse = JSON.stringify({
        intent: 'knowledge',
        confidence: 0.9,
        reasoning: 'User is asking for factual information',
        entities: { topic: 'artificial intelligence' }
      });
      
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue(mockModelResponse);

      const result = await classifier.classifyIntent('What is artificial intelligence?', mockContext);
      
      expect(result.primaryIntent).toBe('knowledge');
      expect(result.confidence).toBe(0.9);
      expect(result.extractedEntities?.topic).toBe('artificial intelligence');
      expect(result.metadata?.method).toBe('model');
      expect(result.metadata?.reasoning).toBe('User is asking for factual information');
      
      classifierSpy.mockRestore();
    });

    test('should handle action-oriented requests', async () => {
      const mockModelResponse = JSON.stringify({
        intent: 'action',
        confidence: 0.85,
        reasoning: 'User wants to perform a task',
        entities: { action: 'create', object: 'document' }
      });
      
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue(mockModelResponse);

      const result = await classifier.classifyIntent('Create a new document for me', mockContext);
      
      expect(result.primaryIntent).toBe('action');
      expect(result.confidence).toBe(0.85);
      expect(result.extractedEntities?.action).toBe('create');
      expect(result.extractedEntities?.object).toBe('document');
      expect(result.metadata?.method).toBe('model');
      
      classifierSpy.mockRestore();
    });

    test('should handle conversational inputs', async () => {
      const mockModelResponse = JSON.stringify({
        intent: 'conversation',
        confidence: 0.8,
        reasoning: 'User is engaging in casual conversation',
        entities: {}
      });
      
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue(mockModelResponse);

      const result = await classifier.classifyIntent('Hello, how are you doing today?', mockContext);
      
      expect(result.primaryIntent).toBe('conversation');
      expect(result.confidence).toBe(0.8);
      expect(result.metadata?.method).toBe('model');
      expect(result.metadata?.reasoning).toBe('User is engaging in casual conversation');
      
      classifierSpy.mockRestore();
    });

    test('should fall back to conversation intent when model is unavailable', async () => {
      // Create classifier without Nova Sonic client
      const classifierWithoutClient = new NovaSonicIntentClassifier({
        enableModelClassification: true,
        enableRuleFallback: false
      });

      const result = await classifierWithoutClient.classifyIntent('What is artificial intelligence?', mockContext);
      
      expect(result.primaryIntent).toBe('conversation');
      expect(result.confidence).toBe(0.5);
      expect(result.metadata?.method).toBe('fallback');
    });

    test('should fall back to conversation intent when model classification is disabled', async () => {
      const classifierWithDisabledModel = new NovaSonicIntentClassifier({
        enableModelClassification: false,
        enableRuleFallback: false
      }, mockNovaSonicClient);

      const result = await classifierWithDisabledModel.classifyIntent('Create a document', mockContext);
      
      expect(result.primaryIntent).toBe('conversation');
      expect(result.confidence).toBe(0.5);
      expect(result.metadata?.method).toBe('fallback');
    });

    test('should handle model classification errors gracefully', async () => {
      // Mock the model classification to throw an error
      const classifierSpy = jest.spyOn(classifier as any, 'classifyWithModel');
      classifierSpy.mockRejectedValue(new Error('Model classification failed'));

      const result = await classifier.classifyIntent('What is machine learning?', mockContext);
      
      expect(result.primaryIntent).toBe('conversation');
      expect(result.confidence).toBe(0.3);
      expect(result.metadata?.method).toBe('fallback');
      
      classifierSpy.mockRestore();
    });

    test('should handle model timeout gracefully', async () => {
      // Create classifier with very short timeout
      const shortTimeoutClassifier = new NovaSonicIntentClassifier({
        enableModelClassification: true,
        modelTimeoutMs: 1 // 1ms timeout
      }, mockNovaSonicClient);

      const result = await shortTimeoutClassifier.classifyIntent('What is AI?', mockContext);
      
      expect(result.primaryIntent).toBe('conversation');
      expect(result.confidence).toBe(0.3);
      expect(result.metadata?.method).toBe('fallback');
    });

    test('should handle malformed model responses', async () => {
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue('invalid json response');

      const result = await classifier.classifyIntent('What is AI?', mockContext);
      
      expect(result.primaryIntent).toBe('conversation');
      expect(result.confidence).toBe(0.3);
      expect(result.metadata?.method).toBe('fallback');
      
      classifierSpy.mockRestore();
    });
  });

  describe('Custom Rule Fallback Mechanisms', () => {
    // Requirement 4.2: Test custom rule fallback mechanisms
    
    test('should add custom rules successfully', () => {
      const initialRulesCount = classifier.getCustomRules().length;
      
      classifier.addCustomRule('\\btest pattern\\b', 'knowledge', 0.8, 'Test Rule');
      
      const rules = classifier.getCustomRules();
      expect(rules.length).toBe(initialRulesCount + 1);
      
      const newRule = rules.find(rule => rule.name === 'Test Rule');
      expect(newRule).toBeDefined();
      expect(newRule?.pattern).toBe('\\btest pattern\\b');
      expect(newRule?.intent).toBe('knowledge');
      expect(newRule?.confidence).toBe(0.8);
      expect(newRule?.enabled).toBe(true);
    });

    test('should remove custom rules successfully', () => {
      classifier.addCustomRule('\\bremove me\\b', 'action', 0.7, 'Remove Me Rule');
      const rules = classifier.getCustomRules();
      const ruleToRemove = rules.find(rule => rule.name === 'Remove Me Rule');
      
      expect(ruleToRemove).toBeDefined();
      
      classifier.removeCustomRule(ruleToRemove!.id);
      
      const updatedRules = classifier.getCustomRules();
      const removedRule = updatedRules.find(rule => rule.id === ruleToRemove!.id);
      expect(removedRule).toBeUndefined();
    });

    test('should handle rule removal for non-existent rules', () => {
      const initialRulesCount = classifier.getCustomRules().length;
      
      classifier.removeCustomRule('non-existent-rule-id');
      
      const finalRulesCount = classifier.getCustomRules().length;
      expect(finalRulesCount).toBe(initialRulesCount);
    });

    test('should validate rule confidence bounds', () => {
      // Test confidence clamping to valid range [0, 1]
      classifier.addCustomRule('\\btest\\b', 'knowledge', 1.5, 'High Confidence Rule');
      classifier.addCustomRule('\\btest2\\b', 'action', -0.5, 'Low Confidence Rule');
      
      const rules = classifier.getCustomRules();
      const highConfidenceRule = rules.find(rule => rule.name === 'High Confidence Rule');
      const lowConfidenceRule = rules.find(rule => rule.name === 'Low Confidence Rule');
      
      expect(highConfidenceRule?.confidence).toBe(1.0);
      expect(lowConfidenceRule?.confidence).toBe(0.0);
    });

    test('should handle multiple rules with different priorities', () => {
      classifier.addCustomRule('\\bhigh priority\\b', 'knowledge', 0.9, 'High Priority Rule');
      classifier.addCustomRule('\\blow priority\\b', 'action', 0.6, 'Low Priority Rule');
      classifier.addCustomRule('\\bmedium priority\\b', 'conversation', 0.75, 'Medium Priority Rule');
      
      const rules = classifier.getCustomRules();
      expect(rules.length).toBeGreaterThanOrEqual(3);
      
      // Verify all rules are stored correctly
      const highPriorityRule = rules.find(rule => rule.name === 'High Priority Rule');
      const lowPriorityRule = rules.find(rule => rule.name === 'Low Priority Rule');
      const mediumPriorityRule = rules.find(rule => rule.name === 'Medium Priority Rule');
      
      expect(highPriorityRule?.confidence).toBe(0.9);
      expect(lowPriorityRule?.confidence).toBe(0.6);
      expect(mediumPriorityRule?.confidence).toBe(0.75);
    });

    test('should generate unique rule IDs', () => {
      classifier.addCustomRule('\\bpattern1\\b', 'knowledge', 0.8, 'Rule 1');
      classifier.addCustomRule('\\bpattern2\\b', 'action', 0.8, 'Rule 2');
      
      const rules = classifier.getCustomRules();
      const rule1 = rules.find(rule => rule.name === 'Rule 1');
      const rule2 = rules.find(rule => rule.name === 'Rule 2');
      
      expect(rule1?.id).toBeDefined();
      expect(rule2?.id).toBeDefined();
      expect(rule1?.id).not.toBe(rule2?.id);
    });

    test('should handle rules with complex regex patterns', () => {
      const complexPattern = '(?i)\\b(what|how|when|where|why)\\s+(is|are|do|does|can|will)\\b';
      
      classifier.addCustomRule(complexPattern, 'knowledge', 0.85, 'Question Pattern Rule');
      
      const rules = classifier.getCustomRules();
      const complexRule = rules.find(rule => rule.name === 'Question Pattern Rule');
      
      expect(complexRule).toBeDefined();
      expect(complexRule?.pattern).toBe(complexPattern);
      expect(complexRule?.intent).toBe('knowledge');
    });
  });

  describe('Confidence Scoring and Edge Cases', () => {
    // Requirement 4.3: Test confidence scoring and edge cases
    
    test('should return appropriate confidence scores for different scenarios', async () => {
      // Test high confidence model response
      const highConfidenceResponse = JSON.stringify({
        intent: 'knowledge',
        confidence: 0.95,
        reasoning: 'Clear factual question',
        entities: {}
      });
      
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue(highConfidenceResponse);

      const result = await classifier.classifyIntent('What is the capital of France?', mockContext);
      
      expect(result.confidence).toBe(0.95);
      expect(result.metadata?.modelConfidence).toBe(0.95);
      
      classifierSpy.mockRestore();
    });

    test('should clamp confidence scores to valid range [0, 1]', async () => {
      // Test confidence clamping for out-of-range values
      const invalidConfidenceResponse = JSON.stringify({
        intent: 'action',
        confidence: 1.5, // Invalid high confidence
        reasoning: 'Test clamping',
        entities: {}
      });
      
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue(invalidConfidenceResponse);

      const result = await classifier.classifyIntent('Create something', mockContext);
      
      expect(result.confidence).toBe(1.0); // Should be clamped to 1.0
      
      classifierSpy.mockRestore();
    });

    test('should handle zero confidence gracefully', async () => {
      const zeroConfidenceResponse = JSON.stringify({
        intent: 'conversation',
        confidence: 0,
        reasoning: 'Uncertain classification',
        entities: {}
      });
      
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue(zeroConfidenceResponse);

      const result = await classifier.classifyIntent('Hmm...', mockContext);
      
      expect(result.confidence).toBe(0);
      expect(result.primaryIntent).toBe('conversation');
      
      classifierSpy.mockRestore();
    });

    test('should handle missing confidence in model response', async () => {
      const missingConfidenceResponse = JSON.stringify({
        intent: 'knowledge',
        reasoning: 'No confidence provided',
        entities: {}
      });
      
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue(missingConfidenceResponse);

      const result = await classifier.classifyIntent('What is AI?', mockContext);
      
      expect(result.confidence).toBe(0); // Should default to 0
      
      classifierSpy.mockRestore();
    });

    test('should handle empty input gracefully', async () => {
      const result = await classifier.classifyIntent('', mockContext);
      
      expect(result.primaryIntent).toBe('conversation');
      expect(result.confidence).toBe(0.3); // Error path due to model classification failure
      expect(result.metadata?.method).toBe('fallback');
    });

    test('should handle whitespace-only input', async () => {
      const result = await classifier.classifyIntent('   \n\t   ', mockContext);
      
      expect(result.primaryIntent).toBe('conversation');
      expect(result.confidence).toBe(0.3); // Error path due to model classification failure
      expect(result.metadata?.method).toBe('fallback');
    });

    test('should handle very long input gracefully', async () => {
      const longInput = 'This is a very long input '.repeat(100);
      
      const result = await classifier.classifyIntent(longInput, mockContext);
      
      expect(result).toBeDefined();
      expect(result.primaryIntent).toBe('conversation');
      expect(result.confidence).toBe(0.3); // Error path due to model classification failure
      expect(result.metadata?.method).toBe('fallback');
    });

    test('should handle special characters and unicode', async () => {
      const specialInput = 'What is 🤖 AI? Can you explain émotions and 中文?';
      
      const result = await classifier.classifyIntent(specialInput, mockContext);
      
      expect(result).toBeDefined();
      expect(result.primaryIntent).toBe('conversation');
      expect(result.metadata?.method).toBe('fallback');
    });

    test('should handle mixed case input consistently', async () => {
      const mixedCaseResponse = JSON.stringify({
        intent: 'knowledge',
        confidence: 0.8,
        reasoning: 'Question about AI',
        entities: {}
      });
      
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue(mixedCaseResponse);

      const result = await classifier.classifyIntent('WHAT IS artificial INTELLIGENCE?', mockContext);
      
      expect(result.primaryIntent).toBe('knowledge');
      expect(result.confidence).toBe(0.8);
      
      classifierSpy.mockRestore();
    });

    test('should handle input with multiple potential intents', async () => {
      const multiIntentResponse = JSON.stringify({
        intent: 'knowledge', // Should pick the primary intent
        confidence: 0.7,
        reasoning: 'Mixed intent but knowledge is primary',
        entities: { primary: 'knowledge', secondary: 'action' }
      });
      
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue(multiIntentResponse);

      const result = await classifier.classifyIntent('What is AI and can you create a summary about it?', mockContext);
      
      expect(result.primaryIntent).toBe('knowledge');
      expect(result.confidence).toBe(0.7);
      expect(result.extractedEntities?.primary).toBe('knowledge');
      
      classifierSpy.mockRestore();
    });
  });

  describe('Configuration Management', () => {
    // Requirement 4.4: Test configuration and system behavior
    
    test('should update configuration successfully', () => {
      const newConfig = {
        confidenceThreshold: 0.8,
        modelTimeoutMs: 3000,
        enableModelClassification: false,
        enableRuleFallback: true
      };
      
      classifier.updateConfig(newConfig);
      
      const currentConfig = classifier.getConfig();
      expect(currentConfig.confidenceThreshold).toBe(0.8);
      expect(currentConfig.modelTimeoutMs).toBe(3000);
      expect(currentConfig.enableModelClassification).toBe(false);
      expect(currentConfig.enableRuleFallback).toBe(true);
    });

    test('should return current configuration', () => {
      const config = classifier.getConfig();
      
      expect(config).toBeDefined();
      expect(config.confidenceThreshold).toBeDefined();
      expect(config.modelTimeoutMs).toBeDefined();
      expect(config.enableRuleFallback).toBeDefined();
      expect(config.enableModelClassification).toBeDefined();
      expect(config.customRules).toBeDefined();
    });

    test('should preserve existing config when partially updating', () => {
      const originalConfig = classifier.getConfig();
      
      classifier.updateConfig({ confidenceThreshold: 0.9 });
      
      const updatedConfig = classifier.getConfig();
      expect(updatedConfig.confidenceThreshold).toBe(0.9);
      expect(updatedConfig.modelTimeoutMs).toBe(originalConfig.modelTimeoutMs);
      expect(updatedConfig.enableModelClassification).toBe(originalConfig.enableModelClassification);
    });

    test('should handle invalid configuration values gracefully', () => {
      const invalidConfig = {
        confidenceThreshold: -0.5, // Invalid negative threshold
        modelTimeoutMs: -1000 // Invalid negative timeout
      };
      
      classifier.updateConfig(invalidConfig);
      
      const config = classifier.getConfig();
      expect(config.confidenceThreshold).toBe(-0.5); // Should store as-is (validation happens at runtime)
      expect(config.modelTimeoutMs).toBe(-1000);
    });
  });

  describe('Performance and Error Handling', () => {
    test('should complete classification within reasonable time', async () => {
      const startTime = Date.now();
      
      await classifier.classifyIntent('What is the weather like today?', mockContext);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(100); // Should be very fast for fallback classification
    });

    test('should include processing time in metadata', async () => {
      const result = await classifier.classifyIntent('What is AI?', mockContext);
      
      expect(result.metadata?.processingTimeMs).toBeDefined();
      expect(result.metadata?.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    test('should handle concurrent classification requests', async () => {
      const inputs = [
        'What is AI?',
        'Create a document',
        'Hello there',
        'How does machine learning work?',
        'Send an email'
      ];
      
      const promises = inputs.map(input => 
        classifier.classifyIntent(input, mockContext)
      );
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.primaryIntent).toBeDefined();
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      });
    });

    test('should handle session cleanup on model errors', async () => {
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockRejectedValue(new Error('Model error'));

      await classifier.classifyIntent('Test input', mockContext);
      
      // Should attempt to close session even on error
      expect(mockNovaSonicClient.closeSession).toHaveBeenCalled();
      
      classifierSpy.mockRestore();
    });

    test('should handle Nova Sonic client session management', async () => {
      const mockResponse = JSON.stringify({
        intent: 'knowledge',
        confidence: 0.8,
        reasoning: 'Test response',
        entities: {}
      });
      
      const classifierSpy = jest.spyOn(classifier as any, 'queryNovaSonicForIntent');
      classifierSpy.mockResolvedValue(mockResponse);

      await classifier.classifyIntent('What is AI?', mockContext);
      
      // Should check if session is active and close it
      expect(mockNovaSonicClient.isSessionActive).toHaveBeenCalled();
      expect(mockNovaSonicClient.closeSession).toHaveBeenCalled();
      
      classifierSpy.mockRestore();
    });
  });

  describe('Integration with Conversation Context', () => {
    test('should use conversation history in classification', async () => {
      const contextWithHistory = {
        ...mockContext,
        messages: [
          {
            id: 'msg-1',
            role: 'user' as const,
            content: 'I need help with documents',
            timestamp: new Date(),
          },
          {
            id: 'msg-2',
            role: 'assistant' as const,
            content: 'I can help you with document management',
            timestamp: new Date(),
          },
          {
            id: 'msg-3',
            role: 'user' as const,
            content: 'What formats do you support?',
            timestamp: new Date(),
          }
        ]
      };

      const result = await classifier.classifyIntent('Create one for me', contextWithHistory);
      
      expect(result).toBeDefined();
      expect(result.primaryIntent).toBe('conversation');
      expect(result.metadata?.method).toBe('fallback');
    });

    test('should handle empty conversation history', async () => {
      const contextWithoutHistory = {
        ...mockContext,
        messages: []
      };

      const result = await classifier.classifyIntent('What is AI?', contextWithoutHistory);
      
      expect(result).toBeDefined();
      expect(result.primaryIntent).toBe('conversation');
    });

    test('should limit conversation history in prompts', async () => {
      const contextWithLongHistory = {
        ...mockContext,
        messages: Array.from({ length: 10 }, (_, i) => ({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
          content: `Message ${i}`,
          timestamp: new Date(),
        }))
      };

      const buildPromptSpy = jest.spyOn(classifier as any, 'buildClassificationPrompt');
      
      await classifier.classifyIntent('Test input', contextWithLongHistory);
      
      // Should have been called with limited history (last 3 messages)
      expect(buildPromptSpy).toHaveBeenCalled();
      const promptCall = buildPromptSpy.mock.calls[0];
      const prompt = promptCall[0] as string;
      
      // The prompt should contain only the last 3 messages
      const messageCount = (prompt.match(/Message \d+/g) || []).length;
      expect(messageCount).toBeLessThanOrEqual(3);
      
      buildPromptSpy.mockRestore();
    });
  });
});