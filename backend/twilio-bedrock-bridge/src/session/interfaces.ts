/**
 * @fileoverview Unified Session Interfaces
 * 
 * Defines unified interfaces for session management to ensure consistent
 * behavior across all session types and provide a foundation for
 * consolidated session lifecycle management.
 */

import { InferenceConfig } from '../types/SharedTypes';
import { EventHandler, StreamEventType, AudioStreamOptions } from '../types/ClientTypes';

/**
 * Session statistics for monitoring and diagnostics
 */
export interface SessionStats {
  /** Session creation timestamp */
  readonly createdAt: number;
  
  /** Last activity timestamp */
  readonly lastActivity: number;
  
  /** Total number of operations performed */
  readonly operationCount: number;
  
  /** Total number of errors encountered */
  readonly errorCount: number;
  
  /** Current memory usage in bytes */
  readonly memoryUsage: number;
  
  /** Session duration in milliseconds */
  readonly duration: number;
}

/**
 * Session diagnostics information for debugging and monitoring
 */
export interface SessionDiagnostics {
  /** Basic session information */
  readonly sessionInfo: {
    readonly sessionId: string;
    readonly isActive: boolean;
    readonly correlationId?: string;
    readonly createdAt: number;
  };
  
  /** Performance metrics */
  readonly performance: {
    readonly isProcessing: boolean;
    readonly hasScheduledProcessing: boolean;
    readonly memoryPressure: boolean;
    readonly operationCount: number;
    readonly errorCount: number;
  };
  
  /** Memory usage statistics */
  readonly memoryStats: {
    readonly inputBufferBytes: number;
    readonly outputBufferBytes: number;
    readonly totalBufferBytes: number;
    readonly memoryPressure: boolean;
    readonly utilizationPercent: number;
  };
  
  /** Error statistics */
  readonly errorStats?: {
    readonly totalErrors: number;
    readonly lastErrorCategory?: string;
    readonly lastErrorSeverity?: string;
    readonly hasRecentErrors: boolean;
  };
  
  /** Configuration details */
  readonly configuration: SessionConfig;
}

/**
 * Session configuration parameters
 */
export interface SessionConfig {
  /** Unique session identifier */
  readonly sessionId: string;
  
  /** Maximum queue size for operations */
  readonly maxQueueSize: number;
  
  /** Processing timeout in milliseconds */
  readonly processingTimeout: number;
  
  /** Whether metrics collection is enabled */
  readonly enableMetrics: boolean;
  
  /** Audio streaming options */
  readonly audioOptions?: AudioStreamOptions;
  
  /** Model inference configuration */
  readonly inferenceConfig?: InferenceConfig;
  
  /** Correlation context for tracing */
  readonly correlationContext?: {
    readonly correlationId: string;
    readonly parentId?: string;
    readonly traceId?: string;
  };
}

/**
 * Unified session interface that all session types must implement
 */
export interface ISession {
  /** Unique session identifier */
  readonly sessionId: string;
  
  /** Whether the session is currently active */
  readonly isActive: boolean;
  
  /** Session creation timestamp */
  readonly createdAt: number;
  
  /**
   * Registers an event handler for this session
   * @param eventType - Type of event to listen for
   * @param handler - Function to handle the event
   * @returns This session instance for method chaining
   */
  onEvent(eventType: StreamEventType, handler: EventHandler): ISession;
  
  /**
   * Closes the session and cleans up all resources
   * @returns Promise that resolves when cleanup is complete
   */
  close(): Promise<void>;
  
  /**
   * Gets current session statistics
   * @returns Current session statistics
   */
  getStats(): SessionStats;
  
  /**
   * Gets comprehensive diagnostics information
   * @returns Detailed diagnostics data
   */
  getDiagnostics(): SessionDiagnostics;
  
  /**
   * Gets session configuration
   * @returns Session configuration object
   */
  getConfig(): SessionConfig;
  
  /**
   * Updates session activity timestamp
   */
  updateActivity(): void;
  
  /**
   * Checks if session has been idle for specified duration
   * @param timeoutMs - Idle timeout in milliseconds
   * @returns True if session has been idle longer than timeout
   */
  isIdle(timeoutMs: number): boolean;
}

/**
 * Session creation options
 */
export interface SessionCreationOptions {
  /** Custom session ID (auto-generated if not provided) */
  sessionId?: string;
  
  /** Maximum queue size for operations */
  maxQueueSize?: number;
  
  /** Processing timeout in milliseconds */
  processingTimeout?: number;
  
  /** Whether to enable metrics collection */
  enableMetrics?: boolean;
  
  /** Audio streaming options */
  audioOptions?: AudioStreamOptions;
  
  /** Model inference configuration */
  inferenceConfig?: InferenceConfig;
  
  /** Correlation context for tracing */
  correlationContext?: {
    correlationId: string;
    parentId?: string;
    traceId?: string;
  };
}

