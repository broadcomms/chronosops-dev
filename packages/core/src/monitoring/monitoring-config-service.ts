/**
 * Monitoring Configuration Service
 * Auto-registers deployed apps for monitoring with Prometheus
 * Links Development Pipeline to Incident Response through ServiceRegistry → MonitoredApps
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createChildLogger } from '@chronosops/shared';
import {
  monitoredAppRepository,
  serviceRegistryRepository,
  type MonitoredApp,
  type ServiceRegistryRecord,
} from '@chronosops/database';
import { getVisionService } from '../vision/vision-service.js';

const logger = createChildLogger({ component: 'MonitoringConfigService' });

export interface MonitoringRegistrationResult {
  success: boolean;
  monitoredAppId?: string;
  prometheusJob?: string;
  error?: string;
}

export interface MonitoringConfig {
  monitoredApp: MonitoredApp;
  serviceRegistry: ServiceRegistryRecord;
  prometheusJob: string;
}

/**
 * Service for automatically configuring monitoring for deployed applications
 * Integrates Development Pipeline with Incident Response
 */
export class MonitoringConfigService {
  constructor() {
    // Prometheus and Vision monitoring are configured automatically
  }

  /**
   * Register a deployed app for monitoring
   * Called by DevelopmentOrchestrator after successful deployment
   */
  async registerForMonitoring(cycleId: string): Promise<MonitoringRegistrationResult> {
    logger.info({ cycleId }, 'Registering app for monitoring');

    try {
      // 1. Get the service registry entry for this cycle
      const service = await serviceRegistryRepository.getByDevelopmentCycleId(cycleId);
      if (!service) {
        logger.warn({ cycleId }, 'No service registry entry found');
        return {
          success: false,
          error: 'No service registry entry found for this development cycle',
        };
      }

      // 2. Check if already registered
      const existingApp = await monitoredAppRepository.getByDevelopmentCycleId(cycleId);
      if (existingApp) {
        logger.info({ cycleId, appId: existingApp.id }, 'App already registered for monitoring');
        return {
          success: true,
          monitoredAppId: existingApp.id,
          prometheusJob: existingApp.prometheusJob ?? `chronosops-${service.name}`,
        };
      }

      // 3. Generate Prometheus job name
      const prometheusJob = `chronosops-${service.name}`;

      // 4. Create MonitoredApp entry
      const monitoredApp = await monitoredAppRepository.create({
        namespace: service.namespace,
        deployment: service.name,
        displayName: service.displayName,
        isActive: true,
        developmentCycleId: cycleId,
        prometheusJob,
      });

      logger.info({
        cycleId,
        appId: monitoredApp.id,
        prometheusJob,
      }, 'App registered for monitoring');

      // 5. AUTO-START Vision Monitoring for real-time dashboard feed
      try {
        const visionService = getVisionService();
        await visionService.startMonitoring(service.name, service.namespace);
        logger.info({
          serviceName: service.name,
          namespace: service.namespace,
        }, 'Vision monitoring auto-started for deployed app');
      } catch (visionError) {
        // Vision monitoring is non-critical - log but don't fail registration
        logger.warn({
          error: visionError instanceof Error ? visionError.message : 'Unknown',
          serviceName: service.name,
        }, 'Failed to auto-start vision monitoring (non-critical)');
      }

      // AUTO-UPDATE Prometheus config to scrape new app
      await this.updatePrometheusConfig();

      return {
        success: true,
        monitoredAppId: monitoredApp.id,
        prometheusJob,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage, cycleId }, 'Failed to register app for monitoring');
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Deregister an app from monitoring
   * Called when development cycle is deleted
   */
  async deregisterFromMonitoring(cycleId: string): Promise<void> {
    logger.info({ cycleId }, 'Deregistering app from monitoring');

    try {
      const monitoredApp = await monitoredAppRepository.getByDevelopmentCycleId(cycleId);
      if (!monitoredApp) {
        logger.info({ cycleId }, 'No monitored app found - nothing to deregister');
        return;
      }

      // Stop Vision Monitoring first
      try {
        const visionService = getVisionService();
        visionService.stopMonitoring(monitoredApp.deployment);
        logger.info({ serviceName: monitoredApp.deployment }, 'Vision monitoring stopped');
      } catch (visionError) {
        logger.warn({ error: visionError }, 'Failed to stop vision monitoring');
      }

      // Delete monitored app entry
      await monitoredAppRepository.deleteByDevelopmentCycleId(cycleId);

      logger.info({ cycleId }, 'App deregistered from monitoring');
    } catch (error) {
      logger.error({ error, cycleId }, 'Error deregistering app from monitoring');
    }
  }

  /**
   * Get all registered monitored apps with their full configuration
   */
  async getMonitoredAppsWithConfig(): Promise<MonitoringConfig[]> {
    const apps = await monitoredAppRepository.getActive();
    const configs: MonitoringConfig[] = [];

    for (const app of apps) {
      let service = null;

      // First try to get service by developmentCycleId if available
      if (app.developmentCycleId) {
        service = await serviceRegistryRepository.getByDevelopmentCycleId(
          app.developmentCycleId
        );
      }

      // Fallback: try to get service by deployment name
      // This handles apps that were manually added or have missing cycle IDs
      if (!service) {
        service = await serviceRegistryRepository.getByName(app.deployment);
      }

      if (!service) {
        logger.warn({
          appId: app.id,
          deployment: app.deployment,
          namespace: app.namespace,
        }, 'Could not find service registry entry for monitored app, skipping');
        continue;
      }

      configs.push({
        monitoredApp: app,
        serviceRegistry: service,
        prometheusJob: app.prometheusJob ?? `chronosops-${service.name}`,
      });
    }

    return configs;
  }

  /**
   * Find the development cycle ID for a given deployment
   * Used by InvestigationOrchestrator to link incidents to code evolution
   */
  async findDevelopmentCycleByDeployment(
    namespace: string,
    deployment: string
  ): Promise<string | null> {
    const monitoredApp = await monitoredAppRepository.getByNamespaceAndDeployment(
      namespace,
      deployment
    );
    return monitoredApp?.developmentCycleId ?? null;
  }

  /**
   * Get MonitoredApp by deployment name
   */
  async getMonitoredAppByDeployment(
    namespace: string,
    deployment: string
  ): Promise<MonitoredApp | null> {
    return monitoredAppRepository.getByNamespaceAndDeployment(namespace, deployment);
  }

  /**
   * Update alert rules configuration for a monitored app
   */
  async updateAlertRules(
    cycleId: string,
    alertRulesConfig: Record<string, unknown>
  ): Promise<void> {
    const app = await monitoredAppRepository.getByDevelopmentCycleId(cycleId);
    if (!app) {
      logger.warn({ cycleId }, 'No monitored app found for alert rules update');
      return;
    }

    await monitoredAppRepository.update(app.id, {
      alertRulesConfig: JSON.stringify(alertRulesConfig),
    });

    logger.info({ cycleId, appId: app.id }, 'Alert rules updated');
  }

  /**
   * Update Prometheus configuration to scrape all monitored apps
   * Dynamically generates prometheus.yml and triggers a reload
   *
   * NOTE: In GKE/cloud deployments, prometheus.yml is managed by the cluster
   * configuration (ConfigMaps), so local file updates are skipped.
   */
  async updatePrometheusConfig(): Promise<void> {
    logger.info('Updating Prometheus configuration');

    // Skip local prometheus.yml updates when running in-cluster or when explicitly disabled
    // In GKE, Prometheus config is managed via ConfigMaps, not local files
    const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;
    const skipConfigUpdate = process.env.SKIP_PROMETHEUS_CONFIG_UPDATE === 'true';

    if (isInCluster || skipConfigUpdate) {
      logger.info({
        isInCluster,
        skipConfigUpdate,
      }, 'Skipping local prometheus.yml update (in-cluster or explicitly disabled)');
      // Still trigger reload in case Prometheus ConfigMap was updated separately
      await this.triggerPrometheusReload();
      return;
    }

    try {
      // Get all active monitored apps with their service registry info
      const configs = await this.getMonitoredAppsWithConfig();

      if (configs.length === 0) {
        logger.info('No monitored apps to configure for Prometheus');
        return;
      }

      // Build target list from service URLs
      const targets: Array<{
        target: string;
        app: string;
        namespace: string;
      }> = [];

      for (const config of configs) {
        // Extract port from serviceUrl (e.g., http://localhost:30259 -> 30259)
        const serviceUrl = config.serviceRegistry.serviceUrl;
        if (!serviceUrl) {
          logger.warn({
            serviceName: config.serviceRegistry.name,
          }, 'Service has no URL, skipping Prometheus target');
          continue;
        }

        const urlMatch = serviceUrl.match(/:(\d+)\/?$/);
        if (!urlMatch) {
          logger.warn({
            serviceName: config.serviceRegistry.name,
            serviceUrl,
          }, 'Could not extract port from service URL');
          continue;
        }

        const port = urlMatch[1];
        targets.push({
          target: `host.docker.internal:${port}`,
          app: config.serviceRegistry.name,
          namespace: config.serviceRegistry.namespace,
        });
      }

      if (targets.length === 0) {
        logger.warn('No valid targets found for Prometheus');
        return;
      }

      // Build the prometheus.yml content
      const prometheusConfig = this.buildPrometheusConfig(targets);

      // Write to demo/prometheus/prometheus.yml
      // Use path.resolve to properly resolve the .. components
      // process.cwd() when running from apps/api is /Users/patricken/ChronosOps/apps/api
      // We need to go up 2 levels to reach /Users/patricken/ChronosOps
      const projectRoot = process.env.PROJECT_ROOT ?? path.resolve(process.cwd(), '..', '..');
      const prometheusPath = path.resolve(projectRoot, 'demo', 'prometheus', 'prometheus.yml');

      logger.debug({ projectRoot, prometheusPath }, 'Writing Prometheus config');
      await fs.writeFile(prometheusPath, prometheusConfig, 'utf-8');

      logger.info({
        targetCount: targets.length,
        path: prometheusPath,
      }, 'Prometheus config written');

      // Trigger Prometheus reload
      await this.triggerPrometheusReload();
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown',
      }, 'Failed to update Prometheus configuration');
    }
  }

  /**
   * Trigger Prometheus configuration reload via HTTP API
   */
  private async triggerPrometheusReload(): Promise<void> {
    try {
      // Auto-detect Prometheus URL (same logic as prometheus-client.ts)
      const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;
      const prometheusUrl = process.env.PROMETHEUS_URL ??
        (isInCluster
          ? 'http://prometheus.monitoring.svc.cluster.local:9090'
          : 'http://localhost:30090');

      const response = await fetch(`${prometheusUrl}/-/reload`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        logger.info('Prometheus configuration reloaded');
      } else {
        logger.warn({
          status: response.status,
        }, 'Prometheus reload returned non-OK status');
      }
    } catch (reloadError) {
      // Reload may fail if Prometheus is not running with --web.enable-lifecycle
      logger.warn({
        error: reloadError instanceof Error ? reloadError.message : 'Unknown',
      }, 'Failed to reload Prometheus (may need manual restart)');
    }
  }

  /**
   * Build prometheus.yml content for all targets
   */
  private buildPrometheusConfig(targets: Array<{
    target: string;
    app: string;
    namespace: string;
  }>): string {
    // Generate static_configs for each target with labels
    const staticConfigs = targets.map(t => `      - targets: ['${t.target}']
        labels:
          app: '${t.app}'
          namespace: '${t.namespace}'`).join('\n');

    return `# Prometheus Configuration for ChronosOps
# Auto-generated by MonitoringConfigService
# Do not edit manually - changes will be overwritten

global:
  scrape_interval: 5s
  evaluation_interval: 5s

alerting:
  alertmanagers: []

rule_files: []

scrape_configs:
  # ChronosOps Generated Apps
  # Targets auto-configured when apps are deployed via Development Dashboard
  - job_name: 'chronosops-apps'
    static_configs:
${staticConfigs}
    metrics_path: /metrics
    scheme: http
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
      # Add source_namespace label for VisionService queries
      - source_labels: [namespace]
        target_label: source_namespace

  # Prometheus self-monitoring
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
`;
  }

  /**
   * Start vision monitoring for all active monitored apps
   * Called at server startup to resume monitoring after restarts
   */
  async startMonitoringForAllActiveApps(): Promise<void> {
    logger.info('Starting vision monitoring for all active apps');

    try {
      // First, update Prometheus config for all existing apps
      await this.updatePrometheusConfig();

      const apps = await monitoredAppRepository.getActive();

      if (apps.length === 0) {
        logger.info('No active monitored apps to start monitoring');
        return;
      }

      const visionService = getVisionService();
      let started = 0;

      for (const app of apps) {
        try {
          await visionService.startMonitoring(app.deployment, app.namespace);
          started++;
          logger.debug({ serviceName: app.deployment, namespace: app.namespace }, 'Vision monitoring started');
        } catch (error) {
          logger.warn({
            error: error instanceof Error ? error.message : 'Unknown',
            serviceName: app.deployment,
          }, 'Failed to start vision monitoring for app');
        }
      }

      logger.info({ totalApps: apps.length, started }, 'Vision monitoring startup complete');
    } catch (error) {
      logger.error({ error }, 'Failed to start monitoring for active apps');
    }
  }
}

// Singleton instance
export const monitoringConfigService = new MonitoringConfigService();
