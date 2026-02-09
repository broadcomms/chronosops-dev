/**
 * Monitored Applications Section
 * Displays K8s namespaces/deployments and allows selecting apps to monitor
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Section, Card } from '../layout/PageLayout';
import {
  useKubernetesStatus,
  useKubernetesNamespaces,
  useKubernetesDeployments,
  useMonitoredApps,
  useAddMonitoredApp,
  useRemoveMonitoredApp,
  useGenerateDashboard,
  useKubernetesConfig,
} from '../../hooks';
import type { MonitoredApp } from '../../api/monitored-apps';
import type { DeploymentInfo } from '../../api/kubernetes';

interface NamespaceRowProps {
  namespace: string;
  monitoredApps: MonitoredApp[];
  onAddApp: (namespace: string, deployment: string, displayName: string) => void;
  onRemoveApp: (id: string) => void;
  onGenerateDashboard: (id: string) => void;
  isGenerating: boolean;
}

function NamespaceRow({
  namespace,
  monitoredApps,
  onAddApp,
  onRemoveApp,
  onGenerateDashboard,
  isGenerating,
}: NamespaceRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: deployments, isLoading } = useKubernetesDeployments(namespace);

  // Get monitored apps for this namespace
  const namespaceApps = monitoredApps.filter((app) => app.namespace === namespace);

  // Check if deployment is monitored
  const isMonitored = (deploymentName: string) => {
    return namespaceApps.some((app) => app.deployment === deploymentName);
  };

  // Get monitored app by deployment name
  const getMonitoredApp = (deploymentName: string) => {
    return namespaceApps.find((app) => app.deployment === deploymentName);
  };

  const handleToggleMonitoring = (deployment: DeploymentInfo) => {
    const existingApp = getMonitoredApp(deployment.name);
    if (existingApp) {
      onRemoveApp(existingApp.id);
    } else {
      onAddApp(namespace, deployment.name, `${deployment.name} (${namespace})`);
    }
  };

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{isExpanded ? '\u25BC' : '\u25B6'}</span>
          <span className="font-medium">{namespace}</span>
          <span className="text-xs text-gray-500">
            ({namespaceApps.length} monitored)
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {deployments?.length ?? '...'} deployments
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-700">
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">Loading deployments...</div>
          ) : deployments && deployments.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="text-left p-2 pl-4">Monitor</th>
                  <th className="text-left p-2">Deployment</th>
                  <th className="text-left p-2">Replicas</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Dashboard</th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((deployment) => {
                  const monitored = isMonitored(deployment.name);
                  const app = getMonitoredApp(deployment.name);

                  return (
                    <tr
                      key={deployment.name}
                      className="border-b border-gray-700/50 hover:bg-gray-800/30"
                    >
                      <td className="p-2 pl-4">
                        <input
                          type="checkbox"
                          checked={monitored}
                          onChange={() => handleToggleMonitoring(deployment)}
                          className="rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{deployment.name}</span>
                          {app?.autoMonitored && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                              auto
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-sm text-gray-400">
                        {deployment.readyReplicas}/{deployment.replicas}
                      </td>
                      <td className="p-2">
                        <StatusBadge status={deployment.status} />
                      </td>
                      <td className="p-2">
                        {app?.grafanaDashboardUrl ? (
                          <a
                            href={app.grafanaDashboardUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:underline"
                          >
                            Open Dashboard
                          </a>
                        ) : monitored ? (
                          <button
                            onClick={() => app && onGenerateDashboard(app.id)}
                            disabled={isGenerating}
                            className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
                          >
                            {isGenerating ? 'Generating...' : 'Generate Dashboard'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-4 text-center text-gray-500">No deployments found</div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'available' | 'progressing' | 'failed' }) {
  const styles = {
    available: 'bg-green-500/20 text-green-400',
    progressing: 'bg-yellow-500/20 text-yellow-400',
    failed: 'bg-red-500/20 text-red-400',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${styles[status]}`}>
      {status}
    </span>
  );
}

export function MonitoredAppsSection() {
  const { data: k8sStatus, isLoading: statusLoading } = useKubernetesStatus();
  const { data: k8sConfig } = useKubernetesConfig();
  const { data: allNamespaces, isLoading: namespacesLoading, error: namespacesError } = useKubernetesNamespaces();
  const { data: monitoredAppsData = [], isLoading: appsLoading } = useMonitoredApps();
  // Ensure monitoredApps is always an array (defensive coding)
  const monitoredApps = Array.isArray(monitoredAppsData) ? monitoredAppsData : [];

  // Filter to only show the configured namespace
  const configuredNamespace = k8sConfig?.config?.namespace || 'development';
  const namespaces = allNamespaces?.filter(ns => ns.name === configuredNamespace);

  const addAppMutation = useAddMonitoredApp();
  const removeAppMutation = useRemoveMonitoredApp();
  const generateDashboardMutation = useGenerateDashboard();

  const handleAddApp = async (namespace: string, deployment: string, displayName: string) => {
    try {
      await addAppMutation.mutateAsync({
        namespace,
        deployment,
        displayName,
        isActive: true,
      });
      toast.success(`Started monitoring ${deployment}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage.includes('already monitored')) {
        toast.info(`${deployment} is already being monitored`);
      } else {
        toast.error(`Failed to add ${deployment} to monitored apps`);
      }
    }
  };

  const handleRemoveApp = async (id: string) => {
    try {
      await removeAppMutation.mutateAsync(id);
      toast.success('Stopped monitoring app');
    } catch {
      toast.error('Failed to remove monitored app');
    }
  };

  const handleGenerateDashboard = async (id: string) => {
    try {
      await generateDashboardMutation.mutateAsync(id);
      toast.success('Dashboard generated successfully');
    } catch {
      toast.info('Dashboard generation coming soon');
    }
  };

  const isLoading = statusLoading || namespacesLoading || appsLoading;
  const isConnected = k8sStatus?.connected;

  return (
    <Section
      title="Monitored Applications"
      description={`Applications in the '${configuredNamespace}' namespace. Apps deployed via Development Dashboard are auto-monitored.`}
    >
      <Card>
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : !isConnected ? (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-2">Kubernetes cluster not connected</p>
            <p className="text-sm text-gray-500">
              Configure Kubernetes above to discover applications
            </p>
          </div>
        ) : namespacesError ? (
          <div className="text-center py-8">
            <p className="text-red-400 mb-2">Failed to fetch namespaces</p>
            <p className="text-sm text-gray-500">{String(namespacesError)}</p>
          </div>
        ) : namespaces && namespaces.length > 0 ? (
          <div className="space-y-2">
            {namespaces.map((ns) => (
              <NamespaceRow
                key={ns.name}
                namespace={ns.name}
                monitoredApps={monitoredApps}
                onAddApp={handleAddApp}
                onRemoveApp={handleRemoveApp}
                onGenerateDashboard={handleGenerateDashboard}
                isGenerating={generateDashboardMutation.isPending}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-2">No deployments in '{configuredNamespace}' namespace</p>
            <p className="text-sm text-gray-500">
              Deploy an app via the Development Dashboard or create a deployment in Kubernetes
            </p>
          </div>
        )}

        {monitoredApps.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">
                {monitoredApps.filter((app) => app.isActive).length} apps actively monitored
              </span>
              <span className="text-xs text-gray-500">
                These apps will appear in the incident creation dropdown
              </span>
            </div>
          </div>
        )}
      </Card>
    </Section>
  );
}
