/**
 * @fileoverview Intent Classifier Interface and Implementation
 * 
 * Provides intent classification capabilities using Nova Sonic model-based extraction.
 * Determines whether user input requires knowledge retrieval, agent execution, or direct conversation.
 */

import { ConversationContext } from '../types/SharedTypes';
import {
  IntentClassification,
  IntentType,
  IntentRule,
  IntentClassificationConfig,
  ClassificationContext
} from './types';

/**
 * Interface for intent classification implementations
 */
export interface IntentClassifier {
  /**
   * Classify user input to determine appropriate routing
   * @param input User input text to classify
   * @param context Conversation context for classification
   * @returns Promise resolving to intent classification result
   */
  classifyIntent(input: string, context: ConversationContext): Promise<IntentClassification>;

  /**
   * Add a custom rule for intent classification
   * @param pattern Regular expression pattern to match
   * @param intent Intent type this pattern maps to
   * @param confidence Confidence score for this rule (0-1)
   * @param name Optional human-readable name for the rule
   */
  addCustomRule(pattern: string, intent: IntentType, confidence?: number, name?: string): void;

  /**
   * Remove a custom rule by ID
   * @param ruleId Rule identifier to remove
   */
  removeCustomRule(ruleId: string): void;

  /**
   * Get all configured custom rules
   * @returns Array of custom rules
   */
  getCustomRules(): IntentRule[];

  /**
   * Update classification configuration
   * @param config New configuration settings
   */
  updateConfig(config: Partial<IntentClassificationConfig>): void;

  /**
   * Get current classification configuration
   * @returns Current configuration
   */
  getConfig(): IntentClassificationConfig;
}

/**
 * Default configuration for intent classification
 */
export const DEFAULT_INTENT_CONFIG: IntentClassificationConfig = {
  confidenceThreshold: 0.7,
  modelTimeoutMs: 2000,
  enableRuleFallback: false,
  enableModelClassification: true,
  customRules: []
};