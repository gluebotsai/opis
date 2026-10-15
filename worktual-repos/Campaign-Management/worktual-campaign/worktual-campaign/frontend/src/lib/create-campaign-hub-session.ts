/**
 * Create-campaign hub agent session.
 * Soft-nav (CRM embed tab switches) reuses the same hub session + chat transcript
 * in sessionStorage so coworker state survives route remounts.
 *
 * Keys are scoped by JWT user id so accounts sharing a browser never resume
 * each other's hub thread / agents session.
 */

import { currentAuthUserId } from "@/lib/jwt-user";

const HUB_SESSION_KEY_PREFIX = "worktual.createCampaignHubSession.v2:";
const HUB_MESSAGES_KEY_PREFIX = "worktual.createCampaignHubMessages.v2:";
const LEGACY_HUB_SESSION_KEY = "worktual.createCampaignHubSession.v1";
const LEGACY_HUB_MESSAGES_KEY = "worktual.createCampaignHubMessages.v1";

export type HubPersistedMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
};

function dropLegacyHub(): void {
  try {
    sessionStorage.removeItem(LEGACY_HUB_SESSION_KEY);
    sessionStorage.removeItem(LEGACY_HUB_MESSAGES_KEY);
  } catch {
    /* ignore */
  }
}

function hubSessionKey(userId: string): string {
  return `${HUB_SESSION_KEY_PREFIX}${userId}`;
}

function hubMessagesKey(userId: string): string {
  return `${HUB_MESSAGES_KEY_PREFIX}${userId}`;
}

export function isCreateHubSessionId(id: string): boolean {
  return String(id || "").startsWith("hub-");
}

/** New hub session (explicit restart / first visit). */
export function createFreshHubSessionId(): string {
  dropLegacyHub();
  const userId = currentAuthUserId();
  const id = `hub-${crypto.randomUUID()}`;
  if (!userId) return id;
  try {
    sessionStorage.setItem(hubSessionKey(userId), id);
  } catch {
    /* ignore */
  }
  return id;
}

/** Existing hub session id, or null — never creates a new one. */
export function peekHubSessionId(): string | null {
  dropLegacyHub();
  const userId = currentAuthUserId();
  if (!userId) return null;
  try {
    const existing = sessionStorage.getItem(hubSessionKey(userId))?.trim();
    if (existing && isCreateHubSessionId(existing)) return existing;
  } catch {
    /* ignore */
  }
  return null;
}

/** Reuse hub session across soft-nav remounts within the iframe session. */
export function getOrCreateHubSessionId(): string {
  const existing = peekHubSessionId();
  if (existing) return existing;
  return createFreshHubSessionId();
}

export function clearHubSessionId(): void {
  dropLegacyHub();
  const userId = currentAuthUserId();
  if (!userId) return;
  try {
    sessionStorage.removeItem(hubSessionKey(userId));
  } catch {
    /* ignore */
  }
}

export function readHubMessages(): HubPersistedMessage[] {
  dropLegacyHub();
  const userId = currentAuthUserId();
  if (!userId) return [];
  try {
    const raw = sessionStorage.getItem(hubMessagesKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is HubPersistedMessage =>
        Boolean(m) &&
        typeof m === "object" &&
        typeof (m as HubPersistedMessage).id === "string" &&
        ((m as HubPersistedMessage).role === "user" ||
          (m as HubPersistedMessage).role === "assistant") &&
        typeof (m as HubPersistedMessage).text === "string",
    );
  } catch {
    return [];
  }
}

export function writeHubMessages(messages: HubPersistedMessage[]): void {
  dropLegacyHub();
  const userId = currentAuthUserId();
  if (!userId) return;
  try {
    sessionStorage.setItem(hubMessagesKey(userId), JSON.stringify(messages));
  } catch {
    /* ignore */
  }
}

export function clearHubMessages(): void {
  dropLegacyHub();
  const userId = currentAuthUserId();
  if (!userId) return;
  try {
    sessionStorage.removeItem(hubMessagesKey(userId));
  } catch {
    /* ignore */
  }
}

/** Drop hub pointers so the next mount starts a fresh hub session. */
export function resetHubSessionForUser(): void {
  clearHubMessages();
  clearHubSessionId();
}
