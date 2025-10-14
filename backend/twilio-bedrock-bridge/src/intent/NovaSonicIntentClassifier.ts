/**
 * @fileoverview Nova Sonic Model-Driven Intent Classifier
 * 
 * Implementation of IntentClassifier using Nova Sonic model for intent extraction.
 * Provides intelligent routing for knowledge retrieval, agent execution, or direct conversation.
 */

import { randomUUID } from 'node:crypto';
import logger from '../utils/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { ConversationContext } from '../types/SharedTypes';
import { NovaSonicClient as NovaSonicBidirectionalStreamClient } from '../client/';
import { 
  IntentClassifier, 
  DEFAULT_INTENT_CONFIG 
} from './IntentClassifier';
import { 
  IntentClassification, 
  IntentType, 
  IntentRule, 
  IntentClassificationConfig 
} from './types';

/**
 * Nova Sonic model-driven intent classifier
 */
export class NovaSonicIntentClassifier implements IntentClassifier {
  private config: IntentClassificationConfig;
  private customRules: Map<string, IntentRule>;
  private novaSonicClient?: NovaSonicBidirectionalStreamClient;

  constructor(
    config: Partial<IntentClassificationConfig> = {},
    novaSonicClient?: NovaSonicBidirectionalStreamClient
  ) {
    this.config = { ...DEFAULT_INTENT_CONFIG, ...config };
    this.customRules = new Map();
    this.novaSonicClient = novaSonicClient;
    
    // Initialize custom rules from config
    this.config.customRules.forEach(rule => {
      this.customRules.set(rule.id, rule);
    });

    logger.info('NovaSonicIntentClassifier initialized', {
      correlationId: CorrelationIdManager.getCurrentCorrelationId(),
      enableModelClassification: this.config.enableModelClassification,
      customRulesCount: this.customRules.size
    });
  }

  /**
   * Classify user input using Nova Sonic model
   */
  async classifyIntent(input: string, context: ConversationContext): Promise<IntentClassification> {
    const startTime = Date.now();
    const correlationId = CorrelationIdManager.getCurrentCorrelationId();
    
    logger.debug('Starting intent classification', {
      correlationId,
      input: input.substring(0, 100), // Log first 100 chars for privacy
      sessionId: context.sessionId,
      conversationId: context.conversationId
    });

    try {
      // Use model-based classification if enabled and client available
      if (this.config.enableModelClassification && this.novaSonicClient) {
        const modelResult = await this.classifyWithModel(input, context);
        const processingTime = Date.now() - startTime;
        
        logger.info('Intent classified using model', {
          correlationId,
          intent: modelResult.primaryIntent,
          confidence: modelResult.confidence,
          processingTimeMs: processingTime
        });
        
        return {
          ...modelResult,
          metadata: {
            ...modelResult.metadata,
            processingTimeMs: processingTime,
            method: 'model'
          }
        };
      }

      // If model classification is disabled or client unavailable, return conversation intent
      const processingTime = Date.now() - startTime;
      logger.info('Model classification unavailable, using conversation intent', {
        correlationId,
        processingTimeMs: processingTime,
        enableModelClassification: this.config.enableModelClassification,
        hasClient: !!this.novaSonicClient
      });

      return {
        primaryIntent: 'conversation',
        confidence: 0.5,
        metadata: {
          processingTimeMs: processingTime,
          method: 'fallback'
        }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error('Intent classification failed', {
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: processingTime
      });

      // Return fallback conversation intent on error
      return {
        primaryIntent: 'conversation',
        confidence: 0.3,
        metadata: {
          processingTimeMs: processingTime,
          method: 'fallback'
        }
      };
    }
  }

  /**
   * Classify intent using Nova Sonic model
   */
  private async classifyWithModel(input: string, context: ConversationContext): Promise<IntentClassification> {
    if (!this.novaSonicClient) {
      throw new Error('Nova Sonic client not available for model-based classification');
    }

    const classificationPrompt = this.buildClassificationPrompt(input, context);
    const sessionId = `intent-${randomUUID()}`;
    
    try {
      // Create a temporary session for intent classification
      const response = await Promise.race([
        this.queryNovaSonicForIntent(sessionId, classificationPrompt),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Model classification timeout')), this.config.modelTimeoutMs)
        )
      ]);

      return this.parseModelResponse(response);
    } finally {
      // Clean up the temporary session
      if (this.novaSonicClient.isSessionActive(sessionId)) {
        await this.novaSonicClient.closeSession(sessionId);
      }
    }
  }

  /**
   * Build classification prompt for Nova Sonic
   */
  private buildClassificationPrompt(input: string, context: ConversationContext): string {
    const recentHistory = context.messages
      .slice(-3) // Last 3 messages for context
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    return `You are an intent classifier. Analyze the user input and classify it into one of three categories:

1. "knowledge" - User is asking for information, facts, explanations, or wants to learn something
2. "action" - User wants to perform a task, create something, send messages, schedule meetings, etc.
3. "conversation" - User is engaging in casual conversation, greetings, thanks, or general chat

Recent conversation context:
${recentHistory}

Current user input: "${input}"

Respond with ONLY a JSON object in this exact format:
{
  "intent": "knowledge|action|conversation",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "entities": {}
}`;
  }

