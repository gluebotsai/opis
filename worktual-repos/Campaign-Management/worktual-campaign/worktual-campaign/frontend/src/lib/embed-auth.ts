/** CRM iframe embed — token handoff, refresh listening, chrome mode. No DB writes. */

const EMBED_TOKEN_KEY = "worktual.campaign.embed-jwt";
const EMBED_FLAG_KEY = "worktual.campaignEmbed";
export const POST_MESSAGE_AUTH_TYPE = "worktual:campaign-auth";
export const POST_MESSAGE_READY_TYPE = "worktual:campaign-ready";
export const POST_MESSAGE_NAVIGATE_TYPE = "worktual:campaign-navigate";
/** Campaign → CRM: current iframe location (pathname + search). Do not echo as navigate. */
export const POST_MESSAGE_LOCATION_TYPE = "worktual:campaign-location";

const DEFAULT_PARENT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const POST_MESSAGE_WAIT_MS = 4_000;
const TOKEN_REFRESH_WAIT_MS = 15_000;

function parseParentOrigins(): string[] {
  const raw = import.meta.env.VITE_CRM_EMBED_ORIGINS?.trim();
  if (!raw) return DEFAULT_PARENT_ORIGINS;
  return raw
    .split(/[\s,]+/)
    .map((s: string) => s.trim())
    .filter(Boolean);
}

function embedFromQuery(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("embed") === "1";
}

