/**
 * Health check routes
 */
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Check if running inside Kubernetes cluster
const isInCluster = (): boolean => {
  return existsSync('/var/run/secrets/kubernetes.io/serviceaccount/token');
};

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Basic health check
  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  // Kubernetes connection status
  app.get('/health/kubernetes', async () => {
    // Check for in-cluster service account or kubeconfig file
    const inCluster = isInCluster();
    const kubeconfigPath = process.env.KUBECONFIG || join(homedir(), '.kube', 'config');
    const hasKubeconfig = existsSync(kubeconfigPath);
    const hasK8sAccess = inCluster || hasKubeconfig;

    return {
      status: hasK8sAccess ? 'connected' : 'disconnected',
      configured: hasK8sAccess,
      inCluster,
      message: inCluster 
        ? 'Running in Kubernetes cluster' 
        : hasKubeconfig 
          ? 'Kubernetes cluster connected via kubeconfig' 
          : 'Kubernetes not configured',
    };
  });

  // Services status endpoint
  app.get('/services/status', async () => {
    const inCluster = isInCluster();
    const kubeconfigPath = process.env.KUBECONFIG || join(homedir(), '.kube', 'config');
    const hasKubeconfig = existsSync(kubeconfigPath);
    const hasK8sAccess = inCluster || hasKubeconfig;

    return {
      api: 'connected',
      websocket: 'connected',
      screenCapture: process.env.SCREEN_CAPTURE_URL ? 'configured' : 'disconnected',
      kubernetes: hasK8sAccess ? 'configured' : 'disconnected',
    };
  });
}
