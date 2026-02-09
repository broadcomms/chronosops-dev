/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_SCREEN_CAPTURE_URL: string;
  readonly VITE_FEATURE_LIVE_VIDEO: string;
  readonly VITE_FEATURE_SETUP: string;
  readonly VITE_DEMO_MODE: string;
  readonly VITE_FRAME_INTERVAL: string;
  readonly VITE_HEALTH_INTERVAL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
