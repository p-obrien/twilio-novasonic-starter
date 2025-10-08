/**
 * Centralized application configuration
 * Validates and provides typed access to all environment variables and settings
 * 
 * @deprecated Use ConfigurationManager from './ConfigurationManager' instead
 * This file is maintained for backward compatibility
 */

import { configManager } from './ConfigurationManager';
import { InferenceConfig } from '../types/SharedTypes';

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

    // Validate configuration on initialization
    const validation = configManager.validate();
    if (!validation.isValid) {
      console.warn(`Configuration validation failed: ${validation.errors.join(', ')}`);
      // Don't throw in legacy mode for backward compatibility
    }

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

  public get server() { return configManager.server; }
  public get aws() { return configManager.aws; }
  public get bedrock() { return configManager.bedrock; }
  public get twilio() { return configManager.twilio; }
  public get logging() { return configManager.logging; }
  public get inference() { return configManager.inference; }
}

export const config = LegacyConfigManager.getInstance();
export default config;