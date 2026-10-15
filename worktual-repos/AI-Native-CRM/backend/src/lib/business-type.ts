import type { BusinessType } from "@/config/modules";

/**
 * Business type prefers account DB column when provided at login.
 * Email local-part tokens remain a fallback for legacy rows:
 * - token "b2b2c" or "hybrid" → B2B2C
 * - token "b2c" or "consumer" → B2C
 * - otherwise → B2B
 */
export function resolveBusinessTypeFromCredentials(email: string): BusinessType {
  const local = email.trim().toLowerCase().split("@")[0] ?? "";
  const tokens = local.split(/[._-]+/).filter(Boolean);
  if (tokens.includes("b2b2c") || tokens.includes("hybrid")) return "b2b2c";
  if (tokens.includes("b2c") || tokens.includes("consumer")) return "b2c";
  return "b2b";
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
