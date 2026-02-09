/**
 * Kubernetes Client
 * Provides safe, audited access to K8s operations
 */

import * as k8s from '@kubernetes/client-node';
import * as yaml from 'js-yaml';
import { createChildLogger, NamespaceNotAllowedError, ActionNotAllowedError } from '@chronosops/shared';
import type {
  K8sClientConfig,
  K8sAction,
  DeploymentInfo,
  RollbackRequest,
  RollbackResult,
  RestartRequest,
  RestartResult,
  ScaleRequest,
  ScaleResult,
  ActionHistoryEntry,
  PodInfo,
  NamespaceInfo,
  ApplyManifestRequest,
  ApplyManifestResult,
  AppliedResource,
  CreateDeploymentRequest,
  CreateDeploymentResult,
  RolloutStatus,
  WaitForRolloutResult,
  DeploymentHealthResult,
  HealthIssue,
  ServiceInfo,
  ServicePortInfo,
  CreatePVCRequest,
  CreatePVCResult,
} from './types.js';
import { K8S_ACTIONS } from './types.js';
import { randomUUID } from 'node:crypto';

const DEFAULT_CONFIG: Partial<K8sClientConfig> = {
  dryRun: true,
  maxActionsPerIncident: 5,
  actionCooldownMs: 60000,
};

export class K8sClient {
  private kc: k8s.KubeConfig;
  private appsApi: k8s.AppsV1Api;
  private coreApi: k8s.CoreV1Api;
  private config: Required<K8sClientConfig>;
  private actionHistory: ActionHistoryEntry[] = [];
  private logger = createChildLogger({ component: 'K8sClient' });

  constructor(config: K8sClientConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<K8sClientConfig>;

    // Initialize Kubernetes client
    this.kc = new k8s.KubeConfig();

    if (config.kubeconfig) {
      this.kc.loadFromFile(config.kubeconfig);
    } else {
      this.kc.loadFromDefault();
    }

    if (config.context) {
      this.kc.setCurrentContext(config.context);
    }

    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);