/**
 * Session cleanup result information
 */
export interface SessionCleanupResult {
  /** Session ID that was cleaned up */
  readonly sessionId: string;
  
  /** Whether cleanup was successful */
  readonly success: boolean;
  
  /** Cleanup duration in milliseconds */
  readonly duration: number;
  
  /** Resources that were cleaned up */
  readonly cleanedResources: {
    readonly buffersCleared: number;
    readonly handlersRemoved: number;
    readonly timeoutsCleared: number;
  };
  
  /** Any errors encountered during cleanup */
  readonly errors?: Error[];
}

/**
 * Unified session manager interface for managing multiple sessions
 */
export interface ISessionManager<T extends ISession> {
  /**
   * Creates a new session with the specified configuration
   * @param options - Session creation options
   * @returns The created session instance
   */
  createSession(options: SessionCreationOptions): T;
  
  /**
   * Retrieves a session by ID
   * @param sessionId - Session identifier
   * @returns Session instance or undefined if not found
   */
  getSession(sessionId: string): T | undefined;
  
  /**
   * Removes a session and cleans up its resources
   * @param sessionId - Session identifier
   * @returns Promise that resolves with cleanup result
   */
  removeSession(sessionId: string): Promise<SessionCleanupResult>;
  
  /**
   * Gets all active sessions
   * @returns Array of active session instances
   */
  getAllSessions(): T[];
  
  /**
   * Gets all active session IDs
   * @returns Array of active session IDs
   */
  getActiveSessionIds(): string[];
  
  /**
   * Checks if a session exists and is active
   * @param sessionId - Session identifier
   * @returns True if session exists and is active
   */
  isSessionActive(sessionId: string): boolean;
  
  /**
   * Cleans up idle sessions based on timeout
   * @param idleTimeoutMs - Idle timeout in milliseconds
   * @returns Promise that resolves with array of cleanup results
   */
  cleanupIdleSessions(idleTimeoutMs: number): Promise<SessionCleanupResult[]>;
  
  /**
   * Performs complete cleanup of all sessions
   * @returns Promise that resolves with array of cleanup results
   */
  cleanup(): Promise<SessionCleanupResult[]>;
  
  /**
   * Gets manager statistics
   * @returns Manager statistics including session counts and resource usage
   */
  getManagerStats(): {
    readonly totalSessions: number;
    readonly activeSessions: number;
    readonly idleSessions: number;
    readonly totalMemoryUsage: number;
    readonly averageSessionAge: number;
  };
}

/**
 * Base session class that provides common functionality for all session types
 */
export abstract class BaseSession implements ISession {
  protected readonly config: SessionConfig;
  protected readonly createdAtTimestamp: number;
  protected lastActivityTimestamp: number;
  protected operationCounter: number = 0;
  protected errorCounter: number = 0;
  protected isSessionActive: boolean = true;
  protected eventHandlers: Map<StreamEventType, EventHandler[]> = new Map();

  constructor(config: SessionConfig) {
    this.config = { ...config };
    this.createdAtTimestamp = Date.now();
    this.lastActivityTimestamp = this.createdAtTimestamp;
  }

  get sessionId(): string {
    return this.config.sessionId;
  }

  get isActive(): boolean {
    return this.isSessionActive;
  }

  get createdAt(): number {
    return this.createdAtTimestamp;
  }

  public onEvent(eventType: StreamEventType, handler: EventHandler): ISession {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
    return this;
  }

  public updateActivity(): void {
    this.lastActivityTimestamp = Date.now();
    this.operationCounter++;
  }

  public isIdle(timeoutMs: number): boolean {
    return Date.now() - this.lastActivityTimestamp > timeoutMs;
  }

  public getStats(): SessionStats {
    return {
      createdAt: this.createdAtTimestamp,
      lastActivity: this.lastActivityTimestamp,
      operationCount: this.operationCounter,
      errorCount: this.errorCounter,
      memoryUsage: this.calculateMemoryUsage(),
      duration: Date.now() - this.createdAtTimestamp,
    };
  }

  public getConfig(): SessionConfig {
    return { ...this.config };
  }

  public abstract close(): Promise<void>;
  public abstract getDiagnostics(): SessionDiagnostics;
  
  protected abstract calculateMemoryUsage(): number;
  
  protected incrementErrorCount(): void {
    this.errorCounter++;
  }
  
  protected emitEvent(eventType: StreamEventType, data: unknown): void {
    const handlers = this.eventHandlers.get(eventType) || [];
    const anyHandlers = this.eventHandlers.get('any') || [];
    
    [...handlers, ...anyHandlers].forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        this.incrementErrorCount();
        // Log error but don't throw to prevent cascading failures
        console.error(`Error in event handler for ${eventType}:`, error);
      }
    });
  }
}