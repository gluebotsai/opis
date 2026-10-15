import { env } from "./env";

/** Build a versioned API path, e.g. apiV1("/auth/login") → "/v1/auth/login" (QA) or "/api/v1/auth/login" (local). */
export function apiV1(suffix: string): string {
  const normalized = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${env.apiV1Prefix}${normalized}`;
}
