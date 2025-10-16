/**
 * AWS X-Ray Tracing for Fargate
 * 
 * Provides distributed tracing using AWS X-Ray in direct mode,
 * optimized for ECS Fargate environments where OTEL has limitations.
 */

// Lazy load heavy dependencies
class LazyXRayTracer {
  private _xray: typeof import('aws-xray-sdk-core') | null = null;
  
  private get xray(): typeof import('aws-xray-sdk-core') {
    if (!this._xray) {
      try {
        this._xray = require('aws-xray-sdk-core');
      } catch (error) {
        throw new Error(`Failed to load AWS X-Ray SDK: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return this._xray!;
  }
  
  // Expose X-Ray functionality through the lazy loader
  public get AWSXRay(): typeof import('aws-xray-sdk-core') {
    return this.xray;
  }
}

const lazyXRay = new LazyXRayTracer();

import { currentEnvironment, otelCapabilities } from '../utils/environment';
import { observabilityConfig } from './config';
import logger from './logger';

export interface XRayTraceContext {
  traceId: string;
  segmentId: string;
  parentId?: string;
}

export class FargateXRayTracer {
  private static instance: FargateXRayTracer;
  private isInitialized = false;
  private isEnabled = false;

  private constructor() {}

  public static getInstance(): FargateXRayTracer {
    if (!FargateXRayTracer.instance) {
      FargateXRayTracer.instance = new FargateXRayTracer();
    }
    return FargateXRayTracer.instance;
  }

  /**
   * Initialize X-Ray for Fargate environment
   */
  public initialize(): void {
    if (this.isInitialized) return;

    try {
      // Only enable X-Ray if tracing is enabled and we're in an AWS environment
      this.isEnabled = !!(observabilityConfig.tracing.enableXRay && 
                      (currentEnvironment.isECS || currentEnvironment.isEKS || 
                       process.env.AWS_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME));

      if (!this.isEnabled) {
        logger.info('X-Ray tracing disabled', {
          enableXRay: observabilityConfig.tracing.enableXRay,
          isAWSEnvironment: !!(currentEnvironment.isECS || currentEnvironment.isEKS || process.env.AWS_REGION)
        });
        this.isInitialized = true;
        return;
      }

      // Configure X-Ray for Fargate
      if (otelCapabilities.requiresXRayDirectMode) {
        // Fargate: Use direct mode (no daemon)
        lazyXRay.AWSXRay.config([
          lazyXRay.AWSXRay.plugins.ECSPlugin, // ECS metadata
          lazyXRay.AWSXRay.plugins.EC2Plugin  // EC2 metadata (limited in Fargate)
        ]);

        // Disable daemon mode
        process.env._X_AMZN_TRACE_ID = process.env._X_AMZN_TRACE_ID || '';
        
        logger.info('X-Ray initialized in direct mode for Fargate', {
          platform: currentEnvironment.platform,
          region: currentEnvironment.region
        });
      } else {
        // EC2/EKS: Can use daemon mode
        lazyXRay.AWSXRay.config([
          lazyXRay.AWSXRay.plugins.ECSPlugin,
          lazyXRay.AWSXRay.plugins.EC2Plugin
        ]);

        logger.info('X-Ray initialized with daemon support', {
          platform: currentEnvironment.platform,
          region: currentEnvironment.region
        });
      }

      // Set sampling rules for high-volume operations
      lazyXRay.AWSXRay.middleware.setSamplingRules({
        version: 2,
        default: {
          fixed_target: 1,
          rate: observabilityConfig.tracing.sampleRate
        },
        rules: [
          {
            description: "Audio processing - low sampling",
            service_name: observabilityConfig.serviceName,
            http_method: "*",
            url_path: "/media*",
            fixed_target: 0,
            rate: observabilityConfig.tracing.sampling.audioChunks
          },
          {
            description: "Webhook handling - medium sampling", 
            service_name: observabilityConfig.serviceName,
            http_method: "POST",
            url_path: "/webhook*",
            fixed_target: 1,
            rate: observabilityConfig.tracing.sampling.customRules.find(r => r.operationName === 'webhook.handle')?.sampleRate || 0.3
          },
          {
            description: "Bedrock requests - high sampling",
            service_name: observabilityConfig.serviceName,
            http_method: "*", 
            url_path: "*bedrock*",
            fixed_target: 2,
            rate: observabilityConfig.tracing.sampling.bedrockRequests
          },
          {
            description: "Errors - always sample",
            service_name: observabilityConfig.serviceName,
            http_method: "*",
            url_path: "*",
            fixed_target: 1,
            rate: observabilityConfig.tracing.sampling.errors
          }
        ]
      });

      this.isInitialized = true;
      logger.info('X-Ray tracing initialized successfully', {
        serviceName: observabilityConfig.serviceName,
        environment: observabilityConfig.environment,
        sampleRate: observabilityConfig.tracing.sampleRate,
        directMode: otelCapabilities.requiresXRayDirectMode
      });

    } catch (error) {
      logger.error('Failed to initialize X-Ray tracing', {
        error: error instanceof Error ? error.message : String(error),
        platform: currentEnvironment.platform
      });
      this.isEnabled = false;
      this.isInitialized = true;
    }
  }

  /**
   * Create a new trace segment for a top-level operation
   */
  public createSegment(name: string, metadata?: Record<string, any>): import('aws-xray-sdk-core').Segment | null {
    if (!this.isEnabled) return null;

    try {
      const segment = new lazyXRay.AWSXRay.Segment(name);
      
      // Add service information
      segment.addMetadata('service', {
        name: observabilityConfig.serviceName,
        version: observabilityConfig.serviceVersion,
        environment: observabilityConfig.environment
      });

      // Add platform information
      segment.addMetadata('platform', {
        type: currentEnvironment.platform,
        region: currentEnvironment.region,
        isFargate: currentEnvironment.isFargate,
        isEKS: currentEnvironment.isEKS
      });

      // Add custom metadata
      if (metadata) {
        segment.addMetadata('custom', metadata);
      }

      return segment;
    } catch (error) {
      logger.warn('Failed to create X-Ray segment', { name, error });
      return null;
    }
  }

  /**
   * Create a subsegment for a child operation
   */
  public createSubsegment(name: string, parent?: import('aws-xray-sdk-core').Segment): import('aws-xray-sdk-core').Subsegment | null {
    if (!this.isEnabled) return null;

    try {
      const parentSegment = parent || lazyXRay.AWSXRay.getSegment();
      if (!parentSegment) {
        logger.debug('No parent segment found for subsegment', { name });
        return null;
      }

      return parentSegment.addNewSubsegment(name);
    } catch (error) {
      logger.warn('Failed to create X-Ray subsegment', { name, error });
      return null;
    }
  }

  /**
   * Trace an async operation with automatic segment management
   */
  public async traceAsync<T>(
    name: string,
    operation: (segment: import('aws-xray-sdk-core').Subsegment | null) => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    if (!this.isEnabled) {
      return operation(null);
    }

    const segment = this.createSegment(name, metadata);
    
    try {
      const result = await lazyXRay.AWSXRay.captureAsyncFunc(name, async (subsegment?: import('aws-xray-sdk-core').Subsegment) => {
        if (subsegment && metadata) {
          subsegment.addMetadata('operation', metadata);
        }
        return operation(subsegment || null);
      }, segment || undefined);

      if (segment) {
        segment.close();
      }

      return result;
    } catch (error) {
      if (segment) {
        segment.addError(error as Error);
        segment.close(error as Error);
      }
      throw error;
    }
  }

  /**
   * Trace a synchronous operation
   */
  public traceSync<T>(
    name: string,
    operation: (segment: import('aws-xray-sdk-core').Subsegment | null) => T,
    metadata?: Record<string, any>
  ): T {
    if (!this.isEnabled) {
      return operation(null);
    }

    return lazyXRay.AWSXRay.captureFunc(name, (subsegment?: import('aws-xray-sdk-core').Subsegment) => {
      if (subsegment && metadata) {
        subsegment.addMetadata('operation', metadata);
      }
      return operation(subsegment || null);
    });
  }

  /**
   * Add annotation to current segment (for filtering/searching)
   */
  public addAnnotation(key: string, value: string | number | boolean): void {
    if (!this.isEnabled) return;

    try {
      const segment = lazyXRay.AWSXRay.getSegment();
      if (segment) {
        segment.addAnnotation(key, value);
      }
    } catch (error) {
      logger.debug('Failed to add X-Ray annotation', { key, value, error });
    }
  }

  /**
   * Add metadata to current segment (for detailed information)
   */
  public addMetadata(namespace: string, data: Record<string, any>): void {
    if (!this.isEnabled) return;

    try {
      const segment = lazyXRay.AWSXRay.getSegment();
      if (segment) {
        segment.addMetadata(namespace, data);
      }
    } catch (error) {
      logger.debug('Failed to add X-Ray metadata', { namespace, error });
    }
  }

  /**
   * Get current trace context for correlation
   */
  public getTraceContext(): XRayTraceContext | null {
    if (!this.isEnabled) return null;

    try {
      const segment = lazyXRay.AWSXRay.getSegment();
      if (!segment) return null;

      // Handle both Segment and Subsegment types
      const traceId = (segment as any).trace_id || (segment as any).segment?.trace_id;
      const segmentId = segment.id;
      const parentId = (segment as any).parent_id;

      return {
        traceId: traceId || '',
        segmentId: segmentId || '',
        parentId: parentId
      };
    } catch (error) {
      logger.debug('Failed to get X-Ray trace context', { error });
      return null;
    }
  }

  /**
   * Check if X-Ray is enabled and working
   */
  public isActive(): boolean {
    return this.isEnabled && this.isInitialized;
  }

  /**
   * Shutdown X-Ray tracing
   */
  public shutdown(): void {
    if (this.isEnabled) {
      try {
        // Flush any pending segments
        lazyXRay.AWSXRay.getLogger().info('Shutting down X-Ray tracing');
        this.isEnabled = false;
        logger.info('X-Ray tracing shut down');
      } catch (error) {
        logger.warn('Error during X-Ray shutdown', { error });
      }
    }
  }
}

// Export singleton instance
export const fargateXRayTracer = FargateXRayTracer.getInstance();

// Convenience functions for common tracing patterns
export const XRayTracing = {
  // Audio processing tracing
  traceAudioProcessing: async <T>(
    operation: string,
    callSid: string,
    fn: (segment: import('aws-xray-sdk-core').Subsegment | null) => Promise<T>
  ): Promise<T> => {
    return fargateXRayTracer.traceAsync(
      `audio.${operation}`,
      fn,
      { callSid, operation, component: 'audio_processor' }
    );
  },

  // Bedrock request tracing
  traceBedrockRequest: async <T>(
    modelId: string,
    operation: string,
    fn: (segment: import('aws-xray-sdk-core').Subsegment | null) => Promise<T>
  ): Promise<T> => {
    return fargateXRayTracer.traceAsync(
      `bedrock.${operation}`,
      async (segment: import('aws-xray-sdk-core').Subsegment | null) => {
        if (segment) {
          segment.addAnnotation('bedrock.model_id', modelId);
          segment.addAnnotation('bedrock.operation', operation);
        }
        return fn(segment);
      },
      { modelId, operation, component: 'bedrock_client' }
    );
  },

  // WebSocket tracing
  traceWebSocketOperation: <T>(
    operation: string,
    callSid: string,
    fn: (segment: import('aws-xray-sdk-core').Subsegment | null) => T
  ): T => {
    return fargateXRayTracer.traceSync(
      `websocket.${operation}`,
      (segment: import('aws-xray-sdk-core').Subsegment | null) => {
        if (segment) {
          segment.addAnnotation('websocket.call_sid', callSid);
          segment.addAnnotation('websocket.operation', operation);
        }
        return fn(segment);
      },
      { callSid, operation, component: 'websocket_handler' }
    );
  },

  // Error tracing
  traceError: (error: Error, context: Record<string, any>): void => {
    fargateXRayTracer.addMetadata('error', {
      message: error.message,
      stack: error.stack,
      context
    });
    fargateXRayTracer.addAnnotation('error', true);
  }
};