/**
 * Manifest Generator
 * Generates Kubernetes deployment manifests for generated applications
 */

import { createChildLogger } from '@chronosops/shared';
import type { GeneratedFile, ArchitectureDesign } from '@chronosops/shared';
import type { ManifestGenerationResult, ManifestGenerationOptions } from './types.js';
import * as yaml from 'yaml';

const DEFAULT_OPTIONS: ManifestGenerationOptions = {
  namespace: 'default',
  replicas: 1,
  resources: {
    cpu: '500m',
    memory: '512Mi',
  },
  healthCheck: {
    path: '/health',
    port: 8080, // Use 8080 to avoid conflict with ChronosOps API on 3000
    initialDelaySeconds: 10,
    periodSeconds: 5,
  },
  // Prometheus monitoring configuration
  prometheus: {
    enabled: true,
    path: '/metrics',
    port: 8080,
  },
};

export class ManifestGenerator {
  private logger = createChildLogger({ component: 'ManifestGenerator' });

  /**
   * Generate Kubernetes manifests for the application
   */
  async generate(
    design: ArchitectureDesign,
    imageName: string,
    options: Partial<ManifestGenerationOptions> = {}
  ): Promise<ManifestGenerationResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const appName = this.sanitizeName(design.overview.split(' ')[0] ?? 'app');

    // V3: Handle persistence configuration
    const persistence = opts.persistence;
    const storageMode = persistence?.storageMode ?? 'memory';

    // Enforce replicas=1 for SQLite (file locking constraint)
    if (storageMode === 'sqlite' && opts.replicas > 1) {
      this.logger.warn({
        requestedReplicas: opts.replicas,
        enforcedReplicas: 1,
        reason: 'SQLite uses file-based storage which does not support multi-replica',
      }, 'Enforcing replicas=1 for SQLite storage mode');
      opts.replicas = 1;
    }

    this.logger.info({
      appName,
      namespace: opts.namespace,
      imageName,
      storageMode,
      replicas: opts.replicas,
    }, 'Generating Kubernetes manifests');

    try {
      const manifests: GeneratedFile[] = [];

      // V3: Generate PVC for SQLite mode
      if (storageMode === 'sqlite' && persistence?.enabled) {
        manifests.push(
          this.generatePersistentVolumeClaim(imageName, opts)
        );
      }

      // Generate Deployment (with persistence support)
      manifests.push(
        this.generateDeployment(design, imageName, opts)
      );

      // Generate Service
      manifests.push(
        this.generateService(design, imageName, opts)
      );

      // Generate ConfigMap if environment variables provided
      if (opts.environment && Object.keys(opts.environment).length > 0) {
        manifests.push(
          this.generateConfigMap(design, imageName, opts)
        );
      }

      // Generate Ingress if host provided
      if (opts.ingressHost) {
        manifests.push(
          this.generateIngress(design, imageName, opts)
        );
      }

      // Generate combined manifest
      manifests.push(
        this.generateCombinedManifest(manifests, design, imageName)
      );

      this.logger.info({
        manifestCount: manifests.length,
        storageMode,
        processingTimeMs: Date.now() - startTime,
      }, 'Manifest generation complete');

      return {
        success: true,
        manifests,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage }, 'Manifest generation failed');

