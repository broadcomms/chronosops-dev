/**
 * Unified Dashboard Template
 * Creates a single Grafana dashboard showing all monitored ChronosOps apps
 * Auto-updates when apps are added/removed
 */

// Local interface to avoid circular dependencies with @chronosops/database
export interface MonitoredAppInfo {
  id: string;
  namespace: string;
  deployment: string;
  displayName: string;
  grafanaDashboardUid: string | null;
  grafanaDashboardUrl: string | null;
  isActive: boolean;
}

export interface UnifiedDashboardDefinition {
  dashboard: {
    uid: string;
    title: string;
    tags: string[];
    timezone: string;
    schemaVersion: number;
    refresh: string;
    templating: {
      list: Array<{
        name: string;
        type: string;
        query?: string;
        current?: { text: string; value: string };
        options?: Array<{ text: string; value: string }>;
      }>;
    };
    panels: Array<{
      id: number;
      title: string;
      type: string;
      gridPos: { x: number; y: number; w: number; h: number };
      targets?: Array<{
        expr: string;
        legendFormat?: string;
        refId?: string;
      }>;
      fieldConfig?: unknown;
      options?: unknown;
    }>;
  };
  overwrite: boolean;
}

/**
 * Generate health summary panel showing overall system status
 */
function generateHealthSummaryPanel(apps: MonitoredAppInfo[]): UnifiedDashboardDefinition['dashboard']['panels'][0] {
  const namespaceList = [...new Set(apps.map(a => a.namespace))].join('|');

  return {
    id: 1,
    title: 'System Health Overview',
    type: 'stat',
    gridPos: { x: 0, y: 0, w: 24, h: 4 },
    targets: [
      {
        expr: `count(kube_deployment_status_replicas_available{namespace=~"${namespaceList}"})`,
        legendFormat: 'Healthy Pods',
        refId: 'A',
      },
    ],
    fieldConfig: {
      defaults: {
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: 'red', value: 0 },
            { color: 'yellow', value: apps.length * 0.5 },
            { color: 'green', value: apps.length },
          ],
        },
      },
    },
    options: {
      reduceOptions: { calcs: ['lastNotNull'] },
      textMode: 'value',
      colorMode: 'background',
    },
  };
}

/**
 * Generate per-app status panel
 */
function generateAppStatusPanel(
  app: MonitoredAppInfo,
  index: number
): UnifiedDashboardDefinition['dashboard']['panels'][0] {
  const row = Math.floor(index / 4);
  const col = index % 4;

  return {
    id: 100 + index,
    title: app.displayName,
    type: 'stat',
    gridPos: { x: col * 6, y: 4 + row * 4, w: 6, h: 4 },
    targets: [
      {
        expr: `sum(rate(http_requests_total{namespace="${app.namespace}", app="${app.deployment}"}[5m]))`,
        legendFormat: 'RPS',
        refId: 'A',
      },
    ],
    fieldConfig: {
      defaults: {
        unit: 'reqps',
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: 'red', value: 0 },
            { color: 'green', value: 0.1 },
          ],
        },
        links: app.grafanaDashboardUrl
          ? [{ title: 'View Dashboard', url: app.grafanaDashboardUrl, targetBlank: true }]
          : [],
      },
    },
    options: {
      reduceOptions: { calcs: ['lastNotNull'] },
      textMode: 'value_and_name',
      colorMode: 'background',
    },
  };
}

/**
 * Generate cross-app error rate panel
 */
function generateCrossAppErrorRatePanel(
  apps: MonitoredAppInfo[]
): UnifiedDashboardDefinition['dashboard']['panels'][0] {
  const appRows = Math.ceil(apps.length / 4);
  const yPos = 4 + appRows * 4;

  return {
    id: 200,
    title: 'Error Rate by Application',
    type: 'timeseries',
    gridPos: { x: 0, y: yPos, w: 12, h: 8 },
    targets: apps.map((app, i) => ({
      expr: `sum(rate(http_requests_total{namespace="${app.namespace}", app="${app.deployment}", status=~"5.."}[5m])) / sum(rate(http_requests_total{namespace="${app.namespace}", app="${app.deployment}"}[5m]))`,
      legendFormat: app.displayName,
      refId: String.fromCharCode(65 + i), // A, B, C, ...
    })),
    fieldConfig: {
      defaults: {
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: 'green', value: 0 },
            { color: 'yellow', value: 0.01 },
            { color: 'red', value: 0.05 },
          ],
        },
      },
    },
  };
}

/**
 * Generate latency panel
 */
