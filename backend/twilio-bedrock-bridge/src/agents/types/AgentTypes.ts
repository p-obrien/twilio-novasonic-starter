/**
 * @fileoverview Agent-specific type definitions
 * 
 * Type definitions for AWS Bedrock Agent Core integration with Nova Sonic
 */

// Remove unused imports - these types don't exist in the current SDK

/**
 * Basic agent information
 */
export interface Agent {
  agentId: string;
  agentName?: string;
  agentStatus?: string;
  description?: string;
}

/**
 * Extended agent information with voice-specific metadata
 */
export interface VoiceAgent extends Agent {
  /** Whether this agent is optimized for voice interactions */
  voiceOptimized?: boolean;
  /** Expected response time for voice interactions (ms) */
  expectedResponseTime?: number;
  /** Supported voice interaction types */
  supportedInteractions?: VoiceInteractionType[];
  /** Agent capabilities for voice */
  voiceCapabilities?: VoiceCapability[];
}

/**
 * Types of voice interactions an agent can handle
 */
export enum VoiceInteractionType {
  QUERY = 'query',
  COMMAND = 'command',
  CONVERSATION = 'conversation',
  TASK_EXECUTION = 'task_execution'
}

/**
 * Voice-specific capabilities
 */
export enum VoiceCapability {
  REAL_TIME_RESPONSE = 'real_time_response',
  CONTEXT_AWARENESS = 'context_awareness',
  MULTI_TURN_CONVERSATION = 'multi_turn_conversation',
  INTERRUPTION_HANDLING = 'interruption_handling'
}

/**
 * Agent execution context for voice conversations
 */
export interface VoiceExecutionContext {
  /** Current conversation session ID */
  conversationSessionId: string;
  /** Call SID from Twilio */
  callSid?: string;
  /** User's speaking state */
  userSpeaking?: boolean;
  /** Conversation history */
  conversationHistory?: ConversationTurn[];
  /** Voice-specific preferences */
  voicePreferences?: VoicePreferences;
}

/**
 * Individual conversation turn
 */
export interface ConversationTurn {
  /** Turn ID */
  id: string;
  /** Speaker role */
  role: 'user' | 'assistant' | 'agent';
  /** Turn content */
  content: string;
  /** Turn timestamp */
  timestamp: number;
  /** Turn duration (ms) */
  duration?: number;
  /** Associated tool calls */
  toolCalls?: string[];
}

/**
 * Voice interaction preferences
 */
export interface VoicePreferences {
  /** Preferred response length */
  responseLength: 'brief' | 'detailed' | 'adaptive';
  /** Speaking pace preference */
  pace: 'slow' | 'normal' | 'fast';
  /** Formality level */
  formality: 'casual' | 'professional' | 'adaptive';
  /** Include confirmations */
  includeConfirmations: boolean;
}

/**
 * Agent performance metrics for voice interactions
 */
export interface VoiceAgentMetrics {
  /** Agent ID */
  agentId: string;
  /** Average response time (ms) */
  averageResponseTime: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Total executions */
  totalExecutions: number;
  /** Voice-specific metrics */
  voiceMetrics: {
    /** Average speech generation time (ms) */
    averageSpeechTime: number;
    /** User satisfaction score (0-1) */
    satisfactionScore?: number;
    /** Interruption rate (0-1) */
    interruptionRate: number;
  };
}

/**
 * Agent configuration for voice optimization
 */
export interface VoiceAgentConfig {
  /** Agent ID */
  agentId: string;
  /** Agent alias ID */
  agentAliasId?: string;
  /** Voice-specific settings */
  voiceSettings: {
    /** Maximum response time for voice (ms) */
    maxResponseTime: number;
    /** Enable real-time streaming */
    enableStreaming: boolean;
    /** Response format preference */
    responseFormat: 'speech_optimized' | 'natural' | 'structured';
    /** Context retention settings */
    contextRetention: {
      /** Number of turns to remember */
      maxTurns: number;
      /** Context timeout (ms) */
      timeoutMs: number;
    };
  };
}

/**
 * Tool execution result with voice-specific formatting
 */
export interface VoiceToolResult {
  /** Tool execution success */
  success: boolean;
  /** Raw result data */
  data: any;
  /** Speech-optimized text */
  speechText: string;
  /** Display text (if different from speech) */
  displayText?: string;
  /** Execution metadata */
  metadata: {
    /** Execution time (ms) */
    executionTime: number;
    /** Tool name */
    toolName: string;
    /** Agent ID that executed the tool */
    agentId: string;
  };
}

/**
 * Agent error types specific to voice interactions
 */
export enum VoiceAgentErrorType {
  TIMEOUT = 'timeout',
  SPEECH_GENERATION_FAILED = 'speech_generation_failed',
  CONTEXT_LOST = 'context_lost',
  INTERRUPTION_HANDLING_FAILED = 'interruption_handling_failed',
  AGENT_UNAVAILABLE = 'agent_unavailable',
  TOOL_EXECUTION_FAILED = 'tool_execution_failed'
}

/**
 * Voice agent error with context
 */
export interface VoiceAgentError extends Error {
  /** Error type */
  type: VoiceAgentErrorType;
  /** Agent ID */
  agentId: string;
  /** Session ID */
  sessionId?: string;
  /** Additional context */
  context?: Record<string, any>;
  /** Recovery suggestions */
  recoverySuggestions?: string[];
}