/**
 * ServiceSelector - App switcher for monitoring dashboard
 * Allows switching between monitored apps in Command Center
 */
import { Server, CheckCircle, AlertCircle } from 'lucide-react';

interface MonitoredApp {
  id: string;
  namespace: string;
  deployment: string;
  displayName: string;
  isActive: boolean;
}

interface ServiceSelectorProps {
  apps: MonitoredApp[];
  selectedService: string | null;
  onSelectService: (serviceName: string, namespace: string) => void;
  isLoading?: boolean;
  className?: string;
}

export function ServiceSelector({
  apps,
  selectedService,
  onSelectService,
  isLoading,
  className = '',
}: ServiceSelectorProps) {
  if (isLoading) {
    return (
      <div className={`flex gap-2 ${className}`}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="px-4 py-2 bg-gray-700/50 rounded-lg animate-pulse w-32 h-9"
          />
        ))}
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className={`flex items-center gap-2 text-gray-500 text-sm ${className}`}>
        <Server size={16} />
        <span>No monitored apps available</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <span className="text-xs text-gray-500 mr-1">Monitoring:</span>
      {apps.map((app) => {
        const isSelected = selectedService === app.deployment;
        return (
          <button
            key={app.id}
            onClick={() => onSelectService(app.deployment, app.namespace)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              isSelected
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <span className="truncate max-w-[120px]">{app.displayName}</span>
            {app.isActive ? (
              <CheckCircle size={12} className={isSelected ? 'text-green-300' : 'text-green-400'} />
            ) : (
              <AlertCircle size={12} className="text-yellow-400" />
            )}
          </button>
        );
      })}
    </div>
  );
}
