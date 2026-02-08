/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAME_SERVER_URL: string;
  readonly VITE_SOCIAL_SERVER_URL: string;
  readonly VITE_LOGIN_SERVER_URL: string;
  readonly VITE_SIMULATED_LATENCY_MS: string;
  readonly VITE_DEBUG_MOVEMENT: string;
  readonly VITE_ENABLE_INSPECTOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
