/**
 * @fileoverview Integration Metrics for Knowledge Base and Agent Core Operations
 * 
 * This module provides comprehensive metrics collection for the AgentCore and
 * KnowledgeBase integration features, including performance monitoring,
 * error tracking, and business metrics.
 * 
 * @author Twilio Bedrock Bridge Team
 * @version 1.0.0
 */

import { CloudWatchMetricsService, MetricDimensions } from './cloudWatchMetrics';
import { metricsUtils } from './metrics';
import logger from '../utils/logger';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Knowledge base query metrics data
 */
interface KnowledgeBaseMetrics {
  knowledgeBaseId: string;
  queryLatencyMs: number;
  resultsCount: number;
  success: boolean;
  sessionId?: string;
  queryLength?: number;
  errorType?: string;
}

/**
 * Agent invocation metrics data
 */
interface AgentInvocationMetrics {
  agentId: string;
  agentAliasId: string;
  invocationLatencyMs: number;
  success: boolean;
  sessionId: string;
  inputLength?: number;
  outputLength?: number;
  errorType?: string;
  fallbackUsed?: boolean;
}

/**
 * Intent classification metrics data
 */
interface IntentClassificationMetrics {
  classifiedIntent: 'knowledge' | 'action' | 'conversation';
  confidence: number;
  classificationLatencyMs: number;
  success: boolean;
  sessionId?: string;
  inputLength?: number;
  modelUsed?: boolean;
  customRuleMatched?: string;
  errorType?: string;
}

/**
 * Orchestrator routing metrics data
 */
interface OrchestratorMetrics {
  routingDecision: 'knowledge' | 'agent' | 'conversation';
  totalLatencyMs: number;
  success: boolean;
  sessionId: string;
  fallbackUsed?: boolean;
  errorType?: string;
}

// ============================================================================
// INTEGRATION METRICS SERVICE
// ============================================================================

/**
 * Service for collecting and emitting integration-specific metrics
 */
class IntegrationMetricsService {
  
  /**
   * Record knowledge base query metrics
   */
  static recordKnowledgeBaseQuery(metrics: KnowledgeBaseMetrics): void {
    try {
      const dimensions: MetricDimensions = {
        KnowledgeBaseId: metrics.knowledgeBaseId,
        Success: metrics.success.toString(),
        SessionId: metrics.sessionId || 'unknown'
      };

      if (metrics.errorType) {
        dimensions.ErrorType = metrics.errorType;
      }

      // Core metrics
      const metricsToRecord = [
        {
          name: 'KnowledgeBaseQueries',
          value: 1,
          unit: 'Count',
          dimensions
        },
        {
          name: 'KnowledgeBaseQueryLatency',
          value: metrics.queryLatencyMs,
          unit: 'Milliseconds',
          dimensions
        },
        {
          name: 'KnowledgeBaseResultsCount',
          value: metrics.resultsCount,
          unit: 'Count',
          dimensions
        }
      ];

      // Optional metrics
      if (metrics.queryLength !== undefined) {
        metricsToRecord.push({
          name: 'KnowledgeBaseQueryLength',
          value: metrics.queryLength,
          unit: 'Count',
          dimensions
        });
      }

      // Error metrics
      if (!metrics.success) {
        metricsToRecord.push({
          name: 'KnowledgeBaseErrors',
          value: 1,
          unit: 'Count',
          dimensions
        });
      }

      CloudWatchMetricsService.recordMetrics(metricsToRecord);

      // Also record to OpenTelemetry metrics
      metricsUtils.recordCustomMetric('knowledge_base_query_total', 1, {
        knowledge_base_id: metrics.knowledgeBaseId,
        success: metrics.success.toString(),
        session_id: metrics.sessionId || 'unknown'
      });

      metricsUtils.recordCustomMetric('knowledge_base_query_duration_seconds', metrics.queryLatencyMs / 1000, {
        knowledge_base_id: metrics.knowledgeBaseId,
        success: metrics.success.toString()
      });

      logger.debug('Recorded knowledge base query metrics', {
        knowledgeBaseId: metrics.knowledgeBaseId,
        success: metrics.success,
        latencyMs: metrics.queryLatencyMs,
        resultsCount: metrics.resultsCount
      });

    } catch (error) {
      logger.error('Failed to record knowledge base query metrics', {
        error: error instanceof Error ? error.message : String(error),
        metrics
      });
    }
  }

