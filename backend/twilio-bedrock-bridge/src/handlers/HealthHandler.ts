/**
 * Health Handler for Kubernetes probes
 *
 * Provides minimal health check endpoints for container orchestration
 */

import { Request, Response } from 'express';
import logger from '../observability/logger';
import { getBedrockCircuitBreaker } from '../resilience';
import { CircuitBreakerState } from '../resilience/CircuitBreaker';

export class HealthHandler {
  /**
   * Kubernetes readiness probe
   * Indicates if the service is ready to receive traffic
   */
  static async getReadiness(req: Request, res: Response): Promise<void> {
    try {
      // Get circuit breaker status
      const circuitBreaker = getBedrockCircuitBreaker();
      const metrics = circuitBreaker.getMetrics();
      const circuitState = circuitBreaker.getState();

      // Determine overall health status
      // OPEN circuit means degraded service (can still handle requests, but Bedrock is unavailable)
      // HALF_OPEN means recovering
      // CLOSED means healthy
      const isHealthy = circuitState === CircuitBreakerState.CLOSED;
      const isDegraded = circuitState === CircuitBreakerState.OPEN;

      const response = {
        status: isHealthy ? 'ready' : isDegraded ? 'degraded' : 'recovering',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        circuitBreaker: {
          state: circuitState,
          failureCount: metrics.failureCount,
          successCount: metrics.successCount,
          totalSuccesses: metrics.totalSuccesses,
          totalFailures: metrics.totalFailures,
          totalRejections: metrics.totalRejections,
          nextAttempt: metrics.nextAttempt > 0 ? new Date(metrics.nextAttempt).toISOString() : null
        }
      };

      // Return 200 for ready, 503 for degraded (circuit OPEN)
      // This allows Kubernetes to know the service is degraded but still alive
      const statusCode = isHealthy ? 200 : 503;

      res.status(statusCode).json(response);
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