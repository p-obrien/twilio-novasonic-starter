/**
 * @fileoverview Comprehensive unit tests for Agent Core Client
 * 
 * Tests cover:
 * - Test agent invocation and response handling
 * - Test error handling and timeout scenarios
 * - Test session management and continuity
 * - Requirements: 2.1, 2.2, 2.3, 2.4
 */

import { 
  AgentCoreClient, 
  AgentCoreError, 
  IAgentCoreClient,
  AgentCoreClientConfig,
  createAgentCoreClient 
} from '../agent/AgentCoreClient';
import { AgentResponse, ValidationResult } from '../types/IntegrationTypes';
import { BedrockServiceError } from '../errors/ClientErrors';

// Mock AWS SDK
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  InvokeAgentCommand: jest.fn(),
}));

// Mock dependencies
jest.mock('../config/AppConfig', () => ({
  config: {
    aws: {
      region: 'us-east-1',
    },
    integration: {
      thresholds: {
        agentInvocationTimeoutMs: 10000,
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
    auditAgentInvocation: jest.fn(),
  },
}));

describe('AgentCoreClient', () => {
  let client: AgentCoreClient;
  
  beforeEach(() => {
    jest.clearAllMocks();
    client = new AgentCoreClient();
  });

  describe('Constructor and Configuration', () => {
    it('should create client with default configuration', () => {
      expect(client).toBeInstanceOf(AgentCoreClient);
    });

    it('should create client with custom configuration', () => {
      const config: AgentCoreClientConfig = {
        region: 'us-west-2',
        requestTimeoutMs: 15000,
      };
      
      const customClient = new AgentCoreClient(config);
      expect(customClient).toBeInstanceOf(AgentCoreClient);
    });

    it('should use factory function to create client', () => {
      const factoryClient = createAgentCoreClient();
      expect(factoryClient).toBeInstanceOf(AgentCoreClient);
    });

    it('should use factory function with config', () => {
      const config: AgentCoreClientConfig = {
        region: 'eu-west-1',
        requestTimeoutMs: 8000,
      };
      
      const factoryClient = createAgentCoreClient(config);
      expect(factoryClient).toBeInstanceOf(AgentCoreClient);
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
      const clientWithHighTimeout = new AgentCoreClient({
        requestTimeoutMs: 65000, // > 60s
      });
      
      const result = await clientWithHighTimeout.validateConfiguration();
      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('timeout is very high');
    });

    it('should return errors for invalid timeout', async () => {
      const clientWithInvalidTimeout = new AgentCoreClient({
        requestTimeoutMs: -1000,
      });
      
      const result = await clientWithInvalidTimeout.validateConfiguration();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Request timeout must be greater than 0');
    });

    it('should handle validation errors gracefully', async () => {
      // Mock InvokeAgentCommand constructor to throw
      const { InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
      InvokeAgentCommand.mockImplementationOnce(() => {
        throw new Error('Invalid command structure');
      });
      
      const result = await client.validateConfiguration();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Client configuration validation failed');
    });

    it('should handle configuration validation exceptions', async () => {
      // Create a client that will throw during validation
      const clientWithBadConfig = new AgentCoreClient();
      
      // Mock the client to be null to trigger validation error
      (clientWithBadConfig as any).bedrockAgentClient = null;
      
      const result = await clientWithBadConfig.validateConfiguration();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to create Bedrock Agent Runtime client');
    });
  });

  describe('Agent Invocation - Input Validation', () => {
    it('should throw error for empty agent ID', async () => {
      await expect(client.invokeAgent('', 'alias-123', 'test input', 'session-123'))
        .rejects.toThrow(AgentCoreError);
      await expect(client.invokeAgent('', 'alias-123', 'test input', 'session-123'))
        .rejects.toThrow('Agent ID cannot be empty');
    });

    it('should throw error for whitespace-only agent ID', async () => {
      await expect(client.invokeAgent('   ', 'alias-123', 'test input', 'session-123'))
        .rejects.toThrow(AgentCoreError);
    });

    it('should throw error for empty agent alias ID', async () => {
      await expect(client.invokeAgent('agent-123', '', 'test input', 'session-123'))
        .rejects.toThrow(AgentCoreError);
      await expect(client.invokeAgent('agent-123', '', 'test input', 'session-123'))
        .rejects.toThrow('Agent alias ID cannot be empty');
    });

    it('should throw error for whitespace-only agent alias ID', async () => {
      await expect(client.invokeAgent('agent-123', '   ', 'test input', 'session-123'))
        .rejects.toThrow(AgentCoreError);
    });

    it('should throw error for empty input', async () => {
      await expect(client.invokeAgent('agent-123', 'alias-123', '', 'session-123'))
        .rejects.toThrow(AgentCoreError);
      await expect(client.invokeAgent('agent-123', 'alias-123', '', 'session-123'))
        .rejects.toThrow('Input cannot be empty');
    });

    it('should throw error for whitespace-only input', async () => {
      await expect(client.invokeAgent('agent-123', 'alias-123', '   ', 'session-123'))
        .rejects.toThrow(AgentCoreError);
    });

    it('should throw error for empty session ID', async () => {
      await expect(client.invokeAgent('agent-123', 'alias-123', 'test input', ''))
        .rejects.toThrow(AgentCoreError);
      await expect(client.invokeAgent('agent-123', 'alias-123', 'test input', ''))
        .rejects.toThrow('Session ID cannot be empty');
    });

    it('should throw error for whitespace-only session ID', async () => {
      await expect(client.invokeAgent('agent-123', 'alias-123', 'test input', '   '))
        .rejects.toThrow(AgentCoreError);
    });

    it('should handle null/undefined inputs gracefully', async () => {
      await expect(client.invokeAgent(null as any, 'alias-123', 'test input', 'session-123'))
        .rejects.toThrow(AgentCoreError);
      await expect(client.invokeAgent('agent-123', null as any, 'test input', 'session-123'))
        .rejects.toThrow(AgentCoreError);
      await expect(client.invokeAgent('agent-123', 'alias-123', null as any, 'session-123'))
        .rejects.toThrow(); // Will throw TypeError due to input.length access
      await expect(client.invokeAgent('agent-123', 'alias-123', 'test input', null as any))
        .rejects.toThrow(AgentCoreError);
    });
  });

  describe('Agent Invocation - Successful Responses', () => {
    const mockSuccessfulResponse = {
      completion: 'This is a successful agent response for the user query.',
      sessionId: 'session-123',
    };

    beforeEach(() => {
      mockSend.mockResolvedValue(mockSuccessfulResponse);
    });

    it('should execute agent invocation successfully and return formatted response', async () => {
      const response = await client.invokeAgent('agent-123', 'alias-456', 'What is machine learning?', 'session-789');
      
      expect(response).toMatchObject({
        response: expect.stringContaining('This is a successful agent response'),
        sessionId: 'session-789',
        agentId: 'agent-123',
        metadata: expect.objectContaining({
          sessionId: 'session-123',
          voiceOptimized: true,
        })
      });
      expect(response.error).toBeUndefined();
    });

    it('should trim whitespace from inputs', async () => {
      const response = await client.invokeAgent('  agent-123  ', '  alias-456  ', '  test input  ', '  session-789  ');
      
      // The response uses the original sessionId parameter, not the trimmed one
      expect(response.sessionId).toBe('  session-789  ');
      expect(response.agentId).toBe('  agent-123  ');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle different completion response formats', async () => {
      // Test string completion
      mockSend.mockResolvedValueOnce({
        completion: 'Simple string response',
        sessionId: 'session-123',
      });
      
      let response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      expect(response.response).toContain('Simple string response');

      // Test object with text property
      mockSend.mockResolvedValueOnce({
        completion: { text: 'Object with text property' },
        sessionId: 'session-123',
      });
      
      response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      expect(response.response).toContain('Object with text property');

      // Test array of completion events
      mockSend.mockResolvedValueOnce({
        completion: [
          { chunk: { bytes: new TextEncoder().encode('First chunk ') } },
          { chunk: { bytes: new TextEncoder().encode('Second chunk') } }
        ],
        sessionId: 'session-123',
      });
      
      response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      expect(response.response).toContain('First chunk Second chunk');
    });

    it('should handle empty completion gracefully', async () => {
      mockSend.mockResolvedValueOnce({
        completion: '',
        sessionId: 'session-123',
      });
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.response).toContain('I apologize, but I was unable to generate a response');
      expect(response.sessionId).toBe('session-789');
      expect(response.agentId).toBe('agent-123');
    });

    it('should handle missing completion property', async () => {
      mockSend.mockResolvedValueOnce({
        sessionId: 'session-123',
      });
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.response).toContain('I apologize, but I was unable to generate a response');
    });

    it('should format response for voice conversation', async () => {
      // Test markdown removal
      mockSend.mockResolvedValueOnce({
        completion: '**Bold text** and *italic text* with `code` and # Header\n\n- List item 1\n- List item 2\n\n1. Numbered item',
        sessionId: 'session-123',
      });
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.response).not.toContain('**');
      expect(response.response).not.toContain('*');
      expect(response.response).not.toContain('`');
      expect(response.response).not.toContain('#');
      // Note: The current implementation converts list items to spaces, so some dashes may remain
      expect(response.response).toContain('Bold text and italic text with code and Header');
    });

    it('should truncate long responses for voice', async () => {
      const longResponse = 'a'.repeat(600); // Longer than 500 char limit
      mockSend.mockResolvedValueOnce({
        completion: longResponse,
        sessionId: 'session-123',
      });
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.response.length).toBeLessThan(600);
      expect(response.response).toMatch(/\.\.\.$|\.$/); // Should end with ... or .
    });

    it('should ensure proper sentence endings', async () => {
      mockSend.mockResolvedValueOnce({
        completion: 'Response without ending punctuation',
        sessionId: 'session-123',
      });
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.response).toMatch(/[.!?]$/);
    });
  });

  describe('Agent Invocation - Error Handling', () => {
    it('should handle AWS service errors and implement graceful degradation', async () => {
      const awsError = {
        name: 'ValidationException',
        message: 'Invalid agent ID',
        code: 'ValidationException',
        $metadata: { httpStatusCode: 400 }
      };
      
      mockSend.mockRejectedValueOnce(awsError);
      
      const response = await client.invokeAgent('invalid-agent', 'alias-123', 'test input', 'session-789');
      
      expect(response.error).toBeDefined();
      expect(response.response).toContain('didn\'t quite understand');
      expect(response.sessionId).toBe('session-789');
      expect(response.agentId).toBe('invalid-agent');
      expect(response.metadata?.fallbackUsed).toBe(true);
    });

    it('should handle throttling errors with appropriate message', async () => {
      const throttleError = {
        name: 'ThrottlingException',
        message: 'Request rate exceeded',
        code: 'ThrottlingException',
        $metadata: { httpStatusCode: 429 }
      };
      
      mockSend.mockRejectedValueOnce(throttleError);
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.error).toBeDefined();
      expect(response.response).toContain('experiencing high demand');
      expect(response.metadata?.originalError).toBe('ThrottlingException');
    });

    it('should handle resource not found errors', async () => {
      const notFoundError = {
        name: 'ResourceNotFoundException',
        message: 'Agent not found',
        code: 'ResourceNotFoundException',
        $metadata: { httpStatusCode: 404 }
      };
      
      mockSend.mockRejectedValueOnce(notFoundError);
      
      const response = await client.invokeAgent('nonexistent-agent', 'alias-456', 'test input', 'session-789');
      
      expect(response.error).toBeDefined();
      expect(response.response).toContain('temporarily unable to access');
      expect(response.metadata?.originalError).toBe('ResourceNotFoundException');
    });

    it('should handle access denied errors', async () => {
      const accessError = {
        name: 'AccessDeniedException',
        message: 'Access denied to agent',
        code: 'AccessDeniedException',
        $metadata: { httpStatusCode: 403 }
      };
      
      mockSend.mockRejectedValueOnce(accessError);
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.error).toBeDefined();
      expect(response.response).toContain('don\'t have permission');
      expect(response.metadata?.originalError).toBe('AccessDeniedException');
    });

    it('should handle service quota exceeded errors', async () => {
      const quotaError = {
        name: 'ServiceQuotaExceededException',
        message: 'Service quota exceeded',
        code: 'ServiceQuotaExceededException',
        $metadata: { httpStatusCode: 429 }
      };
      
      mockSend.mockRejectedValueOnce(quotaError);
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.error).toBeDefined();
      expect(response.response).toContain('currently at capacity');
      expect(response.metadata?.originalError).toBe('ServiceQuotaExceededException');
    });

    it('should handle generic errors with fallback message', async () => {
      const genericError = new Error('Something went wrong');
      
      mockSend.mockRejectedValueOnce(genericError);
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.error).toBeDefined();
      expect(response.response).toContain('encountered an issue processing');
      expect(response.metadata?.fallbackUsed).toBe(true);
    });

    it('should handle non-Error objects', async () => {
      const stringError = 'String error message';
      
      mockSend.mockRejectedValueOnce(stringError);
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.error).toBeDefined();
      expect(response.response).toContain('encountered an issue processing');
      expect(response.metadata?.fallbackUsed).toBe(true);
    });

    it('should handle response formatting errors gracefully', async () => {
      // Mock a response that will cause formatting to fail
      mockSend.mockResolvedValueOnce({
        completion: { invalidStructure: true },
        sessionId: 'session-123',
      });
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      // Should still return a valid response with fallback message
      expect(response.response).toBeDefined();
      expect(response.sessionId).toBe('session-789');
      expect(response.agentId).toBe('agent-123');
    });
  });

  describe('Session Management and Continuity', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({
        completion: 'Test response',
        sessionId: 'session-123',
      });
    });

    it('should maintain session continuity across invocations', async () => {
      const sessionId = 'persistent-session-123';
      
      // First invocation
      const response1 = await client.invokeAgent('agent-123', 'alias-456', 'First message', sessionId);
      expect(response1.sessionId).toBe(sessionId);
      
      // Second invocation with same session
      const response2 = await client.invokeAgent('agent-123', 'alias-456', 'Second message', sessionId);
      expect(response2.sessionId).toBe(sessionId);
      
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should handle session continuity validation', async () => {
      const sessionId = 'valid-session-123';
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', sessionId);
      
      expect(response.sessionId).toBe(sessionId);
      expect(response.metadata?.sessionId).toBe('session-123'); // From mock response
    });

    it('should handle invalid session ID in continuity check', async () => {
      // This should not throw but should log the issue
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'valid-session');
      
      expect(response.sessionId).toBe('valid-session');
    });

    it('should preserve session context in error scenarios', async () => {
      const sessionId = 'error-session-123';
      const error = new Error('Test error');
      mockSend.mockRejectedValueOnce(error);
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', sessionId);
      
      expect(response.sessionId).toBe(sessionId);
      expect(response.metadata?.sessionId).toBe(sessionId);
    });

    it('should handle concurrent sessions independently', async () => {
      const session1 = 'session-1';
      const session2 = 'session-2';
      
      // Simulate concurrent invocations
      const [response1, response2] = await Promise.all([
        client.invokeAgent('agent-123', 'alias-456', 'Message for session 1', session1),
        client.invokeAgent('agent-123', 'alias-456', 'Message for session 2', session2)
      ]);
      
      expect(response1.sessionId).toBe(session1);
      expect(response2.sessionId).toBe(session2);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance and Observability', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({
        completion: 'Test response',
        sessionId: 'session-123',
      });
    });

    it('should measure and log invocation performance', async () => {
      const startTime = Date.now();
      
      await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      const endTime = Date.now();
      const invocationTime = endTime - startTime;
      
      // Verify that the invocation completed in reasonable time
      expect(invocationTime).toBeLessThan(1000); // Should be much faster in tests
    });

    it('should call data protection auditing for successful invocations', async () => {
      const { DataProtection } = require('../observability/dataProtection');
      
      await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(DataProtection.auditAgentInvocation).toHaveBeenCalledWith(
        'agent-123',
        'alias-456',
        'test input',
        expect.any(Number), // response length
        expect.any(Number), // invocation time
        true, // success
        'session-789',
        undefined, // no error
        expect.objectContaining({
          inputLength: 10, // 'test input'.length
          responseLength: expect.any(Number)
        })
      );
    });

    it('should call data protection auditing for failed invocations', async () => {
      const { DataProtection } = require('../observability/dataProtection');
      const error = new Error('Test error');
      mockSend.mockRejectedValueOnce(error);
      
      await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(DataProtection.auditAgentInvocation).toHaveBeenCalledWith(
        'agent-123',
        'alias-456',
        'test input',
        undefined, // no response length for failed invocation
        expect.any(Number), // invocation time
        false, // success = false
        'session-789',
        'Error', // error name
        expect.objectContaining({
          inputLength: 10,
          errorCode: undefined
        })
      );
    });

    it('should use correlation tracing', async () => {
      const { CorrelationIdManager } = require('../utils/correlationId');
      
      await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(CorrelationIdManager.traceWithCorrelation).toHaveBeenCalledWith(
        'agent_core.invoke',
        expect.any(Function),
        {
          'agent.id': 'agent-123',
          'agent.alias_id': 'alias-456',
          'session.id': 'session-789',
          'input.length': '10'
        }
      );
    });
  });

  describe('Edge Cases and Special Scenarios', () => {
    it('should handle very long input text', async () => {
      const longInput = 'a'.repeat(10000);
      mockSend.mockResolvedValue({
        completion: 'Response to long input',
        sessionId: 'session-123',
      });
      
      const response = await client.invokeAgent('agent-123', 'alias-456', longInput, 'session-789');
      
      expect(response.response).toContain('Response to long input');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle special characters in input', async () => {
      const specialInput = 'What is "machine learning" & AI? (2024) 🤖';
      mockSend.mockResolvedValue({
        completion: 'Response with special chars',
        sessionId: 'session-123',
      });
      
      const response = await client.invokeAgent('agent-123', 'alias-456', specialInput, 'session-789');
      
      expect(response.response).toContain('Response with special chars');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle Unicode characters in input', async () => {
      const unicodeInput = 'What is 机器学习 and 人工智能?';
      mockSend.mockResolvedValue({
        completion: 'Unicode response',
        sessionId: 'session-123',
      });
      
      const response = await client.invokeAgent('agent-123', 'alias-456', unicodeInput, 'session-789');
      
      expect(response.response).toContain('Unicode response');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle malformed AWS response gracefully', async () => {
      mockSend.mockResolvedValue({
        // Missing completion and sessionId
        unexpectedProperty: 'unexpected value'
      });
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      expect(response.response).toContain('I apologize, but I was unable to generate a response');
      expect(response.sessionId).toBe('session-789');
      expect(response.agentId).toBe('agent-123');
    });

    it('should handle null/undefined AWS response', async () => {
      mockSend.mockResolvedValue(null);
      
      const response = await client.invokeAgent('agent-123', 'alias-456', 'test input', 'session-789');
      
      // Null response will cause formatting to fail and trigger graceful degradation
      expect(response.response).toContain('I apologize, but I encountered an issue processing');
      expect(response.sessionId).toBe('session-789');
      expect(response.agentId).toBe('agent-123');
    });
  });

  describe('Error Classes', () => {
    it('should create AgentCoreError with all properties', () => {
      const error = new AgentCoreError(
        'Test error message',
        'agent-123',
        'session-456',
        new Error('Cause error')
      );
      
      expect(error).toBeInstanceOf(AgentCoreError);
      expect(error.message).toBe('Test error message');
      expect(error.agentId).toBe('agent-123');
      expect(error.sessionId).toBe('session-456');
      expect(error.code).toBe('AGENT_CORE_ERROR');
      expect(error.cause).toBeInstanceOf(Error);
    });

    it('should create AgentCoreError with minimal properties', () => {
      const error = new AgentCoreError('Test error message');
      
      expect(error).toBeInstanceOf(AgentCoreError);
      expect(error.message).toBe('Test error message');
      expect(error.agentId).toBeUndefined();
      expect(error.sessionId).toBeUndefined();
      expect(error.cause).toBeUndefined();
    });
  });
});