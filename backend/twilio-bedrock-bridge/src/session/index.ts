/**
 * @fileoverview Session Management Module Exports
 * 
 * Exports unified session management components and maintains
 * backward compatibility with legacy components.
 */

// Export unified session management components
export { 
  ISession, 
  ISessionManager, 
  BaseSession,
  SessionConfig, 
  SessionCreationOptions, 
  SessionStats, 
  SessionDiagnostics,
  SessionCleanupResult 
} from './interfaces';

export { BaseSessionManager } from './BaseSessionManager';
export { UnifiedStreamSession, StreamClientInterface } from './UnifiedStreamSession';
export { UnifiedSessionManager, SessionData } from './UnifiedSessionManager';
export { 
  SessionErrorHandler, 
  ErrorSeverity, 
  ErrorCategory,
  SessionErrorContext,
  RetryConfig,
  DEFAULT_RETRY_CONFIG 
} from './SessionErrorHandler';

// Export resource-aware session management
export { 
  ResourceAwareSession, 
  ResourceAwareSessionConfig,
  SessionResourceStats 
} from './ResourceAwareSession';

// Export legacy components for backward compatibility
export { SessionManager } from './SessionManager';
export { StreamSession } from './StreamSession';