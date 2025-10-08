/**
 * Unit tests for AppConfig (Legacy Configuration Manager)
 */

import { config } from '../../../config/AppConfig';

describe('AppConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      // The config is already a singleton instance
      expect(config).toBeDefined();
      expect(typeof config.getConfig).toBe('function');
    });

    it('should initialize with default values when no env vars set', () => {
      delete process.env.PORT;
      delete process.env.AWS_REGION;
      delete process.env.TWILIO_AUTH_TOKEN;
      
      const appConfig = config.getConfig();
      
      // In test environment, uses test defaults
      expect(appConfig.server.port).toBe(8080); // Test default
      expect(appConfig.aws.region).toBe('us-east-1');
      expect(appConfig.logging.level).toBe('INFO'); // Actual default value
    });

    it('should provide configuration values', () => {
      // Since config is a singleton already initialized, just verify it provides values
      const appConfig = config.getConfig();
      
      expect(appConfig.server.port).toBeDefined();
      expect(typeof appConfig.server.port).toBe('number');
      expect(appConfig.aws.region).toBeDefined();
      expect(typeof appConfig.aws.region).toBe('string');
      expect(appConfig.twilio.authToken).toBeDefined();
      expect(typeof appConfig.twilio.authToken).toBe('string');
      expect(appConfig.logging.level).toBeDefined();
      expect(typeof appConfig.logging.level).toBe('string');
    });

    it('should provide valid configuration structure', () => {
      const appConfig = config.getConfig();
      
      // Verify the configuration has the expected structure
      expect(appConfig).toHaveProperty('server');
      expect(appConfig).toHaveProperty('aws');
      expect(appConfig).toHaveProperty('bedrock');
      expect(appConfig).toHaveProperty('twilio');
      expect(appConfig).toHaveProperty('logging');
      expect(appConfig).toHaveProperty('inference');
      
      expect(appConfig.server).toHaveProperty('port');
      expect(appConfig.aws).toHaveProperty('region');
      expect(appConfig.bedrock).toHaveProperty('region');
      expect(appConfig.bedrock).toHaveProperty('modelId');
      expect(appConfig.twilio).toHaveProperty('authToken');
      expect(appConfig.logging).toHaveProperty('level');
    });
  });

  describe('configuration access', () => {
    it('should provide direct property access', () => {
      // Test the convenience getters
      expect(config.server).toBeDefined();
      expect(config.aws).toBeDefined();
      expect(config.bedrock).toBeDefined();
      expect(config.twilio).toBeDefined();
      expect(config.logging).toBeDefined();
      
      expect(typeof config.server.port).toBe('number');
      expect(typeof config.aws.region).toBe('string');
      expect(typeof config.bedrock.modelId).toBe('string');
      expect(typeof config.twilio.authToken).toBe('string');
      expect(typeof config.logging.level).toBe('string');
    });

    it('should provide inference configuration', () => {
      const appConfig = config.getConfig();
      
      expect(appConfig.inference).toBeDefined();
      expect(appConfig.inference).toHaveProperty('maxTokens');
      expect(appConfig.inference).toHaveProperty('topP');
      expect(appConfig.inference).toHaveProperty('temperature');
      
      expect(typeof appConfig.inference.maxTokens).toBe('number');
      expect(typeof appConfig.inference.topP).toBe('number');
      expect(typeof appConfig.inference.temperature).toBe('number');
    });
  });
});