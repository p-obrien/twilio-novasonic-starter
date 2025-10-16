/**
 * Health Handler for Kubernetes probes
 * 
 * Provides minimal health check endpoints for container orchestration
 */

import { Request, Response } from 'express';
import logger from '../observability/logger';

export class HealthHandler {
  /**
   * Kubernetes readiness probe
   * Indicates if the service is ready to receive traffic
   */
  static async getReadiness(req: Request, res: Response): Promise<void> {
    try {
      const response = {
        status: 'ready',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Readiness check failed', {
        component: 'health_handler',
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        error: 'Service not ready'
      });
    }
  }

  /**
   * Kubernetes liveness probe
   * Indicates if the service is alive and should not be restarted
   */
  static async getLiveness(req: Request, res: Response): Promise<void> {
    try {
      const response = {
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Liveness check failed', {
        component: 'health_handler',
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(503).json({
        status: 'not alive',
        timestamp: new Date().toISOString(),
        error: 'Service not responding'
      });
    }
  }
}