/**
 * Configuration Watcher and Hot-Reload System
 * Monitors configuration changes and provides safe hot-reload capabilities
 */

import { EventEmitter } from 'events';
import { ConfigurationManager } from './ConfigurationManager';
import { ConfigChanges } from './IConfigurationManager';

export interface WatcherOptions {
  pollInterval: number; // Polling interval in milliseconds
  enableFileWatching: boolean; // Enable file system watching (if applicable)
  safeReloadKeys: string[]; // Keys that are safe to hot-reload
  criticalKeys: string[]; // Keys that require restart
}

export interface ReloadResult {
  success: boolean;
  reloadedKeys: string[];
  skippedKeys: string[];
  errors: string[];
  requiresRestart: boolean;
}

export class ConfigurationWatcher extends EventEmitter {
  private configManager: ConfigurationManager;
  private options: WatcherOptions;
  private pollTimer?: NodeJS.Timeout;
  private lastEnvSnapshot: Record<string, string | undefined>;
  private isWatching = false;

  // Default safe-to-reload configuration keys
  private static readonly DEFAULT_SAFE_RELOAD_KEYS = [
    'logging.level',
    'logging.enableStructuredLogging',
    'metrics.enableCustomMetrics',
    'metrics.enableSystemMetrics',
    'metrics.metricsInterval',
    'tracing.sampleRate',
    'tracing.sampling.websocketMessages',
    'tracing.sampling.audioChunks',
    'tracing.sampling.bedrockStreaming',
    'tracing.sampling.healthChecks',
    'tracing.sampling.errors',
    'tracing.sampling.bedrockRequests',
    'tracing.sampling.sessionLifecycle',
    'cloudWatch.batching.maxBatchSize',
    'cloudWatch.batching.flushIntervalMs',
    'healthCheck.memoryThresholdMB',
    'healthCheck.eventLoopLagThresholdMS',
    'healthCheck.maxActiveSessions',
  ];

  // Critical keys that require application restart
  private static readonly DEFAULT_CRITICAL_KEYS = [
    'server.port',
    'server.host',
    'aws.region',
    'bedrock.region',
    'bedrock.modelId',
    'twilio.authToken',
    'environment.nodeEnv',
    'environment.serviceName',
  ];

  constructor(
    configManager: ConfigurationManager,
    options: Partial<WatcherOptions> = {}
  ) {
    super();
    this.configManager = configManager;
    this.options = {
      pollInterval: options.pollInterval || 30000, // 30 seconds default
      enableFileWatching: options.enableFileWatching ?? false,
      safeReloadKeys: options.safeReloadKeys || ConfigurationWatcher.DEFAULT_SAFE_RELOAD_KEYS,
      criticalKeys: options.criticalKeys || ConfigurationWatcher.DEFAULT_CRITICAL_KEYS,
    };

    this.lastEnvSnapshot = this.captureEnvironmentSnapshot();
  }

  /**
   * Start watching for configuration changes
   */
  public startWatching(): void {
    if (this.isWatching) {
      return;
    }

    this.isWatching = true;
    this.pollTimer = setInterval(() => {
      this.checkForChanges();
    }, this.options.pollInterval);

    this.emit('watchingStarted');
    console.log(`Configuration watcher started with ${this.options.pollInterval}ms poll interval`);
  }

  /**
   * Stop watching for configuration changes
   */
  public stopWatching(): void {
    if (!this.isWatching) {
      return;
    }

    this.isWatching = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    this.emit('watchingStopped');
    console.log('Configuration watcher stopped');
  }

