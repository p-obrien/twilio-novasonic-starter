/**
 * Centralized application configuration
 * Validates and provides typed access to all environment variables and settings
 */

import { InferenceConfig } from '../types/SharedTypes';
import { IntegrationConfig } from '../types/IntegrationTypes';
import { DefaultInferenceConfiguration } from '../utils/constants';
import { IntegrationConfigValidator } from './IntegrationConfigValidator';

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

class ConfigManager {
  private static instance: ConfigManager;
  private config: AppConfig;

  private constructor() {
    this.config = this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): AppConfig {
    // Validate required environment variables
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    if (!twilioAuthToken) {
      throw new Error('TWILIO_AUTH_TOKEN environment variable is required');
    }

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

    // Log Bedrock configuration
    console.log('Bedrock configuration loaded:', {
      bedrockRegion: config.bedrock.region,
      bedrockModelId: config.bedrock.modelId,
      awsRegion: config.aws.region
    });

    return config;
  }

  /**
   * Load integration configuration from environment variables
   * @returns Integration configuration
   */
  private loadIntegrationConfig(): IntegrationConfig {
    // Default configuration
    const defaultConfig: IntegrationConfig = {
      enabled: true,
      knowledgeBases: [],
      agents: [],
      thresholds: {
        intentConfidenceThreshold: 0.7,
        knowledgeQueryTimeoutMs: 5000,
        agentInvocationTimeoutMs: 10000,
        maxRetries: 2,
      },
    };

    // Integration is always enabled - this is the only supported mode
    console.log('Integration features enabled (default mode)');
    const integrationEnabled = true;

    // Parse knowledge bases configuration
    const knowledgeBases = this.parseJsonConfig('KNOWLEDGE_BASES_CONFIG', []);
    
    // Parse agents configuration
    const agents = this.parseJsonConfig('AGENTS_CONFIG', []);

    // Parse thresholds with environment variable overrides
    const thresholds = {
      intentConfidenceThreshold: parseFloat(
        process.env.INTENT_CONFIDENCE_THRESHOLD || 
        String(defaultConfig.thresholds.intentConfidenceThreshold)
      ),
      knowledgeQueryTimeoutMs: parseInt(
        process.env.KNOWLEDGE_QUERY_TIMEOUT_MS || 
        String(defaultConfig.thresholds.knowledgeQueryTimeoutMs), 
        10
      ),
      agentInvocationTimeoutMs: parseInt(
        process.env.AGENT_INVOCATION_TIMEOUT_MS || 
        String(defaultConfig.thresholds.agentInvocationTimeoutMs), 
        10
      ),
      maxRetries: parseInt(
        process.env.MAX_RETRIES || 
        String(defaultConfig.thresholds.maxRetries), 
        10
      ),
    };

    const config: IntegrationConfig = {
      enabled: true, // Always enabled - this is the only supported mode
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
    return this.config;
  }

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


}

export const config = ConfigManager.getInstance();
export default config;