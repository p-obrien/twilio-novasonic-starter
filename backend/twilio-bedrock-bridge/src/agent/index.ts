/**
 * @fileoverview Agent module exports
 * 
 * Provides access to agent-related functionality including
 * the AgentCoreClient for Bedrock Agent integration.
 */

export { 
  AgentCoreClient, 
  createAgentCoreClient,
  type IAgentCoreClient,
  type AgentCoreClientConfig,
  AgentCoreError
} from './AgentCoreClient';