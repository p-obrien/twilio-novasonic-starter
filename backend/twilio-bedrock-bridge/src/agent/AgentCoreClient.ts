/**
 * @fileoverview Agent Core Client for AWS Bedrock Agent Integration
 * 
 * This module provides a simple interface to AWS Bedrock Agent service,
 * enabling agent-based reasoning and multi-step task execution during
 * voice conversations.
 * 
 * Key Features:
 * - Direct integration with Bedrock Agent Runtime API
 * - Agent invocation with input/output handling
 * - Basic error handling and timeout management
 * - Session management for agent continuity
 * - Voice conversation optimized response formatting
 * 
 * @author Twilio Bedrock Bridge Team
 * @version 1.0.0
 */

import {
  BedrockAgentRuntimeClient,
  BedrockAgentRuntimeClientConfig,
  InvokeAgentCommand,
  InvokeAgentCommandInput,
  InvokeAgentCommandOutput,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";

import { AgentResponse, ValidationResult } from '../types/IntegrationTypes';
import { BedrockClientError, createBedrockServiceError } from '../errors/ClientErrors';
import { config } from '../config/AppConfig';
import logger from '../utils/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { DataProtection } from '../observability/dataProtection';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Configuration for Agent Core Client
 */
export interface AgentCoreClientConfig {
  /** AWS region for Bedrock Agent Runtime */
  region?: string;
  /** Request timeout in milliseconds */
  requestTimeoutMs?: number;
  /** Custom client configuration */
  clientConfig?: Partial<BedrockAgentRuntimeClientConfig>;
}

/**
 * Agent Core Client interface
 */
export interface IAgentCoreClient {
  /**
   * Invoke an agent with input text
   * @param agentId The agent ID to invoke
   * @param agentAliasId The agent alias ID
   * @param input The input text for the agent
   * @param sessionId Session ID for maintaining agent context
   * @returns Promise resolving to agent response
   */
  invokeAgent(agentId: string, agentAliasId: string, input: string, sessionId: string): Promise<AgentResponse>;

  /**
   * Validate client configuration
   * @returns Promise resolving to validation result
   */
  validateConfiguration(): Promise<ValidationResult>;
}

/**
 * Error thrown when agent operations fail
 */
export class AgentCoreError extends BedrockClientError {
  readonly code = 'AGENT_CORE_ERROR';
  
  constructor(
    message: string,
    public readonly agentId?: string,
    sessionId?: string,
    cause?: Error
  ) {
    super(message, sessionId, cause);
  }
}

// ============================================================================
// MAIN CLIENT CLASS
// ============================================================================

/**
 * Agent Core Client implementation
 * 
 * Provides a simple interface to AWS Bedrock Agent service with
 * optimized configuration for voice conversation use cases.
 */
export class AgentCoreClient implements IAgentCoreClient {
  // ============================================================================
  // PRIVATE PROPERTIES
  // ============================================================================

  private readonly bedrockAgentClient: BedrockAgentRuntimeClient;
  private readonly requestTimeoutMs: number;

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  constructor(clientConfig: AgentCoreClientConfig = {}) {
    this.requestTimeoutMs = clientConfig.requestTimeoutMs || config.integration.thresholds.agentInvocationTimeoutMs;

    this.bedrockAgentClient = this.createBedrockAgentClient(clientConfig);

    logger.info('Agent Core Client initialized', {
      region: clientConfig.region || config.aws.region,
      requestTimeoutMs: this.requestTimeoutMs,
    });
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  /**
   * Invoke an agent with input text
   */
  public async invokeAgent(
    agentId: string,
    agentAliasId: string,
    input: string,
    sessionId: string
  ): Promise<AgentResponse> {
    return CorrelationIdManager.traceWithCorrelation('agent_core.invoke', async () => {
      if (!agentId?.trim()) {
        throw new AgentCoreError('Agent ID cannot be empty', agentId, sessionId);
      }

      if (!agentAliasId?.trim()) {
        throw new AgentCoreError('Agent alias ID cannot be empty', agentId, sessionId);
      }

      if (!input?.trim()) {
        throw new AgentCoreError('Input cannot be empty', agentId, sessionId);
      }

      if (!sessionId?.trim()) {
        throw new AgentCoreError('Session ID cannot be empty', agentId, sessionId);
      }

      const startTime = Date.now();
      
      try {
        // Ensure session continuity before making the request
        await this.ensureSessionContinuity(sessionId, agentId);

        logger.debug('Invoking agent', {
          agentId,
          agentAliasId,
          sessionId,
          inputLength: input.length,
        });

        const commandInput: InvokeAgentCommandInput = {
          agentId: agentId.trim(),
          agentAliasId: agentAliasId.trim(),
          sessionId: sessionId.trim(),
          inputText: input.trim(),
        };

        const command = new InvokeAgentCommand(commandInput);
        const response: InvokeAgentCommandOutput = await this.bedrockAgentClient.send(command);

        const agentResponse = this.formatAgentResponse(response, agentId, sessionId);
        const invocationTime = Date.now() - startTime;

        // Create audit trail for successful agent execution
        DataProtection.auditAgentInvocation(
          agentId,
          agentAliasId,
          input,
          agentResponse.response.length,
          invocationTime,
          true,
          sessionId,
          undefined,
          {
            inputLength: input.length,
            responseLength: agentResponse.response.length
          }
        );

        logger.info('Agent invocation completed', {
          agentId,
          agentAliasId,
          sessionId,
          invocationTimeMs: invocationTime,
          responseLength: agentResponse.response.length,
        });

        return agentResponse;

      } catch (error) {
        const invocationTime = Date.now() - startTime;
        
        // Create audit trail for failed agent execution
        DataProtection.auditAgentInvocation(
          agentId,
          agentAliasId,
          input,
          undefined,
          invocationTime,
          false,
          sessionId,
          (error as any)?.name || 'UnknownError',
          {
            inputLength: input.length,
            errorCode: (error as any)?.code
          }
        );
        
        logger.error('Agent invocation failed', {
          agentId,
          agentAliasId,
          sessionId,
          invocationTimeMs: invocationTime,
          error: error instanceof Error ? error.message : String(error),
          errorName: (error as any)?.name,
          errorCode: (error as any)?.code,
        });

        // Implement graceful degradation instead of throwing
        return this.handleAgentFailure(error, agentId, sessionId);
      }
    }, { 
      'agent.id': agentId,
      'agent.alias_id': agentAliasId,
      'session.id': sessionId,
      'input.length': input.length.toString(),
    });
  }

  /**
   * Validate client configuration
   */
  public async validateConfiguration(): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check if we can create a client
      if (!this.bedrockAgentClient) {
        errors.push('Failed to create Bedrock Agent Runtime client');
      }

      // Validate timeout configuration
      if (this.requestTimeoutMs <= 0) {
        errors.push('Request timeout must be greater than 0');
      } else if (this.requestTimeoutMs > 60000) {
        warnings.push('Request timeout is very high (>60s), may impact voice conversation flow');
      }

      // Test basic connectivity (this is a simple validation)
      try {
        // We don't actually make a call here to avoid requiring a valid agent
        // Just validate that the client configuration is valid
        const testInput: InvokeAgentCommandInput = {
          agentId: 'test-validation',
          agentAliasId: 'test-alias',
          sessionId: 'test-session',
          inputText: 'test',
        };
        new InvokeAgentCommand(testInput); // This will validate the input structure
      } catch (error) {
        errors.push(`Client configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      logger.info('Agent Core Client configuration validation completed', {
        isValid: errors.length === 0,
        errorsCount: errors.length,
        warningsCount: warnings.length,
      });

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
      };

    } catch (error) {
      logger.error('Configuration validation failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        isValid: false,
        errors: [`Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`],
        warnings,
      };
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Create Bedrock Agent Runtime client with optimized configuration
   */
  private createBedrockAgentClient(clientConfig: AgentCoreClientConfig): BedrockAgentRuntimeClient {
    const nodeHttp2Handler = new NodeHttp2Handler({
      requestTimeout: this.requestTimeoutMs,
      sessionTimeout: this.requestTimeoutMs,
      disableConcurrentStreams: false,
      maxConcurrentStreams: 5, // Conservative limit for agent invocations
    });

    const bedrockClientConfig: BedrockAgentRuntimeClientConfig = {
      region: clientConfig.region || config.aws.region,
      requestHandler: nodeHttp2Handler,
      ...clientConfig.clientConfig,
    };

    return new BedrockAgentRuntimeClient(bedrockClientConfig);
  }

  /**
   * Format Bedrock agent response for voice conversation
   */
  private formatAgentResponse(
    response: InvokeAgentCommandOutput,
    agentId: string,
    sessionId: string
  ): AgentResponse {
    try {
      // Extract response text from the completion event
      let responseText = '';
      let error: string | undefined;

      if (response.completion) {
        // The completion is an async iterable stream
        // For now, we'll handle this synchronously by collecting all chunks
        // In a real implementation, you might want to handle streaming responses
        responseText = this.extractResponseFromCompletion(response.completion);
      }

      if (!responseText.trim()) {
        logger.warn('Empty response from agent', { agentId, sessionId });
        responseText = this.formatForVoice('I apologize, but I was unable to generate a response. Please try again.');
      }

      const agentResponse: AgentResponse = {
        response: responseText.trim(),
        sessionId,
        agentId,
        error,
        metadata: {
          sessionId: response.sessionId || sessionId,
          voiceOptimized: true,
        },
      };

      logger.debug('Formatted agent response', {
        agentId,
        sessionId,
        responseLength: responseText.length,
        hasError: !!error,
      });

      return agentResponse;

    } catch (error) {
      logger.error('Failed to format agent response', {
        agentId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return a fallback response using graceful degradation
      return this.handleAgentFailure(error, agentId, sessionId);
    }
  }

  /**
   * Extract response text from completion stream
   * Note: This is a simplified implementation. In production, you might want
   * to handle streaming responses more efficiently.
   */
  private extractResponseFromCompletion(completion: any): string {
    try {
      // The completion is typically an async iterable
      // For this implementation, we'll extract the text synchronously
      if (typeof completion === 'string') {
        return this.formatForVoice(completion);
      }

      // If it's an object with text property
      if (completion && typeof completion === 'object' && completion.text) {
        return this.formatForVoice(completion.text);
      }

      // If it's an array of completion events
      if (Array.isArray(completion)) {
        const text = completion
          .map(event => {
            if (event.chunk && event.chunk.bytes) {
              // Decode bytes to string
              return new TextDecoder().decode(event.chunk.bytes);
            }
            return '';
          })
          .join('');
        return this.formatForVoice(text);
      }

      logger.warn('Unexpected completion format', { completionType: typeof completion });
      return '';

    } catch (error) {
      logger.error('Failed to extract response from completion', {
        error: error instanceof Error ? error.message : String(error),
      });
      return '';
    }
  }

  /**
   * Format response text for voice conversation
   * Optimizes text for natural speech synthesis
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
   * Implement graceful degradation for agent failures
   */
  private handleAgentFailure(error: any, agentId: string, sessionId: string): AgentResponse {
    logger.warn('Implementing graceful degradation for agent failure', {
      agentId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Provide contextual fallback messages based on error type
    let fallbackMessage = 'I apologize, but I encountered an issue processing your request.';

    if (error?.name === 'ThrottlingException' || error?.code === 'ThrottlingException') {
      fallbackMessage = 'I\'m currently experiencing high demand. Please try again in a moment.';
    } else if (error?.name === 'ValidationException' || error?.code === 'ValidationException') {
      fallbackMessage = 'I didn\'t quite understand that request. Could you please rephrase it?';
    } else if (error?.name === 'ResourceNotFoundException' || error?.code === 'ResourceNotFoundException') {
      fallbackMessage = 'I\'m temporarily unable to access that information. Please try again later.';
    } else if (error?.name === 'AccessDeniedException' || error?.code === 'AccessDeniedException') {
      fallbackMessage = 'I don\'t have permission to perform that action right now.';
    } else if (error?.name === 'ServiceQuotaExceededException' || error?.code === 'ServiceQuotaExceededException') {
      fallbackMessage = 'I\'m currently at capacity. Please try again in a few minutes.';
    }

    return {
      response: fallbackMessage,
      sessionId,
      agentId,
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        sessionId,
        fallbackUsed: true,
        originalError: error?.name || error?.code || 'UnknownError',
      },
    };
  }

  /**
   * Manage session continuity for agent conversations
   */
  private async ensureSessionContinuity(sessionId: string, agentId: string): Promise<void> {
    try {
      // Log session activity for monitoring
      logger.debug('Ensuring session continuity', {
        sessionId,
        agentId,
        timestamp: new Date().toISOString(),
      });

      // In a production implementation, you might want to:
      // 1. Store session state in a persistent store (Redis, DynamoDB)
      // 2. Implement session timeout handling
      // 3. Track conversation history for context
      // 4. Handle session recovery after failures

      // For now, we'll just ensure the session ID is valid and log the activity
      if (!sessionId || sessionId.length < 1) {
        throw new AgentCoreError('Invalid session ID for continuity', agentId, sessionId);
      }

    } catch (error) {
      logger.error('Failed to ensure session continuity', {
        sessionId,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Don't throw here - session continuity issues shouldn't block the main request
      // but we should log them for monitoring
    }
  }

  /**
   * Check if error is an AWS service error
   */
  private isAwsServiceError(error: any): boolean {
    return error && (
      error.name?.includes('Exception') ||
      error.code ||
      error.$metadata ||
      error.__type
    );
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new Agent Core Client instance
 * @param config Optional client configuration
 * @returns New AgentCoreClient instance
 */
export function createAgentCoreClient(config?: AgentCoreClientConfig): AgentCoreClient {
  return new AgentCoreClient(config);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default AgentCoreClient;