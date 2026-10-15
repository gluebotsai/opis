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

export async function provisionBranchPortalAccess(leadId, locationId) {
  return fetchJson(`/api/leads/${leadId}/customer-portal-access/branches/${locationId}`, {
    method: "POST",
    headers: authHeaders(),
  });
}
