/**
 * DeploymentStatus - Display Kubernetes deployment status with live URL
 */
import { memo, useState, useCallback, useEffect } from 'react';
import {
  Rocket,
  CheckCircle,
  XCircle,
  Box,
  Server,
  Activity,
  ExternalLink,
  RefreshCw,
  Heart,
  Globe,
  Tag,
  Clock,
} from 'lucide-react';
import type { DeploymentResult } from '../../types';

interface DeploymentStatusProps {
  deploymentResult: DeploymentResult | null;
  cycleId: string;
  className?: string;
}

export const DeploymentStatus = memo(function DeploymentStatus({
  deploymentResult,
  cycleId,
  className = '',
}: DeploymentStatusProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitialCheck, setIsInitialCheck] = useState(false);
  const [healthCheckResult, setHealthCheckResult] = useState<{
    success: boolean;
    message: string;
    timestamp: Date;
  } | null>(null);
  const [liveStatus, setLiveStatus] = useState<{
    replicas: number;
    availableReplicas: number;
    podStatus: string;
  } | null>(null);

  const handleHealthCheck = useCallback(async () => {
    if (!deploymentResult?.serviceUrl || !cycleId) return;

    setIsRefreshing(true);
    setIsInitialCheck(false);
    try {
      // Use API proxy to avoid CORS issues
      const response = await fetch(`/api/v1/development/${cycleId}/health-check`, {
        method: 'POST',
      });
      const result = await response.json();
      const data = result.data;

      setHealthCheckResult({
        success: data?.success ?? false,
        message: data?.message ?? 'Unknown',
        timestamp: new Date(),
      });

      // Update live status if available from K8s
      if (data?.liveStatus) {
        setLiveStatus(data.liveStatus);
      }
    } catch (error) {
      setHealthCheckResult({
        success: false,
        message: 'Connection failed',
        timestamp: new Date(),
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [deploymentResult?.serviceUrl, cycleId]);

  // Auto-check health when serviceUrl becomes available
  // Add delay and retry logic to allow K8s pod to fully start serving traffic
  useEffect(() => {
    if (deploymentResult?.serviceUrl && cycleId && !healthCheckResult) {
      // Show "Checking..." state during the delay
      setIsInitialCheck(true);

      let retryCount = 0;
      const maxRetries = 3;
      const initialDelay = 5000; // 5 seconds initial delay for GKE
      const retryDelay = 3000;   // 3 seconds between retries

      const checkHealth = async () => {
        try {
          const response = await fetch(`/api/v1/development/${cycleId}/health-check`, {
            method: 'POST',
          });
          const result = await response.json();
          const data = result.data;

          if (data?.success) {
            // Success - update state
            setHealthCheckResult({
              success: true,
              message: data.message ?? 'Healthy',
              timestamp: new Date(),
            });
            if (data.liveStatus) {
              setLiveStatus(data.liveStatus);
            }
            setIsInitialCheck(false);
          } else if (retryCount < maxRetries) {
            // Failed but can retry
            retryCount++;
            setTimeout(checkHealth, retryDelay);
          } else {
            // All retries exhausted
            setHealthCheckResult({
              success: false,
              message: data?.message ?? 'Connection failed',
              timestamp: new Date(),
            });
            setIsInitialCheck(false);
          }
        } catch {
          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(checkHealth, retryDelay);
          } else {
            setHealthCheckResult({
              success: false,
              message: 'Connection failed',
              timestamp: new Date(),
            });
            setIsInitialCheck(false);
          }
        }
      };

      // Start health check after initial delay
      const timer = setTimeout(checkHealth, initialDelay);

      return () => {
        clearTimeout(timer);
        setIsInitialCheck(false);
      };
    }
  }, [deploymentResult?.serviceUrl, cycleId, healthCheckResult]);

  if (!deploymentResult) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Rocket size={18} className="text-gray-400" />
          <h3 className="text-sm font-medium text-gray-300">Deployment Status</h3>
        </div>
        <div className="text-center py-8 text-gray-500">
          <Rocket size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Deployment not started</p>
        </div>
      </div>
    );
  }

  // Use live status if available, otherwise fall back to stored values
  const healthyReplicas = liveStatus?.availableReplicas ?? deploymentResult.availableReplicas;
  const totalReplicas = liveStatus?.replicas ?? deploymentResult.replicas;
  const healthPercentage = totalReplicas > 0 ? (healthyReplicas / totalReplicas) * 100 : 0;
  // Consider healthy if: live status shows all replicas ready, OR health check passed
  const isHealthy = liveStatus
    ? liveStatus.availableReplicas === liveStatus.replicas
    : healthCheckResult?.success ?? (healthyReplicas === totalReplicas && deploymentResult.success);

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket size={18} className={isHealthy ? 'text-green-400' : 'text-yellow-400'} />
          <h3 className="text-sm font-medium text-gray-300">Deployment Status</h3>
        </div>
        <span
          className={`px-2 py-0.5 text-xs rounded flex items-center gap-1 ${
            isHealthy
              ? 'bg-green-500/10 text-green-400'
              : 'bg-red-500/10 text-red-400'
          }`}
        >
          {isHealthy ? (
            <>
              <CheckCircle size={12} /> DEPLOYED
            </>
          ) : (
            <>
              <XCircle size={12} /> {liveStatus || healthCheckResult ? 'UNHEALTHY' : 'PENDING'}
            </>
          )}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Live URL - Most Important! */}
        {deploymentResult.serviceUrl && (
          <div className="p-4 bg-green-500/5 border border-green-500/30 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Globe size={16} className="text-green-400" />
                <span className="text-xs font-medium text-green-400 uppercase tracking-wide">
                  Live Application URL
                </span>
              </div>
              <button
                onClick={handleHealthCheck}
                disabled={isRefreshing}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                Check Health
              </button>
            </div>
            <a
              href={deploymentResult.serviceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-lg font-medium text-white hover:text-green-400 transition-colors group"
            >
              <code className="text-green-300">{deploymentResult.serviceUrl}</code>
              <ExternalLink size={16} className="text-gray-400 group-hover:text-green-400" />
            </a>
            {(healthCheckResult || isInitialCheck || isRefreshing) && (
              <div className={`mt-2 flex items-center gap-2 text-xs ${
                isInitialCheck || isRefreshing
                  ? 'text-yellow-400'
                  : healthCheckResult?.success
                    ? 'text-green-400'
                    : 'text-red-400'
              }`}>
                {isInitialCheck || isRefreshing ? (
                  <RefreshCw size={12} className="animate-spin" />
                ) : healthCheckResult?.success ? (
                  <CheckCircle size={12} />
                ) : (
                  <XCircle size={12} />
                )}
                <span>
                  {isInitialCheck || isRefreshing
                    ? 'Checking health...'
                    : healthCheckResult?.message}
                </span>
                {healthCheckResult && !isInitialCheck && !isRefreshing && (
                  <span className="text-gray-500">
                    ({healthCheckResult.timestamp.toLocaleTimeString()})
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Deployment Health Check from Backend */}
        {deploymentResult.healthCheck && (
          <div className={`p-3 rounded-lg ${
            deploymentResult.healthCheck.passed
              ? 'bg-green-500/10 border border-green-500/30'
              : 'bg-red-500/10 border border-red-500/30'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <Heart size={14} className={deploymentResult.healthCheck.passed ? 'text-green-400' : 'text-red-400'} />
              <span className="text-xs font-medium text-gray-300">Health Check</span>
            </div>
            <div className="flex items-center justify-between">
              <code className="text-xs text-gray-400">{deploymentResult.healthCheck.endpoint}</code>
              <span className={`text-xs ${deploymentResult.healthCheck.passed ? 'text-green-400' : 'text-red-400'}`}>
                {deploymentResult.healthCheck.passed ? 'PASSED' : 'FAILED'}
              </span>
            </div>
            {deploymentResult.healthCheck.response && (
              <code className="block mt-1 text-xs text-gray-500 truncate">
                {deploymentResult.healthCheck.response}
              </code>
            )}
          </div>
        )}

        {/* Deployment Info - Single Column Layout */}
        <div className="space-y-3">
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <Server size={14} />
              <span className="text-xs">Namespace</span>
            </div>
            <code className="text-sm text-purple-400">{deploymentResult.namespace}</code>
          </div>
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <Box size={14} />
              <span className="text-xs">Deployment</span>
            </div>
            <code className="text-sm text-blue-400 break-all">
              {deploymentResult.deploymentName || deploymentResult.deployment || 'N/A'}
            </code>
          </div>
          {deploymentResult.serviceName && (
            <div className="p-3 bg-gray-900/50 rounded-lg">
              <div className="flex items-center gap-2 text-gray-400 mb-1">
                <Globe size={14} />
                <span className="text-xs">Service</span>
              </div>
              <code className="text-sm text-orange-400 break-all">{deploymentResult.serviceName}</code>
              {deploymentResult.servicePort && (
                <span className="text-xs text-gray-500 ml-2">:{deploymentResult.servicePort}</span>
              )}
            </div>
          )}
        </div>

        {/* Image Tag (if available) */}
        {deploymentResult.imageTag && (
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <Tag size={14} />
              <span className="text-xs">Image Tag</span>
            </div>
            <code className="text-sm text-cyan-400 break-all">{deploymentResult.imageTag}</code>
          </div>
        )}

        {/* Replicas Status */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-gray-400">
              <Activity size={14} />
              <span className="text-xs">Replicas Health</span>
            </div>
            <span className={`text-sm font-medium ${isHealthy ? 'text-green-400' : 'text-yellow-400'}`}>
              {healthyReplicas} / {totalReplicas}
            </span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                isHealthy ? 'bg-green-500' : 'bg-yellow-500'
              }`}
              style={{ width: `${healthPercentage}%` }}
            />
          </div>
        </div>

        {/* Replica Dots */}
        <div className="flex items-center gap-2">
          {Array.from({ length: totalReplicas }).map((_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full ${
                i < healthyReplicas
                  ? 'bg-green-500'
                  : 'bg-gray-600'
              }`}
              title={i < healthyReplicas ? 'Healthy' : 'Pending'}
            />
          ))}
        </div>

        {/* Pod Status */}
        {deploymentResult.podStatus && (
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <Box size={14} />
              <span className="text-xs">Pod Status</span>
            </div>
            <span className={`text-sm ${
              deploymentResult.podStatus === 'Running' ? 'text-green-400' :
              deploymentResult.podStatus === 'Pending' ? 'text-yellow-400' :
              'text-red-400'
            }`}>
              {deploymentResult.podStatus}
            </span>
          </div>
        )}

        {/* Deployed At */}
        {deploymentResult.deployedAt && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock size={12} />
            Deployed: {new Date(deploymentResult.deployedAt).toLocaleString()}
          </div>
        )}

        {/* Deployment Logs */}
        {(deploymentResult.logs ?? []).length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-400 mb-2">Deployment Logs</h4>
            <div className="p-3 bg-gray-900/50 rounded text-xs font-mono text-gray-400 max-h-32 overflow-y-auto">
              {(deploymentResult.logs ?? []).map((log, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
