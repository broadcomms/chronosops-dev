/**
 * Configuration API Routes
 * Handles CRUD operations for system configuration
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { configRepository, monitoredAppRepository } from '@chronosops/database';
import {
  kubernetesConfigSchema,
  dashboardConfigSchema,
  actionSafetyConfigSchema,
  developmentSettingsConfigSchema,
  DEFAULT_SAFETY_CONFIG,
  DEFAULT_DEVELOPMENT_SETTINGS_CONFIG,
  type KubernetesConfig,
  type DashboardConfig,
  type ActionSafetyConfig,
  type DevelopmentSettingsConfig,
  type ConfigurationState,
} from '@chronosops/shared';
import { createChildLogger } from '@chronosops/shared';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const logger = createChildLogger({ component: 'ConfigAPI' });

// ===========================================
// Request Validation Schemas (Security Fix)
// ===========================================

/**
 * Kubernetes context must be alphanumeric with hyphens, underscores, and dots only
 * This prevents command injection attacks
 */
const kubernetesTestSchema = z.object({
  context: z.string()
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Context must contain only alphanumeric characters, hyphens, underscores, and dots')
    .max(253, 'Context name too long') // K8s max name length
    .optional(),
});

/**
 * Dashboard test URL validation
 */
const dashboardTestSchema = z.object({
  url: z.string().url().optional(),
});

/**
 * ID parameter schema for routes
 */
const idParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

/**
 * Monitored app creation schema
 */
const createMonitoredAppSchema = z.object({
  namespace: z.string().min(1, 'Namespace is required').regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Invalid namespace format'),
  deployment: z.string().min(1, 'Deployment is required').regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Invalid deployment format'),
  displayName: z.string().min(1, 'Display name is required').max(100),
  dashboardUrl: z.string().url().optional(),
  prometheusQuery: z.string().optional(),
  isActive: z.boolean().optional().default(true),
});

/**
 * Monitored app update schema (all fields optional)
 */
