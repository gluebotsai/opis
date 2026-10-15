/**
 * Durable recommendation cards: Campaign DB is source of truth (tenant-scoped).
 * localStorage is a cache so the board still works if the API is briefly down.
 */

import { appendAgentWork } from "@/lib/agent-work-log-store";
import { packStorageKey } from "@/lib/industry-packs";
import {
  fetchRecommendationCards,
  putRecommendationCards,
} from "@/services/recommendations.api";
import { getToken } from "@/services/api";


export type RecommendationTemplatePreview = {
  channel: string;
  name: string;
  preview: string;
};

export type RecommendationStatus =
  | "creating"
  | "active"
  | "dismissed"
  | "used"
  | "expired"
  | "deleted";

export type RecommendationTrigger =
  | "schedule"
  | "stale_open"
  | "opportunity_event"
  | "ops_threshold"
  | "config_ready"
  | "chat"
  | "seed";

export type RecommendationEditLogEntry = {
  id: string;
  at: string;
  text: string;
};

export type CampaignRecommendation = {
  id: string;
  title: string;
  goal: string;
  objective: string;
  channels: string[];
  timingLabel: string;
  eventName: string;
  /** Why the manager created this now */
  whyCreated: string;
  /** What the user should use it for */
  intendedUse: string;
  trigger: RecommendationTrigger;
  evidence: Record<string, unknown>;
  audience: string;
  contactsSpecified: boolean;
  matchedCount: number | null;
  audienceFilters: Record<string, unknown> | null;
  /** Required when contactsSpecified === false */
  contactsMissingReason: string | null;
  confidence: number;
  templates: RecommendationTemplatePreview[];
  status: RecommendationStatus;
  source: "proactive" | "chat" | "event" | "seed";
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  /** Agent send window — unused cards are deleted after this time. */
  suggestedLaunchAt: string | null;
  /** After this, manager may propose delete with consent (default +2 months) */
  expiresAt: string;
  /** Create-campaign draft id for the run agent on this card. */
  runDraftId?: string | null;
  /** Per-card chat transcript (stays on Recommendations — not Create Campaign drafts). */
  chatMessages?: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    createdAt: string;
  }>;
  /** Short editing activity log for this recommendation. */
  editLog?: RecommendationEditLogEntry[];
  lastEditedAt?: string | null;
};

const STORAGE_KEY_BASE = "worktual.campaignRecommendations.v5";
const TWO_MONTHS_MS = 1000 * 60 * 60 * 24 * 60;

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function addMonthsIso(from: Date, months = 2): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function normalize(row: CampaignRecommendation): CampaignRecommendation {
  return {
    ...row,
    objective: row.objective || row.intendedUse || row.goal || "",
    whyCreated: row.whyCreated || row.intendedUse || "Manager recommendation",
    intendedUse: row.intendedUse || row.objective || "Review and start a campaign from this idea",
    contactsSpecified: Boolean(row.contactsSpecified),
    matchedCount:
      typeof row.matchedCount === "number" ? row.matchedCount : null,
    audienceFilters: row.audienceFilters ?? null,
    contactsMissingReason: row.contactsSpecified
      ? null
      : row.contactsMissingReason ||
        "Contacts not specified — resolve audience before launch.",
    templates: Array.isArray(row.templates) ? row.templates : [],
    channels: Array.isArray(row.channels) ? row.channels : [],
    confidence: typeof row.confidence === "number" ? row.confidence : 0.5,
    suggestedLaunchAt: row.suggestedLaunchAt || null,
    expiresAt: row.expiresAt || addMonthsIso(new Date(row.createdAt || Date.now()), 2),
    runDraftId: row.runDraftId || null,
    chatMessages: Array.isArray(row.chatMessages) ? row.chatMessages : [],
    editLog: Array.isArray(row.editLog) ? row.editLog : [],
    lastEditedAt: row.lastEditedAt ?? null,
  };
}

