/**
 * @fileoverview Intent Classification Module Exports
 * 
 * Exports all intent classification components including interfaces,
 * implementations, and types for use throughout the application.
 */

// Core interfaces and types
export { IntentClassifier, DEFAULT_INTENT_CONFIG } from './IntentClassifier';
export { 
  IntentType, 
  IntentClassification, 
  IntentRule, 
  IntentClassificationConfig,
  ClassificationContext 
} from './types';

// Implementation
export { NovaSonicIntentClassifier } from './NovaSonicIntentClassifier';