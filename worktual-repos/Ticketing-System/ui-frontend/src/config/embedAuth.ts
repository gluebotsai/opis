/** CRM/CCaaS iframe embed auth — Campaign-style postMessage + Bearer JWT. */
export const EMBED_JWT_KEY = 'worktual.ticketing.jwt';
export const EMBED_AUTH_MESSAGE = 'worktual:ticketing-auth';

export function isEmbedMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('embed') === '1';
}

export function getEmbedJwt(): string | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(EMBED_JWT_KEY);
  return stored && stored.trim() ? stored.trim() : null;
}

export function setEmbedJwt(token: string): void {
  localStorage.setItem(EMBED_JWT_KEY, token.trim());
}

export function clearEmbedJwt(): void {
  localStorage.removeItem(EMBED_JWT_KEY);
}

/** Merge cookie session (standalone) or Bearer JWT (embed / CRM / LAN cookie fallback). */
export function apiFetchInit(base: RequestInit = {}): RequestInit {
  const jwt = getEmbedJwt();
  const headers = new Headers(base.headers || undefined);
  if (jwt) {
    headers.set('Authorization', `Bearer ${jwt}`);
  }
  return {
    credentials: 'include',
    ...base,
    headers,
  };
}

export function installEmbedAuthListener(onAuth?: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handler = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== EMBED_AUTH_MESSAGE) return;
    const token = String(data.token || '').trim();
    if (!token) return;
    setEmbedJwt(token);
    onAuth?.();
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
