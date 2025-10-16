/**
 * Configuration Change Event System
 * Provides typed events for configuration changes and hot-reload operations
 */

import { EventEmitter } from 'events';
import { ConfigChanges } from './IConfigurationManager';

export interface HotReloadResult {
  success: boolean;
  reloadedKeys: string[];
  skippedKeys: string[];
  errors: string[];
  requiresRestart: boolean;
}

export interface ConfigurationEventMap {
  // Configuration change events
  'configChanged': (changes: ConfigChanges) => void;
  'configValidationFailed': (errors: string[]) => void;
  'configValidationWarning': (warnings: string[]) => void;
  
  // Hot-reload events
  'hotReloadEnabled': () => void;
  'hotReloadDisabled': () => void;
  'hotReloadChangesDetected': (changes: ConfigChanges) => void;
  'hotReloadCompleted': (result: HotReloadResult) => void;
  'hotReloadRestartRequired': (result: HotReloadResult) => void;
  'hotReloadError': (error: Error) => void;
  
  // Watcher events
  'watchingStarted': () => void;
  'watchingStopped': () => void;
  'safeReloadKeyAdded': (key: string) => void;
  'safeReloadKeyRemoved': (key: string) => void;
}

/**
 * Typed event emitter for configuration events
 */
export class ConfigurationEventEmitter extends EventEmitter {
  // Override emit to provide type safety
  public emit<K extends keyof ConfigurationEventMap>(
    event: K,
    ...args: Parameters<ConfigurationEventMap[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  // Override on to provide type safety
  public on<K extends keyof ConfigurationEventMap>(
    event: K,
    listener: ConfigurationEventMap[K]
  ): this {
    return super.on(event, listener);
  }

  // Override once to provide type safety
  public once<K extends keyof ConfigurationEventMap>(
    event: K,
    listener: ConfigurationEventMap[K]
  ): this {
    return super.once(event, listener);
  }

  // Override off to provide type safety
  public off<K extends keyof ConfigurationEventMap>(
    event: K,
    listener: ConfigurationEventMap[K]
  ): this {
    return super.off(event, listener);
  }
}

/**
 * Configuration change notification system
 */
export class ConfigurationNotifier {
  private eventEmitter: ConfigurationEventEmitter;
  private subscribers: Map<string, Set<(changes: ConfigChanges) => void>> = new Map();

  constructor() {
    this.eventEmitter = new ConfigurationEventEmitter();
  }

  /**
   * Subscribe to configuration changes for specific keys
   */
  public subscribeToKeys(keys: string[], callback: (changes: ConfigChanges) => void): void {
    const subscriptionId = this.generateSubscriptionId();
    
    for (const key of keys) {
      if (!this.subscribers.has(key)) {
        this.subscribers.set(key, new Set());
      }
      this.subscribers.get(key)!.add(callback);
    }

    // Store subscription for cleanup
    (callback as any).__subscriptionId = subscriptionId;
    (callback as any).__subscribedKeys = keys;
  }

  /**
   * Unsubscribe from configuration changes
   */
  public unsubscribe(callback: (changes: ConfigChanges) => void): void {
    const subscriptionId = (callback as any).__subscriptionId;
    const subscribedKeys = (callback as any).__subscribedKeys;

    if (subscribedKeys) {
      for (const key of subscribedKeys) {
        const keySubscribers = this.subscribers.get(key);
        if (keySubscribers) {
          keySubscribers.delete(callback);
          if (keySubscribers.size === 0) {
            this.subscribers.delete(key);
          }
        }
      }
    }
  }

  /**
   * Notify subscribers of configuration changes
   */
  public notifyChanges(changes: ConfigChanges): void {
    const affectedKeys = [
      ...Object.keys(changes.added),
      ...Object.keys(changes.modified),
      ...changes.removed,
    ];

    const notifiedCallbacks = new Set<(changes: ConfigChanges) => void>();

    for (const key of affectedKeys) {
      const keySubscribers = this.subscribers.get(key);
      if (keySubscribers) {
        for (const callback of keySubscribers) {
          if (!notifiedCallbacks.has(callback)) {
            try {
              callback(changes);
              notifiedCallbacks.add(callback);
            } catch (error) {
              console.error(`Error in configuration change callback for key '${key}':`, error);
            }
          }
        }
      }
    }

    // Emit global change event
    this.eventEmitter.emit('configChanged', changes);
  }

  /**
   * Get the event emitter for direct event handling
   */
  public getEventEmitter(): ConfigurationEventEmitter {
    return this.eventEmitter;
  }

  /**
   * Get subscription statistics
   */
  public getSubscriptionStats(): {
    totalSubscriptions: number;
    keySubscriptions: Record<string, number>;
  } {
    const keySubscriptions: Record<string, number> = {};
    let totalSubscriptions = 0;

    for (const [key, subscribers] of this.subscribers.entries()) {
      keySubscriptions[key] = subscribers.size;
      totalSubscriptions += subscribers.size;
    }

    return {
      totalSubscriptions,
      keySubscriptions,
    };
  }

  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

// Export singleton instance
export const configurationNotifier = new ConfigurationNotifier();
export default configurationNotifier;