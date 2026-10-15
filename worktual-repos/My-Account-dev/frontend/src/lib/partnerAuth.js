import { fetchJson } from "./http.js";

const PARTNER_SESSION_KEY = "worktual-partner-session";
const PARTNER_TOKEN_KEY = "worktual-partner-token";

export const PARTNER_SESSION_UPDATED_EVENT = "worktual-partner-session-updated";

export function getPartnerSession() {
  try {
    const raw = window.localStorage.getItem(PARTNER_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getPartnerToken() {
  return window.localStorage.getItem(PARTNER_TOKEN_KEY) || "";
}

export function savePartnerSession({
  email,
  token,
  partnerId,
  displayName = "",
  companyName = "",
}) {
  window.localStorage.setItem(
    PARTNER_SESSION_KEY,
    JSON.stringify({
      email,
      partnerId,
      displayName,
      companyName,
      createdAt: new Date().toISOString(),
    }),
  );

  if (token) {
    window.localStorage.setItem(PARTNER_TOKEN_KEY, token);
  }

  window.dispatchEvent(new CustomEvent(PARTNER_SESSION_UPDATED_EVENT));
}

export function clearPartnerSession() {
  window.localStorage.removeItem(PARTNER_SESSION_KEY);
  window.localStorage.removeItem(PARTNER_TOKEN_KEY);
}

export async function logoutPartner({ redirectTo = "/" } = {}) {
  const token = getPartnerToken();
  if (token) {
    try {
      await fetchJson("/api/partner/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // Local session is cleared even if the server call fails.
    }
  }

  clearPartnerSession();
  window.location.replace(redirectTo);
}

export async function fetchPartnerProfile() {
  return fetchJson("/api/partner/me");
}

export async function fetchPartnerLeads() {
  const data = await fetchJson("/api/partner/leads");
  return data.leads || [];
}

export async function fetchPartnerLeadById(leadId) {
  const data = await fetchJson(`/api/partner/leads/${leadId}`);
  return data.lead || null;
}

export async function fetchPartnerQuotationInvoice(leadId, quotationId) {
  const data = await fetchJson(
    `/api/partner/leads/${leadId}/quotations/${quotationId}/invoice`,
  );
  return data.invoice || null;
}

export async function createPartnerLead(payload) {
  const data = await fetchJson("/api/partner/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.lead;
}

export async function updatePartnerLead(leadId, updates) {
  const data = await fetchJson(`/api/partner/leads/${leadId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return data.lead;
}

export async function deletePartnerLead(leadId) {
  return fetchJson(`/api/partner/leads/${leadId}`, {
    method: "DELETE",
  });
}

export async function changePartnerPassword(currentPassword, newPassword) {
  return fetchJson("/api/partner/me/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
