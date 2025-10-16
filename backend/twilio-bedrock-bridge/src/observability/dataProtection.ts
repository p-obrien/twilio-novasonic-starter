/**
 * @fileoverview Data Protection Service
 * 
 * This module provides data protection capabilities including conversation data
 * sanitization, access logging for knowledge base queries, and audit trails
 * for agent executions. It ensures compliance with data privacy requirements
 * and provides comprehensive audit capabilities.
 * 
 * @author Twilio Bedrock Bridge Team
 * @version 1.0.0
 */

import logger from './logger';
import { CorrelationIdManager } from '../utils/correlationId';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Sensitive data patterns for sanitization
 */
interface SensitiveDataPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  severity: 'high' | 'medium' | 'low';
}

/**
 * Access log entry for knowledge base queries
 */
interface KnowledgeBaseAccessLog {
  timestamp: string;
  sessionId: string;
  correlationId: string;
  knowledgeBaseId: string;
  operation: 'query' | 'retrieve';
  queryHash: string; // Hash of the query for privacy
  queryLength: number;
  resultsCount: number;
  durationMs: number;
  success: boolean;
  userContext?: {
    ipAddress?: string;
    userAgent?: string;
    conversationTurn?: number;
  };
  metadata: Record<string, any>;
}

/**
 * Audit trail entry for agent executions
 */
interface AgentExecutionAudit {
  timestamp: string;
  sessionId: string;
  correlationId: string;
  agentId: string;
  agentAliasId: string;
  operation: 'invoke' | 'validate';
  inputHash: string; // Hash of the input for privacy
  inputLength: number;
  outputLength?: number;
  durationMs: number;
  success: boolean;
  errorType?: string;
  userContext?: {
    ipAddress?: string;
    userAgent?: string;
    conversationTurn?: number;
  };
  metadata: Record<string, any>;
}

/**
 * Sanitization result
 */
interface SanitizationResult {
  sanitizedText: string;
  detectedPatterns: string[];
  sanitizationApplied: boolean;
  originalLength: number;
  sanitizedLength: number;
}

/**
 * Data protection configuration
 */
interface DataProtectionConfig {
  enableSanitization: boolean;
  enableAccessLogging: boolean;
  enableAuditTrails: boolean;
  retentionDays: number;
  sensitivityLevel: 'strict' | 'moderate' | 'minimal';
}

// ============================================================================
// SENSITIVE DATA PATTERNS
// ============================================================================

/**
 * Predefined sensitive data patterns for sanitization
 */
const SENSITIVE_DATA_PATTERNS: SensitiveDataPattern[] = [
  // Personal Identifiers
  {
    name: 'SSN',
    pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g,
    replacement: '[SSN-REDACTED]',
    severity: 'high'
  },
  {
    name: 'Credit Card',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: '[CARD-REDACTED]',
    severity: 'high'
  },
  {
    name: 'Email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[EMAIL-REDACTED]',
    severity: 'medium'
  },
  {
    name: 'Phone Number',
    pattern: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
    replacement: '[PHONE-REDACTED]',
    severity: 'medium'
  },
  {
    name: 'IP Address',
    pattern: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
    replacement: '[IP-REDACTED]',
    severity: 'low'
  },
  // Financial Information
  {
    name: 'Bank Account',
    pattern: /\b\d{8,17}\b/g,
    replacement: '[ACCOUNT-REDACTED]',
    severity: 'high'
  },
  // Personal Names (simple pattern)
  {
    name: 'Potential Name',
    pattern: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g,
    replacement: '[NAME-REDACTED]',
    severity: 'low'
  }
];

// ============================================================================
// DATA PROTECTION SERVICE
// ============================================================================

/**
 * Service for data protection, sanitization, and audit logging
 */
class DataProtectionService {
  private static config: DataProtectionConfig = {
    enableSanitization: true,
    enableAccessLogging: true,
    enableAuditTrails: true,
    retentionDays: 90,
    sensitivityLevel: 'moderate'
  };

