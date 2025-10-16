/**
 * Centralized application configuration
 * Validates and provides typed access to all environment variables and settings
<<<<<<< HEAD
 * Knowledge base integration is always enabled with default configuration
=======
 * 
 * @deprecated Use ConfigurationManager from './ConfigurationManager' instead
 * This file is maintained for backward compatibility
>>>>>>> origin/main
 */

import { configManager } from './ConfigurationManager';
import { InferenceConfig } from '../types/SharedTypes';
<<<<<<< HEAD
import { IntegrationConfig } from '../types/IntegrationTypes';
import { DefaultInferenceConfiguration } from '../utils/constants';
import { IntegrationConfigValidator } from './IntegrationConfigValidator';
=======
>>>>>>> origin/main

export interface AppConfig {
  server: {
    port: number;
    host?: string;
  };
  aws: {
    region: string;
    profileName?: string;
  };
  bedrock: {
    region: string;
    modelId: string;
  };
  twilio: {
    authToken: string;
  };
  logging: {
    level: string;
  };
  inference: InferenceConfig;
  integration: IntegrationConfig;
}

/**
 * @deprecated Use ConfigurationManager instead
 * Legacy configuration manager for backward compatibility
 */
class LegacyConfigManager {
  private static instance: LegacyConfigManager;

  private constructor() {
    // Initialize the configuration manager if not already initialized
    if (!configManager.initialized) {
      try {
        // Use synchronous initialization for backward compatibility
        configManager.initializeSync();
      } catch (error) {
        console.warn('Failed to initialize configuration manager, using defaults:', error);
      }
    }

<<<<<<< HEAD
    const config = {
      server: {
        port: parseInt(process.env.PORT || '8080', 10),
        host: process.env.HOST,
      },
      aws: {
        region: process.env.AWS_REGION || 'us-east-1',
        profileName: process.env.AWS_PROFILE_NAME,
      },
      bedrock: {
        region: process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1',
        modelId: process.env.BEDROCK_MODEL_ID || 'amazon.nova-sonic-v1:0',
      },
      twilio: {
        authToken: twilioAuthToken.trim().replace(/^"(.*)"$/, '$1'),
      },
      logging: {
        level: process.env.LOG_LEVEL || 'INFO',
      },
      inference: {
        maxTokens: parseInt(process.env.MAX_TOKENS || String(DefaultInferenceConfiguration.maxTokens), 10),
        topP: parseFloat(process.env.TOP_P || String(DefaultInferenceConfiguration.topP)),
        temperature: parseFloat(process.env.TEMPERATURE || String(DefaultInferenceConfiguration.temperature)),
      },
      integration: this.loadIntegrationConfig(),
    };
=======
    // Validate configuration on initialization
    const validation = configManager.validate();
    if (!validation.isValid) {
      console.warn(`Configuration validation failed: ${validation.errors.join(', ')}`);
      // Don't throw in legacy mode for backward compatibility
    }
>>>>>>> origin/main

    // Log configuration loaded message for compatibility
    console.log('Bedrock configuration loaded:', {
      bedrockRegion: configManager.bedrock?.region || 'us-east-1',
      bedrockModelId: configManager.bedrock?.modelId || 'amazon.nova-sonic-v1:0',
      awsRegion: configManager.aws?.region || 'us-east-1'
    });
  }

  public static getInstance(): LegacyConfigManager {
    if (!LegacyConfigManager.instance) {
      LegacyConfigManager.instance = new LegacyConfigManager();
    }
    return LegacyConfigManager.instance;
  }

