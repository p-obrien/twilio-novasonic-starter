/**
 * @fileoverview Conversation Orchestrator for AgentCore and Knowledge Base Integration
 * 
 * This module provides a simple router that classifies user intent and routes requests
 * to the appropriate service (knowledge base, agent, or direct Nova Sonic conversation).
 * 
 * Key Features:
 * - Intent-based routing using classify → route → respond pattern
 * - Direct routing to knowledge base, agent, or Nova Sonic
 * - Response formatting optimized for voice output
 * - Graceful fallback handling for service failures
 * - Session-aware conversation management
 * 
 * @author Twilio Bedrock Bridge Team
 * @version 1.0.0
 */

import { randomUUID } from 'node:crypto';
import logger from '../utils/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { ConversationContext, ConversationMessage } from '../types/SharedTypes';
import { IntentClassification, KnowledgeResult, AgentResponse } from '../types/IntegrationTypes';
import { IntentClassifier } from '../intent/IntentClassifier';
import { NovaSonicIntentClassifier } from '../intent/NovaSonicIntentClassifier';
import { IKnowledgeBaseClient } from '../knowledge/KnowledgeBaseClient';
import { IAgentCoreClient } from '../agent/AgentCoreClient';
import { NovaSonicClient as NovaSonicBidirectionalStreamClient } from '../client/';
import { config } from '../config/AppConfig';
import { DataProtection } from '../observability/dataProtection';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Configuration for Conversation Orchestrator
 */
export interface ConversationOrchestratorConfig {
  /** Intent classifier instance */
  intentClassifier?: IntentClassifier;
  /** Knowledge base client instance */
  knowledgeBaseClient?: IKnowledgeBaseClient;
  /** Agent core client instance */
  agentCoreClient?: IAgentCoreClient;
  /** Nova Sonic client for direct conversation */
  novaSonicClient?: NovaSonicBidirectionalStreamClient;
  /** Enable debug logging */
  enableDebugLogging?: boolean;
}

/**
 * Orchestration result containing the response and metadata
 */
export interface OrchestrationResult {
  /** The formatted response for voice output */
  response: string;
  /** Intent classification that was used */
  intent: IntentClassification;
  /** Source of the response */
  source: 'knowledge' | 'agent' | 'conversation' | 'fallback';
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Knowledge results if knowledge base was used */
  knowledgeResults?: KnowledgeResult[];
  /** Agent response if agent was used */
  agentResponse?: AgentResponse;
  /** Error information if any occurred */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Conversation Orchestrator interface
 */
export interface IConversationOrchestrator {
  /**
   * Process user input and return appropriate response
   * @param input User input text
   * @param sessionId Session identifier
   * @param context Optional conversation context
   * @returns Promise resolving to orchestration result
   */
  processUserInput(input: string, sessionId: string, context?: Partial<ConversationContext>): Promise<OrchestrationResult>;

  /**
   * Update orchestrator configuration
   * @param config New configuration
   */
  updateConfig(config: Partial<ConversationOrchestratorConfig>): void;
}

// ============================================================================
// MAIN ORCHESTRATOR CLASS
// ============================================================================

/**
 * Conversation Orchestrator implementation
 * 
 * Implements the classify → route → respond pattern for intelligent conversation routing.
 */
export class ConversationOrchestrator implements IConversationOrchestrator {
  // ============================================================================
  // PRIVATE PROPERTIES
  // ============================================================================

