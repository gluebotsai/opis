import { fetchJson } from "./http.js";

const SESSION_KEY = "worktual-session";
const AUTH_TOKEN_KEY = "worktual-auth-token";

export const SESSION_UPDATED_EVENT = "worktual-session-updated";

export const ROLES = {
  SALES: "sales",
  FINANCE: "finance",
  ADMIN: "admin",
  SALES_ADMIN: "sales_admin",
  NUMBER_MANAGEMENT: "number_management",
};

export function getSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

  // testing for github

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

export async function logout({ redirectTo = "/" } = {}) {
  const token = getAuthToken();
  clearSession();
  window.location.replace(redirectTo);

  if (token) {
    // Logout must never be blocked by a slow/locked database. The local session is
    // already gone; keepalive lets the server invalidate its session after redirect.
    void fetch("/api/auth/logout", {
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

export function isNumberManagementSession() {
  return getSession()?.role === ROLES.NUMBER_MANAGEMENT;
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
    return "/admin/users";
  }

  if (role === ROLES.SALES_ADMIN) {
    return "/dashboard";
  }

  if (role === ROLES.FINANCE) {
    return "/finance/queue";
  }

  if (role === ROLES.NUMBER_MANAGEMENT) {
    return "/number-management/dashboard";
  }

  return "/dashboard";
}

/** Mail workspace path for staff roles that use Outlook. */
export function getMailPathForRole(role) {
  if (role === ROLES.ADMIN) {
    return "/admin/mail";
  }

  if (role === ROLES.SALES_ADMIN) {
    return "/mail";
  }

  if (role === ROLES.FINANCE) {
    return "/finance/mail";
  }

  if (role === ROLES.NUMBER_MANAGEMENT) {
    return "/number-management/mail";
  }

  if (role === ROLES.SALES) {
    return "/mail";
  }

  return "/mail";
}
