import { getAuthToken } from "./auth.js";
import { fetchJson } from "./http.js";

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchAdminInvoiceSettings() {
  const data = await fetchJson("/api/admin/invoice-settings", {
    headers: authHeaders(),
  });
  return data.settings || null;
}

export async function updateAdminInvoiceSettings(payload) {
  const data = await fetchJson("/api/admin/invoice-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return data.settings || null;
}

/** Draft preview number + bank details (does not allocate a series number). */
export async function fetchPublicInvoiceSettings() {
  return fetchJson("/api/invoice-settings", {
    headers: authHeaders(),
  });
}
