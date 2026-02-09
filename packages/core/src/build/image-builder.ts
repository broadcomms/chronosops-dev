/**
 * Image Builder
 * Builds Docker images from generated code
 * Supports both local Docker builds and Kaniko builds for Kubernetes
 */

import { createChildLogger } from '@chronosops/shared';
import { spawn } from 'node:child_process';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as k8s from '@kubernetes/client-node';
import type {
  ImageBuilderConfig,
  ImageBuildResult,
  KanikoConfig,
} from './types.js';
import { DEFAULT_IMAGE_BUILDER_CONFIG } from './types.js';

// Default Kaniko configuration
const DEFAULT_KANIKO_CONFIG: KanikoConfig = {
  namespace: 'development',
  executorImage: 'gcr.io/kaniko-project/executor:v1.21.0',
  jobTimeoutSeconds: 600,
  cache: true,
};

export class ImageBuilder {
  private config: ImageBuilderConfig;
  private logger = createChildLogger({ component: 'ImageBuilder' });
  private batchApi?: k8s.BatchV1Api;
  private coreApi?: k8s.CoreV1Api;

  constructor(config: Partial<ImageBuilderConfig> = {}) {
    this.config = { ...DEFAULT_IMAGE_BUILDER_CONFIG, ...config };
    
    // Initialize K8s client if using Kaniko
    if (this.config.buildMode === 'kaniko') {
      this.initK8sClient();
    }
  }

  /**
   * Initialize Kubernetes client for Kaniko builds
   */
  private initK8sClient(): void {
    try {
      const kc = new k8s.KubeConfig();
      kc.loadFromDefault();
      this.batchApi = kc.makeApiClient(k8s.BatchV1Api);
      this.coreApi = kc.makeApiClient(k8s.CoreV1Api);
      this.logger.info('K8s client initialized for Kaniko builds');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to initialize K8s client - Kaniko builds will fail');
    }
  }

  /**
   * Build a Docker image from the given directory
   * Uses Kaniko when buildMode is 'kaniko', otherwise uses local Docker
   */
  async build(
    workDir: string,
    imageName: string,
    tag: string = 'latest'
  ): Promise<ImageBuildResult> {
    // Use Kaniko for in-cluster builds
    if (this.config.buildMode === 'kaniko') {
      return this.buildWithKaniko(workDir, imageName, tag);
    }
    
    // Default to Docker build
    return this.buildWithDocker(workDir, imageName, tag);
  }

