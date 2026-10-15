import { getAuthToken } from "./auth.js";
import { getCustomerToken } from "./customerAuth.js";
import { getPartnerToken } from "./partnerAuth.js";
import { getResellerToken } from "./resellerAuth.js";
import { logTimedClient } from "./perfLog.js";
import { safeStringify } from "./safeJson.js";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/sign-in",
  "/api/auth/password-reset/request",
  "/api/auth/password-reset/verify",
  "/api/auth/password-reset/confirm",
  "/api/v1/customer/login",
  "/api/health",
  "/api/payments/config",
  "/api/pricing-catalog",
  "/api/v1/tax/gstin/validate",
]);

function isPublicApiUrl(url) {
  const path = String(url).split("?")[0];
  return PUBLIC_API_PATHS.has(path);
}

async function clearAllStoredSessions() {
  const [
    { clearSession },
    { clearCustomerSession },
    { clearPartnerSession },
    { clearResellerSession },
  ] = await Promise.all([
    import("./auth.js"),
    import("./customerAuth.js"),
    import("./partnerAuth.js"),
    import("./resellerAuth.js"),
  ]);

  clearSession();
  clearCustomerSession();
  clearPartnerSession();
  clearResellerSession();
}

function isCustomerPortalApiUrl(url) {
  const path = String(url).split("?")[0];
  return path.startsWith("/api/v1/me") || path.startsWith("/api/v1/customer/");
}

/**
 * Pick the bearer token for an API URL.
 * Customer portal `/api/v1/me/*` must use the customer token even when a stale
 * staff/partner/reseller token is still in localStorage — otherwise a 401 clears
 * the local customer session while the server row stays active (session lock).
 */
export function resolveApiAuthToken(url) {
  if (isCustomerPortalApiUrl(url)) {
    return getCustomerToken() || getAuthToken() || getResellerToken() || getPartnerToken() || "";
  }
  return getAuthToken() || getResellerToken() || getPartnerToken() || getCustomerToken() || "";
}

async function revokeStoredSessionsBeforeClear() {
  const customerToken = getCustomerToken();
  const staffToken = getAuthToken();
  const partnerToken = getPartnerToken();
  const resellerToken = getResellerToken();

  const revocations = [];
  if (customerToken) {
    revocations.push(
      fetch("/api/v1/customer/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${customerToken}` },
        keepalive: true,
      }).catch(() => {}),
    );
  }
  if (staffToken) {
    revocations.push(
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${staffToken}` },
        keepalive: true,
      }).catch(() => {}),
    );
  }
  if (partnerToken) {
    revocations.push(
      fetch("/api/partner/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${partnerToken}` },
        keepalive: true,
      }).catch(() => {}),
    );
  }
  if (resellerToken) {
    revocations.push(
      fetch("/api/reseller/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${resellerToken}` },
        keepalive: true,
      }).catch(() => {}),
    );
  }

  if (revocations.length) {
    await Promise.allSettled(revocations);
  }
}

async function handleUnauthorizedSession() {
  if (typeof window === "undefined") {
    return;
  }

  // Revoke server rows before clearing local storage so a 401 cannot leave a
  // stale active-session lock that blocks the next login.
  await revokeStoredSessionsBeforeClear();
  await clearAllStoredSessions();

  if (window.location.pathname !== "/") {
    window.location.assign("/?reason=session-expired");
  }
}

function withAuthHeaders(url, headers = {}) {
  if (!String(url).startsWith("/api/") || isPublicApiUrl(url)) {
    return headers;
  }

  if (headers.Authorization) {
    return headers;
  }

  const token = resolveApiAuthToken(url);
  if (!token) {
    return headers;
  }

  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
}

function hasContentType(headers) {
  return Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
}

function isApplicationJsonContentType(headers) {
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === "content-type",
  );
  if (!entry) {
    return false;
  }
  return String(entry[1] || "")
    .toLowerCase()
    .includes("application/json");
}

function stripContentType(headers) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "content-type") {
      delete headers[key];
    }
  }
}

/** Coalesce concurrent identical GETs into one network request. */
const inflightGets = new Map();

function getInflightKey(method, url, headers) {
  if (method !== "GET") {
    return null;
  }
  return `${url}\0${headers.Authorization || ""}`;
}

function isLocalDevBuild() {
  return typeof import.meta !== "undefined" && import.meta.env?.DEV;
}

function apiNetworkErrorMessage() {
  if (isLocalDevBuild()) {
    return "Cannot reach the API server. Start the backend in another terminal: cd backend && pnpm dev (port 3002). The frontend on :5173 proxies /api there.";
  }
  return "Cannot reach the server. Check your connection and try again. If this continues, contact support.";
}

function apiProxyBackendDownMessage() {
  if (isLocalDevBuild()) {
    return "API server is not responding. Start the backend: cd backend && pnpm dev (port 3002).";
  }
  return "Service temporarily unavailable. Please try again in a moment.";
}

function apiRouteNotFoundMessage() {
  if (isLocalDevBuild()) {
    return "API route not found. Restart the backend: cd backend && pnpm dev (port 3002).";
  }
  return "This action is not available right now. Refresh the page or contact support if it continues.";
}

function isLikelyProxyBackendDown(response, data, url) {
  if (!String(url).startsWith("/api/") || response.status !== 500) {
    return false;
  }
  const message = String(data?.error || data?.message || "").trim();
  if (message) {
    return false;
  }
  // Vite dev/preview proxy returns an empty 500 when the upstream API is down.
  return Object.keys(data || {}).length === 0;
}