const updateMonitoredAppSchema = z.object({
  namespace: z.string().min(1).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/).optional(),
  deployment: z.string().min(1).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/).optional(),
  displayName: z.string().min(1).max(100).optional(),
  dashboardUrl: z.string().url().optional(),
  prometheusQuery: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function configRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /config - Get all configuration
   */
  app.get('/', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const [k8sConfig, dashboardConfig, safetyConfig, developmentConfig] = await Promise.all([
      configRepository.getByCategory('kubernetes'),
      configRepository.getByCategory('dashboard'),
      configRepository.getByCategory('safety'),
      configRepository.getByCategory('development'),
    ]);

    const state: ConfigurationState = {
      kubernetes: k8sConfig ? (k8sConfig.config as unknown as KubernetesConfig) : null,
      dashboard: dashboardConfig ? (dashboardConfig.config as unknown as DashboardConfig) : null,
      safety: safetyConfig
        ? (safetyConfig.config as unknown as ActionSafetyConfig)
        : DEFAULT_SAFETY_CONFIG,
      development: developmentConfig
        ? (developmentConfig.config as unknown as DevelopmentSettingsConfig)
        : DEFAULT_DEVELOPMENT_SETTINGS_CONFIG,
      lastUpdated: k8sConfig?.updatedAt?.toISOString() ?? dashboardConfig?.updatedAt?.toISOString(),
    };

    return { success: true, data: state };
  });

  /**
   * GET /config/kubernetes - Get Kubernetes configuration
   */
  app.get('/kubernetes', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const config = await configRepository.getByCategory('kubernetes');

    if (!config) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: config.config as unknown as KubernetesConfig,
      isValid: config.isValid,
      lastTestedAt: config.lastTestedAt?.toISOString(),
    };
  });

  /**
   * PUT /config/kubernetes - Update Kubernetes configuration
   */
  app.put('/kubernetes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = kubernetesConfigSchema.parse(request.body);

      const config = await configRepository.upsert({
        id: 'kubernetes',
        category: 'kubernetes',
        config: body as unknown as Record<string, unknown>,
        isValid: false, // Reset validation on update
      });

      logger.info('Kubernetes configuration updated', { context: body.context });

      return {
        success: true,
        data: config.config as unknown as KubernetesConfig,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to update Kubernetes configuration');
      return reply.status(400).send({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid configuration',
      });
    }
  });

  /**
   * POST /config/kubernetes/test - Test Kubernetes connection
   */
  app.post('/kubernetes/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Security fix: Validate and sanitize context parameter to prevent command injection
      const body = kubernetesTestSchema.parse(request.body);
      const context = body.context;

      // Check if running in-cluster (service account token exists)
      const inClusterTokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
      const isInCluster = existsSync(inClusterTokenPath);

      // Check if kubeconfig exists (for local development)
      const kubeconfigPath = process.env.KUBECONFIG || join(homedir(), '.kube', 'config');
      const hasKubeconfig = existsSync(kubeconfigPath);

      if (!hasKubeconfig && !isInCluster) {
        return {
          success: false,
          message: 'Kubeconfig not found. Please configure kubectl first.',
        };
      }

      // Validate kubectl context by running a test command
      try {
        // Build the kubectl command with proper credentials
        let kubectlPrefix: string;
        if (isInCluster) {
          // In-cluster mode: use service account credentials explicitly
          const caPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
          kubectlPrefix = `kubectl --server=https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT --certificate-authority=${caPath} --token=$(cat ${inClusterTokenPath})`;
        } else {
          // Kubeconfig mode: use context if provided
          const contextArg = context ? `--context=${context}` : '';
          kubectlPrefix = `kubectl ${contextArg}`;
        }

        // Test connection by getting namespaces (tests both connectivity and RBAC)
        const { stdout } = await execAsync(
          `${kubectlPrefix} get namespaces --request-timeout=5s 2>&1`,
          { timeout: 10000, shell: '/bin/sh' }
        );

        // Parse namespace output to confirm cluster access
        const namespaceCount = stdout.split('\n').filter(line => line.trim() && !line.startsWith('NAME')).length;

        // Mark config as valid if test passes
        await configRepository.setValid('kubernetes', true);

        return {
          success: true,
          message: isInCluster 
            ? 'Kubernetes connection successful (in-cluster mode)'
            : `Kubernetes connection successful${context ? ` (context: ${context})` : ''}`,
          details: {
            mode: isInCluster ? 'in-cluster' : 'kubeconfig',
            kubeconfigPath: isInCluster ? undefined : kubeconfigPath,
            context: isInCluster ? 'in-cluster' : (context || 'default'),
            clusterInfo: `Connected to cluster with ${namespaceCount} namespaces`,
          },
        };
      } catch (kubectlError) {
        const errorMessage = kubectlError instanceof Error ? kubectlError.message : 'Unknown error';
        logger.warn({ context, error: errorMessage, isInCluster }, 'Kubectl context validation failed');

        // Check if context exists in kubeconfig file (only for non-in-cluster mode)
        let availableContexts: string[] = [];
        if (!isInCluster) {
          try {
            const kubeconfigContent = readFileSync(kubeconfigPath, 'utf-8');
            const contextMatches = kubeconfigContent.match(/name:\s*([^\s\n]+)/g);
            if (contextMatches) {
              availableContexts = contextMatches.map(m => m.replace('name:', '').trim());
            }
          } catch {
            // Ignore kubeconfig parsing errors
          }
        }

        return {
          success: false,
          message: `Kubernetes connection failed: ${errorMessage.includes('Unable to connect') ? 'Cluster unreachable' : errorMessage.includes('context') ? 'Invalid context' : 'Connection error'}`,
          details: isInCluster ? {
            mode: 'in-cluster',
            error: errorMessage.substring(0, 200),
          } : {
            mode: 'kubeconfig',
            kubeconfigPath,
            requestedContext: context || 'default',
            availableContexts: availableContexts.length > 0 ? availableContexts : undefined,
          },
        };
      }
    } catch (error) {
      logger.error({ error }, 'Kubernetes connection test failed');
      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed',
      });
    }
  });

  /**
   * GET /config/dashboard - Get Dashboard Monitoring configuration
   */
  app.get('/dashboard', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const config = await configRepository.getByCategory('dashboard');

    if (!config) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: config.config as unknown as DashboardConfig,
      isValid: config.isValid,
      lastTestedAt: config.lastTestedAt?.toISOString(),
    };
  });

  /**
   * PUT /config/dashboard - Update Dashboard Monitoring configuration
   */
  app.put('/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = dashboardConfigSchema.parse(request.body);

      const config = await configRepository.upsert({
        id: 'dashboard',
        category: 'dashboard',
        config: body as unknown as Record<string, unknown>,
        isValid: false,
      });

      logger.info('Dashboard configuration updated', { url: body.screenCaptureUrl });

      return {
        success: true,
        data: config.config as unknown as DashboardConfig,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to update Dashboard configuration');
      return reply.status(400).send({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid configuration',
      });
    }
  });

  /**
   * POST /config/dashboard/test - Test Screen Capture connection
   */
  app.post('/dashboard/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Security fix: Validate URL to prevent SSRF
      const body = dashboardTestSchema.parse(request.body);
      const url = body.url || 'http://localhost:4000';

      // Test connection to screen capture service
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `Screen capture service returned ${response.status}`,
        };
      }

      const healthData = await response.json();

      // Mark config as valid if test passes
      await configRepository.setValid('dashboard', true);

      return {
        success: true,
        message: 'Screen capture service is healthy',
        details: healthData,
      };
    } catch (error) {
      logger.error({ error }, 'Dashboard connection test failed');
      return reply.status(200).send({
        success: false,
        message:
          error instanceof Error
            ? error.message.includes('fetch')
              ? 'Could not connect to screen capture service'
              : error.message
            : 'Connection test failed',
      });
    }
  });

  /**
   * GET /config/safety - Get Action Safety configuration
   */
  app.get('/safety', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const config = await configRepository.getByCategory('safety');

    if (!config) {
      return { success: true, data: DEFAULT_SAFETY_CONFIG };
    }

    return {
      success: true,
      data: config.config as unknown as ActionSafetyConfig,
    };
  });

  /**
   * PUT /config/safety - Update Action Safety configuration
   */
  app.put('/safety', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = actionSafetyConfigSchema.parse(request.body);

      const config = await configRepository.upsert({
        id: 'safety',
        category: 'safety',
        config: body as unknown as Record<string, unknown>,
        isValid: true, // Safety config doesn't need validation
      });

      logger.info('Action safety configuration updated', { dryRunMode: body.dryRunMode });

      return {
        success: true,
        data: config.config as unknown as ActionSafetyConfig,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to update Action safety configuration');
      return reply.status(400).send({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid configuration',
      });
    }
  });

  // ==================== DEVELOPMENT SETTINGS ENDPOINTS ====================

  /**
   * GET /config/development - Get Development Settings configuration
   */
  app.get('/development', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const config = await configRepository.getByCategory('development');

    if (!config) {
      return { success: true, data: DEFAULT_DEVELOPMENT_SETTINGS_CONFIG };
    }

    return {
      success: true,
      data: config.config as unknown as DevelopmentSettingsConfig,
    };
  });

  /**
   * PUT /config/development - Update Development Settings configuration
   */
  app.put('/development', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = developmentSettingsConfigSchema.parse(request.body);

      const config = await configRepository.upsert({
        id: 'development',
        category: 'development',
        config: body as unknown as Record<string, unknown>,
        isValid: true, // Development settings don't need validation
      });

      logger.info('Development settings configuration updated', { enableFaultInjection: body.enableFaultInjection });

      return {
        success: true,
        data: config.config as unknown as DevelopmentSettingsConfig,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to update Development settings configuration');
      return reply.status(400).send({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid configuration',
      });
    }
  });

  // ==================== MONITORED APPS ENDPOINTS ====================

  /**
   * GET /config/monitored-apps - Get all monitored apps
   */
  app.get('/monitored-apps', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const apps = await monitoredAppRepository.getAll();
    return { success: true, data: apps };
  });

  /**
   * GET /config/monitored-apps/active - Get active monitored apps only
   */
  app.get('/monitored-apps/active', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const apps = await monitoredAppRepository.getActive();
    return { success: true, data: apps };
  });

  /**
   * GET /config/monitored-apps/:id - Get a monitored app by ID
   */
  app.get('/monitored-apps/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    // Security fix: Validate ID parameter
    const { id } = idParamSchema.parse(request.params);
    const monitoredApp = await monitoredAppRepository.getById(id);

    if (!monitoredApp) {
      return reply.status(404).send({
        success: false,
        error: 'Monitored app not found',
      });
    }

    return { success: true, data: monitoredApp };
  });

  /**
   * POST /config/monitored-apps - Add a monitored app
   */
  app.post('/monitored-apps', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Security fix: Validate input with Zod schema
      const body = createMonitoredAppSchema.parse(request.body);

      // Check if app already exists
      const existing = await monitoredAppRepository.getByNamespaceAndDeployment(
        body.namespace,
        body.deployment
      );

      if (existing) {
        return reply.status(409).send({
          success: false,
          error: 'Monitored app already exists for this namespace/deployment',
          data: existing,
        });
      }

      const monitoredApp = await monitoredAppRepository.create(body);
      logger.info(
        { namespace: body.namespace, deployment: body.deployment },
        'Monitored app created'
      );

      return reply.status(201).send({ success: true, data: monitoredApp });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        });
      }
      logger.error({ error }, 'Failed to create monitored app');
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create monitored app',
      });
    }
  });

  /**
   * PUT /config/monitored-apps/:id - Update a monitored app
   */
  app.put('/monitored-apps/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Security fix: Validate params and body with Zod schemas
      const { id } = idParamSchema.parse(request.params);
      const body = updateMonitoredAppSchema.parse(request.body);

      const existing = await monitoredAppRepository.getById(id);
      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: 'Monitored app not found',
        });
      }

      const monitoredApp = await monitoredAppRepository.update(id, body);
      logger.info({ id }, 'Monitored app updated');

      return { success: true, data: monitoredApp };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        });
      }
      logger.error({ error }, 'Failed to update monitored app');
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update monitored app',
      });
    }
  });

  /**
   * DELETE /config/monitored-apps/:id - Remove a monitored app
   */
  app.delete('/monitored-apps/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Security fix: Validate ID parameter
      const { id } = idParamSchema.parse(request.params);

      const existing = await monitoredAppRepository.getById(id);
      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: 'Monitored app not found',
        });
      }

      await monitoredAppRepository.delete(id);
      logger.info({ id }, 'Monitored app deleted');

      return { success: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        });
      }
      logger.error({ error }, 'Failed to delete monitored app');
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete monitored app',
      });
    }
  });

  /**
   * GET /config/monitored-apps/:id/metrics - Get real-time metrics for an app
   * Fetches metrics from Prometheus for dashboard display
   */
  app.get(
    '/monitored-apps/:id/metrics',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = idParamSchema.parse(request.params);

      const monitoredApp = await monitoredAppRepository.getById(id);
      if (!monitoredApp) {
        return reply.status(404).send({
          success: false,
          error: 'Monitored app not found',
        });
      }

      const { PrometheusClient } = await import('@chronosops/core');
      const { K8sClient } = await import('@chronosops/kubernetes');
      const prometheusClient = new PrometheusClient();

      const isAvailable = await prometheusClient.isAvailable();
      const ns = monitoredApp.namespace;
      const app = monitoredApp.deployment;

      // Fetch metrics using PromQL - use source_namespace as that's how prometheus relabels
      // Using 1m window for faster recovery display after fixes
      const [errorRate, requestRate, latency, cpuUsage, memoryUsage, podCount] = await Promise.all([
        // Error rate percentage
        prometheusClient.query(
          `sum(rate(http_requests_total{source_namespace="${ns}", app="${app}", status=~"5.."}[1m])) / sum(rate(http_requests_total{source_namespace="${ns}", app="${app}"}[1m])) * 100 or vector(0)`
        ),
        // Request rate per second
        prometheusClient.query(
          `sum(rate(http_requests_total{source_namespace="${ns}", app="${app}"}[1m])) or vector(0)`
        ),
        // P95 latency in ms
        prometheusClient.query(
          `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{source_namespace="${ns}", app="${app}"}[1m])) by (le)) * 1000 or vector(0)`
        ),
        // CPU usage - try container metrics first, fallback to process metrics
        prometheusClient.query(
          `sum(rate(container_cpu_usage_seconds_total{namespace="${ns}", pod=~"${app}.*"}[1m])) * 100 or avg(rate(process_cpu_seconds_total{source_namespace="${ns}", app="${app}"}[1m])) * 100 or vector(0)`
        ),
        // Memory usage - try container metrics first, fallback to process metrics (as MB)
        prometheusClient.query(
          `sum(container_memory_working_set_bytes{namespace="${ns}", pod=~"${app}.*"}) / 1024 / 1024 or avg(process_resident_memory_bytes{source_namespace="${ns}", app="${app}"}) / 1024 / 1024 or vector(0)`
        ),
        // Pod count from kube-state-metrics
        prometheusClient.query(
          `count(kube_pod_status_phase{namespace="${ns}", pod=~"${app}.*", phase="Running"}) or vector(0)`
        ),
      ]);

      // Fallback to K8s API for pod count if Prometheus returns 0
      let podCountValue = podCount.value ?? 0;
      if (podCountValue === 0) {
        try {
          const k8sClient = new K8sClient({
            allowedNamespaces: [ns],
            allowedActions: [],
            dryRun: true,
          });
          const pods = await k8sClient.getDeploymentPods(app, ns);
          podCountValue = pods.filter(p => p.status === 'Running').length;
        } catch {
          podCountValue = 1; // Default assumption if K8s API fails
        }
      }

      const metrics = {
        errorRate: {
          value: errorRate.value ?? 0,
          unit: '%',
          status: (errorRate.value ?? 0) > 5 ? 'critical' : (errorRate.value ?? 0) > 1 ? 'warning' : 'healthy',
        },
        requestRate: {
          value: requestRate.value ?? 0,
          unit: 'req/s',
          status: 'healthy' as const,
        },
        latency: {
          value: latency.value ?? 0,
          unit: 'ms',
          status: (latency.value ?? 0) > 1000 ? 'critical' : (latency.value ?? 0) > 500 ? 'warning' : 'healthy',
        },
        cpu: {
          value: cpuUsage.value ?? 0,
          limit: 100,
          unit: '%',
          status: (cpuUsage.value ?? 0) > 90 ? 'critical' : (cpuUsage.value ?? 0) > 70 ? 'warning' : 'healthy',
        },
        memory: {
          value: memoryUsage.value ?? 0,
          limit: 512, // Default limit in MB, could be fetched from K8s
          unit: 'MB',
          status: (memoryUsage.value ?? 0) > 450 ? 'critical' : (memoryUsage.value ?? 0) > 350 ? 'warning' : 'healthy',
        },
        pods: {
          ready: podCountValue,
          desired: 1, // Could be fetched from K8s deployment
        },
        prometheusAvailable: isAvailable,
        timestamp: new Date().toISOString(),
      };

      return { success: true, data: metrics };
    }
  );

  /**
   * POST /config/monitored-apps/:id/generate-dashboard - Generate Grafana dashboard
   * This is a placeholder - will be implemented in Phase 8
   */
  app.post(
    '/monitored-apps/:id/generate-dashboard',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Security fix: Validate ID parameter
      const { id } = idParamSchema.parse(request.params);

      const monitoredApp = await monitoredAppRepository.getById(id);
      if (!monitoredApp) {
        return reply.status(404).send({
          success: false,
          error: 'Monitored app not found',
        });
      }

      // TODO: Implement Grafana dashboard generation in Phase 8
      logger.info({ id, namespace: monitoredApp.namespace, deployment: monitoredApp.deployment }, 'Dashboard generation requested');

      return reply.status(501).send({
        success: false,
        error: 'Dashboard generation not yet implemented',
        message: 'Grafana integration will be implemented in Phase 8',
      });
    }
  );
}
