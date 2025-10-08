/**
 * Centralized Configuration Manager
 * Consolidates all configuration management into a single, validated system
 */

import { EventEmitter } from 'events';
import { 
  IConfigurationManager, 
  ValidationResult, 
  ConfigChanges, 
  ConfigChangeCallback,
  HotReloadResult
} from './IConfigurationManager';
import { 
  UnifiedConfig, 
  DEFAULT_CONFIG,
  ServerConfig,
  AWSConfig,
  BedrockConfig,
  TwilioConfig,
  LoggingConfig,
  MetricsConfig,
  TracingConfig,
  CloudWatchConfig,
  HealthCheckConfig,
  EnvironmentConfig
} from './ConfigurationTypes';
import { CONFIG_SCHEMA, getRequiredConfigKeys, getConfigKeyFromEnvVar } from './ConfigurationSchema';
import { detectEnvironment, getOTELCapabilities } from '../utils/environment';
import { DefaultInferenceConfiguration } from '../utils/constants';

/**
 * Test-friendly default values for required configuration
 * Used when running in test environment or when required values are missing
 */
const TEST_DEFAULTS: Record<string, any> = {
  'twilio.authToken': 'test-auth-token-123456789abcdef0123456789abcdef01',
  'twilio.accountSid': 'ACtest123456789abcdef0123456789abcdef',
  'server.port': 8080,
  'aws.region': 'us-east-1',
  'bedrock.region': 'us-east-1',
  'bedrock.modelId': 'amazon.nova-sonic-v1:0',
  'logging.level': 'ERROR', // Reduce noise in tests
  'environment.nodeEnv': 'test',
  'environment.serviceName': 'twilio-bedrock-bridge-test',
  'environment.serviceVersion': '0.1.0-test',
  'metrics.enableCustomMetrics': false, // Disable metrics in tests
  'metrics.enableSystemMetrics': false,
  'tracing.enableXRay': false, // Disable tracing in tests
  'tracing.enableOTLP': false,
  'cloudWatch.enabled': false, // Disable CloudWatch in tests
};

export class ConfigurationManager extends EventEmitter implements IConfigurationManager {
  private static instance: ConfigurationManager;
  private config: UnifiedConfig;
  private changeCallbacks: Set<ConfigChangeCallback> = new Set();
  private isInitialized = false;

  private constructor() {
    super();
    // Don't load configuration in constructor - wait for initialize()
    this.config = {} as UnifiedConfig;
    this.isInitialized = false;
  }

  /**
   * Check if the configuration manager has been initialized
   */
  public get initialized(): boolean {
    return this.isInitialized;
  }

