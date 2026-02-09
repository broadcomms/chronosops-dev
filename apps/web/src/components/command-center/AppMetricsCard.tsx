/**
 * AppMetricsCard - Enhanced app card with real-time metrics visualization
 * Beautiful, Grafana-beating dashboard card with live metrics
 */
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Zap,
  Clock,
  Server,
  TrendingUp,
  ExternalLink,
  BarChart3,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { monitoredAppsApi, MonitoredApp, MetricStatus } from '../../api/monitored-apps';
import { MetricsGauge, MiniMetric } from './MetricsGauge';
import { config } from '../../config/env';

interface AppMetricsCardProps {
  app: MonitoredApp;
  incidentCount: number;
  isSelected?: boolean;
  onClick?: (serviceName: string, namespace: string) => void;
  /** Compact mode for grid view (reserved for future use) */
  compact?: boolean;
}

const STATUS_COLORS: Record<MetricStatus, string> = {
  healthy: 'text-green-400',
  warning: 'text-yellow-400',
  critical: 'text-red-400',
};

const STATUS_BG: Record<MetricStatus, string> = {
  healthy: 'bg-green-500/10 border-green-500/30',
  warning: 'bg-yellow-500/10 border-yellow-500/30',
  critical: 'bg-red-500/10 border-red-500/30',
};

export function AppMetricsCard({
  app,
  incidentCount,
  isSelected,
  onClick,
  compact: _compact = false,
}: AppMetricsCardProps) {
  // Fetch real-time metrics
  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ['app-metrics', app.id],
    queryFn: () => monitoredAppsApi.getMetrics(app.id),
    refetchInterval: config.polling.incidentRefresh,
    enabled: app.isActive,
  });

  const metrics = metricsData?.data;
  const hasIncidents = incidentCount > 0;
  const hasGrafana = !!app.grafanaDashboardUrl;

  // Determine overall health status
  const overallStatus: MetricStatus = hasIncidents
    ? 'critical'
    : metrics?.errorRate.status === 'critical' || metrics?.cpu.status === 'critical'
      ? 'critical'
      : metrics?.errorRate.status === 'warning' || metrics?.cpu.status === 'warning'
        ? 'warning'
        : 'healthy';

  const HealthIcon = overallStatus === 'healthy' ? CheckCircle : overallStatus === 'warning' ? AlertTriangle : XCircle;

  return (
    <div
      onClick={() => onClick?.(app.deployment, app.namespace)}
      className={`
        relative overflow-hidden rounded-xl transition-all duration-300 cursor-pointer
        ${isSelected
          ? 'bg-gray-800/80 border-2 border-blue-500 ring-4 ring-blue-500/20 shadow-xl shadow-blue-500/10'
          : 'bg-gray-800/50 border border-gray-700/50 hover:border-gray-600 hover:bg-gray-800/70'
        }
      `}
    >
      {/* Animated gradient background on selection */}
      {isSelected && (
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5" />
      )}

      {/* Card Content */}
      <div className="relative p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Server size={16} className={isSelected ? 'text-blue-400' : 'text-gray-400'} />
              <h3 className="font-semibold text-white truncate text-sm" title={app.displayName}>
                {app.displayName}
              </h3>
            </div>
            <div className="text-[11px] text-gray-500 truncate">
              {app.namespace}/{app.deployment}
            </div>
          </div>

          {/* Health Status Badge */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full border ${STATUS_BG[overallStatus]}`}>
            <HealthIcon size={12} className={STATUS_COLORS[overallStatus]} />
            <span className={`text-[10px] font-medium uppercase tracking-wide ${STATUS_COLORS[overallStatus]}`}>
              {overallStatus}
            </span>
          </div>
        </div>

        {/* Metrics Section */}
        {app.isActive ? (
          metricsLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : metrics ? (
            <>
              {/* Resource Gauges Row */}
              <div className="flex justify-around items-center py-3 mb-3 bg-gray-900/30 rounded-lg">
                <MetricsGauge
                  value={metrics.cpu.value}
                  max={metrics.cpu.limit}
                  label="CPU"
                  unit="%"
                  size="sm"
                  theme="cpu"
                  status={metrics.cpu.status}
                />
                <div className="w-px h-12 bg-gray-700/50" />
                <MetricsGauge
                  value={metrics.memory.value}
                  max={metrics.memory.limit}
                  label="Memory"
                  unit="MB"
                  size="sm"
                  theme="memory"
                  status={metrics.memory.status}
                />
                <div className="w-px h-12 bg-gray-700/50" />
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1 text-green-400">
                    <Server size={16} />
                    <span className="text-lg font-bold">{metrics.pods.ready}</span>
                    <span className="text-[10px] text-gray-500">/{metrics.pods.desired}</span>
                  </div>
                  <span className="text-[10px] text-gray-400 font-medium">Pods</span>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <MiniMetric
                  label="Error Rate"
                  value={metrics.errorRate.value}
                  unit="%"
                  status={metrics.errorRate.status}
                  icon={<AlertTriangle size={12} />}
                />
                <MiniMetric
                  label="Requests"
                  value={metrics.requestRate.value}
                  unit="/s"
                  status="healthy"
                  icon={<TrendingUp size={12} />}
                />
                <MiniMetric
                  label="Latency"
                  value={metrics.latency.value}
                  unit="ms"
                  status={metrics.latency.status}
                  icon={<Clock size={12} />}
                />
              </div>

              {/* Prometheus Status */}
              {!metrics.prometheusAvailable && (
                <div className="flex items-center gap-2 px-2 py-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg mb-3">
                  <AlertTriangle size={12} className="text-yellow-400" />
                  <span className="text-[10px] text-yellow-400">Prometheus unavailable - showing cached data</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-4 text-gray-500 text-xs">
              No metrics available
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-gray-500">
            <XCircle size={24} className="mb-2 text-gray-600" />
            <span className="text-xs">Monitoring Inactive</span>
          </div>
        )}

        {/* Incident Alert */}
        {hasIncidents && (
          <div className="flex items-center gap-2 px-2.5 py-2 bg-red-500/10 border border-red-500/30 rounded-lg mb-3">
            <Zap size={14} className="text-red-400" />
            <span className="text-xs text-red-400 font-medium">
              {incidentCount} active incident{incidentCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Quick Actions */}
        <div className="flex items-center gap-2 pt-3 border-t border-gray-700/50">
          <Link
            to={`/incidents?namespace=${app.namespace}`}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <AlertTriangle size={12} />
            Incidents
          </Link>

          {hasGrafana && (
            <a
              href={app.grafanaDashboardUrl!}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <BarChart3 size={12} />
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>

      {/* Selection indicator line */}
      {isSelected && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500" />
      )}
    </div>
  );
}
