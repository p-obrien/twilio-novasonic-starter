/**
 * @fileoverview AWS Bedrock Agent Runtime Manager
 * 
 * Integrates AWS Bedrock Agent Runtime with Nova Sonic's tool usage capabilities
 * for real-time voice conversations. Handles tool execution, result formatting,
 * and error handling optimized for voice interactions.
 */

import {
  BedrockAgentRuntimeClient,
  BedrockAgentRuntimeClientConfig,
  InvokeAgentCommand,
  InvokeAgentCommandInput,
  InvokeAgentCommandOutput,
  InvokeAgentRequest,
  InvokeAgentResponse
} from '@aws-sdk/client-bedrock-agent-runtime';

// Internal modules
import { config } from '../config/AppConfig';
import logger from '../observability/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { extractErrorDetails } from '../errors/ClientErrors';

/**
 * Tool use event structure from Nova Sonic
 */
export interface NovaToolUseEvent {
  toolUseId: string;
  name: string;
  input: Record<string, any>;
}

/**
 * Tool result structure for Nova Sonic
 */
export interface NovaToolResult {
  toolUseId: string;
  content: Array<{ text: string }>;
  status?: 'success' | 'error';
}

/**
 * Agent Core configuration for voice interactions
 */
export interface AgentCoreConfig {
  agentId: string;
  agentAliasId?: string;
  sessionId?: string;
  timeout?: number;
  maxRetries?: number;
  enableTrace?: boolean;
}

/**
 * Agent execution result with voice-optimized formatting
 */
export interface AgentExecutionResult {
  success: boolean;
  response: string;
  speechText?: string;
  data?: any;
  executionTime: number;
  agentId: string;
  sessionId?: string;
}

/**
 * AWS Bedrock Agent Runtime Manager
 * 
 * Manages agent execution for Nova Sonic tool usage in real-time voice conversations.
 * Optimized for low-latency voice interactions with proper error handling and
 * speech-friendly response formatting.
 */
export class AgentCoreManager {
  private readonly client: BedrockAgentRuntimeClient;
  private readonly defaultConfig: Required<Omit<AgentCoreConfig, 'agentId' | 'agentAliasId' | 'sessionId'>>;
  private readonly sessionCache = new Map<string, string>(); // sessionId -> agentSessionId mapping

  constructor(
    agentConfig: AgentCoreConfig,
    clientConfig?: Partial<BedrockAgentRuntimeClientConfig>
  ) {
    // Initialize Bedrock Agent Runtime client
    const bedrockClientConfig: BedrockAgentRuntimeClientConfig = {
      region: config.bedrock?.region || config.aws?.region || 'us-east-1',
      ...clientConfig
    };

    this.client = new BedrockAgentRuntimeClient(bedrockClientConfig);

    // Set voice-optimized defaults
    this.defaultConfig = {
      timeout: agentConfig.timeout || 15000, // 15s max for voice interactions
      maxRetries: agentConfig.maxRetries || 1, // Quick failure for real-time
      enableTrace: agentConfig.enableTrace ?? false
    };

    logger.info('AgentCoreManager initialized', {
      region: bedrockClientConfig.region,
      timeout: this.defaultConfig.timeout,
      maxRetries: this.defaultConfig.maxRetries,
      correlationId: CorrelationIdManager.getCurrentCorrelationId()
    });
  }