  private intentClassifier: IntentClassifier;
  private knowledgeBaseClient?: IKnowledgeBaseClient;
  private agentCoreClient?: IAgentCoreClient;
  private novaSonicClient?: NovaSonicBidirectionalStreamClient;
  private enableDebugLogging: boolean;
  private conversationContexts: Map<string, ConversationContext>;

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  constructor(orchestratorConfig: ConversationOrchestratorConfig = {}) {
    // Initialize intent classifier (use provided or create default)
    this.intentClassifier = orchestratorConfig.intentClassifier || 
      new NovaSonicIntentClassifier({}, orchestratorConfig.novaSonicClient);

    this.knowledgeBaseClient = orchestratorConfig.knowledgeBaseClient;
    this.agentCoreClient = orchestratorConfig.agentCoreClient;
    this.novaSonicClient = orchestratorConfig.novaSonicClient;
    this.enableDebugLogging = orchestratorConfig.enableDebugLogging || false;
    this.conversationContexts = new Map();

    logger.info('Conversation Orchestrator initialized', {
      hasIntentClassifier: !!this.intentClassifier,
      hasKnowledgeBaseClient: !!this.knowledgeBaseClient,
      hasAgentCoreClient: !!this.agentCoreClient,
      hasNovaSonicClient: !!this.novaSonicClient,
      enableDebugLogging: this.enableDebugLogging,
    });
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  /**
   * Process user input using classify → route → respond pattern
   */
  public async processUserInput(
    input: string, 
    sessionId: string, 
    context?: Partial<ConversationContext>
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const correlationId = CorrelationIdManager.getCurrentCorrelationId();

    logger.info('Processing user input', {
      correlationId,
      sessionId,
      inputLength: input.length,
      hasContext: !!context,
    });

    try {
      // Step 1: Sanitize user input for data protection
      const sanitizationResult = DataProtection.sanitizeUserInput(input, sessionId);
      const sanitizedInput = sanitizationResult.sanitizedText;

      // Step 2: Get or create conversation context
      const conversationContext = this.getOrCreateConversationContext(sessionId, context);

      // Step 3: Classify intent using sanitized input
      const intent = await this.classifyIntent(sanitizedInput, conversationContext);

      if (this.enableDebugLogging) {
        logger.debug('Intent classified', {
          correlationId,
          sessionId,
          intent: intent.primaryIntent,
          confidence: intent.confidence,
        });
      }

      // Step 4: Route to appropriate service using sanitized input
      const result = await this.routeToService(sanitizedInput, sessionId, intent, conversationContext);

      // Step 5: Sanitize system output before returning
      const outputSanitizationResult = DataProtection.sanitizeSystemOutput(result.response, sessionId);
      const sanitizedResponse = outputSanitizationResult.sanitizedText;

      // Step 6: Update conversation context with sanitized data
      this.updateConversationContext(sessionId, sanitizedInput, sanitizedResponse);

      const processingTime = Date.now() - startTime;
      
      logger.info('User input processed successfully', {
        correlationId,
        sessionId,
        intent: intent.primaryIntent,
        source: result.source,
        processingTimeMs: processingTime,
        responseLength: result.response.length,
      });

      return {
        ...result,
        response: sanitizedResponse,
        intent,
        processingTimeMs: processingTime,
        metadata: {
          ...result.metadata,
          dataSanitization: {
            inputSanitized: sanitizationResult.sanitizationApplied,
            outputSanitized: outputSanitizationResult.sanitizationApplied,
            detectedPatterns: [
              ...sanitizationResult.detectedPatterns,
              ...outputSanitizationResult.detectedPatterns
            ]
          }
        }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      logger.error('Failed to process user input', {
        correlationId,
        sessionId,
        processingTimeMs: processingTime,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return fallback response
      return this.createFallbackResult(error, processingTime);
    }
  }

  /**
   * Update orchestrator configuration
   */
  public updateConfig(config: Partial<ConversationOrchestratorConfig>): void {
    if (config.intentClassifier) {
      this.intentClassifier = config.intentClassifier;
    }
    if (config.knowledgeBaseClient !== undefined) {
      this.knowledgeBaseClient = config.knowledgeBaseClient;
    }
    if (config.agentCoreClient !== undefined) {
      this.agentCoreClient = config.agentCoreClient;
    }
    if (config.novaSonicClient !== undefined) {
      this.novaSonicClient = config.novaSonicClient;
    }
    if (config.enableDebugLogging !== undefined) {
      this.enableDebugLogging = config.enableDebugLogging;
    }

    logger.info('Orchestrator configuration updated', {
      correlationId: CorrelationIdManager.getCurrentCorrelationId(),
      updatedFields: Object.keys(config),
    });
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Classify user intent using the configured classifier
   */
  private async classifyIntent(input: string, context: ConversationContext): Promise<IntentClassification> {
    try {
      return await this.intentClassifier.classifyIntent(input, context);
    } catch (error) {
      logger.warn('Intent classification failed, using fallback', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId: context.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return fallback conversation intent
      return {
        primaryIntent: 'conversation',
        confidence: 0.3,
        metadata: {
          method: 'fallback',
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Route request to appropriate service based on intent
   */
  private async routeToService(
    input: string,
    sessionId: string,
    intent: IntentClassification,
    context: ConversationContext
  ): Promise<Omit<OrchestrationResult, 'intent' | 'processingTimeMs'>> {
    const correlationId = CorrelationIdManager.getCurrentCorrelationId();

    // Route based on primary intent
    switch (intent.primaryIntent) {
      case 'knowledge':
        return await this.routeToKnowledgeBase(input, sessionId, intent, context);

      case 'action':
        return await this.routeToAgent(input, sessionId, intent, context);

      case 'conversation':
      default:
        return await this.routeToNovaSonic(input, sessionId, intent, context);
    }
  }

  /**
   * Route to knowledge base for information retrieval
   */
  private async routeToKnowledgeBase(
    input: string,
    sessionId: string,
    intent: IntentClassification,
    context: ConversationContext
  ): Promise<Omit<OrchestrationResult, 'intent' | 'processingTimeMs'>> {
    if (!this.knowledgeBaseClient) {
      logger.warn('Knowledge base client not available, falling back to Nova Sonic', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
      });
      return await this.routeToNovaSonic(input, sessionId, intent, context);
    }

    try {
      // Get enabled knowledge bases from config
      const enabledKnowledgeBases = config.integration.knowledgeBases.filter(kb => kb.enabled);
      
      if (enabledKnowledgeBases.length === 0) {
        logger.warn('No enabled knowledge bases found, falling back to Nova Sonic', {
          correlationId: CorrelationIdManager.getCurrentCorrelationId(),
          sessionId,
        });
        return await this.routeToNovaSonic(input, sessionId, intent, context);
      }

      // For now, use the first enabled knowledge base
      // In a more sophisticated implementation, you might choose based on domain or priority
      const knowledgeBase = enabledKnowledgeBases[0];
      
      logger.debug('Querying knowledge base', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
        knowledgeBaseId: knowledgeBase.knowledgeBaseId,
      });

      const results = await this.knowledgeBaseClient.query(input, knowledgeBase.knowledgeBaseId, sessionId);
      
      if (results.length === 0) {
        logger.info('No knowledge base results found, falling back to Nova Sonic', {
          correlationId: CorrelationIdManager.getCurrentCorrelationId(),
          sessionId,
          knowledgeBaseId: knowledgeBase.knowledgeBaseId,
        });
        return await this.routeToNovaSonic(input, sessionId, intent, context);
      }

      // Format knowledge results for voice response
      const response = this.formatKnowledgeResponse(results);

      return {
        response,
        source: 'knowledge',
        knowledgeResults: results,
        metadata: {
          knowledgeBaseId: knowledgeBase.knowledgeBaseId,
          resultsCount: results.length,
        },
      };

    } catch (error) {
      logger.error('Knowledge base query failed, falling back to Nova Sonic', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      return await this.routeToNovaSonic(input, sessionId, intent, context);
    }
  }

  /**
   * Route to agent for action execution
   */
  private async routeToAgent(
    input: string,
    sessionId: string,
    intent: IntentClassification,
    context: ConversationContext
  ): Promise<Omit<OrchestrationResult, 'intent' | 'processingTimeMs'>> {
    if (!this.agentCoreClient) {
      logger.warn('Agent core client not available, falling back to Nova Sonic', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
      });
      return await this.routeToNovaSonic(input, sessionId, intent, context);
    }

    try {
      // Get enabled agents from config
      const enabledAgents = config.integration.agents.filter(agent => agent.enabled);
      
      if (enabledAgents.length === 0) {
        logger.warn('No enabled agents found, falling back to Nova Sonic', {
          correlationId: CorrelationIdManager.getCurrentCorrelationId(),
          sessionId,
        });
        return await this.routeToNovaSonic(input, sessionId, intent, context);
      }

      // For now, use the first enabled agent
      // In a more sophisticated implementation, you might choose based on category or priority
      const agent = enabledAgents[0];
      
      logger.debug('Invoking agent', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
        agentId: agent.agentId,
        agentAliasId: agent.agentAliasId,
      });

      const agentResponse = await this.agentCoreClient.invokeAgent(
        agent.agentId,
        agent.agentAliasId,
        input,
        sessionId
      );

      return {
        response: agentResponse.response,
        source: 'agent',
        agentResponse,
        metadata: {
          agentId: agent.agentId,
          agentAliasId: agent.agentAliasId,
        },
      };

    } catch (error) {
      logger.error('Agent invocation failed, falling back to Nova Sonic', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      return await this.routeToNovaSonic(input, sessionId, intent, context);
    }
  }

  /**
   * Route to Nova Sonic for direct conversation
   */
  private async routeToNovaSonic(
    input: string,
    sessionId: string,
    intent: IntentClassification,
    context: ConversationContext
  ): Promise<Omit<OrchestrationResult, 'intent' | 'processingTimeMs'>> {
    if (!this.novaSonicClient) {
      logger.error('Nova Sonic client not available, returning fallback response', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
      });

      return {
        response: 'I apologize, but I\'m currently unable to process your request. Please try again later.',
        source: 'fallback',
        error: 'Nova Sonic client not available',
      };
    }

    try {
      logger.debug('Routing to Nova Sonic for conversation', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
      });

      // For text-based conversation routing, we need to handle this differently
      // than the streaming audio flow. Since the orchestrator is primarily for
      // text-based routing decisions, we'll provide a conversational response
      // that acknowledges the user's input and maintains conversation flow.
      
      // In a full implementation, this could:
      // 1. Create a temporary Nova Sonic session for text-only interaction
      // 2. Send the text input and get a text response
      // 3. Format the response for voice output
      
      // For now, we'll provide a natural conversational response that indicates
      // the system is ready to continue the conversation through the existing
      // audio streaming channels.
      
      const response = this.generateConversationalResponse(input, context);

      return {
        response,
        source: 'conversation',
        metadata: {
          conversationalRouting: true,
          inputLength: input.length,
          contextMessages: context.messages.length,
        },
      };

    } catch (error) {
      logger.error('Nova Sonic routing failed', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        response: 'I apologize, but I encountered an issue processing your request. Please try again.',
        source: 'fallback',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate a conversational response for general conversation intents
   */
  private generateConversationalResponse(input: string, context: ConversationContext): string {
    const inputLower = input.toLowerCase().trim();
    
    // Handle common conversational patterns
    if (inputLower.match(/^(hi|hello|hey|good morning|good afternoon|good evening)/)) {
      return 'Hello! How can I help you today?';
    }
    
    if (inputLower.match(/^(thanks|thank you|thx)/)) {
      return 'You\'re welcome! Is there anything else I can help you with?';
    }
    
    if (inputLower.match(/^(bye|goodbye|see you|talk to you later)/)) {
      return 'Goodbye! Have a great day!';
    }
    
    if (inputLower.match(/^(how are you|how\'s it going)/)) {
      return 'I\'m doing well, thank you for asking! How can I assist you today?';
    }
    
    if (inputLower.match(/^(what can you do|what are your capabilities|help)/)) {
      return 'I can help you with information from our knowledge base, assist with various tasks through our agent system, or have a general conversation. What would you like to know or do?';
    }
    
    // For other conversational inputs, provide a helpful response
    if (input.length < 50) {
      return 'I understand. Could you tell me more about what you\'d like to know or do?';
    } else {
      return 'I hear what you\'re saying. Let me know if you have any specific questions or if there\'s something I can help you with.';
    }
  }

  /**
   * Format knowledge base results for voice response
   */
  private formatKnowledgeResponse(results: KnowledgeResult[]): string {
    if (results.length === 0) {
      return 'I couldn\'t find any relevant information for your question.';
    }

    // Use the highest confidence result for the primary response
    const primaryResult = results.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );

    let response = primaryResult.content;

    // Format for voice output - ensure it's conversational and natural
    response = this.formatForVoice(response);

    // If there are multiple high-confidence results, mention that more information is available
    const highConfidenceResults = results.filter(r => r.confidence > 0.7);
    if (highConfidenceResults.length > 1) {
      response += ' I have additional related information if you\'d like me to elaborate.';
    }

    return response;
  }

  /**
   * Format text for natural voice output
   */
  private formatForVoice(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    let formatted = text.trim();

    // Remove excessive whitespace and normalize line breaks
    formatted = formatted.replace(/\s+/g, ' ');
    formatted = formatted.replace(/\n+/g, '. ');

    // Convert common markdown/formatting to speech-friendly text
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove bold
    formatted = formatted.replace(/\*(.*?)\*/g, '$1'); // Remove italic
    formatted = formatted.replace(/`(.*?)`/g, '$1'); // Remove code formatting
    formatted = formatted.replace(/#{1,6}\s*/g, ''); // Remove headers

    // Convert lists to speech-friendly format
    formatted = formatted.replace(/^\s*[-*+]\s+/gm, ''); // Remove bullet points
    formatted = formatted.replace(/^\s*\d+\.\s+/gm, ''); // Remove numbered lists

    // Ensure proper sentence endings for natural speech
    if (formatted && !formatted.match(/[.!?]$/)) {
      formatted += '.';
    }

    // Limit length for voice responses (approximately 30 seconds of speech at normal pace)
    const maxLength = 500;
    if (formatted.length > maxLength) {
      // Find the last complete sentence within the limit
      const truncated = formatted.substring(0, maxLength);
      const lastSentenceEnd = Math.max(
        truncated.lastIndexOf('.'),
        truncated.lastIndexOf('!'),
        truncated.lastIndexOf('?')
      );
      
      if (lastSentenceEnd > maxLength * 0.7) {
        // If we found a sentence ending in the last 30% of the text, use it
        formatted = truncated.substring(0, lastSentenceEnd + 1);
      } else {
        // Otherwise, truncate at word boundary and add ellipsis
        const lastSpace = truncated.lastIndexOf(' ');
        formatted = truncated.substring(0, lastSpace) + '...';
      }
    }

    return formatted;
  }

  /**
   * Get or create conversation context for a session
   */
  private getOrCreateConversationContext(
    sessionId: string, 
    partialContext?: Partial<ConversationContext>
  ): ConversationContext {
    let context = this.conversationContexts.get(sessionId);
    
    if (!context) {
      context = {
        conversationId: partialContext?.conversationId || randomUUID(),
        sessionId,
        streamSid: partialContext?.streamSid,
        messages: [],
        state: 'active',
        metadata: partialContext?.metadata || {},
        startTime: new Date(),
        lastActivity: new Date(),
      };
      
      this.conversationContexts.set(sessionId, context);
      
      logger.debug('Created new conversation context', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
        conversationId: context.conversationId,
      });
    } else {
      // Update last activity
      context.lastActivity = new Date();
      
      // Merge any provided context updates
      if (partialContext) {
        context.metadata = { ...context.metadata, ...partialContext.metadata };
        if (partialContext.streamSid) {
          context.streamSid = partialContext.streamSid;
        }
      }
    }

    return context;
  }

  /**
   * Update conversation context with new message
   */
  private updateConversationContext(sessionId: string, userInput: string, assistantResponse: string): void {
    const context = this.conversationContexts.get(sessionId);
    if (!context) return;

    // Add user message
    context.messages.push({
      id: randomUUID(),
      role: 'user',
      content: userInput,
      timestamp: new Date(),
    });

    // Add assistant response
    context.messages.push({
      id: randomUUID(),
      role: 'assistant',
      content: assistantResponse,
      timestamp: new Date(),
    });

    // Keep only the last 10 messages to prevent memory growth
    if (context.messages.length > 10) {
      context.messages = context.messages.slice(-10);
    }

    context.lastActivity = new Date();
  }

  /**
   * Create fallback result for error cases
   */
  private createFallbackResult(error: any, processingTimeMs: number): OrchestrationResult {
    return {
      response: 'I apologize, but I encountered an issue processing your request. Please try again.',
      intent: {
        primaryIntent: 'conversation',
        confidence: 0.0,
        metadata: { method: 'fallback' },
      },
      source: 'fallback',
      processingTimeMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new Conversation Orchestrator instance
 * @param config Optional orchestrator configuration
 * @returns New ConversationOrchestrator instance
 */
export function createConversationOrchestrator(config?: ConversationOrchestratorConfig): ConversationOrchestrator {
  return new ConversationOrchestrator(config);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ConversationOrchestrator;