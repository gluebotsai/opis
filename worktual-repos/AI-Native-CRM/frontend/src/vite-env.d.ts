/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLOUD_PROJECT_NUMBER?: string;
  readonly VITE_NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "@zoom/appssdk" {
  const zoomSdk: {
    config: (opts: { capabilities: string[] }) => Promise<void>;
    getRunningContext: () => Promise<unknown>;
  };
  export default zoomSdk;
}

declare module "@microsoft/teams-js" {
  export const app: {
    initialize: () => Promise<void>;
    getContext: () => Promise<{
      meeting?: { id?: string };
      chat?: { id?: string };
    }>;
  };
}