function validateForSave(row: CampaignRecommendation): string | null {
  if (!row.whyCreated?.trim()) return "whyCreated is required";
  if (!row.intendedUse?.trim()) return "intendedUse is required";
  if (row.contactsSpecified) {
    if (row.matchedCount == null) return "matchedCount required when contacts specified";
  } else if (!row.contactsMissingReason?.trim()) {
    return "contactsMissingReason required when contacts not specified";
  }
  return null;
}

function readAll(): CampaignRecommendation[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CampaignRecommendation[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize);
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistSkip = 0;
let pendingReplaceActive = false;
let persistQueued = false;
let hydratedFromServer = false;
let hydrateInFlight: Promise<CampaignRecommendation[]> | null = null;

export function subscribeRecommendations(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyRecommendations() {
  for (const fn of listeners) fn();
}

function writeAll(
  rows: CampaignRecommendation[],
  opts?: { persist?: boolean; replaceActive?: boolean },
) {
  if (!canUseStorage()) return;
  localStorage.setItem(storageKey(), JSON.stringify(rows));
  notifyRecommendations();
  if (opts?.replaceActive) pendingReplaceActive = true;
  if (opts?.persist === false) return;
  if (persistSkip > 0) {
    persistQueued = true;
    return;
  }
  schedulePersist();
}

function schedulePersist(delayMs = 450) {
  if (persistSkip > 0) return;
  if (!hydratedFromServer) {
    persistQueued = true;
    return;
  }
  if (typeof window === "undefined") return;
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void persistAllToServer();
  }, delayMs);
}

async function persistAllToServer() {
  if (!canUseStorage() || !getToken()) return;
  const replaceActive = pendingReplaceActive;
  pendingReplaceActive = false;
  try {
    await putRecommendationCards(readAll(), { replaceActive });
  } catch {
    /* keep local cache; next mutate retries */
  }
}

export async function hydrateRecommendationsFromServer(): Promise<
  CampaignRecommendation[]
> {
  if (hydrateInFlight) return hydrateInFlight;
  hydrateInFlight = (async () => {
    persistSkip += 1;
    let seedLocal = false;
    try {
      const remote = await fetchRecommendationCards();
      const cards = remote
        .filter((row) => row && typeof row === "object")
        .map((row) => normalize(row as CampaignRecommendation));
      if (cards.length > 0) {
        writeAll(cards, { persist: false });
      } else if (readAll().length > 0) {
        seedLocal = true;
      }
    } catch {
      /* keep local cache */
    } finally {
      persistSkip = Math.max(0, persistSkip - 1);
      hydratedFromServer = true;
    }
    if (seedLocal) await persistAllToServer();
    if (persistQueued) {
      persistQueued = false;
      schedulePersist(0);
    }
    const listed = listRecommendations();
    return listed;
  })().finally(() => {
    hydrateInFlight = null;
  });
  return hydrateInFlight;
}

function expireUnusedPastSendTime(now = new Date()): CampaignRecommendation[] {
  const all = readAll();
  let changed = false;
  const next = all.map((row) => {
    if (row.status === "used" || row.status === "deleted") return row;
    const at = row.suggestedLaunchAt;
    if (!at) return row;
    const ms = Date.parse(at);
    if (Number.isNaN(ms) || ms > now.getTime()) return row;
    changed = true;
    return { ...row, status: "deleted" as const, updatedAt: now.toISOString() };
  });
  if (changed) writeAll(next);
  return changed ? next : all;
}

export function listRecommendations(
  includeDeleted = false,
): CampaignRecommendation[] {
  return expireUnusedPastSendTime()
    .filter((r) => includeDeleted || (r.status !== "deleted" && r.status !== "dismissed"))
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
}

/** Drop unused cards whose send time has passed. No dummy seeds. */
export function ensureRecommendationCardSeeds(): CampaignRecommendation[] {
  return listRecommendations();
}

export function getRecommendation(id: string): CampaignRecommendation | null {
  return readAll().find((r) => r.id === id) ?? null;
}