  /**
   * Build using local Docker daemon
   */
  private async buildWithDocker(
    workDir: string,
    imageName: string,
    tag: string = 'latest'
  ): Promise<ImageBuildResult> {
    const startTime = Date.now();
    const fullImageName = this.config.registry
      ? `${this.config.registry}/${imageName}:${tag}`
      : `${imageName}:${tag}`;

    this.logger.info({
      workDir,
      imageName: fullImageName,
      buildMode: 'docker',
    }, 'Building Docker image');

    const buildLogs: string[] = [];

    try {
      // Ensure Dockerfile exists
      await this.ensureDockerfile(workDir);

      // Build the image
      const buildResult = await this.runDockerBuild(
        workDir,
        fullImageName,
        (log) => buildLogs.push(log)
      );

      if (!buildResult.success) {
        this.logger.error({
          error: buildResult.error,
        }, 'Docker build failed');

        return {
          success: false,
          error: buildResult.error,
          buildLogs,
          durationMs: Date.now() - startTime,
        };
      }

      this.logger.info({
        imageName: fullImageName,
        imageId: buildResult.imageId,
      }, 'Docker image built successfully');

      return {
        success: true,
        imageName,
        imageTag: tag,
        imageId: buildResult.imageId,
        buildLogs,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage }, 'Image build failed');

      return {
        success: false,
        error: errorMessage,
        buildLogs,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Build using Kaniko in Kubernetes
   * Creates a Job that builds and pushes the image
   */
  private async buildWithKaniko(
    workDir: string,
    imageName: string,
    tag: string = 'latest'
  ): Promise<ImageBuildResult> {
    const startTime = Date.now();
    const kanikoConfig = { ...DEFAULT_KANIKO_CONFIG, ...this.config.kaniko };
    const fullImageName = this.config.registry
      ? `${this.config.registry}/${imageName}:${tag}`
      : `${imageName}:${tag}`;

    this.logger.info({
      workDir,
      imageName: fullImageName,
      buildMode: 'kaniko',
      namespace: kanikoConfig.namespace,
    }, 'Building Docker image with Kaniko');

    const buildLogs: string[] = [];

    if (!this.batchApi || !this.coreApi) {
      return {
        success: false,
        error: 'Kubernetes client not initialized for Kaniko builds',
        buildLogs,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Ensure Dockerfile exists
      await this.ensureDockerfile(workDir);

      // Generate unique job name
      const jobName = `kaniko-${imageName.replace(/[^a-z0-9]/gi, '-').substring(0, 40)}-${Date.now()}`;
      
      // Create ConfigMap with build context (all files from workDir)
      const contextConfigMapName = `${jobName}-context`;
      await this.createBuildContextConfigMap(
        workDir,
        contextConfigMapName,
        kanikoConfig.namespace
      );
      buildLogs.push(`Created ConfigMap: ${contextConfigMapName}`);

      // Create Kaniko Job
      const job = this.createKanikoJob(
        jobName,
        fullImageName,
        contextConfigMapName,
        kanikoConfig
      );

      this.logger.info({ jobName, namespace: kanikoConfig.namespace }, 'Creating Kaniko job');
      await this.batchApi.createNamespacedJob(kanikoConfig.namespace, job);
      buildLogs.push(`Created Job: ${jobName}`);

      // Wait for job completion
      const jobResult = await this.waitForKanikoJob(
        jobName,
        kanikoConfig.namespace,
        kanikoConfig.jobTimeoutSeconds || 600,
        buildLogs
      );

      // Cleanup ConfigMap
      try {
        await this.coreApi.deleteNamespacedConfigMap(contextConfigMapName, kanikoConfig.namespace);
        buildLogs.push(`Deleted ConfigMap: ${contextConfigMapName}`);
      } catch (cleanupError) {
        this.logger.warn({ error: cleanupError }, 'Failed to cleanup ConfigMap');
      }

      // Cleanup Job
      try {
        await this.batchApi.deleteNamespacedJob(jobName, kanikoConfig.namespace, undefined, undefined, undefined, undefined, 'Background');
        buildLogs.push(`Deleted Job: ${jobName}`);
      } catch (cleanupError) {
        this.logger.warn({ error: cleanupError }, 'Failed to cleanup Job');
      }

      if (!jobResult.success) {
        this.logger.error({ error: jobResult.error }, 'Kaniko build failed');
        return {
          success: false,
          error: jobResult.error,
          buildLogs,
          durationMs: Date.now() - startTime,
        };
      }

      this.logger.info({
        imageName: fullImageName,
        jobName,
      }, 'Kaniko build completed successfully');

      return {
        success: true,
        imageName,
        imageTag: tag,
        buildLogs,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage }, 'Kaniko build failed');

      return {
        success: false,
        error: errorMessage,
        buildLogs,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Create ConfigMap with build context files
   */
  private async createBuildContextConfigMap(
    workDir: string,
    configMapName: string,
    namespace: string
  ): Promise<void> {
    const files = await this.collectBuildContextFiles(workDir);
    
    // ConfigMaps have a 1MB limit, so we need to be careful
    // Use 'data' field with base64 content - we decode manually in init container
    const configMapData: Record<string, string> = {};
    
    for (const [relativePath, content] of Object.entries(files)) {
      // Convert path to safe key for ConfigMap (no slashes or dots)
      const safeKey = relativePath.replace(/\//g, '__').replace(/\./g, '_DOT_');
      // Store as base64-encoded string in 'data' field
      configMapData[safeKey] = Buffer.from(content).toString('base64');
    }

    const configMap: k8s.V1ConfigMap = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: configMapName,
        namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'chronosops',
          'chronosops/type': 'kaniko-context',
        },
      },
      // Use 'data' not 'binaryData' - we store base64 strings and decode in init container
      data: configMapData,
    };

    await this.coreApi!.createNamespacedConfigMap(namespace, configMap);
    this.logger.debug({ configMapName, fileCount: Object.keys(files).length }, 'Created build context ConfigMap');
  }

  /**
   * Collect all files from workDir for build context
   */
  private async collectBuildContextFiles(dir: string, basePath: string = ''): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Skip node_modules and other large directories
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
          continue;
        }
        const subFiles = await this.collectBuildContextFiles(fullPath, relativePath);
        Object.assign(files, subFiles);
      } else if (entry.isFile()) {
        const content = await readFile(fullPath, 'utf-8');
        files[relativePath] = content;
      }
    }

