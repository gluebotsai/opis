import axios, {
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import {
  clearEmbedAuth,
  getEmbedToken,
  isEmbedMode,
  requestEmbedTokenRefresh,
} from "@/lib/embed-auth";

const TOKEN_KEY = "worktual.campaign.jwt";

type EmbedAwareConfig = InternalAxiosRequestConfig & {
  _usedEmbedToken?: boolean;
  _embedRetried?: boolean;
  /** Bearer token attached when this request was sent (detects login races). */
  _sentAuthToken?: string | null;
};

function getSpaToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function resolveAuthToken(): { token: string | null; usedEmbed: boolean } {
  const embed = getEmbedToken();
  const spa = getSpaToken();
  if (isEmbedMode()) {
    return { token: embed, usedEmbed: Boolean(embed) };
  }
  // Standalone SPA: never fall back to a leftover CRM embed JWT.
  return { token: spa, usedEmbed: false };
}

/** Campaign SPA login token (localStorage). CRM embed uses sessionStorage via embed-auth. */
export function getToken(): string | null {
  return resolveAuthToken().token;
}

export function setToken(token: string | null) {
  try {
    if (!token) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

/** Drop stale standalone login JWT when CRM iframe auth is active. */
export function clearSpaToken(): void {
  setToken(null);
}

export const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config: EmbedAwareConfig) => {
  const { token, usedEmbed } = resolveAuthToken();
  config._sentAuthToken = token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    config._usedEmbedToken = usedEmbed;
  } else {
    config._usedEmbedToken = false;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error.response?.status;
    const config = error.config as EmbedAwareConfig | undefined;

    // Transient backend / account-DB outages must not clear a valid session.
    if (status === 503) {
      return Promise.reject(error);
    }

    if (status === 401 && config && !config._embedRetried) {
      const current = resolveAuthToken().token;
      // A newer login/token replaced what this request used — do not wipe it.
      if (
        config._sentAuthToken &&
        current &&
        current !== config._sentAuthToken
      ) {
        return Promise.reject(error);
      }
      // Request went out unauthenticated; login landed meanwhile — keep new JWT.
      if (!config._sentAuthToken && current) {
        return Promise.reject(error);
      }

      if (isEmbedMode()) {
        clearEmbedAuth();
        clearSpaToken();
        const newToken = await requestEmbedTokenRefresh();
        if (newToken) {
          config._embedRetried = true;
          config.headers.Authorization = `Bearer ${newToken}`;
          config._usedEmbedToken = true;
          config._sentAuthToken = newToken;
          return api.request(config);
        }
        return Promise.reject(
          Object.assign(error, {
            message: "CRM session expired. Waiting for a new sign-in from CRM.",
          }),
        );
      }

      // Standalone SPA: only treat /auth/* 401 as a real logout. Gallery /
      // campaigns / hydrates returning 401 (e.g. account DB blip) must not
      // bounce a freshly logged-in user back to /login.
      const reqUrl = String(config.url || "");
      const isAuthProbe =
        reqUrl.includes("/auth/me") ||
        reqUrl.includes("/auth/logout") ||
        reqUrl.endsWith("/auth/me") ||
        reqUrl.endsWith("/auth/logout");
      if (!isAuthProbe) {
        return Promise.reject(error);
      }

      // Password login already hydrated Redux — a stale /auth/me 401 must not
      // clear the fresh JWT or hard-redirect away from the dashboard.
      // Lazy import avoids a circular dependency (api ↔ store ↔ authSlice).
      try {
        const { store } = await import("@/store");
        const auth = store.getState().auth;
        if (auth.status === "authenticated" && auth.user && current) {
          return Promise.reject(error);
        }
      } catch {
        /* store not ready */
      }

      setToken(null);
      clearEmbedAuth();
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }

    return Promise.reject(error);
  },
);

/** In-flight GET dedupe — Strict Mode remounts / rapid nav share one network call. */
const inflightGets = new Map<string, Promise<{ data: unknown }>>();

function getKey(url: string, config?: AxiosRequestConfig) {
  const params = config?.params ? JSON.stringify(config.params) : "";
  return `${url}?${params}`;
}

export async function apiGet<T>(url: string, config?: AxiosRequestConfig) {
  const key = getKey(url, config);
  const existing = inflightGets.get(key);
  if (existing) {
    return existing as Promise<{ data: T }>;
  }

  const request = api.get<T>(url, config).finally(() => {
    inflightGets.delete(key);
  });

  inflightGets.set(key, request as Promise<{ data: unknown }>);
  return request;
}

export async function apiPost<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
) {
  return api.post<T>(url, body, config);
}

export async function apiPut<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
) {
  return api.put<T>(url, body, config);
}

export async function apiPatch<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
) {
  return api.patch<T>(url, body, config);
}

export async function apiDelete<T>(url: string, config?: AxiosRequestConfig) {
  return api.delete<T>(url, config);
}
