/**
 * Vision Routes - Unified Vision Stream API endpoints
 *
 * Provides:
 * - MJPEG video streaming
 * - Frame capture
 * - Recording management
 * - AI annotation control
 */

import type { FastifyInstance } from 'fastify';
import { getVisionService } from '@chronosops/core';

/**
 * Vision API routes
 */
export async function visionRoutes(app: FastifyInstance): Promise<void> {
  const visionService = getVisionService();

  /**
   * GET /stream/:serviceName
   * MJPEG video stream for a service
   * Note: Monitoring should already be started via POST /monitoring/start
   */
  app.get<{
    Params: { serviceName: string };
    Querystring: { namespace?: string };
  }>('/stream/:serviceName', async (request, reply) => {
    const { serviceName } = request.params;
    const namespace = request.query.namespace || 'development';

    // Start monitoring if not already (using provided or default namespace)
    if (!visionService.isMonitoring(serviceName)) {
      await visionService.startMonitoring(serviceName, namespace);
    }

    // Get the raw Node.js response for streaming
    const rawReply = reply.raw;

    // Add client to streamer - the streamer handles all headers and streaming
    visionService.addStreamClient(rawReply, serviceName);

    // Don't send fastify response - streaming is handled by the streamer
    // Return early to prevent Fastify from sending a response
    return reply.hijack();
  });

  /**
   * GET /frame/:serviceName
   * Get latest frame as PNG
   */
  app.get<{
    Params: { serviceName: string };
    Querystring: { namespace?: string };
  }>('/frame/:serviceName', async (request, reply) => {
    const { serviceName } = request.params;
    const namespace = request.query.namespace || 'development';

    // Start monitoring if not already
    if (!visionService.isMonitoring(serviceName)) {
      await visionService.startMonitoring(serviceName, namespace);
      // Wait a bit for first frame
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    const frameData = visionService.getLatestFrame(serviceName);
    if (!frameData) {
      return reply.status(404).send({ error: 'No frame available' });
    }

    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'no-cache')
      .send(frameData.frame);
  });

  /**
   * GET /frames/:serviceName
   * Get recent frames metadata
   */
  app.get<{
    Params: { serviceName: string };
    Querystring: { count?: string };
  }>('/frames/:serviceName', async (request, reply) => {
    const { serviceName } = request.params;
    const count = parseInt(request.query.count ?? '5', 10);

    const frames = visionService.getRecentFrames(serviceName, count);
    return reply.send({
      serviceName,
      count: frames.length,
      frames: frames.map((f) => ({
        timestamp: f.timestamp,
        frameNumber: f.frameNumber,
        hasMetrics: !!f.metrics,
      })),
    });
  });

  /**
   * POST /monitoring/start
   * Start monitoring a service
   */
  app.post<{
    Body: { serviceName: string; namespace?: string };
  }>('/monitoring/start', async (request, reply) => {
    const { serviceName, namespace } = request.body;

    if (!serviceName) {
      return reply.status(400).send({ error: 'serviceName is required' });
    }

    if (visionService.isMonitoring(serviceName)) {
      return reply.send({ status: 'already_monitoring', serviceName });
    }

    // Use provided namespace or default to 'development'
    await visionService.startMonitoring(serviceName, namespace || 'development');
    return reply.send({ status: 'started', serviceName, namespace: namespace || 'development' });
  });

  /**
   * POST /monitoring/stop
   * Stop monitoring a service
   */
  app.post<{
    Body: { serviceName: string };
  }>('/monitoring/stop', async (request, reply) => {
    const { serviceName } = request.body;

    if (!serviceName) {
      return reply.status(400).send({ error: 'serviceName is required' });
    }

    visionService.stopMonitoring(serviceName);
    return reply.send({ status: 'stopped', serviceName });
  });

  /**
   * GET /monitoring/status
   * Get monitoring status for all services
   */
  app.get('/monitoring/status', async (_request, reply) => {
    const services = visionService.getMonitoredServices();
    const clientCount = visionService.getClientCount();

    return reply.send({
      monitoredServices: services,
      clientCount,
      servicesCount: services.length,
    });
  });

  /**
   * POST /recording/start
   * Start recording a service
   */
  app.post<{
    Body: { serviceName: string; incidentId?: string };
  }>('/recording/start', async (request, reply) => {
    const { serviceName, incidentId } = request.body;

    if (!serviceName) {
      return reply.status(400).send({ error: 'serviceName is required' });
    }

    if (visionService.isRecording(serviceName)) {
      return reply.status(400).send({ error: 'Already recording this service' });
    }

    const recordingId = visionService.startRecording(serviceName, incidentId);
    return reply.send({ recordingId, status: 'recording', serviceName });
  });

  /**
   * POST /recording/stop
   * Stop recording a service
   */
  app.post<{
    Body: { serviceName: string };
  }>('/recording/stop', async (request, reply) => {
    const { serviceName } = request.body;

    if (!serviceName) {
      return reply.status(400).send({ error: 'serviceName is required' });
    }

    if (!visionService.isRecording(serviceName)) {
      return reply.status(400).send({ error: 'No active recording for this service' });
    }

    try {
      const result = await visionService.stopRecording(serviceName);
      return reply.send({
        recordingId: result.recordingId,
        status: 'complete',
        outputPath: result.outputPath,
      });
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to stop recording',
      });
    }
  });

  /**
   * POST /annotations
   * Set AI annotations for a service
   */
  app.post<{
    Body: {
      serviceName: string;
      annotations: Array<{
        type: 'highlight' | 'arrow' | 'text' | 'box';
        position: { x: number; y: number };
        data: Record<string, unknown>;
      }>;
      message?: string;
    };
  }>('/annotations', async (request, reply) => {
    const { serviceName, annotations, message } = request.body;

    if (!serviceName) {
      return reply.status(400).send({ error: 'serviceName is required' });
    }

    visionService.setAnnotations(serviceName, annotations || []);
    if (message) {
      visionService.setAIMessage(serviceName, message);
    }

    return reply.send({ status: 'set', serviceName, annotationCount: annotations?.length ?? 0 });
  });

  /**
   * DELETE /annotations/:serviceName
   * Clear annotations for a service
   */
  app.delete<{
    Params: { serviceName: string };
  }>('/annotations/:serviceName', async (request, reply) => {
    const { serviceName } = request.params;

    visionService.clearAnnotations(serviceName);
    return reply.send({ status: 'cleared', serviceName });
  });

  /**
   * GET /health
   * Vision service health check
   */
  app.get('/health', async (_request, reply) => {
    const services = visionService.getMonitoredServices();
    return reply.send({
      status: 'healthy',
      monitoredServices: services.length,
      clientCount: visionService.getClientCount(),
    });
  });
}
