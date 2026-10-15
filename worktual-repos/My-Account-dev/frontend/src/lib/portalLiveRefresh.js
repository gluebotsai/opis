export const PORTAL_LIVE_REFRESH_EVENT = "worktual:portal-live-refresh";

const PORTAL_REFRESH_PREFIXES = ["payment.", "quotation.", "commission."];

export function shouldRefreshPortalForEvent(eventName) {
  const normalized = String(eventName || "");
  return PORTAL_REFRESH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function dispatchPortalLiveRefresh(payload) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(PORTAL_LIVE_REFRESH_EVENT, { detail: payload }));
}

export function subscribePortalLiveRefresh(onRefresh) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = (event) => {
    onRefresh?.(event.detail || {});
  };

  window.addEventListener(PORTAL_LIVE_REFRESH_EVENT, handler);
  return () => {
    window.removeEventListener(PORTAL_LIVE_REFRESH_EVENT, handler);
  };
}
