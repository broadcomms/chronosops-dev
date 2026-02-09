/**
 * @chronosops/grafana
 * Grafana API client for dashboard auto-generation
 */

export {
  GrafanaClient,
  createGrafanaClientFromEnv,
} from './grafana-client.js';

export type {
  GrafanaClientConfig,
  DashboardCreateInput,
  DashboardResult,
} from './grafana-client.js';

// Unified dashboard template
export {
  generateUnifiedDashboard,
  generateEmptyUnifiedDashboard,
} from './templates/unified-dashboard.js';

export type { UnifiedDashboardDefinition } from './templates/unified-dashboard.js';
