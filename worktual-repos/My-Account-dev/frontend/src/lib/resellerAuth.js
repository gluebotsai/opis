import { fetchJson } from "./http.js";

const RESELLER_SESSION_KEY = "worktual-reseller-session";
const RESELLER_TOKEN_KEY = "worktual-reseller-token";

export const RESELLER_SESSION_UPDATED_EVENT = "worktual-reseller-session-updated";

export function getResellerSession() {
  try {
    const raw = window.localStorage.getItem(RESELLER_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getResellerToken() {
  return window.localStorage.getItem(RESELLER_TOKEN_KEY) || "";
}

export function saveResellerSession({
  email,
  token,
  resellerId,
  displayName = "",
  companyName = "",
}) {
  window.localStorage.setItem(
    RESELLER_SESSION_KEY,
    JSON.stringify({
      email,
      resellerId,
      displayName,
      companyName,
      createdAt: new Date().toISOString(),
    }),
  );

  if (token) {
    window.localStorage.setItem(RESELLER_TOKEN_KEY, token);
  }

  window.dispatchEvent(new CustomEvent(RESELLER_SESSION_UPDATED_EVENT));
}

export function clearResellerSession() {
  window.localStorage.removeItem(RESELLER_SESSION_KEY);
  window.localStorage.removeItem(RESELLER_TOKEN_KEY);
}

export async function logoutReseller({ redirectTo = "/" } = {}) {
  const token = getResellerToken();
  if (token) {
    try {
      await fetchJson("/api/reseller/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // Local session is cleared even if the server call fails.
    }
  }

  clearResellerSession();
  window.location.replace(redirectTo);
}

export async function fetchResellerProfile() {
  return fetchJson("/api/reseller/me");
}

export async function fetchResellerLeads() {
  const data = await fetchJson("/api/reseller/leads");
  return data.leads || [];
}

export async function fetchResellerLeadById(leadId) {
  const data = await fetchJson(`/api/reseller/leads/${leadId}`);
  return data.lead || null;
}

export async function fetchResellerRenewals({ withinDays = 90 } = {}) {
  const data = await fetchJson(`/api/reseller/renewals?withinDays=${withinDays}`);
  return data.renewals || [];
}

export async function fetchResellerInvoices() {
  const data = await fetchJson("/api/reseller/invoices");
  return data.invoices || [];
}

export async function createResellerLead(payload) {
  const data = await fetchJson("/api/reseller/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.lead;
}

export async function updateResellerLead(leadId, updates) {
  const data = await fetchJson(`/api/reseller/leads/${leadId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return data.lead;
}

export async function deleteResellerLead(leadId) {
  return fetchJson(`/api/reseller/leads/${leadId}`, {
    method: "DELETE",
  });
}

export async function changeResellerPassword(currentPassword, newPassword) {
  return fetchJson("/api/reseller/me/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
