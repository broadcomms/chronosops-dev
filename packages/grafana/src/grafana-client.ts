/**
 * Grafana API Client
 * Creates and manages Grafana dashboards for monitored K8s applications
 */

import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'GrafanaClient' });

export interface GrafanaClientConfig {
  baseUrl: string;
  apiKey: string;
}

export interface DashboardCreateInput {
  namespace: string;
  deployment: string;
  title?: string;
}

export interface DashboardResult {
  uid: string;
  url: string;
  title: string;
}

/**
 * Grafana Dashboard template for K8s applications
 * Includes panels for CPU, Memory, Request Rate, Error Rate
 */
const createDashboardTemplate = (input: DashboardCreateInput) => ({
  dashboard: {
    title: input.title || `${input.deployment} - ${input.namespace}`,
    tags: ['chronosops', 'kubernetes', input.namespace],
    timezone: 'browser',
    schemaVersion: 30,
    templating: {
      list: [
        {
          name: 'namespace',
          type: 'constant',
          query: input.namespace,
        },
        {
          name: 'deployment',
          type: 'constant',
          query: input.deployment,
        },
      ],
    },
    panels: [
      {
        id: 1,
        title: 'CPU Usage',
        type: 'timeseries',
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        targets: [
          {
            expr: `rate(container_cpu_usage_seconds_total{namespace="${input.namespace}", pod=~"${input.deployment}.*"}[5m])`,
            legendFormat: '{{pod}}',
          },
        ],
      },
      {
        id: 2,
        title: 'Memory Usage',
        type: 'timeseries',
        gridPos: { x: 12, y: 0, w: 12, h: 8 },
        targets: [
          {
            expr: `container_memory_usage_bytes{namespace="${input.namespace}", pod=~"${input.deployment}.*"}`,
            legendFormat: '{{pod}}',
          },
        ],
      },
      {
        id: 3,
        title: 'Request Rate',
        type: 'timeseries',
        gridPos: { x: 0, y: 8, w: 12, h: 8 },
        targets: [
          {
            expr: `rate(http_requests_total{namespace="${input.namespace}", deployment="${input.deployment}"}[5m])`,
            legendFormat: '{{status_code}}',
          },
        ],
      },
      {
        id: 4,
        title: 'Error Rate',
        type: 'timeseries',
        gridPos: { x: 12, y: 8, w: 12, h: 8 },
        targets: [
          {
            expr: `rate(http_requests_total{namespace="${input.namespace}", deployment="${input.deployment}", status_code=~"5.."}[5m])`,
            legendFormat: 'Errors',
          },
        ],
      },
    ],
  },
  overwrite: true,
});

export class GrafanaClient {
  private config: GrafanaClientConfig;

  constructor(config: GrafanaClientConfig) {
    this.config = config;
    logger.info({ baseUrl: config.baseUrl }, 'Grafana client initialized');
  }

  /**
   * Create a K8s application dashboard
   */
  async createK8sDashboard(input: DashboardCreateInput): Promise<DashboardResult> {
    const template = createDashboardTemplate(input);

    logger.info(
      { namespace: input.namespace, deployment: input.deployment },
      'Creating Grafana dashboard'
    );

    try {
      const response = await fetch(`${this.config.baseUrl}/api/dashboards/db`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(template),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error }, 'Failed to create dashboard');
        throw new Error(`Grafana API error: ${response.status} - ${error}`);
      }

      const result = (await response.json()) as { uid: string; url: string };

      const dashboardUrl = `${this.config.baseUrl}${result.url}`;

      logger.info(
        { uid: result.uid, url: dashboardUrl },
        'Dashboard created successfully'
      );

      return {
        uid: result.uid,
        url: dashboardUrl,
        title: template.dashboard.title,
      };
    } catch (error) {
      logger.error({ error }, 'Dashboard creation failed');
      throw error;
    }
  }

  /**
   * Delete a dashboard by UID
   */
  async deleteDashboard(uid: string): Promise<void> {
    logger.info({ uid }, 'Deleting Grafana dashboard');

    const response = await fetch(`${this.config.baseUrl}/api/dashboards/uid/${uid}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete dashboard: ${response.status} - ${error}`);
    }

    logger.info({ uid }, 'Dashboard deleted');
  }

  /**
   * Get dashboard URL with kiosk mode for screen capture
   */
  getDashboardUrl(uid: string, namespace: string, deployment: string): string {
    return `${this.config.baseUrl}/d/${uid}?var-namespace=${namespace}&var-deployment=${deployment}&kiosk`;
  }

  /**
   * Check if Grafana is accessible
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/health`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Update or create a dashboard
   * Used for unified dashboards that need to be updated when apps change
   */
  async updateOrCreateDashboard(
    uid: string,
    dashboardDefinition: { dashboard: unknown; overwrite: boolean }
  ): Promise<DashboardResult> {
    logger.info({ uid }, 'Updating/creating dashboard');

    try {
      const response = await fetch(`${this.config.baseUrl}/api/dashboards/db`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(dashboardDefinition),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error }, 'Failed to update/create dashboard');
        throw new Error(`Grafana API error: ${response.status} - ${error}`);
      }

      const result = (await response.json()) as { uid: string; url: string };
      const dashboardUrl = `${this.config.baseUrl}${result.url}`;

      logger.info({ uid: result.uid, url: dashboardUrl }, 'Dashboard updated/created successfully');

      return {
        uid: result.uid,
        url: dashboardUrl,
        title: (dashboardDefinition.dashboard as { title?: string })?.title ?? uid,
      };
    } catch (error) {
      logger.error({ error }, 'Dashboard update/create failed');
      throw error;
    }
  }

  /**
   * Get dashboard by UID
   */
  async getDashboard(uid: string): Promise<{ dashboard: unknown; meta: unknown } | null> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/dashboards/uid/${uid}`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get dashboard: ${response.status}`);
      }

      return (await response.json()) as { dashboard: unknown; meta: unknown };
    } catch (error) {
      logger.error({ error, uid }, 'Failed to get dashboard');
      return null;
    }
  }
}

/**
 * Create Grafana client from environment variables
 */
export function createGrafanaClientFromEnv(): GrafanaClient | null {
  const baseUrl = process.env.GRAFANA_URL;
  const apiKey = process.env.GRAFANA_API_KEY;

  if (!baseUrl || !apiKey) {
    // Debug level - Grafana is optional, graphs are generated directly from backend
    logger.debug('Grafana integration disabled (GRAFANA_URL or GRAFANA_API_KEY not set)');
    return null;
  }

  return new GrafanaClient({ baseUrl, apiKey });
}
