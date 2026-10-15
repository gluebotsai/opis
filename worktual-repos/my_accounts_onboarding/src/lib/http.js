import { getAuthToken } from "./auth.js";
import { getCustomerToken } from "./customerAuth.js";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/sign-in",
  "/api/v1/customer/login",
  "/api/v1/invite/setup-user",
  "/api/v1/invite/setup-user/set-password",
  "/api/health",
  "/api/payments/config",
  "/api/pricing-catalog",
]);

function isPublicApiUrl(url) {
  const path = String(url).split("?")[0];
  return PUBLIC_API_PATHS.has(path);
}

function withAuthHeaders(url, headers = {}) {
  if (!String(url).startsWith("/api/") || isPublicApiUrl(url)) {
    return headers;
  }

  if (headers.Authorization) {
    return headers;
  }

  const token = getAuthToken() || getCustomerToken();
  if (!token) {
    return headers;
  }

  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchJson(url, options = {}) {
  let response;

  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = withAuthHeaders(url, options.headers || {});
  if (isFormData) {
    delete headers["Content-Type"];
  }

  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    throw new Error(
      "Cannot reach the API server. Start both servers with: npx pnpm dev:all",
    );
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 404 && String(url).startsWith("/api/")) {
      throw new Error(
        "API route not found. Restart dev with: npx pnpm dev:all (stale mail API on port 3002).",
      );
    }

    if (response.status === 401 && String(url).startsWith("/api/") && !isPublicApiUrl(url)) {
      throw new Error(data.error || "Authentication required. Please sign in again.");
    }

    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }

  return data;
}