  /**
   * Record agent invocation metrics
   */
  static recordAgentInvocation(metrics: AgentInvocationMetrics): void {
    try {
      const dimensions: MetricDimensions = {
        AgentId: metrics.agentId,
        AgentAliasId: metrics.agentAliasId,
        Success: metrics.success.toString(),
        SessionId: metrics.sessionId,
        FallbackUsed: (metrics.fallbackUsed || false).toString()
      };

      if (metrics.errorType) {
        dimensions.ErrorType = metrics.errorType;
      }

      // Core metrics
      const metricsToRecord = [
        {
          name: 'AgentInvocations',
          value: 1,
          unit: 'Count',
          dimensions
        },
        {
          name: 'AgentInvocationLatency',
          value: metrics.invocationLatencyMs,
          unit: 'Milliseconds',
          dimensions
        }
      ];

      // Optional metrics
      if (metrics.inputLength !== undefined) {
        metricsToRecord.push({
          name: 'AgentInputLength',
          value: metrics.inputLength,
          unit: 'Count',
          dimensions
        });
      }

      if (metrics.outputLength !== undefined) {
        metricsToRecord.push({
          name: 'AgentOutputLength',
          value: metrics.outputLength,
          unit: 'Count',
          dimensions
        });
      }

      // Error and fallback metrics
      if (!metrics.success) {
        metricsToRecord.push({
          name: 'AgentErrors',
          value: 1,
          unit: 'Count',
          dimensions
        });
      }

      if (metrics.fallbackUsed) {
        metricsToRecord.push({
          name: 'AgentFallbacksUsed',
          value: 1,
          unit: 'Count',
          dimensions
        });
      }

      CloudWatchMetricsService.recordMetrics(metricsToRecord);

      // Also record to OpenTelemetry metrics
      metricsUtils.recordCustomMetric('agent_invocation_total', 1, {
        agent_id: metrics.agentId,
        agent_alias_id: metrics.agentAliasId,
        success: metrics.success.toString(),
        fallback_used: (metrics.fallbackUsed || false).toString()
      });

      metricsUtils.recordCustomMetric('agent_invocation_duration_seconds', metrics.invocationLatencyMs / 1000, {
        agent_id: metrics.agentId,
        success: metrics.success.toString()
      });

      logger.debug('Recorded agent invocation metrics', {
        agentId: metrics.agentId,
        success: metrics.success,
        latencyMs: metrics.invocationLatencyMs,
        fallbackUsed: metrics.fallbackUsed
      });

    } catch (error) {
      logger.error('Failed to record agent invocation metrics', {
        error: error instanceof Error ? error.message : String(error),
        metrics
      });
    }
  }

  /**
   * Record intent classification metrics
   */
  static recordIntentClassification(metrics: IntentClassificationMetrics): void {
    try {
      const dimensions: MetricDimensions = {
        ClassifiedIntent: metrics.classifiedIntent,
        Success: metrics.success.toString(),
        ModelUsed: (metrics.modelUsed || false).toString(),
        SessionId: metrics.sessionId || 'unknown'
      };

      if (metrics.errorType) {
        dimensions.ErrorType = metrics.errorType;
      }

      if (metrics.customRuleMatched) {
        dimensions.CustomRuleMatched = metrics.customRuleMatched;
      }

      // Core metrics
      const metricsToRecord = [
        {
          name: 'IntentClassifications',
          value: 1,
          unit: 'Count',
          dimensions
        },
        {
          name: 'IntentClassificationLatency',
          value: metrics.classificationLatencyMs,
          unit: 'Milliseconds',
          dimensions
        },
        {
          name: 'IntentClassificationConfidence',
          value: metrics.confidence,
          unit: 'None',
          dimensions
        }
      ];

      // Optional metrics
      if (metrics.inputLength !== undefined) {
        metricsToRecord.push({
          name: 'IntentClassificationInputLength',
          value: metrics.inputLength,
          unit: 'Count',
          dimensions
        });
      }

      // Error metrics
      if (!metrics.success) {
        metricsToRecord.push({
          name: 'IntentClassificationErrors',
          value: 1,
          unit: 'Count',
          dimensions
        });
      }

      // Model vs rule-based classification metrics
      if (metrics.modelUsed) {
        metricsToRecord.push({
          name: 'IntentClassificationModelUsage',
          value: 1,
          unit: 'Count',
          dimensions
        });
      }

      if (metrics.customRuleMatched) {
        metricsToRecord.push({
          name: 'IntentClassificationRuleMatches',
          value: 1,
          unit: 'Count',
          dimensions
        });
      }

      CloudWatchMetricsService.recordMetrics(metricsToRecord);

      // Also record to OpenTelemetry metrics
      metricsUtils.recordCustomMetric('intent_classification_total', 1, {
        classified_intent: metrics.classifiedIntent,
        success: metrics.success.toString(),
        model_used: (metrics.modelUsed || false).toString()
      });

      metricsUtils.recordCustomMetric('intent_classification_duration_seconds', metrics.classificationLatencyMs / 1000, {
        classified_intent: metrics.classifiedIntent,
        success: metrics.success.toString()
      });

      metricsUtils.recordCustomMetric('intent_classification_confidence', metrics.confidence, {
        classified_intent: metrics.classifiedIntent,
        success: metrics.success.toString()
      });

      logger.debug('Recorded intent classification metrics', {
        classifiedIntent: metrics.classifiedIntent,
        confidence: metrics.confidence,
        success: metrics.success,
        latencyMs: metrics.classificationLatencyMs,
        modelUsed: metrics.modelUsed
      });

    } catch (error) {
      logger.error('Failed to record intent classification metrics', {
        error: error instanceof Error ? error.message : String(error),
        metrics
      });
    }
  }

