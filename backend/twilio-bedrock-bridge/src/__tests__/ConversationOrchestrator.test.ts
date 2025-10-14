/**
 * @fileoverview Comprehensive unit tests for Conversation Orchestrator
 * 
 * Tests cover:
 * - Test routing logic for different intent types
 * - Test integration with knowledge base and agent clients
 * - Test fallback to Nova Sonic for conversation intents
 * - Requirements: 1.1, 1.3, 2.1, 2.3, 2.4, 4.1, 4.2, 4.3
 */

import { 
  ConversationOrchestrator, 
  IConversationOrchestrator,
  ConversationOrchestratorConfig,
  OrchestrationResult,
  createConversationOrchestrator 
} from '../orchestrator/ConversationOrchestrator';
import { IntentClassifier } from '../intent/IntentClassifier';
import { NovaSonicIntentClassifier } from '../intent/NovaSonicIntentClassifier';
import { IKnowledgeBaseClient } from '../knowledge/KnowledgeBaseClient';
import { IAgentCoreClient } from '../agent/AgentCoreClient';
import { NovaSonicClient as NovaSonicBidirectionalStreamClient } from '../client/';
import { ConversationContext } from '../types/SharedTypes';
import { IntentClassification, KnowledgeResult, AgentResponse } from '../types/IntegrationTypes';

// Mock dependencies
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../utils/correlationId', () => ({
  CorrelationIdManager: {
    getCurrentCorrelationId: jest.fn(() => 'test-correlation-id'),
  },
}));

jest.mock('../config/AppConfig', () => ({
  config: {
    integration: {
      knowledgeBases: [
        { id: 'kb1', knowledgeBaseId: 'kb-123', enabled: true },
        { id: 'kb2', knowledgeBaseId: 'kb-456', enabled: false },
        { id: 'kb3', knowledgeBaseId: 'kb-789', enabled: true },
      ],
      agents: [
        { id: 'agent1', agentId: 'agent-123', agentAliasId: 'alias-123', enabled: true },
        { id: 'agent2', agentId: 'agent-456', agentAliasId: 'alias-456', enabled: false },
        { id: 'agent3', agentId: 'agent-789', agentAliasId: 'alias-789', enabled: true },
      ],
    },
  },
}));

jest.mock('../observability/dataProtection', () => ({
  DataProtection: {
    sanitizeUserInput: jest.fn((input, sessionId) => ({
      sanitizedText: input,
      sanitizationApplied: false,
      detectedPatterns: [],
    })),
    sanitizeSystemOutput: jest.fn((output, sessionId) => ({
      sanitizedText: output,
      sanitizationApplied: false,
      detectedPatterns: [],
    })),
  },
}));

// Mock the Nova Sonic client
jest.mock('../client');
const MockNovaSonicClient = NovaSonicBidirectionalStreamClient as jest.MockedClass<typeof NovaSonicBidirectionalStreamClient>;

