/**
 * Detection API Routes
 * Control and monitor autonomous anomaly detection
 */

import type { FastifyInstance } from 'fastify';
import type { AnomalyDetectionService } from '../services/anomaly-detection-service.js';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'DetectionRoutes' });

/**
 * Register detection routes
 */
export async function detectionRoutes(
  app: FastifyInstance,
  detectionService: AnomalyDetectionService
): Promise<void> {
  /**
   * GET /detection/status
   * Get current detection service status
   */
  app.get('/status', async (_request, reply) => {
    const status = detectionService.getStatus();
    return reply.send({ data: status });
  });

  /**
   * POST /detection/start
   * Start autonomous detection
   */
  app.post('/start', async (_request, reply) => {
    if (detectionService.isRunning()) {
      return reply.status(400).send({
        error: 'Detection service is already running',
      });
    }

    detectionService.start();
    logger.info('Detection service started via API');

    return reply.send({
      data: {
        status: 'started',
        message: 'Autonomous anomaly detection started',
      },
    });
  });

  /**
   * POST /detection/stop
   * Stop autonomous detection
   */
  app.post('/stop', async (_request, reply) => {
    if (!detectionService.isRunning()) {
      return reply.status(400).send({
        error: 'Detection service is not running',
      });
    }

    detectionService.stop();
    logger.info('Detection service stopped via API');

    return reply.send({
      data: {
        status: 'stopped',
        message: 'Autonomous anomaly detection stopped',
      },
    });
  });

  /**
   * POST /detection/restart
   * Restart autonomous detection
   */
  app.post('/restart', async (_request, reply) => {
    if (detectionService.isRunning()) {
      detectionService.stop();
    }

    detectionService.start();
    logger.info('Detection service restarted via API');

    return reply.send({
      data: {
        status: 'restarted',
        message: 'Autonomous anomaly detection restarted',
      },
    });
  });
}
