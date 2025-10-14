/**
 * @fileoverview Knowledge Base Service for Voice Conversation Integration
 * 
 * This module provides high-level knowledge base operations optimized for voice
 * conversations, including result formatting, graceful degradation, and retry logic.
 * 
 * Key Features:
 * - Voice-optimized response formatting
 * - Graceful degradation for knowledge base failures
 * - Retry logic with exponential backoff
 * - Multiple knowledge base support with fallback
 * - Conversation context awareness
 * 
 * @author Twilio Bedrock Bridge Team
 * @version 1.0.0
 */

import { KnowledgeBaseClient, KnowledgeBaseError } from './KnowledgeBaseClient';
import { KnowledgeResult, KnowledgeBaseConfig } from '../types/IntegrationTypes';
import { BedrockClientError } from '../errors/ClientErrors';
import { config } from '../config/AppConfig';
import logger from '../utils/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { setTimeoutWithCorrelation } from '../utils/asyncCorrelation';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Voice-formatted knowledge response
 */
export interface VoiceKnowledgeResponse {
  /** Formatted response text optimized for voice output */
  responseText: string;
  /** Whether knowledge was successfully retrieved */
  hasKnowledge: boolean;
  /** Confidence score for the overall response (0.0 - 1.0) */
  confidence: number;
  /** Source information for transparency */
  sources: string[];
  /** Raw knowledge results for debugging */
  rawResults: KnowledgeResult[];
  /** Metadata about the query execution */
  metadata: {
    queryTimeMs: number;
    knowledgeBasesQueried: string[];
    fallbackUsed: boolean;
    retryCount: number;
  };
}

/**
 * Query options for knowledge base service
 */
export interface KnowledgeQueryOptions {
  /** Maximum response length for voice output */
  maxResponseLength?: number;
  /** Minimum confidence threshold for results */
  minConfidence?: number;
  /** Specific knowledge bases to query (if not provided, uses all enabled) */
  knowledgeBaseIds?: string[];
  /** Whether to enable retry logic */
  enableRetry?: boolean;
  /** Maximum number of retries */
  maxRetries?: number;
  /** Session ID for correlation */
  sessionId?: string;
}

/**
 * Error thrown when knowledge base service operations fail
 */
export class KnowledgeServiceError extends BedrockClientError {
  readonly code = 'KNOWLEDGE_SERVICE_ERROR';
  
  constructor(
    message: string,
    sessionId?: string,
    cause?: Error
  ) {
    super(message, sessionId, cause);
  }
}

// ============================================================================
// MAIN SERVICE CLASS
// ============================================================================

/**
 * Knowledge Base Service implementation
 * 
 * Provides high-level knowledge base operations with voice conversation
 * optimizations, retry logic, and graceful degradation.
 */
export class KnowledgeBaseService {
  // ============================================================================
  // PRIVATE PROPERTIES
  // ============================================================================