describe('ConversationOrchestrator', () => {
  let orchestrator: ConversationOrchestrator;
  let mockIntentClassifier: jest.Mocked<IntentClassifier>;
  let mockKnowledgeBaseClient: jest.Mocked<IKnowledgeBaseClient>;
  let mockAgentCoreClient: jest.Mocked<IAgentCoreClient>;
  let mockNovaSonicClient: jest.Mocked<NovaSonicBidirectionalStreamClient>;
  let mockContext: ConversationContext;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the mocked config to ensure clean state
    const { config } = require('../config/AppConfig');
    config.integration.knowledgeBases = [
      { id: 'kb1', knowledgeBaseId: 'kb-123', enabled: true },
      { id: 'kb2', knowledgeBaseId: 'kb-456', enabled: false },
      { id: 'kb3', knowledgeBaseId: 'kb-789', enabled: true },
    ];
    config.integration.agents = [
      { id: 'agent1', agentId: 'agent-123', agentAliasId: 'alias-123', enabled: true },
      { id: 'agent2', agentId: 'agent-456', agentAliasId: 'alias-456', enabled: false },
      { id: 'agent3', agentId: 'agent-789', agentAliasId: 'alias-789', enabled: true },
    ];

    // Create mock clients
    mockIntentClassifier = {
      classifyIntent: jest.fn(),
      addCustomRule: jest.fn(),
      removeCustomRule: jest.fn(),
      getCustomRules: jest.fn().mockReturnValue([]),
      updateConfig: jest.fn(),
      getConfig: jest.fn().mockReturnValue({}),
    } as jest.Mocked<IntentClassifier>;

    mockKnowledgeBaseClient = {
      query: jest.fn(),
      validateConfiguration: jest.fn(),
    } as jest.Mocked<IKnowledgeBaseClient>;

    mockAgentCoreClient = {
      invokeAgent: jest.fn(),
      validateConfiguration: jest.fn(),
    } as jest.Mocked<IAgentCoreClient>;

    mockNovaSonicClient = new MockNovaSonicClient({
      clientConfig: {},
      inferenceConfig: { maxTokens: 1000, topP: 0.9, temperature: 0.7 }
    }) as jest.Mocked<NovaSonicBidirectionalStreamClient>;

    // Create orchestrator with mocked dependencies
    const orchestratorConfig: ConversationOrchestratorConfig = {
      intentClassifier: mockIntentClassifier,
      knowledgeBaseClient: mockKnowledgeBaseClient,
      agentCoreClient: mockAgentCoreClient,
      novaSonicClient: mockNovaSonicClient,
      enableDebugLogging: true,
    };

    orchestrator = new ConversationOrchestrator(orchestratorConfig);

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

  describe('Constructor and Configuration', () => {
    it('should create orchestrator with default configuration', () => {
      const defaultOrchestrator = new ConversationOrchestrator();
      expect(defaultOrchestrator).toBeInstanceOf(ConversationOrchestrator);
    });

    it('should create orchestrator with custom configuration', () => {
      const customConfig: ConversationOrchestratorConfig = {
        enableDebugLogging: false,
      };
      
      const customOrchestrator = new ConversationOrchestrator(customConfig);
      expect(customOrchestrator).toBeInstanceOf(ConversationOrchestrator);
    });

    it('should use factory function to create orchestrator', () => {
      const factoryOrchestrator = createConversationOrchestrator();
      expect(factoryOrchestrator).toBeInstanceOf(ConversationOrchestrator);
    });

    it('should use factory function with config', () => {
      const config: ConversationOrchestratorConfig = {
        enableDebugLogging: true,
      };
      
      const factoryOrchestrator = createConversationOrchestrator(config);
      expect(factoryOrchestrator).toBeInstanceOf(ConversationOrchestrator);
    });

    it('should update configuration successfully', () => {
      const newConfig: Partial<ConversationOrchestratorConfig> = {
        enableDebugLogging: false,
      };
      
      orchestrator.updateConfig(newConfig);
      
      // Configuration update should not throw
      expect(() => orchestrator.updateConfig(newConfig)).not.toThrow();
    });
  });

  describe('Routing Logic for Different Intent Types', () => {
    // Requirement 4.1, 4.2, 4.3: Test routing logic for different intent types

    describe('Knowledge Intent Routing', () => {
      it('should route knowledge intents to knowledge base client', async () => {
        // Mock intent classification for knowledge
        const knowledgeIntent: IntentClassification = {
          primaryIntent: 'knowledge',
          confidence: 0.9,
          extractedEntities: { topic: 'machine learning' },
          metadata: { method: 'model' },
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(knowledgeIntent);

        // Mock knowledge base response
        const knowledgeResults: KnowledgeResult[] = [
          {
            content: 'Machine learning is a subset of artificial intelligence.',
            source: 's3://bucket/ml-doc.pdf',
            confidence: 0.95,
            knowledgeBaseId: 'kb-123',
            metadata: { score: 0.95 },
          },
        ];
        mockKnowledgeBaseClient.query.mockResolvedValue(knowledgeResults);

        const result = await orchestrator.processUserInput(
          'What is machine learning?',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('knowledge');
        expect(result.intent.primaryIntent).toBe('knowledge');
        expect(result.knowledgeResults).toEqual(knowledgeResults);
        expect(result.response).toContain('Machine learning is a subset of artificial intelligence');
        expect(mockKnowledgeBaseClient.query).toHaveBeenCalledWith(
          'What is machine learning?',
          'kb-123',
          'session-123'
        );
      });

      it('should handle multiple enabled knowledge bases', async () => {
        const knowledgeIntent: IntentClassification = {
          primaryIntent: 'knowledge',
          confidence: 0.85,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(knowledgeIntent);

        const knowledgeResults: KnowledgeResult[] = [
          {
            content: 'Knowledge base result',
            source: 'test-source',
            confidence: 0.8,
            knowledgeBaseId: 'kb-123',
            metadata: {},
          },
        ];
        mockKnowledgeBaseClient.query.mockResolvedValue(knowledgeResults);

        const result = await orchestrator.processUserInput(
          'Tell me about AI',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('knowledge');
        expect(mockKnowledgeBaseClient.query).toHaveBeenCalledWith(
          'Tell me about AI',
          'kb-123', // Should use first enabled knowledge base
          'session-123'
        );
      });

      it('should fallback to Nova Sonic when no enabled knowledge bases', async () => {
        // Mock config with no enabled knowledge bases
        const { config } = require('../config/AppConfig');
        config.integration.knowledgeBases = [
          { id: 'kb1', knowledgeBaseId: 'kb-123', enabled: false },
        ];

        const knowledgeIntent: IntentClassification = {
          primaryIntent: 'knowledge',
          confidence: 0.8,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(knowledgeIntent);

        const result = await orchestrator.processUserInput(
          'What is AI?',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('conversation');
        expect(mockKnowledgeBaseClient.query).not.toHaveBeenCalled();
        expect(result.response).toContain('Could you tell me more');
      });

      it('should fallback to Nova Sonic when knowledge base returns no results', async () => {
        const knowledgeIntent: IntentClassification = {
          primaryIntent: 'knowledge',
          confidence: 0.8,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(knowledgeIntent);

        // Mock empty knowledge base response
        mockKnowledgeBaseClient.query.mockResolvedValue([]);

        const result = await orchestrator.processUserInput(
          'What is quantum computing?',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('conversation');
        expect(mockKnowledgeBaseClient.query).toHaveBeenCalled();
        expect(result.response).toContain('Could you tell me more');
      });

      it('should fallback to Nova Sonic when knowledge base client fails', async () => {
        const knowledgeIntent: IntentClassification = {
          primaryIntent: 'knowledge',
          confidence: 0.8,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(knowledgeIntent);

        // Mock knowledge base error
        mockKnowledgeBaseClient.query.mockRejectedValue(new Error('Knowledge base error'));

        const result = await orchestrator.processUserInput(
          'What is AI?',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('conversation');
        expect(result.response).toContain('Could you tell me more');
      });

      it('should fallback to Nova Sonic when knowledge base client is not available', async () => {
        // Create orchestrator without knowledge base client
        const orchestratorWithoutKB = new ConversationOrchestrator({
          intentClassifier: mockIntentClassifier,
          novaSonicClient: mockNovaSonicClient,
        });

        const knowledgeIntent: IntentClassification = {
          primaryIntent: 'knowledge',
          confidence: 0.8,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(knowledgeIntent);

        const result = await orchestratorWithoutKB.processUserInput(
          'What is AI?',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('conversation');
        expect(result.response).toContain('Could you tell me more');
      });
    });

    describe('Action Intent Routing', () => {
      it('should route action intents to agent core client', async () => {
        // Mock intent classification for action
        const actionIntent: IntentClassification = {
          primaryIntent: 'action',
          confidence: 0.9,
          extractedEntities: { action: 'create', object: 'document' },
          metadata: { method: 'model' },
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(actionIntent);

        // Mock agent response
        const agentResponse: AgentResponse = {
          response: 'I have created a new document for you.',
          sessionId: 'session-123',
          agentId: 'agent-123',
          metadata: { agentAliasId: 'alias-123' },
        };
        mockAgentCoreClient.invokeAgent.mockResolvedValue(agentResponse);

        const result = await orchestrator.processUserInput(
          'Create a new document for me',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('agent');
        expect(result.intent.primaryIntent).toBe('action');
        expect(result.agentResponse).toEqual(agentResponse);
        expect(result.response).toBe('I have created a new document for you.');
        expect(mockAgentCoreClient.invokeAgent).toHaveBeenCalledWith(
          'agent-123',
          'alias-123',
          'Create a new document for me',
          'session-123'
        );
      });

      it('should handle multiple enabled agents', async () => {
        const actionIntent: IntentClassification = {
          primaryIntent: 'action',
          confidence: 0.85,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(actionIntent);

        const agentResponse: AgentResponse = {
          response: 'Agent response',
          sessionId: 'session-123',
          agentId: 'agent-123',
          metadata: {},
        };
        mockAgentCoreClient.invokeAgent.mockResolvedValue(agentResponse);

        const result = await orchestrator.processUserInput(
          'Send an email',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('agent');
        expect(mockAgentCoreClient.invokeAgent).toHaveBeenCalledWith(
          'agent-123', // Should use first enabled agent
          'alias-123',
          'Send an email',
          'session-123'
        );
      });

      it('should fallback to Nova Sonic when no enabled agents', async () => {
        // Mock config with no enabled agents
        const { config } = require('../config/AppConfig');
        config.integration.agents = [
          { id: 'agent1', agentId: 'agent-123', agentAliasId: 'alias-123', enabled: false },
        ];

        const actionIntent: IntentClassification = {
          primaryIntent: 'action',
          confidence: 0.8,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(actionIntent);

        const result = await orchestrator.processUserInput(
          'Create a document',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('conversation');
        expect(mockAgentCoreClient.invokeAgent).not.toHaveBeenCalled();
        expect(result.response).toContain('Could you tell me more');
      });

      it('should fallback to Nova Sonic when agent core client fails', async () => {
        const actionIntent: IntentClassification = {
          primaryIntent: 'action',
          confidence: 0.8,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(actionIntent);

        // Mock agent error
        mockAgentCoreClient.invokeAgent.mockRejectedValue(new Error('Agent error'));

        const result = await orchestrator.processUserInput(
          'Create a document',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('conversation');
        expect(result.response).toContain('Could you tell me more');
      });

      it('should fallback to Nova Sonic when agent core client is not available', async () => {
        // Create orchestrator without agent core client
        const orchestratorWithoutAgent = new ConversationOrchestrator({
          intentClassifier: mockIntentClassifier,
          novaSonicClient: mockNovaSonicClient,
        });

        const actionIntent: IntentClassification = {
          primaryIntent: 'action',
          confidence: 0.8,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(actionIntent);

        const result = await orchestratorWithoutAgent.processUserInput(
          'Create a document',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('conversation');
        expect(result.response).toContain('Could you tell me more');
      });
    });

    describe('Conversation Intent Routing', () => {
      it('should route conversation intents to Nova Sonic', async () => {
        const conversationIntent: IntentClassification = {
          primaryIntent: 'conversation',
          confidence: 0.9,
          metadata: { method: 'model' },
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

        const result = await orchestrator.processUserInput(
          'How are you?',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('conversation');
        expect(result.intent.primaryIntent).toBe('conversation');
        expect(result.response).toContain('I\'m doing well, thank you for asking');
      });

      it('should handle different conversational patterns', async () => {
        const conversationIntent: IntentClassification = {
          primaryIntent: 'conversation',
          confidence: 0.8,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

        // Test greeting
        let result = await orchestrator.processUserInput(
          'Hi there',
          'session-123',
          mockContext
        );
        expect(result.response).toContain('Hello! How can I help you today?');

        // Test thanks
        result = await orchestrator.processUserInput(
          'Thank you',
          'session-123',
          mockContext
        );
        expect(result.response).toContain('You\'re welcome!');

        // Test goodbye
        result = await orchestrator.processUserInput(
          'Goodbye',
          'session-123',
          mockContext
        );
        expect(result.response).toContain('Goodbye! Have a great day!');

        // Test capabilities question
        result = await orchestrator.processUserInput(
          'What can you do?',
          'session-123',
          mockContext
        );
        expect(result.response).toContain('I can help you with information');
      });

      it('should provide fallback response for Nova Sonic unavailability', async () => {
        // Create orchestrator without Nova Sonic client
        const orchestratorWithoutNovaSonic = new ConversationOrchestrator({
          intentClassifier: mockIntentClassifier,
        });

        const conversationIntent: IntentClassification = {
          primaryIntent: 'conversation',
          confidence: 0.8,
        };
        mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

        const result = await orchestratorWithoutNovaSonic.processUserInput(
          'Hello',
          'session-123',
          mockContext
        );

        expect(result.source).toBe('fallback');
        expect(result.response).toContain('I apologize, but I\'m currently unable to process');
        expect(result.error).toContain('Nova Sonic client not available');
      });
    });
  });

  describe('Integration with Knowledge Base and Agent Clients', () => {
    // Requirement 1.1, 1.3, 2.1, 2.3, 2.4: Test integration with knowledge base and agent clients

    it('should properly format knowledge base results for voice output', async () => {
      const knowledgeIntent: IntentClassification = {
        primaryIntent: 'knowledge',
        confidence: 0.9,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(knowledgeIntent);

      const knowledgeResults: KnowledgeResult[] = [
        {
          content: '**Machine learning** is a *subset* of `artificial intelligence` that uses # algorithms\n\n- Point 1\n- Point 2\n\n1. Item 1',
          source: 's3://bucket/doc.pdf',
          confidence: 0.95,
          knowledgeBaseId: 'kb-123',
          metadata: {},
        },
      ];
      mockKnowledgeBaseClient.query.mockResolvedValue(knowledgeResults);

      const result = await orchestrator.processUserInput(
        'What is machine learning?',
        'session-123',
        mockContext
      );

      // Debug: Check if knowledge base client was called
      expect(mockKnowledgeBaseClient.query).toHaveBeenCalledWith(
        'What is machine learning?',
        'kb-123',
        'session-123'
      );
      expect(result.source).toBe('knowledge');
      // Should remove markdown formatting for voice
      expect(result.response).not.toContain('**');
      expect(result.response).not.toContain('*');
      expect(result.response).not.toContain('`');
      expect(result.response).not.toContain('#');
      expect(result.response).toContain('Machine learning is a subset of artificial intelligence');
    });

    it('should handle multiple knowledge base results and select highest confidence', async () => {
      const knowledgeIntent: IntentClassification = {
        primaryIntent: 'knowledge',
        confidence: 0.9,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(knowledgeIntent);

      const knowledgeResults: KnowledgeResult[] = [
        {
          content: 'Lower confidence result',
          source: 'source1',
          confidence: 0.7,
          knowledgeBaseId: 'kb-123',
          metadata: {},
        },
        {
          content: 'Higher confidence result',
          source: 'source2',
          confidence: 0.95,
          knowledgeBaseId: 'kb-123',
          metadata: {},
        },
        {
          content: 'Medium confidence result',
          source: 'source3',
          confidence: 0.8,
          knowledgeBaseId: 'kb-123',
          metadata: {},
        },
      ];
      mockKnowledgeBaseClient.query.mockResolvedValue(knowledgeResults);

      const result = await orchestrator.processUserInput(
        'What is AI?',
        'session-123',
        mockContext
      );

      expect(mockKnowledgeBaseClient.query).toHaveBeenCalledWith(
        'What is AI?',
        'kb-123',
        'session-123'
      );
      expect(result.source).toBe('knowledge');
      expect(result.response).toContain('Higher confidence result');
      expect(result.response).toContain('I have additional related information');
    });

    it('should truncate long knowledge responses for voice output', async () => {
      const knowledgeIntent: IntentClassification = {
        primaryIntent: 'knowledge',
        confidence: 0.9,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(knowledgeIntent);

      const longContent = 'a'.repeat(600); // Longer than 500 char limit
      const knowledgeResults: KnowledgeResult[] = [
        {
          content: longContent,
          source: 'source',
          confidence: 0.9,
          knowledgeBaseId: 'kb-123',
          metadata: {},
        },
      ];
      mockKnowledgeBaseClient.query.mockResolvedValue(knowledgeResults);

      const result = await orchestrator.processUserInput(
        'Tell me about this topic',
        'session-123',
        mockContext
      );

      expect(mockKnowledgeBaseClient.query).toHaveBeenCalledWith(
        'Tell me about this topic',
        'kb-123',
        'session-123'
      );
      expect(result.source).toBe('knowledge');
      expect(result.response.length).toBeLessThan(600);
      expect(result.response).toMatch(/\.\.\.$|\.$/);
    });

    it('should properly handle agent responses with session continuity', async () => {
      const actionIntent: IntentClassification = {
        primaryIntent: 'action',
        confidence: 0.9,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(actionIntent);

      const agentResponse: AgentResponse = {
        response: 'I have completed the requested action successfully.',
        sessionId: 'agent-session-456',
        agentId: 'agent-123',
        metadata: {
          agentAliasId: 'alias-123',
          executionTime: 1500,
        },
      };
      mockAgentCoreClient.invokeAgent.mockResolvedValue(agentResponse);

      const result = await orchestrator.processUserInput(
        'Create a report',
        'session-123',
        mockContext
      );

      expect(mockAgentCoreClient.invokeAgent).toHaveBeenCalledWith(
        'agent-123',
        'alias-123',
        'Create a report',
        'session-123'
      );
      expect(result.source).toBe('agent');
      expect(result.agentResponse).toEqual(agentResponse);
      expect(result.response).toBe('I have completed the requested action successfully.');
      expect(result.metadata?.agentId).toBe('agent-123');
      expect(result.metadata?.agentAliasId).toBe('alias-123');
    });

    it('should handle agent responses with error information', async () => {
      const actionIntent: IntentClassification = {
        primaryIntent: 'action',
        confidence: 0.9,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(actionIntent);

      const agentResponse: AgentResponse = {
        response: 'I encountered an issue while processing your request.',
        sessionId: 'session-123',
        agentId: 'agent-123',
        error: 'Validation failed',
        metadata: {},
      };
      mockAgentCoreClient.invokeAgent.mockResolvedValue(agentResponse);

      const result = await orchestrator.processUserInput(
        'Delete all files',
        'session-123',
        mockContext
      );

      expect(mockAgentCoreClient.invokeAgent).toHaveBeenCalledWith(
        'agent-123',
        'alias-123',
        'Delete all files',
        'session-123'
      );
      expect(result.source).toBe('agent');
      expect(result.response).toBe('I encountered an issue while processing your request.');
      expect(result.agentResponse?.error).toBe('Validation failed');
    });
  });

  describe('Fallback to Nova Sonic for Conversation Intents', () => {
    // Requirement 2.4: Test fallback to Nova Sonic for conversation intents

    it('should fallback to Nova Sonic when intent classification fails', async () => {
      // Mock intent classification failure
      mockIntentClassifier.classifyIntent.mockRejectedValue(new Error('Classification failed'));

      const result = await orchestrator.processUserInput(
        'What is AI?',
        'session-123',
        mockContext
      );

      expect(result.source).toBe('conversation');
      expect(result.intent.primaryIntent).toBe('conversation');
      expect(result.intent.confidence).toBe(0.3);
      expect(result.intent.metadata?.method).toBe('fallback');
      expect(result.response).toContain('Could you tell me more');
    });

    it('should fallback to Nova Sonic when all services are unavailable', async () => {
      // Create orchestrator with no clients
      const orchestratorWithoutClients = new ConversationOrchestrator({
        intentClassifier: mockIntentClassifier,
      });

      const knowledgeIntent: IntentClassification = {
        primaryIntent: 'knowledge',
        confidence: 0.9,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(knowledgeIntent);

      const result = await orchestratorWithoutClients.processUserInput(
        'What is AI?',
        'session-123',
        mockContext
      );

      expect(result.source).toBe('fallback');
      expect(result.response).toContain('I apologize, but I\'m currently unable to process');
    });

    it('should provide appropriate conversational responses for different input types', async () => {
      const conversationIntent: IntentClassification = {
        primaryIntent: 'conversation',
        confidence: 0.8,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

      // Test short input
      let result = await orchestrator.processUserInput(
        'Yes',
        'session-123',
        mockContext
      );
      expect(result.response).toContain('Could you tell me more');

      // Test longer input
      result = await orchestrator.processUserInput(
        'I was wondering if you could help me understand some complex concepts about artificial intelligence',
        'session-123',
        mockContext
      );
      expect(result.response).toContain('I hear what you\'re saying');
    });

    it('should maintain conversation context across multiple turns', async () => {
      const conversationIntent: IntentClassification = {
        primaryIntent: 'conversation',
        confidence: 0.8,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

      // First turn
      const result1 = await orchestrator.processUserInput(
        'Hello',
        'session-123',
        mockContext
      );
      expect(result1.response).toContain('Hello! How can I help you today?');

      // Second turn - context should be updated
      const result2 = await orchestrator.processUserInput(
        'Thanks',
        'session-123',
        mockContext
      );
      expect(result2.response).toContain('You\'re welcome!');
    });

    it('should handle conversation context creation for new sessions', async () => {
      const conversationIntent: IntentClassification = {
        primaryIntent: 'conversation',
        confidence: 0.8,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

      const result = await orchestrator.processUserInput(
        'Hello',
        'new-session-789'
      );

      expect(result.response).toContain('Hello! How can I help you today?');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty input gracefully', async () => {
      const result = await orchestrator.processUserInput(
        '',
        'session-123',
        mockContext
      );

      expect(result.source).toBe('fallback');
      expect(result.response).toContain('I apologize, but I encountered an issue');
    });

    it('should handle whitespace-only input', async () => {
      const result = await orchestrator.processUserInput(
        '   \n\t   ',
        'session-123',
        mockContext
      );

      expect(result.source).toBe('fallback');
      expect(result.response).toContain('I apologize, but I encountered an issue');
    });

    it('should handle very long input', async () => {
      const longInput = 'a'.repeat(10000);
      const conversationIntent: IntentClassification = {
        primaryIntent: 'conversation',
        confidence: 0.8,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

      const result = await orchestrator.processUserInput(
        longInput,
        'session-123',
        mockContext
      );

      expect(result.source).toBe('conversation');
      expect(result.response).toBeDefined();
    });

    it('should handle special characters and Unicode', async () => {
      const specialInput = 'What is 🤖 AI? Can you explain émotions and 中文?';
      const conversationIntent: IntentClassification = {
        primaryIntent: 'conversation',
        confidence: 0.8,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

      const result = await orchestrator.processUserInput(
        specialInput,
        'session-123',
        mockContext
      );

      expect(result.source).toBe('conversation');
      expect(result.response).toBeDefined();
    });

    it('should include processing time in all results', async () => {
      const conversationIntent: IntentClassification = {
        primaryIntent: 'conversation',
        confidence: 0.8,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

      const result = await orchestrator.processUserInput(
        'Hello',
        'session-123',
        mockContext
      );

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.processingTimeMs).toBe('number');
    });

    it('should handle data sanitization properly', async () => {
      const { DataProtection } = require('../observability/dataProtection');
      
      // Mock sanitization with changes
      DataProtection.sanitizeUserInput.mockReturnValueOnce({
        sanitizedText: 'sanitized input',
        sanitizationApplied: true,
        detectedPatterns: ['email'],
      });
      
      DataProtection.sanitizeSystemOutput.mockReturnValueOnce({
        sanitizedText: 'sanitized output',
        sanitizationApplied: true,
        detectedPatterns: ['phone'],
      });

      const conversationIntent: IntentClassification = {
        primaryIntent: 'conversation',
        confidence: 0.8,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

      const result = await orchestrator.processUserInput(
        'My email is test@example.com',
        'session-123',
        mockContext
      );

      expect(result.response).toBe('sanitized output');
      expect(result.metadata?.dataSanitization?.inputSanitized).toBe(true);
      expect(result.metadata?.dataSanitization?.outputSanitized).toBe(true);
      expect(result.metadata?.dataSanitization?.detectedPatterns).toEqual(['email', 'phone']);
    });

    it('should handle unknown intent types gracefully', async () => {
      const unknownIntent: IntentClassification = {
        primaryIntent: 'unknown' as any,
        confidence: 0.5,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(unknownIntent);

      const result = await orchestrator.processUserInput(
        'Unknown intent type',
        'session-123',
        mockContext
      );

      // Should default to conversation routing
      expect(result.source).toBe('conversation');
      expect(result.response).toBeDefined();
    });
  });

  describe('Performance and Observability', () => {
    it('should complete processing within reasonable time', async () => {
      const conversationIntent: IntentClassification = {
        primaryIntent: 'conversation',
        confidence: 0.8,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

      const startTime = Date.now();
      
      await orchestrator.processUserInput(
        'Hello',
        'session-123',
        mockContext
      );
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(100); // Should be very fast for mocked services
    });

    it('should handle concurrent processing requests', async () => {
      const conversationIntent: IntentClassification = {
        primaryIntent: 'conversation',
        confidence: 0.8,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

      const inputs = [
        'Hello',
        'What is AI?',
        'Create a document',
        'Thank you',
        'Goodbye'
      ];
      
      const promises = inputs.map((input, index) => 
        orchestrator.processUserInput(input, `session-${index}`, mockContext)
      );
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.response).toBeDefined();
        expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      });
    });

    it('should log appropriate information during processing', async () => {
      const logger = require('../utils/logger');
      
      const conversationIntent: IntentClassification = {
        primaryIntent: 'conversation',
        confidence: 0.8,
      };
      mockIntentClassifier.classifyIntent.mockResolvedValue(conversationIntent);

      await orchestrator.processUserInput(
        'Hello',
        'session-123',
        mockContext
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Processing user input',
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          sessionId: 'session-123',
          inputLength: 5,
          hasContext: true,
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'User input processed successfully',
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          sessionId: 'session-123',
          intent: 'conversation',
          source: 'conversation',
          processingTimeMs: expect.any(Number),
          responseLength: expect.any(Number),
        })
      );
    });
  });
});