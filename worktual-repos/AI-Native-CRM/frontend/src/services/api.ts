import axios, { type AxiosResponse } from "axios";
import { notifyCrmSessionRevoked } from "@/lib/crm-session-revoked";
import { meetingAssistPanelAuthHeaders } from "@/lib/meeting-assist-panel-auth";
import { store } from "@/store";

/** Browser calls same-origin /api; Vite proxies to Fastify :4000. */
export const api = axios.create({
  baseURL: "/",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const panelHeaders = meetingAssistPanelAuthHeaders();
  for (const [key, value] of Object.entries(panelHeaders)) {
    config.headers.set(key, value);
  }
  // Free ngrok HTML interstitial breaks Meet iframe JSON/SSE unless skipped.
  if (typeof window !== "undefined" && /\.ngrok-free\.(dev|app)$/i.test(window.location.hostname)) {
    config.headers.set("ngrok-skip-browser-warning", "true");
  }
  return config;
});

type Envelope = {
  statusCode: number;
  message: string;
  [key: string]: unknown;
};

function maybeNotifySessionRevoked(
  response: AxiosResponse,
  data: Record<string, unknown>,
): void {
  if (data.code !== "session_revoked_elsewhere") return;
  if (!store.getState().auth.user) return;
  const url = String(response.config?.url || "");
  if (url.includes("/api/auth/login") || url.includes("/api/auth/logout")) return;
  if (data.code !== "session_revoked_elsewhere") return;
  notifyCrmSessionRevoked();
}

function isEnvelope(body: unknown): body is Envelope {
  return (
    !!body &&
    typeof body === "object" &&
    typeof (body as Envelope).statusCode === "number" &&
    typeof (body as Envelope).message === "string"
  );
}

/**
 * Unwrap { statusCode, message, ...payload } → legacy { ok, ... }.
 * Also supports older bodies that still have metaResponse.
 */
function unwrapEnvelope(response: AxiosResponse): AxiosResponse {
  const body = response.data;
  if (!isEnvelope(body)) return response;

  if (body.statusCode >= 400) {
    const {
      statusCode: _statusCode,
      message,
      error: _error,
      ok: _ok,
      ...rest
    } = body;
    const data = {
      ok: false,
      error: message || "Request failed",
      ...rest,
    };
    response.data = data;
    maybeNotifySessionRevoked(response, data);
    return response;
  }

  const {
    statusCode: _statusCode,
    message,
    metaResponse,
    error: _error,
    ...rest
  } = body;

  // Legacy nested payload
  if (metaResponse !== undefined) {
    if (metaResponse && typeof metaResponse === "object" && !Array.isArray(metaResponse)) {
      response.data =
        "ok" in (metaResponse as object)
          ? metaResponse
          : { ok: true, ...(metaResponse as Record<string, unknown>) };
    } else if (metaResponse !== null) {
      response.data = { ok: true, data: metaResponse, message };
    } else {
      response.data = { ok: true, message };
    }
    return response;
  }

  response.data = { ok: true, ...rest, ...(message ? { message } : {}) };
  return response;
}

/**
 * Backend envelope: { statusCode, message, ...payload }
 * Services still consume { ok: true/false, ... }.
 */
api.interceptors.response.use(
  (response) => unwrapEnvelope(response),
  (error) => {
    if (error.response) {
      unwrapEnvelope(error.response);
      return Promise.resolve(error.response);
    }
    return Promise.reject(error);
  },
);
