import axios, { type AxiosInstance } from "axios";

import { env } from "@/config/env";
import { shouldClearCurrentSession } from "@/services/http-auth";
import { STORAGE_KEY } from "@/store/slices/auth-slice";

function isNumericEntityId(id: string | undefined): id is string {
  return typeof id === "string" && /^\d+$/.test(id);
}

export function readAuthFromStorage(): {
  token?: string;
  organizationId?: string;
  userId?: string;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      token?: string;
      organizationId?: string;
      id?: string;
    };
    return {
      token: parsed.token,
      organizationId: isNumericEntityId(parsed.organizationId)
        ? parsed.organizationId
        : undefined,
      userId: isNumericEntityId(parsed.id) ? parsed.id : undefined,
    };
  } catch {
    return {};
  }
}

function createClient(baseURL: string, serviceLabel = "cc-core"): AxiosInstance {
  const isCcCore = serviceLabel === "cc-core";
  const client = axios.create({
    baseURL,
    headers: {
      "Content-Type": "application/json",
    },
  });

  client.interceptors.request.use((config) => {
    const auth = readAuthFromStorage();
    if (auth.token) {
      config.headers.Authorization = `Bearer ${auth.token}`;
    } else if (import.meta.env.DEV) {
      const tenantId = auth.organizationId ?? env.tenantId;
      const userId = auth.userId ?? env.userId;
      if (tenantId) config.headers["x-tenant-id"] = tenantId;
      if (userId) config.headers["x-user-id"] = userId;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error?.response?.status === 401) {
        const isAuthHandshake =
          error?.config?.url?.includes("/auth/login") ||
          error?.config?.url?.includes("/auth/onboarding-exchange");
        if (isAuthHandshake) {
          const message =
            error?.response?.data?.message ||
            error?.response?.data?.error ||
            "Invalid email or password.";
          return Promise.reject(new Error(message));
        }

        if (error?.config?.url?.includes("/sip/session")) {
          const message =
            error?.response?.data?.message ||
            error?.response?.data?.error ||
            "SIP session unauthorized.";
          return Promise.reject(new Error(message));
        }

        const responseMessage =
          error?.response?.data?.message || error?.response?.data?.error;
        const requestHeaders = error?.config?.headers;
        const requestAuthorization =
          requestHeaders?.get?.("Authorization") ??
          requestHeaders?.Authorization ??
          requestHeaders?.authorization;
        const currentToken = readAuthFromStorage().token;
        if (
          shouldClearCurrentSession({
            isCcCore,
            responseMessage,
            requestAuthorization,
            currentToken,
          })
        ) {
          localStorage.removeItem(STORAGE_KEY);
          if (
            !window.location.pathname.startsWith("/login") &&
            !window.location.pathname.startsWith("/auth/onboarding")
          ) {
            window.location.replace("/login");
          }
          return Promise.reject(new Error("Session expired. Please sign in again."));
        }
      }

      if (error?.response?.status === 409) {
        const isLoginRequest =
          error?.config?.url?.includes("/auth/login") ||
          error?.config?.url?.includes("/auth/onboarding-exchange");
        if (isLoginRequest) {
          const message =
            error?.response?.data?.message ||
            error?.response?.data?.error ||
            "This account is already signed in.";
          return Promise.reject(new Error(message));
        }
      }

      if (error?.message === "Network Error" && !error?.response) {
        return Promise.reject(
          new Error(
            `Unable to reach the server. Please check that ${serviceLabel} is running and accessible.`,
          ),
        );
      }
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Request failed";
      return Promise.reject(new Error(message));
    },
  );

  return client;
}

export const ccCoreHttp = createClient(env.ccCoreUrl);
export const platformHttp = createClient(env.platformUrl, "platform-service");
export const callServiceHttp = createClient(env.callServiceUrl, "call-service");
