/**
 * Kubernetes client types
 */

export const K8S_ACTIONS = {
  ROLLBACK: 'rollback',
  RESTART: 'restart',
  SCALE: 'scale',
  APPLY: 'apply',
  CREATE: 'create',
  DELETE: 'delete',
} as const;

export type K8sAction = (typeof K8S_ACTIONS)[keyof typeof K8S_ACTIONS];

export interface K8sClientConfig {
  /** Kubernetes context to use (default: current context) */
  context?: string;
  /** Kubeconfig path (default: ~/.kube/config) */
  kubeconfig?: string;
  /** Allowed namespaces for actions */
  allowedNamespaces: string[];
  /** Allowed action types */
  allowedActions: K8sAction[];
  /** Enable dry-run mode (default: true) */
  dryRun?: boolean;
  /** Maximum actions per incident */
  maxActionsPerIncident?: number;
  /** Cooldown between actions in ms */
  actionCooldownMs?: number;
  /** Image pull policy for deployments (default: 'Never' for local Docker Desktop) */
  imagePullPolicy?: 'Always' | 'Never' | 'IfNotPresent';
}

export interface DeploymentInfo {
  name: string;
  namespace: string;
  replicas: number;
  availableReplicas: number;
  readyReplicas: number;
  revision: number;
  image: string;
  createdAt: Date;
  status: 'available' | 'progressing' | 'failed';
}

export interface RollbackRequest {
  deployment: string;
  namespace: string;
  /** Target revision (default: previous) */
  revision?: number;
  /** Reason for rollback */
  reason?: string;
}

export interface RollbackResult {
  success: boolean;
  deployment: string;
  namespace: string;
  fromRevision: number;
  toRevision: number;
  dryRun: boolean;
  error?: string;
}

export interface RestartRequest {
  deployment: string;
  namespace: string;
  /** Reason for restart */
  reason?: string;
}

export interface RestartResult {
  success: boolean;
  deployment: string;
  namespace: string;
  restartedAt: Date;
  dryRun: boolean;
  error?: string;
}

export interface ScaleRequest {
  deployment: string;
  namespace: string;
  /** Target replica count */
  replicas: number;
  /** Reason for scaling */
  reason?: string;
}

export interface ScaleResult {
  success: boolean;
  deployment: string;
  namespace: string;
  fromReplicas: number;
  toReplicas: number;
  dryRun: boolean;
  error?: string;
}

export interface ActionHistoryEntry {
  id: string;
  action: K8sAction;
  deployment: string;
  namespace: string;
  timestamp: Date;
  result: RollbackResult | RestartResult | ScaleResult;
  incidentId?: string;
}

export interface NamespaceInfo {
  name: string;
  status: 'Active' | 'Terminating';
  createdAt: Date;
}

export interface PodInfo {
  name: string;
  namespace: string;
  status: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  restarts: number;
  age: number; // seconds
  ready: boolean;
  containers: ContainerInfo[];
}

export interface ContainerInfo {
  name: string;
  ready: boolean;
  restarts: number;
  status: string;
  image: string;
}

// ============================================
// Build Pipeline Types (Phase 3)
// ============================================

export interface ApplyManifestRequest {
  /** YAML manifest content */
  manifest: string;
  /** Target namespace */
  namespace: string;
  /** Reason for applying */
  reason?: string;
}

export interface ApplyManifestResult {
  success: boolean;
  namespace: string;
  /** Resources that were created/updated */
  resources: AppliedResource[];
  dryRun: boolean;
  error?: string;
}

export interface AppliedResource {
  kind: string;
  name: string;
  namespace: string;
  action: 'created' | 'configured' | 'unchanged';
}

/** Resource requirements for container */
export interface ResourceRequirements {
  /** CPU request (e.g., '50m', '100m') */
  cpuRequest?: string;
  /** CPU limit (e.g., '200m', '500m') */
  cpuLimit?: string;
  /** Memory request (e.g., '64Mi', '128Mi') */
  memoryRequest?: string;
  /** Memory limit (e.g., '256Mi', '512Mi') */
  memoryLimit?: string;
}