  /**
   * Execute a tool using AWS Bedrock Agent Runtime
   * 
   * @param toolUse - Tool use event from Nova Sonic
   * @param agentConfig - Agent configuration for this execution
   * @returns Promise resolving to tool result for Nova Sonic
   */
  public async executeTool(
    toolUse: NovaToolUseEvent,
    agentConfig: AgentCoreConfig
  ): Promise<NovaToolResult> {
    const startTime = Date.now();
    const correlationId = CorrelationIdManager.getCurrentCorrelationId();

    logger.info('Executing tool via Agent Runtime', {
      toolUseId: toolUse.toolUseId,
      toolName: toolUse.name,
      agentId: agentConfig.agentId,
      correlationId
    });

    try {
      // Get or create agent session
      const agentSessionId = await this.getOrCreateAgentSession(
        agentConfig.agentId,
        agentConfig.sessionId ?? correlationId ?? `session-${Date.now()}`
      );

      // Prepare agent invocation
      const invokeInput: InvokeAgentCommandInput = {
        agentId: agentConfig.agentId,
        agentAliasId: agentConfig.agentAliasId || 'TSTALIASID', // Default test alias
        sessionId: agentSessionId,
        inputText: this.formatToolInputForAgent(toolUse),
        enableTrace: this.defaultConfig.enableTrace
      };

      // Execute agent with timeout
      const result = await this.executeWithTimeout(
        () => this.client.send(new InvokeAgentCommand(invokeInput)),
        this.defaultConfig.timeout
      );

      // Process and format result
      const executionResult = await this.processAgentResponse(result, {
        toolUseId: toolUse.toolUseId,
        toolName: toolUse.name,
        agentId: agentConfig.agentId,
        sessionId: agentSessionId,
        executionTime: Date.now() - startTime
      });

      logger.info('Tool execution completed successfully', {
        toolUseId: toolUse.toolUseId,
        toolName: toolUse.name,
        executionTime: executionResult.executionTime,
        responseLength: executionResult.response.length,
        correlationId
      });

      return {
        toolUseId: toolUse.toolUseId,
        content: [{ text: executionResult.speechText || executionResult.response }],
        status: 'success'
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorDetails = extractErrorDetails(error);

      logger.error('Tool execution failed', {
        toolUseId: toolUse.toolUseId,
        toolName: toolUse.name,
        agentId: agentConfig.agentId,
        executionTime,
        ...errorDetails,
        correlationId
      });

      return {
        toolUseId: toolUse.toolUseId,
        content: [{ 
          text: this.formatErrorForVoice(error, toolUse.name) 
        }],
        status: 'error'
      };
    }
  }

  /**
   * Get or create agent session for conversation continuity
   */
  private async getOrCreateAgentSession(agentId: string, sessionId: string): Promise<string> {
    const cacheKey = `${agentId}:${sessionId}`;
    
    if (this.sessionCache.has(cacheKey)) {
      return this.sessionCache.get(cacheKey)!;
    }

    // For Agent Runtime, we can use the provided sessionId directly
    // or generate a unique one for this agent-session combination
    const agentSessionId = `${sessionId}-${agentId}-${Date.now()}`;
    
    this.sessionCache.set(cacheKey, agentSessionId);
    
    logger.debug('Created agent session', {
      agentId,
      sessionId,
      agentSessionId
    });

    return agentSessionId;
  }

  /**
   * Format tool input for agent consumption
   */
  private formatToolInputForAgent(toolUse: NovaToolUseEvent): string {
    // Create a natural language request that the agent can understand
    const inputParams = Object.entries(toolUse.input)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(', ');

    return `Please execute the ${toolUse.name} tool with the following parameters: ${inputParams}`;
  }

  /**
   * Process agent response and format for voice output
   */
  private async processAgentResponse(
    response: InvokeAgentCommandOutput,
    context: {
      toolUseId: string;
      toolName: string;
      agentId: string;
      sessionId: string;
      executionTime: number;
    }
  ): Promise<AgentExecutionResult> {
    // Extract response text from agent output
    let responseText = '';
    let speechText = '';

    // Process the completion stream if available
    if (response.completion) {
      // The completion is an async iterable stream
      const chunks: string[] = [];
      
      try {
        for await (const chunk of response.completion) {
          if (chunk.chunk?.bytes) {
            const text = new TextDecoder().decode(chunk.chunk.bytes);
            chunks.push(text);
          }
        }
        
        responseText = chunks.join('');
        speechText = this.formatResponseForSpeech(responseText, context.toolName);
        
      } catch (streamError) {
        logger.warn('Error processing agent response stream', {
          error: extractErrorDetails(streamError),
          sessionId: context.sessionId
        });
        
        responseText = 'Agent executed successfully but response stream had issues';
        speechText = `I've completed the ${context.toolName} request.`;
      }
    } else {
      responseText = 'Agent execution completed';
      speechText = `I've processed your ${context.toolName} request.`;
    }

    return {
      success: true,
      response: responseText,
      speechText,
      data: response,
      executionTime: context.executionTime,
      agentId: context.agentId,
      sessionId: context.sessionId
    };
  }

  /**
   * Format agent response for natural speech
   */
  private formatResponseForSpeech(response: string, toolName: string): string {
    // Clean up response for voice output
    let speechText = response
      .replace(/\n+/g, '. ') // Replace newlines with periods
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // Ensure it sounds natural when spoken
    if (!speechText.endsWith('.') && !speechText.endsWith('!') && !speechText.endsWith('?')) {
      speechText += '.';
    }

    // Add context if response is too short
    if (speechText.length < 10) {
      speechText = `I've completed the ${toolName} request. ${speechText}`;
    }

    return speechText;
  }

  /**
   * Format error for voice-friendly output
   */
  private formatErrorForVoice(error: unknown, toolName: string): string {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Create user-friendly error messages for common issues
    if (errorMessage.includes('timeout')) {
      return `I'm sorry, the ${toolName} request took too long to complete. Please try again.`;
    }
    
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      return `I couldn't find the information you requested with ${toolName}.`;
    }
    
    if (errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
      return `I don't have permission to complete that ${toolName} request.`;
    }
    
    // Generic error message
    return `I encountered an issue while processing your ${toolName} request. Please try again later.`;
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Agent execution timeout')), timeoutMs);
      })
    ]);
  }

  /**
   * Clear session cache for cleanup
   */
  public clearSessionCache(sessionId?: string): void {
    if (sessionId) {
      // Clear specific session
      for (const [key] of this.sessionCache.entries()) {
        if (key.includes(sessionId)) {
          this.sessionCache.delete(key);
        }
      }
    } else {
      // Clear all sessions
      this.sessionCache.clear();
    }
    
    logger.debug('Session cache cleared', { sessionId: sessionId || 'all' });
  }

  /**
   * Get manager statistics
   */
  public getStats() {
    return {
      activeSessions: this.sessionCache.size,
      configuration: {
        timeout: this.defaultConfig.timeout,
        maxRetries: this.defaultConfig.maxRetries,
        enableTrace: this.defaultConfig.enableTrace
      }
    };
  }

  /**
   * Cleanup resources
   */
  public async cleanup(): Promise<void> {
    this.sessionCache.clear();
    
    logger.info('AgentCoreManager cleanup completed');
  }
}

// Export types for use in other modules
export type {
  AgentCoreConfig as AgentConfig,
  NovaToolUseEvent as ToolUseEvent,
  NovaToolResult as ToolResult,
  AgentExecutionResult as ExecutionResult
};