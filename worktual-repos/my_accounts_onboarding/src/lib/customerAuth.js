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

export function isCustomerOrgAdmin(session = getCustomerSession()) {
  return !session?.locationId && (session?.role === "org_admin" || !session?.role);
}

export function isCustomerBranchUser(session = getCustomerSession()) {
  return Boolean(session?.locationId) || session?.role === "branch_user";
}

export function saveCustomerSession({
  email,
  token,
  organizationId,
  displayName = "",
  role = "org_admin",
  locationId = null,
  locationLabel = "",
}) {
  window.localStorage.setItem(
    CUSTOMER_SESSION_KEY,
    JSON.stringify({
      email,
      organizationId,
      displayName,
      role,
      locationId,
      locationLabel,
      createdAt: new Date().toISOString(),
    }),
  );

  if (token) {
    window.localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
  }

  window.dispatchEvent(new CustomEvent(CUSTOMER_SESSION_UPDATED_EVENT));
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
    role: result.user?.role || "org_admin",
    locationId: result.user?.locationId || null,
    locationLabel: result.user?.locationLabel || "",
  });
  return result;
}

export function logoutCustomer() {
  clearCustomerSession();
}

export async function provisionCustomerPortalAccess(leadId) {
  const { getAuthToken } = await import("./auth.js");
  const token = getAuthToken();
  return fetchJson(`/api/leads/${leadId}/customer-portal-access`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
