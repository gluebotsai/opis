import { getAuthToken } from "./auth.js";
import { fetchJson } from "./http.js";

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchActiveResellers() {
  const data = await fetchJson("/api/resellers/active", { headers: authHeaders() });
  return data.resellers || [];
}

export async function fetchManagedResellers() {
  const data = await fetchJson("/api/admin/resellers", { headers: authHeaders() });
  return data.resellers || [];
}

export async function createManagedReseller(payload) {
  const data = await fetchJson("/api/admin/resellers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return {
    reseller: data.reseller,
    emailSent: Boolean(data.emailSent),
    emailError: data.emailError || null,
  };
}

export async function updateManagedReseller(resellerId, payload) {
  const data = await fetchJson(`/api/admin/resellers/${resellerId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return data.reseller;
}

export async function forceLogoutManagedReseller(resellerId) {
  return fetchJson(`/api/admin/resellers/${resellerId}/force-logout`, {
    method: "POST",
    headers: authHeaders(),
  });
}