function embedFromStorage(): boolean {
  try {
    return sessionStorage.getItem(EMBED_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist embed=1 from URL for the rest of the iframe session (survives client routing). */
export function persistEmbedModeIfQuery(): void {
  if (!embedFromQuery()) return;
  try {
    sessionStorage.setItem(EMBED_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
}

function isFramed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin frame access throws — treat as embedded.
    return true;
  }
}

/**
 * True when loaded inside CRM iframe — URL ?embed=1 while framed, or session flag
 * while still framed. Top-level standalone tabs ignore leftover embed JWT/flag so
 * SPA login is not forced onto an expired CRM token.
 */
export function isEmbedMode(): boolean {
  if (typeof window === "undefined") return false;
  if (embedFromQuery()) return true;
  if (!isFramed()) return false;
  return embedFromStorage() || Boolean(getEmbedToken());
}

/** Drop CRM embed JWT + flag (standalone SPA login / logout). */
export function clearEmbedAuth(): void {
  setEmbedToken(null);
  try {
    sessionStorage.removeItem(EMBED_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

/** Append ?embed=1 (or &embed=1) when in CRM iframe so Links keep embed in the URL. */
export function withEmbedQuery(path: string): string {
  const raw = String(path || "").trim();
  if (!raw || !isEmbedMode()) return raw;
  const hashIdx = raw.indexOf("#");
  const hash = hashIdx >= 0 ? raw.slice(hashIdx) : "";
  const noHash = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  if (/[?&]embed=1(?:&|$)/.test(noHash)) return raw;
  return `${noHash}${noHash.includes("?") ? "&" : "?"}embed=1${hash}`;
}

/** Full iframe path for CRM (draft/campaign/contact ids live in path or search). */
export function toEmbedLocationPath(pathname: string, search = ""): string {
  const path = String(pathname || "").trim() || "/";
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  params.delete("crm_token");
  params.delete("token");
  if (isEmbedMode() && params.get("embed") !== "1") params.set("embed", "1");
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}`;
}

export function currentEmbedLocationPath(): string {
  if (typeof window === "undefined") return "/";
  return toEmbedLocationPath(window.location.pathname, window.location.search);
}

export function isAllowedParentOrigin(origin: string): boolean {
  return parseParentOrigins().includes(origin);
}

export function getEmbedToken(): string | null {
  try {
    return sessionStorage.getItem(EMBED_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setEmbedToken(token: string | null) {
  try {
    if (!token) sessionStorage.removeItem(EMBED_TOKEN_KEY);
    else {
      sessionStorage.setItem(EMBED_TOKEN_KEY, token);
      sessionStorage.setItem(EMBED_FLAG_KEY, "1");
    }
  } catch {
    /* ignore */
  }
}

function readQueryToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token =
    params.get("crm_token")?.trim() ||
    params.get("token")?.trim() ||
    null;
  if (!token) return null;

  params.delete("crm_token");
  params.delete("token");
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
  return token;
}

function tokenFromMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as Record<string, unknown>;
  if (msg.type !== POST_MESSAGE_AUTH_TYPE) return null;
  const token = msg.token;
  if (typeof token !== "string" || !token.trim()) return null;
  return token.trim();
}

const tokenListeners = new Set<(token: string) => void>();
let tokenRefreshWaiters: Array<(token: string) => void> = [];
let embedListenerStarted = false;
let pendingRefreshRequest: Promise<string | null> | null = null;
let embedContentReadyBlockers = 0;
const embedContentReadyListeners = new Set<() => void>();

function notifyEmbedContentReadyListeners() {
  for (const listener of embedContentReadyListeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

/** Pages with async bootstrapping call this while skeletons are visible. */
export function blockEmbedContentReady(): () => void {
  embedContentReadyBlockers += 1;
  return () => {
    embedContentReadyBlockers = Math.max(0, embedContentReadyBlockers - 1);
    if (embedContentReadyBlockers === 0) notifyEmbedContentReadyListeners();
  };
}

export function isEmbedContentReady(): boolean {
  return embedContentReadyBlockers === 0;
}

export function subscribeEmbedContentReady(listener: () => void): () => void {
  embedContentReadyListeners.add(listener);
  return () => embedContentReadyListeners.delete(listener);
}

function notifyEmbedTokenListeners(token: string) {
  for (const listener of tokenListeners) {
    try {
      listener(token);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function resolveTokenRefreshWaiters(token: string) {
  const waiters = tokenRefreshWaiters;
  tokenRefreshWaiters = [];
  for (const resolve of waiters) {
    resolve(token);
  }
}

function applyEmbedTokenFromParent(token: string) {
  setEmbedToken(token);
  resolveTokenRefreshWaiters(token);
  notifyEmbedTokenListeners(token);
}

function onEmbedAuthMessage(event: MessageEvent) {
  if (!isAllowedParentOrigin(event.origin)) return;
  const token = tokenFromMessage(event.data);
  if (!token) return;
  applyEmbedTokenFromParent(token);
}

/** Lifetime listener — CRM may refresh JWT every ~8–15 min via postMessage. */
export function startEmbedAuthListener(): void {
  if (embedListenerStarted || typeof window === "undefined") return;
  embedListenerStarted = true;
  window.addEventListener("message", onEmbedAuthMessage);
}

function onEmbedNavigateMessage(
  event: MessageEvent,
  onNavigate: (path: string) => void,
) {
  if (!isAllowedParentOrigin(event.origin)) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;
  const msg = data as Record<string, unknown>;
  if (msg.type !== POST_MESSAGE_NAVIGATE_TYPE) return;
  let path = String(msg.path || "").trim();
  if (!path.startsWith("/")) return;
  // Soft-nav must stay in embed mode even if CRM omits ?embed=1 on the path.
  if (isEmbedMode() && !/[?&]embed=1(?:&|$)/.test(path)) {
    path += path.includes("?") ? "&embed=1" : "?embed=1";
  }
  onNavigate(path);
}

/** CRM Marketing tab switch — client-side route without full iframe reload. */
export function startEmbedNavigateListener(
  onNavigate: (path: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: MessageEvent) =>
    onEmbedNavigateMessage(event, onNavigate);
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

function postToParent(payload: Record<string, unknown>): void {
  if (typeof window === "undefined" || window.parent === window) return;
  for (const origin of parseParentOrigins()) {
    window.parent.postMessage(payload, origin);
  }
}

/** Ask CRM parent for (another) access JWT (401 recovery). */
export function announceEmbedReady(path?: string): void {
  if (typeof window === "undefined") return;
  postToParent({
    type: POST_MESSAGE_READY_TYPE,
    path: path ?? currentEmbedLocationPath(),
  });
}

let lastPostedLocation = "";

/**
 * Tell CRM the iframe route so the parent address bar can show the record id.
 * CRM must listen and rewrite /marketing/... — do not post this back as navigate.
 */
export function announceEmbedLocation(path?: string): void {
  if (typeof window === "undefined" || !isEmbedMode()) return;
  const next = path ?? currentEmbedLocationPath();
  if (!next || next === lastPostedLocation) return;
  lastPostedLocation = next;
  postToParent({
    type: POST_MESSAGE_LOCATION_TYPE,
    path: next,
  });
}

/** CRM reveal handshake — after layout/content paint, not during auth bootstrap. */
export function announceEmbedReadyAfterPaint(path?: string): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  let innerRaf = 0;
  const outerRaf = requestAnimationFrame(() => {
    innerRaf = requestAnimationFrame(() => {
      if (cancelled) return;
      announceEmbedReady(path);
    });
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(outerRaf);
    if (innerRaf) cancelAnimationFrame(innerRaf);
  };
}

/** Subscribe to CRM token handoffs / refreshes (e.g. re-bootstrap auth). */
export function subscribeEmbedToken(
  listener: (token: string) => void,
): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

/** Wait until CRM posts a fresh JWT (or timeout). */
export function waitForEmbedTokenRefresh(
  timeoutMs = TOKEN_REFRESH_WAIT_MS,
): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tokenRefreshWaiters = tokenRefreshWaiters.filter((w) => w !== onToken);
      resolve(token);
    };

    const onToken = (token: string) => finish(token);
    tokenRefreshWaiters.push(onToken);

    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Clear stale embed JWT, signal CRM, wait for replacement (deduped across concurrent 401s).
 */
export function requestEmbedTokenRefresh(
  timeoutMs = TOKEN_REFRESH_WAIT_MS,
): Promise<string | null> {
  if (pendingRefreshRequest) return pendingRefreshRequest;

  pendingRefreshRequest = (async () => {
    setEmbedToken(null);
    announceEmbedReady();
    return waitForEmbedTokenRefresh(timeoutMs);
  })().finally(() => {
    pendingRefreshRequest = null;
  });

  return pendingRefreshRequest;
}

/**
 * Initial CRM JWT capture before auth bootstrap.
 * Lifetime refresh listener stays active after this returns.
 */
export function initEmbedAuth(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  persistEmbedModeIfQuery();
  startEmbedAuthListener();

  const fromQuery = readQueryToken();
  if (fromQuery) {
    applyEmbedTokenFromParent(fromQuery);
    return Promise.resolve();
  }

  if (getEmbedToken()) {
    return Promise.resolve();
  }

  if (!isEmbedMode()) return Promise.resolve();

  // CRM posts auth on iframe load — wait silently (do not send READY yet).
  return waitForEmbedTokenRefresh(POST_MESSAGE_WAIT_MS).then(() => undefined);
}

export const embedAuthConstants = {
  EMBED_TOKEN_KEY,
  EMBED_FLAG_KEY,
  POST_MESSAGE_AUTH_TYPE,
  POST_MESSAGE_READY_TYPE,
  POST_MESSAGE_NAVIGATE_TYPE,
  POST_MESSAGE_LOCATION_TYPE,
} as const;
