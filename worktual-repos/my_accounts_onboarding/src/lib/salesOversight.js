import { clearSession, getAuthToken } from "./auth.js";
import { fetchJson } from "./http.js";

const SESSION_EXPIRED_MESSAGE = "Session expired. Please sign in again.";

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function ensureAuthToken() {
  if (!getAuthToken()) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
}

function handleAuthFailure(error) {
  const message = error instanceof Error ? error.message : "";
  if (message === "Authentication required." || message.includes("(401)")) {
    clearSession();
    window.location.assign("/?reason=session-expired");
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  throw error;
}

async function fetchOversightJson(url, options = {}) {
  ensureAuthToken();

  try {
    return await fetchJson(url, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    handleAuthFailure(error);
  }
}

export const DATE_RANGE_OPTIONS = [
  { value: 0, label: "Today" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

export function getPeriodComparisonLabel(days) {
  if (Number(days) === 0) {
    return "yesterday";
  }
  return `last ${days} days`;
}

export async function fetchOversightDashboard(days = 30) {
  return fetchOversightJson(`/api/sales-oversight/dashboard?days=${days}`);
}

export async function fetchOversightAgents(days = 30) {
  return fetchOversightJson(`/api/sales-oversight/agents?days=${days}`);
}

export async function fetchOversightAgentDetail(userId, days = 30) {
  return fetchOversightJson(`/api/sales-oversight/agents/${userId}?days=${days}`);
}

export async function fetchOversightLeadDetail(leadId) {
  return fetchOversightJson(`/api/sales-oversight/leads/${leadId}`);
}

export async function fetchUnassignedLeads() {
  return fetchOversightJson("/api/sales-oversight/unassigned-leads");
}

export async function reassignLead(leadId, { toUserId, reason = "" }) {
  return fetchOversightJson(`/api/sales-oversight/leads/${leadId}/assign`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toUserId, reason }),
  });
}

export async function logOversightExportAudit(payload) {
  return fetchOversightJson("/api/sales-oversight/export-audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function formatOversightCurrency(value, currency = "INR") {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCompactInr(value) {
  const amount = Number(value) || 0;
  if (amount >= 100000) {
    return `₹ ${(amount / 100000).toFixed(1)}L`;
  }
  if (amount >= 1000) {
    return `₹ ${(amount / 1000).toFixed(1)}K`;
  }
  return formatOversightCurrency(amount);
}

export function formatRelativeTime(value) {
  if (!value) {
    return "";
  }

  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function agentInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function formatOversightDate(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
