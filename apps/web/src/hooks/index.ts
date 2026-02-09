/**
 * Custom hooks exports
 */
export { useLiveFrames } from './useLiveFrames';
export { useConnectionStatus } from './useConnectionStatus';
export {
  useKeyboardShortcuts,
  useShortcutsHelp,
  formatShortcut,
  globalShortcuts,
} from './useKeyboardShortcuts';
export type { KeyboardShortcut } from './useKeyboardShortcuts';

// Kubernetes Discovery
export {
  useKubernetesStatus,
  useKubernetesNamespaces,
  useKubernetesDeployments,
  kubernetesKeys,
} from './useKubernetesDiscovery';

// Monitored Apps
export {
  useMonitoredApps,
  useActiveMonitoredApps,
  useAddMonitoredApp,
  useUpdateMonitoredApp,
  useRemoveMonitoredApp,
  useGenerateDashboard,
  monitoredAppsKeys,
} from './useMonitoredApps';

// Configuration
export {
  useKubernetesConfig,
} from './useConfig';
