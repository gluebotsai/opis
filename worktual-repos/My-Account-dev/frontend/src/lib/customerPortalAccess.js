import { fetchJson } from "./http.js";
import { getAuthToken } from "./auth.js";

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listCustomerPortalUsers(leadId) {
  return fetchJson(`/api/leads/${leadId}/customer-portal-users`, {
    headers: authHeaders(),
  });
}

export async function listAdminCustomerPortalUsers(query = "", { signal } = {}) {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await fetchJson(`/api/admin/customer-users${suffix}`, {
    headers: authHeaders(),
    signal,
  });
  return data?.users || [];
}

export async function forceLogoutCustomerPortalUser(customerUserId) {
  return fetchJson(`/api/admin/customer-users/${customerUserId}/force-logout`, {
    method: "POST",
    headers: authHeaders(),
  });
}

export async function updateCustomerPortalUserActive(customerUserId, isActive) {
  return fetchJson(`/api/admin/customer-users/${customerUserId}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ isActive: Boolean(isActive) }),
  });
}

export async function deleteCustomerPortalUser(customerUserId) {
  return fetchJson(`/api/admin/customer-users/${customerUserId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

export async function provisionBranchPortalAccess(leadId, branchId) {
  return fetchJson(`/api/leads/${leadId}/customer-portal-access/branches/${branchId}`, {
    method: "POST",
    headers: authHeaders(),
  });
}
