/**
 * ChronosOps API Server
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { createChildLogger, getConfig } from '@chronosops/shared';
import { initializeDatabase, configRepository } from '@chronosops/database';
import { registerRoutes } from './routes/index.js';
import { registerWebSocket } from './websocket/index.js';
import { initializeServices, shutdownServices, recoverInterruptedCycles, recoverInterruptedInvestigations, type AppServices } from './services/index.js';

const logger = createChildLogger({ component: 'API' });

// Extend Fastify instance with services
declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}

async function main() {
  // Load configuration
  const config = getConfig();

  // Initialize database
  initializeDatabase({ path: config.database.path });

  // Seed default configurations (Kubernetes, Vision, Safety)
  await configRepository.seedDefaultConfigs();
  logger.info('Default configurations seeded');

  // Initialize services (GeminiClient, VideoWatcher, ExecutorFactory)
  const services = initializeServices();

  // Create Fastify instance
  const app = Fastify({
    logger: false, // We use our own logger
  });

  // Decorate app with services for dependency injection
  app.decorate('services', services);

  // Register plugins
  await app.register(cors, {
    origin: config.server.corsOrigin === '*' ? true : config.server.corsOrigin.split(','),
    credentials: true,
  });

  await app.register(websocket);

  // Register routes
  await registerRoutes(app);

  // Register WebSocket handlers
  await registerWebSocket(app);

  // Serve architecture diagram images from /data/diagrams/
  const diagramsPath = resolve(process.cwd(), 'data', 'diagrams');
  // Ensure the diagrams directory exists
  const { mkdirSync } = await import('fs');
  mkdirSync(diagramsPath, { recursive: true });

  await app.register(fastifyStatic, {
    root: diagramsPath,
    prefix: '/api/v1/diagrams/',
    decorateReply: true, // First registration gets decorateReply
  });
  logger.info({ path: diagramsPath }, 'Architecture diagrams static serving enabled');

  // Serve static frontend in production
  if (process.env.NODE_ENV === 'production') {
    // Resolve the web dist path relative to the project root
    const webDistPath = resolve(process.cwd(), 'apps/web/dist');

    if (existsSync(webDistPath)) {
      await app.register(fastifyStatic, {
        root: webDistPath,
        prefix: '/',
        decorateReply: false, // Already decorated by diagrams static registration
      });

      // SPA fallback - serve index.html for non-API routes
      app.setNotFoundHandler((request, reply) => {
        // Don't serve index.html for API routes, WebSocket, or proxied app routes
        if (request.url.startsWith('/api') || request.url.startsWith('/ws') || request.url === '/health' || request.url.startsWith('/services') || request.url.startsWith('/apps')) {
          return reply.status(404).send({ error: 'Not found', path: request.url });
        }
        // Serve index.html for all other routes (SPA routing)
        return reply.sendFile('index.html', webDistPath);
      });

      logger.info({ path: webDistPath }, 'Static frontend enabled for production');
    } else {
      logger.warn({ path: webDistPath }, 'Static frontend path not found, serving API only');
    }
  }

  // Attach app to detection service for orchestrator access
  services.detectionService.attachApp(app);

  // Log K8s executor availability at startup
  const executorAvailability = await services.executorFactory.checkAvailability();
  const executorConfig = services.executorFactory.getConfig();
  const isDryRun = executorConfig.kubernetes?.dryRunDefault ?? false;

  if (executorAvailability.kubernetes) {
    logger.info(
      {
        mode: executorConfig.mode,
        dryRun: isDryRun,
        activeExecutor: executorAvailability.activeExecutor,
      },
      isDryRun
        ? '✓ Kubernetes available (DRY RUN mode - set K8S_DRY_RUN=false for real execution)'
        : '✓ Kubernetes available (REAL EXECUTION enabled)'
    );
  } else {
    logger.warn(
      {
        mode: executorConfig.mode,
        activeExecutor: executorAvailability.activeExecutor,
      },
      '⚠ Kubernetes not available - remediation actions will fail unless EXECUTION_MODE=simulated'
    );
  }

  // Start autonomous detection if enabled
  if (config.detection.enabled) {
    services.detectionService.start();
    logger.info('Autonomous anomaly detection started');
  }

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Services status endpoint
  app.get('/services/status', async () => {
    const videoAvailable = await services.videoWatcher.isAvailable();
    const executorAvailability = await services.executorFactory.checkAvailability();
    const detectionStatus = services.detectionService.getStatus();

    return {
      status: 'ok',
      services: {
        gemini: { available: true }, // Client is always available if initialized
        videoWatcher: { available: videoAvailable, config: services.videoWatcher.getConfig() },
        executor: executorAvailability,
        detection: detectionStatus,
      },
      timestamp: new Date().toISOString(),
    };
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    await app.close();
    await shutdownServices();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start server
  try {
    await app.listen({
      port: config.server.port,
      host: config.server.host,
    });

    logger.info(`Server started on ${config.server.host}:${config.server.port}`);

    // Recover interrupted cycles AFTER server is listening
    // Run in background (non-blocking) so server responds to requests immediately

    // 1. Recover development cycles
    recoverInterruptedCycles().then((recoveryResult) => {
      if (recoveryResult.recovered > 0 || recoveryResult.failed > 0) {
        logger.info({
          recovered: recoveryResult.recovered,
          failed: recoveryResult.failed,
        }, 'Development cycle recovery completed');
      }
    }).catch((err) => {
      logger.error({ error: (err as Error).message }, 'Development cycle recovery failed');
    });

    // 2. Recover investigations (OODA loop resilience)
    recoverInterruptedInvestigations().then((recoveryResult) => {
      if (recoveryResult.recovered > 0 || recoveryResult.failed > 0) {
        logger.info({
          recovered: recoveryResult.recovered,
          failed: recoveryResult.failed,
        }, 'Investigation recovery completed');
      }
    }).catch((err) => {
      logger.error({ error: (err as Error).message }, 'Investigation recovery failed');
    });
  } catch (err) {
    logger.error('Failed to start server', err as Error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  logger.error('Unhandled error', err);
  process.exit(1);
});