      return {
        success: false,
        error: errorMessage,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate Deployment manifest
   */
  private generateDeployment(
    _design: ArchitectureDesign,
    imageName: string,
    options: ManifestGenerationOptions
  ): GeneratedFile {
    // Derive app name from image name (e.g., "localhost:5000/my-app:latest" -> "my-app")
    const appName = this.extractAppNameFromImage(imageName);

    // V3: Build container configuration based on persistence mode
    const persistence = options.persistence;
    const storageMode = persistence?.storageMode ?? 'memory';
    const mountPath = persistence?.mountPath ?? '/app/data';

    // Build environment variables
    const envVars: Array<{ name: string; value?: string; valueFrom?: unknown }> = [];

    if (storageMode === 'sqlite') {
      envVars.push({
        name: 'DATABASE_PATH',
        value: `${mountPath}/app.db`,
      });
    } else if (storageMode === 'postgres') {
      const pgHost = persistence?.postgresHost ?? 'chronosops-postgres.development.svc.cluster.local';
      const pgPort = persistence?.postgresPort ?? 5432;
      const dbName = persistence?.databaseName ?? appName.replace(/-/g, '_');

      envVars.push({
        name: 'DATABASE_URL',
        value: `postgres://postgres:$(POSTGRES_PASSWORD)@${pgHost}:${pgPort}/${dbName}`,
      });
      envVars.push({
        name: 'POSTGRES_PASSWORD',
        valueFrom: {
          secretKeyRef: {
            name: 'postgres-secret',
            key: 'password',
          },
        },
      });
    }

    // Build volume mounts for SQLite
    const volumeMounts = storageMode === 'sqlite' && persistence?.enabled
      ? [{ name: 'data', mountPath }]
      : [];

    // Build volumes for SQLite
    const volumes = storageMode === 'sqlite' && persistence?.enabled
      ? [{
          name: 'data',
          persistentVolumeClaim: {
            claimName: `${appName}-data`,
          },
        }]
      : [];

    // Build container spec with optional persistence
    // Use 'Always' pull policy to ensure Kubernetes always pulls the latest image
    // This is critical when using :latest tag - otherwise K8s may reuse cached images
    const containerSpec: Record<string, unknown> = {
      name: appName,
      image: imageName,
      imagePullPolicy: 'Always',
      ports: [
        {
          containerPort: options.healthCheck.port,
          protocol: 'TCP',
        },
      ],
      resources: {
        requests: {
          cpu: options.resources.cpu,
          memory: options.resources.memory,
        },
        limits: {
          cpu: options.resources.cpu,
          memory: options.resources.memory,
        },
      },
      livenessProbe: {
        httpGet: {
          path: options.healthCheck.path,
          port: options.healthCheck.port,
        },
        initialDelaySeconds: options.healthCheck.initialDelaySeconds,
        periodSeconds: options.healthCheck.periodSeconds,
      },
      readinessProbe: {
        httpGet: {
          path: options.healthCheck.path,
          port: options.healthCheck.port,
        },
        initialDelaySeconds: 5,
        periodSeconds: 3,
      },
    };

    // Add environment variables
    if (envVars.length > 0) {
      containerSpec.env = envVars;
    }

    // Add envFrom for ConfigMap if environment variables provided
    if (options.environment && Object.keys(options.environment).length > 0) {
      containerSpec.envFrom = [
        {
          configMapRef: {
            name: `${appName}-config`,
          },
        },
      ];
    }

    // Add volume mounts for SQLite
    if (volumeMounts.length > 0) {
      containerSpec.volumeMounts = volumeMounts;
    }

    // Build pod spec
    const podSpec: Record<string, unknown> = {
      containers: [containerSpec],
    };

    // Add volumes for SQLite
    if (volumes.length > 0) {
      podSpec.volumes = volumes;
    }

    const deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: appName,
        namespace: options.namespace,
        labels: {
          app: appName,
          'app.kubernetes.io/name': appName,
          'app.kubernetes.io/managed-by': 'chronosops',
          ...(storageMode !== 'memory' && { 'chronosops.io/storage-mode': storageMode }),
        },
      },
      spec: {
        replicas: options.replicas,
        selector: {
          matchLabels: {
            app: appName,
          },
        },
        template: {
          metadata: {
            labels: {
              app: appName,
              'app.kubernetes.io/name': appName,
              'app.kubernetes.io/managed-by': 'chronosops',
            },
            // Prometheus annotations for auto-discovery by prometheus.io/scrape
            annotations: {
              'prometheus.io/scrape': String(options.prometheus?.enabled ?? true),
              'prometheus.io/port': String(options.prometheus?.port ?? options.healthCheck.port),
              'prometheus.io/path': options.prometheus?.path ?? '/metrics',
            },
          },
          spec: podSpec,
        },
      },
    };

