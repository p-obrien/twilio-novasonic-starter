/**
 * @fileoverview Knowledge Base Integration Module
 * 
 * This module provides knowledge base integration capabilities for the
 * Twilio Bedrock Bridge service, enabling AI voice conversations to
 * access structured knowledge sources through AWS Bedrock Knowledge Base.
 */

export {
  KnowledgeBaseClient,
  createKnowledgeBaseClient,
  type IKnowledgeBaseClient,
  type KnowledgeBaseClientConfig,
  KnowledgeBaseError,
} from './KnowledgeBaseClient';

export {
  KnowledgeBaseService,
  createKnowledgeBaseService,
  type VoiceKnowledgeResponse,
  type KnowledgeQueryOptions,
  KnowledgeServiceError,
} from './KnowledgeBaseService';

export {
  type KnowledgeResult,
  type ValidationResult,
} from '../types/IntegrationTypes';