export interface CreateDeploymentRequest {
  name: string;
  namespace: string;
  image: string;
  replicas?: number;
  port?: number;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  reason?: string;
  /** Pod template annotations for Prometheus discovery etc. */
  podAnnotations?: Record<string, string>;
  /** Whether to include default Prometheus annotations (default: true) */
  enablePrometheus?: boolean;
  /** Persistence configuration for SQLite/database storage */
  persistence?: PersistenceConfig;
  /** Resource requirements for the container (defaults to 64Mi/256Mi memory, 50m/200m CPU) */
  resources?: ResourceRequirements;
}

export interface CreateDeploymentResult {
  success: boolean;
  deployment: string;
  namespace: string;
  dryRun: boolean;
  error?: string;
}

export interface RolloutStatus {
  deployment: string;
  namespace: string;
  /** Rollout is complete */
  complete: boolean;
  /** Current number of updated replicas */
  updatedReplicas: number;
  /** Current number of ready replicas */
  readyReplicas: number;
  /** Desired number of replicas */
  desiredReplicas: number;
  /** Progress message */
  message: string;
  /** Reason for current state */
  reason?: string;
}

export interface WaitForRolloutResult {
  success: boolean;
  deployment: string;
  namespace: string;
  /** Final rollout status */
  status: RolloutStatus;
  /** Time taken to complete in ms */
  durationMs: number;
  error?: string;
}

export interface DeploymentHealthResult {
  deployment: string;
  namespace: string;
  /** Overall health status */
  healthy: boolean;
  /** Number of ready pods */
  readyPods: number;
  /** Total number of pods */
  totalPods: number;
  /** Number of pods with recent restarts */
  recentRestarts: number;
  /** Health issues found */
  issues: HealthIssue[];
}

export interface HealthIssue {
  severity: 'warning' | 'critical';
  message: string;
  pod?: string;
  container?: string;
}

// ============================================
// Service Types
// ============================================

export interface ServiceInfo {
  name: string;
  namespace: string;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
  clusterIP?: string;
  ports: ServicePortInfo[];
  externalIP?: string;
  /** For NodePort services, the URL to access (e.g., http://localhost:30123) */
  nodePortUrl?: string;
  /** For LoadBalancer services, the external URL */
  loadBalancerUrl?: string;
  /** Internal Kubernetes DNS URL (e.g., http://service.namespace.svc.cluster.local:80) - use this when calling from within the cluster */
  internalUrl?: string;
  /** External URL for users to access (e.g., http://35.232.x.x:30123) - use this for "Open Live App" button */
  externalUrl?: string;
}

export interface ServicePortInfo {
  name: string;
  port: number;
  targetPort: number;
  nodePort?: number;
  protocol: string;
}

// ============================================
// Persistence Types (Volume/PVC)
// ============================================

export interface PersistenceConfig {
  /** Whether persistence is enabled */
  enabled: boolean;
  /** Name of the PVC to use (required for SQLite, not needed for PostgreSQL) */
  pvcName?: string;
  /** Path inside the container to mount the volume (required for SQLite, not needed for PostgreSQL) */
  mountPath?: string;
  /** Storage size (e.g., '1Gi') */
  storageSize?: string;
  /** Storage class name (optional, uses default if not specified) */
  storageClassName?: string;
  /** Additional environment variables for persistence (e.g., DATABASE_PATH, DATABASE_URL) */
  envVars?: Array<{ name: string; value: string }>;
  /** Secret references to inject as environment variables (e.g., POSTGRES_PASSWORD) */
  secretRefs?: Array<{
    /** Name of the Kubernetes secret */
    secretName: string;
    /** Key in the secret to use */
    key: string;
    /** Name of the environment variable to set */
    envName: string;
  }>;
}

export interface CreatePVCRequest {
  name: string;
  namespace: string;
  storageSize?: string;
  storageClassName?: string;
  accessModes?: Array<'ReadWriteOnce' | 'ReadOnlyMany' | 'ReadWriteMany'>;
}

export interface CreatePVCResult {
  success: boolean;
  name: string;
  namespace: string;
  dryRun: boolean;
  error?: string;
}
