/**
 * @fileoverview Knowledge Base Client for AWS Bedrock Knowledge Base Integration
 * 
 * This module provides a simple interface to AWS Bedrock Knowledge Base service,
 * leveraging Bedrock's internal routing and caching capabilities for efficient
 * knowledge retrieval during voice conversations.
 * 
 * Key Features:
 * - Direct integration with Bedrock Knowledge Base API
 * - Leverages Bedrock's internal multi-source handling
 * - Simple query interface with result formatting
 * - Basic error handling and timeout management
 * - Voice conversation optimized response formatting
 * 
 * @author Twilio Bedrock Bridge Team
 * @version 1.0.0
 */

import {
  BedrockAgentRuntimeClient,
  BedrockAgentRuntimeClientConfig,
  RetrieveCommand,
  RetrieveCommandInput,
  RetrieveCommandOutput,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";

import { KnowledgeResult, ValidationResult } from '../types/IntegrationTypes';
import { BedrockClientError, createBedrockServiceError, ErrorSeverity, ErrorContext } from '../errors/ClientErrors';
import { config } from '../config/AppConfig';
import logger from '../observability/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { DataProtection } from '../observability/dataProtection';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Configuration for Knowledge Base Client
 */
export interface KnowledgeBaseClientConfig {
  /** AWS region for Bedrock Agent Runtime */
  region?: string;
  /** Request timeout in milliseconds */
  requestTimeoutMs?: number;
  /** Maximum number of results to retrieve */
  maxResults?: number;
  /** Custom client configuration */
  clientConfig?: Partial<BedrockAgentRuntimeClientConfig>;
}

/**
 * Knowledge Base Client interface
 */
export interface IKnowledgeBaseClient {
  /**
   * Query a knowledge base for information
   * @param query The query string
   * @param knowledgeBaseId The knowledge base ID to query
   * @param sessionId Optional session ID for correlation
   * @returns Promise resolving to knowledge results
   */
  query(query: string, knowledgeBaseId: string, sessionId?: string): Promise<KnowledgeResult[]>;

  /**
   * Validate client configuration
   * @returns Promise resolving to validation result
   */
  validateConfiguration(): Promise<ValidationResult>;
}

/**
 * Error thrown when knowledge base operations fail
 */
export class KnowledgeBaseError extends BedrockClientError {
  readonly code = 'KNOWLEDGE_BASE_ERROR';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly retryable = true;
  
  constructor(
    message: string,
    public readonly knowledgeBaseId?: string,
    sessionId?: string,
    cause?: Error
  ) {
    const context: ErrorContext = {
      sessionId,
      operation: 'knowledge_base_query',
      timestamp: Date.now(),
      metadata: { knowledgeBaseId }
    };
    super(message, context, cause);
  }
}

// ============================================================================
// MAIN CLIENT CLASS
// ============================================================================

/**
 * Knowledge Base Client implementation
 * 
 * Provides a simple interface to AWS Bedrock Knowledge Base service with
 * optimized configuration for voice conversation use cases.
 */
export class KnowledgeBaseClient implements IKnowledgeBaseClient {
  // ============================================================================
  // PRIVATE PROPERTIES
  // ============================================================================

  private readonly bedrockAgentClient: BedrockAgentRuntimeClient;
  private readonly requestTimeoutMs: number;
  private readonly maxResults: number;

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  constructor(clientConfig: KnowledgeBaseClientConfig = {}) {
    this.requestTimeoutMs = clientConfig.requestTimeoutMs || config.integration.thresholds.knowledgeQueryTimeoutMs;
    this.maxResults = clientConfig.maxResults || 5; // Reasonable default for voice responses

    this.bedrockAgentClient = this.createBedrockAgentClient(clientConfig);

    logger.info('Knowledge Base Client initialized', {
      region: clientConfig.region || config.aws.region,
      requestTimeoutMs: this.requestTimeoutMs,
      maxResults: this.maxResults,
    });
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  /**
   * Query a knowledge base for information
   */
  public async query(
    query: string, 
    knowledgeBaseId: string, 
    sessionId?: string
  ): Promise<KnowledgeResult[]> {
    return CorrelationIdManager.traceWithCorrelation('knowledge_base.query', async () => {
      if (!query?.trim()) {
        throw new KnowledgeBaseError('Query cannot be empty', knowledgeBaseId, sessionId);
      }

      if (!knowledgeBaseId?.trim()) {
        throw new KnowledgeBaseError('Knowledge base ID cannot be empty', knowledgeBaseId, sessionId);
      }

      const startTime = Date.now();
      
      try {
        logger.debug('Querying knowledge base', {
          knowledgeBaseId,
          queryLength: query.length,
          sessionId,
          maxResults: this.maxResults,
        });

        const input: RetrieveCommandInput = {
          knowledgeBaseId: knowledgeBaseId.trim(),
          retrievalQuery: {
            text: query.trim(),
          },
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: this.maxResults,
            },
          },
        };

        const command = new RetrieveCommand(input);
        const response: RetrieveCommandOutput = await this.bedrockAgentClient.send(command);

        const results = this.formatKnowledgeResults(response, knowledgeBaseId);
        const queryTime = Date.now() - startTime;

        // Log knowledge base access for audit purposes
        DataProtection.logKnowledgeQuery(
          knowledgeBaseId,
          query,
          results.length,
          queryTime,
          true,
          sessionId || 'unknown',
          {
            maxResults: this.maxResults,
            queryLength: query.length
          }
        );

        logger.info('Knowledge base query completed', {
          knowledgeBaseId,
          sessionId,
          resultsCount: results.length,
          queryTimeMs: queryTime,
        });

        return results;

      } catch (error) {
        const queryTime = Date.now() - startTime;
        
        // Log failed knowledge base access for audit purposes
        DataProtection.logKnowledgeQuery(
          knowledgeBaseId,
          query,
          0,
          queryTime,
          false,
          sessionId || 'unknown',
          {
            maxResults: this.maxResults,
            queryLength: query.length,
            errorType: (error as any)?.name || 'UnknownError'
          }
        );
        
        logger.error('Knowledge base query failed', {
          knowledgeBaseId,
          sessionId,
          queryTimeMs: queryTime,
          error: error instanceof Error ? error.message : String(error),
          errorName: (error as any)?.name,
          errorCode: (error as any)?.code,
        });

        // Convert AWS service errors to our error type
        if (this.isAwsServiceError(error)) {
          throw createBedrockServiceError(error, 'knowledge_base_query', sessionId);
        }

        throw new KnowledgeBaseError(
          `Knowledge base query failed: ${error instanceof Error ? error.message : String(error)}`,
          knowledgeBaseId,
          sessionId,
          error instanceof Error ? error : undefined
        );
      }
    }, { 
      'knowledge_base.id': knowledgeBaseId,
      'session.id': sessionId || 'unknown',
      'query.length': query.length.toString(),
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
      } else if (this.requestTimeoutMs > 30000) {
        warnings.push('Request timeout is very high (>30s), may impact voice conversation flow');
      }

      // Validate max results
      if (this.maxResults <= 0) {
        errors.push('Max results must be greater than 0');
      } else if (this.maxResults > 10) {
        warnings.push('High max results count may impact voice response time');
      }

      // Test basic connectivity (this is a simple validation)
      try {
        // We don't actually make a call here to avoid requiring a valid knowledge base
        // Just validate that the client configuration is valid
        const testInput: RetrieveCommandInput = {
          knowledgeBaseId: 'test-validation',
          retrievalQuery: { text: 'test' },
        };
        new RetrieveCommand(testInput); // This will validate the input structure
      } catch (error) {
        errors.push(`Client configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      logger.info('Knowledge Base Client configuration validation completed', {
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
  private createBedrockAgentClient(clientConfig: KnowledgeBaseClientConfig): BedrockAgentRuntimeClient {
    const nodeHttp2Handler = new NodeHttp2Handler({
      requestTimeout: this.requestTimeoutMs,
      sessionTimeout: this.requestTimeoutMs,
      disableConcurrentStreams: false,
      maxConcurrentStreams: 10, // Reasonable limit for knowledge queries
    });

    const bedrockClientConfig: BedrockAgentRuntimeClientConfig = {
      region: clientConfig.region || config.aws.region,
      requestHandler: nodeHttp2Handler,
      ...clientConfig.clientConfig,
    };

    return new BedrockAgentRuntimeClient(bedrockClientConfig);
  }

  /**
   * Format Bedrock knowledge base results for voice conversation
   */
  private formatKnowledgeResults(
    response: RetrieveCommandOutput, 
    knowledgeBaseId: string
  ): KnowledgeResult[] {
    if (!response.retrievalResults || response.retrievalResults.length === 0) {
      logger.debug('No results returned from knowledge base', { knowledgeBaseId });
      return [];
    }

    const results: KnowledgeResult[] = [];

    for (const result of response.retrievalResults) {
      try {
        // Extract content from the result
        const content = result.content?.text || '';
        if (!content.trim()) {
          logger.debug('Skipping empty result from knowledge base', { knowledgeBaseId });
          continue;
        }

        // Extract source information
        const source = this.extractSourceInfo(result);
        
        // Extract confidence score (Bedrock provides this as a score between 0-1)
        const confidence = result.score || 0.0;

        // Build metadata
        const metadata: Record<string, any> = {
          score: result.score,
        };

        // Add any additional metadata that might be available
        if ((result as any).retrievalResultId) {
          metadata.retrievalResultId = (result as any).retrievalResultId;
        }

        // Add location information if available
        if (result.location) {
          metadata.location = {
            type: result.location.type,
            s3Location: result.location.s3Location,
            webLocation: result.location.webLocation,
            confluenceLocation: result.location.confluenceLocation,
            salesforceLocation: result.location.salesforceLocation,
            sharePointLocation: result.location.sharePointLocation,
          };
        }

        results.push({
          content: content.trim(),
          source,
          confidence,
          metadata,
          knowledgeBaseId,
        });

      } catch (error) {
        logger.warn('Failed to process knowledge base result', {
          knowledgeBaseId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue processing other results
      }
    }

    logger.debug('Formatted knowledge base results', {
      knowledgeBaseId,
      totalResults: response.retrievalResults.length,
      formattedResults: results.length,
    });

    return results;
  }

  /**
   * Extract source information from retrieval result
   */
  private extractSourceInfo(result: any): string {
    if (!result.location) {
      return 'Unknown source';
    }

    const location = result.location;

    // S3 location
    if (location.s3Location) {
      const s3 = location.s3Location;
      return `s3://${s3.uri || 'unknown'}`;
    }

    // Web location
    if (location.webLocation) {
      return location.webLocation.url || 'Web source';
    }

    // Confluence location
    if (location.confluenceLocation) {
      return location.confluenceLocation.url || 'Confluence';
    }

    // Salesforce location
    if (location.salesforceLocation) {
      return location.salesforceLocation.url || 'Salesforce';
    }

    // SharePoint location
    if (location.sharePointLocation) {
      return location.sharePointLocation.url || 'SharePoint';
    }

    return `${location.type || 'Unknown'} source`;
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
 * Create a new Knowledge Base Client instance
 * @param config Optional client configuration
 * @returns New KnowledgeBaseClient instance
 */
export function createKnowledgeBaseClient(config?: KnowledgeBaseClientConfig): KnowledgeBaseClient {
  return new KnowledgeBaseClient(config);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default KnowledgeBaseClient;