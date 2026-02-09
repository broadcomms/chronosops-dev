/**
 * Monitored Apps Grid - Enhanced Version
 * Shows all monitored apps with real-time metrics and beautiful visualizations
 */
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle,
  AlertCircle,
  Server,
  ExternalLink,
  LayoutGrid,
  List,
} from 'lucide-react';
import { useState } from 'react';
import { useActiveMonitoredApps } from '../../hooks';
import { incidentsApi } from '../../api/incidents';
import { Link } from 'react-router-dom';
import { config } from '../../config/env';
import { AppMetricsCard } from './AppMetricsCard';

interface MonitoredAppsGridProps {
  /** Callback when an app is selected */
  onSelectApp?: (serviceName: string, namespace: string) => void;
  /** Currently selected service name */
  selectedService?: string | null;
}

export function MonitoredAppsGrid({ onSelectApp, selectedService }: MonitoredAppsGridProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Fetch active monitored apps using shared hook to avoid cache key conflicts
  const { data: apps = [], isLoading: appsLoading } = useActiveMonitoredApps({
    refetchInterval: config.polling.incidentRefresh,
  });

  // Fetch incidents to count active ones per namespace
  const { data: incidentsData } = useQuery({
    queryKey: ['incidents', 'active'],
    queryFn: () => incidentsApi.list({ status: 'active' }),
    refetchInterval: config.polling.incidentRefresh,
  });

  const incidents = incidentsData?.data || [];

  // Count incidents per namespace
  const incidentCountByNamespace = incidents.reduce((acc, incident) => {
    acc[incident.namespace] = (acc[incident.namespace] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (appsLoading) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-8 text-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 bg-gray-700 rounded-full mb-4" />
          <div className="h-4 w-40 bg-gray-700 rounded mb-2" />
          <div className="h-3 w-32 bg-gray-700/50 rounded" />
        </div>
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 border border-gray-700 rounded-xl p-10 text-center">
        <div className="relative inline-block mb-4">
          <Server size={48} className="text-gray-600" />
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full animate-pulse" />
        </div>
        <h3 className="text-gray-200 font-semibold text-lg mb-2">No Monitored Apps</h3>
        <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
          Applications will appear here automatically when deployed via Development Cycles.
          Start by creating a new development cycle to generate and deploy an app.
        </p>
        <Link
          to="/development"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
        >
          Go to Development Dashboard
          <ExternalLink size={16} />
        </Link>
      </div>
    );
  }

  const activeCount = apps.filter(a => a.isActive).length;
  const totalIncidents = incidents.length;

  return (
    <div>
      {/* Summary Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          {/* Active Apps Count */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-full">
            <CheckCircle size={14} className="text-green-400" />
            <span className="text-sm font-medium text-green-400">
              {activeCount} active
            </span>
          </div>

          {/* Incidents Count */}
          {totalIncidents > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 border border-orange-500/30 rounded-full">
              <AlertCircle size={14} className="text-orange-400" />
              <span className="text-sm font-medium text-orange-400">
                {totalIncidents} incident{totalIncidents !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>

          <Link
            to="/setup"
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Manage Apps
          </Link>
        </div>
      </div>

      {/* App Cards Grid */}
      <div className={
        viewMode === 'grid'
          ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'
          : 'flex flex-col gap-2'
      }>
        {apps.map(app => (
          <AppMetricsCard
            key={app.id}
            app={app}
            incidentCount={incidentCountByNamespace[app.namespace] || 0}
            isSelected={selectedService === app.deployment}
            onClick={onSelectApp}
            compact={viewMode === 'list'}
          />
        ))}
      </div>
    </div>
  );
}