async function fetchJsonOnce(url, options = {}) {
  const started = performance.now();
  const method = String(options.method || "GET").toUpperCase();
  const path = String(url).split("?")[0];
  let response;

  const headers = { ...withAuthHeaders(url, options.headers || {}) };
  const { body, signal, ...rest } = options;
  const preparedBody =
    body === undefined || body === null
      ? undefined
      : typeof body === "string"
        ? body
        : safeStringify(body);

  // Fastify rejects empty bodies when Content-Type is application/json.
  if (
    (preparedBody === undefined || preparedBody === "") &&
    isApplicationJsonContentType(headers)
  ) {
    stripContentType(headers);
  }

  // Only set Content-Type when a body is present.
  if (preparedBody !== undefined && preparedBody !== "" && !hasContentType(headers)) {
    headers["Content-Type"] = "application/json";
  }

  try {
    response = await fetch(url, { ...rest, signal, headers, body: preparedBody });
  } catch (error) {
    if (error?.name === "AbortError") {
      // Caller aborted (cleanup / navigation) — do not treat as timeout.
      if (signal?.aborted) {
        throw error;
      }
      logTimedClient({
        channel: "http",
        action: `${method} ${path}`,
        ok: false,
        durationMs: performance.now() - started,
        error: "Request timed out",
      });
      throw new Error("Request timed out. Refresh and try again if the status has not updated.");
    }

    logTimedClient({
      channel: "http",
      action: `${method} ${path}`,
      ok: false,
      durationMs: performance.now() - started,
      error: "Cannot reach the API server",
    });
    throw new Error(apiNetworkErrorMessage());
  }

  const raw = await response.json().catch(() => ({}));
  const data = unwrapApiEnvelope(raw, response);

  if (!response.ok) {
    let message = data.error || data.message || `Request failed (${response.status})`;

    if (isLikelyProxyBackendDown(response, data, url)) {
      message = apiProxyBackendDownMessage();
    }

    if (response.status === 404 && String(url).startsWith("/api/")) {
      message = apiRouteNotFoundMessage();
    }

    if (response.status === 401 && String(url).startsWith("/api/") && !isPublicApiUrl(url)) {
      await handleUnauthorizedSession();
      message = data.error || data.message || "Authentication required. Please sign in again.";
    }

    if (response.status === 502 || response.status === 503 || response.status === 504) {
      message =
        data.error ||
        data.message ||
        "Service temporarily unavailable. The API may be restarting or timed out — refresh and try again. Your data was not deleted.";
    }

    if (response.status === 503 || data.code === "DATABASE_UNAVAILABLE") {
      console.warn("[auth] Database unavailable", { path, status: response.status, code: data.code });
      message = data.error || data.message || "Database unavailable. Try again in a moment.";
    }

    logTimedClient({
      channel: "http",
      action: `${method} ${path}`,
      ok: false,
      durationMs: performance.now() - started,
      status: response.status,
      error: message,
    });

    if (response.status === 404 && String(url).startsWith("/api/")) {
      throw new Error(message);
    }

    if (response.status === 401 && String(url).startsWith("/api/") && !isPublicApiUrl(url)) {
      throw new Error(message);
    }

    const error = new Error(message);
    if (data.code) {
      error.code = data.code;
    }
    if (data.contactConflict) {
      error.contactConflict = data.contactConflict;
    }
    if (data.existingRequest) {
      error.existingRequest = data.existingRequest;
    }
    if (data.productId) {
      error.productId = data.productId;
    }
    if (data.branchId) {
      error.branchId = data.branchId;
    }
    error.status = response.status;
    throw error;
  }

  logTimedClient({
    channel: "http",
    action: `${method} ${path}`,
    ok: true,
    durationMs: performance.now() - started,
    status: response.status,
  });

  return data;
}

export async function fetchJson(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = { ...withAuthHeaders(url, options.headers || {}) };
  const key = getInflightKey(method, url, headers);
  const { signal } = options;

  // Mutations and non-GET always hit the network.
  if (!key) {
    return fetchJsonOnce(url, options);
  }

  // Caller already aborted before we start.
  if (signal?.aborted) {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    throw abortError;
  }

  let entry = inflightGets.get(key);
  if (!entry) {
    // Shared fetch ignores per-caller AbortSignal so a StrictMode cleanup
    // abort does not cancel the request still needed by the remount.
    const { signal: _ignoredSignal, ...rest } = options;
    const promise = fetchJsonOnce(url, rest).finally(() => {
      if (inflightGets.get(key) === entry) {
        inflightGets.delete(key);
      }
    });
    entry = { promise };
    inflightGets.set(key, entry);
  }

  if (!signal) {
    return entry.promise;
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      const abortError = new Error("The operation was aborted.");
      abortError.name = "AbortError";
      reject(abortError);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Backend JSON routes return a flat envelope:
 *   { statusCode, message, ...payload }
 * Also accepts legacy { statusCode, message, metaResponse } during rollout.
 * Callers continue to receive the payload only (e.g. { users }).
 */
function unwrapApiEnvelope(raw, response) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !("statusCode" in raw) ||
    !("message" in raw)
  ) {
    return raw;
  }

  if ("metaResponse" in raw) {
    if (!response.ok) {
      const meta =
        raw.metaResponse && typeof raw.metaResponse === "object" && !Array.isArray(raw.metaResponse)
          ? raw.metaResponse
          : {};
      return {
        ...meta,
        error: raw.message,
        message: raw.message,
        statusCode: raw.statusCode,
      };
    }
    return raw.metaResponse;
  }

  const { statusCode, message, ...payload } = raw;

  if (!response.ok) {
    return {
      ...payload,
      error: message,
      message,
      statusCode,
    };
  }

  return payload;
}
