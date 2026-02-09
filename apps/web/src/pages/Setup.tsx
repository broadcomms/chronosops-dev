/**
 * Setup Wizard - Configuration pages with API persistence
 */
import { useState, useEffect, type ReactNode } from 'react';
import { PageLayout, Section, Card } from '../components/layout/PageLayout';
import { toast } from 'sonner';
import { Server, MonitorPlay, Shield, X, Code2 } from 'lucide-react';
import {
  useKubernetesConfig,
  useUpdateKubernetesConfig,
  useTestKubernetesConnection,
  useDashboardConfig,
  useUpdateDashboardConfig,
  useSafetyConfig,
  useUpdateSafetyConfig,
  useDevelopmentConfig,
  useUpdateDevelopmentConfig,
} from '../hooks/useConfig';
import { MonitoredAppsSection } from '../components/setup/MonitoredAppsSection';
import type { KubernetesConfig, DashboardConfig, ActionSafetyConfig, DevelopmentSettingsConfig } from '@chronosops/shared';

type ConfigStatus = 'not_configured' | 'configured' | 'error' | 'loading';

interface SetupCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  status: ConfigStatus;
  onClick: () => void;
}

function SetupCard({ icon, title, description, status, onClick }: SetupCardProps) {
  const statusStyles = {
    not_configured: 'bg-yellow-500/10 text-yellow-400',
    configured: 'bg-green-500/10 text-green-400',
    error: 'bg-red-500/10 text-red-400',
    loading: 'bg-gray-500/10 text-gray-400',
  };

  const statusLabels = {
    not_configured: 'Not Configured',
    configured: 'Configured',
    error: 'Error',
    loading: 'Loading...',
  };

  return (
    <Card className="hover:border-blue-500/50 transition-colors cursor-pointer" onClick={onClick}>
      <div className="text-center py-4">
        <div className="text-4xl mb-3">{icon}</div>
        <h3 className="font-medium mb-1">{title}</h3>
        <p className="text-sm text-gray-500">{description}</p>
        <span className={`inline-block mt-3 px-2 py-0.5 text-xs rounded ${statusStyles[status]}`}>
          {statusLabels[status]}
        </span>
      </div>
    </Card>
  );
}

// Kubernetes Configuration Modal
function KubernetesConfigModal({
  isOpen,
  onClose,
  initialConfig,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialConfig?: KubernetesConfig | null;
}) {
  const [context, setContext] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [allowedActions, setAllowedActions] = useState({
    rollback: true,
    restart: true,
    scale: false,
  });

  const updateMutation = useUpdateKubernetesConfig();
  const testMutation = useTestKubernetesConnection();

  // Load initial config when modal opens
  useEffect(() => {
    if (isOpen && initialConfig) {
      setContext(initialConfig.context || '');
      setNamespace(initialConfig.namespace || 'default');
      setAllowedActions(
        initialConfig.allowedActions || {
          rollback: true,
          restart: true,
          scale: false,
        }
      );
    }
  }, [isOpen, initialConfig]);

  if (!isOpen) return null;

  const handleTest = async () => {
    try {
      const result = await testMutation.mutateAsync(context);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error('Connection test failed');
    }
  };

  const handleSave = async () => {
    if (!context) {
      toast.error('Please enter a Kubernetes context');
      return;
    }

    try {
      await updateMutation.mutateAsync({
        context,
        namespace,
        allowedNamespaces: [namespace],
        allowedActions,
      });
      toast.success('Kubernetes configuration saved');
      onClose();
    } catch {
      toast.error('Failed to save configuration');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Kubernetes Configuration</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Kubernetes Context</label>
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g., minikube, docker-desktop, my-cluster"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">The kubectl context to use for cluster operations</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Default Namespace</label>
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="default"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Namespace to monitor for incidents (can be overridden per incident)
            </p>
          </div>

          <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-700">
            <h4 className="text-sm font-medium text-gray-300 mb-2">Allowed Actions</h4>
            <div className="space-y-2 text-sm text-gray-400">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowedActions.rollback}
                  onChange={(e) => setAllowedActions((prev) => ({ ...prev, rollback: e.target.checked }))}
                  className="rounded bg-gray-700 border-gray-600"
                />
                Rollback deployments
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowedActions.restart}
                  onChange={(e) => setAllowedActions((prev) => ({ ...prev, restart: e.target.checked }))}
                  className="rounded bg-gray-700 border-gray-600"
                />
                Restart pods
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowedActions.scale}
                  onChange={(e) => setAllowedActions((prev) => ({ ...prev, scale: e.target.checked }))}
                  className="rounded bg-gray-700 border-gray-600"
                />
                Scale deployments
              </label>
            </div>
          </div>

          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <h4 className="text-sm font-medium text-blue-400 mb-1">Documentation</h4>
            <p className="text-xs text-gray-400">
              Learn how to set up kubectl contexts:{' '}
              <a
                href="https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-multiple-clusters/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Kubernetes Documentation
              </a>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-gray-700">
          <button
            onClick={handleTest}
            disabled={testMutation.isPending || !context}
            className="px-4 py-2 text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testMutation.isPending ? 'Testing...' : 'Test Connection'}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Vision Monitoring Configuration Modal
