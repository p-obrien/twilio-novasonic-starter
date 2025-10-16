/**
 * @fileoverview Client Module Exports
 * 
 * Exports the enhanced Nova Sonic client as the primary client.
 * The base client is still available internally but not exposed.
 */

// For now, export the bidirectional stream client directly as NovaSonicClient
// This maintains compatibility with existing code while we work on the enhanced wrapper
export { 
  NovaSonicBidirectionalStreamClient as NovaSonicClient,
  NovaSonicBidirectionalStreamClientConfig as NovaSonicClientConfig
} from '../client';

// Export the TextProcessingResult type from the enhanced client
export { TextProcessingResult } from './NovaSonicClient';

// Factory function for creating clients
export function createNovaSonicClient(config: any) {
  const { NovaSonicBidirectionalStreamClient } = require('../client');
  return new NovaSonicBidirectionalStreamClient(config);
}

// Default export
export { NovaSonicBidirectionalStreamClient as default } from '../client';