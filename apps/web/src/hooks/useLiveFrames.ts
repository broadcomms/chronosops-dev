/**
 * Hook for polling live frames from the screen capture service
 * Includes graceful degradation and last frame tracking
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { config } from '../config/env';
import type { FrameData } from '../types';

interface UseLiveFramesOptions {
  intervalMs?: number;
  enabled?: boolean;
}

interface UseLiveFramesResult {
  frame: FrameData | null;
  isConnected: boolean;
  lastSuccessfulFrame: FrameData | null;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useLiveFrames(options: UseLiveFramesOptions = {}): UseLiveFramesResult {
  const { intervalMs = config.polling.frameInterval, enabled = true } = options;

  const [frame, setFrame] = useState<FrameData | null>(null);
  const [lastSuccessfulFrame, setLastSuccessfulFrame] = useState<FrameData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const frameNumberRef = useRef(0);

  const fetchFrame = useCallback(async () => {
    if (!enabled) return;

    try {
      const response = await fetch(`${config.screenCaptureUrl}/frame/latest`, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch frame: ${response.status}`);
      }

      const data = await response.json();

      const frameData: FrameData = {
        imageData: data.base64 || data.image || data.imageData,
        timestamp: new Date(data.timestamp || Date.now()),
        frameNumber: data.frameNumber || data.id || ++frameNumberRef.current,
      };

      setFrame(frameData);
      setLastSuccessfulFrame(frameData);
      setIsConnected(true);
      setError(null);
    } catch (err) {
      setIsConnected(false);
      setError(err instanceof Error ? err : new Error(String(err)));
      // Keep frame as null when disconnected, but preserve lastSuccessfulFrame
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      return;
    }

    // Initial fetch
    fetchFrame();

    // Set up polling
    const interval = setInterval(fetchFrame, intervalMs);

    return () => clearInterval(interval);
  }, [enabled, intervalMs, fetchFrame]);

  return {
    frame,
    isConnected,
    lastSuccessfulFrame,
    error,
    refetch: fetchFrame,
  };
}
