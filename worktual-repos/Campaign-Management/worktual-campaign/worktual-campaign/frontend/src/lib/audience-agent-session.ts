/**
 * Audience co-worker agent session id.
 * Soft-nav remounts reuse the same UUID in memory so chat survives route changes.
 * Full page refresh clears memory → brand-new chat (no leftover history).
 * Keys are scoped by JWT user id so accounts sharing a browser never resume
 * each other's durable contacts session (agents 403).
 */

import { currentAuthUserId } from "@/lib/jwt-user";

const SESSION_KEY_PREFIX = "worktual.audience.agent.session.v2:";
/** Unscoped legacy key — drop so foreign sessions cannot resume. */
const LEGACY_SESSION_KEY = "worktual.audience.agent.session";

/** In-tab only — dies on full refresh so Audience opens a blank chat. */
const memoryIds = new Map<string, string>();

function dropLegacy(): void {
  try {
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
    // Migrate off durable sessionStorage keys so refresh never restores old threads.
    const userId = currentAuthUserId();
    if (userId) sessionStorage.removeItem(sessionKey(userId));
  } catch {
    /* ignore */
  }
}

function sessionKey(userId: string): string {
  return `${SESSION_KEY_PREFIX}${userId}`;
}

/** New audience session (explicit restart / access-denied recovery / refresh). */
export function createFreshAudienceSessionId(): string {
  dropLegacy();
  const userId = currentAuthUserId();
  const id = crypto.randomUUID();
  if (userId) memoryIds.set(userId, id);
  return id;
}

/** Reuse audience session across soft-nav remounts for the signed-in user. */
export function getOrCreateAudienceSessionId(): string {
  dropLegacy();
  const userId = currentAuthUserId();
  if (!userId) return createFreshAudienceSessionId();
  const existing = memoryIds.get(userId)?.trim();
  if (existing) return existing;
  return createFreshAudienceSessionId();
}

export function clearAudienceSessionId(): void {
  dropLegacy();
  const userId = currentAuthUserId();
  if (!userId) return;
  memoryIds.delete(userId);
}
