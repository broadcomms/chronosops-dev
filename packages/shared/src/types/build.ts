/**
 * Build and deployment types for self-regenerating app ecosystem
 */

/**
 * Build stage in the pipeline
 */
export type BuildStage =
  | 'pending'
  | 'installing'
  | 'linting'
  | 'testing'
  | 'building'
  | 'pushing'
  | 'complete'
  | 'failed';

/**
 * Deployment status
 */
export type DeploymentStatus = 'pending' | 'running' | 'degraded' | 'failed' | 'succeeded' | 'rolled_back';

/**
 * Result of a build operation
 */
export interface BuildResult {
  /** Whether build succeeded */
  success: boolean;

  /** Unique build identifier */
  buildId: string;

  /** Docker image tag if built */
  imageTag: string;

  /** Build logs */
  logs: string[];

  /** Test results if tests were run */
  testResults?: TestResults;

  /** Duration in milliseconds */
  duration: number;

  /** Any errors encountered */
  errors?: string[];

  /** Stage where build failed (if applicable) */
  failedStage?: BuildStage;

  /** Timestamp */
  completedAt: string;
}

/**
 * Test execution results
 */
export interface TestResults {
  /** Whether all tests passed */
  success: boolean;

  /** Total number of tests */
  total: number;

  /** Number of passed tests */
  passed: number;

  /** Number of failed tests */
  failed: number;

  /** Number of skipped tests */
  skipped: number;

  /** Code coverage percentage */
  coverage?: number;

  /** Individual test results */
  tests: TestResult[];

  /** Duration in milliseconds */
  duration: number;

  /** Test framework used */
  framework: 'vitest' | 'jest';
}

/**
 * Individual test result
 */
export interface TestResult {
  /** Test name */
  name: string;

  /** Test suite name */
  suite: string;

  /** Test status */
  status: 'passed' | 'failed' | 'skipped';

  /** Duration in milliseconds */
  duration: number;

  /** Error message if failed */
  error?: string;

  /** Stack trace if failed */
  stackTrace?: string;
}

/**
 * Deployment information
 */
export interface DeploymentInfo {
  /** Unique deployment identifier */
  id: string;

  /** Kubernetes namespace */
  namespace: string;

  /** Deployment name */
  deploymentName: string;

  /** Service name */
  serviceName?: string;

  /** Accessible URL for the deployed service (e.g., http://localhost:30123) */
  serviceUrl?: string;

  /** Internal K8s URL for in-cluster verification (e.g., http://service.namespace.svc.cluster.local:port) */
  internalUrl?: string;

  /** Service port (NodePort or LoadBalancer port) */
  servicePort?: number;

  /** Image deployed */
  image: string;

  /** Number of replicas */
  replicas: number;

  /** Available replicas */
  availableReplicas: number;

  /** Deployment status */
  status: DeploymentStatus;

  /** Health check endpoint */
  healthEndpoint?: string;

  /** Exposed ports */
  ports: number[];

  /** Resource limits */
  resources: {
    cpu: string;
    memory: string;
  };

  /** Deployment timestamp */
  deployedAt: string;

  /** Rollout duration in milliseconds */
  rolloutDuration?: number;
}

/**
 * Verification result after deployment
 */
export interface VerificationResult {
  /** Whether verification passed */
  success: boolean;

  /** Verification checks performed */
  checks: VerificationCheck[];

  /** Overall confidence */
  confidence: number;

  /** Duration in milliseconds */
  duration: number;

  /** Timestamp */
  verifiedAt: string;

  /** Reason for failure if applicable */
  failureReason?: string;
}

/**
 * Individual verification check
 */
export interface VerificationCheck {
  /** Check type */
  type: 'health_check' | 'metric_recovery' | 'error_rate' | 'pod_status' | 'endpoint_test' | 'api_endpoint' | 'frontend_api_proxy' | 'frontend_static';

  /** Check name */
  name: string;

  /** Whether check passed */
  passed: boolean;

  /** Confidence in result */
  confidence: number;

  /** Details */
  details?: Record<string, unknown>;

  /** Duration in milliseconds */
  duration: number;
}

/**
 * Build context during pipeline execution
 */
export interface BuildContext {
  /** Build identifier */
  buildId: string;

  /** Path to project */
  projectPath: string;

  /** Target image tag */
  imageTag: string;

  /** Current stage */
  stage: BuildStage;

  /** Accumulated logs */
  logs: string[];

  /** Test results */
  testResults?: TestResults;

  /** Start time */
  startedAt: Date;

  /** Completion time */
  completedAt?: Date;

  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Rollout result
 */
export interface RolloutResult {
  /** Whether rollout succeeded */
  success: boolean;

  /** Deployment name */
  deployment: string;

  /** Namespace */
  namespace: string;

  /** Number of replicas */
  replicas?: number;

  /** Error message if failed */
  error?: string;

  /** Duration in milliseconds */
  duration: number;
}

/**
 * Manifest apply result
 */
export interface ManifestApplyResult {
  /** Resource kind */
  kind: string;

  /** Resource name */
  name: string;

  /** Namespace */
  namespace: string;

  /** Action taken */
  action: 'created' | 'patched' | 'unchanged' | 'dry-run' | 'skipped' | 'failed';

  /** Success status */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Overall apply result
 */
export interface ApplyResult {
  /** Whether all applies succeeded */
  success: boolean;

  /** Individual results */
  results: ManifestApplyResult[];

  /** Whether this was a dry run */
  dryRun: boolean;
}

/**
 * K8s manifest specification for generation
 */
export interface K8sManifestSpec {
  /** Application name */
  appName: string;

  /** Target namespace */
  namespace: string;

  /** Docker image */
  image: string;

  /** Container port */
  port: number;

  /** Number of replicas */
  replicas?: number;

  /** Resource specifications */
  resources?: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };

  /** Environment variables */
  envVars?: Record<string, string>;

  /** Health check path */
  healthCheckPath?: string;

  /** Service type */
  serviceType?: 'ClusterIP' | 'NodePort' | 'LoadBalancer';

  /** Labels */
  labels?: Record<string, string>;

  /** Annotations */
  annotations?: Record<string, string>;
}