  private readonly knowledgeBaseClient: KnowledgeBaseClient;
  private readonly enabledKnowledgeBases: KnowledgeBaseConfig[];
  private readonly defaultMaxResponseLength = 500; // Reasonable for voice
  private readonly defaultMinConfidence = 0.3; // Lower threshold for voice assistance

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  constructor(knowledgeBaseClient?: KnowledgeBaseClient) {
    this.knowledgeBaseClient = knowledgeBaseClient || new KnowledgeBaseClient();
    this.enabledKnowledgeBases = config.integration.knowledgeBases.filter(kb => kb.enabled);

    logger.info('Knowledge Base Service initialized', {
      enabledKnowledgeBasesCount: this.enabledKnowledgeBases.length,
      knowledgeBases: this.enabledKnowledgeBases.map(kb => ({
        id: kb.id,
        name: kb.name,
        domain: kb.domain,
        priority: kb.priority,
      })),
    });
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  /**
   * Query knowledge bases and format response for voice conversation
   */
  public async queryForVoice(
    query: string,
    options: KnowledgeQueryOptions = {}
  ): Promise<VoiceKnowledgeResponse> {
    return CorrelationIdManager.traceWithCorrelation('knowledge_service.query_for_voice', async () => {
      const startTime = Date.now();
      const sessionId = options.sessionId;
      
      // Set defaults
      const maxResponseLength = options.maxResponseLength || this.defaultMaxResponseLength;
      const minConfidence = options.minConfidence || this.defaultMinConfidence;
      const enableRetry = options.enableRetry !== false; // Default to true
      const maxRetries = options.maxRetries || config.integration.thresholds.maxRetries;

      logger.debug('Starting voice knowledge query', {
        queryLength: query.length,
        maxResponseLength,
        minConfidence,
        enableRetry,
        maxRetries,
        sessionId,
      });

      try {
        // Determine which knowledge bases to query
        const knowledgeBasesToQuery = this.selectKnowledgeBases(options.knowledgeBaseIds);
        
        if (knowledgeBasesToQuery.length === 0) {
          logger.warn('No enabled knowledge bases available for query', { sessionId });
          return this.createEmptyResponse(startTime, 'No knowledge bases available');
        }

        // Query knowledge bases with retry logic
        const allResults = await this.queryWithRetry(
          query,
          knowledgeBasesToQuery,
          enableRetry ? maxRetries : 0,
          sessionId
        );

        // Filter results by confidence
        const filteredResults = allResults.filter(result => result.confidence >= minConfidence);

        if (filteredResults.length === 0) {
          logger.info('No results met confidence threshold', {
            totalResults: allResults.length,
            minConfidence,
            sessionId,
          });
          return this.createEmptyResponse(startTime, 'No confident results found');
        }

        // Format response for voice
        const voiceResponse = this.formatForVoice(
          filteredResults,
          maxResponseLength,
          knowledgeBasesToQuery,
          startTime,
          0 // No retries in successful case
        );

        logger.info('Voice knowledge query completed successfully', {
          queryTimeMs: voiceResponse.metadata.queryTimeMs,
          resultsCount: filteredResults.length,
          confidence: voiceResponse.confidence,
          responseLength: voiceResponse.responseText.length,
          sessionId,
        });

        return voiceResponse;

      } catch (error) {
        const queryTime = Date.now() - startTime;
        
        logger.error('Voice knowledge query failed', {
          queryTimeMs: queryTime,
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        });

        // Return graceful degradation response
        return this.createErrorResponse(error, startTime, sessionId);
      }
    }, {
      'session.id': options.sessionId || 'unknown',
      'query.length': query.length.toString(),
    });
  }

  /**
   * Check if knowledge base service is available and configured
   */
  public isAvailable(): boolean {
    return this.enabledKnowledgeBases.length > 0;
  }

  /**
   * Get list of available knowledge bases
   */
  public getAvailableKnowledgeBases(): KnowledgeBaseConfig[] {
    return [...this.enabledKnowledgeBases];
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Select knowledge bases to query based on options
   */
  private selectKnowledgeBases(knowledgeBaseIds?: string[]): KnowledgeBaseConfig[] {
    if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
      // Filter to specific knowledge bases
      return this.enabledKnowledgeBases.filter(kb => 
        knowledgeBaseIds.includes(kb.id) || knowledgeBaseIds.includes(kb.knowledgeBaseId)
      );
    }

    // Return all enabled knowledge bases, sorted by priority
    return [...this.enabledKnowledgeBases].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Query knowledge bases with retry logic
   */
  private async queryWithRetry(
    query: string,
    knowledgeBases: KnowledgeBaseConfig[],
    maxRetries: number,
    sessionId?: string
  ): Promise<KnowledgeResult[]> {
    let lastError: Error | undefined;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        const results = await this.queryAllKnowledgeBases(query, knowledgeBases, sessionId);
        
        if (results.length > 0) {
          return results;
        }

        // If no results but no error, don't retry
        if (retryCount === 0) {
          logger.debug('No results found on first attempt, not retrying', { sessionId });
          return [];
        }

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (retryCount < maxRetries) {
          const delayMs = this.calculateRetryDelay(retryCount);
          
          logger.warn('Knowledge base query failed, retrying', {
            retryCount: retryCount + 1,
            maxRetries,
            delayMs,
            error: lastError.message,
            sessionId,
          });

          await this.delay(delayMs);
          retryCount++;
        } else {
          logger.error('Knowledge base query failed after all retries', {
            retryCount,
            maxRetries,
            error: lastError.message,
            sessionId,
          });
          throw lastError;
        }
      }
    }

    // This should not be reached, but just in case
    throw lastError || new KnowledgeServiceError('Query failed after retries', sessionId);
  }

  /**
   * Query all specified knowledge bases
   */
  private async queryAllKnowledgeBases(
    query: string,
    knowledgeBases: KnowledgeBaseConfig[],
    sessionId?: string
  ): Promise<KnowledgeResult[]> {
    const allResults: KnowledgeResult[] = [];
    const errors: Error[] = [];

    // Query knowledge bases in parallel for better performance
    const queryPromises = knowledgeBases.map(async (kb) => {
      try {
        const results = await this.knowledgeBaseClient.query(query, kb.knowledgeBaseId, sessionId);
        return results;
      } catch (error) {
        const kbError = new KnowledgeBaseError(
          `Failed to query knowledge base ${kb.id}: ${error instanceof Error ? error.message : String(error)}`,
          kb.knowledgeBaseId,
          sessionId,
          error instanceof Error ? error : undefined
        );
        errors.push(kbError);
        return [];
      }
    });

    const resultsArrays = await Promise.all(queryPromises);
    
    // Flatten results
    for (const results of resultsArrays) {
      allResults.push(...results);
    }

    // Log any errors but don't fail if we got some results
    if (errors.length > 0) {
      logger.warn('Some knowledge bases failed to respond', {
        errorsCount: errors.length,
        totalKnowledgeBases: knowledgeBases.length,
        successfulResults: allResults.length,
        sessionId,
      });
    }

    // Sort results by confidence (highest first)
    allResults.sort((a, b) => b.confidence - a.confidence);

    return allResults;
  }

