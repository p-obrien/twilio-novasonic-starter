/**
 * @fileoverview Integration Error Logging Service
 * 
 * This module provides structured logging capabilities specifically for
 * integration errors in the AgentCore and KnowledgeBase integration features.
 * It includes performance monitoring and detailed error context capture.
 * 
 * @author Twilio Bedrock Bridge Team
 * @version 1.0.0
 */

import logger from './logger';
import { IntegrationError, isIntegrationError, extractErrorDetails } from '../errors/ClientErrors';
import { IntegrationMetrics } from './integrationMetrics';
import { CorrelationIdManager } from '../utils/correlationId';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Performance monitoring data for integration operations
 */
interface PerformanceMonitoringData {
  operationName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  success: boolean;
  component: 'knowledge' | 'agent' | 'orchestrator' | 'classifier';
  sessionId?: string;
  metadata?: Record<string, any>;
}

/**
 * Error context for structured logging
 */
interface ErrorContext {
  sessionId?: string;
  correlationId?: string;
  component: 'knowledge' | 'agent' | 'orchestrator' | 'classifier';
  operation: string;
  metadata: Record<string, any>;
  performanceData?: PerformanceMonitoringData;
  userContext?: {
    inputLength?: number;
    expectedOutput?: string;
    conversationTurn?: number;
  };
}

/**
 * Integration error log entry
 */
interface IntegrationErrorLogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info';
  errorType: string;
  component: string;
  operation: string;
  message: string;
  sessionId?: string;
  correlationId?: string;
  metadata: Record<string, any>;
  performanceImpact?: {
    durationMs: number;
    expectedDurationMs?: number;
    performanceDegradation?: number;
  };
  errorDetails: {
    name: string;
    code?: string;
    stack?: string;
    cause?: any;
  };
  context: ErrorContext;
}

// ============================================================================
// INTEGRATION ERROR LOGGER SERVICE
// ============================================================================

/**
 * Service for structured logging of integration errors with performance monitoring
 */
class IntegrationErrorLoggerService {
  
  /**
   * Log an integration error with full context and performance data
   */
  static logIntegrationError(
    error: Error | IntegrationError,
    context: ErrorContext,
    severity: 'error' | 'warn' | 'info' = 'error'
  ): void {
    try {
      const timestamp = new Date().toISOString();
      const correlationId = context.correlationId || CorrelationIdManager.getCurrentCorrelationId();
      
      // Extract error details
      const errorDetails = extractErrorDetails(error);
      
      // Determine error type and component
      let errorType = 'INTEGRATION_ERROR';
      let component = context.component;
      
      if (isIntegrationError(error)) {
        errorType = error.code;
        component = error.component;
      }

      // Calculate performance impact if performance data is available
      let performanceImpact: IntegrationErrorLogEntry['performanceImpact'];
      if (context.performanceData) {
        const { durationMs } = context.performanceData;
        const expectedDurationMs = this.getExpectedDuration(context.component, context.operation);
        
        performanceImpact = {
          durationMs,
          expectedDurationMs,
          performanceDegradation: expectedDurationMs ? 
            ((durationMs - expectedDurationMs) / expectedDurationMs) * 100 : undefined
        };
      }

      // Create structured log entry
      const logEntry: IntegrationErrorLogEntry = {
        timestamp,
        level: severity,
        errorType,
        component,
        operation: context.operation,
        message: error.message,
        sessionId: context.sessionId,
        correlationId,
        metadata: {
          ...context.metadata,
          ...(isIntegrationError(error) ? error.metadata : {})
        } as Record<string, any>,
        performanceImpact,
        errorDetails,
        context
      };

      // Log with appropriate severity
      this.writeStructuredLog(logEntry);

      // Record error metrics
      this.recordErrorMetrics(logEntry);

      // Trigger alerts for critical errors
      if (severity === 'error') {
        this.triggerErrorAlert(logEntry);
      }

    } catch (loggingError) {
      // Fallback logging if structured logging fails
      logger.error('Failed to log integration error', {
        originalError: error.message,
        loggingError: loggingError instanceof Error ? loggingError.message : String(loggingError),
        context
      });
    }
  }

