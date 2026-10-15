import { fetchJson } from "./http.js";
import {
  clearSession,
  getAuthToken,
  getHomePathForRole,
  getMailPathForRole,
  getSession,
  saveSession,
} from "./auth.js";
import {
  clearCustomerSession,
  getCustomerSession,
  getCustomerToken,
  saveCustomerSession,
} from "./customerAuth.js";
import {
  clearPartnerSession,
  getPartnerSession,
  getPartnerToken,
  savePartnerSession,
} from "./partnerAuth.js";
import {
  clearResellerSession,
  getResellerSession,
  getResellerToken,
  saveResellerSession,
} from "./resellerAuth.js";
import {
  clearMailOAuthPopupPending,
  fetchMailConfigStatus,
  mailConfigNeedsOutlookConnect,
  roleHasMailAccess,
  startMailOAuthConnect,
  startMailOAuthRedirect,
} from "./email.js";

export function resolveSignedInHomePath() {
  const internalSession = getSession();
  const internalToken = getAuthToken();
  if (internalSession?.role && internalToken) {
    return getHomePathForRole(internalSession.role);
  }

  const resellerSession = getResellerSession();
  const resellerToken = getResellerToken();
  if (resellerSession?.email && resellerToken) {
    return "/reseller/dashboard";
  }

  const partnerSession = getPartnerSession();
  const partnerToken = getPartnerToken();
  if (partnerSession?.email && partnerToken) {
    return "/partner/dashboard";
  }

  const customerSession = getCustomerSession();
  const customerToken = getCustomerToken();
  if (customerSession?.email && customerToken) {
    return customerSession.mustChangePassword ? "/customer/account" : "/customer/dashboard";
  }

  return null;
}

export async function validateStoredSession() {
  const homePath = resolveSignedInHomePath();
  if (!homePath) {
    return null;
  }

  const internalSession = getSession();
  const internalToken = getAuthToken();
  if (internalSession?.role && internalToken) {
    try {
      await fetchJson("/api/auth/me", {
        headers: { Authorization: `Bearer ${internalToken}` },
      });
      return homePath;
    } catch {
      clearSession();
      return null;
    }
  }

  const resellerSession = getResellerSession();
  const resellerToken = getResellerToken();
  if (resellerSession?.email && resellerToken) {
    try {
      await fetchJson("/api/reseller/me", {
        headers: { Authorization: `Bearer ${resellerToken}` },
      });
      return homePath;
    } catch {
      clearResellerSession();
      return null;
    }
  }

  const partnerSession = getPartnerSession();
  const partnerToken = getPartnerToken();
  if (partnerSession?.email && partnerToken) {
    try {
      await fetchJson("/api/partner/me", {
        headers: { Authorization: `Bearer ${partnerToken}` },
      });
      return homePath;
    } catch {
      clearPartnerSession();
      return null;
    }
  }

  const customerSession = getCustomerSession();
  const customerToken = getCustomerToken();
  if (customerSession?.email && customerToken) {
    try {
      await fetchJson("/api/v1/me/entitlements", {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      return homePath;
    } catch {
      clearCustomerSession();
      return null;
    }
  }

  return null;
}

export async function signInAndStoreSession(email, password, { rememberMe = false } = {}) {
  const result = await fetchJson("/api/auth/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (result.accountType === "reseller") {
    clearSession();
    clearCustomerSession();
    clearPartnerSession();
    saveResellerSession({
      email: result.email,
      token: result.token,
      resellerId: result.resellerId,
      displayName: result.user?.displayName || "",
      companyName: result.user?.companyName || "",
    });
    window.location.replace("/reseller/dashboard");
    return { accountType: "reseller", path: "/reseller/dashboard" };
  }

  if (result.accountType === "partner") {
    clearSession();
    clearCustomerSession();
    clearResellerSession();
    savePartnerSession({
      email: result.email,
      token: result.token,
      partnerId: result.partnerId,
      displayName: result.user?.displayName || "",
      companyName: result.user?.companyName || "",
    });
    window.location.replace("/partner/dashboard");
    return { accountType: "partner", path: "/partner/dashboard" };
  }

  if (result.accountType === "customer") {
    clearSession();
    clearResellerSession();
    clearPartnerSession();
    const mustChangePassword = Boolean(
      result.mustChangePassword ?? result.user?.mustChangePassword,
    );
    saveCustomerSession({
      email: result.email,
      token: result.token,
      organizationId: result.organizationId,
      displayName: result.user?.displayName || "",
      role: result.user?.role || "branch_user",
      branchId: result.user?.branchId || null,
      branchLabel: result.user?.branchLabel || "",
      mustChangePassword,
    });
    const customerPath = mustChangePassword ? "/customer/account" : "/customer/dashboard";
    window.location.replace(customerPath);
    return { accountType: "customer", path: customerPath };
  }

  clearCustomerSession();
  clearResellerSession();
  clearPartnerSession();
  saveSession({
    email: result.email,
    role: result.role,
    token: result.token,
    rememberMe,
    userId: result.userId || result.profile?.id || null,
    displayName: result.displayName || result.profile?.displayName || "",
  });

  const path = getHomePathForRole(result.role);
  const mailPath = getMailPathForRole(result.role);

  // Only start Microsoft OAuth when Outlook is not already connected (no offline
  // token / needs reauth). Skip any tab open/close when a token already exists.
  if (roleHasMailAccess(result.role)) {
    try {
      const mailConfig = await fetchMailConfigStatus(result.role);
      if (mailConfigNeedsOutlookConnect(mailConfig)) {
        // Prefer a new tab; if the browser blocks it after async login, use same-tab.
        const oauth = await startMailOAuthConnect(mailPath, { mode: "popup" });
        if (oauth.opened) {
          // Popup may be closed without completing — clear pending so Mail can retry.
          // Mail page shows Sign in with Microsoft when still disconnected.
          window.setTimeout(() => {
            clearMailOAuthPopupPending();
          }, 1500);
          window.location.replace(path);
          return {
            accountType: "internal",
            path,
            outlookPopup: true,
          };
        }

        if (oauth.fallbackUsed || oauth.redirected) {
          return {
            accountType: "internal",
            path: mailPath,
            outlookRedirect: true,
          };
        }

        clearMailOAuthPopupPending();
        const redirect = await startMailOAuthRedirect(mailPath);
        if (redirect.redirected) {
          return {
            accountType: "internal",
            path: mailPath,
            outlookRedirect: true,
          };
        }

        // Could not open popup or redirect — land on Mail so the Connect CTA is visible.
        clearMailOAuthPopupPending();
        window.location.replace(mailPath);
        return {
          accountType: "internal",
          path: mailPath,
          outlookConnectNeeded: true,
        };
      } else {
        clearMailOAuthPopupPending();
      }
    } catch (error) {
      clearMailOAuthPopupPending();
      console.warn(
        "[auth] Outlook connect check skipped after login:",
        error instanceof Error ? error.message : error,
      );
    }
  } else {
    clearMailOAuthPopupPending();
  }

  window.location.replace(path);
  return {
    accountType: "internal",
    path,
  };
}