function generateLatencyPanel(
  apps: MonitoredAppInfo[]
): UnifiedDashboardDefinition['dashboard']['panels'][0] {
  const appRows = Math.ceil(apps.length / 4);
  const yPos = 4 + appRows * 4;

  return {
    id: 201,
    title: 'P99 Latency by Application',
    type: 'timeseries',
    gridPos: { x: 12, y: yPos, w: 12, h: 8 },
    targets: apps.map((app, i) => ({
      expr: `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{namespace="${app.namespace}", app="${app.deployment}"}[5m])) by (le))`,
      legendFormat: app.displayName,
      refId: String.fromCharCode(65 + i),
    })),
    fieldConfig: {
      defaults: {
        unit: 's',
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: 'green', value: 0 },
            { color: 'yellow', value: 0.5 },
            { color: 'red', value: 2 },
          ],
        },
      },
    },
  };
}

/**
 * Generate incident timeline panel (placeholder - connects to ChronosOps)
 */
function generateIncidentTimelinePanel(
  apps: MonitoredAppInfo[]
): UnifiedDashboardDefinition['dashboard']['panels'][0] {
  const appRows = Math.ceil(apps.length / 4);
  const yPos = 4 + appRows * 4 + 8;

  return {
    id: 300,
    title: 'Recent Incidents',
    type: 'table',
    gridPos: { x: 0, y: yPos, w: 24, h: 6 },
    targets: [
      {
        // This would be populated via ChronosOps API annotations
        expr: 'ALERTS{alertstate="firing"}',
        legendFormat: '{{ alertname }}',
        refId: 'A',
      },
    ],
    fieldConfig: {
      defaults: {},
      overrides: [
        {
          matcher: { id: 'byName', options: 'alertname' },
          properties: [{ id: 'displayName', value: 'Incident' }],
        },
      ],
    },
    options: {
      showHeader: true,
      sortBy: [{ displayName: 'Time', desc: true }],
    },
  };
}

/**
 * Generate the complete unified dashboard definition
 */
export function generateUnifiedDashboard(apps: MonitoredAppInfo[]): UnifiedDashboardDefinition {
  // Generate app selector variable
  const appOptions = apps.map((app) => ({
    text: app.displayName,
    value: `${app.namespace}/${app.deployment}`,
  }));

  // Build panels
  const panels: UnifiedDashboardDefinition['dashboard']['panels'] = [];

  // 1. Health summary row
  panels.push(generateHealthSummaryPanel(apps));

  // 2. Per-app status cards
  apps.forEach((app, i) => {
    panels.push(generateAppStatusPanel(app, i));
  });

  // 3. Error rate chart
  panels.push(generateCrossAppErrorRatePanel(apps));

  // 4. Latency chart
  panels.push(generateLatencyPanel(apps));

  // 5. Incident timeline
  panels.push(generateIncidentTimelinePanel(apps));

  return {
    dashboard: {
      uid: 'chronosops-unified',
      title: 'ChronosOps Command Center',
      tags: ['chronosops', 'unified', 'command-center'],
      timezone: 'browser',
      schemaVersion: 30,
      refresh: '10s',
      templating: {
        list: [
          {
            name: 'app',
            type: 'custom',
            options: appOptions,
            current: appOptions[0] ?? { text: 'All', value: '' },
          },
          {
            name: 'interval',
            type: 'interval',
            query: '10s,30s,1m,5m,15m',
            current: { text: '30s', value: '30s' },
          },
        ],
      },
      panels,
    },
    overwrite: true,
  };
}

/**
 * Generate an empty dashboard for when no apps are registered
 */
export function generateEmptyUnifiedDashboard(): UnifiedDashboardDefinition {
  return {
    dashboard: {
      uid: 'chronosops-unified',
      title: 'ChronosOps Command Center',
      tags: ['chronosops', 'unified', 'command-center'],
      timezone: 'browser',
      schemaVersion: 30,
      refresh: '30s',
      templating: { list: [] },
      panels: [
        {
          id: 1,
          title: 'No Applications Registered',
          type: 'text',
          gridPos: { x: 0, y: 0, w: 24, h: 10 },
          options: {
            mode: 'markdown',
            content: `# Welcome to ChronosOps Command Center

No applications are currently registered for monitoring.

## Getting Started

1. Create a development cycle via the API or UI
2. Wait for the cycle to complete deployment
3. The app will be automatically registered for monitoring
4. This dashboard will populate with metrics

## Quick Links

- [Development Dashboard](/development)
- [Incidents](/incidents)
- [API Documentation](/api/docs)`,
          },
        },
      ],
    },
    overwrite: true,
  };
}
