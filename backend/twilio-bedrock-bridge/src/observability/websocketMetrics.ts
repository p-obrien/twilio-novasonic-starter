import { WebSocket } from 'ws';

// WebSocket connection tracking with automatic cleanup
const connectionStartTimes = new Map<WebSocket, number>();
const MAX_TRACKED_CONNECTIONS = 10000; // Prevent memory leaks

// Lazy load metricsUtils to avoid circular dependency issues
let metricsUtils: any = null;
function getMetricsUtils() {
  if (!metricsUtils) {
    try {
      metricsUtils = require('./metrics').metricsUtils;
    } catch (error) {
      console.warn('Failed to load metricsUtils:', error);
      metricsUtils = {
        recordWebSocketConnection: () => {},
        recordWebSocketMessage: () => {},
        recordError: () => {},
        recordAudioProcessing: () => {},
      };
    }
  }
  return metricsUtils;
}

export class WebSocketMetrics {
  static onConnection(ws: WebSocket): void {
    const startTime = Date.now();
    
    // Prevent memory leaks by limiting tracked connections
    if (connectionStartTimes.size >= MAX_TRACKED_CONNECTIONS) {
      console.warn(`WebSocket tracking limit reached (${MAX_TRACKED_CONNECTIONS}), clearing old connections`);
      this.cleanup();
    }
    
    connectionStartTimes.set(ws, startTime);
    
    // Record connection
    getMetricsUtils().recordWebSocketConnection('connect');
    
    // Set up message handlers
    ws.on('message', (data: Buffer) => {
      this.onMessage(ws, 'inbound', data);
    });
    
    // Override send method to track outbound messages
    const originalSend = ws.send.bind(ws);
    ws.send = function(data: any, options?: any, cb?: any) {
      WebSocketMetrics.onMessage(ws, 'outbound', Buffer.from(data));
      return originalSend(data, options, cb);
    };
    
    // Handle disconnection
    ws.on('close', () => {
      this.onDisconnection(ws);
    });
    
    ws.on('error', (error: Error) => {
      this.onError(ws, error);
    });
  }
  
  static onMessage(ws: WebSocket, direction: 'inbound' | 'outbound', data: Buffer): void {
    try {
      // Parse message to determine type
      const message = JSON.parse(data.toString());
      const messageType = message.event || message.type || 'unknown';
      
      // Record message metrics
      getMetricsUtils().recordWebSocketMessage(direction, messageType, data.length);
      
      // Handle specific message types
      if (messageType === 'media') {
        this.onMediaMessage(message, data.length);
      } else if (messageType === 'start') {
        this.onStreamStart(message);
      } else if (messageType === 'stop') {
        this.onStreamStop(message);
      }
    } catch (error) {
      // If not JSON, treat as raw data
      getMetricsUtils().recordWebSocketMessage(direction, 'raw', data.length);
    }
  }
  
  static onDisconnection(ws: WebSocket): void {
    const startTime = connectionStartTimes.get(ws);
    const duration = startTime ? (Date.now() - startTime) / 1000 : undefined;
    
    connectionStartTimes.delete(ws);
    getMetricsUtils().recordWebSocketConnection('disconnect', duration);
  }

  static cleanup(): void {
    // Clear all connection tracking to prevent memory leaks
    connectionStartTimes.clear();
  }
  
  static onError(ws: WebSocket, error: Error): void {
    getMetricsUtils().recordError('websocket_error', 'websocket', 'medium');
  }
  
  private static onMediaMessage(message: any, size: number): void {
    // Record audio processing metrics
    const sampleRate = message.sampleRate || 8000;
    getMetricsUtils().recordAudioProcessing('receive', 0, size, sampleRate);
  }
  
  private static onStreamStart(message: any): void {
    const callSid = message.streamSid || message.callSid;
    if (callSid) {
      // This could be used to track stream-specific metrics
      console.log(`Stream started for call: ${callSid}`);
    }
  }
  
  private static onStreamStop(message: any): void {
    const callSid = message.streamSid || message.callSid;
    if (callSid) {
      // This could be used to track stream-specific metrics
      console.log(`Stream stopped for call: ${callSid}`);
    }
  }
}

// Helper function to get WebSocket connection count
export function getActiveWebSocketConnections(): number {
  return connectionStartTimes.size;
}