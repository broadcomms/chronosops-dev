/**
 * CreateIncidentModal - Modal for creating new incidents
 */
import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, AlertTriangle } from 'lucide-react';
import { incidentsApi } from '../../api/incidents';
import { useActiveMonitoredApps } from '../../hooks';
import type { IncidentSeverity, CreateIncidentRequest } from '../../types';

interface CreateIncidentModalProps {
  isOpen: boolean;
  onClose: () => void;
  autoInvestigate?: boolean;
}

const severityOptions: { value: IncidentSeverity; label: string; description: string }[] = [
  { value: 'critical', label: 'Critical', description: 'Service down, data loss risk' },
  { value: 'high', label: 'High', description: 'Major feature impacted' },
  { value: 'medium', label: 'Medium', description: 'Degraded performance' },
  { value: 'low', label: 'Low', description: 'Minor issue, workaround exists' },
];

export function CreateIncidentModal({
  isOpen,
  onClose,
  autoInvestigate = true,
}: CreateIncidentModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('high');
  const [selectedAppId, setSelectedAppId] = useState('');
  const [startInvestigation, setStartInvestigation] = useState(autoInvestigate);

  // Get monitored apps for dropdown
  const { data: monitoredAppsData, isLoading: appsLoading, error: appsError } = useActiveMonitoredApps();
  // Ensure monitoredApps is always an array (defensive coding)
  const monitoredApps = Array.isArray(monitoredAppsData) ? monitoredAppsData : [];

  // Debug log to help diagnose issues
  console.log('[CreateIncidentModal] Monitored apps:', {
    data: monitoredAppsData,
    isLoading: appsLoading,
    error: appsError,
    count: monitoredApps.length
  });

  // Get selected app details
  const selectedApp = monitoredApps.find((app) => app.id === selectedAppId);
  const namespace = selectedApp?.namespace || '';

  // Auto-select first app when apps load
  useEffect(() => {
    if (monitoredApps.length > 0 && !selectedAppId) {
      setSelectedAppId(monitoredApps[0].id);
    }
  }, [monitoredApps, selectedAppId]);

  // Create incident mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateIncidentRequest) => incidentsApi.create(data),
    onSuccess: async (response) => {
      const incident = response.data;
      toast.success('Incident created successfully');

      // Start investigation if requested
      if (startInvestigation) {
        try {
          await incidentsApi.investigate(incident.id);
          toast.success('Investigation started');
        } catch (err) {
          console.error('Investigation start error:', err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          toast.error(`Failed to start investigation: ${errorMessage}`);
        }
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['incidents'] });

      // Navigate to incident
      navigate(`/incidents/${incident.id}`);
      onClose();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create incident');
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!title.trim()) {
        toast.error('Title is required');
        return;
      }

      if (!selectedAppId || !namespace) {
        toast.error('Please select an application');
        return;
      }

      createMutation.mutate({
        title: title.trim(),
        description: description.trim() || undefined,
        severity,
        namespace,
        monitoredAppId: selectedAppId || undefined,
      });
    },
    [title, description, severity, namespace, selectedAppId, createMutation]
  );

  const handleClose = useCallback(() => {
    if (!createMutation.isPending) {
      setTitle('');
      setDescription('');
      setSeverity('high');
      setSelectedAppId('');
      onClose();
    }
  }, [createMutation.isPending, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Report Incident</h2>
          <button
            onClick={handleClose}
            disabled={createMutation.isPending}
            className="text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., payment-service CPU spike"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
                disabled={createMutation.isPending}
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional details about the incident..."
                rows={3}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition resize-none"
                disabled={createMutation.isPending}
              />
            </div>

            {/* Severity */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Severity <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {severityOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSeverity(option.value)}
                    disabled={createMutation.isPending}
                    className={`p-3 rounded-lg border text-left transition ${
                      severity === option.value
                        ? option.value === 'critical'
                          ? 'bg-red-500/20 border-red-500 text-red-400'
                          : option.value === 'high'
                          ? 'bg-orange-500/20 border-orange-500 text-orange-400'
                          : option.value === 'medium'
                          ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
                          : 'bg-blue-500/20 border-blue-500 text-blue-400'
                        : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    <div className="font-medium text-sm">{option.label}</div>
                    <div className="text-xs opacity-70">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Application Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Application <span className="text-red-400">*</span>
              </label>
              {appsLoading ? (
                <div className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-500">
                  Loading applications...
                </div>
              ) : appsError ? (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-400">Failed to load applications</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {appsError instanceof Error ? appsError.message : 'Unknown error'}
                  </p>
                </div>
              ) : monitoredApps.length === 0 ? (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-sm text-yellow-400">No monitored applications configured</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Go to Setup to select applications to monitor
                  </p>
                </div>
              ) : (
                <select
                  value={selectedAppId}
                  onChange={(e) => setSelectedAppId(e.target.value)}
                  disabled={createMutation.isPending}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
                >
                  <option value="">Select an application...</option>
                  {monitoredApps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.deployment} ({app.namespace})
                    </option>
                  ))}
                </select>
              )}
              {selectedApp && (
                <p className="text-xs text-gray-500 mt-1">
                  Namespace: {selectedApp.namespace}
                </p>
              )}
            </div>

            {/* Auto-investigate toggle */}
            <div className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg">
              <input
                type="checkbox"
                id="startInvestigation"
                checked={startInvestigation}
                onChange={(e) => setStartInvestigation(e.target.checked)}
                disabled={createMutation.isPending}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
              />
              <label htmlFor="startInvestigation" className="flex-1">
                <div className="text-sm font-medium text-gray-300">
                  Start AI investigation immediately
                </div>
                <div className="text-xs text-gray-500">
                  The OODA loop will begin automatically
                </div>
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-700">
            <button
              type="button"
              onClick={handleClose}
              disabled={createMutation.isPending}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !title.trim() || !selectedAppId}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {createMutation.isPending ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <AlertTriangle size={16} />
                  Create Incident
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
