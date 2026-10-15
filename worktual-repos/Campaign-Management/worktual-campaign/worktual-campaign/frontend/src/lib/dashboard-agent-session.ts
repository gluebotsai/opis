/**
 * Dashboard co-worker (reports) agent session id.
 * Soft-nav remounts reuse the same id in sessionStorage — but keys are scoped by
 * JWT user id so accounts sharing a browser never resume each other's durable
 * dashboard session (agents 403: "You do not have access to this campaign session").
 */

import { currentAuthUserId } from "@/lib/jwt-user";

const SESSION_KEY_PREFIX = "worktual.dashboard.agent.session.v2:";
/** Unscoped legacy key — drop so foreign sessions cannot resume. */
const LEGACY_SESSION_KEY = "worktual.dashboard.agent.session";

function dropLegacy(): void {
  try {
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function sessionKey(userId: string): string {
  return `${SESSION_KEY_PREFIX}${userId}`;
}

export function isDashboardSessionId(id: string): boolean {
  return String(id || "").startsWith("dashboard-");
}

/** New dashboard session (explicit restart / access-denied recovery). */
export function createFreshDashboardSessionId(): string {
  dropLegacy();
  const userId = currentAuthUserId();
  const id = `dashboard-${crypto.randomUUID()}`;
  if (!userId) return id;
  try {
    sessionStorage.setItem(sessionKey(userId), id);
  } catch {
    /* ignore */
  }
  return id;
}

/** Reuse dashboard session across soft-nav remounts for the signed-in user. */
export function getOrCreateDashboardSessionId(): string {
  dropLegacy();
  const userId = currentAuthUserId();
  if (!userId) return createFreshDashboardSessionId();
  try {
    const existing = sessionStorage.getItem(sessionKey(userId))?.trim();
    if (existing && isDashboardSessionId(existing)) return existing;
  } catch {
    /* ignore */
  }
  return createFreshDashboardSessionId();
}

export function clearDashboardSessionId(): void {
  dropLegacy();
  const userId = currentAuthUserId();
  if (!userId) return;
  try {
    sessionStorage.removeItem(sessionKey(userId));
  } catch {
    /* ignore */
  }
}
