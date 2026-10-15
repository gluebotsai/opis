import { getAuthToken } from "./auth.js";
import { getCustomerToken } from "./customerAuth.js";
import { getPartnerToken } from "./partnerAuth.js";
import { getResellerToken } from "./resellerAuth.js";

const DEFAULT_CHANNELS = [
  "quotations",
  "payments",
  "tickets",
  "mail",
  "cancellations",
  "requests",
];

function resolveAuthToken() {
  if (typeof window !== "undefined") {
    const path = window.location.pathname || "";
    if (path.startsWith("/customer")) {
      return getCustomerToken() || getAuthToken() || "";
    }
    if (path.startsWith("/partner")) {
      return getPartnerToken() || getAuthToken() || "";
    }
    if (path.startsWith("/reseller")) {
      return getResellerToken() || getAuthToken() || "";
    }
  }
  return getAuthToken() || getResellerToken() || getPartnerToken() || getCustomerToken() || "";
}

export function subscribeToAppEvents({
  channels = DEFAULT_CHANNELS,
  mailboxProfile = null,
  onEvent,
  onError,
} = {}) {
  const token = resolveAuthToken();
  if (!token) {
    return () => {};
  }

  const params = new URLSearchParams({
    access_token: token,
    channels: channels.join(","),
  });

  if (mailboxProfile) {
    params.set("mailboxProfile", mailboxProfile);
  }

  const source = new EventSource(`/api/events/stream?${params.toString()}`);

  const handlePayload = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent?.(data, event.type);
    } catch {
      // Ignore malformed SSE payloads.
    }
  };

  source.addEventListener("connected", handlePayload);
  source.addEventListener("heartbeat", () => {});
  // Server emits all domain events as SSE type "message" (event name is in payload.event).
  source.addEventListener("message", handlePayload);

  source.onerror = (error) => {
    onError?.(error);
  };

  return () => {
    source.close();
  };
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * SSE subscription with exponential backoff reconnect.
 * Pages keep working if the stream is unavailable; reconnect is best-effort.
 */
export function subscribeToAppEventsWithReconnect(options = {}) {
  let disposed = false;
  let cleanup = null;
  let retryAttempt = 0;
  let retryTimer = null;

  const connect = () => {
    if (disposed) {
      return;
    }

    cleanup?.();
    cleanup = subscribeToAppEvents({
      ...options,
      onEvent: (payload, type) => {
        retryAttempt = 0;
        options.onEvent?.(payload, type);
      },
      onError: (error) => {
        options.onError?.(error);
        if (disposed) {
          return;
        }
        cleanup?.();
        cleanup = null;
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** retryAttempt);
        retryAttempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      },
    });
  };

  connect();

  return () => {
    disposed = true;
    if (retryTimer) {
      window.clearTimeout(retryTimer);
    }
    cleanup?.();
  };
}
