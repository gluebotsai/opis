import { findValidCrmSessionByToken } from "@/service/account/auth-sessions";
import {
  isOpaqueAuthSessionToken,
  SESSION_COOKIE_NAME,
  signSessionUserId,
  verifySessionCookieValue,
} from "@/service/account/session-crypto";
import { requestContext } from "@/service/account/request-context";

export { SESSION_COOKIE_NAME };

/**
 * Prefer Fastify/request ALS when set.
 * Cookie jar helpers were Next-only; Fastify sets cookies on the reply.
 */
export async function setServerSessionCookie(
  userId: string,
  _remember: boolean,
) {
  const store = requestContext.getStore();
  if (store) {
    store.userId = userId;
  }
  // Sign for callers that still need the value (rare); Fastify login sets cookie itself.
  return signSessionUserId(userId);
}

export async function clearServerSessionCookie() {
  // Fastify clears via reply.clearCookie.
}

/**
 * Prefer Fastify/request ALS when set.
 */
export async function getServerUserId(): Promise<string | null> {
  const store = requestContext.getStore();
  if (store) return store.userId;
  return null;
}

/** Verify a raw cookie value (tests / scripts). Legacy signed cookies only. */
export function userIdFromSessionCookie(
  raw: string | null | undefined,
): string | null {
  return verifySessionCookieValue(raw);
}

/** Resolve user id from cookie value (legacy signed or auth_sessions token). */
export async function resolveUserIdFromSessionCookieRaw(
  raw: string | null | undefined,
): Promise<string | null> {
  const legacy = verifySessionCookieValue(raw);
  if (legacy) return legacy;
  if (!isOpaqueAuthSessionToken(raw)) return null;
  const row = await findValidCrmSessionByToken(raw!);
  return row?.user_id?.trim() || null;
}
