/**
 * SystemHealthCard - Shows cluster and service health status
 */
import { useConnectionStatus } from '../../context/AppContext';
import { useWebSocketContext } from '../../context/WebSocketContext';
import type { ServiceStatus } from '../../types';

interface SystemHealthCardProps {
  className?: string;
}

function StatusDot({ status }: { status: ServiceStatus }) {
  const colors: Record<ServiceStatus, string> = {
    connected: 'bg-green-500',
    disconnected: 'bg-gray-500',
    reconnecting: 'bg-yellow-500 animate-pulse',
    error: 'bg-red-500',
  };

  return <span className={`w-2 h-2 rounded-full ${colors[status]}`} />;
}

function ServiceRow({ label, status }: { label: string; status: ServiceStatus }) {
  const statusLabels: Record<ServiceStatus, string> = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting...',
    error: 'Error',
  };

  const statusColors: Record<ServiceStatus, string> = {
    connected: 'text-green-400',
    disconnected: 'text-gray-500',
    reconnecting: 'text-yellow-400',
    error: 'text-red-400',
  };

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <StatusDot status={status} />
        <span className="text-sm text-gray-300">{label}</span>
      </div>
      <span className={`text-xs ${statusColors[status]}`}>
        {statusLabels[status]}
      </span>
    </div>
  );
}

export function SystemHealthCard({ className = '' }: SystemHealthCardProps) {
  const { status, refresh } = useConnectionStatus();
  const { connectionStatus: wsConnectionStatus } = useWebSocketContext();

  // Map WebSocket context status to ServiceStatus
  const wsStatus: ServiceStatus =
    wsConnectionStatus === 'connected'
      ? 'connected'
      : wsConnectionStatus === 'reconnecting'
        ? 'reconnecting'
        : 'disconnected';

  // Merge WebSocket status with other statuses
  const mergedStatus = {
    ...status,
    websocket: wsStatus,
  };

  const isHealthy =
    mergedStatus.api === 'connected' &&
    mergedStatus.websocket === 'connected' &&
    mergedStatus.vision === 'connected';

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-300">System Health</h3>
        <button
          onClick={refresh}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Overall status */}
      <div className={`mb-4 p-3 rounded-lg ${isHealthy ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}>
        <div className="flex items-center gap-2">
          <span className={`text-lg ${isHealthy ? 'text-green-400' : 'text-yellow-400'}`}>
            {isHealthy ? '✓' : '⚠'}
          </span>
          <span className={`text-sm font-medium ${isHealthy ? 'text-green-400' : 'text-yellow-400'}`}>
            {isHealthy ? 'All Systems Operational' : 'Some Services Degraded'}
          </span>
        </div>
      </div>

      {/* Individual services */}
      <div className="divide-y divide-gray-700/50">
        <ServiceRow label="API Server" status={mergedStatus.api} />
        <ServiceRow label="WebSocket" status={mergedStatus.websocket} />
        <ServiceRow label="Vision Service" status={mergedStatus.vision} />
        <ServiceRow label="Kubernetes" status={mergedStatus.kubernetes} />
      </div>
    </div>
  );
}
