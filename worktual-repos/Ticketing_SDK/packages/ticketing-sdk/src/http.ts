import { normalizeBaseUrl, resolveAuthHeader, TicketingAuthError } from "./auth.js";
import type { AuthMode, TicketingClientConfig } from "./types.js";

export class TicketingApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly code?: string;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "TicketingApiError";
    this.status = status;
    this.body = body;
    if (body && typeof body === "object" && "code" in body) {
      const code = (body as { code?: unknown }).code;
      if (typeof code === "string") this.code = code;
    }
  }
}

export type RequestOptions = {
  method?: string;
  path: string;
  auth: AuthMode;
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Per-call Bearer token. Used when auth is `accessToken`. */
  accessToken?: string;
  /** When true, return the response body stream instead of parsing JSON. */
  stream?: boolean;
};

export type HttpClient = {
  request: <T>(options: RequestOptions) => Promise<T>;
  requestStream: (options: RequestOptions) => Promise<Response>;
  config: TicketingClientConfig;
};

function buildQuery(
  query?: Record<string, string | number | undefined | null>
): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

const COMPONENT_RE = /^[a-z0-9-]{1,64}$/;

function meteringHeaders(config: TicketingClientConfig): Record<string, string> {
  if (config.surface !== "ui") return {};
  const headers: Record<string, string> = { "X-Worktual-Sdk-Surface": "ui" };
  const component = String(config.component || "").trim().toLowerCase();
  if (COMPONENT_RE.test(component)) headers["X-Worktual-Sdk-Component"] = component;
  return headers;
}

function messageFromBody(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const obj = body as { error?: unknown; message?: unknown };
    if (typeof obj.error === "string" && obj.error.trim()) return obj.error;
    if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  }
  if (typeof body === "string" && body.trim()) return body;
  return `Ticketing API request failed (${status})`;
}

export function createHttpClient(config: TicketingClientConfig): HttpClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const fetchImpl = config.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new TicketingAuthError(
      "fetch is not available. Pass config.fetch or use Node 18+ / a modern browser."
    );
  }

  async function send(options: RequestOptions): Promise<Response> {
    const authHeaders = resolveAuthHeader(config, options.auth, options.accessToken);
    const url = `${baseUrl}${options.path}${buildQuery(options.query)}`;
    const headers: Record<string, string> = {
      Accept: options.stream ? "text/event-stream" : "application/json",
      ...authHeaders,
      ...meteringHeaders(config),
      ...options.headers,
    };

    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    return fetchImpl(url, {
      method: options.method || (options.body !== undefined ? "POST" : "GET"),
      headers,
      body,
    });
  }

  async function request<T>(options: RequestOptions): Promise<T> {
    const res = await send(options);

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      throw new TicketingApiError(messageFromBody(parsed, res.status), res.status, parsed);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return parsed as T;
  }

  async function requestStream(options: RequestOptions): Promise<Response> {
    const res = await send({ ...options, stream: true });
    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          parsed = text;
        }
      }
      throw new TicketingApiError(messageFromBody(parsed, res.status), res.status, parsed);
    }
    return res;
  }

  return { request, requestStream, config };
}
