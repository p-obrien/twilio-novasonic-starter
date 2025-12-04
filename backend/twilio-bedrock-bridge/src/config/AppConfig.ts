/**
 * Legacy AppConfig module - DEPRECATED
 *
 * @deprecated This file is deprecated. Use ConfigurationManager from './ConfigurationManager' instead.
 *
 * This file previously contained the LegacyConfigManager which has been removed.
 * All code should now import and use configManager from './ConfigurationManager' directly.
 *
 * Migration guide:
 * - Old: import { config } from './config/AppConfig';
 * - New: import { configManager } from './config/ConfigurationManager';
 *
 * This file is kept temporarily to provide the AppConfig type definition for backward compatibility.
 */

import { InferenceConfig } from '../types/SharedTypes';
import { IntegrationConfig } from '../types/IntegrationTypes';

/**
 * Application configuration interface
 * @deprecated Use ConfigurationManager interface instead
 */
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

import { configManager } from './ConfigurationManager';

/**
 * @deprecated Use configManager from './ConfigurationManager' instead
 * Provides backward compatibility wrapper
 */
export const config = {
  getConfig: () => configManager.getAll(),
  get server() { return configManager.get('server'); },
  get aws() { return configManager.get('aws'); },
  get bedrock() { return configManager.get('bedrock'); },
  get twilio() { return configManager.get('twilio'); },
  get logging() { return configManager.get('logging'); },
  get inference() { return configManager.get('inference'); },
  get integration() { return configManager.get('integration'); },
};

/**
 * @deprecated Use configManager from './ConfigurationManager' instead
 */
export default config;
