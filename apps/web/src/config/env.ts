/**
 * Environment configuration for ChronosOps frontend
 * Auto-detects URLs in production when served from same origin
 */

// Helper to get current origin - forces runtime evaluation
// CRITICAL: Must check typeof window inside function, NOT at module scope
// (module scope gets evaluated at build time in Node.js where window is undefined)
const getCurrentOrigin = (): string => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  return `${window.location.protocol}//${window.location.host}`;
};

// Helper to check if we're in production (not localhost)
// CRITICAL: Must check typeof window inside function, NOT at module scope
const isProduction = (): boolean => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return hostname !== 'localhost' && hostname !== '127.0.0.1';
};

// Lazy detection - only runs when accessed in browser at runtime
const getApiUrl = (): string => {
  // Use env var if provided (checked at runtime)
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.length > 0) {
    return envUrl;
  }

  // In production, use same origin (API is served from same host)
  if (isProduction()) {
    return getCurrentOrigin();
  }

  // Default for local development
  return 'http://localhost:3000';
};

const getWsUrl = (): string => {
  // Use env var if provided
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl && envUrl.length > 0) {
    return envUrl;
  }

  // In production, use same origin with WebSocket protocol
  if (isProduction()) {
    if (typeof window === 'undefined') return 'ws://localhost:3000/ws';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${window.location.host}/ws`;
  }

  // Default for local development
  return 'ws://localhost:3000/ws';
};

export const config = {
  // API URLs (lazy evaluated at runtime, not build time)
  get apiUrl() {
    return getApiUrl();
  },
  get wsUrl() {
    return getWsUrl();
  },
  screenCaptureUrl: import.meta.env.VITE_SCREEN_CAPTURE_URL || 'http://localhost:4000',

  // Feature flags
  features: {
    liveVideo: import.meta.env.VITE_FEATURE_LIVE_VIDEO !== 'false',
    setupWizard: import.meta.env.VITE_FEATURE_SETUP !== 'false',
    demoMode: import.meta.env.VITE_DEMO_MODE === 'true',
  },

  // Polling intervals (in ms)
  polling: {
    frameInterval: Number(import.meta.env.VITE_FRAME_INTERVAL) || 5000,
    healthInterval: Number(import.meta.env.VITE_HEALTH_INTERVAL) || 10000,
    incidentRefresh: 5000,
  },

  // Demo mode settings
  demo: {
    autoTriggerDelay: 10000, // Auto-trigger incident after 10s
    speedMultiplier: 2, // Faster animations
  },

  // WebSocket reconnection
  websocket: {
    reconnectDelays: [1000, 2000, 4000, 8000, 16000], // Exponential backoff
    maxReconnectAttempts: 10,
  },
} as const;

export type Config = typeof config;
