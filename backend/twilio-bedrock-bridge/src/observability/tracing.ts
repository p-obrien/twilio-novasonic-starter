// Optimized OpenTelemetry initialization with streamlined fallback logic
// The actual instrumentation is loaded via the register module in start.js

import { observabilityConfig } from './config';
import { smartSampler } from './smartSampling';
import { currentEnvironment, otelCapabilities } from '../utils/environment';
import { fargateXRayTracer } from './xrayTracing';
import logger from './logger';

// Simplified tracing state management
interface TracingState {
  readonly initialized: boolean;
  readonly fallbackMode: boolean;
  readonly error: Error | null;
  readonly initializationTime: number;
  readonly tracingMethod: 'otel' | 'xray' | 'none';
}

let tracingState: TracingState = {
  initialized: false,
  fallbackMode: false,
  error: null,
  initializationTime: 0,
  tracingMethod: 'none'
};

// Streamlined initialization with optimized error handling
export function initializeTracing(): void {
  const startTime = performance.now();
  
  try {
    // Fast path: Check if fallback mode should be used immediately
    if (shouldUseFallbackMode()) {
      initializeFallbackMode('Environment configuration requires fallback mode');
      return;
    }

    // Optimized OTEL initialization
    const config = createTracingConfiguration();
    
    // Test OTEL availability with minimal overhead
    if (validateOtelFunctionality()) {
      updateTracingState({
        initialized: true,
        fallbackMode: false,
        error: null,
        initializationTime: performance.now() - startTime,
        tracingMethod: 'otel'
      });
      
      logger.info('OTEL tracing initialized', {
        component: 'tracing',
        initTimeMs: Math.round(tracingState.initializationTime),
        service: config.serviceName,
        environment: config.environment,
        samplingRate: config.samplingConfig.globalSampleRate
      });
    } else {
      throw new Error('OTEL functionality validation failed');
    }
    
  } catch (error) {
    handleInitializationError(error, performance.now() - startTime);
  }
}

// Optimized fallback mode detection
function shouldUseFallbackMode(): boolean {
  // Fast boolean checks first (most performant)
  if (!observabilityConfig.tracing.enableOTLP) return true;
  if (process.env.OTEL_STARTUP_FAILED === 'true') return true;
  if (otelCapabilities.recommendsFallback) return true;
  
  return false;
}

// Streamlined tracing configuration creation
function createTracingConfiguration() {
  const samplingConfig = smartSampler.getSamplingConfig();
  
  return {
    serviceName: observabilityConfig.serviceName,
    serviceVersion: observabilityConfig.serviceVersion,
    environment: observabilityConfig.environment,
    platform: currentEnvironment.platform,
    region: currentEnvironment.region || 'us-east-1',
    samplingConfig
  };
}

// Optimized OTEL functionality validation with minimal overhead
function validateOtelFunctionality(): boolean {
  try {
    // Lazy load OTEL API only when needed
    const { trace } = require('@opentelemetry/api');
    
    // Minimal validation - just check if we can get a tracer
    const testTracer = trace.getTracer('init-test', '1.0.0');
    if (!testTracer) return false;
    
    // Quick span test without attributes to minimize overhead
    const span = testTracer.startSpan('validation');
    span.end();
    
    return true;
  } catch (error) {
    // Log at debug level to avoid noise during normal fallback scenarios
    logger.debug('OTEL validation failed', { 
      error: error instanceof Error ? error.message : String(error),
      component: 'tracing'
    });
    return false;
  }
}

// Streamlined error handling with optimized fallback logic
function handleInitializationError(error: unknown, initTime: number): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorCategory = categorizeTracingError(errorMessage);
  
  updateTracingState({
    initialized: false,
    fallbackMode: true,
    error: error instanceof Error ? error : new Error(errorMessage),
    initializationTime: initTime,
    tracingMethod: 'none' // Will be updated if X-Ray succeeds
  });
  
  logger.warn('OTEL initialization failed, activating fallback mode', {
    component: 'tracing',
    error: errorMessage,
    category: errorCategory,
    initTimeMs: Math.round(initTime)
  });
  
  initializeFallbackMode(errorCategory);
}

