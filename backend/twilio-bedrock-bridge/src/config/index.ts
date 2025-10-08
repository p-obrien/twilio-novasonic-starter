/**
 * Configuration System Exports
 * Centralized exports for the unified configuration system
 */

// Main configuration manager
export { ConfigurationManager } from './ConfigurationManager';
export { configManager } from './ConfigurationManager';

// Hot-reload functionality
export { 
  ConfigurationWatcher, 
  createConfigurationWatcher 
} from './ConfigurationWatcher';
export type { 
  WatcherOptions, 
  ReloadResult 
} from './ConfigurationWatcher';

// Event system
export { 
  ConfigurationEventEmitter, 
  ConfigurationNotifier, 
  configurationNotifier 
} from './ConfigurationEvents';
export type { 
  HotReloadResult, 
  ConfigurationEventMap 
} from './ConfigurationEvents';

// Interfaces and types
export type { 
  IConfigurationManager, 
  ValidationResult, 
  ConfigChanges, 
  ConfigChangeCallback 
} from './IConfigurationManager';

export type {
  UnifiedConfig,
  ServerConfig,
  AWSConfig,
  BedrockConfig,
  TwilioConfig,
  LoggingConfig,
  MetricsConfig,
  TracingConfig,
  CloudWatchConfig,
  HealthCheckConfig,
  EnvironmentConfig,
  ConfigSchema,
} from './ConfigurationTypes';

// Schema and validation
export { 
  CONFIG_SCHEMA, 
  getRequiredConfigKeys, 
  getConfigKeyFromEnvVar 
} from './ConfigurationSchema';

// Legacy compatibility (deprecated)
export { config as legacyConfig } from './AppConfig';
export type { AppConfig } from './AppConfig';

// Default export is the configuration manager instance
import { configManager } from './ConfigurationManager';
export default configManager;