import { fetchJson } from "./http.js";
import {
  clearSession,
  getAuthToken,
  getHomePathForRole,
  getSession,
  saveSession,
} from "./auth.js";
import {
  clearCustomerSession,
  getCustomerSession,
  getCustomerToken,
  saveCustomerSession,
} from "./customerAuth.js";

export function resolveSignedInHomePath() {
  const internalSession = getSession();
  const internalToken = getAuthToken();
  if (internalSession?.role && internalToken) {
    return getHomePathForRole(internalSession.role);
  }

  const customerSession = getCustomerSession();
  const customerToken = getCustomerToken();
  if (customerSession?.email && customerToken) {
    return "/customer/dashboard";
  }

  return null;
}

export async function signInAndStoreSession(email, password, { rememberMe = false } = {}) {
  const result = await fetchJson("/api/auth/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (result.accountType === "customer") {
    clearSession();
    saveCustomerSession({
      email: result.email,
      token: result.token,
      organizationId: result.organizationId,
      displayName: result.user?.displayName || "",
      role: result.user?.role || "org_admin",
      locationId: result.user?.locationId || null,
      locationLabel: result.user?.locationLabel || "",
    });
    return { accountType: "customer", path: "/customer/dashboard" };
  }

  clearCustomerSession();
  saveSession({
    email: result.email,
    role: result.role,
    token: result.token,
    rememberMe,
    userId: result.userId || result.profile?.id || null,
    displayName: result.displayName || result.profile?.displayName || "",
  });

  return {
    accountType: "internal",
    path: getHomePathForRole(result.role),
  };
}