    this.logger.info('K8s client initialized', {
      context: this.kc.getCurrentContext(),
      allowedNamespaces: this.config.allowedNamespaces,
      allowedActions: this.config.allowedActions,
      dryRun: this.config.dryRun,
    });
  }

  /**
   * Validate namespace is allowed
   */
  private validateNamespace(namespace: string): void {
    if (!this.config.allowedNamespaces.includes(namespace)) {
      throw new NamespaceNotAllowedError(namespace, {
        allowedNamespaces: this.config.allowedNamespaces,
      });
    }
  }

  /**
   * Validate action is allowed
   */
  private validateAction(action: K8sAction): void {
    if (!this.config.allowedActions.includes(action)) {
      throw new ActionNotAllowedError(action, {
        allowedActions: this.config.allowedActions,
      });
    }
  }

  /**
   * Get deployment information
   */
  async getDeployment(name: string, namespace: string): Promise<DeploymentInfo> {
    this.validateNamespace(namespace);

    const response = await this.appsApi.readNamespacedDeployment(name, namespace);
    const deployment = response.body;

    return this.mapDeploymentInfo(deployment);
  }

  /**
   * List deployments in namespace
   */
  async listDeployments(namespace: string): Promise<DeploymentInfo[]> {
    this.validateNamespace(namespace);

    const response = await this.appsApi.listNamespacedDeployment(namespace);
    return response.body.items.map((d: k8s.V1Deployment) => this.mapDeploymentInfo(d));
  }

  /**
   * Rollback deployment to previous revision
   */
  async rollback(request: RollbackRequest): Promise<RollbackResult> {
    this.validateNamespace(request.namespace);
    this.validateAction(K8S_ACTIONS.ROLLBACK);

    this.logger.info('Rolling back deployment', {
      deployment: request.deployment,
      namespace: request.namespace,
      targetRevision: request.revision,
      dryRun: this.config.dryRun,
    });

    try {
      // Get current deployment info
      const current = await this.getDeployment(request.deployment, request.namespace);
      const targetRevision = request.revision ?? current.revision - 1;

      if (this.config.dryRun) {
        this.logger.info('DRY RUN: Rollback would execute', {
          deployment: request.deployment,
          fromRevision: current.revision,
          toRevision: targetRevision,
        });

        return this.recordAction({
          success: true,
          deployment: request.deployment,
          namespace: request.namespace,
          fromRevision: current.revision,
          toRevision: targetRevision,
          dryRun: true,
        }, K8S_ACTIONS.ROLLBACK);
      }

      // Execute rollback using rollout undo
      // Note: kubernetes/client-node doesn't have direct rollback support
      // We need to use the patch approach to update the revision annotation
      await this.appsApi.patchNamespacedDeployment(
        request.deployment,
        request.namespace,
        {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
                  'chronosops/rollback-to-revision': String(targetRevision),
                  'chronosops/rollback-reason': request.reason ?? 'Automated rollback',
                },
              },
            },
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } }
      );

      return this.recordAction({
        success: true,
        deployment: request.deployment,
        namespace: request.namespace,
        fromRevision: current.revision,
        toRevision: targetRevision,
        dryRun: false,
      }, K8S_ACTIONS.ROLLBACK);
    } catch (error) {
      const err = error as Error;
      this.logger.error('Rollback failed', err);

      return this.recordAction({
        success: false,
        deployment: request.deployment,
        namespace: request.namespace,
        fromRevision: 0,
        toRevision: 0,
        dryRun: this.config.dryRun,
        error: err.message,
      }, K8S_ACTIONS.ROLLBACK);
    }
  }

  /**
   * Restart deployment (rolling restart)
   */
  async restart(request: RestartRequest): Promise<RestartResult> {
    this.validateNamespace(request.namespace);
    this.validateAction(K8S_ACTIONS.RESTART);

    this.logger.info('Restarting deployment', {
      deployment: request.deployment,
      namespace: request.namespace,
      dryRun: this.config.dryRun,
    });

    const restartedAt = new Date();

    try {
      if (this.config.dryRun) {
        this.logger.info('DRY RUN: Restart would execute', {
          deployment: request.deployment,
        });

        return this.recordAction({
          success: true,
          deployment: request.deployment,
          namespace: request.namespace,
          restartedAt,
          dryRun: true,
        }, K8S_ACTIONS.RESTART);
      }

      // Trigger rolling restart by patching the annotation
      await this.appsApi.patchNamespacedDeployment(
        request.deployment,
        request.namespace,
        {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'kubectl.kubernetes.io/restartedAt': restartedAt.toISOString(),
                  'chronosops/restart-reason': request.reason ?? 'Automated restart',
                },
              },
            },
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } }
      );

      return this.recordAction({
        success: true,
        deployment: request.deployment,
        namespace: request.namespace,
        restartedAt,
        dryRun: false,
      }, K8S_ACTIONS.RESTART);
    } catch (error) {
      const err = error as Error;
      this.logger.error('Restart failed', err);

      return this.recordAction({
        success: false,
        deployment: request.deployment,
        namespace: request.namespace,
        restartedAt,
        dryRun: this.config.dryRun,
        error: err.message,
      }, K8S_ACTIONS.RESTART);
    }
  }

  /**
   * Scale deployment replicas
   */
  async scale(request: ScaleRequest): Promise<ScaleResult> {
    this.validateNamespace(request.namespace);
    this.validateAction(K8S_ACTIONS.SCALE);

    this.logger.info('Scaling deployment', {
      deployment: request.deployment,
      namespace: request.namespace,
      targetReplicas: request.replicas,
      dryRun: this.config.dryRun,
    });

    try {
      // Get current replica count
      const current = await this.getDeployment(request.deployment, request.namespace);

      if (this.config.dryRun) {
        this.logger.info('DRY RUN: Scale would execute', {
          deployment: request.deployment,
          fromReplicas: current.replicas,
          toReplicas: request.replicas,
        });

        return this.recordAction({
          success: true,
          deployment: request.deployment,
          namespace: request.namespace,
          fromReplicas: current.replicas,
          toReplicas: request.replicas,
          dryRun: true,
        }, K8S_ACTIONS.SCALE);
      }

      // Execute scale
      await this.appsApi.patchNamespacedDeploymentScale(
        request.deployment,
        request.namespace,
        {
          spec: {
            replicas: request.replicas,
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } }
      );

      return this.recordAction({
        success: true,
        deployment: request.deployment,
        namespace: request.namespace,
        fromReplicas: current.replicas,
        toReplicas: request.replicas,
        dryRun: false,
      }, K8S_ACTIONS.SCALE);
    } catch (error) {
      const err = error as Error;
      this.logger.error('Scale failed', err);

      return this.recordAction({
        success: false,
        deployment: request.deployment,
        namespace: request.namespace,
        fromReplicas: 0,
        toReplicas: request.replicas,
        dryRun: this.config.dryRun,
        error: err.message,
      }, K8S_ACTIONS.SCALE);
    }
  }

  /**
   * Get pods for deployment
   */
  async getDeploymentPods(deployment: string, namespace: string): Promise<PodInfo[]> {
    this.validateNamespace(namespace);

    const response = await this.coreApi.listNamespacedPod(
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=${deployment}`
    );

    return response.body.items.map((pod: k8s.V1Pod) => ({
      name: pod.metadata?.name ?? '',
      namespace: pod.metadata?.namespace ?? '',
      status: (pod.status?.phase as PodInfo['status']) ?? 'Unknown',
      restarts: pod.status?.containerStatuses?.reduce((sum: number, c: k8s.V1ContainerStatus) => sum + c.restartCount, 0) ?? 0,
      age: pod.metadata?.creationTimestamp
        ? Math.floor((Date.now() - new Date(pod.metadata.creationTimestamp).getTime()) / 1000)
        : 0,
      ready: pod.status?.containerStatuses?.every((c: k8s.V1ContainerStatus) => c.ready) ?? false,
      containers: pod.status?.containerStatuses?.map((c: k8s.V1ContainerStatus) => ({
        name: c.name,
        ready: c.ready,
        restarts: c.restartCount,
        status: c.state?.running ? 'Running' : c.state?.waiting?.reason ?? 'Unknown',
        image: c.image,
      })) ?? [],
    }));
  }

  /**
   * Get pod logs for debugging deployment failures
   * Returns the last N lines of logs from the first pod in a deployment
   */
  async getPodLogs(
    deployment: string,
    namespace: string,
    tailLines: number = 50
  ): Promise<{ success: boolean; logs: string; podName?: string; error?: string }> {
    this.validateNamespace(namespace);

    try {
      // Get pods for deployment
      const pods = await this.getDeploymentPods(deployment, namespace);
      
      if (pods.length === 0) {
        return {
          success: false,
          logs: '',
          error: 'No pods found for deployment',
        };
      }

      const pod = pods[0]!;  // Safe: we checked length > 0
      const containerName = pod.containers[0]?.name;

      if (!containerName) {
        return {
          success: false,
          logs: '',
          podName: pod.name,
          error: 'No containers found in pod',
        };
      }

      this.logger.info({
        deployment,
        podName: pod.name,
        containerName,
        tailLines,
      }, 'Fetching pod logs');

      // Fetch logs using the K8s API
      const response = await this.coreApi.readNamespacedPodLog(
        pod.name,
        namespace,
        containerName,
        false, // follow
        undefined, // insecureSkipTLSVerifyBackend
        undefined, // limitBytes
        undefined, // pretty
        false, // previous (get current logs, not previous container)
        undefined, // sinceSeconds
        tailLines, // tailLines
        true // timestamps
      );

      const logs = response.body ?? '';

      this.logger.info({
        deployment,
        podName: pod.name,
        logLength: logs.length,
      }, 'Pod logs retrieved successfully');

      return {
        success: true,
        logs,
        podName: pod.name,
      };
    } catch (error) {
      const err = error as Error;
      
      // Try to get previous container logs if current container crashed
      try {
        const pods = await this.getDeploymentPods(deployment, namespace);
        const firstPod = pods[0];
        if (firstPod) {
          const containerName = firstPod.containers[0]?.name;
          
          if (containerName) {
            const response = await this.coreApi.readNamespacedPodLog(
              firstPod.name,
              namespace,
              containerName,
              false, // follow
              undefined, // insecureSkipTLSVerifyBackend
              undefined, // limitBytes
              undefined, // pretty
              true, // previous - get PREVIOUS container logs (before crash)
              undefined, // sinceSeconds
              tailLines, // tailLines
              true // timestamps
            );
            
            const logs = response.body ?? '';
            if (logs.length > 0) {
              this.logger.info({
                deployment,
                podName: firstPod.name,
                logLength: logs.length,
              }, 'Previous container logs retrieved');
              
              return {
                success: true,
                logs: `[PREVIOUS CONTAINER LOGS]\n${logs}`,
                podName: firstPod.name,
              };
            }
          }
        }
      } catch {
        // Ignore errors when trying to get previous logs
      }

      this.logger.error({
        deployment,
        errorMessage: err.message,
      }, 'Failed to fetch pod logs');

      return {
        success: false,
        logs: '',
        error: err.message,
      };
    }
  }

  /**
   * Get namespaces (filtered by allowedNamespaces)
   */
  async getNamespaces(): Promise<NamespaceInfo[]> {
    const response = await this.coreApi.listNamespace();

    return response.body.items
      .filter((ns: k8s.V1Namespace) => this.config.allowedNamespaces.includes(ns.metadata?.name ?? ''))
      .map((ns: k8s.V1Namespace) => ({
        name: ns.metadata?.name ?? '',
        status: (ns.status?.phase as NamespaceInfo['status']) ?? 'Active',
        createdAt: ns.metadata?.creationTimestamp
          ? new Date(ns.metadata.creationTimestamp)
          : new Date(),
      }));
  }

  /**
   * List ALL namespaces in the cluster (for discovery, no filtering)
   * Excludes system namespaces (kube-*)
   */
  async listAllNamespaces(): Promise<NamespaceInfo[]> {
    const response = await this.coreApi.listNamespace();

    return response.body.items
      .filter((ns: k8s.V1Namespace) => {
        const name = ns.metadata?.name ?? '';
        // Exclude system namespaces
        return !name.startsWith('kube-') && name !== 'kube-system' && name !== 'kube-public' && name !== 'kube-node-lease';
      })
      .map((ns: k8s.V1Namespace) => ({
        name: ns.metadata?.name ?? '',
        status: (ns.status?.phase as NamespaceInfo['status']) ?? 'Active',
        createdAt: ns.metadata?.creationTimestamp
          ? new Date(ns.metadata.creationTimestamp)
          : new Date(),
      }));
  }

  /**
   * List ALL deployments in a namespace (for discovery, no validation)
   */
  async listAllDeployments(namespace: string): Promise<DeploymentInfo[]> {
    const response = await this.appsApi.listNamespacedDeployment(namespace);
    return response.body.items.map((d: k8s.V1Deployment) => this.mapDeploymentInfo(d));
  }

  /**
   * Get action history
   */
  getActionHistory(incidentId?: string): ActionHistoryEntry[] {
    if (incidentId) {
      return this.actionHistory.filter((a) => a.incidentId === incidentId);
    }
    return [...this.actionHistory];
  }

  /**
   * Record action in history
   */
  private recordAction<T extends RollbackResult | RestartResult | ScaleResult>(
    result: T,
    action: K8sAction,
    incidentId?: string
  ): T {
    const entry: ActionHistoryEntry = {
      id: randomUUID(),
      action,
      deployment: result.deployment,
      namespace: result.namespace,
      timestamp: new Date(),
      result,
      incidentId,
    };

    this.actionHistory.push(entry);
    return result;
  }

  /**
   * Map K8s deployment to DeploymentInfo
   */
  private mapDeploymentInfo(deployment: k8s.V1Deployment): DeploymentInfo {
    const revision = Number(deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? 0);
    const image = deployment.spec?.template?.spec?.containers?.[0]?.image ?? '';

    let status: DeploymentInfo['status'] = 'available';
    const conditions = deployment.status?.conditions ?? [];
    const progressingCondition = conditions.find((c) => c.type === 'Progressing');
    const availableCondition = conditions.find((c) => c.type === 'Available');

    if (progressingCondition?.status === 'False') {
      status = 'failed';
    } else if (availableCondition?.status === 'False') {
      status = 'progressing';
    }

    return {
      name: deployment.metadata?.name ?? '',
      namespace: deployment.metadata?.namespace ?? '',
      replicas: deployment.spec?.replicas ?? 0,
      availableReplicas: deployment.status?.availableReplicas ?? 0,
      readyReplicas: deployment.status?.readyReplicas ?? 0,
      revision,
      image,
      createdAt: deployment.metadata?.creationTimestamp
        ? new Date(deployment.metadata.creationTimestamp)
        : new Date(),
      status,
    };
  }

  // ============================================
  // Build Pipeline Methods (Phase 3)
  // ============================================

  /**
   * Apply a YAML manifest to the cluster (kubectl apply equivalent)
   */
  async applyManifest(request: ApplyManifestRequest): Promise<ApplyManifestResult> {
    this.validateNamespace(request.namespace);
    this.validateAction(K8S_ACTIONS.APPLY);

    this.logger.info({
      namespace: request.namespace,
      dryRun: this.config.dryRun,
    }, 'Applying manifest');

    const resources: AppliedResource[] = [];

    try {
      // Parse YAML - handle multi-document YAML
      const documents = yaml.loadAll(request.manifest) as k8s.KubernetesObject[];

      for (const doc of documents) {
        if (!doc || !doc.kind || !doc.metadata?.name) {
          continue;
        }

        const kind = doc.kind;
        const name = doc.metadata.name;
        const namespace = doc.metadata.namespace || request.namespace;

        // Ensure namespace matches
        if (namespace !== request.namespace) {
          this.logger.warn({
            resourceName: name,
            resourceNamespace: namespace,
            requestedNamespace: request.namespace,
          }, 'Skipping resource with mismatched namespace');
          continue;
        }

        if (this.config.dryRun) {
          resources.push({
            kind,
            name,
            namespace,
            action: 'configured', // Dry run assumes success
          });
          continue;
        }

        // Apply the resource
        const action = await this.applyResource(doc, namespace);
        resources.push({
          kind,
          name,
          namespace,
          action,
        });
      }

      this.logger.info({
        resourceCount: resources.length,
        dryRun: this.config.dryRun,
      }, 'Manifest applied successfully');

      return {
        success: true,
        namespace: request.namespace,
        resources,
        dryRun: this.config.dryRun,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ errorMessage: err.message }, 'Manifest apply failed');

      return {
        success: false,
        namespace: request.namespace,
        resources,
        dryRun: this.config.dryRun,
        error: err.message,
      };
    }
  }

  /**
   * Apply a single Kubernetes resource
   */
  private async applyResource(
    resource: k8s.KubernetesObject,
    namespace: string
  ): Promise<'created' | 'configured' | 'unchanged'> {
    const kind = resource.kind;
    const name = resource.metadata?.name ?? '';

    try {
      switch (kind) {
        case 'Deployment':
          return await this.applyDeployment(resource as k8s.V1Deployment, namespace);
        case 'Service':
          return await this.applyService(resource as k8s.V1Service, namespace);
        case 'ConfigMap':
          return await this.applyConfigMap(resource as k8s.V1ConfigMap, namespace);
        case 'Secret':
          return await this.applySecret(resource as k8s.V1Secret, namespace);
        default:
          this.logger.warn({ kind, name }, 'Unsupported resource kind, skipping');
          return 'unchanged';
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error({ kind, name, errorMessage: err.message }, 'Failed to apply resource');
      throw error;
    }
  }

  /**
   * Apply a Deployment resource
   */
  private async applyDeployment(
    deployment: k8s.V1Deployment,
    namespace: string
  ): Promise<'created' | 'configured'> {
    const name = deployment.metadata?.name ?? '';

    try {
      // Try to get existing deployment
      await this.appsApi.readNamespacedDeployment(name, namespace);
      // Update existing
      await this.appsApi.replaceNamespacedDeployment(name, namespace, deployment);
      return 'configured';
    } catch (error) {
      const err = error as k8s.HttpError;
      if (err.statusCode === 404) {
        // Create new
        await this.appsApi.createNamespacedDeployment(namespace, deployment);
        return 'created';
      }
      throw error;
    }
  }

  /**
   * Apply a Service resource
   */
  private async applyService(
    service: k8s.V1Service,
    namespace: string
  ): Promise<'created' | 'configured'> {
    const name = service.metadata?.name ?? '';

    try {
      // Try to get existing service
      const existing = await this.coreApi.readNamespacedService(name, namespace);
      // Preserve clusterIP for updates
      if (existing.body.spec?.clusterIP) {
        service.spec = service.spec || {};
        service.spec.clusterIP = existing.body.spec.clusterIP;
      }
      // Update existing
      await this.coreApi.replaceNamespacedService(name, namespace, service);
      return 'configured';
    } catch (error) {
      const err = error as k8s.HttpError;
      if (err.statusCode === 404) {
        // Create new
        await this.coreApi.createNamespacedService(namespace, service);
        return 'created';
      }
      throw error;
    }
  }

  /**
   * Apply a ConfigMap resource
   */
  private async applyConfigMap(
    configMap: k8s.V1ConfigMap,
    namespace: string
  ): Promise<'created' | 'configured'> {
    const name = configMap.metadata?.name ?? '';

    try {
      // Try to get existing configmap
      await this.coreApi.readNamespacedConfigMap(name, namespace);
      // Update existing
      await this.coreApi.replaceNamespacedConfigMap(name, namespace, configMap);
      return 'configured';
    } catch (error) {
      const err = error as k8s.HttpError;
      if (err.statusCode === 404) {
        // Create new
        await this.coreApi.createNamespacedConfigMap(namespace, configMap);
        return 'created';
      }
      throw error;
    }
  }

  /**
   * Apply a Secret resource
   */
  private async applySecret(
    secret: k8s.V1Secret,
    namespace: string
  ): Promise<'created' | 'configured'> {
    const name = secret.metadata?.name ?? '';

    try {
      // Try to get existing secret
      await this.coreApi.readNamespacedSecret(name, namespace);
      // Update existing
      await this.coreApi.replaceNamespacedSecret(name, namespace, secret);
      return 'configured';
    } catch (error) {
      const err = error as k8s.HttpError;
      if (err.statusCode === 404) {
        // Create new
        await this.coreApi.createNamespacedSecret(namespace, secret);
        return 'created';
      }
      throw error;
    }
  }

  /**
   * Create a new deployment
   * If the deployment already exists, it will be replaced (delete + create)
   */
  async createDeployment(request: CreateDeploymentRequest): Promise<CreateDeploymentResult> {
    this.validateNamespace(request.namespace);
    this.validateAction(K8S_ACTIONS.CREATE);

    this.logger.info({
      deployment: request.name,
      namespace: request.namespace,
      image: request.image,
      replicas: request.replicas ?? 1,
      dryRun: this.config.dryRun,
    }, 'Creating deployment');

    try {
      // Check if deployment already exists and delete it first
      try {
        await this.appsApi.readNamespacedDeployment(request.name, request.namespace);
        // Deployment exists - delete it first
        this.logger.info({
          deployment: request.name,
          namespace: request.namespace,
        }, 'Deployment already exists, deleting before recreating');
        
        if (!this.config.dryRun) {
          await this.appsApi.deleteNamespacedDeployment(request.name, request.namespace);
          // Wait a bit for deletion to propagate
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch {
        // Deployment doesn't exist, which is fine - we'll create it
      }

      const labels = {
        app: request.name,
        'app.kubernetes.io/name': request.name,
        'app.kubernetes.io/managed-by': 'chronosops',
        ...request.labels,
      };

      // Build environment variables, including persistence env vars if configured
      // IMPORTANT: Order matters for Kubernetes variable expansion!
      // Secret refs (like POSTGRES_PASSWORD) must come BEFORE any env vars that reference them
      // via $(VAR_NAME) syntax (like DATABASE_URL).
      const envVars: k8s.V1EnvVar[] = [];

      // 1. First add secret references (so they can be referenced by other env vars)
      if (request.persistence?.enabled && request.persistence.secretRefs) {
        for (const { secretName, key, envName } of request.persistence.secretRefs) {
          envVars.push({
            name: envName,
            valueFrom: {
              secretKeyRef: {
                name: secretName,
                key: key,
              },
            },
          });
        }
      }

      // 2. Then add regular env vars (which may use $(VAR_NAME) references to secrets)
      if (request.env) {
        for (const [name, value] of Object.entries(request.env)) {
          envVars.push({ name, value });
        }
      }
      if (request.persistence?.enabled && request.persistence.envVars) {
        for (const { name, value } of request.persistence.envVars) {
          envVars.push({ name, value });
        }
      }

      // Build volume mounts if persistence is enabled AND pvcName is set (SQLite mode)
      const volumeMounts: k8s.V1VolumeMount[] = [];
      if (request.persistence?.enabled && request.persistence.pvcName && request.persistence.mountPath) {
        volumeMounts.push({
          name: 'data',
          mountPath: request.persistence.mountPath,
        });
      }

      // Build volumes if persistence is enabled AND pvcName is set (SQLite mode)
      const volumes: k8s.V1Volume[] = [];
      if (request.persistence?.enabled && request.persistence.pvcName) {
        volumes.push({
          name: 'data',
          persistentVolumeClaim: {
            claimName: request.persistence.pvcName,
          },
        });
      }

      const deployment: k8s.V1Deployment = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name: request.name,
          namespace: request.namespace,
          labels,
          annotations: {
            'chronosops/created-at': new Date().toISOString(),
            'chronosops/reason': request.reason ?? 'Automated deployment',
            ...(request.persistence?.enabled && { 'chronosops/persistence': 'enabled' }),
          },
        },
        spec: {
          replicas: request.replicas ?? 1,
          selector: {
            matchLabels: { app: request.name },
          },
          template: {
            metadata: {
              labels,
              // Include Prometheus annotations for auto-discovery
              annotations: request.enablePrometheus !== false ? {
                'prometheus.io/scrape': 'true',
                'prometheus.io/port': String(request.port ?? 8080),
                'prometheus.io/path': '/metrics',
                ...request.podAnnotations,
              } : request.podAnnotations,
            },
            spec: {
              containers: [
                {
                  name: request.name,
                  image: request.image,
                  // Use 'Always' by default to ensure K8s pulls updated :latest images after rebuilds
                  imagePullPolicy: this.config.imagePullPolicy ?? 'Always',
                  ports: request.port
                    ? [{ containerPort: request.port }]
                    : undefined,
                  env: envVars.length > 0 ? envVars : undefined,
                  volumeMounts: volumeMounts.length > 0 ? volumeMounts : undefined,
                  // Resource limits for proper container metrics (memory % calculation)
                  resources: {
                    requests: {
                      cpu: request.resources?.cpuRequest ?? '50m',
                      memory: request.resources?.memoryRequest ?? '64Mi',
                    },
                    limits: {
                      cpu: request.resources?.cpuLimit ?? '200m',
                      memory: request.resources?.memoryLimit ?? '256Mi',
                    },
                  },
                },
              ],
              volumes: volumes.length > 0 ? volumes : undefined,
            },
          },
        },
      };

      if (this.config.dryRun) {
        this.logger.info({
          deployment: request.name,
          dryRun: true,
        }, 'DRY RUN: Deployment would be created');

        return {
          success: true,
          deployment: request.name,
          namespace: request.namespace,
          dryRun: true,
        };
      }

      await this.appsApi.createNamespacedDeployment(request.namespace, deployment);

      this.logger.info({
        deployment: request.name,
      }, 'Deployment created successfully');

      return {
        success: true,
        deployment: request.name,
        namespace: request.namespace,
        dryRun: false,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ errorMessage: err.message }, 'Deployment creation failed');

      return {
        success: false,
        deployment: request.name,
        namespace: request.namespace,
        dryRun: this.config.dryRun,
        error: err.message,
      };
    }
  }

  /**
   * Update the container image for an existing deployment
   * Used for rebuilds after applying code evolutions
   */
  async updateDeploymentImage(
    deployment: string,
    namespace: string,
    newImage: string
  ): Promise<{ success: boolean; error?: string }> {
    this.validateNamespace(namespace);
    this.validateAction(K8S_ACTIONS.RESTART); // Using RESTART permission for image updates

    this.logger.info({
      deployment,
      namespace,
      newImage,
      dryRun: this.config.dryRun,
    }, 'Updating deployment image');

    try {
      if (this.config.dryRun) {
        this.logger.info({
          deployment,
          newImage,
          dryRun: true,
        }, 'DRY RUN: Deployment image would be updated');

        return { success: true };
      }

      // Get the current deployment
      const { body: currentDeployment } = await this.appsApi.readNamespacedDeployment(
        deployment,
        namespace
      );

      // Update the container image
      if (currentDeployment.spec?.template?.spec?.containers?.[0]) {
        currentDeployment.spec.template.spec.containers[0].image = newImage;
        
        // Add annotation to track the update
        if (!currentDeployment.metadata) {
          currentDeployment.metadata = {};
        }
        if (!currentDeployment.metadata.annotations) {
          currentDeployment.metadata.annotations = {};
        }
        currentDeployment.metadata.annotations['chronosops/last-updated'] = new Date().toISOString();
        currentDeployment.metadata.annotations['chronosops/image'] = newImage;
        
        // Also update the template annotation to force a rollout
        if (!currentDeployment.spec.template.metadata) {
          currentDeployment.spec.template.metadata = {};
        }
        if (!currentDeployment.spec.template.metadata.annotations) {
          currentDeployment.spec.template.metadata.annotations = {};
        }
        currentDeployment.spec.template.metadata.annotations['chronosops/updated-at'] = new Date().toISOString();
      }

      // Apply the update
      await this.appsApi.replaceNamespacedDeployment(
        deployment,
        namespace,
        currentDeployment
      );

      this.logger.info({
        deployment,
        newImage,
      }, 'Deployment image updated successfully');

      return { success: true };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ 
        deployment, 
        namespace, 
        errorMessage: err.message 
      }, 'Failed to update deployment image');

      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Wait for a deployment rollout to complete
   */
  async waitForRollout(
    deployment: string,
    namespace: string,
    timeoutMs: number = 300000 // 5 minutes default
  ): Promise<WaitForRolloutResult> {
    this.validateNamespace(namespace);

    this.logger.info({
      deployment,
      namespace,
      timeoutMs,
    }, 'Waiting for rollout');

    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds

    try {
      while (Date.now() - startTime < timeoutMs) {
        const status = await this.getRolloutStatus(deployment, namespace);

        if (status.complete) {
          this.logger.info({
            deployment,
            durationMs: Date.now() - startTime,
          }, 'Rollout completed successfully');

          return {
            success: true,
            deployment,
            namespace,
            status,
            durationMs: Date.now() - startTime,
          };
        }

        this.logger.debug({
          deployment,
          readyReplicas: status.readyReplicas,
          desiredReplicas: status.desiredReplicas,
        }, 'Rollout in progress');

        // Wait before next poll
        await this.sleep(pollInterval);
      }

      // Timeout
      const finalStatus = await this.getRolloutStatus(deployment, namespace);

      this.logger.warn({
        deployment,
        timeoutMs,
      }, 'Rollout timed out');

      return {
        success: false,
        deployment,
        namespace,
        status: finalStatus,
        durationMs: Date.now() - startTime,
        error: `Rollout timed out after ${timeoutMs}ms`,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ errorMessage: err.message }, 'Rollout wait failed');

      return {
        success: false,
        deployment,
        namespace,
        status: {
          deployment,
          namespace,
          complete: false,
          updatedReplicas: 0,
          readyReplicas: 0,
          desiredReplicas: 0,
          message: 'Failed to get rollout status',
          reason: err.message,
        },
        durationMs: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  /**
   * Get current rollout status for a deployment
   */
  async getRolloutStatus(deployment: string, namespace: string): Promise<RolloutStatus> {
    const response = await this.appsApi.readNamespacedDeployment(deployment, namespace);
    const dep = response.body;

    const desiredReplicas = dep.spec?.replicas ?? 0;
    const updatedReplicas = dep.status?.updatedReplicas ?? 0;
    const readyReplicas = dep.status?.readyReplicas ?? 0;
    const availableReplicas = dep.status?.availableReplicas ?? 0;

    // Check conditions
    const conditions = dep.status?.conditions ?? [];
    const progressingCondition = conditions.find((c) => c.type === 'Progressing');
    const availableCondition = conditions.find((c) => c.type === 'Available');

    // Rollout is complete when:
    // 1. Updated replicas equals desired replicas
    // 2. Ready replicas equals desired replicas
    // 3. Available replicas equals desired replicas
    const complete =
      updatedReplicas === desiredReplicas &&
      readyReplicas === desiredReplicas &&
      availableReplicas === desiredReplicas;

    let message = 'Rollout in progress';
    let reason: string | undefined;

    if (complete) {
      message = 'Rollout completed successfully';
    } else if (progressingCondition?.status === 'False') {
      message = progressingCondition.message ?? 'Rollout failed';
      reason = progressingCondition.reason ?? undefined;
    } else if (availableCondition?.status === 'False') {
      message = `Waiting for ${desiredReplicas - availableReplicas} replicas to become available`;
    } else {
      message = `${readyReplicas}/${desiredReplicas} replicas ready`;
    }

    return {
      deployment,
      namespace,
      complete,
      updatedReplicas,
      readyReplicas,
      desiredReplicas,
      message,
      reason,
    };
  }

  /**
   * Check the health of a deployment
   */
  async checkDeploymentHealth(
    deployment: string,
    namespace: string
  ): Promise<DeploymentHealthResult> {
    this.validateNamespace(namespace);

    this.logger.info({
      deployment,
      namespace,
    }, 'Checking deployment health');

    try {
      // Get deployment info
      const depInfo = await this.getDeployment(deployment, namespace);

      // Get pods
      const pods = await this.getDeploymentPods(deployment, namespace);

      const issues: HealthIssue[] = [];
      let recentRestarts = 0;
      const restartThreshold = 3; // Warn if more than 3 restarts

      // Analyze pods
      for (const pod of pods) {
        // Check pod status
        if (pod.status === 'Failed') {
          issues.push({
            severity: 'critical',
            message: `Pod ${pod.name} is in Failed state`,
            pod: pod.name,
          });
        } else if (pod.status === 'Pending') {
          issues.push({
            severity: 'warning',
            message: `Pod ${pod.name} is pending`,
            pod: pod.name,
          });
        }

        // Check containers
        for (const container of pod.containers) {
          if (!container.ready) {
            issues.push({
              severity: 'warning',
              message: `Container ${container.name} is not ready`,
              pod: pod.name,
              container: container.name,
            });
          }

          if (container.restarts > restartThreshold) {
            issues.push({
              severity: container.restarts > restartThreshold * 2 ? 'critical' : 'warning',
              message: `Container ${container.name} has ${container.restarts} restarts`,
              pod: pod.name,
              container: container.name,
            });
            recentRestarts += container.restarts;
          }

          if (container.status !== 'Running' && container.status !== 'Completed') {
            issues.push({
              severity: 'warning',
              message: `Container ${container.name} status: ${container.status}`,
              pod: pod.name,
              container: container.name,
            });
          }
        }
      }

      // Check replica counts
      if (depInfo.readyReplicas < depInfo.replicas) {
        issues.push({
          severity: 'critical',
          message: `Only ${depInfo.readyReplicas}/${depInfo.replicas} replicas ready`,
        });
      }

      // Determine overall health
      const hasCritical = issues.some((i) => i.severity === 'critical');
      const healthy = !hasCritical && depInfo.readyReplicas === depInfo.replicas;

      this.logger.info({
        deployment,
        healthy,
        issueCount: issues.length,
        readyPods: depInfo.readyReplicas,
        totalPods: depInfo.replicas,
      }, 'Health check complete');

      return {
        deployment,
        namespace,
        healthy,
        readyPods: depInfo.readyReplicas,
        totalPods: depInfo.replicas,
        recentRestarts,
        issues,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ errorMessage: err.message }, 'Health check failed');

      return {
        deployment,
        namespace,
        healthy: false,
        readyPods: 0,
        totalPods: 0,
        recentRestarts: 0,
        issues: [
          {
            severity: 'critical',
            message: `Health check failed: ${err.message}`,
          },
        ],
      };
    }
  }

  /**
   * Helper: Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the external IP of a Kubernetes node
   * Used for constructing external URLs in GKE
   */
  async getNodeExternalIP(): Promise<string | undefined> {
    try {
      const response = await this.coreApi.listNode();
      const nodes = response.body.items;

      if (nodes.length === 0) {
        return undefined;
      }

      // Find the first node with an ExternalIP
      for (const node of nodes) {
        const addresses = node.status?.addresses ?? [];
        const externalIP = addresses.find((addr) => addr.type === 'ExternalIP');
        if (externalIP?.address) {
          this.logger.debug({ nodeExternalIP: externalIP.address }, 'Found node external IP');
          return externalIP.address;
        }
      }

      // Fallback: try InternalIP if no ExternalIP found
      const firstNode = nodes[0]!;
      const addresses = firstNode.status?.addresses ?? [];
      const internalIP = addresses.find((addr) => addr.type === 'InternalIP');
      if (internalIP?.address) {
        this.logger.debug({ nodeInternalIP: internalIP.address }, 'Using node internal IP as fallback');
        return internalIP.address;
      }

      return undefined;
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, 'Failed to get node external IP');
      return undefined;
    }
  }

  /**
   * Get service information including NodePort URL
   * @param nodeHost - Override the host for NodePort URL (defaults to auto-detection)
   */
  async getServiceInfo(
    name: string,
    namespace: string,
    nodeHost?: string
  ): Promise<ServiceInfo> {
    this.validateNamespace(namespace);

    this.logger.info({
      service: name,
      namespace,
    }, 'Getting service info');

    const response = await this.coreApi.readNamespacedService(name, namespace);
    const service = response.body;

    const type = (service.spec?.type ?? 'ClusterIP') as ServiceInfo['type'];
    const ports: ServicePortInfo[] = (service.spec?.ports ?? []).map((p) => ({
      name: p.name ?? 'http',
      port: p.port,
      targetPort: typeof p.targetPort === 'number' ? p.targetPort : parseInt(p.targetPort ?? '0', 10),
      nodePort: p.nodePort,
      protocol: p.protocol ?? 'TCP',
    }));

    const result: ServiceInfo = {
      name: service.metadata?.name ?? name,
      namespace: service.metadata?.namespace ?? namespace,
      type,
      clusterIP: service.spec?.clusterIP,
      ports,
    };

    // Add internal Kubernetes DNS URL (works from within the cluster)
    // Format: http://<service>.<namespace>.svc.cluster.local:<port>
    const firstPort = ports[0];
    if (firstPort) {
      result.internalUrl = `http://${name}.${namespace}.svc.cluster.local:${firstPort.port}`;
    }

    // Add NodePort URL if available
    if (type === 'NodePort' && firstPort?.nodePort) {
      // Priority for nodeHost:
      // 1. Explicit parameter
      // 2. K8S_EXTERNAL_HOST environment variable
      // 3. Auto-detected node external IP (for GKE)
      // 4. 'localhost' fallback
      let host = nodeHost;

      if (!host) {
        host = process.env.K8S_EXTERNAL_HOST;
      }

      if (!host) {
        // Try to auto-detect in GKE
        const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;
        if (isInCluster) {
          host = await this.getNodeExternalIP();
        }
      }

      if (!host) {
        host = 'localhost';
      }

      result.nodePortUrl = `http://${host}:${firstPort.nodePort}`;

      // Also store the external URL separately for UI "Open Live App" button
      // This ensures users always get the external URL even when running in-cluster
      if (host !== 'localhost') {
        result.externalUrl = `http://${host}:${firstPort.nodePort}`;
      }
    }

    // Add LoadBalancer URL if available
    if (type === 'LoadBalancer') {
      const ingress = service.status?.loadBalancer?.ingress?.[0];
      if (ingress) {
        const host = ingress.hostname ?? ingress.ip;
        if (host && firstPort) {
          result.externalIP = host;
          result.loadBalancerUrl = `http://${host}:${firstPort.port}`;
          // LoadBalancer URL is also external
          result.externalUrl = result.loadBalancerUrl;
        }
      }
    }

    this.logger.info({
      service: name,
      type,
      nodePortUrl: result.nodePortUrl,
      internalUrl: result.internalUrl,
      externalUrl: result.externalUrl,
    }, 'Service info retrieved');

    return result;
  }

  /**
   * Create a NodePort service for a deployment
   */
  async createNodePortService(
    name: string,
    namespace: string,
    port: number,
    targetPort: number
  ): Promise<ServiceInfo> {
    this.validateNamespace(namespace);
    this.validateAction(K8S_ACTIONS.CREATE);

    this.logger.info({
      service: name,
      namespace,
      port,
      targetPort,
      dryRun: this.config.dryRun,
    }, 'Creating NodePort service');

    const service: k8s.V1Service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name,
        namespace,
        labels: {
          app: name,
          'app.kubernetes.io/name': name,
          'app.kubernetes.io/managed-by': 'chronosops',
        },
      },
      spec: {
        type: 'NodePort',
        selector: {
          app: name,
        },
        ports: [
          {
            name: 'http',
            port,
            targetPort,
            protocol: 'TCP',
          },
        ],
      },
    };

    if (this.config.dryRun) {
      this.logger.info({ service: name, dryRun: true }, 'DRY RUN: Service would be created');
      return {
        name,
        namespace,
        type: 'NodePort',
        ports: [{ name: 'http', port, targetPort, protocol: 'TCP' }],
        nodePortUrl: 'http://localhost:30000', // Placeholder for dry run
      };
    }

    try {
      // Try to update existing service first
      await this.coreApi.replaceNamespacedService(name, namespace, service);
      this.logger.info({ service: name }, 'Service updated successfully');
    } catch (error) {
      const err = error as k8s.HttpError;
      if (err.statusCode === 404) {
        // Service doesn't exist, create new one
        try {
          await this.coreApi.createNamespacedService(namespace, service);
          this.logger.info({ service: name }, 'Service created successfully');
        } catch (createError) {
          const createErr = createError as k8s.HttpError;
          this.logger.error({
            service: name,
            namespace,
            statusCode: createErr.statusCode,
            body: createErr.body,
            message: createErr.message,
          }, 'Failed to create service');
          throw new Error(`Failed to create service ${name}: ${createErr.statusCode} - ${JSON.stringify(createErr.body)}`);
        }
      } else {
        this.logger.error({
          service: name,
          namespace,
          statusCode: err.statusCode,
          body: err.body,
          message: err.message,
        }, 'Failed to update service');
        throw new Error(`Failed to update service ${name}: ${err.statusCode} - ${JSON.stringify(err.body)}`);
      }
    }

    // Wait a moment for NodePort assignment
    await this.sleep(1000);

    // Get and return the service info with assigned NodePort
    return this.getServiceInfo(name, namespace);
  }

  // ============================================
  // Persistence Methods (PVC/Volume)
  // ============================================

  /**
   * Create a PersistentVolumeClaim for data persistence
   * Used for SQLite database storage that survives pod restarts
   */
  async createPersistentVolumeClaim(request: CreatePVCRequest): Promise<CreatePVCResult> {
    this.validateNamespace(request.namespace);
    this.validateAction(K8S_ACTIONS.CREATE);

    this.logger.info({
      pvc: request.name,
      namespace: request.namespace,
      storageSize: request.storageSize ?? '1Gi',
      dryRun: this.config.dryRun,
    }, 'Creating PersistentVolumeClaim');

    const pvc: k8s.V1PersistentVolumeClaim = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: request.name,
        namespace: request.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'chronosops',
        },
        annotations: {
          'chronosops/created-at': new Date().toISOString(),
        },
      },
      spec: {
        accessModes: request.accessModes ?? ['ReadWriteOnce'],
        resources: {
          requests: {
            storage: request.storageSize ?? '1Gi',
          },
        },
        ...(request.storageClassName && { storageClassName: request.storageClassName }),
      },
    };

    if (this.config.dryRun) {
      this.logger.info({ pvc: request.name, dryRun: true }, 'DRY RUN: PVC would be created');
      return {
        success: true,
        name: request.name,
        namespace: request.namespace,
        dryRun: true,
      };
    }

    try {
      // Check if PVC already exists
      try {
        await this.coreApi.readNamespacedPersistentVolumeClaim(request.name, request.namespace);
        // PVC already exists - this is fine, just log and return success
        this.logger.info({ pvc: request.name, namespace: request.namespace }, 'PVC already exists, reusing');
        return {
          success: true,
          name: request.name,
          namespace: request.namespace,
          dryRun: false,
        };
      } catch {
        // PVC doesn't exist, create it
      }

      await this.coreApi.createNamespacedPersistentVolumeClaim(request.namespace, pvc);

      this.logger.info({
        pvc: request.name,
        namespace: request.namespace,
      }, 'PVC created successfully');

      return {
        success: true,
        name: request.name,
        namespace: request.namespace,
        dryRun: false,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({ pvc: request.name, errorMessage: err.message }, 'PVC creation failed');

      return {
        success: false,
        name: request.name,
        namespace: request.namespace,
        dryRun: this.config.dryRun,
        error: err.message,
      };
    }
  }

  /**
   * Delete a PersistentVolumeClaim
   * Handles 404 gracefully (resource already deleted)
   */
  async deletePersistentVolumeClaim(
    name: string,
    namespace: string
  ): Promise<{ success: boolean; error?: string }> {
    this.validateNamespace(namespace);

    this.logger.info({
      pvc: name,
      namespace,
      dryRun: this.config.dryRun,
    }, 'Deleting PVC');

    if (this.config.dryRun) {
      this.logger.info({ pvc: name, dryRun: true }, 'DRY RUN: PVC would be deleted');
      return { success: true };
    }

    try {
      await this.coreApi.deleteNamespacedPersistentVolumeClaim(name, namespace);
      this.logger.info({ pvc: name, namespace }, 'PVC deleted successfully');
      return { success: true };
    } catch (error) {
      const err = error as k8s.HttpError;
      // 404 is OK - resource already deleted
      if (err.statusCode === 404) {
        this.logger.info({ pvc: name }, 'PVC already deleted (404)');
        return { success: true };
      }
      this.logger.error({ pvc: name, errorMessage: err.message }, 'Failed to delete PVC');
      return { success: false, error: err.message };
    }
  }

  // ============================================
  // Cleanup Methods (Delete Resources)
  // ============================================

  /**
   * Delete a deployment from the cluster
   * Handles 404 gracefully (resource already deleted)
   */
  async deleteDeployment(
    name: string,
    namespace: string
  ): Promise<{ success: boolean; error?: string }> {
    this.validateNamespace(namespace);

    this.logger.info({
      deployment: name,
      namespace,
      dryRun: this.config.dryRun,
    }, 'Deleting deployment');

    if (this.config.dryRun) {
      this.logger.info({ deployment: name, dryRun: true }, 'DRY RUN: Deployment would be deleted');
      return { success: true };
    }

    try {
      await this.appsApi.deleteNamespacedDeployment(name, namespace);
      this.logger.info({ deployment: name, namespace }, 'Deployment deleted successfully');
      return { success: true };
    } catch (error) {
      const err = error as k8s.HttpError;
      // 404 is OK - resource already deleted
      if (err.statusCode === 404) {
        this.logger.info({ deployment: name }, 'Deployment already deleted (404)');
        return { success: true };
      }
      this.logger.error({ deployment: name, errorMessage: err.message }, 'Failed to delete deployment');
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete a service from the cluster
   * Handles 404 gracefully (resource already deleted)
   */
  async deleteService(
    name: string,
    namespace: string
  ): Promise<{ success: boolean; error?: string }> {
    this.validateNamespace(namespace);

    this.logger.info({
      service: name,
      namespace,
      dryRun: this.config.dryRun,
    }, 'Deleting service');

    if (this.config.dryRun) {
      this.logger.info({ service: name, dryRun: true }, 'DRY RUN: Service would be deleted');
      return { success: true };
    }

    try {
      await this.coreApi.deleteNamespacedService(name, namespace);
      this.logger.info({ service: name, namespace }, 'Service deleted successfully');
      return { success: true };
    } catch (error) {
      const err = error as k8s.HttpError;
      // 404 is OK - resource already deleted
      if (err.statusCode === 404) {
        this.logger.info({ service: name }, 'Service already deleted (404)');
        return { success: true };
      }
      this.logger.error({ service: name, errorMessage: err.message }, 'Failed to delete service');
      return { success: false, error: err.message };
    }
  }
}
