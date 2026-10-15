/** Safe in-app return path only (no open redirects). */
export function sanitizeReturnPath(raw) {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  if (s.includes('://')) return null;
  return s;
}

function returnPathFromQuery(search) {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const encoded = params.get('return');
  if (!encoded) return null;
  try {
    return sanitizeReturnPath(decodeURIComponent(encoded));
  } catch {
    return sanitizeReturnPath(encoded);
  }
}

function replayReturnPathFromState(state) {
  const returnTo = sanitizeReturnPath(state?.returnTo);
  if (returnTo) return returnTo;
  const visitorId = String(state?.visitorId ?? '').trim();
  if (!visitorId) return null;
  const cdpId = String(state?.cdpId ?? '').trim();
  const qs = cdpId ? `?cdp_id=${encodeURIComponent(cdpId)}` : '';
  return `/visitors/${encodeURIComponent(visitorId)}${qs}`;
}

/** Resolved return target for session replay (query → state → null). */
export function resolveReplayReturnPath(search, state) {
  return returnPathFromQuery(search) ?? replayReturnPathFromState(state) ?? null;
}

/** Split "/path?query" into Link `to` object. */
export function parseReturnToLocation(search, state) {
  const full = resolveReplayReturnPath(search, state);
  if (!full) return null;
  const qIndex = full.indexOf('?');
  if (qIndex === -1) {
    return { pathname: full, search: '' };
  }
  return {
    pathname: full.slice(0, qIndex),
    search: full.slice(qIndex),
  };
}

export function hasReplayReturnHint(search, state) {
  return Boolean(resolveReplayReturnPath(search, state));
}

export function getBackPath(pathname, state, search = '') {
  if (pathname === '/' || pathname === '/login') return null;
  if (/^\/visitors\/[^/]+$/.test(pathname)) return '/visitors';
  if (/^\/sessions\/[^/]+\/replay$/.test(pathname)) {
    return resolveReplayReturnPath(search, state) ?? '/sessions';
  }
  return '/';
}

export function getBackLabel(pathname, state, search = '') {
  const explicit = String(state?.returnLabel ?? '').trim();
  if (explicit) return explicit;
  if (/^\/visitors\/[^/]+$/.test(pathname)) return 'Visitors';
  if (/^\/sessions\/[^/]+\/replay$/.test(pathname)) {
    const target = resolveReplayReturnPath(search, state);
    if (target?.startsWith('/visitors/')) return 'Visitor';
    if (target === '/sessions') return 'Session replay';
    return target ? 'Previous' : 'Session replay';
  }
  return 'Dashboard';
}

/** Build replay URL with ?return= for visitor-detail back navigation. */
export function replayUrlWithReturn(sessionId, returnPath) {
  const safe = sanitizeReturnPath(returnPath);
  const base = `/sessions/${encodeURIComponent(String(sessionId))}/replay`;
  if (!safe) return base;
  return `${base}?return=${encodeURIComponent(safe)}`;
}
