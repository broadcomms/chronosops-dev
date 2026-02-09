/**
 * Kubernetes Discovery API Routes
 * Provides endpoints for discovering namespaces and deployments in the cluster
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { K8sClient } from '@chronosops/kubernetes';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'KubernetesAPI' });

// Security fix: Validation schemas
const namespaceQuerySchema = z.object({
  namespace: z.string()
    .min(1, 'Namespace is required')
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Invalid namespace format'),
});

// Lazy-load K8s client to avoid startup errors when K8s is not configured
let k8sClient: K8sClient | null = null;

function getK8sClient(): K8sClient {
  if (!k8sClient) {
    k8sClient = new K8sClient({
      allowedNamespaces: [], // Empty - discovery doesn't need restrictions
      allowedActions: [],
      dryRun: true,
    });
  }
  return k8sClient;
}

export async function kubernetesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /kubernetes/namespaces - List all cluster namespaces
   */
  app.get('/namespaces', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const client = getK8sClient();
      const namespaces = await client.listAllNamespaces();

      logger.info({ count: namespaces.length }, 'Listed namespaces');

      return {
        success: true,
        data: namespaces,
      };
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to list namespaces');

      // Check if it's a K8s connection error
      if (err.message.includes('ECONNREFUSED') || err.message.includes('connect')) {
        return reply.status(503).send({
          success: false,
          error: 'Kubernetes cluster not available',
          message: 'Cannot connect to Kubernetes API server. Please check your cluster configuration.',
        });
      }

      return reply.status(500).send({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * GET /kubernetes/deployments - List deployments in a namespace
   */
  app.get('/deployments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Security fix: Validate namespace query parameter
      const { namespace } = namespaceQuerySchema.parse(request.query);

      const client = getK8sClient();
      const deployments = await client.listAllDeployments(namespace);

      logger.info({ namespace, count: deployments.length }, 'Listed deployments');

      return {
        success: true,
        data: deployments,
      };
    } catch (error) {
      // Security fix: Handle validation errors
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        });
      }

      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to list deployments');

      // Check if namespace doesn't exist
      if (err.message.includes('not found') || err.message.includes('404')) {
        return reply.status(404).send({
          success: false,
          error: `Namespace not found`,
          message: `The namespace does not exist in the cluster`,
        });
      }

      // Check if it's a K8s connection error
      if (err.message.includes('ECONNREFUSED') || err.message.includes('connect')) {
        return reply.status(503).send({
          success: false,
          error: 'Kubernetes cluster not available',
          message: 'Cannot connect to Kubernetes API server. Please check your cluster configuration.',
        });
      }

      return reply.status(500).send({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * GET /kubernetes/status - Get K8s connection status
   */
  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const client = getK8sClient();
      // Try to list namespaces as a connection test
      await client.listAllNamespaces();

      return {
        success: true,
        connected: true,
        message: 'Kubernetes cluster is accessible',
      };
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'K8s status check failed');

      return reply.status(200).send({
        success: true,
        connected: false,
        message: 'Kubernetes cluster not accessible',
        error: err.message,
      });
    }
  });
}
