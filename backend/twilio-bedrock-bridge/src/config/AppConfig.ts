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
}

/**
 * @deprecated Use configManager from './ConfigurationManager' instead
 */
export const config = undefined as any;

/**
 * @deprecated Use configManager from './ConfigurationManager' instead
 */
export default config;
