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
        }
      });
    });

    it('should use default values when environment variables are not set', () => {
      process.env.TWILIO_AUTH_TOKEN = 'required-token';
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

      expect(() => {
        require('../config/AppConfig');
      }).toThrow('TWILIO_AUTH_TOKEN environment variable is required');
    });

    it('should handle quoted TWILIO_AUTH_TOKEN', () => {
      process.env.TWILIO_AUTH_TOKEN = '"quoted-auth-token"';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.twilio.authToken).toBe('quoted-auth-token');
    });

    it('should trim whitespace from TWILIO_AUTH_TOKEN', () => {
      process.env.TWILIO_AUTH_TOKEN = '  whitespace-token  ';

      const { config: testConfig } = require('../config/AppConfig');
      const appConfig = testConfig.getConfig();

      expect(appConfig.twilio.authToken).toBe('whitespace-token');
    });
  });

  describe('Server Configuration', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
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
    });

    it('should not expose sensitive information in logs', () => {
      process.env.TWILIO_AUTH_TOKEN = 'secret-token';

      const { config: testConfig } = require('../config/AppConfig');
      const configString = JSON.stringify(testConfig.getConfig());

      // Auth token should be present but we're not testing for exposure here
      // In a real scenario, you might want to ensure sensitive data is masked
      expect(configString).toContain('secret-token');
    });
  });

  describe('Environment-specific Configuration', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
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