    return {
      path: `k8s/deployment.yaml`,
      language: 'yaml',
      purpose: 'Kubernetes Deployment manifest',
      isNew: true,
      content: yaml.stringify(deployment),
    };
  }

  /**
   * Generate Service manifest
   */
  private generateService(
    _design: ArchitectureDesign,
    imageName: string,
    options: ManifestGenerationOptions
  ): GeneratedFile {
    const appName = this.extractAppNameFromImage(imageName);

    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: appName,
        namespace: options.namespace,
        labels: {
          app: appName,
          'app.kubernetes.io/name': appName,
          'app.kubernetes.io/managed-by': 'chronosops',
        },
        // Prometheus annotations for service-level discovery
        annotations: {
          'prometheus.io/scrape': String(options.prometheus?.enabled ?? true),
          'prometheus.io/port': String(options.prometheus?.port ?? options.healthCheck.port),
          'prometheus.io/path': options.prometheus?.path ?? '/metrics',
        },
      },
      spec: {
        type: 'ClusterIP',
        selector: {
          app: appName,
        },
        ports: [
          {
            name: 'http',
            port: 80,
            targetPort: options.healthCheck.port,
            protocol: 'TCP',
          },
        ],
      },
    };

    return {
      path: `k8s/service.yaml`,
      language: 'yaml',
      purpose: 'Kubernetes Service manifest',
      isNew: true,
      content: yaml.stringify(service),
    };
  }

  /**
   * Generate ConfigMap manifest
   */
  private generateConfigMap(
    _design: ArchitectureDesign,
    imageName: string,
    options: ManifestGenerationOptions
  ): GeneratedFile {
    const appName = this.extractAppNameFromImage(imageName);

    const configMap = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: `${appName}-config`,
        namespace: options.namespace,
        labels: {
          app: appName,
          'app.kubernetes.io/name': appName,
          'app.kubernetes.io/managed-by': 'chronosops',
        },
      },
      data: options.environment ?? {},
    };

    return {
      path: `k8s/configmap.yaml`,
      language: 'yaml',
      purpose: 'Kubernetes ConfigMap manifest',
      isNew: true,
      content: yaml.stringify(configMap),
    };
  }

  /**
   * Generate Ingress manifest
   */
  private generateIngress(
    _design: ArchitectureDesign,
    imageName: string,
    options: ManifestGenerationOptions
  ): GeneratedFile {
    const appName = this.extractAppNameFromImage(imageName);

    const ingress = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: appName,
        namespace: options.namespace,
        labels: {
          app: appName,
          'app.kubernetes.io/name': appName,
          'app.kubernetes.io/managed-by': 'chronosops',
        },
        annotations: {
          'kubernetes.io/ingress.class': 'nginx',
        },
      },
      spec: {
        rules: [
          {
            host: options.ingressHost,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: appName,
                      port: {
                        number: 80,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    };

    return {
      path: `k8s/ingress.yaml`,
      language: 'yaml',
      purpose: 'Kubernetes Ingress manifest',
      isNew: true,
      content: yaml.stringify(ingress),
    };
  }

  /**
   * Generate combined manifest (all-in-one)
   */
  private generateCombinedManifest(
    manifests: GeneratedFile[],
    _design: ArchitectureDesign,
    imageName: string
  ): GeneratedFile {
    const appName = this.extractAppNameFromImage(imageName);
    const yamlDocs = manifests
      .filter((m) => m.language === 'yaml')
      .map((m) => m.content)
      .join('---\n');

    return {
      path: `k8s/${appName}.yaml`,
      language: 'yaml',
      purpose: 'Combined Kubernetes manifest',
      isNew: true,
      content: `# Generated by ChronosOps for ${appName}
# Apply with: kubectl apply -f ${appName}.yaml

${yamlDocs}`,
    };
  }

  /**
   * Validate manifest structure
   */
  async validateManifest(content: string): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      // Parse YAML
      const docs = yaml.parseAllDocuments(content);

      for (const doc of docs) {
        if (doc.errors.length > 0) {
          errors.push(...doc.errors.map((e) => e.message));
        }

        const obj = doc.toJS() as {
          apiVersion?: string;
          kind?: string;
          metadata?: {
            name?: string;
            namespace?: string;
          };
          spec?: unknown;
        };

        // Basic K8s manifest validation
        if (!obj.apiVersion) {
          errors.push('Missing apiVersion');
        }
        if (!obj.kind) {
          errors.push('Missing kind');
        }
        if (!obj.metadata?.name) {
          errors.push('Missing metadata.name');
        }
      }
    } catch (error) {
      errors.push(`YAML parse error: ${(error as Error).message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate namespace manifest
   */
  generateNamespace(namespace: string): GeneratedFile {
    const ns = {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'chronosops',
        },
      },
    };

    return {
      path: `k8s/namespace.yaml`,
      language: 'yaml',
      purpose: 'Kubernetes Namespace manifest',
      isNew: true,
      content: yaml.stringify(ns),
    };
  }

  /**
   * Generate PersistentVolumeClaim manifest for SQLite storage
   */
  private generatePersistentVolumeClaim(
    imageName: string,
    options: ManifestGenerationOptions
  ): GeneratedFile {
    const appName = this.extractAppNameFromImage(imageName);
    const persistence = options.persistence;
    const storageSize = persistence?.storageSize ?? '1Gi';
    const storageClassName = persistence?.storageClassName;

    const pvc: Record<string, unknown> = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: `${appName}-data`,
        namespace: options.namespace,
        labels: {
          app: appName,
          'app.kubernetes.io/name': appName,
          'app.kubernetes.io/managed-by': 'chronosops',
          'chronosops.io/storage-mode': 'sqlite',
        },
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: {
          requests: {
            storage: storageSize,
          },
        },
      },
    };

    // Add storage class if specified
    if (storageClassName) {
      (pvc.spec as Record<string, unknown>).storageClassName = storageClassName;
    }

    return {
      path: `k8s/pvc.yaml`,
      language: 'yaml',
      purpose: 'Kubernetes PersistentVolumeClaim for SQLite storage',
      isNew: true,
      content: yaml.stringify(pvc),
    };
  }

  /**
   * Sanitize name for K8s (lowercase, alphanumeric, hyphens only)
   */
  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 63); // K8s name limit
  }

  /**
   * Extract app name from Docker image name
   * e.g., "localhost:5000/my-app:latest" -> "my-app"
   * e.g., "my-app:v1.0" -> "my-app"
   */
  private extractAppNameFromImage(imageName: string): string {
    // Remove registry prefix (e.g., "localhost:5000/")
    let name = imageName.includes('/')
      ? imageName.split('/').pop()!
      : imageName;

    // Remove tag (e.g., ":latest")
    name = name.includes(':')
      ? name.split(':')[0]!
      : name;

    // Ensure it's valid K8s name
    return this.sanitizeName(name);
  }
}
