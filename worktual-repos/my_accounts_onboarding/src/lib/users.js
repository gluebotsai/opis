import { clearSession, getAuthToken, getSession, saveSession } from "./auth.js";
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

async function fetchAuthedJson(url, options = {}) {
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

export async function fetchManagedUsers() {
  return fetchAuthedJson("/api/admin/users");
}

export async function createManagedUser(payload) {
  return fetchAuthedJson("/api/admin/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function updateManagedUser(userId, payload) {
  return fetchAuthedJson(`/api/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteManagedUser(userId) {
  return fetchAuthedJson(`/api/admin/users/${userId}`, {
    method: "DELETE",
  });
}

export async function previewBulkUserUpload(csv) {
  return fetchAuthedJson("/api/admin/users/bulk/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ csv }),
  });
}

export async function importBulkUserUpload(csv) {
  return fetchAuthedJson("/api/admin/users/bulk/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ csv }),
  });
}

export async function fetchCurrentUserProfile() {
  return fetchAuthedJson("/api/auth/me");
}

export async function updateCurrentUserProfile(payload) {
  return fetchAuthedJson("/api/auth/profile", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function syncSessionProfile(user) {
  const session = getSession();
  if (!session || !user) {
    return;
  }

  saveSession({
    email: user.email || session.email,
    role: user.role || session.role,
    token: getAuthToken(),
    rememberMe: session.rememberMe,
    userId: user.id || session.userId,
    displayName: user.displayName || session.displayName,
  });
}

export function formatUserPhone(user = {}) {
  if (user.mobileNumber) {
    return `${user.mobileCountryCode || ""} ${user.mobileNumber}`.trim();
  }

  return user.phone || "";
}

export function formatUserUpdatedAt(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function getRoleLabel(role) {
  if (role === "finance") {
    return "Finance";
  }
  if (role === "sales") {
    return "Sales Executive";
  }
  if (role === "sales_admin") {
    return "Sales Admin";
  }
  if (role === "admin") {
    return "Admin";
  }
  return role;
}
