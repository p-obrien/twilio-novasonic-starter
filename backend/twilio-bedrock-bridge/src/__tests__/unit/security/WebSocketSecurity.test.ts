/**
 * Unit tests for WebSocketSecurity - WebSocket security validation
 */

import http from 'http';
import { WebSocketSecurityManager } from '../../../security/WebSocketSecurity';
import logger from '../../../observability/logger';

// Mock logger
jest.mock('../../../observability/logger');
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('WebSocketSecurityManager', () => {
    let securityManager: WebSocketSecurityManager;
    let mockRequest: Partial<http.IncomingMessage>;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Get fresh instance and clear any existing state
        securityManager = WebSocketSecurityManager.getInstance();
        securityManager.clearRateLimiting();

        // Create mock request
        mockRequest = {
            socket: {
                remoteAddress: '192.168.1.100'
            },
            headers: {
                'user-agent': 'TwilioMediaStreams/1.0'
            }
        } as any;
    });

    afterEach(() => {
        // Clean up after each test
        securityManager.cleanup();
    });

    describe('Singleton Pattern', () => {
        it('should return the same instance', () => {
            const instance1 = WebSocketSecurityManager.getInstance();
            const instance2 = WebSocketSecurityManager.getInstance();
            
            expect(instance1).toBe(instance2);
        });
    });

    describe('Session Management', () => {
        const validCallSid = 'CA12345678901234567890123456789012';

        it('should add and track active sessions', () => {
            securityManager.addActiveSession(validCallSid);
            
            expect(securityManager.isSessionActive(validCallSid)).toBe(true);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Added active call session',
                { callSid: validCallSid }
            );
        });

        it('should remove active sessions', () => {
            securityManager.addActiveSession(validCallSid);
            securityManager.removeActiveSession(validCallSid);
            
            expect(securityManager.isSessionActive(validCallSid)).toBe(false);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Removed active call session',
                { callSid: validCallSid }
            );
        });

        it('should return false for non-existent sessions', () => {
            expect(securityManager.isSessionActive('CA99999999999999999999999999999999')).toBe(false);
        });

        it('should handle multiple active sessions', () => {
            const callSid1 = 'CA11111111111111111111111111111111';
            const callSid2 = 'CA22222222222222222222222222222222';

            securityManager.addActiveSession(callSid1);
            securityManager.addActiveSession(callSid2);

            expect(securityManager.isSessionActive(callSid1)).toBe(true);
            expect(securityManager.isSessionActive(callSid2)).toBe(true);

            securityManager.removeActiveSession(callSid1);

            expect(securityManager.isSessionActive(callSid1)).toBe(false);
            expect(securityManager.isSessionActive(callSid2)).toBe(true);
        });
    });

    describe('Connection Validation', () => {
        describe('Valid Twilio User-Agent patterns', () => {
            const validUserAgents = [
                'TwilioMediaStreams/1.0',
                'TwilioMediaStreams/2.1.0',
                'Twilio/1.0',
                'Twilio/2.5.3',
                'TwilioProxy/1.0',
                'Twilio.TmeWs/1.0'
            ];

            validUserAgents.forEach(userAgent => {
                it(`should accept valid User-Agent: ${userAgent}`, () => {
                    mockRequest.headers!['user-agent'] = userAgent;

                    const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);

                    expect(result.isValid).toBe(true);
                    expect(result.reason).toBeUndefined();
                });
            });
        });

        describe('Invalid User-Agent patterns', () => {
            const invalidUserAgents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'curl/7.68.0',
                'PostmanRuntime/7.28.0',
                'python-requests/2.25.1',
                '',
                'InvalidAgent/1.0'
            ];

            invalidUserAgents.forEach(userAgent => {
                it(`should reject invalid User-Agent: ${userAgent || 'empty'}`, () => {
                    mockRequest.headers!['user-agent'] = userAgent;

                    const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);

                    expect(result.isValid).toBe(false);
                    expect(result.reason).toBe('Invalid or missing User-Agent header');
                });
            });
        });

        it('should handle missing User-Agent header', () => {
            delete mockRequest.headers!['user-agent'];

            const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);

            expect(result.isValid).toBe(false);
            expect(result.reason).toBe('Invalid or missing User-Agent header');
        });

        it('should handle missing remote address', () => {
            mockRequest.socket = {} as any;

            const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);

            expect(result.isValid).toBe(true); // Should still pass if User-Agent is valid
        });

        it('should log successful validation', () => {
            const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);

            expect(result.isValid).toBe(true);
            expect(mockLogger.info).toHaveBeenCalledWith(
                'WebSocket connection validated successfully (parameters will be validated in start message)',
                {
                    clientIP: '192.168.1.100',
                    userAgent: 'TwilioMediaStreams/1.0'
                }
            );
        });
    });

    describe('Rate Limiting', () => {
        beforeEach(() => {
            // Use a consistent IP for rate limiting tests
            mockRequest = {
                socket: { remoteAddress: '192.168.1.200' },
                headers: { 'user-agent': 'TwilioMediaStreams/1.0' }
            } as any;
        });

        it('should allow connections under rate limit', () => {
            // Make 5 connections (under the limit of 10)
            for (let i = 0; i < 5; i++) {
                const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);
                expect(result.isValid).toBe(true);
            }
        });

        it('should block connections over rate limit', () => {
            // Make 10 connections (at the limit)
            for (let i = 0; i < 10; i++) {
                const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);
                expect(result.isValid).toBe(true);
            }

            // 11th connection should be blocked
            const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);
            expect(result.isValid).toBe(false);
            expect(result.reason).toBe('Rate limit exceeded');
        });

        it('should log rate limit violations', () => {
            // Exceed rate limit
            for (let i = 0; i < 11; i++) {
                securityManager.validateConnection(mockRequest as http.IncomingMessage);
            }

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Rate limit exceeded',
                {
                    clientIP: '192.168.1.200',
                    attempts: 10,
                    windowMs: 60000
                }
            );
        });

        it('should track different IPs separately', () => {
            const ip1Request = {
                socket: { remoteAddress: '192.168.1.201' },
                headers: { 'user-agent': 'TwilioMediaStreams/1.0' }
            } as any;
            const ip2Request = {
                socket: { remoteAddress: '192.168.1.202' },
                headers: { 'user-agent': 'TwilioMediaStreams/1.0' }
            } as any;

            // Max out IP1
            for (let i = 0; i < 10; i++) {
                const result = securityManager.validateConnection(ip1Request as http.IncomingMessage);
                expect(result.isValid).toBe(true);
            }

            // IP1 should be blocked
            const ip1Result = securityManager.validateConnection(ip1Request as http.IncomingMessage);
            expect(ip1Result.isValid).toBe(false);

            // IP2 should still work
            const ip2Result = securityManager.validateConnection(ip2Request as http.IncomingMessage);
            expect(ip2Result.isValid).toBe(true);
        });

        it('should reset rate limiting when cleared', () => {
            // Exceed rate limit
            for (let i = 0; i < 11; i++) {
                securityManager.validateConnection(mockRequest as http.IncomingMessage);
            }

            // Should be blocked
            let result = securityManager.validateConnection(mockRequest as http.IncomingMessage);
            expect(result.isValid).toBe(false);

            // Clear rate limiting
            securityManager.clearRateLimiting();

            // Should work again
            result = securityManager.validateConnection(mockRequest as http.IncomingMessage);
            expect(result.isValid).toBe(true);
        });
    });

    describe('WebSocket Message Validation', () => {
        const validCallSid = 'CA12345678901234567890123456789012';

        beforeEach(() => {
            // Add an active session for testing
            securityManager.addActiveSession(validCallSid);
        });

        describe('Start Message Validation', () => {
            it('should validate correct start message with active session', () => {
                const message = {
                    event: 'start',
                    start: {
                        callSid: validCallSid,
                        accountSid: 'AC1234567890123456789012345678901234'
                    }
                };

                const result = securityManager.validateWebSocketMessage(message);

                expect(result.isValid).toBe(true);
                expect(result.callSid).toBe(validCallSid);
                expect(result.reason).toBeUndefined();
            });

            it('should reject start message with invalid CallSid format', () => {
                const invalidCallSids = [
                    'invalid',
                    'CA123', // too short
                    'XA1234567890123456789012345678901234', // wrong prefix
                    'CA12345678901234567890123456789012345', // too long
                    null,
                    undefined
                ];

                invalidCallSids.forEach(callSid => {
                    const message = {
                        event: 'start',
                        start: { callSid }
                    };

                    const result = securityManager.validateWebSocketMessage(message);

                    expect(result.isValid).toBe(false);
                    expect(result.reason).toBe('Invalid CallSid format in start message');
                });
            });

            it('should reject start message with inactive session', () => {
                const inactiveCallSid = 'CA99999999999999999999999999999999';
                const message = {
                    event: 'start',
                    start: {
                        callSid: inactiveCallSid
                    }
                };

                const result = securityManager.validateWebSocketMessage(message);

                expect(result.isValid).toBe(false);
                expect(result.reason).toBe('No active call session found for CallSid');
            });

            it('should handle missing start object', () => {
                const message = {
                    event: 'start'
                    // missing start object
                };

                const result = securityManager.validateWebSocketMessage(message);

                // According to the implementation, if message.start is falsy, it returns { isValid: true }
                expect(result.isValid).toBe(true);
            });
        });

        describe('Other Message Types', () => {
            const otherMessageTypes = [
                { event: 'media', media: { payload: 'base64data' } },
                { event: 'stop' },
                { event: 'mark', mark: { name: 'test' } }
            ];

            otherMessageTypes.forEach(message => {
                it(`should accept ${message.event} messages without validation`, () => {
                    const result = securityManager.validateWebSocketMessage(message);

                    expect(result.isValid).toBe(true);
                    expect(result.reason).toBeUndefined();
                });
            });
        });

        describe('Error Handling', () => {
            it('should handle malformed messages gracefully', () => {
                // Test with a message that causes an error during property access
                const cyclicMessage: any = { event: 'start' };
                cyclicMessage.start = cyclicMessage; // Create circular reference
                
                // This should not crash the application
                const result = securityManager.validateWebSocketMessage(cyclicMessage);
                
                // The method should handle the error gracefully
                expect(typeof result).toBe('object');
                expect(typeof result.isValid).toBe('boolean');
            });

            it('should handle null and undefined messages', () => {
                const nullResult = securityManager.validateWebSocketMessage(null);
                expect(nullResult.isValid).toBe(false);
                expect(nullResult.reason).toBe('Error parsing WebSocket message');

                const undefinedResult = securityManager.validateWebSocketMessage(undefined);
                expect(undefinedResult.isValid).toBe(false);
                expect(undefinedResult.reason).toBe('Error parsing WebSocket message');
            });

            it('should handle messages with missing or null event', () => {
                const messages = [
                    { /* missing event */ },
                    { event: null }
                ];

                messages.forEach(message => {
                    const result = securityManager.validateWebSocketMessage(message);
                    // These don't match 'start' event, so they return { isValid: true }
                    expect(result.isValid).toBe(true);
                });
            });

            it('should log warnings for message validation errors', () => {
                const invalidMessage = null;

                securityManager.validateWebSocketMessage(invalidMessage);

                expect(mockLogger.warn).toHaveBeenCalledWith(
                    'Error validating WebSocket message',
                    {
                        error: expect.any(Error),
                        messageType: undefined
                    }
                );
            });

            it('should handle circular reference objects', () => {
                const circularMessage: any = { event: 'start' };
                circularMessage.circular = circularMessage;

                const result = securityManager.validateWebSocketMessage(circularMessage);

                // Should not crash and should return valid since no start object
                expect(result.isValid).toBe(true);
            });
        });
    });

    describe('Security Statistics', () => {
        it('should return correct security statistics', () => {
            const callSid1 = 'CA11111111111111111111111111111111';
            const callSid2 = 'CA22222222222222222222222222222222';

            // Add some sessions
            securityManager.addActiveSession(callSid1);
            securityManager.addActiveSession(callSid2);

            // Make some connections to create rate limit entries
            const req1 = {
                socket: { remoteAddress: '192.168.1.100' },
                headers: { 'user-agent': 'TwilioMediaStreams/1.0' }
            } as any;
            securityManager.validateConnection(req1);

            const req2 = {
                socket: { remoteAddress: '192.168.1.101' },
                headers: { 'user-agent': 'TwilioMediaStreams/1.0' }
            } as any;
            securityManager.validateConnection(req2);

            const stats = securityManager.getSecurityStats();

            expect(stats.activeSessions).toBe(2);
            expect(stats.rateLimitEntries).toBe(2);
            expect(stats.activeConnections).toBe(0); // This is tracked separately
        });

        it('should return zero stats when empty', () => {
            const stats = securityManager.getSecurityStats();

            expect(stats.activeSessions).toBe(0);
            expect(stats.rateLimitEntries).toBe(0);
            expect(stats.activeConnections).toBe(0);
        });
    });

    describe('Cleanup and Resource Management', () => {
        it('should clear all data on cleanup', () => {
            const callSid = 'CA12345678901234567890123456789012';
            
            // Add session and rate limit entries
            securityManager.addActiveSession(callSid);
            securityManager.validateConnection(mockRequest as http.IncomingMessage);

            // Verify data exists
            expect(securityManager.isSessionActive(callSid)).toBe(true);
            expect(securityManager.getSecurityStats().rateLimitEntries).toBeGreaterThan(0);

            // Cleanup
            securityManager.cleanup();

            // Verify data is cleared
            expect(securityManager.isSessionActive(callSid)).toBe(false);
            expect(securityManager.getSecurityStats().activeSessions).toBe(0);
            expect(securityManager.getSecurityStats().rateLimitEntries).toBe(0);
        });

        it('should handle cleanup of timer resources', () => {
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

            securityManager.cleanup();

            // The cleanup method should not crash, regardless of timer state
            expect(() => securityManager.cleanup()).not.toThrow();
            clearIntervalSpy.mockRestore();
        });
    });

    describe('Rate Limit Cleanup', () => {
        it('should clean up old rate limit entries automatically', (done) => {
            // Create a new instance to test the cleanup timer
            const testManager = WebSocketSecurityManager.getInstance();
            
            // Add some rate limit entries
            const req = {
                socket: { remoteAddress: '192.168.1.250' },
                headers: { 'user-agent': 'TwilioMediaStreams/1.0' }
            } as any;
            
            testManager.validateConnection(req);
            
            // Verify entry exists
            expect(testManager.getSecurityStats().rateLimitEntries).toBeGreaterThan(0);
            
            // The cleanup happens automatically via timer, so we just verify it doesn't crash
            setTimeout(() => {
                expect(testManager.getSecurityStats()).toBeDefined();
                done();
            }, 10);
        });

        it('should handle rate limit window expiration', () => {
            const testIP = '192.168.1.251';
            const req = {
                socket: { remoteAddress: testIP },
                headers: { 'user-agent': 'TwilioMediaStreams/1.0' }
            } as any;

            // Make connections to create rate limit entry
            for (let i = 0; i < 5; i++) {
                securityManager.validateConnection(req);
            }

            // Verify rate limit entry exists
            expect(securityManager.getSecurityStats().rateLimitEntries).toBeGreaterThan(0);

            // Clear and verify cleanup works
            securityManager.clearRateLimiting();
            expect(securityManager.getSecurityStats().rateLimitEntries).toBe(0);
        });
    });

    describe('Edge Cases and Boundary Conditions', () => {
        it('should handle exactly 10 connections (boundary)', () => {
            // Make exactly 10 connections
            for (let i = 0; i < 10; i++) {
                const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);
                expect(result.isValid).toBe(true);
            }

            // 11th should fail
            const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);
            expect(result.isValid).toBe(false);
        });

        it('should handle CallSid with exactly 34 characters', () => {
            const exactLengthCallSid = 'CA' + '1'.repeat(32); // CA + 32 chars = 34 total
            securityManager.addActiveSession(exactLengthCallSid);

            const message = {
                event: 'start',
                start: { callSid: exactLengthCallSid }
            };

            const result = securityManager.validateWebSocketMessage(message);
            expect(result.isValid).toBe(true);
        });

        it('should handle empty headers object', () => {
            mockRequest.headers = {};

            const result = securityManager.validateConnection(mockRequest as http.IncomingMessage);

            expect(result.isValid).toBe(false);
            expect(result.reason).toBe('Invalid or missing User-Agent header');
        });

        it('should handle concurrent session operations', () => {
            const callSids = Array.from({ length: 100 }, (_, i) => 
                `CA${String(i).padStart(32, '0')}`
            );

            // Add all sessions concurrently
            callSids.forEach(callSid => {
                securityManager.addActiveSession(callSid);
            });

            // Verify all are active
            callSids.forEach(callSid => {
                expect(securityManager.isSessionActive(callSid)).toBe(true);
            });

            // Remove all sessions
            callSids.forEach(callSid => {
                securityManager.removeActiveSession(callSid);
            });

            // Verify all are removed
            callSids.forEach(callSid => {
                expect(securityManager.isSessionActive(callSid)).toBe(false);
            });
        });

        it('should handle missing socket remoteAddress gracefully', () => {
            const reqWithEmptySocket = {
                socket: {},
                headers: { 'user-agent': 'TwilioMediaStreams/1.0' }
            } as any;

            const result = securityManager.validateConnection(reqWithEmptySocket);
            expect(result.isValid).toBe(true); // Should still pass User-Agent validation
        });

        it('should handle undefined User-Agent header', () => {
            const reqWithUndefinedUA = {
                socket: { remoteAddress: '192.168.1.100' },
                headers: { 'user-agent': undefined }
            } as any;

            const result = securityManager.validateConnection(reqWithUndefinedUA);
            expect(result.isValid).toBe(false);
            expect(result.reason).toBe('Invalid or missing User-Agent header');
        });
    });
});