// Optimized error categorization for better diagnostics
function categorizeTracingError(errorMessage: string): string {
  // Use includes() for faster string matching than regex
  if (errorMessage.includes('machine-id') || errorMessage.includes('/var/lib/dbus')) {
    return 'container_environment';
  }
  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('network') || errorMessage.includes('timeout')) {
    return 'network_issue';
  }
  if (errorMessage.includes('permission') || errorMessage.includes('EACCES')) {
    return 'permission_denied';
  }
  if (errorMessage.includes('module') || errorMessage.includes('require')) {
    return 'module_loading';
  }
  return 'unknown';
}

// Optimized fallback mode initialization
function initializeFallbackMode(errorCategory: string): void {
  logger.info('Activating fallback tracing mode', {
    component: 'tracing',
    reason: errorCategory,
    xrayEnabled: otelCapabilities.shouldUseXRayForTracing
  });
  
  // Try X-Ray initialization if environment supports it
  if (otelCapabilities.shouldUseXRayForTracing) {
    try {
      fargateXRayTracer.initialize();
      
      updateTracingState({
        ...tracingState,
        tracingMethod: 'xray'
      });
      
      logger.info('X-Ray fallback tracing activated');
    } catch (xrayError) {
      logger.warn('X-Ray fallback failed, using correlation-only mode', {
        error: xrayError instanceof Error ? xrayError.message : String(xrayError),
        component: 'tracing'
      });
    }
  }
}

// Helper function to update tracing state immutably
function updateTracingState(newState: TracingState): void {
  tracingState = { ...newState };
}

// Optimized tracing status checks
export function isOtelAvailable(): boolean {
    return tracingState.initialized && !tracingState.fallbackMode && tracingState.tracingMethod === 'otel';
}

export function getOtelError(): Error | null {
    return tracingState.error;
}

export function isFallbackMode(): boolean {
    return tracingState.fallbackMode;
}

// Optimized fallback mode activation
export function enableFallbackMode(reason?: string): void {
    updateTracingState({
        ...tracingState,
        fallbackMode: true,
        tracingMethod: fargateXRayTracer.isActive() ? 'xray' : 'none'
    });
    
    logger.warn('OTEL fallback mode activated', { 
        reason: reason || 'manual_activation',
        component: 'tracing'
    });
}

// Streamlined tracing availability check
export function isTracingAvailable(): boolean {
    return tracingState.tracingMethod !== 'none';
}

// Optimized active tracer detection
export function getActiveTracer(): 'otel' | 'xray' | 'none' {
    return tracingState.tracingMethod;
}

// Optimized graceful shutdown
export async function shutdownTracing(): Promise<void> {
    try {
        const activeTracer = tracingState.tracingMethod;
        
        if (activeTracer === 'otel') {
            // AWS Distro handles shutdown automatically
            logger.info('OTEL tracing shutdown initiated', { component: 'tracing' });
        } else if (activeTracer === 'xray') {
            fargateXRayTracer.shutdown();
            logger.info('X-Ray tracing shutdown completed', { component: 'tracing' });
        }
        
        // Reset tracing state
        updateTracingState({
            initialized: false,
            fallbackMode: false,
            error: null,
            initializationTime: 0,
            tracingMethod: 'none'
        });
        
    } catch (error) {
        // Non-critical error during shutdown - log but don't throw
        logger.warn('Error during tracing shutdown', {
            error: error instanceof Error ? error.message : String(error),
            component: 'tracing'
        });
    }
}

// Streamlined SDK compatibility layer
export const sdk = {
    start: () => logger.debug('AWS Distro SDK start called', { component: 'tracing' }),
    shutdown: () => {
        logger.debug('AWS Distro SDK shutdown called', { component: 'tracing' });
        return Promise.resolve();
    }
};