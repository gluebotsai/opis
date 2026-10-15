import { getAuthToken } from "./auth.js";
import { getCustomerToken } from "./customerAuth.js";
import { fetchJson } from "./http.js";

function customerHeaders() {
  return {
    Authorization: `Bearer ${getCustomerToken()}`,
  };
}

function salesHeaders() {
  const token = getAuthToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function listMyBranchAddRequests() {
  const data = await fetchJson("/api/v1/me/branch-add-requests", {
    headers: customerHeaders(),
  });
  return data.requests || [];
}

export async function submitBranchAddRequest(payload) {
  const data = await fetchJson("/api/v1/me/branch-add-requests", {
    method: "POST",
    headers: customerHeaders(),
    body: JSON.stringify(payload),
  });
  return data.request || null;
}

export async function withdrawBranchAddRequest(requestId) {
  const data = await fetchJson(`/api/v1/me/branch-add-requests/${requestId}/withdraw`, {
    method: "POST",
    headers: customerHeaders(),
  });
  return data.request || null;
}

export async function listLeadBranchAddRequests(leadId) {
  const data = await fetchJson(`/api/leads/${leadId}/branch-add-requests`, {
    headers: salesHeaders(),
  });
  return data.requests || [];
}

export function canWithdrawBranchAddRequest(request) {
  return request?.status === "submitted";
}

export function branchAddStatusLabel(status) {
  switch (status) {
    case "submitted":
      return "Pending sales review";
    case "withdrawn":
      return "Withdrawn";
    case "acknowledged":
      return "Acknowledged";
    default:
      return status || "—";
  }
}