  /**
   * Log performance monitoring data for successful operations
   */
  static logPerformanceData(data: PerformanceMonitoringData): void {
    try {
      const correlationId = CorrelationIdManager.getCurrentCorrelationId();
      
      logger.info('Integration operation performance', {
        timestamp: new Date().toISOString(),
        correlationId,
        operation: data.operationName,
        component: data.component,
        durationMs: data.durationMs,
        success: data.success,
        sessionId: data.sessionId,
        metadata: data.metadata,
        performanceMetrics: {
          startTime: data.startTime,
          endTime: data.endTime,
          expectedDuration: this.getExpectedDuration(data.component, data.operationName),
          performanceRating: this.calculatePerformanceRating(data)
        }
      });

      // Record performance metrics
      this.recordPerformanceMetrics(data);

    } catch (error) {
      logger.error('Failed to log performance data', {
        error: error instanceof Error ? error.message : String(error),
        data
      });
    }
  }

  /**
   * Create a performance monitor for tracking operation duration
   */
  static createPerformanceMonitor(
    operationName: string,
    component: 'knowledge' | 'agent' | 'orchestrator' | 'classifier',
    sessionId?: string,
    metadata?: Record<string, any>
  ): {
    finish: (success: boolean) => PerformanceMonitoringData;
    getElapsedMs: () => number;
  } {
    const startTime = Date.now();
    
    return {
      finish: (success: boolean): PerformanceMonitoringData => {
        const endTime = Date.now();
        const durationMs = endTime - startTime;
        
        const performanceData: PerformanceMonitoringData = {
          operationName,
          startTime,
          endTime,
          durationMs,
          success,
          component,
          sessionId,
          metadata
        };

        // Log performance data
        this.logPerformanceData(performanceData);
        
        return performanceData;
      },
      getElapsedMs: (): number => Date.now() - startTime
    };
  }

  /**
   * Log integration operation start
   */
  static logOperationStart(
    operation: string,
    component: 'knowledge' | 'agent' | 'orchestrator' | 'classifier',
    sessionId?: string,
    metadata?: Record<string, any>
  ): void {
    const correlationId = CorrelationIdManager.getCurrentCorrelationId();
    
    logger.debug('Integration operation started', {
      timestamp: new Date().toISOString(),
      correlationId,
      operation,
      component,
      sessionId,
      metadata
    });
  }