  /**
   * Record orchestrator routing metrics
   */
  static recordOrchestratorRouting(metrics: OrchestratorMetrics): void {
    try {
      const dimensions: MetricDimensions = {
        RoutingDecision: metrics.routingDecision,
        Success: metrics.success.toString(),
        SessionId: metrics.sessionId,
        FallbackUsed: (metrics.fallbackUsed || false).toString()
      };

      if (metrics.errorType) {
        dimensions.ErrorType = metrics.errorType;
      }

      // Core metrics
      const metricsToRecord = [
        {
          name: 'OrchestratorRoutingDecisions',
          value: 1,
          unit: 'Count',
          dimensions
        },
        {
          name: 'OrchestratorTotalLatency',
          value: metrics.totalLatencyMs,
          unit: 'Milliseconds',
          dimensions
        }
      ];

      // Error and fallback metrics
      if (!metrics.success) {
        metricsToRecord.push({
          name: 'OrchestratorErrors',
          value: 1,
          unit: 'Count',
          dimensions
        });
      }

      if (metrics.fallbackUsed) {
        metricsToRecord.push({
          name: 'OrchestratorFallbacksUsed',
          value: 1,
          unit: 'Count',
          dimensions
        });
      }

      CloudWatchMetricsService.recordMetrics(metricsToRecord);

      // Also record to OpenTelemetry metrics
      metricsUtils.recordCustomMetric('orchestrator_routing_total', 1, {
        routing_decision: metrics.routingDecision,
        success: metrics.success.toString(),
        fallback_used: (metrics.fallbackUsed || false).toString()
      });

      metricsUtils.recordCustomMetric('orchestrator_total_duration_seconds', metrics.totalLatencyMs / 1000, {
        routing_decision: metrics.routingDecision,
        success: metrics.success.toString()
      });

      logger.debug('Recorded orchestrator routing metrics', {
        routingDecision: metrics.routingDecision,
        success: metrics.success,
        totalLatencyMs: metrics.totalLatencyMs,
        fallbackUsed: metrics.fallbackUsed
      });

    } catch (error) {
      logger.error('Failed to record orchestrator routing metrics', {
        error: error instanceof Error ? error.message : String(error),
        metrics
      });
    }
  }

