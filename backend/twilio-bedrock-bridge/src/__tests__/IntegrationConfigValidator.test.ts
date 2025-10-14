/**
 * Tests for IntegrationConfigValidator
 */

import { IntegrationConfigValidator } from '../config/IntegrationConfigValidator';
import { IntegrationConfig, KnowledgeBaseConfig, AgentConfig, ThresholdConfig } from '../types/IntegrationTypes';

describe('IntegrationConfigValidator', () => {
  const validKnowledgeBase: KnowledgeBaseConfig = {
    id: 'test-kb',
    knowledgeBaseId: 'KB123456',
    enabled: true,
  };

  const validAgent: AgentConfig = {
    id: 'test-agent',
    agentId: 'AGENT123',
    agentAliasId: 'ALIAS123',
    enabled: true,
  };

  const validThresholds: ThresholdConfig = {
    intentConfidenceThreshold: 0.7,
    knowledgeQueryTimeoutMs: 5000,
    agentInvocationTimeoutMs: 10000,
    maxRetries: 2,
  };

  const validConfig: IntegrationConfig = {
    enabled: true,
    knowledgeBases: [validKnowledgeBase],
    agents: [validAgent],
    thresholds: validThresholds,
  };

  describe('validate', () => {
    it('should validate a correct configuration', () => {
      const result = IntegrationConfigValidator.validate(validConfig);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate configuration with empty arrays', () => {
      const config: IntegrationConfig = {
        enabled: false,
        knowledgeBases: [],
        agents: [],
        thresholds: validThresholds,
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn when integration is enabled but no resources configured', () => {
      const config: IntegrationConfig = {
        enabled: true,
        knowledgeBases: [],
        agents: [],
        thresholds: validThresholds,
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Integration is enabled but no knowledge bases or agents are configured');
    });

    it('should reject invalid enabled flag', () => {
      const config = {
        ...validConfig,
        enabled: 'true' as any, // Invalid type
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Integration enabled flag must be a boolean');
    });

    it('should reject non-array knowledge bases', () => {
      const config = {
        ...validConfig,
        knowledgeBases: 'not-an-array' as any,
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Knowledge bases must be an array');
    });

    it('should reject non-array agents', () => {
      const config = {
        ...validConfig,
        agents: 'not-an-array' as any,
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Agents must be an array');
    });

    it('should reject missing thresholds', () => {
      const config = {
        ...validConfig,
        thresholds: undefined as any,
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Thresholds configuration is required');
    });
  });

  describe('Knowledge Base Validation', () => {
    it('should reject knowledge base without id', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        knowledgeBases: [{
          ...validKnowledgeBase,
          id: '',
        }],
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('id is required'))).toBe(true);
    });

    it('should reject knowledge base without knowledgeBaseId', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        knowledgeBases: [{
          ...validKnowledgeBase,
          knowledgeBaseId: '',
        }],
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('knowledgeBaseId is required'))).toBe(true);
    });

    it('should reject knowledge base with invalid enabled flag', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        knowledgeBases: [{
          ...validKnowledgeBase,
          enabled: 'true' as any,
        }],
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('enabled must be a boolean'))).toBe(true);
    });

    it('should reject duplicate knowledge base IDs', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        knowledgeBases: [
          validKnowledgeBase,
          { ...validKnowledgeBase, knowledgeBaseId: 'KB789' },
        ],
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('duplicate id'))).toBe(true);
    });

    it('should reject invalid priority', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        knowledgeBases: [{
          ...validKnowledgeBase,
          priority: -1,
        }],
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('priority must be a non-negative integer'))).toBe(true);
    });

    it('should warn about potentially invalid knowledgeBaseId format', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        knowledgeBases: [{
          ...validKnowledgeBase,
          knowledgeBaseId: 'invalid@id!',
        }],
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('may not be a valid AWS resource ID'))).toBe(true);
    });
  });

  describe('Agent Validation', () => {
    it('should reject agent without id', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        agents: [{
          ...validAgent,
          id: '',
        }],
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('id is required'))).toBe(true);
    });

    it('should reject agent without agentId', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        agents: [{
          ...validAgent,
          agentId: '',
        }],
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('agentId is required'))).toBe(true);
    });

    it('should reject agent without agentAliasId', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        agents: [{
          ...validAgent,
          agentAliasId: '',
        }],
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('agentAliasId is required'))).toBe(true);
    });

    it('should reject duplicate agent IDs', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        agents: [
          validAgent,
          { ...validAgent, agentId: 'AGENT456' },
        ],
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('duplicate id'))).toBe(true);
    });
  });

  describe('Threshold Validation', () => {
    it('should reject invalid intentConfidenceThreshold', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        thresholds: {
          ...validThresholds,
          intentConfidenceThreshold: 1.5, // Invalid: > 1
        },
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('intentConfidenceThreshold must be between 0 and 1'))).toBe(true);
    });

    it('should reject negative timeout values', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        thresholds: {
          ...validThresholds,
          knowledgeQueryTimeoutMs: -1000,
        },
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('knowledgeQueryTimeoutMs must be positive'))).toBe(true);
    });

    it('should reject negative maxRetries', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        thresholds: {
          ...validThresholds,
          maxRetries: -1,
        },
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('maxRetries must be a non-negative integer'))).toBe(true);
    });

    it('should warn about low confidence threshold', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        thresholds: {
          ...validThresholds,
          intentConfidenceThreshold: 0.3,
        },
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('may result in poor classification accuracy'))).toBe(true);
    });

    it('should warn about high confidence threshold', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        thresholds: {
          ...validThresholds,
          intentConfidenceThreshold: 0.95,
        },
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('may be too restrictive'))).toBe(true);
    });

    it('should warn about very short timeouts', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        thresholds: {
          ...validThresholds,
          knowledgeQueryTimeoutMs: 500,
        },
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('may be too short'))).toBe(true);
    });

    it('should warn about very long timeouts', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        thresholds: {
          ...validThresholds,
          agentInvocationTimeoutMs: 120000, // 2 minutes
        },
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('may impact conversation flow'))).toBe(true);
    });

    it('should warn about excessive retries', () => {
      const config: IntegrationConfig = {
        ...validConfig,
        thresholds: {
          ...validThresholds,
          maxRetries: 10,
        },
      };

      const result = IntegrationConfigValidator.validate(config);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('may cause excessive delays'))).toBe(true);
    });
  });
});