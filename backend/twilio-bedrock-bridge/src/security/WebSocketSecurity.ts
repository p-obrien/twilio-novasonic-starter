/**
 * @fileoverview WebSocket Security Module
 * 
 * Provides comprehensive security validation for Twilio Media Streams WebSocket connections.
 * Implements multiple layers of protection including rate limiting, User-Agent validation,
 * parameter validation, and session state management.
 */

import http from 'http';
import logger from '../observability/logger';

interface ConnectionValidationResult {
    isValid: boolean;
    reason?: string;
    callSid?: string;
    accountSid?: string;
}

interface RateLimitEntry {
    attempts: number[];
    lastCleanup: number;
}

/**
 * Security manager for WebSocket connections
 */
export class WebSocketSecurityManager {
    private static instance: WebSocketSecurityManager;
    private connectionAttempts = new Map<string, RateLimitEntry>();
    private activeCallSessions = new Set<string>();
    private readonly MAX_CONNECTIONS_PER_MINUTE = 10;
    private readonly RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
    private readonly CLEANUP_INTERVAL_MS = 300000; // 5 minutes

    private cleanupTimer?: NodeJS.Timeout;

    private constructor() {
        // Periodic cleanup of old rate limit entries
        this.cleanupTimer = setInterval(() => {
            this.cleanupRateLimitEntries();
        }, this.CLEANUP_INTERVAL_MS);

        // Unref the timer so it doesn't keep the process alive
        this.cleanupTimer.unref();
    }

    public static getInstance(): WebSocketSecurityManager {
        if (!WebSocketSecurityManager.instance) {
            WebSocketSecurityManager.instance = new WebSocketSecurityManager();
        }
        return WebSocketSecurityManager.instance;
    }

    /**
     * Add an active call session (called from webhook handler)
     */
    public addActiveSession(callSid: string): void {
        this.activeCallSessions.add(callSid);
        logger.debug('Added active call session', { callSid });
    }

    /**
     * Remove an active call session (called when call ends)
     */
    public removeActiveSession(callSid: string): void {
        this.activeCallSessions.delete(callSid);
        logger.debug('Removed active call session', { callSid });
    }

    /**
     * Check if a call session is active
     */
    public isSessionActive(callSid: string): boolean {
        return this.activeCallSessions.has(callSid);
    }

    /**
     * Validate a WebSocket message contains valid Twilio parameters
     * This is called after the WebSocket connection is established to validate the actual call
     */
    public validateWebSocketMessage(message: any): {
        isValid: boolean;
        reason?: string;
        callSid?: string;
    } {
        try {
            // For Twilio 'start' events, validate the CallSid
            if (message.event === 'start' && message.start) {
                const callSid = message.start.callSid;
                
                if (!callSid || !callSid.startsWith('CA') || callSid.length !== 34) {
                    return {
                        isValid: false,
                        reason: 'Invalid CallSid format in start message'
                    };
                }

                if (!this.isSessionActive(callSid)) {
                    return {
                        isValid: false,
                        reason: 'No active call session found for CallSid'
                    };
                }

                return {
                    isValid: true,
                    callSid
                };
            }

            // For other message types, we assume they're valid if we get here
            return { isValid: true };
        } catch (error) {
            logger.warn('Error validating WebSocket message', { error, messageType: message?.event });
            return {
                isValid: false,
                reason: 'Error parsing WebSocket message'
            };
        }
    }



    /**
     * Check if client IP is rate limited
     */
    private isRateLimited(clientIP: string): boolean {
        const now = Date.now();
        const entry = this.connectionAttempts.get(clientIP);

        if (!entry) {
            this.connectionAttempts.set(clientIP, {
                attempts: [now],
                lastCleanup: now
            });
            return false;
        }

        // Clean up old attempts
        entry.attempts = entry.attempts.filter(time => now - time < this.RATE_LIMIT_WINDOW_MS);

        // Check if rate limited
        if (entry.attempts.length >= this.MAX_CONNECTIONS_PER_MINUTE) {
            logger.warn('Rate limit exceeded', {
                clientIP,
                attempts: entry.attempts.length,
                windowMs: this.RATE_LIMIT_WINDOW_MS
            });
            return true;
        }

        // Add current attempt
        entry.attempts.push(now);
        entry.lastCleanup = now;

        return false;
    }

    /**
     * Validate Twilio User-Agent header
     */
    private validateTwilioUserAgent(userAgent: string): boolean {
        // Twilio Media Streams typically use specific User-Agent patterns
        const twilioPatterns = [
            /^TwilioMediaStreams\//,
            /^Twilio\//,
            /TwilioProxy/,
            /^Twilio\.TmeWs\//
        ];

        return twilioPatterns.some(pattern => pattern.test(userAgent));
    }



    /**
     * Comprehensive validation of Twilio Media Stream connection
     */
    public validateConnection(req: http.IncomingMessage): ConnectionValidationResult {
        const clientIP = req.socket.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || '';

        // 1. Rate limiting check
        if (this.isRateLimited(clientIP)) {
            return {
                isValid: false,
                reason: 'Rate limit exceeded'
            };
        }

        // 2. User-Agent validation
        if (!this.validateTwilioUserAgent(userAgent)) {
            return {
                isValid: false,
                reason: 'Invalid or missing User-Agent header'
            };
        }

        // 3. For Twilio Media Streams, CallSid/AccountSid are sent in WebSocket messages
        // after connection, not as URL parameters. We validate the User-Agent and rate limiting
        // at connection time, then validate the actual call parameters in the 'start' message.
        
        logger.info('WebSocket connection validated successfully (parameters will be validated in start message)', {
            clientIP,
            userAgent
        });

        return {
            isValid: true
        };
    }

    /**
     * Clean up old rate limit entries
     */
    private cleanupRateLimitEntries(): void {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [ip, entry] of this.connectionAttempts.entries()) {
            // Remove entries that haven't been accessed recently
            if (now - entry.lastCleanup > this.CLEANUP_INTERVAL_MS) {
                this.connectionAttempts.delete(ip);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logger.debug('Cleaned up rate limit entries', { cleanedCount });
        }
    }

    /**
     * Get security statistics
     */
    public getSecurityStats(): {
        activeConnections: number;
        rateLimitEntries: number;
        activeSessions: number;
    } {
        return {
            activeConnections: 0, // This would be tracked separately
            rateLimitEntries: this.connectionAttempts.size,
            activeSessions: this.activeCallSessions.size
        };
    }

    /**
     * Clear rate limiting entries (for testing)
     */
    public clearRateLimiting(): void {
        this.connectionAttempts.clear();
    }

    /**
     * Cleanup resources (for testing)
     */
    public cleanup(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        this.connectionAttempts.clear();
        this.activeCallSessions.clear();
    }
}

export const webSocketSecurity = WebSocketSecurityManager.getInstance();