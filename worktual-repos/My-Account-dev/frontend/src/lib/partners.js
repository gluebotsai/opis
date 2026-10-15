import { getAuthToken } from "./auth.js";
import { fetchJson } from "./http.js";

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchManagedPartners() {
  const data = await fetchJson("/api/admin/partners", { headers: authHeaders() });
  return data.partners || [];
}

export async function createManagedPartner(payload) {
  const data = await fetchJson("/api/admin/partners", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return {
    partner: data.partner,
    emailSent: Boolean(data.emailSent),
    emailError: data.emailError || null,
  };
}

/** Uniqueness check for partner work email / mobile before leaving the Contact step. */
export async function validateManagedPartnerContacts({
  workEmail,
  loginEmail,
  mobileCountryCode,
  mobileNumber,
  partnerId,
} = {}) {
  return fetchJson("/api/admin/partners/validate-contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      workEmail,
      loginEmail: loginEmail || workEmail,
      mobileCountryCode,
      mobileNumber,
      partnerId,
    }),
  });
}

export async function updateManagedPartner(partnerId, payload) {
  const data = await fetchJson(`/api/admin/partners/${partnerId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return data.partner;
}

export async function forceLogoutManagedPartner(partnerId) {
  return fetchJson(`/api/admin/partners/${partnerId}/force-logout`, {
    method: "POST",
    headers: authHeaders(),
  });
}

export async function deleteManagedPartner(partnerId) {
  return fetchJson(`/api/admin/partners/${partnerId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}
