/**
 * Soft-nav (CRM Marketing tabs): remember the active Create surface so
 * `worktual:campaign-navigate` → `/campaigns/create` resumes hub or draft chat
 * instead of opening an empty hub.
 *
 * Scoped by JWT user id so another account in the same browser cannot resume
 * a foreign draft/session (agents would reject join).
 */

import { getCampaignDraft } from "@/lib/campaign-drafts";
import { isCreateHubSessionId } from "@/lib/create-campaign-hub-session";
import { currentAuthUserId } from "@/lib/jwt-user";

const ACTIVE_KEY = "worktual.createCampaignActive.v2";
/** Survives tab close and logout so the same user reopens the same draft. */
const ACTIVE_LS_KEY = "worktual.createCampaignActive.ls.v1";
/** Legacy unscoped key — cleared on read so foreign drafts cannot resume. */
const LEGACY_ACTIVE_KEY = "worktual.createCampaignActive.v1";

export type ActiveCreateSession =
  | { kind: "hub"; userId: string }
  | { kind: "draft"; userId: string; draftId: string };

function dropLegacy(): void {
  try {
    sessionStorage.removeItem(LEGACY_ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

function parseActive(
  raw: string | null,
  userId: string,
): ActiveCreateSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveCreateSession> & {
      draftId?: string;
    };
    if (String(parsed.userId || "") !== userId) return null;
    if (parsed?.kind === "hub") return { kind: "hub", userId };
    if (
      parsed?.kind === "draft" &&
      typeof parsed.draftId === "string" &&
      parsed.draftId.trim() &&
      !isCreateHubSessionId(parsed.draftId)
    ) {
      return { kind: "draft", userId, draftId: parsed.draftId.trim() };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readRaw(): ActiveCreateSession | null {
  dropLegacy();
  const userId = currentAuthUserId();
  if (!userId) return null;
  try {
    const fromSession = parseActive(sessionStorage.getItem(ACTIVE_KEY), userId);
    if (fromSession) return fromSession;
  } catch {
    /* ignore */
  }
  try {
    return parseActive(localStorage.getItem(ACTIVE_LS_KEY), userId);
  } catch {
    return null;
  }
}

function writeRaw(value: ActiveCreateSession | null): void {
  dropLegacy();
  try {
    if (!value) sessionStorage.removeItem(ACTIVE_KEY);
    else sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  try {
    if (!value) localStorage.removeItem(ACTIVE_LS_KEY);
    else localStorage.setItem(ACTIVE_LS_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function markCreateHubActive(): void {
  const userId = currentAuthUserId();
  if (!userId) return;
  writeRaw({ kind: "hub", userId });
}

export function markCreateDraftActive(draftId: string): void {
  const userId = currentAuthUserId();
  const id = String(draftId || "").trim();
  if (!userId || !id || isCreateHubSessionId(id)) return;
  writeRaw({ kind: "draft", userId, draftId: id });
}

export function clearActiveCreateSession(): void {
  writeRaw(null);
}

export function getActiveCreateSession(): ActiveCreateSession | null {
  return readRaw();
}

/** True when path is bare Create hub (no tool= / no draft id). */
export function isBareCreateCampaignPath(path: string): boolean {
  const raw = String(path || "").trim();
  if (!raw.startsWith("/")) return false;
  const noHash = raw.split("#")[0] || "";
  const [pathname, query = ""] = noHash.split("?");
  const normalized = pathname.replace(/\/+$/, "") || pathname;
  if (normalized !== "/campaigns/create") return false;
  const params = new URLSearchParams(query);
  const tool = params.get("tool");
  if (tool && tool !== "hub") return false;
  // Explicit hub (e.g. breadcrumb Back from Recommendations) — do not soft-resume a draft.
  if (params.get("hub") === "1") return false;
  return true;
}

/**
 * Create landing / hub href for Back controls (not history.back()).
 * `hub=1` skips draft soft-nav resume so Back always lands on the hub UI.
 */
export function createCampaignHubHref(): string {
  return "/campaigns/create?hub=1";
}

function draftHasChat(draftId: string): boolean {
  const draft = getCampaignDraft(draftId);
  if (!draft) return false;
  return (draft.messages || []).some(
    (m) =>
      (m.role === "user" || m.role === "assistant") &&
      String(m.text || "").trim(),
  );
}

/**
 * Rewrite CRM soft-nav `/campaigns/create` to the last draft chat when present.
 * Preserves query flags like embed=1. Ignores foreign / unscoped drafts.
 * Skips resume when `hub=1` (intentional Create hub navigation).
 */
export function resolveCreateSoftNavPath(path: string): string {
  if (!isBareCreateCampaignPath(path)) return path;
  const noHash = path.split("#")[0] || path;
  const [, query = ""] = noHash.split("?");
  const params = new URLSearchParams(query);
  if (params.get("hub") === "1") return path;

  const active = getActiveCreateSession();
  if (!active || active.kind !== "draft") return path;
  if (!draftHasChat(active.draftId)) return path;

  params.delete("tool");
  const qs = params.toString();
  return `/campaigns/create/${active.draftId}${qs ? `?${qs}` : ""}`;
}

/** Detect agents "foreign session" reject so FE can drop stale resume state. */
export function isCampaignSessionAccessDenied(message?: string | null): boolean {
  const m = String(message || "").toLowerCase();
  return (
    m.includes("do not have access to this campaign session") ||
    m.includes("you do not have access")
  );
}

/** Clear soft-nav resume pointers after a denied join. */
export function abandonStaleCreateResume(): void {
  clearActiveCreateSession();
}
