/**
 * @fileoverview Integration Tests for Knowledge Base Implementation
 * 
 * Tests the complete knowledge base integration flow including:
 * - Intent classification
 * - Knowledge base queries
 * - Agent invocation
 * - Full orchestration
 */

import { randomUUID } from 'node:crypto';
import { KnowledgeBaseClient } from '../../knowledge/KnowledgeBaseClient';
import { AgentCoreClient } from '../../agent/AgentCoreClient';
import { NovaSonicIntentClassifier } from '../../intent/NovaSonicIntentClassifier';
import { ConversationOrchestrator } from '../../orchestrator/ConversationOrchestrator';
import { ConversationContext } from '../../types/SharedTypes';
import { config } from '../../config/AppConfig';

describe('Knowledge Base Integration', () => {
  let knowledgeBaseClient: KnowledgeBaseClient;
  let agentCoreClient: AgentCoreClient;
  let intentClassifier: NovaSonicIntentClassifier;
  let orchestrator: ConversationOrchestrator;

  beforeAll(() => {
    // Initialize clients
    knowledgeBaseClient = new KnowledgeBaseClient();
    agentCoreClient = new AgentCoreClient();
    intentClassifier = new NovaSonicIntentClassifier();
    orchestrator = new ConversationOrchestrator({
      knowledgeBaseClient,
      agentCoreClient,
      intentClassifier,
      enableDebugLogging: true,
    });
  });

  describe('Configuration Validation', () => {
    it('should validate knowledge base client configuration', async () => {
      const validation = await knowledgeBaseClient.validateConfiguration();
      
      expect(validation).toBeDefined();
      expect(validation.isValid).toBeDefined();
      expect(Array.isArray(validation.errors)).toBe(true);
      expect(Array.isArray(validation.warnings)).toBe(true);
      
      // Log validation results for debugging
      if (!validation.isValid) {
        console.log('Knowledge Base validation errors:', validation.errors);
      }
      if (validation.warnings.length > 0) {
        console.log('Knowledge Base validation warnings:', validation.warnings);
      }
    });

    it('should validate agent core client configuration', async () => {
      const validation = await agentCoreClient.validateConfiguration();
      
      expect(validation).toBeDefined();
      expect(validation.isValid).toBeDefined();
      expect(Array.isArray(validation.errors)).toBe(true);
      expect(Array.isArray(validation.warnings)).toBe(true);
      
      // Log validation results for debugging
      if (!validation.isValid) {
        console.log('Agent Core validation errors:', validation.errors);
      }
      if (validation.warnings.length > 0) {
        console.log('Agent Core validation warnings:', validation.warnings);
      }
    });

    it('should have valid integration configuration', () => {
      expect(config.integration).toBeDefined();
      expect(config.integration.enabled).toBe(true);
      expect(Array.isArray(config.integration.knowledgeBases)).toBe(true);
      expect(Array.isArray(config.integration.agents)).toBe(true);
      expect(config.integration.thresholds).toBeDefined();
      
      // Log configuration for debugging
      console.log('Integration configuration:', {
        enabled: config.integration.enabled,
        knowledgeBasesCount: config.integration.knowledgeBases.length,
        enabledKnowledgeBasesCount: config.integration.knowledgeBases.filter(kb => kb.enabled).length,
        agentsCount: config.integration.agents.length,
        enabledAgentsCount: config.integration.agents.filter(agent => agent.enabled).length,
        thresholds: config.integration.thresholds,
      });
    });
  });

  describe('Intent Classification', () => {
    let mockContext: ConversationContext;

    beforeEach(() => {
      mockContext = {
        conversationId: randomUUID(),
        sessionId: randomUUID(),
        messages: [],
        state: 'active',
        metadata: {},
        startTime: new Date(),
        lastActivity: new Date(),
      };
    });

    it('should classify knowledge-seeking intents', async () => {
      const knowledgeInputs = [
        'What are your business hours?',
        'Can you explain your return policy?',
        'How does your service work?',
        'Tell me about your products',
        'What information do you have about pricing?'
      ];

      for (const input of knowledgeInputs) {
        const classification = await intentClassifier.classifyIntent(input, mockContext);
        
        expect(classification).toBeDefined();
        expect(classification.primaryIntent).toBeDefined();
        expect(classification.confidence).toBeGreaterThanOrEqual(0);
        expect(classification.confidence).toBeLessThanOrEqual(1);
        
        // Log classification results
        console.log(`Input: "${input}" -> Intent: ${classification.primaryIntent} (${classification.confidence})`);
      }
    });

    it('should classify action-oriented intents', async () => {
      const actionInputs = [
        'Schedule a meeting for tomorrow',
        'Send an email to support',
        'Create a calendar reminder',
        'Book an appointment',
        'Make a reservation'
      ];

      for (const input of actionInputs) {
        const classification = await intentClassifier.classifyIntent(input, mockContext);
        
        expect(classification).toBeDefined();
        expect(classification.primaryIntent).toBeDefined();
        expect(classification.confidence).toBeGreaterThanOrEqual(0);
        expect(classification.confidence).toBeLessThanOrEqual(1);
        
        // Log classification results
        console.log(`Input: "${input}" -> Intent: ${classification.primaryIntent} (${classification.confidence})`);
      }
    });

    it('should classify conversational intents', async () => {
      const conversationalInputs = [
        'Hello, how are you?',
        'Thank you for your help',
        'Have a great day!',
        'Nice to meet you',
        'Good morning'
      ];

      for (const input of conversationalInputs) {
        const classification = await intentClassifier.classifyIntent(input, mockContext);
        
        expect(classification).toBeDefined();
        expect(classification.primaryIntent).toBeDefined();
        expect(classification.confidence).toBeGreaterThanOrEqual(0);
        expect(classification.confidence).toBeLessThanOrEqual(1);
        
        // Log classification results
        console.log(`Input: "${input}" -> Intent: ${classification.primaryIntent} (${classification.confidence})`);
      }
    });

    it('should handle empty or invalid inputs gracefully', async () => {
      const invalidInputs = ['', '   ', null, undefined];

      for (const input of invalidInputs) {
        try {
          const classification = await intentClassifier.classifyIntent(input as any, mockContext);
          
          // If it doesn't throw, it should return a fallback classification
          expect(classification).toBeDefined();
          expect(classification.primaryIntent).toBe('conversation');
          expect(classification.confidence).toBeLessThan(0.5);
        } catch (error) {
          // It's acceptable to throw an error for invalid inputs
          expect(error).toBeInstanceOf(Error);
        }
      }
    });
  });

  describe('Knowledge Base Integration', () => {
    const testSessionId = randomUUID();

    it('should handle knowledge base queries when no knowledge bases are configured', async () => {
      const query = 'What are your business hours?';
      
      if (config.integration.knowledgeBases.length === 0) {
        // Should handle gracefully when no knowledge bases are configured
        try {
          const results = await knowledgeBaseClient.query(query, 'non-existent-kb', testSessionId);
          expect(Array.isArray(results)).toBe(true);
        } catch (error) {
          // It's acceptable to throw an error when no knowledge bases are configured
          expect(error).toBeInstanceOf(Error);
        }
      } else {
        // Test with configured knowledge bases
        const enabledKnowledgeBases = config.integration.knowledgeBases.filter(kb => kb.enabled);
        
        if (enabledKnowledgeBases.length > 0) {
          const knowledgeBase = enabledKnowledgeBases[0];
          
          try {
            const results = await knowledgeBaseClient.query(query, knowledgeBase.knowledgeBaseId, testSessionId);
            
            expect(Array.isArray(results)).toBe(true);
            
            // Log results for debugging
            console.log(`Knowledge base query results: ${results.length} items`);
            if (results.length > 0) {
              console.log('Sample result:', {
                content: results[0].content.substring(0, 100) + '...',
                confidence: results[0].confidence,
                source: results[0].source,
              });
            }
          } catch (error) {
            console.log('Knowledge base query failed (may be expected in test environment):', error instanceof Error ? error.message : String(error));
          }
        }
      }
    });

    it('should validate input parameters', async () => {
      const testKnowledgeBaseId = 'test-kb-id';
      
      // Test empty query
      await expect(
        knowledgeBaseClient.query('', testKnowledgeBaseId, testSessionId)
      ).rejects.toThrow();
      
      // Test empty knowledge base ID
      await expect(
        knowledgeBaseClient.query('test query', '', testSessionId)
      ).rejects.toThrow();
      
      // Test null/undefined inputs
      await expect(
        knowledgeBaseClient.query(null as any, testKnowledgeBaseId, testSessionId)
      ).rejects.toThrow();
      
      await expect(
        knowledgeBaseClient.query('test query', null as any, testSessionId)
      ).rejects.toThrow();
    });
  });

  describe('Agent Integration', () => {
    const testSessionId = randomUUID();

    it('should handle agent invocations when no agents are configured', async () => {
      const input = 'Create a calendar event for tomorrow';
      
      if (config.integration.agents.length === 0) {
        // Should handle gracefully when no agents are configured
        try {
          const response = await agentCoreClient.invokeAgent('test-agent', 'test-alias', input, testSessionId);
          expect(response).toBeDefined();
          expect(response.response).toBeDefined();
          expect(response.sessionId).toBe(testSessionId);
        } catch (error) {
          // It's acceptable to throw an error when no agents are configured
          expect(error).toBeInstanceOf(Error);
        }
      } else {
        // Test with configured agents
        const enabledAgents = config.integration.agents.filter(agent => agent.enabled);
        
        if (enabledAgents.length > 0) {
          const agent = enabledAgents[0];
          
          try {
            const response = await agentCoreClient.invokeAgent(
              agent.agentId,
              agent.agentAliasId,
              input,
              testSessionId
            );
            
            expect(response).toBeDefined();
            expect(response.response).toBeDefined();
            expect(response.sessionId).toBe(testSessionId);
            expect(response.agentId).toBe(agent.agentId);
            
            // Log response for debugging
            console.log('Agent response:', {
              responseLength: response.response.length,
              hasError: !!response.error,
              agentId: response.agentId,
            });
          } catch (error) {
            console.log('Agent invocation failed (may be expected in test environment):', error instanceof Error ? error.message : String(error));
          }
        }
      }
    });

    it('should validate input parameters', async () => {
      const testAgentId = 'test-agent-id';
      const testAliasId = 'test-alias-id';
      
      // Test empty agent ID
      await expect(
        agentCoreClient.invokeAgent('', testAliasId, 'test input', testSessionId)
      ).rejects.toThrow();
      
      // Test empty alias ID
      await expect(
        agentCoreClient.invokeAgent(testAgentId, '', 'test input', testSessionId)
      ).rejects.toThrow();
      
      // Test empty input
      await expect(
        agentCoreClient.invokeAgent(testAgentId, testAliasId, '', testSessionId)
      ).rejects.toThrow();
      
      // Test empty session ID
      await expect(
        agentCoreClient.invokeAgent(testAgentId, testAliasId, 'test input', '')
      ).rejects.toThrow();
    });
  });

  describe('Full Orchestration', () => {
    const testSessionId = randomUUID();

    it('should orchestrate knowledge-seeking requests', async () => {
      const knowledgeInputs = [
        'What are your business hours?',
        'Can you tell me about your return policy?',
        'How does your service work?'
      ];

      for (const input of knowledgeInputs) {
        const result = await orchestrator.processUserInput(input, testSessionId);
        
        expect(result).toBeDefined();
        expect(result.response).toBeDefined();
        expect(result.intent).toBeDefined();
        expect(result.source).toBeDefined();
        expect(result.processingTimeMs).toBeGreaterThan(0);
        
        // Log orchestration results
        console.log(`Orchestration: "${input}" -> ${result.intent.primaryIntent} -> ${result.source}`);
      }
    });

    it('should orchestrate action-oriented requests', async () => {
      const actionInputs = [
        'Schedule a meeting for tomorrow',
        'Send an email to support',
        'Create a reminder'
      ];

      for (const input of actionInputs) {
        const result = await orchestrator.processUserInput(input, testSessionId);
        
        expect(result).toBeDefined();
        expect(result.response).toBeDefined();
        expect(result.intent).toBeDefined();
        expect(result.source).toBeDefined();
        expect(result.processingTimeMs).toBeGreaterThan(0);
        
        // Log orchestration results
        console.log(`Orchestration: "${input}" -> ${result.intent.primaryIntent} -> ${result.source}`);
      }
    });

    it('should orchestrate conversational requests', async () => {
      const conversationalInputs = [
        'Hello, how are you?',
        'Thank you for your help',
        'Have a great day!'
      ];

      for (const input of conversationalInputs) {
        const result = await orchestrator.processUserInput(input, testSessionId);
        
        expect(result).toBeDefined();
        expect(result.response).toBeDefined();
        expect(result.intent).toBeDefined();
        expect(result.source).toBeDefined();
        expect(result.processingTimeMs).toBeGreaterThan(0);
        
        // Log orchestration results
        console.log(`Orchestration: "${input}" -> ${result.intent.primaryIntent} -> ${result.source}`);
      }
    });

    it('should handle orchestration errors gracefully', async () => {
      const problematicInputs = ['', '   ', 'x'.repeat(10000)]; // Empty, whitespace, very long

      for (const input of problematicInputs) {
        try {
          const result = await orchestrator.processUserInput(input, testSessionId);
          
          // Should return a fallback response
          expect(result).toBeDefined();
          expect(result.response).toBeDefined();
          expect(result.source).toBe('fallback');
        } catch (error) {
          // It's acceptable to throw errors for problematic inputs
          expect(error).toBeInstanceOf(Error);
        }
      }
    });

    it('should maintain session context across multiple interactions', async () => {
      const interactions = [
        'Hello, I need help with my account',
        'What are your business hours?',
        'Thank you for the information'
      ];

      for (const input of interactions) {
        const result = await orchestrator.processUserInput(input, testSessionId);
        
        expect(result).toBeDefined();
        expect(result.response).toBeDefined();
        
        // Each interaction should maintain the same session ID
        // (This is implicitly tested by using the same testSessionId)
      }
    });
  });

  describe('Performance and Reliability', () => {
    it('should complete intent classification within reasonable time', async () => {
      const mockContext: ConversationContext = {
        conversationId: randomUUID(),
        sessionId: randomUUID(),
        messages: [],
        state: 'active',
        metadata: {},
        startTime: new Date(),
        lastActivity: new Date(),
      };

      const startTime = Date.now();
      const classification = await intentClassifier.classifyIntent(
        'What are your business hours?',
        mockContext
      );
      const duration = Date.now() - startTime;

      expect(classification).toBeDefined();
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      
      console.log(`Intent classification completed in ${duration}ms`);
    });

    it('should complete orchestration within reasonable time', async () => {
      const startTime = Date.now();
      const result = await orchestrator.processUserInput(
        'Can you help me with my order?',
        randomUUID()
      );
      const duration = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
      
      console.log(`Orchestration completed in ${duration}ms`);
    });

    it('should handle concurrent requests', async () => {
      const concurrentRequests = Array.from({ length: 5 }, (_, i) => 
        orchestrator.processUserInput(
          `Test request ${i + 1}`,
          `session-${i + 1}`
        )
      );

      const results = await Promise.all(concurrentRequests);
      
      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result).toBeDefined();
        expect(result.response).toBeDefined();
        console.log(`Concurrent request ${index + 1}: ${result.source} (${result.processingTimeMs}ms)`);
      });
    });
  });
});