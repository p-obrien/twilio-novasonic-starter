/**
 * Type definitions for AgentCore and Knowledge Base integration
 */

/**
 * Configuration for a single knowledge base
 */
export interface KnowledgeBaseConfig {
  /** Unique identifier for this knowledge base configuration */
  id: string;
  /** AWS Bedrock Knowledge Base ID */
  knowledgeBaseId: string;
  /** Human-readable name for the knowledge base */
  name?: string;
  /** Whether this knowledge base is enabled */
  enabled: boolean;
  /** Optional domain or category for routing */
  domain?: string;
  /** Priority for multi-knowledge base scenarios (higher = more priority) */
  priority?: number;
}

/**
 * Configuration for a single agent
 */
export interface AgentConfig {
  /** Unique identifier for this agent configuration */
  id: string;
  /** AWS Bedrock Agent ID */
  agentId: string;
  /** AWS Bedrock Agent Alias ID */
  agentAliasId: string;
  /** Human-readable name for the agent */
  name?: string;
  /** Whether this agent is enabled */
  enabled: boolean;
  /** Optional category or use case for routing */
  category?: string;
  /** Priority for multi-agent scenarios (higher = more priority) */
  priority?: number;
}

/**
 * Threshold and timeout configurations for integration
 */
export interface ThresholdConfig {
  /** Minimum confidence threshold for intent classification (0.0 - 1.0) */
  intentConfidenceThreshold: number;
  /** Timeout for knowledge base queries in milliseconds */
  knowledgeQueryTimeoutMs: number;
  /** Timeout for agent invocations in milliseconds */
  agentInvocationTimeoutMs: number;
  /** Maximum number of retries for failed operations */
  maxRetries: number;
}

/**
 * Complete integration configuration
 */
export interface IntegrationConfig {
  /** Knowledge base configurations */
  knowledgeBases: KnowledgeBaseConfig[];
  /** Agent configurations */
  agents: AgentConfig[];
  /** Threshold and timeout settings */
  thresholds: ThresholdConfig;
  /** Whether integration features are enabled globally */
  enabled: boolean;
}

/**
 * Intent classification result
 */
export interface IntentClassification {
  /** Primary intent type */
  primaryIntent: 'knowledge' | 'action' | 'conversation';
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Extracted entities from the input */
  extractedEntities?: Record<string, any>;
  /** Custom rule that was matched, if any */
  customRuleMatched?: string;
  /** Additional metadata about the classification */
  metadata?: Record<string, any>;
}

/**
 * Knowledge base query result
 */
export interface KnowledgeResult {
  /** The content/answer from the knowledge base */
  content: string;
  /** Source document or reference */
  source: string;
  /** Confidence score for this result (0.0 - 1.0) */
  confidence: number;
  /** Additional metadata about the result */
  metadata: Record<string, any>;
  /** Knowledge base ID that provided this result */
  knowledgeBaseId: string;
}

/**
 * Agent execution response
 */
export interface AgentResponse {
  /** The response content from the agent */
  response: string;
  /** Session ID for maintaining agent context */
  sessionId: string;
  /** Agent ID that provided this response */
  agentId: string;
  /** Error message if execution failed */
  error?: string;
  /** Additional metadata about the execution */
  metadata?: Record<string, any>;
}

/**
 * Validation result for configuration
 */
export interface ValidationResult {
  /** Whether the configuration is valid */
  isValid: boolean;
  /** List of validation errors */
  errors: string[];
  /** List of validation warnings */
  warnings: string[];
}