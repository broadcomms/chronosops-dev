/**
 * VideoPlayer - Video player with playback controls and frame navigation
 * Shows live feed during active investigations, cached frames for review
 */
import { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  ScanEye,
  Video,
  Play,
  Pause,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { config } from '../../config/env';
import { monitoredAppsApi, type MonitoredApp } from '../../api/monitored-apps';
import type { FrameData, FrameAnnotation } from '../../types';

interface VideoPlayerProps {
  incidentId: string;
  monitoredAppId?: string | null;
  className?: string;
  annotations?: FrameAnnotation[];
  onFrameChange?: (frameNumber: number) => void;
}

const MAX_CACHE_SIZE = 50;

export const VideoPlayer = memo(function VideoPlayer({
  incidentId,
  monitoredAppId,
  className = '',
  annotations = [],
  onFrameChange,
}: VideoPlayerProps) {
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [liveFrame, setLiveFrame] = useState<FrameData | null>(null);
  
  // MJPEG stream state
  const [monitoredApp, setMonitoredApp] = useState<MonitoredApp | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const streamReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamReconnectAttemptRef = useRef(0);

  const frameCache = useRef<Map<number, FrameData>>(new Map());
  const playIntervalRef = useRef<number | null>(null);
  const liveIntervalRef = useRef<number | null>(null);
  const frameNumberRef = useRef(0);

  // Construct the MJPEG stream URL for monitored app (include namespace to avoid race condition)
  const streamUrl = monitoredApp
    ? `${config.apiUrl}/api/v1/vision/stream/${encodeURIComponent(monitoredApp.deployment)}?namespace=${encodeURIComponent(monitoredApp.namespace)}`
    : null;

  // Fetch monitored app details when monitoredAppId is provided
  useEffect(() => {
    if (!monitoredAppId) {
      setMonitoredApp(null);
      return;
    }

    const fetchMonitoredApp = async () => {
      try {
        const response = await monitoredAppsApi.getById(monitoredAppId);
        if (response.success && response.data) {
          setMonitoredApp(response.data);
          setIsLiveMode(true);
          setIsLoading(false);
        }
      } catch (err) {
        console.warn('Failed to fetch monitored app:', err);
        // Fall back to legacy behavior
        setMonitoredApp(null);
      }
    };

    fetchMonitoredApp();
  }, [monitoredAppId]);

  // Fetch live frame from screen capture service (legacy fallback)
  const fetchLiveFrame = useCallback(async () => {
    // Skip if we have a monitored app with MJPEG stream
    if (monitoredApp) return;
    
    try {
      const response = await fetch(`${config.screenCaptureUrl}/frame/latest`);
      if (!response.ok) return;

      const data = await response.json();
      if (data.base64 || data.image || data.imageData) {
        const frame: FrameData = {
          imageData: data.base64 || data.image || data.imageData,
          timestamp: new Date(data.timestamp || Date.now()),
          frameNumber: data.frameNumber || data.id || ++frameNumberRef.current,
        };
        setLiveFrame(frame);
        setError(null);
      }
    } catch {
      // Silent fail for live frames - we'll show cached or error state
    }
  }, [monitoredApp]);

  // Fetch stored frames for the incident (for playback/review)
  const fetchFrames = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `${config.apiUrl}/api/v1/incidents/${incidentId}/frames`
      );

      if (!response.ok) {
        // Endpoint doesn't exist or no frames - switch to live mode
        setIsLiveMode(true);
        setIsLoading(false);
        return;
      }

      const data = await response.json();
      const frameList: FrameData[] = (data.frames || []).map(
        (f: { image: string; timestamp: string; frameNumber: number }, idx: number) => ({
          imageData: f.image,
          timestamp: new Date(f.timestamp),
          frameNumber: f.frameNumber || idx,
        })
      );

      if (frameList.length === 0) {
        // No stored frames - switch to live mode
        setIsLiveMode(true);
      } else {
        setFrames(frameList);
        setIsLiveMode(false);

        // Cache frames
        frameList.forEach((frame) => {
          if (frameCache.current.size < MAX_CACHE_SIZE) {
            frameCache.current.set(frame.frameNumber, frame);
          }
        });
      }
    } catch {
      // Switch to live mode on error
      setIsLiveMode(true);
    } finally {
      setIsLoading(false);
    }
  }, [incidentId]);

  // Initial fetch
  useEffect(() => {
    fetchFrames();
  }, [fetchFrames]);

  // Live mode polling
  useEffect(() => {
    if (isLiveMode) {
      // Fetch initial frame immediately
      fetchLiveFrame();
      // Poll every 2 seconds
      liveIntervalRef.current = window.setInterval(fetchLiveFrame, 2000);
    }

    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    };
  }, [isLiveMode, fetchLiveFrame]);

  // Cleanup stream reconnect timer on unmount
  useEffect(() => {
    return () => {
      if (streamReconnectTimerRef.current) {
        clearTimeout(streamReconnectTimerRef.current);
        streamReconnectTimerRef.current = null;
      }
    };
  }, []);

  // Notify parent of frame changes
  useEffect(() => {
    if (frames[currentFrameIndex] && onFrameChange) {
      onFrameChange(frames[currentFrameIndex].frameNumber);
    }
  }, [currentFrameIndex, frames, onFrameChange]);

  // Playback control
  useEffect(() => {
    if (isPlaying && frames.length > 0) {
      playIntervalRef.current = window.setInterval(() => {
        setCurrentFrameIndex((prev) => {
          const next = prev + 1;
          if (next >= frames.length) {
            setIsPlaying(false);
            return prev;
          }
          return next;
        });
      }, 1000 / playbackSpeed);
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, frames.length, playbackSpeed]);

  const handlePlayPause = () => {
    if (currentFrameIndex >= frames.length - 1) {
      setCurrentFrameIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handlePrevFrame = () => {
    setIsPlaying(false);
    setCurrentFrameIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextFrame = () => {
    setIsPlaying(false);
    setCurrentFrameIndex((prev) => Math.min(frames.length - 1, prev + 1));
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false);
    setCurrentFrameIndex(Number(e.target.value));
  };

  const currentFrame = frames[currentFrameIndex];

  if (isLoading) {
    return (
      <div className={`bg-gray-900 rounded-lg flex items-center justify-center ${className}`}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading video frames...</p>
        </div>
      </div>
    );
  }

  // Live mode - show live feed from MJPEG stream or screen capture
  if (isLiveMode) {
    // If we have a monitored app, use MJPEG stream
    if (monitoredApp && streamUrl) {
      return (
        <div className={`bg-gray-900 rounded-lg overflow-hidden ${className}`}>
          <div className="relative aspect-video bg-black">
            {!streamConnected && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">Connecting to live feed...</p>
                </div>
              </div>
            )}
            <img
              ref={imgRef}
              src={streamUrl}
              alt={`Live feed from ${monitoredApp.displayName || monitoredApp.deployment}`}
              className={`w-full h-full object-contain ${streamConnected ? '' : 'opacity-0'}`}
              onLoad={() => {
                setStreamConnected(true);
                setError(null);
                streamReconnectAttemptRef.current = 0;
              }}
              onError={() => {
                setStreamConnected(false);
                setError('Vision stream disconnected — reconnecting...');
                // Auto-reconnect with exponential backoff
                const attempt = streamReconnectAttemptRef.current;
                const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
                streamReconnectAttemptRef.current = attempt + 1;
                streamReconnectTimerRef.current = setTimeout(() => {
                  if (imgRef.current && streamUrl) {
                    imgRef.current.src = `${streamUrl}&t=${Date.now()}`;
                  }
                }, delay);
              }}
            />
            {streamConnected && (
              <>
                {/* Live indicator + Visual AI badge */}
                <div className="absolute top-3 left-3 flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-black/60 px-2 py-1 rounded">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-xs text-white font-medium">LIVE</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-gradient-to-r from-blue-600/80 to-purple-600/80 px-2 py-1 rounded">
                    <ScanEye size={14} className="text-white" />
                    <span className="text-xs text-white font-medium">Gemini Vision</span>
                  </div>
                </div>
                {/* App name */}
                <div className="absolute bottom-3 left-3 bg-black/60 px-2 py-1 rounded text-xs text-gray-300">
                  {monitoredApp.displayName || monitoredApp.deployment}
                </div>
              </>
            )}
          </div>
          <div className="p-3 text-center text-xs text-gray-500">
            Live feed from {monitoredApp.displayName || monitoredApp.deployment}
          </div>
        </div>
      );
    }
    
    // Legacy: show polled live frame
    if (liveFrame) {
      return (
        <div className={`bg-gray-900 rounded-lg overflow-hidden ${className}`}>
          <div className="relative aspect-video bg-black">
            <img
              src={`data:image/png;base64,${liveFrame.imageData}`}
              alt="Live dashboard feed"
              className="w-full h-full object-contain"
            />
            {/* Live indicator + Visual AI badge */}
            <div className="absolute top-3 left-3 flex items-center gap-2">
              <div className="flex items-center gap-2 bg-black/60 px-2 py-1 rounded">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-xs text-white font-medium">LIVE</span>
              </div>
              <div className="flex items-center gap-1.5 bg-gradient-to-r from-blue-600/80 to-purple-600/80 px-2 py-1 rounded">
                <ScanEye size={14} className="text-white" />
                <span className="text-xs text-white font-medium">Gemini Vision</span>
              </div>
            </div>
            {/* Frame info */}
            <div className="absolute bottom-3 right-3 bg-black/60 px-2 py-1 rounded text-xs text-gray-300">
              Frame #{liveFrame.frameNumber}
            </div>
            {/* Timestamp */}
            <div className="absolute bottom-3 left-3 bg-black/60 px-2 py-1 rounded text-xs text-gray-300">
              {liveFrame.timestamp.toLocaleTimeString()}
            </div>
          </div>
          <div className="p-3 text-center text-xs text-gray-500">
            Live feed from dashboard monitoring
          </div>
        </div>
      );
    }

    // Live mode but no frame yet
    return (
      <div className={`bg-gray-900 rounded-lg flex items-center justify-center ${className}`}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Connecting to live feed...</p>
        </div>
      </div>
    );
  }

  if (error || frames.length === 0) {
    return (
      <div className={`bg-gray-900 rounded-lg flex items-center justify-center ${className}`}>
        <div className="text-center p-8">
          <Video size={48} className="mx-auto mb-3 opacity-50 text-gray-500" />
          <p className="text-gray-400">{error || 'No video frames available'}</p>
          <button
            onClick={fetchFrames}
            className="mt-4 text-sm text-blue-400 hover:text-blue-300"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-900 rounded-lg overflow-hidden ${className}`}>
      {/* Video Frame */}
      <div className="relative aspect-video bg-black">
        {currentFrame && (
          <img
            src={`data:image/png;base64,${currentFrame.imageData}`}
            alt={`Frame ${currentFrame.frameNumber}`}
            className="w-full h-full object-contain"
          />
        )}

        {/* Annotations overlay */}
        {annotations.length > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {annotations.map((annotation) => (
              <g key={annotation.id}>
                <rect
                  x={annotation.x}
                  y={annotation.y}
                  width={annotation.width}
                  height={annotation.height}
                  fill="none"
                  stroke={annotation.type === 'anomaly' ? '#ef4444' : '#3b82f6'}
                  strokeWidth="2"
                />
                <text
                  x={annotation.x}
                  y={annotation.y - 5}
                  fill={annotation.type === 'anomaly' ? '#ef4444' : '#3b82f6'}
                  fontSize="12"
                >
                  {annotation.label}
                </text>
              </g>
            ))}
          </svg>
        )}

        {/* Gemini Vision badge */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-gradient-to-r from-blue-600/80 to-purple-600/80 px-2 py-1 rounded">
          <ScanEye size={14} className="text-white" />
          <span className="text-xs text-white font-medium">Gemini Vision</span>
        </div>

        {/* Frame counter */}
        <div className="absolute top-3 right-3 bg-black/60 px-2 py-1 rounded text-xs text-gray-300">
          Frame {currentFrameIndex + 1} / {frames.length}
        </div>

        {/* Timestamp */}
        {currentFrame && (
          <div className="absolute bottom-3 left-3 bg-black/60 px-2 py-1 rounded text-xs text-gray-300">
            {currentFrame.timestamp.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-4 space-y-3">
        {/* Seek bar */}
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={currentFrameIndex}
          onChange={handleSeek}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />

        {/* Playback controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Previous frame */}
            <button
              onClick={handlePrevFrame}
              disabled={currentFrameIndex === 0}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Previous frame"
            >
              <SkipBack size={18} className="text-white" />
            </button>

            {/* Play/Pause */}
            <button
              onClick={handlePlayPause}
              className="p-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause size={18} className="text-white" />
              ) : (
                <Play size={18} className="text-white" />
              )}
            </button>

            {/* Next frame */}
            <button
              onClick={handleNextFrame}
              disabled={currentFrameIndex === frames.length - 1}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Next frame"
            >
              <SkipForward size={18} className="text-white" />
            </button>
          </div>

          {/* Speed control */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Speed:</span>
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
});