  public static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
      // Perform synchronous initialization immediately so callers receive a
      // fully-initialized manager (and validation errors) when they obtain the singleton.
      ConfigurationManager.instance.initializeSync();
    }
    return ConfigurationManager.instance;
  }

  /**
   * Initialize the configuration manager
   * Loads configuration from environment variables and validates it
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return; // Already initialized
    }

    try {
      // Load configuration from environment
      this.config = this.loadConfiguration();
      
      // Validate configuration
      const validation = this.validate();
      if (!validation.isValid) {
        const errorMessage = `Configuration validation failed: ${validation.errors.join(', ')}`;
        throw new Error(errorMessage);
      }

      // Log warnings if any
      if (validation.warnings.length > 0) {
        console.warn('Configuration warnings:', validation.warnings.join(', '));
      }

      this.isInitialized = true;
      
      // Emit initialization complete event
      this.emit('initialized', this.config);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
      this.emit('initializationError', error);
      throw new Error(`Failed to initialize ConfigurationManager: ${errorMessage}`);
    }
  }

  /**
   * Synchronous initialization for backward compatibility
   * Loads configuration from environment variables and validates it
   */
  public initializeSync(): void {
    if (this.isInitialized) {
      return; // Already initialized
    }
  
    // Load configuration from environment
    this.config = this.loadConfiguration();
    
    // Validate configuration
    const validation = this.validate();
    if (!validation.isValid) {
      const errorMessage = `Configuration validation failed: ${validation.errors.join(', ')}`;
      // In synchronous initialization (used heavily in tests and legacy code paths)
      // surface validation errors immediately to fail fast. Tests expect missing
      // required environment variables to throw during getInstance()/initialization.
      throw new Error(errorMessage);
    }
  
    // Log warnings if any
    if (validation.warnings.length > 0) {
      console.warn('Configuration warnings:', validation.warnings.join(', '));
    }
  
    this.isInitialized = true;
    
    // Emit initialization complete event
    this.emit('initialized', this.config);
  }

  /**
   * Load configuration from environment variables and defaults
   */
  private loadConfiguration(): UnifiedConfig {
    const env = detectEnvironment();
    const otelCapabilities = getOTELCapabilities();
    const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

    // Start with default configuration
    const config: UnifiedConfig = {
      server: this.loadServerConfig(),
      aws: this.loadAWSConfig(),
      bedrock: this.loadBedrockConfig(),
      twilio: this.loadTwilioConfig(),
      logging: this.loadLoggingConfig(),
      metrics: this.loadMetricsConfig(),
      tracing: this.loadTracingConfig(otelCapabilities),
      cloudWatch: this.loadCloudWatchConfig(otelCapabilities),
      healthCheck: this.loadHealthCheckConfig(),
      environment: this.loadEnvironmentConfig(env),
      inference: this.loadInferenceConfig(),
    };

    // Apply test defaults if in test environment
    if (isTestEnv) {
      this.applyTestDefaults(config);
    }

    return config;
  }

  /**
   * Apply test-friendly defaults to configuration
   */
  private applyTestDefaults(config: UnifiedConfig): void {
    for (const [key, defaultValue] of Object.entries(TEST_DEFAULTS)) {
      const currentValue = this.getNestedValue(config, key);
      if (currentValue === undefined || currentValue === null) {
        this.setNestedValue(config, key, defaultValue);
      }
    }
  }

  private loadServerConfig(): ServerConfig {
    return {
      port: this.parseNumber(process.env.PORT, DEFAULT_CONFIG.server!.port),
      host: process.env.HOST,
      timeout: this.parseNumber(process.env.REQUEST_TIMEOUT, DEFAULT_CONFIG.server!.timeout),
      maxConcurrentStreams: this.parseNumber(process.env.MAX_CONCURRENT_STREAMS, DEFAULT_CONFIG.server!.maxConcurrentStreams),
      disableConcurrentStreams: this.parseBoolean(process.env.DISABLE_CONCURRENT_STREAMS, DEFAULT_CONFIG.server!.disableConcurrentStreams),
    };
  }

  private loadAWSConfig(): AWSConfig {
    return {
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || DEFAULT_CONFIG.aws!.region,
      profileName: process.env.AWS_PROFILE_NAME,
      availabilityZone: process.env.AWS_AVAILABILITY_ZONE || process.env.AWS_AZ,
    };
  }

  private loadBedrockConfig(): BedrockConfig {
    const awsRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || DEFAULT_CONFIG.aws!.region;
    return {
      region: process.env.BEDROCK_REGION || awsRegion,
      modelId: process.env.BEDROCK_MODEL_ID || DEFAULT_CONFIG.bedrock!.modelId,
      requestTimeout: this.parseNumber(process.env.BEDROCK_REQUEST_TIMEOUT, DEFAULT_CONFIG.bedrock!.requestTimeout),
      sessionTimeout: this.parseNumber(process.env.BEDROCK_SESSION_TIMEOUT, DEFAULT_CONFIG.bedrock!.sessionTimeout),
      maxAudioQueueSize: this.parseNumber(process.env.MAX_AUDIO_QUEUE_SIZE, DEFAULT_CONFIG.bedrock!.maxAudioQueueSize),
      maxChunksPerBatch: this.parseNumber(process.env.MAX_CHUNKS_PER_BATCH, DEFAULT_CONFIG.bedrock!.maxChunksPerBatch),
      defaultAckTimeout: this.parseNumber(process.env.DEFAULT_ACK_TIMEOUT, DEFAULT_CONFIG.bedrock!.defaultAckTimeout),
    };
  }

  private loadTwilioConfig(): TwilioConfig {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
    
    // Use test default if in test environment and no auth token provided
    if (!authToken && isTestEnv) {
      return {
        authToken: TEST_DEFAULTS['twilio.authToken'],
        accountSid: TEST_DEFAULTS['twilio.accountSid'],
        publicWsHost: process.env.PUBLIC_WS_HOST,
        forceWsProto: process.env.FORCE_WS_PROTO,
      };
    }
    
    if (!authToken) {
      throw new Error('TWILIO_AUTH_TOKEN environment variable is required');
    }

    return {
      authToken: authToken.trim().replace(/^"(.*)"$/, '$1'),
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      publicWsHost: process.env.PUBLIC_WS_HOST,
      forceWsProto: process.env.FORCE_WS_PROTO,
    };
  }

  private loadLoggingConfig(): LoggingConfig {
    const nodeEnv = process.env.NODE_ENV || 'development';
    return {
      level: (process.env.LOG_LEVEL as LoggingConfig['level']) || DEFAULT_CONFIG.logging!.level,
      enableStructuredLogging: this.parseBoolean(process.env.ENABLE_STRUCTURED_LOGGING, nodeEnv === 'production'),
      enableTraceCorrelation: this.parseBoolean(process.env.ENABLE_TRACE_CORRELATION, DEFAULT_CONFIG.logging!.enableTraceCorrelation),
      maxLogContentLength: this.parseNumber(process.env.MAX_LOG_CONTENT_LENGTH, DEFAULT_CONFIG.logging!.maxLogContentLength),
    };
  }

  private loadMetricsConfig(): MetricsConfig {
    return {
      enableCustomMetrics: this.parseBoolean(process.env.ENABLE_CUSTOM_METRICS, DEFAULT_CONFIG.metrics!.enableCustomMetrics),
      enableSystemMetrics: this.parseBoolean(process.env.ENABLE_SYSTEM_METRICS, DEFAULT_CONFIG.metrics!.enableSystemMetrics),
      metricsInterval: this.parseNumber(process.env.METRICS_INTERVAL, DEFAULT_CONFIG.metrics!.metricsInterval),
      maxTrackedConnections: this.parseNumber(process.env.MAX_TRACKED_CONNECTIONS, DEFAULT_CONFIG.metrics!.maxTrackedConnections),
      maxTrackedSessions: this.parseNumber(process.env.MAX_TRACKED_SESSIONS, DEFAULT_CONFIG.metrics!.maxTrackedSessions),
    };
  }

  private loadTracingConfig(otelCapabilities: any): TracingConfig {
    return {
      enableXRay: this.parseBoolean(process.env.ENABLE_XRAY, DEFAULT_CONFIG.tracing!.enableXRay),
      enableOTLP: this.parseBoolean(process.env.ENABLE_OTLP, !otelCapabilities.shouldSkipOTEL),
      otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      sampleRate: this.parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG, DEFAULT_CONFIG.tracing!.sampleRate),
      sampling: {
        websocketMessages: this.parseFloat(process.env.OTEL_SAMPLE_WEBSOCKET_MESSAGES, DEFAULT_CONFIG.tracing!.sampling.websocketMessages),
        audioChunks: this.parseFloat(process.env.OTEL_SAMPLE_AUDIO_CHUNKS, DEFAULT_CONFIG.tracing!.sampling.audioChunks),
        bedrockStreaming: this.parseFloat(process.env.OTEL_SAMPLE_BEDROCK_STREAMING, DEFAULT_CONFIG.tracing!.sampling.bedrockStreaming),
        healthChecks: this.parseFloat(process.env.OTEL_SAMPLE_HEALTH_CHECKS, DEFAULT_CONFIG.tracing!.sampling.healthChecks),
        errors: this.parseFloat(process.env.OTEL_SAMPLE_ERRORS, DEFAULT_CONFIG.tracing!.sampling.errors),
        bedrockRequests: this.parseFloat(process.env.OTEL_SAMPLE_BEDROCK_REQUESTS, DEFAULT_CONFIG.tracing!.sampling.bedrockRequests),
        sessionLifecycle: this.parseFloat(process.env.OTEL_SAMPLE_SESSION_LIFECYCLE, DEFAULT_CONFIG.tracing!.sampling.sessionLifecycle),
        customRules: DEFAULT_CONFIG.tracing!.sampling.customRules,
      },
    };
  }

  private loadCloudWatchConfig(otelCapabilities: any): CloudWatchConfig {
    const awsRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || DEFAULT_CONFIG.aws!.region;
    return {
      enabled: this.parseBoolean(process.env.CLOUDWATCH_ENABLED, DEFAULT_CONFIG.cloudWatch!.enabled || otelCapabilities.shouldSkipOTEL),
      region: process.env.CLOUDWATCH_REGION || awsRegion,
      namespace: process.env.CLOUDWATCH_NAMESPACE || DEFAULT_CONFIG.cloudWatch!.namespace,
      batching: {
        enabled: this.parseBoolean(process.env.CLOUDWATCH_BATCHING_ENABLED, DEFAULT_CONFIG.cloudWatch!.batching.enabled),
        maxBatchSize: this.parseNumber(process.env.CLOUDWATCH_BATCH_SIZE, otelCapabilities.shouldSkipOTEL ? 50 : DEFAULT_CONFIG.cloudWatch!.batching.maxBatchSize),
        flushIntervalMs: this.parseNumber(process.env.CLOUDWATCH_FLUSH_INTERVAL_MS, otelCapabilities.shouldSkipOTEL ? 15000 : DEFAULT_CONFIG.cloudWatch!.batching.flushIntervalMs),
        maxRetries: this.parseNumber(process.env.CLOUDWATCH_MAX_RETRIES, DEFAULT_CONFIG.cloudWatch!.batching.maxRetries),
        retryDelayMs: this.parseNumber(process.env.CLOUDWATCH_RETRY_DELAY_MS, DEFAULT_CONFIG.cloudWatch!.batching.retryDelayMs),
      },
    };
  }

  private loadHealthCheckConfig(): HealthCheckConfig {
    return {
      memoryThresholdMB: this.parseNumber(process.env.MEMORY_THRESHOLD_MB, DEFAULT_CONFIG.healthCheck!.memoryThresholdMB),
      eventLoopLagThresholdMS: this.parseNumber(process.env.EVENT_LOOP_LAG_THRESHOLD_MS, DEFAULT_CONFIG.healthCheck!.eventLoopLagThresholdMS),
      maxActiveSessions: this.parseNumber(process.env.MAX_ACTIVE_SESSIONS, DEFAULT_CONFIG.healthCheck!.maxActiveSessions),
      staleSessionTimeoutMS: this.parseNumber(process.env.STALE_SESSION_TIMEOUT_MS, DEFAULT_CONFIG.healthCheck!.staleSessionTimeoutMS),
    };
  }

  private loadEnvironmentConfig(env: any): EnvironmentConfig {
    return {
      nodeEnv: (process.env.NODE_ENV as EnvironmentConfig['nodeEnv']) || DEFAULT_CONFIG.environment!.nodeEnv,
      serviceName: process.env.OTEL_SERVICE_NAME || DEFAULT_CONFIG.environment!.serviceName,
      serviceVersion: process.env.OTEL_SERVICE_VERSION || DEFAULT_CONFIG.environment!.serviceVersion,
      isECS: env.isECS,
      isFargate: env.isFargate,
      isKubernetes: env.isKubernetes,
      isEKS: env.isEKS,
      isLocal: env.isLocal,
      platform: env.platform,
      namespace: env.namespace,
      podName: env.podName,
      clusterName: env.clusterName,
    };
  }

  private loadInferenceConfig() {
    return {
      maxTokens: this.parseNumber(process.env.MAX_TOKENS, DefaultInferenceConfiguration.maxTokens),
      topP: this.parseFloat(process.env.TOP_P, DefaultInferenceConfiguration.topP),
      temperature: this.parseFloat(process.env.TEMPERATURE, DefaultInferenceConfiguration.temperature),
    };
  }

  // Utility parsing methods
  private parseNumber(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  private parseFloat(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  private parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (!value) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
  }

  // IConfigurationManager implementation
  public get<T = any>(key: string): T | undefined {
    if (!this.isInitialized) {
      // Auto-initialize for backward compatibility
      this.config = this.loadConfiguration();
      this.isInitialized = true;
    }
    return this.getNestedValue(this.config, key) as T;
  }

  public getRequired<T = any>(key: string): T {
    const value = this.get<T>(key);
    if (value === undefined || value === null) {
      throw new Error(`Required configuration key '${key}' is not set`);
    }
    return value;
  }

  public getAll(): Record<string, any> {
    if (!this.isInitialized) {
      // Auto-initialize for backward compatibility
      this.config = this.loadConfiguration();
      this.isInitialized = true;
    }
    return JSON.parse(JSON.stringify(this.config));
  }

  public validate(): ValidationResult {
    if (!this.isInitialized && Object.keys(this.config).length === 0) {
      // Allow validation during initialization
      const tempConfig = this.loadConfiguration();
      return this.validateConfig(tempConfig);
    }
    return this.validateConfig(this.config);
  }

  private validateConfig(config: UnifiedConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

    // Validate required keys
    const requiredKeys = getRequiredConfigKeys();
    for (const key of requiredKeys) {
      let value = this.getNestedValue(config, key);
      
      // Use test defaults for missing required values in test environment
      if ((value === undefined || value === null || value === '') && isTestEnv && TEST_DEFAULTS[key]) {
        value = TEST_DEFAULTS[key];
        this.setNestedValue(config, key, value);
        warnings.push(`Using test default for required key '${key}'`);
      }
      
      if (value === undefined || value === null || value === '') {
        errors.push(`Required configuration key '${key}' is missing`);
      }
    }

    // Validate all configured values against schema
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
      const value = this.getNestedValue(config, key);
      
      if (value !== undefined && value !== null) {
        // Type validation
        if (!this.validateType(value, schema.type)) {
          errors.push(`Configuration key '${key}' has invalid type. Expected ${schema.type}, got ${typeof value}`);
        }

        // Custom validation
        if (schema.validation) {
          try {
            if (!schema.validation(value)) {
              errors.push(`Configuration key '${key}' failed validation: ${schema.description}`);
            }
          } catch (error) {
            errors.push(`Configuration key '${key}' validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }
    }

    // Environment-specific warnings
    if (config.environment.isFargate && config.tracing.enableOTLP) {
      warnings.push('OTLP tracing may have issues in Fargate environment. Consider using X-Ray only.');
    }

    if (config.environment.nodeEnv === 'production' && config.logging.level === 'DEBUG') {
      warnings.push('DEBUG logging level in production may impact performance');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  public async reload(): Promise<void> {
    const oldConfig = JSON.parse(JSON.stringify(this.config));
    this.config = this.loadConfiguration();
    
    const changes = this.detectChanges(oldConfig, this.config);
    if (Object.keys(changes.added).length > 0 || 
        Object.keys(changes.modified).length > 0 || 
        changes.removed.length > 0) {
      
      this.notifyChanges(changes);
      this.emit('configChanged', changes);
    }
  }

  public onChange(callback: ConfigChangeCallback): void {
    this.changeCallbacks.add(callback);
  }

  public offChange(callback: ConfigChangeCallback): void {
    this.changeCallbacks.delete(callback);
  }

  public has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  public getTyped<T>(key: string, defaultValue?: T): T {
    const value = this.get<T>(key);
    return value !== undefined ? value : (defaultValue as T);
  }

  public set(key: string, value: any): void {
    const oldValue = this.get(key);
    this.setNestedValue(this.config, key, value);
    
    if (this.isInitialized && !this.deepEqual(oldValue, value)) {
      const changes: ConfigChanges = {
        added: oldValue === undefined ? { [key]: value } : {},
        modified: oldValue !== undefined ? { [key]: { oldValue, newValue: value } } : {},
        removed: [],
      };
      
      this.notifyChanges(changes);
      this.emit('configChanged', changes);
    }
  }

  public getSchema(): Record<string, any> {
    return CONFIG_SCHEMA;
  }

  // Utility methods
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((current, key) => {
      if (!(key in current)) {
        current[key] = {};
      }
      return current[key];
    }, obj);
    target[lastKey] = value;
  }

  private validateType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return true;
    }
  }

  private detectChanges(oldConfig: any, newConfig: any): ConfigChanges {
    const changes: ConfigChanges = {
      added: {},
      modified: {},
      removed: [],
    };

    const allKeys = new Set([
      ...this.getAllKeys(oldConfig),
      ...this.getAllKeys(newConfig),
    ]);

    for (const key of allKeys) {
      const oldValue = this.getNestedValue(oldConfig, key);
      const newValue = this.getNestedValue(newConfig, key);

      if (oldValue === undefined && newValue !== undefined) {
        changes.added[key] = newValue;
      } else if (oldValue !== undefined && newValue === undefined) {
        changes.removed.push(key);
      } else if (!this.deepEqual(oldValue, newValue)) {
        changes.modified[key] = { oldValue, newValue };
      }
    }

    return changes;
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;
    
    if (typeof a === 'object') {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      
      if (keysA.length !== keysB.length) return false;
      
      for (const key of keysA) {
        if (!keysB.includes(key)) return false;
        if (!this.deepEqual(a[key], b[key])) return false;
      }
      
      return true;
    }
    
    return false;
  }

  private getAllKeys(obj: any, prefix = ''): string[] {
    const keys: string[] = [];
    
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        keys.push(...this.getAllKeys(value, fullKey));
      } else {
        keys.push(fullKey);
      }
    }
    
    return keys;
  }

  private notifyChanges(changes: ConfigChanges): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(changes);
      } catch (error) {
        console.error('Error in configuration change callback:', error);
      }
    }
  }

  /**
   * Enable hot-reload functionality
   */
  public enableHotReload(options?: {
    pollInterval?: number;
    safeReloadKeys?: string[];
    criticalKeys?: string[];
    enabled?: boolean;
  }): void {
    const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
    
    // Import ConfigurationWatcher dynamically to avoid circular dependency
    const { createConfigurationWatcher } = require('./ConfigurationWatcher');
    
    if (!this.watcher) {
      // Use test-safe options in test environment
      const watcherOptions = isTestEnv ? {
        ...options,
        // Respect explicit pollInterval from tests, otherwise use safe default
        pollInterval: options?.pollInterval !== undefined ? options.pollInterval : 60000,
      } : options;

      this.watcher = createConfigurationWatcher(this, watcherOptions);
      
      // Set up event listeners
      this.watcher.on('changesDetected', (changes: ConfigChanges) => {
        this.emit('hotReloadChangesDetected', changes);
      });
      
      this.watcher.on('reloadCompleted', (result: any) => {
        this.emit('hotReloadCompleted', result);
      });
      
      this.watcher.on('restartRequired', (result: any) => {
        this.emit('hotReloadRestartRequired', result);
      });
      
      this.watcher.on('error', (error: Error) => {
        this.emit('hotReloadError', error);
      });
      
      this.watcher.startWatching();
      this.emit('hotReloadEnabled');
      console.log(`Hot-reload functionality enabled${isTestEnv ? ' (test mode)' : ''}`);
    }
  }

  /**
   * Disable hot-reload functionality
   */
  public disableHotReload(): void {
    if (this.watcher) {
      this.watcher.stopWatching();
      this.watcher.removeAllListeners();
      this.watcher = undefined;
      console.log('Hot-reload functionality disabled');
    }
  }

  /**
   * Check if hot-reload is enabled
   */
  public isHotReloadEnabled(): boolean {
    return !!this.watcher;
  }

  /**
   * Manually trigger a hot-reload
   */
  public async triggerHotReload(): Promise<HotReloadResult> {
    const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
    
    if (!this.watcher) {
      if (isTestEnv) {
        // In test environment, provide a synchronous reload without watcher
        try {
          const oldConfig = JSON.parse(JSON.stringify(this.config));
          await this.reload();
          const changes = this.detectChanges(oldConfig, this.config);
          
          // Extract the actual changed keys
          const reloadedKeys = [
            ...Object.keys(changes.added),
            ...Object.keys(changes.modified),
            ...changes.removed,
          ];
          
          return {
            success: true,
            reloadedKeys,
            errors: [],
          };
        } catch (error) {
          return {
            success: false,
            reloadedKeys: [],
            errors: [error instanceof Error ? error.message : 'Unknown error'],
          };
        }
      }
      throw new Error('Hot-reload is not enabled. Call enableHotReload() first.');
    }
    
    const result = await this.watcher.triggerReload();
    return {
      success: result.success,
      reloadedKeys: result.reloadedKeys,
      errors: result.errors,
    };
  }

  /**
   * Get hot-reload status
   */
  public getHotReloadStatus(): any {
    const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
    
    if (!this.watcher) {
      return { 
        enabled: false,
        testMode: isTestEnv,
        reason: isTestEnv ? 'Disabled in test environment' : 'Not enabled'
      };
    }
    
    return {
      enabled: true,
      testMode: isTestEnv,
      ...this.watcher.getStatus(),
    };
  }

  // Private property for watcher
  private watcher?: any;

  // Convenience getters for backward compatibility
  public get server() { return this.config.server; }
  public get aws() { return this.config.aws; }
  public get bedrock() { return this.config.bedrock; }
  public get twilio() { return this.config.twilio; }
  public get logging() { return this.config.logging; }
  public get metrics() { return this.config.metrics; }
  public get tracing() { return this.config.tracing; }
  public get cloudWatch() { return this.config.cloudWatch; }
  public get healthCheck() { return this.config.healthCheck; }
  public get environment() { return this.config.environment; }
  public get inference() { return this.config.inference; }
}

// Export singleton instance
export const configManager = ConfigurationManager.getInstance();
export default configManager;