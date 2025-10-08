/**
 * Unit tests for HealthHandler - Kubernetes health probes
 */

import { Request, Response } from 'express';
import { HealthHandler } from '../../../handlers/HealthHandler';
import logger from '../../../observability/logger';

// Mock logger
jest.mock('../../../observability/logger');
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('HealthHandler', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock response
    mockJson = jest.fn().mockReturnThis();
    mockStatus = jest.fn().mockReturnThis();
    
    mockRequest = {};
    mockResponse = {
      status: mockStatus,
      json: mockJson,
    };
  });

  describe('getReadiness', () => {
    it('should return 200 with ready status and uptime', async () => {
      const mockUptime = 123.45;
      jest.spyOn(process, 'uptime').mockReturnValue(mockUptime);
      
      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({
        status: 'ready',
        timestamp: expect.any(String),
        uptime: mockUptime
      });
    });

    it('should return valid ISO timestamp', async () => {
      const beforeCall = new Date();
      
      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );

      const afterCall = new Date();
      const responseCall = mockJson.mock.calls[0][0];
      const timestamp = new Date(responseCall.timestamp);

      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterCall.getTime());
      expect(responseCall.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should handle errors gracefully and return 503', async () => {
      // Mock process.uptime to throw an error
      jest.spyOn(process, 'uptime').mockImplementation(() => {
        throw new Error('Process uptime failed');
      });

      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockStatus).toHaveBeenCalledWith(503);
      expect(mockJson).toHaveBeenCalledWith({
        status: 'not ready',
        timestamp: expect.any(String),
        error: 'Service not ready'
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Readiness check failed',
        {
          component: 'health_handler',
          error: 'Process uptime failed'
        }
      );
    });

    it('should handle non-Error exceptions', async () => {
      // Mock process.uptime to throw a non-Error object
      jest.spyOn(process, 'uptime').mockImplementation(() => {
        throw 'String error';
      });

      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockStatus).toHaveBeenCalledWith(503);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Readiness check failed',
        {
          component: 'health_handler',
          error: 'String error'
        }
      );
    });

    it('should not log when successful', async () => {
      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('getLiveness', () => {
    it('should return 200 with alive status and uptime', async () => {
      const mockUptime = 456.78;
      jest.spyOn(process, 'uptime').mockReturnValue(mockUptime);
      
      await HealthHandler.getLiveness(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({
        status: 'alive',
        timestamp: expect.any(String),
        uptime: mockUptime
      });
    });

    it('should return valid ISO timestamp', async () => {
      const beforeCall = new Date();
      
      await HealthHandler.getLiveness(
        mockRequest as Request,
        mockResponse as Response
      );

      const afterCall = new Date();
      const responseCall = mockJson.mock.calls[0][0];
      const timestamp = new Date(responseCall.timestamp);

      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterCall.getTime());
      expect(responseCall.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should handle errors gracefully and return 503', async () => {
      // Mock process.uptime to throw an error
      jest.spyOn(process, 'uptime').mockImplementation(() => {
        throw new Error('Process uptime failed');
      });

      await HealthHandler.getLiveness(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockStatus).toHaveBeenCalledWith(503);
      expect(mockJson).toHaveBeenCalledWith({
        status: 'not alive',
        timestamp: expect.any(String),
        error: 'Service not responding'
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Liveness check failed',
        {
          component: 'health_handler',
          error: 'Process uptime failed'
        }
      );
    });

    it('should handle non-Error exceptions', async () => {
      // Mock process.uptime to throw a non-Error object
      jest.spyOn(process, 'uptime').mockImplementation(() => {
        throw { message: 'Object error' };
      });

      await HealthHandler.getLiveness(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockStatus).toHaveBeenCalledWith(503);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Liveness check failed',
        {
          component: 'health_handler',
          error: '[object Object]'
        }
      );
    });

    it('should not log when successful', async () => {
      await HealthHandler.getLiveness(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('Kubernetes probe compatibility', () => {
    it('should return different status messages for readiness vs liveness', async () => {
      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );
      
      const readinessResponse = mockJson.mock.calls[0][0];
      
      // Clear mocks and test liveness
      jest.clearAllMocks();
      mockJson.mockReturnThis();
      mockStatus.mockReturnThis();
      
      await HealthHandler.getLiveness(
        mockRequest as Request,
        mockResponse as Response
      );
      
      const livenessResponse = mockJson.mock.calls[0][0];

      expect(readinessResponse.status).toBe('ready');
      expect(livenessResponse.status).toBe('alive');
    });

    it('should return different error messages for failed probes', async () => {
      jest.spyOn(process, 'uptime').mockImplementation(() => {
        throw new Error('Test error');
      });

      // Test readiness error
      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );
      
      const readinessError = mockJson.mock.calls[0][0];
      
      // Clear mocks and test liveness error
      jest.clearAllMocks();
      mockJson.mockReturnThis();
      mockStatus.mockReturnThis();
      
      await HealthHandler.getLiveness(
        mockRequest as Request,
        mockResponse as Response
      );
      
      const livenessError = mockJson.mock.calls[0][0];

      expect(readinessError.status).toBe('not ready');
      expect(readinessError.error).toBe('Service not ready');
      expect(livenessError.status).toBe('not alive');
      expect(livenessError.error).toBe('Service not responding');
    });

    it('should always include required fields for Kubernetes', async () => {
      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );
      
      const response = mockJson.mock.calls[0][0];

      // Kubernetes expects these fields
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('timestamp');
      expect(typeof response.status).toBe('string');
      expect(typeof response.timestamp).toBe('string');
      expect(typeof response.uptime).toBe('number');
    });

    it('should handle concurrent probe requests', async () => {
      const promises = [
        HealthHandler.getReadiness(mockRequest as Request, mockResponse as Response),
        HealthHandler.getLiveness(mockRequest as Request, mockResponse as Response),
        HealthHandler.getReadiness(mockRequest as Request, mockResponse as Response),
      ];

      await Promise.all(promises);

      // All should succeed
      expect(mockStatus).toHaveBeenCalledTimes(3);
      expect(mockJson).toHaveBeenCalledTimes(3);
      mockStatus.mock.calls.forEach(call => {
        expect(call[0]).toBe(200);
      });
    });
  });

  describe('Response format validation', () => {
    it('should return consistent response structure for readiness', async () => {
      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );

      const response = mockJson.mock.calls[0][0];
      
      expect(Object.keys(response)).toEqual(['status', 'timestamp', 'uptime']);
      expect(typeof response.status).toBe('string');
      expect(typeof response.timestamp).toBe('string');
      expect(typeof response.uptime).toBe('number');
    });

    it('should return consistent error response structure', async () => {
      jest.spyOn(process, 'uptime').mockImplementation(() => {
        throw new Error('Test error');
      });

      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );

      const response = mockJson.mock.calls[0][0];
      
      expect(Object.keys(response)).toEqual(['status', 'timestamp', 'error']);
      expect(typeof response.status).toBe('string');
      expect(typeof response.timestamp).toBe('string');
      expect(typeof response.error).toBe('string');
    });

    it('should return uptime as positive number', async () => {
      const mockUptime = 789.12;
      jest.spyOn(process, 'uptime').mockReturnValue(mockUptime);

      await HealthHandler.getReadiness(
        mockRequest as Request,
        mockResponse as Response
      );

      const response = mockJson.mock.calls[0][0];
      expect(response.uptime).toBe(mockUptime);
      expect(response.uptime).toBeGreaterThan(0);
    });
  });
});