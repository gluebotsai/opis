import type { AuthMode, TicketingClientConfig } from "./types.js";

export class TicketingAuthError extends Error {
  readonly code = "AUTH_CONFIG";

  constructor(message: string) {
    super(message);
    this.name = "TicketingAuthError";
  }
}

export function partnerApiKey(config: TicketingClientConfig): string {
  return String(config.partnerApiKey || config.apiKey || "").trim();
}

export function resolveAuthHeader(
  config: TicketingClientConfig,
  mode: AuthMode,
  accessTokenOverride?: string
): Record<string, string> {
  if (mode === "none") return {};
  if (mode === "apiKey" || mode === "partnerKey") {
    const key = mode === "partnerKey" ? partnerApiKey(config) : String(config.apiKey || "").trim();
    if (!key) {
      throw new TicketingAuthError(
        mode === "partnerKey"
          ? "partnerApiKey or apiKey is required (org key wt_live_…). Do not use this key in a browser."
          : "apiKey is required for this call (org key wt_live_…). Do not use this key in a browser."
      );
    }
    return { "X-Api-Key": key };
  }

  const token = String(accessTokenOverride || config.accessToken || "").trim();
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
