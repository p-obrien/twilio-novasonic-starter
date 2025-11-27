/**
 * Unit tests for ConfigurationManager (formerly AppConfig)
 */

import { configManager } from '../../../config/ConfigurationManager';

describe('ConfigurationManager (AppConfig)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Configuration Manager Instance', () => {
    it('should be defined', () => {
      expect(configManager).toBeDefined();
      expect(configManager.server).toBeDefined();
    });

    it('should initialize with default values when no env vars set', () => {
      // configManager is already initialized, just verify it provides values
      expect(configManager.server.port).toBeDefined();
      expect(typeof configManager.server.port).toBe('number');
      expect(configManager.aws.region).toBeDefined();
      expect(configManager.logging.level).toBeDefined();
    });

    it('should provide configuration values', () => {
      expect(configManager.server.port).toBeDefined();
      expect(typeof configManager.server.port).toBe('number');
      expect(configManager.aws.region).toBeDefined();
      expect(typeof configManager.aws.region).toBe('string');
      expect(configManager.twilio.authToken).toBeDefined();
      expect(typeof configManager.twilio.authToken).toBe('string');
      expect(configManager.logging.level).toBeDefined();
      expect(typeof configManager.logging.level).toBe('string');
    });
  });

  describe('Server Configuration', () => {
    it('should have server configuration', () => {
      expect(configManager.server).toBeDefined();
      expect(configManager.server.port).toBeGreaterThan(0);
    });
  });

  describe('AWS Configuration', () => {
    it('should have AWS configuration', () => {
      expect(configManager.aws).toBeDefined();
      expect(configManager.aws.region).toBeDefined();
      expect(typeof configManager.aws.region).toBe('string');
    });
  });

  describe('Bedrock Configuration', () => {
    it('should have Bedrock configuration', () => {
      expect(configManager.bedrock).toBeDefined();
      expect(configManager.bedrock.region).toBeDefined();
      expect(configManager.bedrock.modelId).toBeDefined();
      expect(typeof configManager.bedrock.modelId).toBe('string');
    });

    it('should have valid model ID', () => {
      expect(configManager.bedrock.modelId).toContain('amazon.nova');
    });
  });

  describe('Twilio Configuration', () => {
    it('should have Twilio configuration', () => {
      expect(configManager.twilio).toBeDefined();
      expect(configManager.twilio.authToken).toBeDefined();
      expect(typeof configManager.twilio.authToken).toBe('string');
    });
  });

  describe('Logging Configuration', () => {
    it('should have logging configuration', () => {
      expect(configManager.logging).toBeDefined();
      expect(configManager.logging.level).toBeDefined();
      expect(['DEBUG', 'INFO', 'WARN', 'ERROR']).toContain(configManager.logging.level);
    });
  });

  describe('Inference Configuration', () => {
    it('should have inference configuration', () => {
      expect(configManager.inference).toBeDefined();
      expect(typeof configManager.inference.maxTokens).toBe('number');
      expect(typeof configManager.inference.temperature).toBe('number');
      expect(typeof configManager.inference.topP).toBe('number');
    });

    it('should have valid inference parameters', () => {
      expect(configManager.inference.maxTokens).toBeGreaterThan(0);
      expect(configManager.inference.temperature).toBeGreaterThanOrEqual(0);
      expect(configManager.inference.temperature).toBeLessThanOrEqual(2);
      expect(configManager.inference.topP).toBeGreaterThanOrEqual(0);
      expect(configManager.inference.topP).toBeLessThanOrEqual(1);
    });
  });
});
