/** Public logo URL — set VITE_LOGO_URL in root .env (same pattern as SDK_PUBLIC_URL). */
export const LOGO_URL = import.meta.env.VITE_LOGO_URL?.trim() || '/logo.png';
