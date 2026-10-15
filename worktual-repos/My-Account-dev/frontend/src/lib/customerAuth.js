import { fetchJson } from "./http.js";
import { loginCustomerUser as loginCustomerUserApi } from "./organizations.js";

const CUSTOMER_SESSION_KEY = "worktual-customer-session";
const CUSTOMER_TOKEN_KEY = "worktual-customer-token";

export const CUSTOMER_SESSION_UPDATED_EVENT = "worktual-customer-session-updated";

export function getCustomerSession() {
  try {
    const raw = window.localStorage.getItem(CUSTOMER_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getCustomerToken() {
  return window.localStorage.getItem(CUSTOMER_TOKEN_KEY) || "";
}

export function isCustomerOrgAdmin(_session = getCustomerSession()) {
  return false;
}

export function isCustomerBranchUser(session = getCustomerSession()) {
  return Boolean(session?.branchId) || session?.role === "branch_user" || Boolean(session);
}

export function saveCustomerSession({
  email,
  token,
  organizationId,
  displayName = "",
  role = "branch_user",
  branchId = null,
  branchLabel = "",
  mustChangePassword = false,
}) {
  window.localStorage.setItem(
    CUSTOMER_SESSION_KEY,
    JSON.stringify({
      email,
      organizationId,
      displayName,
      role,
      branchId,
      branchLabel,
      mustChangePassword: Boolean(mustChangePassword),
      createdAt: new Date().toISOString(),
    }),
  );

  if (token) {
    window.localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
  }

  window.dispatchEvent(new CustomEvent(CUSTOMER_SESSION_UPDATED_EVENT));
}

export function customerMustChangePassword(session = getCustomerSession()) {
  return Boolean(session?.mustChangePassword);
}

export function clearCustomerSession() {
  window.localStorage.removeItem(CUSTOMER_SESSION_KEY);
  window.localStorage.removeItem(CUSTOMER_TOKEN_KEY);
}

export async function loginCustomer(email, password) {
  const result = await loginCustomerUserApi(email, password);
  saveCustomerSession({
    email: result.email,
    token: result.token,
    organizationId: result.organizationId,
    displayName: result.user?.displayName || "",
    role: result.user?.role || "branch_user",
    branchId: result.user?.branchId || null,
    branchLabel: result.user?.branchLabel || "",
    mustChangePassword: Boolean(result.mustChangePassword ?? result.user?.mustChangePassword),
  });
  return result;
}

export function logoutCustomer({ redirectTo = "/" } = {}) {
  const token = getCustomerToken();
  clearCustomerSession();
  window.location.replace(redirectTo);

  if (token) {
    // Local session is already cleared; keepalive revokes the server row after redirect.
    void fetch("/api/v1/customer/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      keepalive: true,
    }).catch(() => {
      // Local logout is complete even when server-side invalidation is unavailable.
    });
  }
}

export async function provisionCustomerPortalAccess(leadId) {
  const { getAuthToken } = await import("./auth.js");
  const token = getAuthToken();
  return fetchJson(`/api/leads/${leadId}/customer-portal-access`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function resendCustomerWelcomeEmail(leadId) {
  const { getAuthToken } = await import("./auth.js");
  const token = getAuthToken();
  return fetchJson(`/api/leads/${leadId}/resend-welcome-email`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