  /**
   * Manually trigger a configuration reload
   */
  public async triggerReload(): Promise<ReloadResult> {
    try {
      const changes = this.detectEnvironmentChanges();
      if (this.hasNoChanges(changes)) {
        return {
          success: true,
          reloadedKeys: [],
          skippedKeys: [],
          errors: [],
          requiresRestart: false,
        };
      }

      return await this.performSafeReload(changes);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        reloadedKeys: [],
        skippedKeys: [],
        errors: [errorMessage],
        requiresRestart: false,
      };
    }
  }

  /**
   * Check if a configuration key is safe to hot-reload
   */
  public isSafeToReload(key: string): boolean {
    return this.options.safeReloadKeys.includes(key);
  }

  /**
   * Check if a configuration key is critical (requires restart)
   */
  public isCritical(key: string): boolean {
    return this.options.criticalKeys.includes(key);
  }

  /**
   * Get current watcher status
   */
  public getStatus(): {
    isWatching: boolean;
    pollInterval: number;
    safeReloadKeys: string[];
    criticalKeys: string[];
  } {
    return {
      isWatching: this.isWatching,
      pollInterval: this.options.pollInterval,
      safeReloadKeys: [...this.options.safeReloadKeys],
      criticalKeys: [...this.options.criticalKeys],
    };
  }

  /**
   * Add a key to the safe reload list
   */
  public addSafeReloadKey(key: string): void {
    if (!this.options.safeReloadKeys.includes(key)) {
      this.options.safeReloadKeys.push(key);
      this.emit('safeReloadKeyAdded', key);
    }
  }

  /**
   * Remove a key from the safe reload list
   */
  public removeSafeReloadKey(key: string): void {
    const index = this.options.safeReloadKeys.indexOf(key);
    if (index !== -1) {
      this.options.safeReloadKeys.splice(index, 1);
      this.emit('safeReloadKeyRemoved', key);
    }
  }

  /**
   * Check for configuration changes
   */
  private async checkForChanges(): Promise<void> {
    try {
      const changes = this.detectEnvironmentChanges();
      if (this.hasNoChanges(changes)) {
        return;
      }

      this.emit('changesDetected', changes);
      
      const reloadResult = await this.performSafeReload(changes);
      
      // Always emit reloadCompleted, even if there were no safe changes
      this.emit('reloadCompleted', reloadResult);

      if (reloadResult.requiresRestart) {
        this.emit('restartRequired', reloadResult);
        console.warn('Configuration changes detected that require application restart:', 
          reloadResult.skippedKeys);
      }

    } catch (error) {
      this.emit('error', error);
      console.error('Error checking for configuration changes:', error);
    }
  }

  /**
   * Capture current environment variable snapshot
   */
  private captureEnvironmentSnapshot(): Record<string, string | undefined> {
    const snapshot: Record<string, string | undefined> = {};
    
    // Capture all environment variables that could affect configuration
    const relevantEnvVars = [
      'LOG_LEVEL', 'ENABLE_STRUCTURED_LOGGING', 'ENABLE_CUSTOM_METRICS',
      'ENABLE_SYSTEM_METRICS', 'METRICS_INTERVAL', 'OTEL_TRACES_SAMPLER_ARG',
      'OTEL_SAMPLE_WEBSOCKET_MESSAGES', 'OTEL_SAMPLE_AUDIO_CHUNKS',
      'OTEL_SAMPLE_BEDROCK_STREAMING', 'OTEL_SAMPLE_HEALTH_CHECKS',
      'OTEL_SAMPLE_ERRORS', 'OTEL_SAMPLE_BEDROCK_REQUESTS',
      'OTEL_SAMPLE_SESSION_LIFECYCLE', 'CLOUDWATCH_BATCH_SIZE',
      'CLOUDWATCH_FLUSH_INTERVAL_MS', 'MEMORY_THRESHOLD_MB',
      'EVENT_LOOP_LAG_THRESHOLD_MS', 'MAX_ACTIVE_SESSIONS',
      // Critical environment variables
      'PORT', 'HOST', 'AWS_REGION', 'BEDROCK_REGION', 'BEDROCK_MODEL_ID',
      'TWILIO_AUTH_TOKEN', 'NODE_ENV', 'OTEL_SERVICE_NAME',
    ];

    for (const envVar of relevantEnvVars) {
      snapshot[envVar] = process.env[envVar];
    }

    return snapshot;
  }

  /**
   * Detect changes in environment variables
   */
  private detectEnvironmentChanges(): ConfigChanges {
    const currentSnapshot = this.captureEnvironmentSnapshot();
    const changes: ConfigChanges = {
      added: {},
      modified: {},
      removed: [],
    };

    // Check for added and modified variables
    for (const [key, currentValue] of Object.entries(currentSnapshot)) {
      const previousValue = this.lastEnvSnapshot[key];
      
      if (previousValue === undefined && currentValue !== undefined) {
        changes.added[key] = currentValue;
      } else if (previousValue !== currentValue) {
        changes.modified[key] = { oldValue: previousValue, newValue: currentValue };
      }
    }

    // Check for removed variables
    for (const key of Object.keys(this.lastEnvSnapshot)) {
      if (!(key in currentSnapshot)) {
        changes.removed.push(key);
      }
    }

    this.lastEnvSnapshot = currentSnapshot;
    return changes;
  }

  /**
   * Check if there are no meaningful changes
   */
  private hasNoChanges(changes: ConfigChanges): boolean {
    return Object.keys(changes.added).length === 0 &&
           Object.keys(changes.modified).length === 0 &&
           changes.removed.length === 0;
  }

  /**
   * Perform safe configuration reload
   */
  private async performSafeReload(changes: ConfigChanges): Promise<ReloadResult> {
    const reloadedKeys: string[] = [];
    const skippedKeys: string[] = [];
    const errors: string[] = [];
    let requiresRestart = false;
    let hasReloaded = false;

    // Process all changes
    const allChangedKeys = [
      ...Object.keys(changes.added),
      ...Object.keys(changes.modified),
      ...changes.removed,
    ];

    // Categorize changes first
    const safeKeys: string[] = [];
    const criticalKeys: string[] = [];

    for (const envKey of allChangedKeys) {
      // Map environment variable to configuration key
      const configKey = this.mapEnvVarToConfigKey(envKey);
      if (!configKey) {
        continue; // Skip unmapped environment variables
      }

      if (this.isCritical(configKey)) {
        criticalKeys.push(configKey);
        skippedKeys.push(configKey);
        requiresRestart = true;
        console.warn(`Critical configuration change detected for '${configKey}', restart required`);
      } else if (this.isSafeToReload(configKey)) {
        safeKeys.push(configKey);
      } else {
        skippedKeys.push(configKey);
        console.warn(`Configuration key '${configKey}' is not marked as safe for hot-reload`);
      }
    }

    // Reload configuration if there are safe changes
    if (safeKeys.length > 0) {
      try {
        await this.configManager.reload();
        reloadedKeys.push(...safeKeys);
        hasReloaded = true;
        console.log(`Successfully reloaded configuration for keys: ${safeKeys.join(', ')}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to reload configuration: ${errorMessage}`);
      }
    }

    return {
      success: errors.length === 0,
      reloadedKeys,
      skippedKeys,
      errors,
      requiresRestart,
    };
  }

  /**
   * Map environment variable name to configuration key
   */
  private mapEnvVarToConfigKey(envVar: string): string | undefined {
    const envVarMappings: Record<string, string> = {
      'LOG_LEVEL': 'logging.level',
      'ENABLE_STRUCTURED_LOGGING': 'logging.enableStructuredLogging',
      'ENABLE_CUSTOM_METRICS': 'metrics.enableCustomMetrics',
      'ENABLE_SYSTEM_METRICS': 'metrics.enableSystemMetrics',
      'METRICS_INTERVAL': 'metrics.metricsInterval',
      'OTEL_TRACES_SAMPLER_ARG': 'tracing.sampleRate',
      'OTEL_SAMPLE_WEBSOCKET_MESSAGES': 'tracing.sampling.websocketMessages',
      'OTEL_SAMPLE_AUDIO_CHUNKS': 'tracing.sampling.audioChunks',
      'OTEL_SAMPLE_BEDROCK_STREAMING': 'tracing.sampling.bedrockStreaming',
      'OTEL_SAMPLE_HEALTH_CHECKS': 'tracing.sampling.healthChecks',
      'OTEL_SAMPLE_ERRORS': 'tracing.sampling.errors',
      'OTEL_SAMPLE_BEDROCK_REQUESTS': 'tracing.sampling.bedrockRequests',
      'OTEL_SAMPLE_SESSION_LIFECYCLE': 'tracing.sampling.sessionLifecycle',
      'CLOUDWATCH_BATCH_SIZE': 'cloudWatch.batching.maxBatchSize',
      'CLOUDWATCH_FLUSH_INTERVAL_MS': 'cloudWatch.batching.flushIntervalMs',
      'MEMORY_THRESHOLD_MB': 'healthCheck.memoryThresholdMB',
      'EVENT_LOOP_LAG_THRESHOLD_MS': 'healthCheck.eventLoopLagThresholdMS',
      'MAX_ACTIVE_SESSIONS': 'healthCheck.maxActiveSessions',
      // Critical mappings
      'PORT': 'server.port',
      'HOST': 'server.host',
      'AWS_REGION': 'aws.region',
      'BEDROCK_REGION': 'bedrock.region',
      'BEDROCK_MODEL_ID': 'bedrock.modelId',
      'TWILIO_AUTH_TOKEN': 'twilio.authToken',
      'NODE_ENV': 'environment.nodeEnv',
      'OTEL_SERVICE_NAME': 'environment.serviceName',
    };

    return envVarMappings[envVar];
  }
}

// Export a default watcher instance
export function createConfigurationWatcher(
  configManager: ConfigurationManager,
  options?: Partial<WatcherOptions>
): ConfigurationWatcher {
  return new ConfigurationWatcher(configManager, options);
}