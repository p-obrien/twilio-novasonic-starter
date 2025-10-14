/**
 * Validation utilities for integration configuration
 */

import { 
  IntegrationConfig, 
  KnowledgeBaseConfig, 
  AgentConfig, 
  ThresholdConfig,
  ValidationResult 
} from '../types/IntegrationTypes';

/**
 * Comprehensive validator for integration configuration
 */
export class IntegrationConfigValidator {
  /**
   * Validate complete integration configuration
   * @param config Integration configuration to validate
   * @returns Validation result with errors and warnings
   */
  static validate(config: IntegrationConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate top-level configuration
    if (typeof config.enabled !== 'boolean') {
      errors.push('Integration enabled flag must be a boolean');
    }

    if (!Array.isArray(config.knowledgeBases)) {
      errors.push('Knowledge bases must be an array');
    } else {
      const kbValidation = this.validateKnowledgeBases(config.knowledgeBases);
      errors.push(...kbValidation.errors);
      warnings.push(...kbValidation.warnings);
    }

    if (!Array.isArray(config.agents)) {
      errors.push('Agents must be an array');
    } else {
      const agentValidation = this.validateAgents(config.agents);
      errors.push(...agentValidation.errors);
      warnings.push(...agentValidation.warnings);
    }

    if (!config.thresholds || typeof config.thresholds !== 'object') {
      errors.push('Thresholds configuration is required');
    } else {
      const thresholdValidation = this.validateThresholds(config.thresholds);
      errors.push(...thresholdValidation.errors);
      warnings.push(...thresholdValidation.warnings);
    }

    // Cross-validation warnings
    if (config.enabled && config.knowledgeBases.length === 0 && config.agents.length === 0) {
      warnings.push('Integration is enabled but no knowledge bases or agents are configured');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate knowledge base configurations
   * @param knowledgeBases Array of knowledge base configurations
   * @returns Validation result
   */
  private static validateKnowledgeBases(knowledgeBases: KnowledgeBaseConfig[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < knowledgeBases.length; i++) {
      const kb = knowledgeBases[i];
      const prefix = `Knowledge base [${i}]`;

      // Required fields
      if (!kb.id || typeof kb.id !== 'string' || kb.id.trim() === '') {
        errors.push(`${prefix}: id is required and must be a non-empty string`);
      } else {
        if (seenIds.has(kb.id)) {
          errors.push(`${prefix}: duplicate id "${kb.id}"`);
        }
        seenIds.add(kb.id);
      }

      if (!kb.knowledgeBaseId || typeof kb.knowledgeBaseId !== 'string' || kb.knowledgeBaseId.trim() === '') {
        errors.push(`${prefix}: knowledgeBaseId is required and must be a non-empty string`);
      } else {
        // Basic AWS ARN format validation
        if (!kb.knowledgeBaseId.match(/^[a-zA-Z0-9-_]+$/)) {
          warnings.push(`${prefix}: knowledgeBaseId "${kb.knowledgeBaseId}" may not be a valid AWS resource ID`);
        }
      }

      if (typeof kb.enabled !== 'boolean') {
        errors.push(`${prefix}: enabled must be a boolean`);
      }

      // Optional fields validation
      if (kb.name !== undefined && (typeof kb.name !== 'string' || kb.name.trim() === '')) {
        warnings.push(`${prefix}: name should be a non-empty string if provided`);
      }

      if (kb.domain !== undefined && (typeof kb.domain !== 'string' || kb.domain.trim() === '')) {
        warnings.push(`${prefix}: domain should be a non-empty string if provided`);
      }

      if (kb.priority !== undefined) {
        if (typeof kb.priority !== 'number' || kb.priority < 0 || !Number.isInteger(kb.priority)) {
          errors.push(`${prefix}: priority must be a non-negative integer`);
        }
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate agent configurations
   * @param agents Array of agent configurations
   * @returns Validation result
   */
  private static validateAgents(agents: AgentConfig[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const prefix = `Agent [${i}]`;

      // Required fields
      if (!agent.id || typeof agent.id !== 'string' || agent.id.trim() === '') {
        errors.push(`${prefix}: id is required and must be a non-empty string`);
      } else {
        if (seenIds.has(agent.id)) {
          errors.push(`${prefix}: duplicate id "${agent.id}"`);
        }
        seenIds.add(agent.id);
      }

      if (!agent.agentId || typeof agent.agentId !== 'string' || agent.agentId.trim() === '') {
        errors.push(`${prefix}: agentId is required and must be a non-empty string`);
      } else {
        // Basic AWS resource ID format validation
        if (!agent.agentId.match(/^[a-zA-Z0-9-_]+$/)) {
          warnings.push(`${prefix}: agentId "${agent.agentId}" may not be a valid AWS resource ID`);
        }
      }

      if (!agent.agentAliasId || typeof agent.agentAliasId !== 'string' || agent.agentAliasId.trim() === '') {
        errors.push(`${prefix}: agentAliasId is required and must be a non-empty string`);
      } else {
        // Basic AWS resource ID format validation
        if (!agent.agentAliasId.match(/^[a-zA-Z0-9-_]+$/)) {
          warnings.push(`${prefix}: agentAliasId "${agent.agentAliasId}" may not be a valid AWS resource ID`);
        }
      }

      if (typeof agent.enabled !== 'boolean') {
        errors.push(`${prefix}: enabled must be a boolean`);
      }

      // Optional fields validation
      if (agent.name !== undefined && (typeof agent.name !== 'string' || agent.name.trim() === '')) {
        warnings.push(`${prefix}: name should be a non-empty string if provided`);
      }

      if (agent.category !== undefined && (typeof agent.category !== 'string' || agent.category.trim() === '')) {
        warnings.push(`${prefix}: category should be a non-empty string if provided`);
      }

      if (agent.priority !== undefined) {
        if (typeof agent.priority !== 'number' || agent.priority < 0 || !Number.isInteger(agent.priority)) {
          errors.push(`${prefix}: priority must be a non-negative integer`);
        }
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate threshold configurations
   * @param thresholds Threshold configuration
   * @returns Validation result
   */
  private static validateThresholds(thresholds: ThresholdConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Intent confidence threshold
    if (typeof thresholds.intentConfidenceThreshold !== 'number') {
      errors.push('intentConfidenceThreshold must be a number');
    } else if (thresholds.intentConfidenceThreshold < 0 || thresholds.intentConfidenceThreshold > 1) {
      errors.push('intentConfidenceThreshold must be between 0 and 1');
    } else if (thresholds.intentConfidenceThreshold < 0.5) {
      warnings.push('intentConfidenceThreshold below 0.5 may result in poor classification accuracy');
    } else if (thresholds.intentConfidenceThreshold > 0.9) {
      warnings.push('intentConfidenceThreshold above 0.9 may be too restrictive');
    }

    // Knowledge query timeout
    if (typeof thresholds.knowledgeQueryTimeoutMs !== 'number') {
      errors.push('knowledgeQueryTimeoutMs must be a number');
    } else if (thresholds.knowledgeQueryTimeoutMs <= 0) {
      errors.push('knowledgeQueryTimeoutMs must be positive');
    } else if (thresholds.knowledgeQueryTimeoutMs < 1000) {
      warnings.push('knowledgeQueryTimeoutMs below 1000ms may be too short for reliable queries');
    } else if (thresholds.knowledgeQueryTimeoutMs > 30000) {
      warnings.push('knowledgeQueryTimeoutMs above 30000ms may impact conversation flow');
    }

    // Agent invocation timeout
    if (typeof thresholds.agentInvocationTimeoutMs !== 'number') {
      errors.push('agentInvocationTimeoutMs must be a number');
    } else if (thresholds.agentInvocationTimeoutMs <= 0) {
      errors.push('agentInvocationTimeoutMs must be positive');
    } else if (thresholds.agentInvocationTimeoutMs < 2000) {
      warnings.push('agentInvocationTimeoutMs below 2000ms may be too short for agent execution');
    } else if (thresholds.agentInvocationTimeoutMs > 60000) {
      warnings.push('agentInvocationTimeoutMs above 60000ms may impact conversation flow');
    }

    // Max retries
    if (typeof thresholds.maxRetries !== 'number') {
      errors.push('maxRetries must be a number');
    } else if (thresholds.maxRetries < 0 || !Number.isInteger(thresholds.maxRetries)) {
      errors.push('maxRetries must be a non-negative integer');
    } else if (thresholds.maxRetries > 5) {
      warnings.push('maxRetries above 5 may cause excessive delays in error scenarios');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }
}