function DashboardConfigModal({
  isOpen,
  onClose,
  initialConfig,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialConfig?: DashboardConfig | null;
}) {
  const [fps, setFps] = useState(2);
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [recordingDir, setRecordingDir] = useState('./data/recordings');

  const updateMutation = useUpdateDashboardConfig();

  useEffect(() => {
    if (isOpen && initialConfig) {
      setFps(initialConfig.visionFps || 2);
      setWidth(initialConfig.visionWidth || 1280);
      setHeight(initialConfig.visionHeight || 720);
      setRecordingDir(initialConfig.recordingDirectory || './data/recordings');
    }
  }, [isOpen, initialConfig]);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        visionFps: fps,
        visionWidth: width,
        visionHeight: height,
        recordingDirectory: recordingDir,
      });
      toast.success('Vision monitoring configuration saved');
      onClose();
    } catch {
      toast.error('Failed to save configuration');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Vision Monitoring</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
            <h4 className="text-sm font-medium text-purple-400 mb-1">Server-Side Rendering</h4>
            <p className="text-xs text-gray-400">
              ChronosOps renders dashboards server-side using Prometheus metrics. Apps deployed via
              the Development Dashboard are automatically monitored.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Frame Rate (FPS)</label>
            <input
              type="number"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              min={1}
              max={10}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">How many dashboard frames to render per second (1-10)</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Width (px)</label>
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                min={640}
                max={1920}
                step={64}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Height (px)</label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                min={480}
                max={1080}
                step={48}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-2">Dashboard render resolution (640x480 to 1920x1080)</p>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Recording Directory</label>
            <input
              type="text"
              value={recordingDir}
              onChange={(e) => setRecordingDir(e.target.value)}
              placeholder="./data/recordings"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Where to store investigation video recordings</p>
          </div>
        </div>

        <div className="flex items-center justify-end p-4 border-t border-gray-700 gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Action Safety Configuration Modal
function ActionSafetyModal({
  isOpen,
  onClose,
  initialConfig,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialConfig?: ActionSafetyConfig | null;
}) {
  const [cooldown, setCooldown] = useState(60000);
  const [maxActions, setMaxActions] = useState(5);
  const [dryRun, setDryRun] = useState(false);
  const [enforceCooldowns, setEnforceCooldowns] = useState(true);
  const [requireManualCodeEvolutionApproval, setRequireManualCodeEvolutionApproval] = useState(false);

  const updateMutation = useUpdateSafetyConfig();

  useEffect(() => {
    if (isOpen && initialConfig) {
      setCooldown(initialConfig.actionCooldownMs || 60000);
      setMaxActions(initialConfig.maxActionsPerWindow || 5);
      setDryRun(initialConfig.dryRunMode ?? false);
      setEnforceCooldowns(initialConfig.enforceCooldowns ?? true);
      setRequireManualCodeEvolutionApproval(initialConfig.requireManualCodeEvolutionApproval ?? false);
    }
  }, [isOpen, initialConfig]);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        actionCooldownMs: cooldown,
        maxActionsPerWindow: maxActions,
        actionWindowMs: 300000, // Fixed 5-minute window
        dryRunMode: dryRun,
        enforceCooldowns,
        requireManualCodeEvolutionApproval,
      });
      toast.success('Action safety settings saved');
      onClose();
    } catch {
      toast.error('Failed to save settings');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Action Safety Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Action Cooldown (ms)</label>
            <input
              type="number"
              value={cooldown}
              onChange={(e) => setCooldown(Number(e.target.value))}
              min={10000}
              max={600000}
              step={10000}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Minimum time between identical actions on the same target</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Max Actions Per Window</label>
            <input
              type="number"
              value={maxActions}
              onChange={(e) => setMaxActions(Number(e.target.value))}
              min={1}
              max={20}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Maximum number of actions allowed in a 5-minute window</p>
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700">
            <div>
              <h4 className="text-sm font-medium text-gray-300">Dry Run Mode</h4>
              <p className="text-xs text-gray-500">Simulate actions without executing them</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700">
            <div>
              <h4 className="text-sm font-medium text-gray-300">Enforce Cooldowns</h4>
              <p className="text-xs text-gray-500">Rate limit actions on the same target</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enforceCooldowns}
                onChange={(e) => setEnforceCooldowns(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700">
            <div>
              <h4 className="text-sm font-medium text-gray-300">Require Manual Code Evolution Approval</h4>
              <p className="text-xs text-gray-500">When enabled, incident-triggered code fixes require manual review</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={requireManualCodeEvolutionApproval}
                onChange={(e) => setRequireManualCodeEvolutionApproval(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <h4 className="text-sm font-medium text-yellow-400 mb-1">Safety Notice</h4>
            <p className="text-xs text-gray-400">
              These settings help prevent runaway automation. Actions are rate-limited and logged. Enable dry run mode
              during testing to see what actions would be taken without actually executing them.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end p-4 border-t border-gray-700 gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Development Settings Modal
function DevelopmentSettingsModal({
  isOpen,
  onClose,
  initialConfig,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialConfig?: DevelopmentSettingsConfig | null;
}) {
  const [enableFaultInjection, setEnableFaultInjection] = useState(false);
  const [enablePromptInjectionTesting, setEnablePromptInjectionTesting] = useState(false);

  const updateMutation = useUpdateDevelopmentConfig();

  useEffect(() => {
    if (isOpen && initialConfig) {
      setEnableFaultInjection(initialConfig.enableFaultInjection ?? false);
      setEnablePromptInjectionTesting(initialConfig.enablePromptInjectionTesting ?? false);
    }
  }, [isOpen, initialConfig]);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        enableFaultInjection,
        enablePromptInjectionTesting,
      });
      toast.success('Development settings saved');
      onClose();
    } catch {
      toast.error('Failed to save settings');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Development Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700">
            <div>
              <h4 className="text-sm font-medium text-gray-300">Enable Fault Injection for Testing</h4>
              <p className="text-xs text-gray-500">When enabled, generated apps include /bugs/* endpoints for testing rollback, restart, and scale operations</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enableFaultInjection}
                onChange={(e) => setEnableFaultInjection(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-orange-700/50">
            <div>
              <h4 className="text-sm font-medium text-orange-400">Enable Prompt Injection Testing</h4>
              <p className="text-xs text-gray-500">Bypasses 500 errors during verification when requirement contains "production bug that needs to be fixed"</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enablePromptInjectionTesting}
                onChange={(e) => setEnablePromptInjectionTesting(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-orange-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600"></div>
            </label>
          </div>

          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <h4 className="text-sm font-medium text-blue-400 mb-1">What is Fault Injection?</h4>
            <p className="text-xs text-gray-400">
              Fault injection adds special endpoints to generated apps that allow you to simulate errors, 
              high latency, and memory issues. This is useful for testing how ChronosOps responds to 
              incidents and validates the self-healing capabilities. Keep this disabled for production apps.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end p-4 border-t border-gray-700 gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Setup() {
  const [k8sModal, setK8sModal] = useState(false);
  const [dashboardModal, setDashboardModal] = useState(false);
  const [safetyModal, setSafetyModal] = useState(false);
  const [developmentModal, setDevelopmentModal] = useState(false);

  // Load configurations from API
  const { data: k8sData, isLoading: k8sLoading } = useKubernetesConfig();
  const { data: dashboardData, isLoading: dashboardLoading } = useDashboardConfig();
  const { data: safetyData, isLoading: safetyLoading } = useSafetyConfig();
  const { data: developmentData, isLoading: developmentLoading } = useDevelopmentConfig();

  // Determine status based on loaded config
  const getK8sStatus = (): ConfigStatus => {
    if (k8sLoading) return 'loading';
    if (k8sData?.config?.context) return 'configured';
    return 'not_configured';
  };

  const getDashboardStatus = (): ConfigStatus => {
    if (dashboardLoading) return 'loading';
    // Vision config is always configured with defaults
    if (dashboardData?.config) return 'configured';
    return 'not_configured';
  };

  const getSafetyStatus = (): ConfigStatus => {
    if (safetyLoading) return 'loading';
    return 'configured'; // Safety always has defaults
  };

  const getDevelopmentStatus = (): ConfigStatus => {
    if (developmentLoading) return 'loading';
    return 'configured'; // Development settings always have defaults
  };

  return (
    <PageLayout title="Setup">
      <Section description="Configure ChronosOps for your environment">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <SetupCard
            icon={<Server size={40} className="text-blue-400" />}
            title="Kubernetes Cluster"
            description="Connect your K8s cluster"
            status={getK8sStatus()}
            onClick={() => setK8sModal(true)}
          />

          <SetupCard
            icon={<MonitorPlay size={40} className="text-purple-400" />}
            title="Vision Monitoring"
            description="Configure dashboard rendering"
            status={getDashboardStatus()}
            onClick={() => setDashboardModal(true)}
          />

          <SetupCard
            icon={<Shield size={40} className="text-green-400" />}
            title="Action Safety"
            description="Configure remediation limits"
            status={getSafetyStatus()}
            onClick={() => setSafetyModal(true)}
          />

          <SetupCard
            icon={<Code2 size={40} className="text-orange-400" />}
            title="Development Settings"
            description="Configure code generation"
            status={getDevelopmentStatus()}
            onClick={() => setDevelopmentModal(true)}
          />
        </div>
      </Section>

      {/* Monitored Applications Section */}
      <MonitoredAppsSection />

      <Section title="Quick Start">
        <Card>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center text-sm font-medium">
                1
              </div>
              <div>
                <h4 className="font-medium">Connect Kubernetes</h4>
                <p className="text-sm text-gray-500">Provide your kubeconfig context to enable deployments and remediation</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center text-sm font-medium">
                2
              </div>
              <div>
                <h4 className="font-medium">Deploy Applications</h4>
                <p className="text-sm text-gray-500">Create apps via the Development Dashboard - they are auto-monitored on deployment</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center text-sm font-medium">
                3
              </div>
              <div>
                <h4 className="font-medium">View Monitoring</h4>
                <p className="text-sm text-gray-500">See live metrics in the Command Center - dashboards are rendered server-side</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center text-sm font-medium">
                4
              </div>
              <div>
                <h4 className="font-medium">Review Safety Settings</h4>
                <p className="text-sm text-gray-500">Configure action limits and cooldowns for autonomous remediation</p>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      {/* Configuration Modals */}
      <KubernetesConfigModal isOpen={k8sModal} onClose={() => setK8sModal(false)} initialConfig={k8sData?.config} />

      <DashboardConfigModal
        isOpen={dashboardModal}
        onClose={() => setDashboardModal(false)}
        initialConfig={dashboardData?.config}
      />

      <ActionSafetyModal isOpen={safetyModal} onClose={() => setSafetyModal(false)} initialConfig={safetyData} />

      <DevelopmentSettingsModal
        isOpen={developmentModal}
        onClose={() => setDevelopmentModal(false)}
        initialConfig={developmentData}
      />
    </PageLayout>
  );
}
