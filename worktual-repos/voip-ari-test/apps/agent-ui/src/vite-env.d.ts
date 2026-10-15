/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ASTERISK_WSS_URL: string;
  readonly VITE_AGENT_EXTENSION: string;
  readonly VITE_AGENT_PASSWORD: string;
  readonly VITE_API_KEY: string;
  readonly VITE_API_BASE: string;
  readonly VITE_PROXY_API: string;
  readonly VITE_PROXY_ARI_WS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
