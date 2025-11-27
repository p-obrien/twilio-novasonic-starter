/**
 * @fileoverview Client Module Exports
 *
 * Exports the Nova Sonic bidirectional stream client.
 * Provides both named and default exports for convenience.
 */

// Export the main client class and configuration types
export {
  NovaSonicBidirectionalStreamClient,
  NovaSonicBidirectionalStreamClientConfig
} from '../client';

// Re-export as NovaSonicClient for backward compatibility
export {
  NovaSonicBidirectionalStreamClient as NovaSonicClient,
  NovaSonicBidirectionalStreamClientConfig as NovaSonicClientConfig
} from '../client';

// Factory function for creating clients
import { NovaSonicBidirectionalStreamClient as Client, NovaSonicBidirectionalStreamClientConfig as Config } from '../client';

export function createNovaSonicClient(config: Config): Client {
  return new Client(config);
}

// Default export
export { NovaSonicBidirectionalStreamClient as default } from '../client';