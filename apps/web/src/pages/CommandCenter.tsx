/**
 * Command Center - Main monitoring dashboard
 * The hero page for ChronosOps - shows live dashboard feed with AI activity
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, AlertTriangle, Server } from 'lucide-react';
import { PageLayout, Section, Grid } from '../components/layout/PageLayout';
import {
  SystemHealthCard,
  AIActivityFeed,
  ActiveIncidentBanner,
  MonitoredAppsGrid,
} from '../components/command-center';
import { AIVisionFeed, ServiceSelector } from '../components/vision';
import { incidentsApi } from '../api/incidents';
import { useActiveMonitoredApps } from '../hooks';
import { config } from '../config/env';

// Live clock component
function LiveClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-start gap-2 text-gray-400">
      <Clock size={20} className="text-blue-400 mt-1" />
      <div className="text-right">
        <div className="text-xl font-mono font-bold text-white">
          {time.toLocaleTimeString('en-US', { hour12: false })}
        </div>
        <div className="text-xs text-gray-500">
          {time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </div>
      </div>
    </div>
  );
}

interface CommandCenterProps {
  onCreateIncident?: () => void;
}

export function CommandCenter({ onCreateIncident }: CommandCenterProps) {
  // State for selected service monitoring
  const [selectedService, setSelectedService] = useState<{ name: string; namespace: string } | null>(null);

  // Fetch active monitored apps for service selection
  // Use the shared hook to avoid cache key conflicts with CreateIncidentModal
  const { data: apps = [], isLoading: appsLoading } = useActiveMonitoredApps({
    refetchInterval: config.polling.incidentRefresh,
  });

  // Fetch recent incidents for quick access
  const { data: incidentsData } = useQuery({
    queryKey: ['incidents', 'recent'],
    queryFn: () => incidentsApi.list({ limit: 5 }),
    refetchInterval: config.polling.incidentRefresh,
  });

  const recentIncidents = incidentsData?.data || [];

  // Auto-select first app if none selected
  useEffect(() => {
    if (!selectedService && apps.length > 0) {
      setSelectedService({
        name: apps[0].deployment,
        namespace: apps[0].namespace,
      });
    }
  }, [apps, selectedService]);

  // Handle service selection
  const handleSelectService = useCallback((serviceName: string, namespace: string) => {
    setSelectedService({ name: serviceName, namespace });
  }, []);

  return (
    <PageLayout>
      {/* Active Incident Banner - Shows at top when incident is active */}
      <ActiveIncidentBanner className="mb-6" />

      {/* Main Dashboard Grid */}
      <Section
        title="Command Center"
        description="Real-time monitoring and autonomous incident response"
        rightElement={<LiveClock />}
      >
        {/* Service Selector */}
        <div className="mb-4">
          <ServiceSelector
            apps={apps}
            selectedService={selectedService?.name ?? null}
            onSelectService={handleSelectService}
            isLoading={appsLoading}
          />
        </div>

        <Grid cols={3}>
          {/* AI Vision Feed - Takes 2 columns */}
          <div className="col-span-2">
            {selectedService ? (
              <AIVisionFeed
                serviceName={selectedService.name}
                namespace={selectedService.namespace}
                serverUrl={config.apiUrl}
                showRecordingControls={true}
                className="min-h-[400px]"
              />
            ) : (
              <div className="min-h-[400px] bg-gray-800/50 border border-gray-700 rounded-lg flex flex-col items-center justify-center">
                <Server size={48} className="text-gray-600 mb-4" />
                <h3 className="text-lg font-medium text-gray-300 mb-2">No Applications to Monitor</h3>
                <p className="text-sm text-gray-500 text-center max-w-md mb-4">
                  Deploy an application via the Development Dashboard to start monitoring.
                  Apps are automatically registered for monitoring after deployment.
                </p>
                <Link
                  to="/development"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Go to Development Dashboard
                </Link>
              </div>
            )}

            {/* Quick actions below video */}
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={onCreateIncident}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                <AlertTriangle size={16} />
                Report Incident
              </button>
              <Link
                to="/incidents"
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                View All Incidents
              </Link>
              <Link
                to="/setup"
                className="px-4 py-2 border border-gray-600 hover:border-gray-500 text-gray-300 rounded-lg text-sm transition-colors"
              >
                Setup
              </Link>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-4">
            <AIActivityFeed maxItems={8} />
            <SystemHealthCard />
          </div>
        </Grid>
      </Section>

      {/* Monitored Apps Grid - Multi-app view for self-regenerating ecosystem */}
      <Section
        title="Monitored Applications"
        description="Self-regenerating apps with autonomous monitoring and incident response - click to select"
      >
        <MonitoredAppsGrid
          onSelectApp={handleSelectService}
          selectedService={selectedService?.name ?? null}
        />
      </Section>

      {/* Recent Incidents */}
      {recentIncidents.length > 0 && (
        <Section title="Recent Incidents">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">
                    Title
                  </th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">
                    Severity
                  </th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">
                    State
                  </th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">
                    Namespace
                  </th>
                  <th className="text-right text-xs font-medium text-gray-400 px-4 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {recentIncidents.map((incident) => (
                  <tr
                    key={incident.id}
                    className="hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/incidents/${incident.id}`}
                        className="text-sm text-gray-200 hover:text-white"
                      >
                        {incident.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={incident.severity} />
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={incident.state} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {incident.namespace}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/incidents/${incident.id}`}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Demo Mode Indicator */}
      {config.features.demoMode && (
        <div className="fixed bottom-4 left-4 bg-purple-500/20 border border-purple-500/50 text-purple-400 px-3 py-1.5 rounded-lg text-xs font-medium">
          Demo Mode Active
        </div>
      )}

    </PageLayout>
  );
}

// Helper components
function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: 'bg-red-500/10 text-red-400 border-red-500/30',
    high: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
    medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    low: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  };

  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs rounded border ${styles[severity] || styles.low}`}
    >
      {severity.toUpperCase()}
    </span>
  );
}

function StateBadge({ state }: { state: string }) {
  const styles: Record<string, string> = {
    IDLE: 'text-gray-400',
    OBSERVING: 'text-observe',
    ORIENTING: 'text-orient',
    DECIDING: 'text-decide',
    ACTING: 'text-act',
    VERIFYING: 'text-blue-400',
    DONE: 'text-green-400',
    FAILED: 'text-red-400',
  };

  return (
    <span className={`text-xs font-medium ${styles[state] || 'text-gray-400'}`}>
      {state}
    </span>
  );
}