export function upsertRecommendation(
  row: CampaignRecommendation,
): { ok: true; row: CampaignRecommendation } | { ok: false; error: string } {
  const normalized = normalize({
    ...row,
    updatedAt: new Date().toISOString(),
  });
  const err = validateForSave(normalized);
  if (err) return { ok: false, error: err };
  const all = readAll();
  const i = all.findIndex((r) => r.id === normalized.id);
  if (i >= 0) all[i] = normalized;
  else all.unshift(normalized);
  writeAll(all);
  return { ok: true, row: normalized };
}

export function dismissRecommendation(id: string): void {
  const row = getRecommendation(id);
  if (!row) return;
  upsertRecommendation({ ...row, status: "dismissed" });
}

export function markRecommendationUsed(id: string): void {
  const row = getRecommendation(id);
  if (!row) return;
  upsertRecommendation({ ...row, status: "used" });
}

export function deleteRecommendation(id: string): void {
  const row = getRecommendation(id);
  if (!row) return;
  upsertRecommendation({ ...row, status: "deleted" });
}

/** Persist per-card chat on the recommendation itself (Recommendations page only). */
export function saveRecommendationCardChat(
  id: string,
  messages: NonNullable<CampaignRecommendation["chatMessages"]>,
): void {
  const row = getRecommendation(id);
  if (!row || messages.length === 0) return;
  const now = new Date().toISOString();
  upsertRecommendation({
    ...row,
    chatMessages: messages,
    lastEditedAt: now,
    updatedAt: now,
  });
}

export function appendRecommendationEditLog(
  id: string,
  text: string,
): void {
  const row = getRecommendation(id);
  if (!row) return;
  const now = new Date().toISOString();
  const entry = {
    id: crypto.randomUUID(),
    at: now,
    text,
  };
  upsertRecommendation({
    ...row,
    editLog: [...(row.editLog || []), entry].slice(-40),
    lastEditedAt: now,
    updatedAt: now,
  });
  appendAgentWork({
    agentId: "recommendations",
    action: "recommendation_edited",
    summary: text.slice(0, 160),
    eventTitle: row.title,
    href: "/campaigns/create/recommendations",
    createdAt: now,
    sourceKey: `rec-edit-${id}-${entry.id}`,
  });
}

