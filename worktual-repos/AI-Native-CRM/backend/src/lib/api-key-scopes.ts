/**
 * Tenant API key scopes for machine integrations.
 */

export const API_KEY_SCOPES = [
  "contacts",
  "companies",
  "deals",
  "activities",
  "appointments",
  "products",
  "quotes",
  "invoices",
  "commerce",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

export function normalizeApiKeyScopes(raw: unknown): ApiKeyScope[] {
  if (!Array.isArray(raw)) return [];
  const out: ApiKeyScope[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim().toLowerCase();
    if (isApiKeyScope(v) && !out.includes(v)) out.push(v);
  }
  return out;
}
