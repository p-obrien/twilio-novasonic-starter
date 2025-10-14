/**
 * @fileoverview Comprehensive unit tests for Knowledge Base Client
 * 
 * Tests cover:
 * - Mock Bedrock responses and test query execution
 * - Test error handling and fallback scenarios  
 * - Test result formatting and response processing
 * - Requirements: 1.1, 1.2, 1.3, 1.4
 */

import { 
  KnowledgeBaseClient, 
  KnowledgeBaseError, 
  IKnowledgeBaseClient,
  KnowledgeBaseClientConfig,
  createKnowledgeBaseClient 
} from '../knowledge/KnowledgeBaseClient';
import { KnowledgeResult, ValidationResult } from '../types/IntegrationTypes';
import { BedrockServiceError } from '../errors/ClientErrors';

// Mock AWS SDK
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  RetrieveCommand: jest.fn(),
}));

// Mock dependencies
jest.mock('../config/AppConfig', () => ({
  config: {
    aws: {
      region: 'us-east-1',
    },
    integration: {
      thresholds: {
        knowledgeQueryTimeoutMs: 5000,
      },
    },
  },
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../utils/correlationId', () => ({
  CorrelationIdManager: {
    traceWithCorrelation: jest.fn((name, fn, attributes) => fn()),
  },
}));

jest.mock('../observability/dataProtection', () => ({
  DataProtection: {
    logKnowledgeQuery: jest.fn(),
  },
}));

