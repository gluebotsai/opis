import { getAuthToken } from "./auth.js";
import { fetchJson } from "./http.js";

function adminHeaders() {
  return {
    Authorization: `Bearer ${getAuthToken()}`,
    "Content-Type": "application/json",
  };
}

export async function listAdminCancellationRequests(status = "") {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await fetchJson(`/api/admin/cancellation-requests${query}`, {
    headers: adminHeaders(),
  });
  return data.requests || [];
}

export async function getAdminCancellationRequest(requestId) {
  const data = await fetchJson(`/api/admin/cancellation-requests/${requestId}`, {
    headers: adminHeaders(),
  });
  return data.request || null;
}

export async function approveAdminCancellationRequest(
  requestId,
  adminNote = "",
  effectiveTiming = "",
) {
  return fetchJson(`/api/admin/cancellation-requests/${requestId}/approve`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      adminNote,
      ...(effectiveTiming ? { effectiveTiming } : {}),
    }),
  });
}

export async function rejectAdminCancellationRequest(requestId, adminNote) {
  return fetchJson(`/api/admin/cancellation-requests/${requestId}/reject`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ adminNote }),
  });
}

export async function adminDropBranchDirect(organizationId, locationId, reason = "") {
  return fetchJson(`/api/admin/organizations/${organizationId}/locations/${locationId}/drop`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ reason }),
  });
}

export function adminRequestKindLabel(kind) {
  return kind === "drop_branch" ? "Drop branch" : "Cancel product";
}

export function adminTriggerLabel(trigger) {
  switch (trigger) {
    case "system_unpaid_initial":
      return "Initial payment unpaid";
    case "system_unpaid_renewal":
      return "Renewal unpaid";
    default:
      return "Customer request";
  }
}