  /**
   * Log integration operation completion
   */
  static logOperationComplete(
    operation: string,
    component: 'knowledge' | 'agent' | 'orchestrator' | 'classifier',
    durationMs: number,
    success: boolean,
    sessionId?: string,
    metadata?: Record<string, any>
  ): void {
    const correlationId = CorrelationIdManager.getCurrentCorrelationId();
    
    logger.info('Integration operation completed', {
      timestamp: new Date().toISOString(),
      correlationId,
      operation,
      component,
      durationMs,
      success,
      sessionId,
      metadata,
      performanceRating: this.calculatePerformanceRating({
        operationName: operation,
        startTime: Date.now() - durationMs,
        endTime: Date.now(),
        durationMs,
        success,
        component,
        sessionId,
        metadata
      })
    });
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Write structured log entry
   */
  private static writeStructuredLog(logEntry: IntegrationErrorLogEntry): void {
    const logMethod = logger[logEntry.level];
    
    logMethod.call(logger, `Integration ${logEntry.component} error: ${logEntry.message}`, {
      integrationError: {
        timestamp: logEntry.timestamp,
        errorType: logEntry.errorType,
        component: logEntry.component,
        operation: logEntry.operation,
        sessionId: logEntry.sessionId,
        correlationId: logEntry.correlationId,
        metadata: logEntry.metadata,
        performanceImpact: logEntry.performanceImpact,
        errorDetails: logEntry.errorDetails,
        context: logEntry.context
      }
    });
  }

  /**
   * Record error metrics
   */
  private static recordErrorMetrics(logEntry: IntegrationErrorLogEntry): void {
    try {
      // Record general error metrics
      IntegrationMetrics.integrationSummary(
        logEntry.sessionId || 'unknown',
        logEntry.performanceImpact?.durationMs || 0,
        [logEntry.component],
        false,
        logEntry.errorType
      );

      // Record component-specific error metrics based on component type
      switch (logEntry.component) {
        case 'knowledge':
          IntegrationMetrics.knowledgeBaseQueryError(
            logEntry.metadata.knowledgeBaseId || 'unknown',
            logEntry.performanceImpact?.durationMs || 0,
            logEntry.errorType,
            logEntry.sessionId,
            logEntry.context.userContext?.inputLength
          );
          break;
          
        case 'agent':
          IntegrationMetrics.agentInvocationError(
            logEntry.metadata.agentId || 'unknown',
            logEntry.metadata.agentAliasId || 'unknown',
            logEntry.performanceImpact?.durationMs || 0,
            logEntry.sessionId || 'unknown',
            logEntry.errorType,
            logEntry.metadata.fallbackUsed || false,
            logEntry.context.userContext?.inputLength
          );
          break;
          
        case 'classifier':
          IntegrationMetrics.intentClassificationError(
            logEntry.performanceImpact?.durationMs || 0,
            logEntry.errorType,
            logEntry.sessionId,
            logEntry.context.userContext?.inputLength
          );
          break;
          
        case 'orchestrator':
          IntegrationMetrics.orchestratorRouting(
            logEntry.metadata.routingDecision || 'conversation',
            logEntry.performanceImpact?.durationMs || 0,
            logEntry.sessionId || 'unknown',
            false,
            logEntry.metadata.fallbackUsed || false,
            logEntry.errorType
          );
          break;
      }
    } catch (error) {
      logger.error('Failed to record error metrics', {
        error: error instanceof Error ? error.message : String(error),
        logEntry: logEntry.errorType
      });
    }
  }

  /**
   * Record performance metrics for successful operations
   */
  private static recordPerformanceMetrics(data: PerformanceMonitoringData): void {
    try {
      if (!data.success) {
        return; // Error metrics are handled separately
      }

      // Record component-specific success metrics
      switch (data.component) {
        case 'knowledge':
          IntegrationMetrics.knowledgeBaseQuerySuccess(
            data.metadata?.knowledgeBaseId || 'unknown',
            data.durationMs,
            data.metadata?.resultsCount || 0,
            data.sessionId,
            data.metadata?.queryLength
          );
          break;
          
        case 'agent':
          IntegrationMetrics.agentInvocationSuccess(
            data.metadata?.agentId || 'unknown',
            data.metadata?.agentAliasId || 'unknown',
            data.durationMs,
            data.sessionId || 'unknown',
            data.metadata?.inputLength,
            data.metadata?.outputLength
          );
          break;
          
        case 'classifier':
          IntegrationMetrics.intentClassificationSuccess(
            data.metadata?.classifiedIntent || 'conversation',
            data.metadata?.confidence || 0,
            data.durationMs,
            data.metadata?.modelUsed || true,
            data.sessionId,
            data.metadata?.inputLength,
            data.metadata?.customRuleMatched
          );
          break;
          
        case 'orchestrator':
          IntegrationMetrics.orchestratorRouting(
            data.metadata?.routingDecision || 'conversation',
            data.durationMs,
            data.sessionId || 'unknown',
            true,
            data.metadata?.fallbackUsed || false
          );
          break;
      }
    } catch (error) {
      logger.error('Failed to record performance metrics', {
        error: error instanceof Error ? error.message : String(error),
        operation: data.operationName
      });
    }
  }

  /**
   * Trigger error alerts for critical errors
   */
  private static triggerErrorAlert(logEntry: IntegrationErrorLogEntry): void {
    try {
      // Check if this is a critical error that needs immediate attention
      const isCritical = this.isCriticalError(logEntry);
      
      if (isCritical) {
        logger.error('CRITICAL INTEGRATION ERROR - Immediate attention required', {
          alert: 'CRITICAL_INTEGRATION_ERROR',
          component: logEntry.component,
          operation: logEntry.operation,
          errorType: logEntry.errorType,
          sessionId: logEntry.sessionId,
          correlationId: logEntry.correlationId,
          performanceImpact: logEntry.performanceImpact,
          timestamp: logEntry.timestamp
        });
      }
    } catch (error) {
      logger.error('Failed to trigger error alert', {
        error: error instanceof Error ? error.message : String(error),
        logEntry: logEntry.errorType
      });
    }
  }

  /**
   * Determine if an error is critical
   */
  private static isCriticalError(logEntry: IntegrationErrorLogEntry): boolean {
    // Critical error conditions
    const criticalErrorTypes = [
      'CONFIGURATION_ERROR',
      'BEDROCK_SERVICE_ERROR',
      'SESSION_ERROR'
    ];

    const criticalPerformanceDegradation = 200; // 200% slower than expected

    return (
      criticalErrorTypes.includes(logEntry.errorType) ||
      (logEntry.performanceImpact?.performanceDegradation || 0) > criticalPerformanceDegradation ||
      logEntry.component === 'orchestrator' // Orchestrator errors are always critical
    );
  }

  /**
   * Get expected duration for an operation
   */
  private static getExpectedDuration(
    component: 'knowledge' | 'agent' | 'orchestrator' | 'classifier',
    operation: string
  ): number {
    // Expected durations in milliseconds based on component and operation
    const expectedDurations: Record<string, Record<string, number>> = {
      knowledge: {
        query: 1000, // 1 second for knowledge base queries
        validate: 100
      },
      agent: {
        invoke: 3000, // 3 seconds for agent invocations
        validate: 100
      },
      classifier: {
        classify: 500, // 500ms for intent classification
        addRule: 50,
        removeRule: 50
      },
      orchestrator: {
        route: 200, // 200ms for routing decisions
        processInput: 4000 // 4 seconds for complete processing
      }
    };

    return expectedDurations[component]?.[operation] || 1000; // Default 1 second
  }

  /**
   * Calculate performance rating
   */
  private static calculatePerformanceRating(data: PerformanceMonitoringData): string {
    const expectedDuration = this.getExpectedDuration(data.component, data.operationName);
    const ratio = data.durationMs / expectedDuration;

    if (ratio <= 0.5) return 'excellent';
    if (ratio <= 1.0) return 'good';
    if (ratio <= 1.5) return 'acceptable';
    if (ratio <= 2.0) return 'poor';
    return 'critical';
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Convenience functions for common integration error logging scenarios
 */
export const IntegrationErrorLogger = {
  /**
   * Log knowledge base error
   */
  knowledgeBaseError: (
    error: Error,
    knowledgeBaseId: string,
    operation: string,
    sessionId?: string,
    performanceData?: PerformanceMonitoringData,
    metadata?: Record<string, any>
  ) => {
    IntegrationErrorLoggerService.logIntegrationError(error, {
      component: 'knowledge',
      operation,
      sessionId,
      metadata: { knowledgeBaseId, ...(metadata || {}) },
      performanceData
    });
  },

  /**
   * Log agent core error
   */
  agentCoreError: (
    error: Error,
    agentId: string,
    agentAliasId: string,
    operation: string,
    sessionId: string,
    performanceData?: PerformanceMonitoringData,
    metadata?: Record<string, any>
  ) => {
    IntegrationErrorLoggerService.logIntegrationError(error, {
      component: 'agent',
      operation,
      sessionId,
      metadata: { agentId, agentAliasId, ...(metadata || {}) },
      performanceData
    });
  },

  /**
   * Log intent classifier error
   */
  classifierError: (
    error: Error,
    operation: string,
    sessionId?: string,
    inputLength?: number,
    performanceData?: PerformanceMonitoringData,
    metadata?: Record<string, any>
  ) => {
    IntegrationErrorLoggerService.logIntegrationError(error, {
      component: 'classifier',
      operation,
      sessionId,
      metadata: metadata || {},
      performanceData,
      userContext: { inputLength }
    });
  },

  /**
   * Log orchestrator error
   */
  orchestratorError: (
    error: Error,
    operation: string,
    sessionId: string,
    routingDecision?: string,
    performanceData?: PerformanceMonitoringData,
    metadata?: Record<string, any>
  ) => {
    IntegrationErrorLoggerService.logIntegrationError(error, {
      component: 'orchestrator',
      operation,
      sessionId,
      metadata: { routingDecision, ...(metadata || {}) },
      performanceData
    });
  },

  /**
   * Create performance monitor
   */
  createMonitor: IntegrationErrorLoggerService.createPerformanceMonitor,

  /**
   * Log operation start
   */
  logStart: IntegrationErrorLoggerService.logOperationStart,

  /**
   * Log operation complete
   */
  logComplete: IntegrationErrorLoggerService.logOperationComplete
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
  IntegrationErrorLoggerService,
  PerformanceMonitoringData,
  ErrorContext,
  IntegrationErrorLogEntry
};

export default IntegrationErrorLoggerService;