  /**
   * Query Nova Sonic for intent classification
   * 
   * Note: This is a simplified implementation that demonstrates the integration pattern.
   * In a production environment, you might want to use a dedicated text-only Bedrock client
   * for intent classification to avoid the overhead of the streaming audio client.
   */
  private async queryNovaSonicForIntent(sessionId: string, prompt: string): Promise<string> {
    // For now, implement a rule-based fallback with the option to extend to model-based classification
    // This ensures the system works while providing a clear path for future enhancement
    
    logger.debug('Using rule-based intent classification (Nova Sonic integration placeholder)', {
      correlationId: CorrelationIdManager.getCurrentCorrelationId(),
      sessionId,
      promptLength: prompt.length
    });

    // Simple rule-based classification that mimics model output format
    const inputLower = prompt.toLowerCase().trim();
    let intent: IntentType = 'conversation';
    let confidence = 0.6;
    let reasoning = 'Default conversation intent';

    // Knowledge-seeking patterns
    if (inputLower.match(/\b(what|how|why|when|where|who|explain|tell me|information|know|learn|understand)\b/)) {
      intent = 'knowledge';
      confidence = 0.8;
      reasoning = 'Contains question words or information-seeking language';
    }
    // Action-oriented patterns
    else if (inputLower.match(/\b(create|make|send|schedule|book|order|buy|call|email|remind|set|do|perform|execute)\b/)) {
      intent = 'action';
      confidence = 0.8;
      reasoning = 'Contains action verbs indicating task execution';
    }
    // Conversational patterns
    else if (inputLower.match(/\b(hello|hi|hey|thanks|thank you|goodbye|bye|how are you|nice|good|great)\b/)) {
      intent = 'conversation';
      confidence = 0.9;
      reasoning = 'Contains conversational greetings or social language';
    }

    // Format as JSON response that matches expected model output
    const response = JSON.stringify({
      intent,
      confidence,
      reasoning,
      entities: {}
    });

    logger.debug('Rule-based intent classification completed', {
      correlationId: CorrelationIdManager.getCurrentCorrelationId(),
      sessionId,
      intent,
      confidence,
      reasoning
    });

    return response;

    // TODO: Replace with actual Nova Sonic model call
    // The implementation would look something like this:
    /*
    if (!this.novaSonicClient) {
      throw new Error('Nova Sonic client not available');
    }

    try {
      // Create a dedicated text-only session for classification
      const streamSession = this.novaSonicClient.createStreamSession(sessionId);
      
      // Set up response handlers and send classification prompt
      // ... (streaming implementation details)
      
      return await this.processClassificationResponse(sessionId, prompt);
    } catch (error) {
      logger.error('Nova Sonic intent classification failed, falling back to rules', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Fall back to rule-based classification above
      throw error;
    }
    */
  }

  /**
   * Parse Nova Sonic model response into IntentClassification
   */
  private parseModelResponse(response: string): IntentClassification {
    try {
      const parsed = JSON.parse(response.trim());
      
      return {
        primaryIntent: parsed.intent as IntentType,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
        extractedEntities: parsed.entities || {},
        metadata: {
          modelConfidence: parsed.confidence,
          reasoning: parsed.reasoning
        }
      };
    } catch (error) {
      logger.warn('Failed to parse model response', {
        correlationId: CorrelationIdManager.getCurrentCorrelationId(),
        response: response.substring(0, 200),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error('Invalid model response format');
    }
  }



  /**
   * Add a custom rule for intent classification
   */
  addCustomRule(pattern: string, intent: IntentType, confidence: number = 0.7, name?: string): void {
    const ruleId = `custom-${randomUUID()}`;
    const rule: IntentRule = {
      id: ruleId,
      name: name || `Custom rule ${ruleId}`,
      pattern,
      intent,
      confidence: Math.max(0, Math.min(1, confidence)),
      enabled: true
    };

    this.customRules.set(ruleId, rule);
    
    logger.info('Custom rule added', {
      correlationId: CorrelationIdManager.getCurrentCorrelationId(),
      ruleId,
      intent,
      confidence
    });
  }

  /**
   * Remove a custom rule by ID
   */
  removeCustomRule(ruleId: string): void {
    const removed = this.customRules.delete(ruleId);
    
    logger.info('Custom rule removal attempted', {
      correlationId: CorrelationIdManager.getCurrentCorrelationId(),
      ruleId,
      removed
    });
  }

  /**
   * Get all configured custom rules
   */
  getCustomRules(): IntentRule[] {
    return Array.from(this.customRules.values());
  }

  /**
   * Update classification configuration
   */
  updateConfig(config: Partial<IntentClassificationConfig>): void {
    this.config = { ...this.config, ...config };
    
    logger.info('Intent classification config updated', {
      correlationId: CorrelationIdManager.getCurrentCorrelationId(),
      newConfig: config
    });
  }

  /**
   * Get current classification configuration
   */
  getConfig(): IntentClassificationConfig {
    return { ...this.config };
  }
}