  /**
   * Record integration performance summary metrics
   */
  static recordIntegrationPerformanceSummary(
    sessionId: string,
    totalRequestLatencyMs: number,
    componentsUsed: string[],
    success: boolean,
    errorType?: string
  ): void {
    try {
      const dimensions: MetricDimensions = {
        SessionId: sessionId,
        Success: success.toString(),
        ComponentsUsed: componentsUsed.join(',')
      };

      if (errorType) {
        dimensions.ErrorType = errorType;
      }

      const metricsToRecord = [
        {
          name: 'IntegrationRequestsTotal',
          value: 1,
          unit: 'Count',
          dimensions
        },
        {
          name: 'IntegrationEndToEndLatency',
          value: totalRequestLatencyMs,
          unit: 'Milliseconds',
          dimensions
        }
      ];

      if (!success) {
        metricsToRecord.push({
          name: 'IntegrationRequestErrors',
          value: 1,
          unit: 'Count',
          dimensions
        });
      }

      CloudWatchMetricsService.recordMetrics(metricsToRecord);

      // Also record to OpenTelemetry metrics
      metricsUtils.recordCustomMetric('integration_request_total', 1, {
        success: success.toString(),
        components_used: componentsUsed.join(',')
      });

      metricsUtils.recordCustomMetric('integration_end_to_end_duration_seconds', totalRequestLatencyMs / 1000, {
        success: success.toString()
      });

      logger.debug('Recorded integration performance summary', {
        sessionId,
        totalLatencyMs: totalRequestLatencyMs,
        componentsUsed,
        success
      });

    } catch (error) {
      logger.error('Failed to record integration performance summary', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
        totalRequestLatencyMs,
        componentsUsed,
        success
      });
    }
  }

  /**
   * Flush all pending metrics to CloudWatch
   */
  static async flush(): Promise<void> {
    try {
      await CloudWatchMetricsService.flush();
      logger.debug('Integration metrics flushed to CloudWatch');
    } catch (error) {
      logger.error('Failed to flush integration metrics', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get current metrics batch status
   */
  static getBatchStatus(): {
    batchSize: number;
    isHealthy: boolean;
    config: any;
  } {
    return CloudWatchMetricsService.getBatchStatus();
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Convenience functions for common integration metrics
 */
export const IntegrationMetrics = {
  /**
   * Record successful knowledge base query
   */
  knowledgeBaseQuerySuccess: (
    knowledgeBaseId: string,
    latencyMs: number,
    resultsCount: number,
    sessionId?: string,
    queryLength?: number
  ) => {
    IntegrationMetricsService.recordKnowledgeBaseQuery({
      knowledgeBaseId,
      queryLatencyMs: latencyMs,
      resultsCount,
      success: true,
      sessionId,
      queryLength
    });
  },

  /**
   * Record failed knowledge base query
   */
  knowledgeBaseQueryError: (
    knowledgeBaseId: string,
    latencyMs: number,
    errorType: string,
    sessionId?: string,
    queryLength?: number
  ) => {
    IntegrationMetricsService.recordKnowledgeBaseQuery({
      knowledgeBaseId,
      queryLatencyMs: latencyMs,
      resultsCount: 0,
      success: false,
      sessionId,
      queryLength,
      errorType
    });
  },

  /**
   * Record successful agent invocation
   */
  agentInvocationSuccess: (
    agentId: string,
    agentAliasId: string,
    latencyMs: number,
    sessionId: string,
    inputLength?: number,
    outputLength?: number
  ) => {
    IntegrationMetricsService.recordAgentInvocation({
      agentId,
      agentAliasId,
      invocationLatencyMs: latencyMs,
      success: true,
      sessionId,
      inputLength,
      outputLength
    });
  },

  /**
   * Record failed agent invocation
   */
  agentInvocationError: (
    agentId: string,
    agentAliasId: string,
    latencyMs: number,
    sessionId: string,
    errorType: string,
    fallbackUsed: boolean = false,
    inputLength?: number
  ) => {
    IntegrationMetricsService.recordAgentInvocation({
      agentId,
      agentAliasId,
      invocationLatencyMs: latencyMs,
      success: false,
      sessionId,
      inputLength,
      errorType,
      fallbackUsed
    });
  },

  /**
   * Record successful intent classification
   */
  intentClassificationSuccess: (
    classifiedIntent: 'knowledge' | 'action' | 'conversation',
    confidence: number,
    latencyMs: number,
    modelUsed: boolean = true,
    sessionId?: string,
    inputLength?: number,
    customRuleMatched?: string
  ) => {
    IntegrationMetricsService.recordIntentClassification({
      classifiedIntent,
      confidence,
      classificationLatencyMs: latencyMs,
      success: true,
      sessionId,
      inputLength,
      modelUsed,
      customRuleMatched
    });
  },

  /**
   * Record failed intent classification
   */
  intentClassificationError: (
    latencyMs: number,
    errorType: string,
    sessionId?: string,
    inputLength?: number
  ) => {
    IntegrationMetricsService.recordIntentClassification({
      classifiedIntent: 'conversation', // Default fallback
      confidence: 0,
      classificationLatencyMs: latencyMs,
      success: false,
      sessionId,
      inputLength,
      errorType
    });
  },

  /**
   * Record orchestrator routing decision
   */
  orchestratorRouting: (
    routingDecision: 'knowledge' | 'agent' | 'conversation',
    totalLatencyMs: number,
    sessionId: string,
    success: boolean = true,
    fallbackUsed: boolean = false,
    errorType?: string
  ) => {
    IntegrationMetricsService.recordOrchestratorRouting({
      routingDecision,
      totalLatencyMs,
      success,
      sessionId,
      fallbackUsed,
      errorType
    });
  },

  /**
   * Record integration performance summary
   */
  integrationSummary: (
    sessionId: string,
    totalLatencyMs: number,
    componentsUsed: string[],
    success: boolean = true,
    errorType?: string
  ) => {
    IntegrationMetricsService.recordIntegrationPerformanceSummary(
      sessionId,
      totalLatencyMs,
      componentsUsed,
      success,
      errorType
    );
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
  IntegrationMetricsService,
  KnowledgeBaseMetrics,
  AgentInvocationMetrics,
  IntentClassificationMetrics,
  OrchestratorMetrics
};

export default IntegrationMetricsService;