/** Recent edit activity across recommendations (for the Recommendations board). */
export function listRecommendationEditActivity(limit = 12): Array<{
  recommendationId: string;
  title: string;
  at: string;
  text: string;
}> {
  const out: Array<{
    recommendationId: string;
    title: string;
    at: string;
    text: string;
  }> = [];
  for (const r of readAll()) {
    if (r.status === "deleted") continue;
    const logs = r.editLog || [];
    if (logs.length > 0) {
      for (const e of logs) {
        out.push({
          recommendationId: r.id,
          title: r.title,
          at: e.at,
          text: e.text,
        });
      }
    } else if (r.lastEditedAt && (r.chatMessages?.length || 0) > 0) {
      out.push({
        recommendationId: r.id,
        title: r.title,
        at: r.lastEditedAt,
        text: `Editing draft · ${r.chatMessages!.length} messages`,
      });
    }
  }
  return out
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

/** Candidates older than 2 months — manager should consent before delete. */
export function listExpiryCandidates(now = new Date()): CampaignRecommendation[] {
  return listRecommendations().filter((r) => {
    if (r.status === "deleted" || r.status === "creating") return false;
    const exp = new Date(r.expiresAt).getTime();
    const created = new Date(r.createdAt).getTime();
    const twoMonthsAfterCreate = created + TWO_MONTHS_MS;
    return now.getTime() >= Math.min(exp, twoMonthsAfterCreate);
  });
}

export function syncFromAgentCards(
  cards: Array<Record<string, unknown>>,
  opts?: { replaceActive?: boolean },
): CampaignRecommendation[] {
  const now = new Date();
  const incomingIds = new Set<string>();
  for (const raw of cards) {
    const id = String(raw.id || `rec-${crypto.randomUUID()}`);
    incomingIds.add(id);
    const existing = getRecommendation(id);
    const contactsSpecified = Boolean(raw.contacts_specified ?? raw.contactsSpecified);
    const objective = String(
      raw.objective || existing?.objective || raw.intended_use || raw.intendedUse || "",
    );
    const whyCreated = String(
      raw.why_created ||
        raw.whyCreated ||
        raw.why ||
        existing?.whyCreated ||
        "Created by recommendation agent",
    );
    const row: CampaignRecommendation = {
      id,
      title: String(raw.title || "Untitled recommendation"),
      goal: String(raw.goal || "Engagement"),
      objective,
      channels: Array.isArray(raw.channels)
        ? (raw.channels as string[])
        : existing?.channels || [],
      timingLabel: String(
        raw.timing_label || raw.timingLabel || existing?.timingLabel || "Soon",
      ),
      eventName: String(
        raw.event_name || raw.eventName || existing?.eventName || "",
      ),
      whyCreated,
      intendedUse: String(
        raw.intended_use ||
          raw.intendedUse ||
          objective ||
          existing?.intendedUse ||
          "Use as a campaign starting point",
      ),
      trigger: (raw.trigger as RecommendationTrigger) || existing?.trigger || "chat",
      evidence:
        (raw.evidence as Record<string, unknown>) || existing?.evidence || {},
      audience: String(raw.audience || existing?.audience || "All contacts"),
      contactsSpecified,
      matchedCount:
        typeof raw.matched_count === "number"
          ? raw.matched_count
          : typeof raw.matchedCount === "number"
            ? raw.matchedCount
            : existing?.matchedCount ?? null,
      audienceFilters:
        (raw.audience_filters as Record<string, unknown>) ||
        (raw.audienceFilters as Record<string, unknown>) ||
        existing?.audienceFilters ||
        null,
      contactsMissingReason: contactsSpecified
        ? null
        : String(
            raw.contacts_missing_reason ||
              raw.contactsMissingReason ||
              existing?.contactsMissingReason ||
              "Contacts not resolved yet",
          ),
      confidence:
        typeof raw.confidence === "number"
          ? raw.confidence
          : existing?.confidence ?? 0.6,
      templates: Array.isArray(raw.templates)
        ? (raw.templates as RecommendationTemplatePreview[])
        : existing?.templates || [],
      status:
        raw.status === "creating"
          ? "creating"
          : existing?.status === "used"
            ? "used"
            : "active",
      source:
        (raw.source as CampaignRecommendation["source"]) ||
        existing?.source ||
        "chat",
      aiGenerated: raw.ai_generated !== false,
      createdAt: existing?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
      suggestedLaunchAt: String(
        raw.suggested_launch_at ||
          raw.suggestedLaunchAt ||
          existing?.suggestedLaunchAt ||
          "",
      ).trim() || null,
      expiresAt: existing?.expiresAt || addMonthsIso(now, 2),
    };
    upsertRecommendation(row);
  }
  if (opts?.replaceActive) {
    const all = readAll();
    writeAll(
      all.map((row) => {
        if (
          (row.status === "active" || row.status === "creating") &&
          !incomingIds.has(row.id)
        ) {
          return { ...row, status: "deleted" as const, updatedAt: now.toISOString() };
        }
        return row;
      }),
      { replaceActive: true },
    );
    schedulePersist(0);
  }
  return listRecommendations();
}

export function createCreatingPlaceholder(title: string): CampaignRecommendation {
  const now = new Date();
  const row: CampaignRecommendation = {
    id: `creating-${crypto.randomUUID()}`,
    title,
    goal: "Pending",
    objective: "Pending",
    channels: [],
    timingLabel: "Generating…",
    eventName: "",
    whyCreated: "Manager is building this recommendation; creation may take time.",
    intendedUse: "Will be filled when generation completes.",
    trigger: "chat",
    evidence: {},
    audience: "Pending",
    contactsSpecified: false,
    matchedCount: null,
    audienceFilters: null,
    contactsMissingReason: "Still generating — audience not assigned yet.",
    confidence: 0,
    templates: [],
    status: "creating",
    source: "chat",
    aiGenerated: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    suggestedLaunchAt: null,
    expiresAt: addMonthsIso(now, 2),
    runDraftId: null,
  };
  upsertRecommendation(row);
  return row;
}

export { TWO_MONTHS_MS, addMonthsIso };
