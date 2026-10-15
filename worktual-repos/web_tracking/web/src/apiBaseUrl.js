/** Resolve axios base URL for dev proxy, production API host, or same-origin /api (vite preview). */
export function resolveApiBaseUrl(env) {
  const useDevProxy =
    env.DEV && env.VITE_DEV_USE_API_PROXY !== 'false';
  if (useDevProxy) {
    return '';
  }

  const raw = (env.VITE_API_URL || '').trim();
  if (!raw || raw === 'same-origin') {
    return '';
  }

  if (typeof window !== 'undefined') {
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1') {
        // Build often bakes loopback; remote browsers must use same-origin + Vite/nginx proxy.
        return '';
      }
    } catch {
      return raw;
    }
  }

  return raw;
}
