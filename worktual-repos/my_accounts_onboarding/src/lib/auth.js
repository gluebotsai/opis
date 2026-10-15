import { fetchJson } from "./http.js";

const SESSION_KEY = "worktual-session";
const AUTH_TOKEN_KEY = "worktual-auth-token";

export const SESSION_UPDATED_EVENT = "worktual-session-updated";

export const ROLES = {
  SALES: "sales",
  FINANCE: "finance",
  ADMIN: "admin",
  SALES_ADMIN: "sales_admin",
};

export function getSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession({ email, role, token, rememberMe, userId = null, displayName = "" }) {
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      email,
      role,
      userId,
      displayName,
      rememberMe: Boolean(rememberMe),
      createdAt: new Date().toISOString(),
    }),
  );

  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT));
}

export function getAuthToken() {
  return (
    window.localStorage.getItem(AUTH_TOKEN_KEY) ||
    window.localStorage.getItem("worktual-finance-token") ||
    ""
  );
}

export function getFinanceToken() {
  return getAuthToken();
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function logout() {
  const token = getAuthToken();
  if (token) {
    try {
      await fetchJson("/api/auth/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // Local session is cleared even if the server call fails.
    }
  }

  clearSession();
}

export function isSalesSession() {
  return getSession()?.role === ROLES.SALES;
}

export function isFinanceSession() {
  return getSession()?.role === ROLES.FINANCE;
}

export function isAdminSession() {
  return getSession()?.role === ROLES.ADMIN;
}

export function isSalesAdminSession() {
  return getSession()?.role === ROLES.SALES_ADMIN;
}

export async function login(email, password) {
  return fetchJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export function getHomePathForRole(role) {
  if (role === ROLES.ADMIN) {
    return "/admin/pricing";
  }

  if (role === ROLES.SALES_ADMIN) {
    return "/dashboard";
  }

  if (role === ROLES.FINANCE) {
    return "/finance/queue";
  }

  return "/dashboard";
}
