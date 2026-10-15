/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENTS_URL?: string;
  readonly VITE_AGENTS_SOCKET_PATH?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_MEDIA_PUBLIC_BASE?: string;
  readonly VITE_MEDIA_ALLOW_LOCAL_PUBLISH?: string;
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_DEV_INDUSTRY_SWITCHER?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_WEB_TRACKING_LANDING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.svg" {
  const src: string;
  export default src;
}
