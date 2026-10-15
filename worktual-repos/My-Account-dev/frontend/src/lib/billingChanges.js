import { getAuthToken } from "./auth.js";
import { fetchJson } from "./http.js";

function authHeaders() {
  const token = getAuthToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchLeadOpenQuotations(leadId) {
  return fetchJson(`/api/leads/${leadId}/open-quotations`, {
    headers: authHeaders(),
  });
}

export async function submitSubscriptionBillingChange(
  leadId,
  subscriptionId,
  { type, proposedMonthlyPrice, note = "" },
) {
  return fetchJson(`/api/leads/${leadId}/subscriptions/${subscriptionId}/billing-changes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      type,
      ...(proposedMonthlyPrice !== undefined ? { proposedMonthlyPrice } : {}),
      note,
    }),
  });
}

export function openQuotationStatusTone(status) {
  if (status === "Approved") {
    return "qualified";
  }
  if (status === "Rejected") {
    return "inactive";
  }
  if (status === "Pending Finance Review") {
    return "in-progress";
  }
  return "new";
}

export function billingChangeTypeLabel(type) {
  if (type === "mrr_adjustment") {
    return "MRR change";
  }
  if (type === "renewal_cancel") {
    return "Cancel next renewal";
  }
  return type || "";
}
