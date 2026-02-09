/**
 * LiveFeedPanel - Live dashboard video feed with graceful degradation
 */
import { AlertTriangle, Video, ScanEye } from 'lucide-react';
import { useLiveFrames } from '../../hooks/useLiveFrames';
import { formatDistanceToNow } from 'date-fns';

interface LiveFeedPanelProps {
  className?: string;
}

export function LiveFeedPanel({ className = '' }: LiveFeedPanelProps) {
  const { frame, isConnected, lastSuccessfulFrame, error } = useLiveFrames();

  // Disconnected but have a cached frame
  if (!isConnected && lastSuccessfulFrame) {
    return (
      <div className={`relative rounded-lg overflow-hidden ${className}`}>
        <img
          src={`data:image/png;base64,${lastSuccessfulFrame.imageData}`}
          alt="Last captured dashboard"
          className="w-full h-full object-cover opacity-50"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-center">
            <AlertTriangle size={48} className="mx-auto mb-2 text-yellow-500" />
            <p className="text-yellow-500 font-medium">Screen capture disconnected</p>
            <p className="text-gray-400 text-sm mt-1">Showing last captured frame</p>
            <p className="text-gray-500 text-xs mt-2">
              {formatDistanceToNow(lastSuccessfulFrame.timestamp, { addSuffix: true })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Disconnected with no cached frame
  if (!isConnected) {
    return (
      <div className={`bg-gray-800 rounded-lg flex items-center justify-center ${className}`}>
        <div className="text-center p-8">
          <Video size={56} className="mx-auto mb-4 text-gray-500 opacity-50" />
          <p className="text-gray-400 font-medium">Screen capture unavailable</p>
          <p className="text-gray-500 text-sm mt-2">
            Check connection to screen-capture service
          </p>
          {error && (
            <p className="text-red-400/70 text-xs mt-3 max-w-xs">
              {error.message}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Connected and showing live frame
  if (frame) {
    return (
      <div className={`relative rounded-lg overflow-hidden bg-gray-900 ${className}`}>
        <img
          src={`data:image/png;base64,${frame.imageData}`}
          alt="Live dashboard feed"
          className="w-full h-auto object-contain"
        />
        {/* Live indicator + Gemini Vision badge */}
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
        <div className="absolute bottom-3 right-3 bg-black/60 px-2 py-1 rounded">
          <span className="text-xs text-gray-300">
            Frame #{frame.frameNumber}
          </span>
        </div>
      </div>
    );
  }

  // Loading state
  return (
    <div className={`bg-gray-800 rounded-lg flex items-center justify-center ${className}`}>
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Connecting to screen capture...</p>
      </div>
    </div>
  );
}
