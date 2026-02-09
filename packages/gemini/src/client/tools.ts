/**
 * Kubernetes Tools for Gemini Function Calling
 *
 * These tools enable Gemini to query Kubernetes clusters in real-time
 * during incident investigation. Gemini can request pod status, logs,
 * events, and other cluster information as needed.
 *
 * @see https://ai.google.dev/gemini-api/docs/function-calling
 */

import type { GeminiTool } from './types.js';

/**
 * kubectl get - Query Kubernetes resources
 *
 * Retrieves information about Kubernetes resources like pods,
 * deployments, services, events, etc.
 */
export const KUBECTL_GET_TOOL: GeminiTool = {
  name: 'kubectl_get',
  description: `Query Kubernetes resources to get current cluster state.
Use this to check pod status, deployment health, recent events, and service configuration.
Returns JSON-formatted resource information.`,
  parameters: {
    type: 'object',
    properties: {
      resource: {
        type: 'string',
        description: 'The type of Kubernetes resource to query',
        enum: ['pods', 'deployments', 'services', 'events', 'configmaps', 'nodes', 'replicasets', 'ingresses'],
      },
      namespace: {
        type: 'string',
        description: 'The Kubernetes namespace to query (e.g., "production", "default")',
      },
      selector: {
        type: 'string',
        description: 'Label selector to filter resources (e.g., "app=api-server")',
      },
      name: {
        type: 'string',
        description: 'Specific resource name to get (optional, omit to list all)',
      },
    },
    required: ['resource', 'namespace'],
  },
};

/**
 * kubectl logs - Get pod logs
 *
 * Retrieves logs from a specific pod, optionally filtered by
 * container name, time range, or line count.
 */
export const KUBECTL_LOGS_TOOL: GeminiTool = {
  name: 'kubectl_logs',
  description: `Retrieve logs from a Kubernetes pod.
Use this to investigate errors, exceptions, and application behavior.
Can filter by container, time range, or number of lines.`,
  parameters: {
    type: 'object',
    properties: {
      podName: {
        type: 'string',
        description: 'Name of the pod to get logs from',
      },
      namespace: {
        type: 'string',
        description: 'The Kubernetes namespace where the pod is located',
      },
      container: {
        type: 'string',
        description: 'Container name (required for multi-container pods)',
      },
      tailLines: {
        type: 'number',
        description: 'Number of lines from the end of the logs to retrieve (default: 100)',
      },
      sinceSeconds: {
        type: 'number',
        description: 'Only return logs newer than this many seconds (e.g., 300 for last 5 minutes)',
      },
    },
    required: ['podName', 'namespace'],
  },
};

/**
 * kubectl describe - Get detailed resource information
 *
 * Retrieves detailed information about a specific resource,
 * including events, conditions, and configuration.
 */
export const KUBECTL_DESCRIBE_TOOL: GeminiTool = {
  name: 'kubectl_describe',
  description: `Get detailed information about a Kubernetes resource.
Use this for in-depth investigation of a specific pod, deployment, or service.
Returns events, conditions, and full configuration details.`,
  parameters: {
    type: 'object',
    properties: {
      resource: {
        type: 'string',
        description: 'The type of resource to describe',
        enum: ['pod', 'deployment', 'service', 'node', 'configmap', 'secret', 'ingress'],
      },
      name: {
        type: 'string',
        description: 'Name of the resource to describe',
      },
      namespace: {
        type: 'string',
        description: 'The Kubernetes namespace (not needed for cluster-scoped resources like nodes)',
      },
    },
    required: ['resource', 'name'],
  },
};

/**
 * kubectl top - Get resource usage metrics
 *
 * Retrieves CPU and memory usage for pods or nodes.
 */
export const KUBECTL_TOP_TOOL: GeminiTool = {
  name: 'kubectl_top',
  description: `Get CPU and memory usage metrics for pods or nodes.
Use this to identify resource exhaustion, memory leaks, or CPU spikes.
Requires metrics-server to be installed in the cluster.`,
  parameters: {
    type: 'object',
    properties: {
      resourceType: {
        type: 'string',
        description: 'Whether to get metrics for pods or nodes',
        enum: ['pods', 'nodes'],
      },
      namespace: {
        type: 'string',
        description: 'The namespace to query (only for pods)',
      },
      selector: {
        type: 'string',
        description: 'Label selector to filter resources',
      },
    },
    required: ['resourceType'],
  },
};

/**
 * kubectl rollout - Check deployment rollout status
 *
 * Retrieves the rollout status and history for a deployment.
 */
export const KUBECTL_ROLLOUT_TOOL: GeminiTool = {
  name: 'kubectl_rollout',
  description: `Check the rollout status and history of a deployment.
Use this to verify if a deployment succeeded or to investigate failed rollouts.
Can show recent revision history and rollout progress.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The rollout action to perform',
        enum: ['status', 'history'],
      },
      deploymentName: {
        type: 'string',
        description: 'Name of the deployment to check',
      },
      namespace: {
        type: 'string',
        description: 'The Kubernetes namespace',
      },
    },
    required: ['action', 'deploymentName', 'namespace'],
  },
};

/**
 * All Kubernetes tools available for function calling
 */
export const KUBERNETES_TOOLS: GeminiTool[] = [
  KUBECTL_GET_TOOL,
  KUBECTL_LOGS_TOOL,
  KUBECTL_DESCRIBE_TOOL,
  KUBECTL_TOP_TOOL,
  KUBECTL_ROLLOUT_TOOL,
];

/**
 * Convert our tool definitions to Gemini SDK format
 */
export function toGeminiToolFormat(tools: GeminiTool[]): unknown[] {
  return tools.map(tool => ({
    functionDeclarations: [{
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([key, value]) => [
            key,
            {
              type: value.type.toUpperCase(),
              description: value.description,
              enum: value.enum,
            },
          ])
        ),
        required: tool.parameters.required,
      },
    }],
  }));
}

/**
 * System instruction for tool-enabled analysis
 */
export const TOOL_ANALYSIS_SYSTEM_PROMPT = `You are ChronosOps, an autonomous incident response agent with access to Kubernetes tools.

You can query the Kubernetes cluster in real-time to gather information needed for your investigation.

AVAILABLE TOOLS:
1. kubectl_get - Query resources (pods, deployments, events, etc.)
2. kubectl_logs - Get pod logs for error investigation
3. kubectl_describe - Get detailed resource information
4. kubectl_top - Get CPU/memory usage metrics
5. kubectl_rollout - Check deployment rollout status

INVESTIGATION STRATEGY:
1. Start by getting recent events in the affected namespace
2. Check pod status and look for restarts, pending pods, or errors
3. If pods are unhealthy, get their logs
4. Check resource usage if performance issues are suspected
5. Review deployment rollout status if recent changes occurred

When you need information, call the appropriate tool. You can make multiple tool calls to gather comprehensive data before forming your analysis.

After gathering sufficient information, provide your analysis including:
- What you found in the cluster
- Likely root cause
- Recommended actions
- Confidence level`;
