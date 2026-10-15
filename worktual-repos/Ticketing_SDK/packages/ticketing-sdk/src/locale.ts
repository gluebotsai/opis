import { TicketingAuthError } from "./auth.js";

/** Empty becomes the client default, then `en`. Invalid tags throw. */
export function resolveLocale(explicit?: string, fallback?: string): string {
  const raw = String(explicit || fallback || "en").trim();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(raw)) {
    throw new TicketingAuthError(
      "locale must be a BCP 47 tag such as en or es-MX"
    );
  }
  return raw;
}
