import { getCustomerToken } from "./customerAuth.js";
import { fetchJson } from "./http.js";

function customerFetchOptions(init = {}) {
  const token = getCustomerToken();
  return {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}

/** Allowed UAT lengths — keep in sync with backend UAT_DURATION_OPTIONS_DAYS. */
export const UAT_DURATION_OPTIONS_DAYS = [3, 5, 7, 14];
export const DEFAULT_UAT_DURATION_DAYS = 5;

export async function fetchLeadGoLiveProducts(leadId) {
  return fetchJson(`/api/leads/${leadId}/go-live`);
}

export async function sendLeadUatAccess(
  leadId,
  goLiveId,
  { credentials = {}, note = "", durationDays = DEFAULT_UAT_DURATION_DAYS } = {},
) {
  return fetchJson(`/api/leads/${leadId}/go-live/${goLiveId}/send-uat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentials, note, durationDays }),
  });
}

export async function extendLeadUatAccess(
  leadId,
  goLiveId,
  { credentials = null, note = "", durationDays = DEFAULT_UAT_DURATION_DAYS } = {},
) {
  return fetchJson(`/api/leads/${leadId}/go-live/${goLiveId}/extend-uat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(credentials ? { credentials, note } : {}),
      durationDays,
    }),
  });
}

export async function fetchCustomerGoLiveProducts() {
  return fetchJson("/api/customer/go-live", customerFetchOptions());
}

export async function acceptCustomerGoLiveProducts(goLiveIds) {
  return fetchJson(
    "/api/customer/go-live/accept",
    customerFetchOptions({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goLiveIds }),
    }),
  );
}

export async function requestCustomerGoLiveChanges(goLiveId, note) {
  return fetchJson(
    `/api/customer/go-live/${goLiveId}/request-changes`,
    customerFetchOptions({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    }),
  );
}

/** Pre-subscription go-live stages — not commercially "Active". */
export const PRE_LIVE_LIFECYCLE_STATUSES = new Set([
  "awaiting_implementation",
  "uat",
  "uat_expired",
  "awaiting_subscription_payment",
]);

export function isPreLiveLifecycleStatus(status) {
  return PRE_LIVE_LIFECYCLE_STATUSES.has(status);
}

export function goLiveStatusLabel(status) {
  switch (status) {
    case "awaiting_implementation":
      return "Implementing";
    case "uat":
      return "UAT";
    case "uat_expired":
      return "UAT expired";
    case "awaiting_subscription_payment":
      return "Awaiting go-live payment";
    case "live":
      return "Live";
    default:
      return status || "Unknown";
  }
}

export function goLiveStatusDescription(status) {
  switch (status) {
    case "awaiting_implementation":
      return "Implementation is in progress. The product is not live yet.";
    case "uat":
      return "Product is in UAT. Customer can accept when ready to purchase.";
    case "uat_expired":
      return "UAT access has expired. Extend UAT or continue once the customer accepts.";
    case "awaiting_subscription_payment":
      return "UAT accepted. Waiting for go-live / subscription payment.";
    case "live":
      return "Product subscription is live.";
    default:
      return "Product lifecycle status is updating.";
  }
}

/**
 * True when OTC was paid but a live subscription does not exist yet
 * (implementing / UAT / awaiting go-live payment).
 */
export function isPreLivePaidProduct(entry) {
  if (!entry?.paymentConfirmedAt) {
    return false;
  }
  if (isPreLiveLifecycleStatus(entry.lifecycleStatus)) {
    return true;
  }
  // OTC path without a joined go-live row still has no subscription.
  if (!entry.subscriptionId && entry.lifecycleStatus !== "live") {
    return true;
  }
  return false;
}
