import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "worktual_uid";

function sessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    "worktual-dev-session-secret-change-me"
  );
}

/**
 * Secure cookies require HTTPS. QA on plain http://IP must set COOKIE_SECURE=false
 * even when NODE_ENV=production, or the browser will not send the session cookie.
 * Also auto-disables when FRONTEND_ORIGIN / NEXT_PUBLIC_APP_URL is http://.
 */
export function sessionCookieSecure(): boolean {
  const raw = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  if (raw === "true" || raw === "1" || raw === "on") return true;

  for (const key of ["FRONTEND_ORIGIN", "NEXT_PUBLIC_APP_URL", "OAUTH_CALLBACK_ORIGIN"] as const) {
    const origin = process.env[key]?.trim().toLowerCase();
    if (origin?.startsWith("http://")) return false;
  }

  return process.env.NODE_ENV === "production";
}

/** Sign a user id for the shared httpOnly session cookie. */
export function signSessionUserId(userId: string): string {
  const sig = createHmac("sha256", sessionSecret())
    .update(userId)
    .digest("hex")
    .slice(0, 32);
  return `${userId}.${sig}`;
}

/** Legacy signed cookie (`{userId}.{hmac}`) from onboarding / e2e scripts. */
export function isLegacySignedSessionCookie(
  raw: string | undefined | null,
): boolean {
  if (!raw) return false;
  const i = raw.lastIndexOf(".");
  if (i <= 0) return false;
  const userId = raw.slice(0, i);
  return /^\d+$/.test(userId);
}

/** Opaque CRM auth_sessions.token (hex or legacy uuid), not a signed user id. */
export function isOpaqueAuthSessionToken(
  raw: string | undefined | null,
): boolean {
  if (!raw?.trim()) return false;
  if (isLegacySignedSessionCookie(raw)) return false;
  return true;
}

/** Verify a raw session cookie value; returns user id or null. */
export function verifySessionCookieValue(
  raw: string | undefined | null,
): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const userId = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = createHmac("sha256", sessionSecret())
    .update(userId)
    .digest("hex")
    .slice(0, 32);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return userId;
}
