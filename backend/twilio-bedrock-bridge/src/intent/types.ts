/**
 * @fileoverview Intent Classification Types
 * 
 * Defines the core types and interfaces for intent classification system
 * that determines whether user input requires knowledge retrieval, agent execution,
 * or direct conversation with Nova Sonic.
 */

/**
 * Primary intent types for routing user input
 */
export type IntentType = 'knowledge' | 'action' | 'conversation';

/**
 * Intent classification result with confidence scoring
 */
export interface IntentClassification {
  /** Primary intent type determined by the classifier */
  primaryIntent: IntentType;
  
  /** Confidence score between 0 and 1 */
  confidence: number;
  
  /** Extracted entities from the input (optional) */
  extractedEntities?: Record<string, any>;
  
  /** Custom rule that was matched (if any) */
  customRuleMatched?: string;
  
  /** Additional metadata from classification process */
  metadata?: {
    /** Processing time in milliseconds */
    processingTimeMs?: number;
    /** Classification method used */
    method?: 'model' | 'rules' | 'fallback';
    /** Model confidence if model-based classification was used */
    modelConfidence?: number;
    /** Rule confidence if rule-based classification was used */
    ruleConfidence?: number;
    /** Reasoning from model classification */
    reasoning?: string;
    /** Rule name that was matched */
    ruleName?: string;
  };
}

/**
 * Custom rule definition for intent classification
 */
export interface IntentRule {
  /** Unique identifier for the rule */
  id: string;
  
  /** Human-readable name for the rule */
  name: string;
  
  /** Regular expression pattern to match */
  pattern: string;
  
  /** Intent type this rule maps to */
  intent: IntentType;
  
  /** Confidence score for this rule (0-1) */
  confidence: number;
  
  /** Whether this rule is enabled */
  enabled: boolean;
  
  /** Optional entity extraction patterns */
  entityPatterns?: Record<string, string>;
}

/**
 * Configuration for intent classification
 */
export interface IntentClassificationConfig {
  /** Minimum confidence threshold for accepting classifications */
  confidenceThreshold: number;
  
  /** Timeout for model-based classification in milliseconds */
  modelTimeoutMs: number;
  
  /** Whether to enable fallback to custom rules */
  enableRuleFallback: boolean;
  
  /** Whether to enable model-based classification */
  enableModelClassification: boolean;
  
  /** Custom rules for intent classification */
  customRules: IntentRule[];
}

/**
 * Context information for intent classification
 */
export interface ClassificationContext {
  /** Current session identifier */
  sessionId: string;
  
  /** Recent conversation history */
  conversationHistory: string[];
  
  /** User metadata (optional) */
  userMetadata?: Record<string, any>;
  
  /** Current timestamp */
  timestamp: Date;
  
  /** Previous intent classifications in this session */
  previousIntents?: IntentClassification[];
}