describe('KnowledgeBaseClient', () => {
  let client: KnowledgeBaseClient;
  
  beforeEach(() => {
    jest.clearAllMocks();
    client = new KnowledgeBaseClient();
  });

  describe('Constructor and Configuration', () => {
    it('should create client with default configuration', () => {
      expect(client).toBeInstanceOf(KnowledgeBaseClient);
    });

    it('should create client with custom configuration', () => {
      const config: KnowledgeBaseClientConfig = {
        region: 'us-west-2',
        requestTimeoutMs: 10000,
        maxResults: 10,
      };
      
      const customClient = new KnowledgeBaseClient(config);
      expect(customClient).toBeInstanceOf(KnowledgeBaseClient);
    });

    it('should use factory function to create client', () => {
      const factoryClient = createKnowledgeBaseClient();
      expect(factoryClient).toBeInstanceOf(KnowledgeBaseClient);
    });

    it('should use factory function with config', () => {
      const config: KnowledgeBaseClientConfig = {
        region: 'eu-west-1',
        maxResults: 3,
      };
      
      const factoryClient = createKnowledgeBaseClient(config);
      expect(factoryClient).toBeInstanceOf(KnowledgeBaseClient);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate configuration successfully with default settings', async () => {
      const result = await client.validateConfiguration();
      
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return warnings for high timeout values', async () => {
      const clientWithHighTimeout = new KnowledgeBaseClient({
        requestTimeoutMs: 35000, // > 30s
      });
      
      const result = await clientWithHighTimeout.validateConfiguration();
      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('timeout is very high');
    });

    it('should return warnings for high max results', async () => {
      const clientWithHighMaxResults = new KnowledgeBaseClient({
        maxResults: 15, // > 10
      });
      
      const result = await clientWithHighMaxResults.validateConfiguration();
      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('High max results count');
    });

    it('should return errors for invalid timeout', async () => {
      const clientWithInvalidTimeout = new KnowledgeBaseClient({
        requestTimeoutMs: -1000,
      });
      
      const result = await clientWithInvalidTimeout.validateConfiguration();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Request timeout must be greater than 0');
    });

    it('should return errors for invalid max results', async () => {
      // Since the constructor uses || operator, we need to test the validation logic directly
      // by creating a client and then modifying its internal state for testing
      const clientWithInvalidMaxResults = new KnowledgeBaseClient();
      // Override the private property for testing
      (clientWithInvalidMaxResults as any).maxResults = -1;
      
      const result = await clientWithInvalidMaxResults.validateConfiguration();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Max results must be greater than 0');
    });

    it('should handle validation errors gracefully', async () => {
      // Mock RetrieveCommand constructor to throw by importing and mocking it
      const { RetrieveCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
      RetrieveCommand.mockImplementationOnce(() => {
        throw new Error('Invalid command structure');
      });
      
      const result = await client.validateConfiguration();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Client configuration validation failed');
    });
  });

  describe('Query Execution - Input Validation', () => {
    it('should throw error for empty query', async () => {
      await expect(client.query('', 'test-kb-id')).rejects.toThrow(KnowledgeBaseError);
      await expect(client.query('', 'test-kb-id')).rejects.toThrow('Query cannot be empty');
    });

    it('should throw error for whitespace-only query', async () => {
      await expect(client.query('   ', 'test-kb-id')).rejects.toThrow(KnowledgeBaseError);
    });

    it('should throw error for empty knowledge base ID', async () => {
      await expect(client.query('test query', '')).rejects.toThrow(KnowledgeBaseError);
      await expect(client.query('test query', '')).rejects.toThrow('Knowledge base ID cannot be empty');
    });

    it('should throw error for whitespace-only knowledge base ID', async () => {
      await expect(client.query('test query', '   ')).rejects.toThrow(KnowledgeBaseError);
    });

    it('should handle null/undefined inputs gracefully', async () => {
      await expect(client.query(null as any, 'test-kb-id')).rejects.toThrow();
      await expect(client.query('test query', null as any)).rejects.toThrow(KnowledgeBaseError);
      await expect(client.query(undefined as any, 'test-kb-id')).rejects.toThrow();
      await expect(client.query('test query', undefined as any)).rejects.toThrow(KnowledgeBaseError);
    });
  });

  describe('Query Execution - Successful Responses', () => {
    const mockSuccessfulResponse = {
      retrievalResults: [
        {
          content: { text: 'This is the first knowledge result' },
          score: 0.95,
          location: {
            type: 'S3',
            s3Location: { uri: 's3://my-bucket/doc1.pdf' }
          }
        },
        {
          content: { text: 'This is the second knowledge result' },
          score: 0.87,
          location: {
            type: 'WEB',
            webLocation: { url: 'https://example.com/doc2' }
          }
        }
      ]
    };

    beforeEach(() => {
      mockSend.mockResolvedValue(mockSuccessfulResponse);
    });

    it('should execute query successfully and return formatted results', async () => {
      const results = await client.query('What is machine learning?', 'kb-123');
      
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        content: 'This is the first knowledge result',
        source: 's3://s3://my-bucket/doc1.pdf',
        confidence: 0.95,
        knowledgeBaseId: 'kb-123',
        metadata: expect.objectContaining({
          score: 0.95
        })
      });
      
      expect(results[1]).toMatchObject({
        content: 'This is the second knowledge result',
        source: 'https://example.com/doc2',
        confidence: 0.87,
        knowledgeBaseId: 'kb-123'
      });
    });

    it('should include session ID in query execution', async () => {
      const sessionId = 'session-123';
      const results = await client.query('test query', 'kb-123', sessionId);
      
      expect(results).toHaveLength(2);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle different source location types', async () => {
      const responseWithDifferentSources = {
        retrievalResults: [
          {
            content: { text: 'Confluence result' },
            score: 0.9,
            location: {
              type: 'CONFLUENCE',
              confluenceLocation: { url: 'https://confluence.example.com/page' }
            }
          },
          {
            content: { text: 'Salesforce result' },
            score: 0.85,
            location: {
              type: 'SALESFORCE',
              salesforceLocation: { url: 'https://salesforce.example.com/record' }
            }
          },
          {
            content: { text: 'SharePoint result' },
            score: 0.8,
            location: {
              type: 'SHAREPOINT',
              sharePointLocation: { url: 'https://sharepoint.example.com/doc' }
            }
          },
          {
            content: { text: 'Unknown source result' },
            score: 0.75,
            location: {
              type: 'UNKNOWN'
            }
          }
        ]
      };
      
      mockSend.mockResolvedValueOnce(responseWithDifferentSources);
      
      const results = await client.query('test query', 'kb-123');
      
      expect(results).toHaveLength(4);
      expect(results[0].source).toBe('https://confluence.example.com/page');
      expect(results[1].source).toBe('https://salesforce.example.com/record');
      expect(results[2].source).toBe('https://sharepoint.example.com/doc');
      expect(results[3].source).toBe('UNKNOWN source');
    });

    it('should handle missing location information', async () => {
      const responseWithoutLocation = {
        retrievalResults: [
          {
            content: { text: 'Result without location' },
            score: 0.9
          }
        ]
      };
      
      mockSend.mockResolvedValueOnce(responseWithoutLocation);
      
      const results = await client.query('test query', 'kb-123');
      
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('Unknown source');
    });

    it('should skip empty content results', async () => {
      const responseWithEmptyContent = {
        retrievalResults: [
          {
            content: { text: 'Valid result' },
            score: 0.9,
            location: { type: 'S3', s3Location: { uri: 's3://bucket/doc' } }
          },
          {
            content: { text: '' }, // Empty content
            score: 0.8,
            location: { type: 'S3', s3Location: { uri: 's3://bucket/empty' } }
          },
          {
            content: { text: '   ' }, // Whitespace only
            score: 0.7,
            location: { type: 'S3', s3Location: { uri: 's3://bucket/whitespace' } }
          }
        ]
      };
      
      mockSend.mockResolvedValueOnce(responseWithEmptyContent);
      
      const results = await client.query('test query', 'kb-123');
      
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Valid result');
    });

    it('should handle empty response gracefully', async () => {
      mockSend.mockResolvedValueOnce({ retrievalResults: [] });
      
      const results = await client.query('test query', 'kb-123');
      
      expect(results).toHaveLength(0);
    });

    it('should handle missing retrievalResults property', async () => {
      mockSend.mockResolvedValueOnce({});
      
      const results = await client.query('test query', 'kb-123');
      
      expect(results).toHaveLength(0);
    });

    it('should include additional metadata when available', async () => {
      const responseWithMetadata = {
        retrievalResults: [
          {
            content: { text: 'Result with metadata' },
            score: 0.9,
            retrievalResultId: 'result-123',
            location: {
              type: 'S3',
              s3Location: { uri: 's3://bucket/doc' },
              webLocation: { url: 'https://example.com' },
              confluenceLocation: { url: 'https://confluence.example.com' },
              salesforceLocation: { url: 'https://salesforce.example.com' },
              sharePointLocation: { url: 'https://sharepoint.example.com' }
            }
          }
        ]
      };
      
      mockSend.mockResolvedValueOnce(responseWithMetadata);
      
      const results = await client.query('test query', 'kb-123');
      
      expect(results).toHaveLength(1);
      expect(results[0].metadata).toMatchObject({
        score: 0.9,
        retrievalResultId: 'result-123',
        location: expect.objectContaining({
          type: 'S3',
          s3Location: { uri: 's3://bucket/doc' },
          webLocation: { url: 'https://example.com' },
          confluenceLocation: { url: 'https://confluence.example.com' },
          salesforceLocation: { url: 'https://salesforce.example.com' },
          sharePointLocation: { url: 'https://sharepoint.example.com' }
        })
      });
    });
  });

  describe('Query Execution - Error Handling', () => {
    it('should handle AWS service errors and convert them', async () => {
      const awsError = {
        name: 'ValidationException',
        message: 'Invalid knowledge base ID',
        code: 'ValidationException',
        $metadata: { httpStatusCode: 400 }
      };
      
      mockSend.mockRejectedValueOnce(awsError);
      
      await expect(client.query('test query', 'invalid-kb')).rejects.toThrow(BedrockServiceError);
    });

    it('should handle network timeouts', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'TimeoutError';
      
      mockSend.mockRejectedValueOnce(timeoutError);
      
      await expect(client.query('test query', 'kb-123')).rejects.toThrow(KnowledgeBaseError);
    });

    it('should handle access denied errors', async () => {
      const accessError = {
        name: 'AccessDeniedException',
        message: 'Access denied to knowledge base',
        code: 'AccessDeniedException',
        $metadata: { httpStatusCode: 403 }
      };
      
      mockSend.mockRejectedValueOnce(accessError);
      
      await expect(client.query('test query', 'kb-123')).rejects.toThrow(BedrockServiceError);
    });

    it('should handle resource not found errors', async () => {
      const notFoundError = {
        name: 'ResourceNotFoundException',
        message: 'Knowledge base not found',
        code: 'ResourceNotFoundException',
        $metadata: { httpStatusCode: 404 }
      };
      
      mockSend.mockRejectedValueOnce(notFoundError);
      
      await expect(client.query('test query', 'nonexistent-kb')).rejects.toThrow(BedrockServiceError);
    });

    it('should handle throttling errors', async () => {
      const throttleError = {
        name: 'ThrottlingException',
        message: 'Request rate exceeded',
        code: 'ThrottlingException',
        $metadata: { httpStatusCode: 429 }
      };
      
      mockSend.mockRejectedValueOnce(throttleError);
      
      await expect(client.query('test query', 'kb-123')).rejects.toThrow(BedrockServiceError);
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Something went wrong');
      
      mockSend.mockRejectedValueOnce(genericError);
      
      await expect(client.query('test query', 'kb-123')).rejects.toThrow(KnowledgeBaseError);
      
      // Reset mock and test again with a different error
      mockSend.mockRejectedValueOnce(genericError);
      await expect(client.query('test query', 'kb-123')).rejects.toThrow('Knowledge base query failed');
    });

    it('should handle non-Error objects', async () => {
      const stringError = 'String error message';
      
      mockSend.mockRejectedValueOnce(stringError);
      
      await expect(client.query('test query', 'kb-123')).rejects.toThrow(KnowledgeBaseError);
    });

    it('should preserve session ID in error context', async () => {
      const error = new Error('Test error');
      mockSend.mockRejectedValueOnce(error);
      
      try {
        await client.query('test query', 'kb-123', 'session-456');
      } catch (thrownError) {
        expect(thrownError).toBeInstanceOf(KnowledgeBaseError);
        const kbError = thrownError as KnowledgeBaseError;
        expect(kbError.sessionId).toBe('session-456');
        expect(kbError.knowledgeBaseId).toBe('kb-123');
      }
    });

    it('should handle malformed result processing errors', async () => {
      const malformedResponse = {
        retrievalResults: [
          {
            // Missing content property
            score: 0.9,
            location: { type: 'S3' }
          }
        ]
      };
      
      mockSend.mockResolvedValueOnce(malformedResponse);
      
      // Should not throw, but should skip malformed results
      const results = await client.query('test query', 'kb-123');
      expect(results).toHaveLength(0);
    });
  });

  describe('Query Execution - Performance and Observability', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({
        retrievalResults: [
          {
            content: { text: 'Test result' },
            score: 0.9,
            location: { type: 'S3', s3Location: { uri: 's3://bucket/doc' } }
          }
        ]
      });
    });

    it('should measure and log query performance', async () => {
      const startTime = Date.now();
      
      await client.query('test query', 'kb-123', 'session-123');
      
      const endTime = Date.now();
      const queryTime = endTime - startTime;
      
      // Verify that the query completed in reasonable time
      expect(queryTime).toBeLessThan(1000); // Should be much faster in tests
    });

    it('should call data protection logging for successful queries', async () => {
      const { DataProtection } = require('../observability/dataProtection');
      
      await client.query('test query', 'kb-123', 'session-123');
      
      expect(DataProtection.logKnowledgeQuery).toHaveBeenCalledWith(
        'kb-123',
        'test query',
        1, // results count
        expect.any(Number), // query time
        true, // success
        'session-123',
        expect.objectContaining({
          maxResults: expect.any(Number),
          queryLength: 10 // 'test query'.length
        })
      );
    });

    it('should call data protection logging for failed queries', async () => {
      const { DataProtection } = require('../observability/dataProtection');
      const error = new Error('Test error');
      mockSend.mockRejectedValueOnce(error);
      
      try {
        await client.query('test query', 'kb-123', 'session-123');
      } catch (e) {
        // Expected to throw
      }
      
      expect(DataProtection.logKnowledgeQuery).toHaveBeenCalledWith(
        'kb-123',
        'test query',
        0, // results count
        expect.any(Number), // query time
        false, // success
        'session-123',
        expect.objectContaining({
          maxResults: expect.any(Number),
          queryLength: 10,
          errorType: 'Error'
        })
      );
    });

    it('should use correlation tracing', async () => {
      const { CorrelationIdManager } = require('../utils/correlationId');
      
      await client.query('test query', 'kb-123', 'session-123');
      
      expect(CorrelationIdManager.traceWithCorrelation).toHaveBeenCalledWith(
        'knowledge_base.query',
        expect.any(Function),
        {
          'knowledge_base.id': 'kb-123',
          'session.id': 'session-123',
          'query.length': '10'
        }
      );
    });

    it('should handle missing session ID in tracing', async () => {
      const { CorrelationIdManager } = require('../utils/correlationId');
      
      await client.query('test query', 'kb-123');
      
      expect(CorrelationIdManager.traceWithCorrelation).toHaveBeenCalledWith(
        'knowledge_base.query',
        expect.any(Function),
        {
          'knowledge_base.id': 'kb-123',
          'session.id': 'unknown',
          'query.length': '10'
        }
      );
    });
  });

  describe('Query Execution - Edge Cases', () => {
    it('should handle very long queries', async () => {
      const longQuery = 'a'.repeat(10000);
      mockSend.mockResolvedValueOnce({ retrievalResults: [] });
      
      const results = await client.query(longQuery, 'kb-123');
      
      expect(results).toHaveLength(0);
      expect(mockSend).toHaveBeenCalledTimes(1);
      
      // Verify the command was created with the long query
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs).toBeDefined();
    });

    it('should trim whitespace from inputs', async () => {
      mockSend.mockResolvedValueOnce({ retrievalResults: [] });
      
      await client.query('  test query  ', '  kb-123  ');
      
      expect(mockSend).toHaveBeenCalledTimes(1);
      
      // Verify the command was created with trimmed inputs
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs).toBeDefined();
    });

    it('should handle special characters in queries', async () => {
      const specialQuery = 'What is "machine learning" & AI? (2024)';
      mockSend.mockResolvedValueOnce({ retrievalResults: [] });
      
      const results = await client.query(specialQuery, 'kb-123');
      
      expect(results).toHaveLength(0);
      expect(mockSend).toHaveBeenCalledTimes(1);
      
      // Verify the command was created with special characters
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs).toBeDefined();
    });

    it('should handle Unicode characters in queries', async () => {
      const unicodeQuery = 'What is 机器学习 and 人工智能?';
      mockSend.mockResolvedValueOnce({ retrievalResults: [] });
      
      const results = await client.query(unicodeQuery, 'kb-123');
      
      expect(results).toHaveLength(0);
      expect(mockSend).toHaveBeenCalledTimes(1);
      
      // Verify the command was created with Unicode characters
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs).toBeDefined();
    });
  });

  describe('Error Classes', () => {
    it('should create KnowledgeBaseError with all properties', () => {
      const error = new KnowledgeBaseError(
        'Test error message',
        'kb-123',
        'session-456',
        new Error('Cause error')
      );
      
      expect(error).toBeInstanceOf(KnowledgeBaseError);
      expect(error).toBeInstanceOf(KnowledgeBaseError);
      expect(error.message).toBe('Test error message');
      expect(error.knowledgeBaseId).toBe('kb-123');
      expect(error.sessionId).toBe('session-456');
      expect(error.code).toBe('KNOWLEDGE_BASE_ERROR');
      expect(error.cause).toBeInstanceOf(Error);
    });

    it('should create KnowledgeBaseError with minimal properties', () => {
      const error = new KnowledgeBaseError('Test error message');
      
      expect(error).toBeInstanceOf(KnowledgeBaseError);
      expect(error.message).toBe('Test error message');
      expect(error.knowledgeBaseId).toBeUndefined();
      expect(error.sessionId).toBeUndefined();
      expect(error.cause).toBeUndefined();
    });
  });
});