    return files;
  }

  /**
   * Create Kaniko Job specification
   */
  private createKanikoJob(
    jobName: string,
    imageName: string,
    contextConfigMapName: string,
    kanikoConfig: KanikoConfig
  ): k8s.V1Job {
    const args = [
      '--dockerfile=/workspace/Dockerfile',
      '--context=dir:///workspace',
      `--destination=${imageName}`,
      '--push-retry=3',
    ];

    // Add cache settings
    if (kanikoConfig.cache) {
      args.push('--cache=true');
      if (kanikoConfig.cacheRepo) {
        args.push(`--cache-repo=${kanikoConfig.cacheRepo}`);
      }
    }

    // Add build args
    if (this.config.buildArgs) {
      for (const [key, value] of Object.entries(this.config.buildArgs)) {
        args.push(`--build-arg=${key}=${value}`);
      }
    }

    // Add labels
    if (this.config.labels) {
      for (const [key, value] of Object.entries(this.config.labels)) {
        args.push(`--label=${key}=${value}`);
      }
    }

    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: kanikoConfig.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'chronosops',
          'chronosops/type': 'kaniko-build',
        },
      },
      spec: {
        ttlSecondsAfterFinished: 300, // Clean up after 5 minutes
        backoffLimit: 0, // Don't retry
        activeDeadlineSeconds: kanikoConfig.jobTimeoutSeconds,
        template: {
          metadata: {
            labels: {
              'app.kubernetes.io/managed-by': 'chronosops',
              'chronosops/type': 'kaniko-build',
            },
          },
          spec: {
            serviceAccountName: kanikoConfig.serviceAccount || 'chronosops',
            restartPolicy: 'Never',
            initContainers: [
              {
                name: 'prepare-context',
                image: 'busybox:1.36',
                command: ['sh', '-c'],
                args: [
                  // Decode base64 files and restore directory structure
                  `cd /context-data && for f in *; do
                    if [ -f "$f" ]; then
                      # Convert safe key back to path
                      realpath=$(echo "$f" | sed 's/__/\\//g' | sed 's/_DOT_/./g')
                      dir=$(dirname "$realpath")
                      mkdir -p "/workspace/$dir"
                      base64 -d "$f" > "/workspace/$realpath"
                    fi
                  done && ls -la /workspace`,
                ],
                volumeMounts: [
                  {
                    name: 'context-data',
                    mountPath: '/context-data',
                  },
                  {
                    name: 'workspace',
                    mountPath: '/workspace',
                  },
                ],
              },
            ],
            containers: [
              {
                name: 'kaniko',
                image: kanikoConfig.executorImage || 'gcr.io/kaniko-project/executor:v1.21.0',
                args,
                volumeMounts: [
                  {
                    name: 'workspace',
                    mountPath: '/workspace',
                  },
                ],
                resources: {
                  requests: {
                    cpu: '500m',
                    memory: '1Gi',
                  },
                  limits: {
                    cpu: '2000m',
                    memory: '4Gi',
                  },
                },
              },
            ],
            volumes: [
              {
                name: 'context-data',
                configMap: {
                  name: contextConfigMapName,
                },
              },
              {
                name: 'workspace',
                emptyDir: {},
              },
            ],
          },
        },
      },
    };
  }

  /**
   * Wait for Kaniko Job to complete
   */
  private async waitForKanikoJob(
    jobName: string,
    namespace: string,
    timeoutSeconds: number,
    buildLogs: string[]
  ): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await this.batchApi!.readNamespacedJob(jobName, namespace);
        const job = response.body;

        if (job.status?.succeeded && job.status.succeeded > 0) {
          buildLogs.push('Kaniko job completed successfully');
          return { success: true };
        }

        if (job.status?.failed && job.status.failed > 0) {
          // Get pod logs for error details
          const errorDetails = await this.getKanikoJobLogs(jobName, namespace);
          buildLogs.push(`Kaniko job failed: ${errorDetails}`);
          return { success: false, error: errorDetails };
        }

        // Job still running
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn({ error: errorMessage, jobName }, 'Error checking job status');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    return { success: false, error: `Kaniko job timed out after ${timeoutSeconds}s` };
  }

  /**
   * Get logs from Kaniko Job pod
   */
  private async getKanikoJobLogs(jobName: string, namespace: string): Promise<string> {
    try {
      const podsResponse = await this.coreApi!.listNamespacedPod(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `job-name=${jobName}`
      );

      if (podsResponse.body.items.length === 0) {
        return 'No pods found for job';
      }

      const pod = podsResponse.body.items[0];
      const podName = pod?.metadata?.name;
      if (!podName) {
        return 'Pod name not found';
      }

      const logsResponse = await this.coreApi!.readNamespacedPodLog(
        podName,
        namespace,
        'kaniko',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        100 // Last 100 lines
      );

      return logsResponse.body || 'No logs available';
    } catch (error) {
      return error instanceof Error ? error.message : 'Failed to get logs';
    }
  }

  /**
   * Ensure Dockerfile exists in the work directory
   * Detects frontend vs backend apps and generates appropriate Dockerfile
   */
  private async ensureDockerfile(workDir: string): Promise<void> {
    const dockerfilePath = join(workDir, 'Dockerfile');

    // Check if this is a frontend app (has index.html in root)
    const indexHtmlPath = join(workDir, 'index.html');
    let isFrontendApp = false;
    try {
      const { stat } = await import('node:fs/promises');
      await stat(indexHtmlPath);
      isFrontendApp = true;
    } catch {
      // index.html doesn't exist, not a frontend app
    }

    let dockerfile: string;

    if (isFrontendApp) {
      // Frontend Dockerfile: Build with Vite, serve with nginx
      dockerfile = `
FROM ${this.config.baseImage} AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source files including index.html
COPY tsconfig*.json ./
COPY index.html ./
COPY src ./src
COPY vite.config.ts ./
COPY postcss.config.js ./
COPY tailwind.config.js ./

# Build the frontend
RUN npm run build

# Production image: serve static files with nginx
FROM nginx:alpine AS runner

# Copy built files to nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config with API proxying (generated by frontend-code-generator)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
`.trim();
    } else {
      // Backend Dockerfile: Build with TypeScript, run with Node
      // V3: Includes build tools for native modules (better-sqlite3) and data directory for persistence
      dockerfile = `
FROM ${this.config.baseImage} AS builder

WORKDIR /app

# Install build tools for native modules (better-sqlite3 requires python3, make, g++)
# This is needed in Alpine-based images for compiling native Node.js modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies (including native modules like better-sqlite3)
RUN npm install

# Copy source and config files
COPY tsconfig*.json ./
COPY src ./src

# Build
RUN npm run build

# Production image
FROM ${this.config.baseImage} AS runner

WORKDIR /app

# Install runtime dependencies for native modules
# better-sqlite3 needs libstdc++ at runtime
RUN apk add --no-cache libstdc++

# Create data directory for SQLite persistence
# This directory will be mounted as a volume for PVC-backed storage
RUN mkdir -p /app/data && chown -R node:node /app/data

# Copy package files and install production dependencies
COPY package*.json ./
# Install production dependencies with native module support
RUN apk add --no-cache python3 make g++ && \\
    npm install --only=production && \\
    apk del python3 make g++

# Copy built files
COPY --from=builder /app/dist ./dist

# Set environment
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/app.db

# Declare volume for SQLite data persistence
VOLUME /app/data

# Expose port (8080 to match K8s deployment)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Switch to non-root user for security
USER node

# Run the application
CMD ["node", "dist/index.js"]
`.trim();
    }

    await writeFile(dockerfilePath, dockerfile, 'utf-8');
    this.logger.debug({ dockerfilePath, isFrontendApp }, 'Generated Dockerfile');
  }

  /**
   * Run docker build command
   */
  private runDockerBuild(
    workDir: string,
    imageName: string,
    onLog: (log: string) => void
  ): Promise<{ success: boolean; imageId?: string; error?: string }> {
    return new Promise((resolve) => {
      const args = ['build', '-t', imageName];

      // Add build args
      if (this.config.buildArgs) {
        for (const [key, value] of Object.entries(this.config.buildArgs)) {
          args.push('--build-arg', `${key}=${value}`);
        }
      }

      // Add labels
      if (this.config.labels) {
        for (const [key, value] of Object.entries(this.config.labels)) {
          args.push('--label', `${key}=${value}`);
        }
      }

      // Add context
      args.push('.');

      this.logger.debug({ args }, 'Running docker build');

      const proc = spawn('docker', args, {
        cwd: workDir,
        timeout: this.config.buildTimeout,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const line = data.toString();
        stdout += line;
        onLog(line);
      });

      proc.stderr.on('data', (data) => {
        const line = data.toString();
        stderr += line;
        onLog(line);
      });

      proc.on('close', (exitCode) => {
        if (exitCode === 0) {
          // Extract image ID from output
          const idMatch = stdout.match(/writing image sha256:([a-f0-9]+)/i) ??
                         stdout.match(/sha256:([a-f0-9]+)/);
          const imageId = idMatch?.[1]?.slice(0, 12);

          resolve({
            success: true,
            imageId,
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Build failed with exit code ${exitCode}`,
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });
    });
  }

  /**
   * Push image to registry
   */
  async push(imageName: string, tag: string = 'latest'): Promise<{
    success: boolean;
    error?: string;
  }> {
    const fullImageName = this.config.registry
      ? `${this.config.registry}/${imageName}:${tag}`
      : `${imageName}:${tag}`;

    this.logger.info({ imageName: fullImageName }, 'Pushing Docker image');

    return new Promise((resolve) => {
      const proc = spawn('docker', ['push', fullImageName]);

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        if (exitCode === 0) {
          this.logger.info({ imageName: fullImageName }, 'Image pushed successfully');
          resolve({ success: true });
        } else {
          this.logger.error({ error: stderr }, 'Image push failed');
          resolve({
            success: false,
            error: stderr || `Push failed with exit code ${exitCode}`,
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });
    });
  }

  /**
   * Tag an image
   */
  async tag(
    sourceName: string,
    targetName: string,
    targetTag: string = 'latest'
  ): Promise<{ success: boolean; error?: string }> {
    const fullTargetName = this.config.registry
      ? `${this.config.registry}/${targetName}:${targetTag}`
      : `${targetName}:${targetTag}`;

    this.logger.info({
      source: sourceName,
      target: fullTargetName,
    }, 'Tagging Docker image');

    return new Promise((resolve) => {
      const proc = spawn('docker', ['tag', sourceName, fullTargetName]);

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        if (exitCode === 0) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: stderr || `Tag failed with exit code ${exitCode}`,
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });
    });
  }

  /**
   * Load image into local Docker (useful for kind/minikube)
   */
  async loadToKind(imageName: string, clusterName: string = 'kind'): Promise<{
    success: boolean;
    error?: string;
  }> {
    this.logger.info({
      imageName,
      clusterName,
    }, 'Loading image into kind cluster');

    return new Promise((resolve) => {
      const proc = spawn('kind', [
        'load',
        'docker-image',
        imageName,
        '--name',
        clusterName,
      ]);

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        if (exitCode === 0) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: stderr || `Load failed with exit code ${exitCode}`,
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });
    });
  }

  /**
   * Delete an image from local Docker and optionally from registry
   * For Kaniko builds (GKE), skips local Docker and uses gcloud for Artifact Registry
   */
  async delete(imageName: string, tag: string = 'latest'): Promise<{
    success: boolean;
    localDeleted: boolean;
    registryDeleted: boolean;
    error?: string;
  }> {
    const fullImageName = this.config.registry
      ? `${this.config.registry}/${imageName}:${tag}`
      : `${imageName}:${tag}`;

    this.logger.info({ imageName: fullImageName, buildMode: this.config.buildMode }, 'Deleting Docker image');

    const results = {
      success: true,
      localDeleted: false,
      registryDeleted: false,
      error: undefined as string | undefined,
    };

    // 1. Delete from local Docker (skip if using Kaniko - no Docker daemon in GKE)
    if (this.config.buildMode !== 'kaniko') {
      try {
        const localResult = await this.deleteLocalImage(fullImageName);
        results.localDeleted = localResult.success;
        if (!localResult.success && localResult.error) {
          this.logger.warn({ error: localResult.error }, 'Local image deletion failed (may not exist)');
        }
      } catch (err) {
        this.logger.warn({ error: err }, 'Local image deletion error');
      }
    } else {
      this.logger.debug('Skipping local Docker deletion (Kaniko mode - no Docker daemon)');
      results.localDeleted = true; // Consider skipped as success in Kaniko mode
    }

    // 2. Delete from registry (if registry is configured)
    if (this.config.registry) {
      try {
        const registryResult = await this.deleteFromRegistry(imageName, tag);
        results.registryDeleted = registryResult.success;
        if (!registryResult.success && registryResult.error) {
          this.logger.warn({ error: registryResult.error }, 'Registry image deletion failed');
        }
      } catch (err) {
        this.logger.warn({ error: err }, 'Registry image deletion error');
      }
    }

    results.success = results.localDeleted || results.registryDeleted;

    this.logger.info({
      imageName: fullImageName,
      localDeleted: results.localDeleted,
      registryDeleted: results.registryDeleted,
    }, 'Image deletion completed');

    return results;
  }

  /**
   * Delete image from local Docker
   */
  private deleteLocalImage(imageName: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    return new Promise((resolve) => {
      // Force remove to handle images in use
      const proc = spawn('docker', ['rmi', '-f', imageName]);

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        if (exitCode === 0) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: stderr || `Delete failed with exit code ${exitCode}`,
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });
    });
  }

  /**
   * Delete image from registry
   * For Artifact Registry (GKE), uses gcloud CLI
   * For Docker Registry, uses HTTP API v2
   */
  private async deleteFromRegistry(imageName: string, tag: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const registry = this.config.registry;
    if (!registry) {
      return { success: false, error: 'No registry configured' };
    }

    // Check if this is Google Artifact Registry (format: REGION-docker.pkg.dev/PROJECT/REPO)
    const isArtifactRegistry = registry.includes('-docker.pkg.dev');

    if (isArtifactRegistry) {
      return this.deleteFromArtifactRegistry(imageName, tag);
    }

    // Fall back to Docker Registry HTTP API v2 for other registries
    return this.deleteFromDockerRegistry(imageName, tag);
  }

  /**
   * Delete image from Google Artifact Registry using REST API
   * Uses GKE Workload Identity or service account for authentication
   */
  private async deleteFromArtifactRegistry(imageName: string, tag: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const fullImageName = `${this.config.registry}/${imageName}:${tag}`;

    // Parse the registry URL to extract location, project, and repository
    // Format: {location}-docker.pkg.dev/{project}/{repository}
    const registryMatch = this.config.registry?.match(
      /^([\w-]+)-docker\.pkg\.dev\/([^/]+)\/([^/]+)$/
    );

    if (!registryMatch) {
      return {
        success: false,
        error: `Could not parse Artifact Registry URL: ${this.config.registry}`,
      };
    }

    const [, location, project, repository] = registryMatch;

    this.logger.debug({
      fullImageName,
      location,
      project,
      repository,
      package: imageName,
      tag,
    }, 'Deleting image from Artifact Registry via REST API');

    try {
      // Get access token from GKE metadata service
      const accessToken = await this.getGKEAccessToken();

      if (!accessToken) {
        this.logger.warn('Could not obtain GCP access token - image deletion skipped');
        return {
          success: false,
          error: 'Could not obtain GCP access token (not running in GKE or no Workload Identity)',
        };
      }

      // First, delete the tag
      // DELETE https://artifactregistry.googleapis.com/v1/projects/{project}/locations/{location}/repositories/{repository}/packages/{package}/tags/{tag}
      const tagUrl = `https://artifactregistry.googleapis.com/v1/projects/${project}/locations/${location}/repositories/${repository}/packages/${encodeURIComponent(imageName)}/tags/${tag}`;

      this.logger.debug({ tagUrl }, 'Deleting image tag');

      const tagResponse = await fetch(tagUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (tagResponse.ok) {
        this.logger.info({ fullImageName }, 'Image tag deleted from Artifact Registry');
        return { success: true };
      }

      if (tagResponse.status === 404) {
        // Tag doesn't exist - consider this success
        this.logger.debug({ fullImageName }, 'Image tag not found in registry (already deleted)');
        return { success: true };
      }

      // Check for permission errors
      if (tagResponse.status === 403) {
        const errorBody = await tagResponse.text();
        this.logger.warn({ status: tagResponse.status, error: errorBody }, 'Permission denied for Artifact Registry deletion');
        return {
          success: false,
          error: `Permission denied: Service account may need artifactregistry.versions.delete permission. ${errorBody}`,
        };
      }

      const errorBody = await tagResponse.text();
      return {
        success: false,
        error: `Artifact Registry API error: ${tagResponse.status} ${tagResponse.statusText} - ${errorBody}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn({ error: errorMessage }, 'Failed to delete from Artifact Registry');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get access token from GKE metadata service
   * Returns null if not running in GKE or metadata service is unavailable
   */
  private async getGKEAccessToken(): Promise<string | null> {
    try {
      // GKE metadata service endpoint for access token
      const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

      const response = await fetch(metadataUrl, {
        headers: {
          'Metadata-Flavor': 'Google',
        },
      });

      if (!response.ok) {
        this.logger.debug({ status: response.status }, 'GKE metadata service not available');
        return null;
      }

      const data = await response.json() as { access_token: string; expires_in: number; token_type: string };
      return data.access_token;
    } catch (err) {
      // Not running in GKE or metadata service unavailable
      this.logger.debug({ error: err instanceof Error ? err.message : 'unknown' }, 'Could not get GKE access token');
      return null;
    }
  }

  /**
   * Delete image from Docker Registry using HTTP API v2
   * Note: Registry must have REGISTRY_STORAGE_DELETE_ENABLED=true
   */
  private async deleteFromDockerRegistry(imageName: string, tag: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const registryUrl = this.config.registry?.replace(/^localhost/, 'http://localhost');
    if (!registryUrl) {
      return { success: false, error: 'No registry configured' };
    }

    const baseUrl = registryUrl.startsWith('http') ? registryUrl : `http://${registryUrl}`;

    try {
      // Step 1: Get the manifest digest for the tag
      const manifestUrl = `${baseUrl}/v2/${imageName}/manifests/${tag}`;

      // Use fetch to get digest from headers
      const manifestResponse = await fetch(manifestUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
        },
      });

      if (!manifestResponse.ok) {
        if (manifestResponse.status === 404) {
          // Image doesn't exist in registry - consider this success
          return { success: true };
        }
        return {
          success: false,
          error: `Failed to get manifest: ${manifestResponse.status} ${manifestResponse.statusText}`,
        };
      }

      const digest = manifestResponse.headers.get('docker-content-digest');
      if (!digest) {
        return { success: false, error: 'No digest found in manifest response' };
      }

      // Step 2: Delete the manifest by digest
      const deleteUrl = `${baseUrl}/v2/${imageName}/manifests/${digest}`;
      const deleteResponse = await fetch(deleteUrl, {
        method: 'DELETE',
      });

      if (deleteResponse.ok || deleteResponse.status === 202) {
        this.logger.info({ imageName, tag, digest }, 'Image deleted from registry');
        return { success: true };
      }

      if (deleteResponse.status === 405) {
        return {
          success: false,
          error: 'Registry does not allow deletion (REGISTRY_STORAGE_DELETE_ENABLED may be false)',
        };
      }

      return {
        success: false,
        error: `Delete failed: ${deleteResponse.status} ${deleteResponse.statusText}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Delete generated files from temp directory
   * Called during cycle cleanup to remove /tmp/chronosops-dev-{cycleId}/ directories
   */
  async deleteTempDirectory(cycleId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const tempDir = `/tmp/chronosops-dev-${cycleId}`;

    try {
      const { rm, stat } = await import('node:fs/promises');

      // Check if directory exists
      try {
        await stat(tempDir);
      } catch {
        // Directory doesn't exist - consider this success
        this.logger.debug({ tempDir }, 'Temp directory does not exist (already cleaned)');
        return { success: true };
      }

      // Remove directory recursively
      await rm(tempDir, { recursive: true, force: true });
      this.logger.info({ tempDir }, 'Temp directory deleted');
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn({ tempDir, error: errorMessage }, 'Failed to delete temp directory');
      return { success: false, error: errorMessage };
    }
  }
}