  /**
   * Load integration configuration - knowledge base always enabled and managed by OpenTofu
   * @returns Integration configuration
   */
  private loadIntegrationConfig(): IntegrationConfig {
    // Knowledge base configuration from OpenTofu deployment - REQUIRED
    const knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
    if (!knowledgeBaseId) {
      throw new Error('BEDROCK_KNOWLEDGE_BASE_ID environment variable is required. This should be set automatically by the OpenTofu deployment.');
    }

    // Knowledge base is always enabled and managed by OpenTofu
    const knowledgeBases = [
      {
        id: 'main-kb',
        knowledgeBaseId: knowledgeBaseId,
        name: 'Main Knowledge Base',
        enabled: true,
        domain: 'general',
        priority: 1,
      }
    ];

    // Integration is always enabled - knowledge base managed by OpenTofu
    console.log('Integration features enabled - Knowledge Base managed by OpenTofu');
    
    // Agent configuration from OpenTofu deployment (optional)
    const agentId = process.env.BEDROCK_AGENT_ID;
    const agentAliasId = process.env.BEDROCK_AGENT_ALIAS_ID;
    
    const agents = [];
    if (agentId && agentAliasId) {
      agents.push({
        id: 'main-agent',
        agentId: agentId,
        agentAliasId: agentAliasId,
        name: 'Main Agent',
        enabled: true,
        category: 'general',
        priority: 1,
      });
    }

    // Parse thresholds with environment variable overrides
    const thresholds = {
      intentConfidenceThreshold: parseFloat(
        process.env.INTENT_CONFIDENCE_THRESHOLD || '0.7'
      ),
      knowledgeQueryTimeoutMs: parseInt(
        process.env.KNOWLEDGE_QUERY_TIMEOUT_MS || '5000', 
        10
      ),
      agentInvocationTimeoutMs: parseInt(
        process.env.AGENT_INVOCATION_TIMEOUT_MS || '10000', 
        10
      ),
      maxRetries: parseInt(
        process.env.MAX_RETRIES || '2', 
        10
      ),
    };

    const config: IntegrationConfig = {
      enabled: true, // Always enabled - knowledge base managed by OpenTofu
      knowledgeBases,
      agents,
      thresholds,
    };

    // Validate configuration
    const validation = IntegrationConfigValidator.validate(config);
    if (!validation.isValid) {
      console.error('Integration configuration validation failed:', validation.errors);
      throw new Error(`Integration configuration validation failed: ${validation.errors.join(', ')}`);
    }

    // Log warnings if any
    if (validation.warnings.length > 0) {
      console.warn('Integration configuration warnings:', validation.warnings);
    }

    console.log('Integration configuration loaded:', {
      enabled: config.enabled,
      knowledgeBasesCount: config.knowledgeBases.length,
      agentsCount: config.agents.length,
      thresholds: config.thresholds,
    });

    return config;
  }

  public getConfig(): AppConfig {
    return {
      server: {
        port: configManager.server.port,
        host: configManager.server.host,
      },
      aws: {
        region: configManager.aws.region,
        profileName: configManager.aws.profileName,
      },
      bedrock: {
        region: configManager.bedrock.region,
        modelId: configManager.bedrock.modelId,
      },
      twilio: {
        authToken: configManager.twilio.authToken,
      },
      logging: {
        level: configManager.logging.level,
      },
      inference: configManager.inference,
    };
  }

<<<<<<< HEAD
  public get server() { return this.config.server; }
  public get aws() { return this.config.aws; }
  public get bedrock() { return this.config.bedrock; }
  public get twilio() { return this.config.twilio; }
  public get logging() { return this.config.logging; }
  public get inference() { return this.config.inference; }
  public get integration() { return this.config.integration; }

  /**
   * Parse JSON configuration from environment variable
   * @param envVar Environment variable name
   * @param defaultValue Default value if not provided
   * @returns Parsed JSON object or default value
   */
  private parseJsonConfig<T>(envVar: string, defaultValue: T): T {
    const value = process.env[envVar];
    if (!value) {
      return defaultValue;
    }

    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.warn(`Failed to parse ${envVar} as JSON, using default:`, error);
      return defaultValue;
    }
  }


=======
  public get server() { return configManager.server; }
  public get aws() { return configManager.aws; }
  public get bedrock() { return configManager.bedrock; }
  public get twilio() { return configManager.twilio; }
  public get logging() { return configManager.logging; }
  public get inference() { return configManager.inference; }
>>>>>>> origin/main
}

export const config = LegacyConfigManager.getInstance();
export default config;