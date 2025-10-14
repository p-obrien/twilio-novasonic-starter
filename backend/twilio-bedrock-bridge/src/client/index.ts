/**
 * @fileoverview Client Module Exports
 * 
 * Exports the enhanced Nova Sonic client as the primary client.
 * The base client is still available internally but not exposed.
 */

// Export the enhanced client as the primary and only client
export {
  NovaSonicClient,
  createNovaSonicClient,
  type NovaSonicClientConfig,
  type TextProcessingResult,
} from './NovaSonicClient';

// Backward compatibility exports - all point to the enhanced client
export {
  NovaSonicClient as EnhancedNovaSonicClient,
  createNovaSonicClient as createEnhancedNovaSonicClient,
  type NovaSonicClientConfig as EnhancedNovaSonicClientConfig,
  NovaSonicClient as NovaSonicBidirectionalStreamClient,
  createNovaSonicClient as createNovaSonicBidirectionalStreamClient,
  type NovaSonicClientConfig as NovaSonicBidirectionalStreamClientConfig,
} from './NovaSonicClient';

// Default export is the enhanced client
export { NovaSonicClient as default } from './NovaSonicClient';