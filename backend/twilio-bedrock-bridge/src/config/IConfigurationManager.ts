/**
 * Configuration Manager Interface
 * Defines the contract for centralized configuration management
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigChanges {
  added: Record<string, any>;
  modified: Record<string, { oldValue: any; newValue: any }>;
  removed: string[];
}

export type ConfigChangeCallback = (changes: ConfigChanges) => void;

export interface HotReloadOptions {
  pollInterval?: number;
  enabled?: boolean;
}

export interface HotReloadResult {
  success: boolean;
  reloadedKeys: string[];
  errors?: string[];
}

export interface IConfigurationManager {
  /**
   * Initialize the configuration manager
   */
  initialize(): Promise<void>;

  /**
   * Get a configuration value by key path (e.g., 'server.port', 'aws.region')
   */
  get<T = any>(key: string): T | undefined;

  /**
   * Get a required configuration value, throws if not found
   */
  getRequired<T = any>(key: string): T;

  /**
   * Get the entire configuration object
   */
  getAll(): Record<string, any>;

  /**
   * Validate the current configuration
   */
  validate(): ValidationResult;

  /**
   * Reload configuration from environment/sources
   */
  reload(): Promise<void>;

  /**
   * Register a callback for configuration changes
   */
  onChange(callback: ConfigChangeCallback): void;

  /**
   * Remove a configuration change callback
   */
  offChange(callback: ConfigChangeCallback): void;

  /**
   * Check if a configuration key exists
   */
  has(key: string): boolean;

  /**
   * Get configuration with type safety
   */
  getTyped<T>(key: string, defaultValue?: T): T;

  /**
   * Set a configuration value (for hot-reload scenarios)
   */
  set(key: string, value: any): void;

  /**
   * Get configuration schema for validation
   */
  getSchema(): Record<string, any>;

  /**
   * Enable hot-reload functionality
   */
  enableHotReload(options?: HotReloadOptions): void;

  /**
   * Disable hot-reload functionality
   */
  disableHotReload(): void;

  /**
   * Manually trigger a hot-reload
   */
  triggerHotReload(): Promise<HotReloadResult>;

  /**
   * Check if hot-reload is enabled
   */
  isHotReloadEnabled(): boolean;
}