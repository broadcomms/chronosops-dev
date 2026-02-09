/**
 * Configuration Service
 * Reads configuration from database and environment variables
 * Provides dynamic namespace configuration for K8s executor
 */

import { monitoredAppRepository, configRepository } from '@chronosops/database';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'ConfigService' });

export interface KubernetesExecutorConfig {
  allowedNamespaces: string[];
  allowedActions: ('rollback' | 'restart' | 'scale' | 'code_fix')[];
  dryRunDefault: boolean;
  kubeconfigPath?: string;
  context?: string;
}

/**
 * Service for reading configuration from database and env vars
 */
export class ConfigService {
  private envAllowedNamespaces: string[];
  private envAllowedActions: ('rollback' | 'restart' | 'scale' | 'code_fix')[];

  constructor() {
    // Parse env vars on construction
    this.envAllowedNamespaces = (process.env.K8S_ALLOWED_NAMESPACES ?? '')
      .split(',')
      .filter(Boolean);
    // Default includes code_fix for escalating remediation
    this.envAllowedActions = (process.env.K8S_ALLOWED_ACTIONS ?? 'rollback,restart,scale,code_fix')
      .split(',')
      .filter(Boolean) as ('rollback' | 'restart' | 'scale' | 'code_fix')[];
  }

  /**
   * Get allowed namespaces from monitored apps database
   * Falls back to K8S_ALLOWED_NAMESPACES env var if no apps configured
   */
  async getAllowedNamespaces(): Promise<string[]> {
    try {
      // Get namespaces from active monitored apps
      const namespaces = await monitoredAppRepository.getActiveNamespaces();

      if (namespaces.length > 0) {
        logger.debug(
          { namespaces, source: 'database' },
          'Loaded allowed namespaces from monitored apps'
        );
        return namespaces;
      }

      // Fallback to env var if no monitored apps
      if (this.envAllowedNamespaces.length > 0) {
        logger.debug(
          { namespaces: this.envAllowedNamespaces, source: 'env' },
          'Using allowed namespaces from environment variable'
        );
        return this.envAllowedNamespaces;
      }

      // Default fallback
      logger.warn('No allowed namespaces configured, using defaults');
      return ['demo', 'staging'];
    } catch (error) {
      logger.error({ error }, 'Failed to load namespaces, using fallback');
      return this.envAllowedNamespaces.length > 0
        ? this.envAllowedNamespaces
        : ['demo', 'staging'];
    }
  }

  /**
   * Get allowed actions from database (Kubernetes config)
   * Falls back to K8S_ALLOWED_ACTIONS env var if not configured
   * Supports: rollback, restart, scale, code_fix (for escalating remediation)
   */
  async getAllowedActions(): Promise<('rollback' | 'restart' | 'scale' | 'code_fix')[]> {
    try {
      // Get config from database
      const k8sConfig = await configRepository.getByCategory('kubernetes');

      if (k8sConfig?.config?.allowedActions) {
        const actionConfig = k8sConfig.config.allowedActions as {
          rollback?: boolean;
          restart?: boolean;
          scale?: boolean;
          code_fix?: boolean;
        };

        const allowed: ('rollback' | 'restart' | 'scale' | 'code_fix')[] = [];
        if (actionConfig.rollback) allowed.push('rollback');
        if (actionConfig.restart) allowed.push('restart');
        if (actionConfig.scale) allowed.push('scale');
        if (actionConfig.code_fix) allowed.push('code_fix');

        if (allowed.length > 0) {
          logger.debug(
            { allowedActions: allowed, source: 'database' },
            'Loaded allowed actions from database'
          );
          return allowed;
        }
      }

      // Fallback to env var
      if (this.envAllowedActions.length > 0) {
        logger.debug(
          { allowedActions: this.envAllowedActions, source: 'env' },
          'Using allowed actions from environment variable'
        );
        return this.envAllowedActions;
      }

      // Default fallback - operational actions plus code_fix for escalation
      logger.warn('No allowed actions configured, using defaults (rollback, restart, scale, code_fix)');
      return ['rollback', 'restart', 'scale', 'code_fix'];
    } catch (error) {
      logger.error({ error }, 'Failed to load allowed actions, using fallback');
      return this.envAllowedActions.length > 0
        ? this.envAllowedActions
        : ['rollback', 'restart', 'scale', 'code_fix'];
    }
  }

  /**
   * Get full Kubernetes executor configuration
   * Merges database config with env vars
   */
  async getKubernetesConfig(): Promise<KubernetesExecutorConfig> {
    const allowedNamespaces = await this.getAllowedNamespaces();
    const allowedActions = await this.getAllowedActions();

    return {
      allowedNamespaces,
      allowedActions,
      dryRunDefault: process.env.K8S_DRY_RUN === 'true',
      kubeconfigPath: process.env.KUBECONFIG,
      context: process.env.K8S_CONTEXT,
    };
  }

  /**
   * Check if a namespace is allowed for actions
   */
  async isNamespaceAllowed(namespace: string): Promise<boolean> {
    const allowedNamespaces = await this.getAllowedNamespaces();
    return allowedNamespaces.includes(namespace);
  }

  /**
   * Get monitored app info for an incident
   */
  async getMonitoredAppByNamespace(namespace: string) {
    const apps = await monitoredAppRepository.getActive();
    return apps.find((app) => app.namespace === namespace);
  }
}

// Singleton instance
export const configService = new ConfigService();
