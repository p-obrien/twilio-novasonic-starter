/**
 * @fileoverview Orchestrator Integration Utilities
 * 
 * This module provides utility functions and examples for integrating the
 * conversation orchestrator with existing Nova Sonic workflows.
 * 
 * Key Features:
 * - Example integration patterns
 * - Utility functions for common orchestrator operations
 * - Backward compatibility helpers
 * 
 * @author Twilio Bedrock Bridge Team
 * @version 1.0.0
 */

import logger from '../observability/logger';
import { CorrelationIdManager } from './correlationId';
import { ConversationContext } from '../types/SharedTypes';
import { NovaSonicClient as EnhancedNovaSonicClient, TextProcessingResult } from '../client/';
import { config } from '../config/AppConfig';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Process text input with orchestrator integration
 * This is a utility function that can be used throughout the application
 * to leverage orchestrator capabilities while maintaining backward compatibility.
 * 
 * @param client The enhanced Nova Sonic client
 * @param input Text input to process
 * @param sessionId Session identifier
 * @param context Optional conversation context
 * @returns Promise resolving to processing result
 */
export async function processTextWithOrchestrator(
  client: EnhancedNovaSonicClient,
  input: string,
  sessionId: string,
  context?: Partial<ConversationContext>
): Promise<TextProcessingResult> {
  const correlationId = CorrelationIdManager.getCurrentCorrelationId();
  
  logger.debug('Processing text with orchestrator integration', {
    correlationId,
    sessionId,
    inputLength: input.length,
    hasContext: !!context,
    orchestratorEnabled: client.isOrchestratorEnabled(),
  });

  try {
    if (client.isOrchestratorEnabled()) {
      return await client.processTextInput(input, sessionId, context);
    } else {
      // Fallback to basic response when orchestrator is not available
      logger.info('Orchestrator not enabled, using fallback response', {
        correlationId,
        sessionId,
      });

      return {
        response: generateFallbackResponse(input),
        source: 'fallback',
        sessionId,
        metadata: {
          fallbackReason: 'orchestrator_disabled',
        },
      };
    }
  } catch (error) {
    logger.error('Text processing failed', {
      correlationId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      response: 'I apologize, but I encountered an issue processing your request. Please try again.',
      source: 'fallback',
      sessionId,
      metadata: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Check if orchestrator features are available
 * 
 * @param client The enhanced Nova Sonic client
 * @returns True if orchestrator is available and enabled
 */
export function isOrchestratorAvailable(client: EnhancedNovaSonicClient): boolean {
  return client.isOrchestratorEnabled() && config.integration.enabled;
}

/**
 * Get orchestrator capabilities summary
 * 
 * @param client The enhanced Nova Sonic client
 * @returns Object describing available capabilities
 */
export function getOrchestratorCapabilities(client: EnhancedNovaSonicClient): {
  orchestratorEnabled: boolean;
  knowledgeBaseEnabled: boolean;
  agentCoreEnabled: boolean;
  integrationEnabled: boolean;
} {
  const integrationConfig = config.integration;
  
  return {
    orchestratorEnabled: client.isOrchestratorEnabled(),
    knowledgeBaseEnabled: integrationConfig.enabled && 
                         integrationConfig.knowledgeBases.some((kb: any) => kb.enabled),
    agentCoreEnabled: integrationConfig.enabled && 
                     integrationConfig.agents.some((agent: any) => agent.enabled),
    integrationEnabled: integrationConfig.enabled,
  };
}

/**
 * Create conversation context from session information
 * 
 * @param sessionId Session identifier
 * @param streamSid Optional Twilio stream SID
 * @param callSid Optional Twilio call SID
 * @returns Conversation context object
 */
export function createConversationContext(
  sessionId: string,
  streamSid?: string,
  callSid?: string
): Partial<ConversationContext> {
  return {
    sessionId,
    streamSid,
    metadata: {
      callSid,
      createdAt: new Date().toISOString(),
      correlationId: CorrelationIdManager.getCurrentCorrelationId(),
    },
  };
}

// ============================================================================
// EXAMPLE INTEGRATION PATTERNS
// ============================================================================

/**
 * Example: Process DTMF input through orchestrator
 * This shows how DTMF commands can trigger different orchestrator routes
 * 
 * @param client The enhanced Nova Sonic client
 * @param dtmfDigit The DTMF digit pressed
 * @param sessionId Session identifier
 * @returns Promise resolving to response text
 */
export async function processDTMFCommand(
  client: EnhancedNovaSonicClient,
  dtmfDigit: string,
  sessionId: string
): Promise<string> {
  if (!isOrchestratorAvailable(client)) {
    return 'DTMF commands are not available at this time.';
  }

  // Map DTMF digits to text commands that will be routed appropriately
  const dtmfCommands: Record<string, string> = {
    '1': 'What information do you have available?', // Should route to knowledge base
    '2': 'Help me with a task', // Should route to agent
    '3': 'Tell me about your capabilities', // Should route to conversation
    '0': 'Connect me to a human agent', // Should route to agent
    '*': 'Repeat the last response', // Should route to conversation
    '#': 'End this conversation', // Should route to conversation
  };

  const command = dtmfCommands[dtmfDigit];
  if (!command) {
    return `I don't recognize the command for digit ${dtmfDigit}. Try pressing 1 for information, 2 for help with tasks, or 3 to learn about my capabilities.`;
  }

  logger.info('Processing DTMF command through orchestrator', {
    sessionId,
    dtmfDigit,
    command,
  });

  const result = await processTextWithOrchestrator(client, command, sessionId);
  return result.response;
}

/**
 * Example: Process webhook text input
 * This shows how text from webhooks (like SMS or chat) can be processed
 * 
 * @param client The enhanced Nova Sonic client
 * @param textInput The text input from webhook
 * @param sessionId Session identifier
 * @param source The source of the text (e.g., 'sms', 'chat', 'webhook')
 * @returns Promise resolving to response text
 */
export async function processWebhookText(
  client: EnhancedNovaSonicClient,
  textInput: string,
  sessionId: string,
  source: string = 'webhook'
): Promise<string> {
  logger.info('Processing webhook text through orchestrator', {
    sessionId,
    source,
    inputLength: textInput.length,
  });

  const context = createConversationContext(sessionId);
  context.metadata = {
    ...context.metadata,
    source,
    inputType: 'text',
  };

  const result = await processTextWithOrchestrator(client, textInput, sessionId, context);
  
  logger.info('Webhook text processed', {
    sessionId,
    source: result.source,
    responseLength: result.response.length,
  });

  return result.response;
}

// ============================================================================
// PRIVATE HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a fallback response when orchestrator is not available
 */
function generateFallbackResponse(input: string): string {
  const inputLower = input.toLowerCase().trim();
  
  // Provide contextual fallback responses
  if (inputLower.includes('help') || inputLower.includes('assist')) {
    return 'I\'d like to help you, but my advanced assistance features are currently unavailable. Please try again later or contact support.';
  }
  
  if (inputLower.includes('information') || inputLower.includes('know') || inputLower.includes('tell me')) {
    return 'I understand you\'re looking for information. My knowledge base features are currently unavailable, but I\'m here to help in other ways.';
  }
  
  if (inputLower.includes('task') || inputLower.includes('do') || inputLower.includes('action')) {
    return 'I see you\'d like me to help with a task. My task assistance features are currently unavailable, but please let me know if there\'s another way I can help.';
  }
  
  // Generic fallback
  return 'I understand your message. My advanced features are currently unavailable, but I\'m here to help in whatever way I can.';
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  processTextWithOrchestrator,
  isOrchestratorAvailable,
  getOrchestratorCapabilities,
  createConversationContext,
  processDTMFCommand,
  processWebhookText,
};