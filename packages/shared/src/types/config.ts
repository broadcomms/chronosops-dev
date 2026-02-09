/**
 * Configuration Types for ChronosOps Setup
 * Zod schemas for validation on both frontend and backend
 */

import { z } from 'zod';

/**
 * Kubernetes Configuration Schema
 */
export const kubernetesConfigSchema = z.object({
  context: z.string().min(1, 'Kubernetes context is required'),
  namespace: z.string().default('default'),
  allowedNamespaces: z.array(z.string()).default(['default']),
  allowedActions: z.object({
    rollback: z.boolean().default(true),
    restart: z.boolean().default(true),
    scale: z.boolean().default(false),
  }),
  kubeconfig: z.string().optional(),
});

export type KubernetesConfig = z.infer<typeof kubernetesConfigSchema>;

/**
 * Dashboard/Vision Monitoring Configuration Schema
 */
export const dashboardConfigSchema = z.object({
  // Vision settings (new architecture)
  visionFps: z
    .number()
    .min(1, 'Minimum FPS is 1')
    .max(10, 'Maximum FPS is 10')
    .default(2),
  visionWidth: z
    .number()
    .min(640, 'Minimum width is 640')
    .max(1920, 'Maximum width is 1920')
    .default(1280),
  visionHeight: z
    .number()
    .min(480, 'Minimum height is 480')
    .max(1080, 'Maximum height is 1080')
    .default(720),
  recordingDirectory: z.string().default('./data/recordings'),
  // Legacy fields (kept for backwards compatibility)
  screenCaptureUrl: z.string().url('Invalid URL format').optional(),
  captureIntervalMs: z.number().optional(),
  grafanaUrl: z.string().url('Invalid URL format').optional(),
  dashboardUid: z.string().optional(),
});

export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;

/**
 * Action Safety Configuration Schema
 */
export const actionSafetyConfigSchema = z.object({
  actionCooldownMs: z
    .number()
    .min(10000, 'Minimum cooldown is 10 seconds')
    .max(600000, 'Maximum cooldown is 10 minutes')
    .default(60000),
  maxActionsPerWindow: z
    .number()
    .min(1, 'Minimum is 1 action')
    .max(20, 'Maximum is 20 actions')
    .default(5),
  actionWindowMs: z
    .number()
    .min(60000, 'Minimum window is 1 minute')
    .max(3600000, 'Maximum window is 1 hour')
    .default(300000),
  dryRunMode: z.boolean().default(false),
  enforceCooldowns: z.boolean().default(true),
  /**
   * When false (default), incident-triggered code evolutions run automatically
   * through the full cycle: analyze → generate → approve → apply → rebuild → deploy.
   * When true, evolutions require manual user intervention at each step.
   */
  requireManualCodeEvolutionApproval: z.boolean().default(false),
});

export type ActionSafetyConfig = z.infer<typeof actionSafetyConfigSchema>;

/**
 * Development Settings Configuration Schema
 * Controls code generation and testing features
 */
export const developmentSettingsConfigSchema = z.object({
  /**
   * When true, generated apps include fault injection middleware and /bugs/* endpoints
   * for testing rollback, restart, scale, and code evolution features.
   * When false (default), apps are production-ready without testing endpoints.
   */
  enableFaultInjection: z.boolean().default(false),
  /**
   * When true and requirement contains "production bug that needs to be fixed",
   * verification phase will bypass 500 errors to allow intentional bugs to pass
   * initial development verification. This enables testing the evolution cycle.
   */
  enablePromptInjectionTesting: z.boolean().default(false),
});

export type DevelopmentSettingsConfig = z.infer<typeof developmentSettingsConfigSchema>;

/**
 * Combined Configuration State Schema
 */
export const configurationStateSchema = z.object({
  kubernetes: kubernetesConfigSchema.nullable().default(null),
  dashboard: dashboardConfigSchema.nullable().default(null),
  safety: actionSafetyConfigSchema.default({
    actionCooldownMs: 60000,
    maxActionsPerWindow: 5,
    actionWindowMs: 300000,
    dryRunMode: false,
    enforceCooldowns: true,
    requireManualCodeEvolutionApproval: false,
  }),
  development: developmentSettingsConfigSchema.default({
    enableFaultInjection: false,
    enablePromptInjectionTesting: false,
  }),
  lastUpdated: z.string().datetime().optional(),
});

export type ConfigurationState = z.infer<typeof configurationStateSchema>;

/**
 * API Response Types
 */
export interface ConfigApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Config Categories
 */
export const CONFIG_CATEGORIES = {
  KUBERNETES: 'kubernetes',
  DASHBOARD: 'dashboard',
  SAFETY: 'safety',
  DEVELOPMENT: 'development',
  PLATFORM: 'platform',
} as const;

export type ConfigCategory = (typeof CONFIG_CATEGORIES)[keyof typeof CONFIG_CATEGORIES];

/**
 * Default configurations
 */
export const DEFAULT_KUBERNETES_CONFIG: KubernetesConfig = {
  context: '',
  namespace: 'default',
  allowedNamespaces: ['default'],
  allowedActions: {
    rollback: true,
    restart: true,
    scale: false,
  },
};

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  visionFps: 2,
  visionWidth: 1280,
  visionHeight: 720,
  recordingDirectory: './data/recordings',
};

export const DEFAULT_SAFETY_CONFIG: ActionSafetyConfig = {
  actionCooldownMs: 60000,
  maxActionsPerWindow: 5,
  actionWindowMs: 300000,
  dryRunMode: false,
  enforceCooldowns: true,
  requireManualCodeEvolutionApproval: false,
};

export const DEFAULT_DEVELOPMENT_SETTINGS_CONFIG: DevelopmentSettingsConfig = {
  enableFaultInjection: false,
  enablePromptInjectionTesting: false,
};
