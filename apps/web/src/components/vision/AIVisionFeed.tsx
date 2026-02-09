/**
 * AIVisionFeed - Unified Vision Stream component
 *
 * Displays the MJPEG stream from the server-side rendered dashboard.
 * The stream shows exactly what Gemini Vision sees - providing
 * complete transparency into AI decision-making.
 *
 * Features:
 * - Native MJPEG streaming (no polling)
 * - Recording controls
 * - Connection status handling
 * - AI annotation overlay indicators
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { VideoOff, Circle, ScanEye, Square } from 'lucide-react';

interface AIVisionFeedProps {
  /** Service name to monitor */
  serviceName: string;
  /** Kubernetes namespace (required for starting monitoring) */
  namespace?: string;
  /** API server URL */
  serverUrl?: string;
  /** Optional incident ID for recording association */
  incidentId?: string;
  /** Show recording controls */
  showRecordingControls?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Callback when recording starts */
  onRecordingStart?: (recordingId: string) => void;
  /** Callback when recording stops */
  onRecordingStop?: (outputPath?: string) => void;
}

export function AIVisionFeed({
  serviceName,
  namespace = 'development',
  serverUrl = '',
  incidentId,
  showRecordingControls = true,
  className = '',
  onRecordingStart,
  onRecordingStop,
}: AIVisionFeedProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [_recordingId, setRecordingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monitoringReady, setMonitoringReady] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const maxReconnectDelay = 30000; // 30s max backoff

  // Construct the stream URL with namespace to avoid race condition
  // The namespace is needed in case the stream GET request arrives before the POST /monitoring/start completes
  const streamUrl = `${serverUrl}/api/v1/vision/stream/${encodeURIComponent(serviceName)}?namespace=${encodeURIComponent(namespace)}`;

  // Handle image load (stream connected)
  // Note: For MJPEG streams, onload fires once when the first frame arrives
  const handleLoad = useCallback(() => {
    setIsConnected(true);
    setIsLoading(false);
    setError(null);
    reconnectAttemptRef.current = 0; // Reset backoff on successful connection
  }, []);

  // Handle image error (stream disconnected or failed) — auto-reconnect with backoff
  const handleError = useCallback(() => {
    setIsConnected(false);
    setError('Vision stream disconnected');

    // Auto-reconnect with exponential backoff (2s, 4s, 8s, ... up to 30s)
    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(2000 * Math.pow(2, attempt), maxReconnectDelay);
    reconnectAttemptRef.current = attempt + 1;

    reconnectTimerRef.current = setTimeout(() => {
      if (imgRef.current) {
        setIsLoading(true);
        setError(null);
        imgRef.current.src = `${streamUrl}&t=${Date.now()}`;
      }
    }, delay);
  }, [streamUrl]);

  // Cleanup reconnect timer on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []);

  // Start monitoring when component mounts
  useEffect(() => {
    const startMonitoring = async () => {
      try {
        const response = await fetch(`${serverUrl}/api/v1/vision/monitoring/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceName, namespace }),
        });
        if (response.ok) {
          // Only set ready after POST completes successfully
          setMonitoringReady(true);
        } else {
          const data = await response.json();
          console.warn('Failed to start monitoring:', data.error);
          // Still try to connect - the monitoring might already be active
          // This handles the case where another client already started monitoring
          setMonitoringReady(true);
        }
      } catch (err) {
        console.warn('Failed to start monitoring:', err);
        // Still try to connect - might work if monitoring is already active
        setMonitoringReady(true);
      }
    };

    startMonitoring();

    // Cleanup on unmount
    return () => {
      // Stop monitoring when component unmounts (optional)
      // We might want to keep monitoring active for other clients
    };
  }, [serverUrl, serviceName, namespace]);

  // Start recording
  const handleStartRecording = async () => {
    try {
      const response = await fetch(`${serverUrl}/api/v1/vision/recording/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName, incidentId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start recording');
      }

      const data = await response.json();
      setIsRecording(true);
      setRecordingId(data.recordingId);
      onRecordingStart?.(data.recordingId);
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError(err instanceof Error ? err.message : 'Failed to start recording');
    }
  };

  // Stop recording
  const handleStopRecording = async () => {
    try {
      const response = await fetch(`${serverUrl}/api/v1/vision/recording/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to stop recording');
      }

      const data = await response.json();
      setIsRecording(false);
      setRecordingId(null);
      onRecordingStop?.(data.outputPath);
    } catch (err) {
      console.error('Failed to stop recording:', err);
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
    }
  };

  // Disconnected state
  if (!isConnected && !isLoading) {
    return (
      <div className={`bg-gray-800 rounded-lg flex items-center justify-center ${className}`}>
        <div className="text-center p-8">
          <VideoOff size={56} className="mx-auto mb-4 text-gray-500 opacity-50" />
          <p className="text-gray-400 font-medium">Vision stream unavailable</p>
          <p className="text-gray-500 text-sm mt-2">
            Unable to connect to {serviceName} vision stream
          </p>
          {error && (
            <p className="text-red-400/70 text-xs mt-3 max-w-xs">{error}</p>
          )}
          <button
            onClick={() => {
              setIsLoading(true);
              setError(null);
              // Force re-fetch by updating the img src
              if (imgRef.current) {
                imgRef.current.src = `${streamUrl}&t=${Date.now()}`;
              }
            }}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={`bg-gray-800 rounded-lg flex items-center justify-center ${className}`}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">
            {monitoringReady ? 'Connecting to vision stream...' : 'Starting monitoring...'}
          </p>
          <p className="text-gray-500 text-xs mt-1">{serviceName}</p>
        </div>
        {/* Hidden img to initiate connection - only render after monitoring is ready */}
        {monitoringReady && (
          <img
            ref={imgRef}
            src={streamUrl}
            alt=""
            className="hidden"
            onLoad={handleLoad}
            onError={handleError}
          />
        )}
      </div>
    );
  }

  // Connected and streaming
  return (
    <div className={`relative rounded-lg overflow-hidden bg-gray-900 ${className}`}>
      {/* MJPEG Stream - browsers handle this natively! */}
      <img
        ref={imgRef}
        src={streamUrl}
        alt={`Live vision feed for ${serviceName}`}
        className="w-full h-auto object-contain"
        onLoad={handleLoad}
        onError={handleError}
      />

      {/* Status indicators - top left */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        {/* Live indicator */}
        <div className="flex items-center gap-2 bg-black/60 px-2 py-1 rounded">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-xs text-white font-medium">LIVE</span>
        </div>

        {/* AI Vision badge - this is what makes it special */}
        <div className="flex items-center gap-1.5 bg-gradient-to-r from-blue-600/80 to-purple-600/80 px-2 py-1 rounded">
          <ScanEye size={14} className="text-white" />
          <span className="text-xs text-white font-medium">AI Vision</span>
        </div>

        {/* Recording indicator */}
        {isRecording && (
          <div className="flex items-center gap-1.5 bg-red-600/80 px-2 py-1 rounded animate-pulse">
            <Circle size={10} className="text-white fill-white" />
            <span className="text-xs text-white font-medium">REC</span>
          </div>
        )}
      </div>

      {/* Recording controls - top right */}
      {showRecordingControls && (
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {isRecording ? (
            <button
              onClick={handleStopRecording}
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded text-white text-xs font-medium transition-colors"
              title="Stop recording"
            >
              <Square size={12} />
              Stop
            </button>
          ) : (
            <button
              onClick={handleStartRecording}
              className="flex items-center gap-1.5 bg-gray-700/80 hover:bg-gray-600/80 px-3 py-1.5 rounded text-white text-xs font-medium transition-colors"
              title="Start recording"
            >
              <Circle size={12} className="text-red-400" />
              Record
            </button>
          )}
        </div>
      )}

    </div>
  );
}

export default AIVisionFeed;
