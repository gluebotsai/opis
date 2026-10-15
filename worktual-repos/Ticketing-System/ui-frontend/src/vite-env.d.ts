/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COWORKER_MODEL_NAME?: string;
  readonly VITE_COWORKER_MODEL_URL?: string;
  readonly VITE_PRODUCT_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
