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
};

export type HttpClient = {
  request: <T>(options: RequestOptions) => Promise<T>;
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

  async function request<T>(options: RequestOptions): Promise<T> {
    const authHeaders = resolveAuthHeader(config, options.auth);
    const url = `${baseUrl}${options.path}${buildQuery(options.query)}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...authHeaders,
      ...options.headers,
    };

    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const res = await fetchImpl(url, {
      method: options.method || (options.body !== undefined ? "POST" : "GET"),
      headers,
      body,
    });

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

  return { request, config };
}