  /**
   * Configure data protection settings
   */
  static configure(config: Partial<DataProtectionConfig>): void {
    this.config = { ...this.config, ...config };
    
    logger.info('Data protection configuration updated', {
      config: this.config,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Sanitize conversation data to remove sensitive information
   */
  static sanitizeConversationData(
    text: string,
    sessionId?: string,
    additionalPatterns?: SensitiveDataPattern[]
  ): SanitizationResult {
    if (!this.config.enableSanitization) {
      return {
        sanitizedText: text,
        detectedPatterns: [],
        sanitizationApplied: false,
        originalLength: text.length,
        sanitizedLength: text.length
      };
    }

    try {
      let sanitizedText = text;
      const detectedPatterns: string[] = [];
      const originalLength = text.length;

      // Get patterns based on sensitivity level
      const patternsToUse = this.getPatternsBySensitivity();
      
      // Add any additional patterns
      if (additionalPatterns) {
        patternsToUse.push(...additionalPatterns);
      }

      // Apply sanitization patterns
      for (const pattern of patternsToUse) {
        const matches = sanitizedText.match(pattern.pattern);
        if (matches && matches.length > 0) {
          sanitizedText = sanitizedText.replace(pattern.pattern, pattern.replacement);
          detectedPatterns.push(pattern.name);
        }
      }

      const result: SanitizationResult = {
        sanitizedText,
        detectedPatterns,
        sanitizationApplied: detectedPatterns.length > 0,
        originalLength,
        sanitizedLength: sanitizedText.length
      };

      // Log sanitization activity if patterns were detected
      if (result.sanitizationApplied) {
        this.logSanitizationActivity(result, sessionId);
      }

      return result;

    } catch (error) {
      logger.error('Failed to sanitize conversation data', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
        textLength: text.length
      });

      // Return original text if sanitization fails
      return {
        sanitizedText: text,
        detectedPatterns: [],
        sanitizationApplied: false,
        originalLength: text.length,
        sanitizedLength: text.length
      };
    }
  }

  /**
   * Log knowledge base access for audit purposes
   */
  static logKnowledgeBaseAccess(
    knowledgeBaseId: string,
    operation: 'query' | 'retrieve',
    query: string,
    resultsCount: number,
    durationMs: number,
    success: boolean,
    sessionId: string,
    userContext?: KnowledgeBaseAccessLog['userContext'],
    metadata?: Record<string, any>
  ): void {
    if (!this.config.enableAccessLogging) {
      return;
    }

    try {
      const correlationId = CorrelationIdManager.getCurrentCorrelationId() || 'unknown';
      const queryHash = this.hashSensitiveData(query);

      const accessLog: KnowledgeBaseAccessLog = {
        timestamp: new Date().toISOString(),
        sessionId,
        correlationId,
        knowledgeBaseId,
        operation,
        queryHash,
        queryLength: query.length,
        resultsCount,
        durationMs,
        success,
        userContext,
        metadata: metadata || {}
      };

      // Log access with structured format
      logger.info('Knowledge base access logged', {
        accessType: 'KNOWLEDGE_BASE_ACCESS',
        knowledgeBaseAccess: accessLog,
        auditTrail: true
      });

      // Store in audit database if configured
      this.storeAccessLog(accessLog);

    } catch (error) {
      logger.error('Failed to log knowledge base access', {
        error: error instanceof Error ? error.message : String(error),
        knowledgeBaseId,
        operation,
        sessionId
      });
    }
  }

  /**
   * Create audit trail for agent execution
   */
  static auditAgentExecution(
    agentId: string,
    agentAliasId: string,
    operation: 'invoke' | 'validate',
    input: string,
    outputLength: number | undefined,
    durationMs: number,
    success: boolean,
    sessionId: string,
    errorType?: string,
    userContext?: AgentExecutionAudit['userContext'],
    metadata?: Record<string, any>
  ): void {
    if (!this.config.enableAuditTrails) {
      return;
    }

    try {
      const correlationId = CorrelationIdManager.getCurrentCorrelationId() || 'unknown';
      const inputHash = this.hashSensitiveData(input);

      const auditEntry: AgentExecutionAudit = {
        timestamp: new Date().toISOString(),
        sessionId,
        correlationId,
        agentId,
        agentAliasId,
        operation,
        inputHash,
        inputLength: input.length,
        outputLength,
        durationMs,
        success,
        errorType,
        userContext,
        metadata: metadata || {}
      };

      // Log audit trail with structured format
      logger.info('Agent execution audit trail created', {
        auditType: 'AGENT_EXECUTION_AUDIT',
        agentAudit: auditEntry,
        auditTrail: true
      });

      // Store in audit database if configured
      this.storeAuditTrail(auditEntry);

    } catch (error) {
      logger.error('Failed to create agent execution audit trail', {
        error: error instanceof Error ? error.message : String(error),
        agentId,
        operation,
        sessionId
      });
    }
  }

  /**
   * Generate data protection report for a session
   */
  static generateSessionDataProtectionReport(sessionId: string): {
    sanitizationEvents: number;
    knowledgeBaseAccesses: number;
    agentExecutions: number;
    dataProtectionCompliance: 'compliant' | 'partial' | 'non-compliant';
  } {
    try {
      // This would typically query stored audit data
      // For now, return a basic structure
      return {
        sanitizationEvents: 0,
        knowledgeBaseAccesses: 0,
        agentExecutions: 0,
        dataProtectionCompliance: 'compliant'
      };
    } catch (error) {
      logger.error('Failed to generate data protection report', {
        error: error instanceof Error ? error.message : String(error),
        sessionId
      });

      return {
        sanitizationEvents: 0,
        knowledgeBaseAccesses: 0,
        agentExecutions: 0,
        dataProtectionCompliance: 'non-compliant'
      };
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Get sanitization patterns based on sensitivity level
   */
  private static getPatternsBySensitivity(): SensitiveDataPattern[] {
    switch (this.config.sensitivityLevel) {
      case 'strict':
        return SENSITIVE_DATA_PATTERNS;
      case 'moderate':
        return SENSITIVE_DATA_PATTERNS.filter(p => p.severity !== 'low');
      case 'minimal':
        return SENSITIVE_DATA_PATTERNS.filter(p => p.severity === 'high');
      default:
        return SENSITIVE_DATA_PATTERNS.filter(p => p.severity !== 'low');
    }
  }

  /**
   * Hash sensitive data for audit purposes
   */
  private static hashSensitiveData(data: string): string {
    // Simple hash implementation - in production, use a proper cryptographic hash
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Log sanitization activity
   */
  private static logSanitizationActivity(
    result: SanitizationResult,
    sessionId?: string
  ): void {
    logger.info('Data sanitization applied', {
      sanitizationType: 'CONVERSATION_DATA_SANITIZATION',
      sessionId,
      detectedPatterns: result.detectedPatterns,
      originalLength: result.originalLength,
      sanitizedLength: result.sanitizedLength,
      reductionPercentage: ((result.originalLength - result.sanitizedLength) / result.originalLength) * 100,
      timestamp: new Date().toISOString(),
      auditTrail: true
    });
  }

  /**
   * Store access log (placeholder for database storage)
   */
  private static storeAccessLog(accessLog: KnowledgeBaseAccessLog): void {
    // In a real implementation, this would store to a secure audit database
    // For now, we just ensure it's logged
    logger.debug('Access log stored', {
      logType: 'KNOWLEDGE_BASE_ACCESS_STORAGE',
      sessionId: accessLog.sessionId,
      knowledgeBaseId: accessLog.knowledgeBaseId,
      timestamp: accessLog.timestamp
    });
  }

  /**
   * Store audit trail (placeholder for database storage)
   */
  private static storeAuditTrail(auditEntry: AgentExecutionAudit): void {
    // In a real implementation, this would store to a secure audit database
    // For now, we just ensure it's logged
    logger.debug('Audit trail stored', {
      logType: 'AGENT_EXECUTION_AUDIT_STORAGE',
      sessionId: auditEntry.sessionId,
      agentId: auditEntry.agentId,
      timestamp: auditEntry.timestamp
    });
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Convenience functions for common data protection operations
 */
export const DataProtection = {
  /**
   * Sanitize user input before processing
   */
  sanitizeUserInput: (
    input: string,
    sessionId?: string
  ): SanitizationResult => {
    return DataProtectionService.sanitizeConversationData(input, sessionId);
  },

  /**
   * Sanitize system output before sending to user
   */
  sanitizeSystemOutput: (
    output: string,
    sessionId?: string
  ): SanitizationResult => {
    return DataProtectionService.sanitizeConversationData(output, sessionId);
  },

  /**
   * Log knowledge base query access
   */
  logKnowledgeQuery: (
    knowledgeBaseId: string,
    query: string,
    resultsCount: number,
    durationMs: number,
    success: boolean,
    sessionId: string,
    metadata?: Record<string, any>
  ) => {
    DataProtectionService.logKnowledgeBaseAccess(
      knowledgeBaseId,
      'query',
      query,
      resultsCount,
      durationMs,
      success,
      sessionId,
      undefined,
      metadata
    );
  },

  /**
   * Audit agent invocation
   */
  auditAgentInvocation: (
    agentId: string,
    agentAliasId: string,
    input: string,
    outputLength: number | undefined,
    durationMs: number,
    success: boolean,
    sessionId: string,
    errorType?: string,
    metadata?: Record<string, any>
  ) => {
    DataProtectionService.auditAgentExecution(
      agentId,
      agentAliasId,
      'invoke',
      input,
      outputLength,
      durationMs,
      success,
      sessionId,
      errorType,
      undefined,
      metadata
    );
  },

  /**
   * Configure data protection
   */
  configure: DataProtectionService.configure,

  /**
   * Generate session report
   */
  generateSessionReport: DataProtectionService.generateSessionDataProtectionReport
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
  DataProtectionService,
  SensitiveDataPattern,
  KnowledgeBaseAccessLog,
  AgentExecutionAudit,
  SanitizationResult,
  DataProtectionConfig
};

export default DataProtectionService;