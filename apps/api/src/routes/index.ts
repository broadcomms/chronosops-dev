/**
 * API Routes
 */

import type { FastifyInstance } from 'fastify';
import { incidentsRoutes } from './incidents.js';
import { healthRoutes } from './health.js';
import { configRoutes } from './config.js';
import { detectionRoutes } from './detection.js';
import { kubernetesRoutes } from './kubernetes.js';
import { developmentRoutes } from './development.js';
import { intelligenceRoutes } from './intelligence.js';
import { servicesRoutes } from './services.js';
import { editLockRoutes } from './edit-lock.js';
import { evolutionRoutes } from './evolution.js';
import { gitRoutes } from './git.js';
import { visionRoutes } from './vision.js';
import { timelineRoutes } from './timeline.js';
import { appsProxyRoutes } from './apps-proxy.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Reverse proxy for generated apps: /apps/<serviceName>/* → K8s internal DNS
  app.register(appsProxyRoutes);

  // API version prefix
  app.register(
    async (api) => {
      // Health check routes
      api.register(healthRoutes);

      // Incidents routes (includes evidence, actions, investigation endpoints)
      api.register(incidentsRoutes, { prefix: '/incidents' });

      // Configuration routes
      api.register(configRoutes, { prefix: '/config' });

      // Kubernetes discovery routes
      api.register(kubernetesRoutes, { prefix: '/kubernetes' });

      // Detection routes (control autonomous anomaly detection)
      api.register(
        async (detectionApi) => {
          await detectionRoutes(detectionApi, app.services.detectionService);
        },
        { prefix: '/detection' }
      );

      // Development routes (self-regenerating app ecosystem)
      api.register(developmentRoutes, { prefix: '/development' });

      // Edit lock routes (file locking and version control)
      api.register(editLockRoutes);

      // Evolution routes (AI-powered code evolution)
      api.register(evolutionRoutes);

      // Git routes (repository management)
      api.register(gitRoutes);

      // Intelligence routes (incident reconstruction, pattern learning)
      api.register(intelligenceRoutes, { prefix: '/intelligence' });

      // Service registry routes (multi-service architecture)
      api.register(servicesRoutes, { prefix: '/services' });

      // Vision routes (unified vision stream - server-side rendering + MJPEG streaming)
      api.register(visionRoutes, { prefix: '/vision' });

      // Timeline routes (unified history view)
      api.register(timelineRoutes);
    },
    { prefix: '/api/v1' }
  );
}
