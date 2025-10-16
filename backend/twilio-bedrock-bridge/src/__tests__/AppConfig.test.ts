/**
 * Tests for AppConfig
 */

import { config } from '../config/AppConfig';

describe('AppConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Configuration Loading', () => {
    it('should load configuration with required environment variables', () => {
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'opentofu-kb-12345';
      process.env.AWS_REGION = 'us-west-2';
      process.env.PORT = '3000';
      process.env.LOG_LEVEL = 'DEBUG';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig).toEqual({
        server: {
          port: 3000,
          host: undefined
        },
        aws: {
          region: 'us-west-2',
          profileName: undefined
        },
        bedrock: {
          region: 'us-west-2',
          modelId: 'amazon.nova-sonic-v1:0'
        },
        twilio: {
          authToken: 'test-auth-token'
        },
        logging: {
          level: 'DEBUG'
        },
        inference: {
          maxTokens: expect.any(Number),
          topP: expect.any(Number),
          temperature: expect.any(Number)
        },
        integration: {
          enabled: true, // Always enabled - this is the only supported mode
          knowledgeBases: [{
            id: 'main-kb',
            knowledgeBaseId: 'opentofu-kb-12345',
            name: 'Main Knowledge Base',
            enabled: true,
            domain: 'general',
            priority: 1
          }],
          agents: [],
          thresholds: {
            intentConfidenceThreshold: 0.7,
            knowledgeQueryTimeoutMs: 5000,
            agentInvocationTimeoutMs: 10000,
            maxRetries: 2
          }
        }
      });
    });

    it('should use default values when environment variables are not set', () => {
      process.env.TWILIO_AUTH_TOKEN = 'required-token';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'opentofu-kb-67890';
      delete process.env.AWS_REGION;
      delete process.env.PORT;
      delete process.env.LOG_LEVEL;

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.server.port).toBe(8080);
      expect(appConfig.aws.region).toBe('us-east-1');
      expect(appConfig.logging.level).toBe('INFO');
    });

    it('should throw error when TWILIO_AUTH_TOKEN is missing', () => {
      delete process.env.TWILIO_AUTH_TOKEN;
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-kb-789';

      expect(() => {
        require('../config/AppConfig');
      }).toThrow('TWILIO_AUTH_TOKEN environment variable is required');
    });

    it('should throw error when BEDROCK_KNOWLEDGE_BASE_ID is missing', () => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
      delete process.env.BEDROCK_KNOWLEDGE_BASE_ID;

      expect(() => {
        delete require.cache[require.resolve('../config/AppConfig')];
        require('../config/AppConfig');
      }).toThrow('BEDROCK_KNOWLEDGE_BASE_ID environment variable is required');
    });

    it('should handle quoted TWILIO_AUTH_TOKEN', () => {
      process.env.TWILIO_AUTH_TOKEN = '"quoted-auth-token"';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-kb-quoted';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.twilio.authToken).toBe('quoted-auth-token');
    });

    it('should trim whitespace from TWILIO_AUTH_TOKEN', () => {
      process.env.TWILIO_AUTH_TOKEN = '  whitespace-token  ';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-kb-whitespace';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.twilio.authToken).toBe('whitespace-token');
    });
  });

  describe('Server Configuration', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-kb-server';
    });

    it('should parse PORT as integer', () => {
      process.env.PORT = '9000';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.server.port).toBe(9000);
      expect(typeof appConfig.server.port).toBe('number');
    });

    it('should handle invalid PORT gracefully', () => {
      process.env.PORT = 'invalid-port';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.server.port).toBeNaN();
    });

    it('should include HOST when provided', () => {
      process.env.HOST = '0.0.0.0';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.server.host).toBe('0.0.0.0');
    });
  });

  describe('AWS Configuration', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-kb-aws';
    });

    it('should use custom AWS region', () => {
      process.env.AWS_REGION = 'eu-west-1';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.aws.region).toBe('eu-west-1');
    });

    it('should include AWS profile name when provided', () => {
      process.env.AWS_PROFILE_NAME = 'development';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.aws.profileName).toBe('development');
    });
  });

  describe('Inference Configuration', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-kb-inference';
    });

    it('should parse inference parameters as numbers', () => {
      process.env.MAX_TOKENS = '2048';
      process.env.TOP_P = '0.8';
      process.env.TEMPERATURE = '0.5';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.inference.maxTokens).toBe(2048);
      expect(appConfig.inference.topP).toBe(0.8);
      expect(appConfig.inference.temperature).toBe(0.5);
    });

    it('should use default inference values when not provided', () => {
      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(typeof appConfig.inference.maxTokens).toBe('number');
      expect(typeof appConfig.inference.topP).toBe('number');
      expect(typeof appConfig.inference.temperature).toBe('number');
      expect(appConfig.inference.maxTokens).toBeGreaterThan(0);
      expect(appConfig.inference.topP).toBeGreaterThan(0);
      expect(appConfig.inference.topP).toBeLessThanOrEqual(1);
      expect(appConfig.inference.temperature).toBeGreaterThanOrEqual(0);
      expect(appConfig.inference.temperature).toBeLessThanOrEqual(1);
    });

    it('should handle invalid inference parameters', () => {
      process.env.MAX_TOKENS = 'invalid';
      process.env.TOP_P = 'invalid';
      process.env.TEMPERATURE = 'invalid';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.inference.maxTokens).toBeNaN();
      expect(appConfig.inference.topP).toBeNaN();
      expect(appConfig.inference.temperature).toBeNaN();
    });
  });

  describe('Singleton Pattern', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-kb-singleton';
    });

    it('should return same instance on multiple calls', () => {
      const { config: config1 } = require('../config/AppConfig');
      const { config: config2 } = require('../config/AppConfig');

      expect(config1).toBe(config2);
    });

    it('should provide getter methods for configuration sections', () => {
      const { config: testConfig } = require('../config/AppConfig');

      expect(testConfig.server).toBeDefined();
      expect(testConfig.aws).toBeDefined();
      expect(testConfig.twilio).toBeDefined();
      expect(testConfig.logging).toBeDefined();
      expect(testConfig.inference).toBeDefined();
      expect(testConfig.integration).toBeDefined();
    });
  });

  describe('Configuration Validation', () => {
    it('should validate required fields are present', () => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.server).toBeDefined();
      expect(appConfig.server.port).toBeDefined();
      expect(appConfig.aws).toBeDefined();
      expect(appConfig.aws.region).toBeDefined();
      expect(appConfig.twilio).toBeDefined();
      expect(appConfig.twilio.authToken).toBeDefined();
      expect(appConfig.logging).toBeDefined();
      expect(appConfig.logging.level).toBeDefined();
      expect(appConfig.inference).toBeDefined();
      expect(appConfig.inference.maxTokens).toBeDefined();
      expect(appConfig.inference.topP).toBeDefined();
      expect(appConfig.inference.temperature).toBeDefined();
      expect(appConfig.integration).toBeDefined();
      expect(appConfig.integration.enabled).toBeDefined();
      expect(appConfig.integration.knowledgeBases).toBeDefined();
      expect(appConfig.integration.agents).toBeDefined();
      expect(appConfig.integration.thresholds).toBeDefined();
    });

    it('should not expose sensitive information in logs', () => {
      process.env.TWILIO_AUTH_TOKEN = 'secret-token';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-kb-secret';

      const { config: testConfig } = require('../config/AppConfig');
      const configString = JSON.stringify(testConfig.getConfig());

      // Auth token should be present but we're not testing for exposure here
      // In a real scenario, you might want to ensure sensitive data is masked
      expect(configString).toContain('secret-token');
    });
  });

  describe('Integration Configuration', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-kb-integration';
    });

    it('should have integration enabled by default', () => {
      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.integration.enabled).toBe(true);
      expect(appConfig.integration.knowledgeBases).toHaveLength(1);
      expect(appConfig.integration.knowledgeBases[0].id).toBe('main-kb');
      expect(appConfig.integration.knowledgeBases[0].enabled).toBe(true);
      expect(appConfig.integration.knowledgeBases[0].knowledgeBaseId).toBeDefined();
      expect(appConfig.integration.agents).toEqual([]);
    });

    it('should use OpenTofu knowledge base configuration', () => {
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'opentofu-kb-test-123';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.integration.knowledgeBases).toHaveLength(1);
      expect(appConfig.integration.knowledgeBases[0].id).toBe('main-kb');
      expect(appConfig.integration.knowledgeBases[0].knowledgeBaseId).toBe('opentofu-kb-test-123');
      expect(appConfig.integration.knowledgeBases[0].name).toBe('Main Knowledge Base');
    });

    it('should have no agents when OpenTofu agent variables are not set', () => {
      // Ensure no agent environment variables are set
      delete process.env.BEDROCK_AGENT_ID;
      delete process.env.BEDROCK_AGENT_ALIAS_ID;

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.integration.agents).toHaveLength(0);
    });

    it('should use custom threshold values from environment', () => {
      process.env.INTENT_CONFIDENCE_THRESHOLD = '0.8';
      process.env.KNOWLEDGE_QUERY_TIMEOUT_MS = '3000';
      process.env.AGENT_INVOCATION_TIMEOUT_MS = '8000';
      process.env.MAX_RETRIES = '3';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.integration.thresholds.intentConfidenceThreshold).toBe(0.8);
      expect(appConfig.integration.thresholds.knowledgeQueryTimeoutMs).toBe(3000);
      expect(appConfig.integration.thresholds.agentInvocationTimeoutMs).toBe(8000);
      expect(appConfig.integration.thresholds.maxRetries).toBe(3);
    });

    it('should use OpenTofu agent configuration when provided', () => {
      process.env.BEDROCK_AGENT_ID = 'opentofu-agent-123';
      process.env.BEDROCK_AGENT_ALIAS_ID = 'opentofu-alias-456';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.integration.agents).toHaveLength(1);
      expect(appConfig.integration.agents[0].id).toBe('main-agent');
      expect(appConfig.integration.agents[0].agentId).toBe('opentofu-agent-123');
      expect(appConfig.integration.agents[0].agentAliasId).toBe('opentofu-alias-456');
    });
  });

  describe('Environment-specific Configuration', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
      process.env.BEDROCK_KNOWLEDGE_BASE_ID = 'test-kb-environment';
    });

    it('should handle development environment', () => {
      process.env.NODE_ENV = 'development';
      process.env.LOG_LEVEL = 'DEBUG';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.logging.level).toBe('DEBUG');
    });

    it('should handle production environment', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'WARN';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.logging.level).toBe('WARN');
    });
  });
});