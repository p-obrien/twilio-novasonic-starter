/**
 * @fileoverview Utilities Module Exports
 * 
 * Exports utility functions and classes for the application.
 */

// Export correlation ID management
export { CorrelationIdManager } from './correlationId';

// Export resource management
export { 
  resourceManager,
  ResourceManager,
  ResourceType,
  ResourceState,
  CleanupPriority,
  type ResourceInfo,
  type ResourceManagerConfig,
  type ResourceStats,
  type LeakDetectionResult
} from './ResourceManager';

// Export validation utilities (if available)
// export { ValidationUtils } from './ValidationUtils';

// Export retry utilities (if available)
// export { RetryUtils } from './RetryUtils';

// Export async correlation utilities (if available)
// export { AsyncCorrelationManager } from './asyncCorrelation';

// Export constants
export * from './constants';

// Export environment utilities
export * from './environment';