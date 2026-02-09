/**
 * Platform Abstraction Layer
 *
 * Provides interfaces for remediation targets across different platforms.
 * Currently supports Kubernetes, designed for future extension to:
 * - Docker/Docker Compose
 * - AWS ECS
 * - Nomad
 * - On-premise systems
 */

/**
 * Supported platform types
 */
export type PlatformType = 'kubernetes' | 'docker' | 'aws-ecs' | 'nomad' | 'custom';

/**
 * Base platform configuration
 */
export interface PlatformConfig {
  type: PlatformType;
  enabled: boolean;
  name: string;
  connectionConfig: Record<string, unknown>;
  allowedActions: string[];
}

/**
 * Kubernetes-specific configuration
 */
export interface KubernetesPlatformConfig extends PlatformConfig {
  type: 'kubernetes';
  connectionConfig: {
    context?: string;
    kubeconfig?: string;
    inCluster?: boolean;
    namespace?: string;
  };
}

/**
 * Abstract service/deployment concept
 * Represents a remediation target across different platforms
 */
export interface RemediationTarget {
  id: string;
  platform: PlatformType;
  name: string;
  namespace?: string; // K8s namespace, ECS cluster, Docker network, etc.
  type: string; // deployment, service, pod, container, task, etc.
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  metadata: Record<string, unknown>;
  labels?: Record<string, string>;
}

/**
 * Abstract remediation action
 */
export interface RemediationAction {
  type: 'rollback' | 'restart' | 'scale' | 'stop' | 'start' | 'custom';
  target: RemediationTarget;
  parameters: Record<string, unknown>;
  reason?: string;
  dryRun?: boolean;
}

/**
 * Result of executing a remediation action
 */
export interface RemediationResult {
  success: boolean;
  action: RemediationAction;
  message: string;
  details?: Record<string, unknown>;
  dryRun: boolean;
  executedAt: Date;
  duration?: number;
}

/**
 * Platform executor interface
 * Each platform implements this to handle remediation actions
 */
export interface PlatformExecutor {
  readonly platformType: PlatformType;
  readonly platformName: string;

  // Connection lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  testConnection(): Promise<{ success: boolean; message: string; details?: Record<string, unknown> }>;

  // Target discovery
  listTargets(namespace?: string): Promise<RemediationTarget[]>;
  getTarget(id: string, namespace?: string): Promise<RemediationTarget | null>;
  watchTargets?(namespace?: string): AsyncIterable<RemediationTarget>;

  // Actions
  executeAction(action: RemediationAction): Promise<RemediationResult>;
  validateAction(action: RemediationAction): Promise<{ valid: boolean; errors?: string[] }>;

  // Capabilities
  getSupportedActions(): string[];
  supportsAction(actionType: string): boolean;
}

/**
 * Factory interface for creating platform executors
 */
export interface PlatformExecutorFactory {
  createExecutor(config: PlatformConfig): PlatformExecutor;
  getSupportedPlatforms(): PlatformType[];
  isSupported(platform: PlatformType): boolean;
}

/**
 * Platform registry for managing multiple platform connections
 */
export interface PlatformRegistry {
  register(platform: PlatformExecutor): void;
  unregister(platformType: PlatformType): void;
  get(platformType: PlatformType): PlatformExecutor | undefined;
  getAll(): PlatformExecutor[];
  getPrimary(): PlatformExecutor | undefined;
  setPrimary(platformType: PlatformType): void;
}

/**
 * Helper type for platform-specific action parameters
 */
export interface PlatformActionParameters {
  // Kubernetes
  kubernetes?: {
    rollback?: { revision?: number };
    restart?: { gracePeriodSeconds?: number };
    scale?: { replicas: number };
  };
  // Docker (future)
  docker?: {
    restart?: { timeout?: number };
    stop?: { timeout?: number };
  };
  // AWS ECS (future)
  awsEcs?: {
    restart?: { forceNewDeployment?: boolean };
    scale?: { desiredCount: number };
  };
}

/**
 * Documentation: How to add a new platform
 *
 * 1. Add the platform type to PlatformType union
 *
 * 2. Create platform-specific config interface:
 *    ```typescript
 *    export interface DockerPlatformConfig extends PlatformConfig {
 *      type: 'docker';
 *      connectionConfig: {
 *        host: string;
 *        socketPath?: string;
 *        tlsConfig?: { ... };
 *      };
 *    }
 *    ```
 *
 * 3. Implement PlatformExecutor interface:
 *    ```typescript
 *    export class DockerExecutor implements PlatformExecutor {
 *      readonly platformType = 'docker' as const;
 *      readonly platformName = 'Docker';
 *
 *      async connect() { ... }
 *      async listTargets() { ... }
 *      async executeAction(action) { ... }
 *      // ... implement all interface methods
 *    }
 *    ```
 *
 * 4. Register in the factory:
 *    ```typescript
 *    class ExecutorFactory implements PlatformExecutorFactory {
 *      createExecutor(config: PlatformConfig) {
 *        switch (config.type) {
 *          case 'kubernetes': return new K8sExecutor(config);
 *          case 'docker': return new DockerExecutor(config);
 *          default: throw new Error(`Unknown platform: ${config.type}`);
 *        }
 *      }
 *    }
 *    ```
 *
 * 5. Add UI configuration in Setup.tsx
 */