  /**
   * Format knowledge results for voice conversation
   */
  private formatForVoice(
    results: KnowledgeResult[],
    maxLength: number,
    knowledgeBasesQueried: KnowledgeBaseConfig[],
    startTime: number,
    retryCount: number
  ): VoiceKnowledgeResponse {
    if (results.length === 0) {
      return this.createEmptyResponse(startTime, 'No results to format');
    }

    // Take the best results and combine them
    const topResults = results.slice(0, 3); // Limit to top 3 for voice
    let responseText = '';
    const sources: string[] = [];
    let totalConfidence = 0;

    for (const result of topResults) {
      // Add content if we have space
      const contentToAdd = this.cleanContentForVoice(result.content);
      
      if (responseText.length + contentToAdd.length + 2 <= maxLength) { // +2 for spacing
        if (responseText.length > 0) {
          responseText += ' ';
        }
        responseText += contentToAdd;
      }

      // Collect unique sources
      if (!sources.includes(result.source)) {
        sources.push(result.source);
      }

      totalConfidence += result.confidence;
    }

    // Calculate average confidence
    const averageConfidence = totalConfidence / topResults.length;

    // Ensure response is not empty
    if (!responseText.trim()) {
      responseText = 'I found some information, but it may not be directly relevant to your question.';
    }

    return {
      responseText: responseText.trim(),
      hasKnowledge: true,
      confidence: averageConfidence,
      sources: sources.slice(0, 3), // Limit sources for voice
      rawResults: topResults,
      metadata: {
        queryTimeMs: Date.now() - startTime,
        knowledgeBasesQueried: knowledgeBasesQueried.map(kb => kb.id),
        fallbackUsed: false,
        retryCount,
      },
    };
  }

  /**
   * Clean and optimize content for voice output
   */
  private cleanContentForVoice(content: string): string {
    return content
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s.,!?-]/g, '') // Remove special characters that don't work well in voice
      .replace(/\b(https?:\/\/[^\s]+)/g, '') // Remove URLs
      .replace(/\b\w+@\w+\.\w+/g, '') // Remove email addresses
      .trim();
  }

  /**
   * Create empty response for cases with no results
   */
  private createEmptyResponse(startTime: number, reason: string): VoiceKnowledgeResponse {
    return {
      responseText: 'I don\'t have specific information about that in my knowledge base.',
      hasKnowledge: false,
      confidence: 0.0,
      sources: [],
      rawResults: [],
      metadata: {
        queryTimeMs: Date.now() - startTime,
        knowledgeBasesQueried: [],
        fallbackUsed: true,
        retryCount: 0,
      },
    };
  }

  /**
   * Create error response for graceful degradation
   */
  private createErrorResponse(
    error: any,
    startTime: number,
    sessionId?: string
  ): VoiceKnowledgeResponse {
    logger.error('Creating error response for knowledge query', {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
    });

    return {
      responseText: 'I\'m having trouble accessing my knowledge base right now, but I can still help with general questions.',
      hasKnowledge: false,
      confidence: 0.0,
      sources: [],
      rawResults: [],
      metadata: {
        queryTimeMs: Date.now() - startTime,
        knowledgeBasesQueried: [],
        fallbackUsed: true,
        retryCount: 0,
      },
    };
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retryCount: number): number {
    // Exponential backoff: 100ms, 200ms, 400ms, etc.
    const baseDelay = 100;
    const maxDelay = 2000; // Cap at 2 seconds for voice applications
    
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    
    // Add some jitter to avoid thundering herd
    const jitter = Math.random() * 0.1 * delay;
    
    return Math.floor(delay + jitter);
  }

  /**
   * Delay execution for retry logic
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      setTimeoutWithCorrelation(resolve, ms);
    });
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new Knowledge Base Service instance
 * @param knowledgeBaseClient Optional client instance
 * @returns New KnowledgeBaseService instance
 */
export function createKnowledgeBaseService(knowledgeBaseClient?: KnowledgeBaseClient): KnowledgeBaseService {
  return new KnowledgeBaseService(knowledgeBaseClient);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default KnowledgeBaseService;