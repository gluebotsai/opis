import type { AuthMode, TicketingClientConfig } from "./types.js";

export class TicketingAuthError extends Error {
  readonly code = "AUTH_CONFIG";

  constructor(message: string) {
    super(message);
    this.name = "TicketingAuthError";
  }
}

export function resolveAuthHeader(
  config: TicketingClientConfig,
  mode: AuthMode
): Record<string, string> {
  if (mode === "apiKey") {
    const key = String(config.apiKey || "").trim();
    if (!key) {
      throw new TicketingAuthError(
        "apiKey is required for this call (org key wt_live_…). Do not use this key in a browser."
      );
    }
    return { "X-Api-Key": key };
  }

  const token = String(config.accessToken || "").trim();
  if (!token) {
    throw new TicketingAuthError(
      "accessToken is required for this call (staff or CRM JWT as Authorization Bearer)."
    );
  }
  return { Authorization: `Bearer ${token}` };
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) {
    throw new TicketingAuthError("baseUrl is required");
  }
  return trimmed.replace(/\/+$/, "");
}
