/**
 * Test Configuration Manager
 * 
 * Provides a test-specific configuration manager that bypasses production validation
 * and provides sensible defaults for testing environments.
 */

import { UnifiedConfig } from './ConfigurationTypes';

/**
 * Test-specific configuration manager that bypasses production validation
 * Uses composition instead of inheritance to work around private constructor
 */
export class TestConfigurationManager {
  private static testInstance: TestConfigurationManager | null = null;
  private testOverrides: Record<string, any> = {};
  public initialized = false;

  /**
   * Get or create the test configuration manager instance
   */
  public static getInstance(): TestConfigurationManager {
    if (!TestConfigurationManager.testInstance) {
      TestConfigurationManager.testInstance = new TestConfigurationManager();
    }
    return TestConfigurationManager.testInstance;
  }

  /**
   * Reset the test instance (useful for test cleanup)
   */
  public static resetTestInstance(): void {
    TestConfigurationManager.testInstance = null;
  }

  /**
   * Initialize configuration for testing with minimal validation
   */
  public initializeSync(overrides: Record<string, any> = {}): void {
    // Set test environment variables if not already set
    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = 'test';
    }
    if (!process.env.JEST_WORKER_ID) {
      process.env.JEST_WORKER_ID = '1';
    }
    if (!process.env.TWILIO_AUTH_TOKEN) {
      process.env.TWILIO_AUTH_TOKEN = 'test-auth-token-123456789abcdef0123456789abcdef01';
    }
    if (!process.env.TWILIO_ACCOUNT_SID) {
      process.env.TWILIO_ACCOUNT_SID = 'ACtest123456789abcdef0123456789abcdef';
    }
    if (!process.env.LOG_LEVEL) {
      process.env.LOG_LEVEL = 'ERROR';
    }
    if (!process.env.AWS_REGION) {
      process.env.AWS_REGION = 'us-east-1';
    }

    // Store test overrides
    this.testOverrides = { ...overrides };
    this.initialized = true;
  }

  /**
   * Initialize configuration for testing with minimal validation
   */
  public initializeForTesting(overrides: Record<string, any> = {}): void {
    this.initializeSync(overrides);
  }

  /**
   * Override configuration values for testing
   */
  public setTestOverride(key: string, value: any): void {
    this.testOverrides[key] = value;
  }

  /**
   * Set configuration value
   */
  public set(key: string, value: any): void {
    this.testOverrides[key] = value;
  }

  /**
   * Clear all test overrides
   */
  public clearTestOverrides(): void {
    this.testOverrides = {};
  }

  /**
   * Get configuration value with test overrides applied
   */
  public get(key: string): any {
    // Check test overrides first
    if (key in this.testOverrides) {
      return this.testOverrides[key];
    }
    
    // Provide sensible test defaults
    const testDefaults: Record<string, any> = {
      'twilio.authToken': 'test-auth-token-123456789abcdef0123456789abcdef01',
      'twilio.accountSid': 'ACtest123456789abcdef0123456789abcdef',
      'server.port': 8080,
      'aws.region': 'us-east-1',
      'bedrock.region': 'us-east-1',
      'bedrock.modelId': 'amazon.nova-sonic-v1:0',
      'logging.level': 'ERROR',
      'environment.nodeEnv': 'test',
      'environment.serviceName': 'twilio-bedrock-bridge-test',
      'environment.serviceVersion': '0.1.0-test',
      'metrics.enableCustomMetrics': false,
      'metrics.enableSystemMetrics': false,
      'tracing.enableXRay': false,
      'tracing.enableOTLP': false,
    };

    return testDefaults[key];
  }

  /**
   * Get required configuration value (same as get for tests)
   */
  public getRequired(key: string): any {
    return this.get(key);
  }

  /**
   * Validate configuration (always returns valid for tests)
   */
  public validate(): { isValid: boolean; errors: string[] } {
    return { isValid: true, errors: [] };
  }

  /**
   * Disable hot-reload in test environment to prevent hanging tests
   */
  public enableHotReload(): void {
    // Do nothing in test environment
  }

  /**
   * Disable hot-reload in test environment
   */
  public disableHotReload(): void {
    // Do nothing in test environment
  }

  /**
   * Mock hot-reload trigger for testing
   */
  public async triggerHotReload(): Promise<{ success: boolean; reloadedKeys: string[]; errors?: string[] }> {
    // Mock successful hot-reload for tests
    return {
      success: true,
      reloadedKeys: Object.keys(this.testOverrides)
    };
  }

  /**
   * Mock event subscription for tests
   */
  public on(event: string, callback: (...args: any[]) => void): void {
    // Do nothing in test environment
  }

  /**
   * Mock event unsubscription for tests
   */
  public off(event: string, callback: (...args: any[]) => void): void {
    // Do nothing in test environment
  }

  /**
   * Mock reload method for tests
   */
  public async reload(): Promise<void> {
    // Do nothing in test environment
  }

  /**
   * Server configuration accessor
   */
  public get server() {
    return {
      port: this.get('server.port') || 8080,
      host: this.get('server.host')
    };
  }

  /**
   * AWS configuration accessor
   */
  public get aws() {
    return {
      region: this.get('aws.region') || 'us-east-1',
      profileName: this.get('aws.profileName')
    };
  }

  /**
   * Bedrock configuration accessor
   */
  public get bedrock() {
    return {
      region: this.get('bedrock.region') || 'us-east-1',
      modelId: this.get('bedrock.modelId') || 'amazon.nova-sonic-v1:0'
    };
  }

  /**
   * Twilio configuration accessor
   */
  public get twilio() {
    return {
      authToken: this.get('twilio.authToken') || 'test-auth-token-123456789abcdef0123456789abcdef01',
      accountSid: this.get('twilio.accountSid') || 'ACtest123456789abcdef0123456789abcdef'
    };
  }

  /**
   * Logging configuration accessor
   */
  public get logging() {
    return {
      level: this.get('logging.level') || 'ERROR'
    };
  }
}

/**
 * Factory function to create a test configuration manager
 */
export function createTestConfigurationManager(overrides: Record<string, any> = {}): TestConfigurationManager {
  const testManager = TestConfigurationManager.getInstance();
  testManager.initializeForTesting(overrides);
  return testManager;
}

/**
 * Utility function to mock configuration for tests
 */
export function mockConfigurationForTests(overrides: Record<string, any> = {}): TestConfigurationManager {
  // Reset any existing instance
  TestConfigurationManager.resetTestInstance();
  
  // Create new test instance with overrides
  return createTestConfigurationManager(overrides);
}