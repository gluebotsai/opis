/**
 * Campaign chat drafts — UI type + local cache.
 * Source of truth: CampaignAgentSession via /api/agent-sessions.
 */

import {
  deleteAgentSession,
  getAgentSessionIfExists,
  getOrCreateAgentSession,
  listCreateCampaignSessions,
  saveAgentSession,
  type AgentSessionListItem,
  type AgentSessionPayload,
  type DraftListBucket,
} from "@/services/agent-sessions.service";
import { mergeTemplateFields } from "@/lib/template-fields-merge";
import { packStorageKey } from "@/lib/industry-packs";
import { mergeTimelinesPreserveLocal } from "@/lib/campaign-timeline-merge";
import {
  coerceTimelineMoments,
  freezeMissingPinOrdinals,
  normalizeChatTimeline,
  repairTimelinePlacement,
} from "@/lib/campaign-template-timeline";
import { sortChatMessagesStable } from "@/lib/chat-message-order";
import {
  chatImageUrlsEqual,
  resolveChatMessageImages,
  unionChatMessageImages,
} from "@/lib/chat-message-images";

export type GenerationPin = {
  pinUserMessageId: string;
  pinUserOrdinal: number;
};

export function coerceGenerationPin(value: unknown): GenerationPin | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const pinUserMessageId = String(row.pinUserMessageId || "").trim();
  const pinUserOrdinal = Number(row.pinUserOrdinal || 0);
  if (!pinUserMessageId || pinUserOrdinal < 1) return undefined;
  return { pinUserMessageId, pinUserOrdinal };
}

export function coerceGenerationPins(
  value: unknown,
): Record<string, GenerationPin> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, GenerationPin> = {};
  for (const [key, row] of Object.entries(value as Record<string, unknown>)) {
    const batch = String(key || "").trim();
    const pin = coerceGenerationPin(row);
    if (!batch || !pin) continue;
    out[batch] = pin;
  }
  return out;
}

export function mergeGenerationPins(
  ...maps: Array<Record<string, GenerationPin> | undefined | null>
): Record<string, GenerationPin> {
  const out: Record<string, GenerationPin> = {};
  for (const map of maps) {
    if (!map) continue;
    Object.assign(out, map);
  }
  return out;
}

export type CampaignDraftStatus =
  | "empty"
  | "drafting"
  | "draft_saved"
  | "ready"
  | "scheduled"
  | "live"
  | "completed"
  | "cancelled";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  /** Uploaded / attached image shown as a mini thumbnail in the bubble. */
  imageUrl?: string;
  imageFilename?: string;
  /** All images in this user turn (ChatGPT-style cluster). */
  imageUrls?: { url: string; filename?: string }[];
};

/** Template cards inserted in chat order (like messages). */
export type DraftTemplateMoment = {
  id: string;
  /**
   * Legacy: message count when this batch was inserted.
   * Prefer afterMessageId so cards stay put when new messages arrive.
   */
  afterMessageIndex: number;
  /** Pin cards after this chat message id (stable across later turns). */
  afterMessageId?: string;
  /** User message id that triggered this batch — stable pin when ids remap. */
  pinUserMessageId?: string;
  /**
   * 1-based count of user turns at append time. Survives message-id churn on
   * View in/out — never reassign by moment index.
   */
  pinUserOrdinal?: number;
  createdAt: string;
  cards: Array<{
    template_id: string;
    channel: string;
    logo?: string;
    launch_at?: string;
    fields?: Record<string, unknown>;
    how_it_works?: string;
    generation_batch_id?: string;
  }>;
};

export type CampaignChatDraft = {
  id: string;
  name: string;
  goal: string;
  objective?: string;
  channels: string[];
  audience: string;
  schedule: string;
  flowSteps: string[];
  status: CampaignDraftStatus;
  messages: ChatMessage[];
  /** Chronological template batches in the chat timeline (append-only). */
  timelineTemplates?: DraftTemplateMoment[];
  dirty: boolean;
  createdAt: string;
  updatedAt: string;
  launchedAt: string | null;
  /** User pin — persisted on the agent session (ui.pinned). */
  pinned?: boolean;
  /** Linked campaign completion (or launch) time — server-backed for Completed list date. */
  completedAt?: string | null;
  /** Library template IDs attached when this chat started (cleared from selection on save/launch). */
  usedLibraryTemplateIds?: string[];
  /** Template Library → library_run domain (isolated from blank create). */
  libraryRun?: boolean;
  /** When true, leave flow auto-saves instead of asking (e.g. started from a recommendation). */
  autoSaveOnLeave?: boolean;
  /** Clone-past: original campaign name for agent context. */
  cloneSourceName?: string;
  /** Form handoff: keep draft until campaign launch, then promote to Events tracking. */
  formEventId?: string;
  formPublicUrl?: string;
  formTitle?: string;
  /** After cross-module or hub handoff — seed this text as the first user turn on join. */
  seedUserOnJoin?: string;
  /** Frozen pin for template cards — last generate turn, not a global once-only pin. */
  templatePin?: {
    afterMessageIndex: number;
    afterMessageId?: string;
    pinUserMessageId?: string;
    pinUserOrdinal?: number;
  };
  /** Per generation_batch_id → user ask. Survives refresh / View return. */
  generationPins?: Record<string, GenerationPin>;
  /** Last user ask waiting for a generation_batch_id (in-flight progress). */
  pendingGeneratePin?: GenerationPin;
  /** Same-browser restore of the template progress bar (not written to the session). */
  inFlightProgress?: {
    status: "started" | "generating" | "completed" | "failed";
    channels: string[];
    completed_channels: string[];
    failed_channels?: string[];
    current_channel?: string;
    stage?: string;
    label?: string;
    percent: number;
    generation_batch_id?: string;
  };
  /** Approved WhatsApp workspace — opens dedicated run UI from Drafts. */
  whatsappApprovedTemplateId?: string;
  whatsappApprovedAgentSessionId?: string;
  /** Campaign created from approved run (mirror draft id differs from agent session). */
  linkedCampaignId?: string;
};

/** Rebind ids after refresh. Frozen pinUserOrdinal never changes. */
export function remapTimelinePins(
  moments: DraftTemplateMoment[] | undefined,
  prevMessages: ChatMessage[],
  nextMessages: ChatMessage[],
): DraftTemplateMoment[] | undefined {
  if (!moments?.length) return moments;
  const frozen = freezeMissingPinOrdinals(
    coerceTimelineMoments(moments),
    prevMessages.length ? prevMessages : nextMessages,
  );
  const target = nextMessages.length ? nextMessages : prevMessages;
  if (!target.length) return frozen;
  return repairTimelinePlacement(frozen, target);
}

/** Update fields on the existing card — never move or duplicate it.
 * Replaces the fields object (do not shallow-merge) so cleared keys stay cleared.
 */
export function patchTimelineCardFields(
  draft: CampaignChatDraft,
  templateId: string,
  fields: Record<string, unknown>,
): CampaignChatDraft {
  if (!templateId || !fields) return draft;
  let changed = false;
  const timelineTemplates = (draft.timelineTemplates || []).map((moment) => {
    let cardsChanged = false;
    const cards = moment.cards.map((card) => {
      if (card.template_id !== templateId) return card;
      cardsChanged = true;
      changed = true;
      const prior =
        card.fields && typeof card.fields === "object"
          ? (card.fields as Record<string, unknown>)
          : {};
      return {
        ...card,
        fields: mergeTemplateFields(prior, fields),
      };
    });
    return cardsChanged ? { ...moment, cards } : moment;
  });
  if (!changed) return draft;
  return {
    ...draft,
    timelineTemplates,
    dirty: draft.status === "draft_saved" ? false : true,
    updatedAt: new Date().toISOString(),
  };
}

function mergeSessionTemplates(
  agentTemplates: Array<Record<string, unknown>>,
  draftTemplates: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  const remember = (row: Record<string, unknown>) => {
    const id = String(row.template_id || "").trim();
    if (!id) return;
    if (!byId.has(id)) order.push(id);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...row });
      return;
    }
    const nextFields =
      row.fields && typeof row.fields === "object" ? row.fields : prev.fields;
    byId.set(id, { ...prev, ...row, fields: nextFields || prev.fields });
  };
  for (const row of agentTemplates) remember(row);
  for (const row of draftTemplates) remember(row);
  return order.map((id) => byId.get(id)!);
}

/** Patch fields on an existing card and push the same fields into agent session. */
export async function persistTemplateEditToDraftAndSession(
  sessionId: string,
  templateId: string,
  fields: Record<string, unknown>,
  cardExtras?: Partial<{
    channel: string;
    logo: string;
    launch_at: string;
    how_it_works: string;
    generation_batch_id: string;
  }>,
): Promise<CampaignChatDraft | null> {
  const draft = getCampaignDraft(sessionId);
  if (!draft) return null;
  const nextDraft = patchTimelineCardFields(draft, templateId, fields);
  upsertCampaignDraft(nextDraft);

  try {
    const { session } = await getOrCreateAgentSession(
      sessionId,
      "create_campaign",
    );
    const prior = Array.isArray(session.templates)
      ? (session.templates as Array<Record<string, unknown>>)
      : [];
    let found = false;
    const templates = prior.map((row) => {
      if (String(row.template_id || "") !== templateId) return row;
      found = true;
      return {
        ...row,
        ...cardExtras,
        template_id: templateId,
        fields,
      };
    });
    if (!found) {
      const inTimeline = (draft.timelineTemplates || []).some((moment) =>
        (moment.cards || []).some(
          (c) => String(c.template_id || "") === templateId,
        ),
      );
      if (inTimeline) {
        templates.push({
          template_id: templateId,
          channel: cardExtras?.channel || "",
          fields,
          ...cardExtras,
        });
      }
    }
    await saveAgentSession(sessionId, {
      ...session,
      templates,
      confirmed_create_templates: true,
    });
  } catch {
    /* local draft still holds the edit; launch hydrate reads DB */
  }
  return nextDraft;
}

/** UI label before the agent sets campaign.name — never persist as campaign title. */
export const DRAFT_PLACEHOLDER_NAME = "New campaign";

const LEGACY_UNTITLED_NAME = "Untitled campaign";

/** Agent session slice used to decide whether a draft is real campaign work. */
export type DraftCommitSnapshot = {
  campaign?: { name?: string; goal?: string; objective?: string };
  audience?: {
    matched_count?: number;
    filters?: Record<string, unknown>;
    sample_names?: string[];
    description?: string;
  };
  channels?: string[];
  channel_plans?: unknown[];
  templates?: unknown[];
  launch_plan?: unknown;
  launch_confirmed?: boolean;
  confirmed_create_templates?: boolean;
  stage?: string;
};

export function isPlaceholderDraftName(name?: string | null): boolean {
  const n = String(name || "").trim();
  return !n || n === LEGACY_UNTITLED_NAME || n === DRAFT_PLACEHOLDER_NAME;
}

/** Header / list label — agent name first, else neutral placeholder. */
export function displayDraftName(
  draft: CampaignChatDraft,
  agent?: DraftCommitSnapshot | null,
): string {
  const fromAgent = String(agent?.campaign?.name || "").trim();
  if (fromAgent) return fromAgent;
  const fromDraft = String(draft.name || "").trim();
  if (fromDraft && !isPlaceholderDraftName(fromDraft)) return fromDraft;
  return DRAFT_PLACEHOLDER_NAME;
}

/**
 * Persist draft when campaign work OR real user chat has started.
 * Cross-device: any user-initiated chat must be listable/syncable.
 */
export function isDraftCommittable(
  draft: CampaignChatDraft,
  agent?: DraftCommitSnapshot | null,
): boolean {
  if (hasUserChatInitiated(draft)) return true;
  if (draft.autoSaveOnLeave) return true;
  if (draft.formEventId || draft.cloneSourceName) return true;
  if ((draft.usedLibraryTemplateIds?.length ?? 0) > 0) return true;
  if ((draft.timelineTemplates?.length ?? 0) > 0) return true;

  if (
    draft.status === "draft_saved" ||
    draft.status === "scheduled" ||
    draft.status === "live" ||
    draft.status === "completed" ||
    draft.status === "cancelled" ||
    draft.status === "ready"
  ) {
    return true;
  }

  const camp = agent?.campaign;
  if (String(camp?.name || "").trim()) return true;
  if (String(camp?.goal || "").trim()) return true;
  if (String(camp?.objective || "").trim()) return true;

  if ((agent?.audience?.matched_count ?? 0) > 0) return true;
  if ((agent?.channels?.length ?? 0) > 0) return true;
  if ((agent?.templates?.length ?? 0) > 0) return true;

  if (draft.name?.trim() && !isPlaceholderDraftName(draft.name)) return true;
  if (draft.goal?.trim() && draft.goal !== "Not set yet") return true;
  if ((draft.channels?.length ?? 0) > 0) return true;

  return false;
}

const STORAGE_KEY_BASE = "worktual.campaignChatDrafts.v1";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}


function readAll(): CampaignChatDraft[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CampaignChatDraft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(drafts: CampaignChatDraft[]) {
  if (!canUseStorage()) return;
  localStorage.setItem(storageKey(), JSON.stringify(drafts));
  emitCampaignDraftsChanged();
}

type CampaignDraftsListener = () => void;
const campaignDraftsListeners = new Set<CampaignDraftsListener>();

function emitCampaignDraftsChanged() {
  campaignDraftsListeners.forEach((l) => l());
}

/** Subscribe to local draft list changes (create / update / delete). */
export function subscribeCampaignDrafts(listener: CampaignDraftsListener) {
  campaignDraftsListeners.add(listener);
  return () => {
    campaignDraftsListeners.delete(listener);
  };
}

export function listCampaignDrafts(): CampaignChatDraft[] {
  return sortCampaignDraftsForList(
    readAll().filter(
      (d) =>
        !String(d.id || "").startsWith("hub-") && isDraftCommittable(d),
    ),
  );
}

function draftWithOrderedChat(draft: CampaignChatDraft): CampaignChatDraft {
  const messages = sortChatMessagesStable(draft.messages || []);
  return {
    ...draft,
    messages,
    timelineTemplates: normalizeChatTimeline(draft.timelineTemplates, messages),
  };
}

export function getCampaignDraft(id: string): CampaignChatDraft | null {
  const d = readAll().find((row) => row.id === id) ?? null;
  if (!d) return null;
  return draftWithOrderedChat(d);
}

export function upsertCampaignDraft(draft: CampaignChatDraft): void {
  const normalized = draftWithOrderedChat(draft);
  const all = readAll();
  const i = all.findIndex((d) => d.id === normalized.id);
  if (i >= 0) all[i] = normalized;
  else all.unshift(normalized);
  writeAll(all);
}

export function persistInFlightProgress(
  sessionId: string,
  progress: CampaignChatDraft["inFlightProgress"] | null,
): void {
  const sid = String(sessionId || "").trim();
  if (!sid) return;
  const draft = getCampaignDraft(sid);
  if (!draft) return;
  const next = progress || undefined;
  if (JSON.stringify(draft.inFlightProgress || null) === JSON.stringify(next || null)) {
    return;
  }
  upsertCampaignDraft({
    ...draft,
    inFlightProgress: next,
  });
}

export function deleteCampaignDraft(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function createEmptyDraft(
  partial?: Partial<CampaignChatDraft>,
): CampaignChatDraft {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "",
    goal: "Not set yet",
    channels: [],
    audience: "Not set yet",
    schedule: "Not set yet",
    flowSteps: ["Audience enters campaign", "Add channels via chat"],
    status: "empty",
    messages: [],
    dirty: false,
    createdAt: now,
    updatedAt: now,
    launchedAt: null,
    ...partial,
  };
}

/** True when the user has actually sent at least one message. */
export function hasUserChatInitiated(draft: CampaignChatDraft): boolean {
  return (draft.messages || []).some((m) => m.role === "user");
}

/** Leave prompt removed: initiated chats auto-save; empty visits are discarded. */
export function shouldPromptSaveOnLeave(_draft: CampaignChatDraft): boolean {
  return false;
}

const CHANNEL_KEYWORDS: { match: RegExp; label: string }[] = [
  { match: /whats?\s*app|wa\b/i, label: "WhatsApp" },
  { match: /\bsms\b|text message/i, label: "SMS" },
  { match: /email|e-mail/i, label: "Email" },
  { match: /webinar/i, label: "Webinar" },
  { match: /form|landing/i, label: "Form" },
  { match: /coupon|offer|promo/i, label: "Coupon" },
  { match: /push/i, label: "Push" },
  { match: /social|ads?/i, label: "Ads" },
];

function detectChannels(text: string): string[] {
  const found = CHANNEL_KEYWORDS.filter((c) => c.match.test(text)).map(
    (c) => c.label,
  );
  return found.length > 0 ? [...new Set(found)] : ["Email"];
}

function detectGoal(text: string): string {
  if (/webinar|register/i.test(text)) return "Webinar registrations";
  if (/coupon|sale|purchase|cart/i.test(text)) return "Sales / conversions";
  if (/lead|nurture|form/i.test(text)) return "Lead generation";
  if (/awareness|brand/i.test(text)) return "Awareness";
  return "Engagement";
}

export function applyUserPromptToDraft(
  draft: CampaignChatDraft,
  text: string,
): CampaignChatDraft {
  const channels = detectChannels(text);
  const goal = detectGoal(text);
  const name = `${goal} · ${channels.slice(0, 2).join(" + ")}`.slice(0, 72);
  const flowSteps = [
    "Audience enters campaign",
    ...channels.map((ch, i) =>
      `${i === 0 ? "First touch" : "Next touch"}: ${ch}`,
    ),
    goal.toLowerCase().includes("webinar")
      ? "Webinar registration / attend"
      : goal.toLowerCase().includes("lead")
        ? "Form submit → CRM lead handoff"
        : goal.toLowerCase().includes("sale")
          ? "Offer redeem / purchase"
          : "Conversion / exit",
  ];
  const audience = /cart|abandon/i.test(text)
    ? "Cart abandoners (segment)"
    : /b2c|festival/i.test(text)
      ? "B2C active customers"
      : draft.audience === "Not set yet"
        ? "Not set yet"
        : draft.audience;
  const schedule = /weekend|this week|next week/i.test(text)
    ? "Suggested: this week"
    : draft.schedule;

  const now = new Date().toISOString();
  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    text: text.trim(),
    createdAt: now,
  };
  const assistantMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    text: `Draft updated. Goal: ${goal}. Channels: ${channels.join(", ")}. Continue chatting or save when ready.`,
    createdAt: now,
  };

  return {
    ...draft,
    name: isPlaceholderDraftName(draft.name) ? name : draft.name,
    goal,
    channels,
    audience,
    schedule,
    flowSteps,
    status: "drafting",
    dirty: true,
    updatedAt: now,
    messages: [...draft.messages, userMsg, assistantMsg],
  };
}

export function markDraftSaved(draft: CampaignChatDraft): CampaignChatDraft {
  return {
    ...draft,
    status: "draft_saved",
    dirty: false,
  };
}

/** Silent save used when leaving chats that already have user messages. */
export function autoSaveDraftIfNeeded(
  draft: CampaignChatDraft,
): CampaignChatDraft {
  if (!hasUserChatInitiated(draft)) return draft;
  if (
    draft.status === "scheduled" ||
    draft.status === "live" ||
    draft.status === "completed" ||
    draft.status === "cancelled" ||
    draft.status === "draft_saved"
  ) {
    return { ...draft, dirty: false };
  }
  return markDraftSaved(draft);
}

export function markDraftLaunched(
  draft: CampaignChatDraft,
  as: "scheduled" | "live" = "scheduled",
): CampaignChatDraft {
  const now = new Date().toISOString();
  return {
    ...draft,
    status: as,
    dirty: false,
    updatedAt: now,
    launchedAt: now,
    schedule: draft.schedule === "Not set yet" ? "Scheduled now" : draft.schedule,
  };
}

export function statusLabel(status: CampaignDraftStatus): string {
  switch (status) {
    case "empty":
      return "New";
    case "drafting":
      return "In progress";
    case "draft_saved":
      return "Draft";
    case "ready":
      return "Ready";
    case "scheduled":
      return "Scheduled";
    case "live":
      return "Live";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

/** Live / scheduled / past campaigns must not be removed from Drafts. */
export function isCampaignDeleteLocked(status: CampaignDraftStatus): boolean {
  return status === "scheduled" || status === "live" || status === "completed";
}

/** Status name used in the cannot-delete notice (completed → Past). */
export function campaignDeleteLockedStatusLabel(
  status: CampaignDraftStatus,
): string {
  if (status === "completed") return "Past";
  return statusLabel(status);
}

export function campaignCannotDeleteMessage(status: CampaignDraftStatus): string {
  return `This campaign is ${campaignDeleteLockedStatusLabel(status)} and cannot be deleted.`;
}

export function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Calendar date (day month year) for Completed Drafts — stable across logins. */
export function formatCompletedDraftDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function maxIsoTimestamp(candidates: string[]): string {
  let best = "";
  let bestMs = -1;
  for (const raw of candidates) {
    const iso = String(raw || "").trim();
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = iso;
    }
  }
  return best;
}

function isTodayLocal(d: Date): boolean {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Last activity — Drafts sort (includes campaign lifecycle dates when present). */
export function draftListActivityAt(draft: {
  updatedAt: string;
  createdAt?: string;
  completedAt?: string | null;
  launchedAt?: string | null;
  messages?: ChatMessage[];
}): string {
  const fromMessages = (draft.messages || [])
    .map((m) => String(m.createdAt || "").trim())
    .filter(Boolean);
  const picked = maxIsoTimestamp([
    draft.updatedAt,
    draft.createdAt || "",
    draft.completedAt || "",
    draft.launchedAt || "",
    ...fromMessages,
  ]);
  return picked || draft.updatedAt;
}

/** Instant shown in the Drafts list (per-campaign dates for launched/completed). */
export function draftListDisplayAt(draft: {
  status: CampaignDraftStatus;
  updatedAt: string;
  createdAt?: string;
  completedAt?: string | null;
  launchedAt?: string | null;
  messages?: ChatMessage[];
}): string {
  if (
    draft.status === "completed" ||
    draft.status === "scheduled" ||
    draft.status === "live"
  ) {
    const lifecycle = maxIsoTimestamp([
      draft.completedAt || "",
      draft.launchedAt || "",
    ]);
    if (lifecycle) return lifecycle;
  }
  return draftListActivityAt(draft);
}

export function compareCampaignDraftsForList(
  a: CampaignChatDraft,
  b: CampaignChatDraft,
): number {
  const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  if (pinDiff !== 0) return pinDiff;
  return (
    new Date(draftListDisplayAt(b)).getTime() -
    new Date(draftListDisplayAt(a)).getTime()
  );
}

/** Pinned first, then newest list activity — matches Drafts API ordering. */
export function sortCampaignDraftsForList(
  rows: CampaignChatDraft[],
): CampaignChatDraft[] {
  return [...rows].sort(compareCampaignDraftsForList);
}

/** Drafts list clock — today: time only; earlier days: day, month, year. */
export function formatDraftListTime(draft: {
  status: CampaignDraftStatus;
  updatedAt: string;
  createdAt?: string;
  completedAt?: string | null;
  launchedAt?: string | null;
  messages?: ChatMessage[];
}): string {
  const iso = draftListDisplayAt(draft);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isTodayLocal(d)) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return formatCompletedDraftDate(iso);
}

function mapCampaignStatus(
  status: string | null | undefined,
): CampaignDraftStatus {
  const s = String(status || "").toLowerCase();
  if (s === "scheduled") return "scheduled";
  if (s === "live") return "live";
  if (s === "completed") return "completed";
  if (s === "cancelled") return "cancelled";
  if (s === "draft") return "draft_saved";
  return "drafting";
}

/** True when Campaign.status is a post-launch lifecycle tag (not draft/intake). */
function isLaunchedCampaignStatus(
  status: string | null | undefined,
): boolean {
  const s = String(status || "").toLowerCase();
  return (
    s === "scheduled" ||
    s === "live" ||
    s === "completed" ||
    s === "cancelled"
  );
}

/** Dedupe / merge key — image is not part of identity (avoids duplicate "send now"). */
export function messageDedupeKey(m: ChatMessage): string {
  return `${m.role}::${(m.text || "").trim()}`;
}

function messageKey(m: ChatMessage): string {
  return messageDedupeKey(m);
}

function sameMessageId(a: ChatMessage, b: ChatMessage): boolean {
  const idA = (a.id || "").trim();
  const idB = (b.id || "").trim();
  return Boolean(idA && idB && idA === idB);
}

/**
 * Merge local + remote without dropping unique turns.
 * Remote order is the spine; local-only bubbles (e.g. optimistic "hi" not yet on
 * the server) are inserted by createdAt. Never pick "longer side wins" alone —
 * that wiped first user messages whenever session_ready arrived with extra
 * assistant welcomes.
 */
export function mergeMessagesPreferRicher(
  local: ChatMessage[],
  remote: ChatMessage[],
): ChatMessage[] {
  return mergeMessagesPreserveExact(local, remote);
}

/**
 * Exact transcript union. Local (already shown) order is the spine so bubbles
 * never disappear or jump. Remote-only rows append at the end.
 */
export function mergeMessagesPreserveExact(
  local: ChatMessage[],
  remote: ChatMessage[],
): ChatMessage[] {
  const a = dedupeConsecutiveUserMessages(Array.isArray(local) ? local : []);
  const b = dedupeConsecutiveUserMessages(Array.isArray(remote) ? remote : []);
  if (!a.length) return sortChatMessagesStable(b);
  if (!b.length) return sortChatMessagesStable(a);

  const remotePools = new Map<string, ChatMessage[]>();
  for (const m of b) {
    const k = messageKey(m);
    const pool = remotePools.get(k) || [];
    pool.push(m);
    remotePools.set(k, pool);
  }
  const remotePoolIndex = new Map<string, number>();
  const consumedRemote = new Set<ChatMessage>();

  const spine: ChatMessage[] = a.map((m) => {
    const byId = b.find((r) => sameMessageId(m, r));
    if (byId) {
      consumedRemote.add(byId);
      return mergeChatImageFields(
        { ...m, createdAt: m.createdAt || byId.createdAt, id: m.id || byId.id },
        byId,
      );
    }
    const k = messageKey(m);
    const pool = remotePools.get(k);
    if (!pool?.length) return m;
    const idx = remotePoolIndex.get(k) || 0;
    if (idx >= pool.length) return m;
    const rem = pool[idx]!;
    remotePoolIndex.set(k, idx + 1);
    consumedRemote.add(rem);
    return mergeChatImageFields(
      {
        ...m,
        createdAt: m.createdAt || rem.createdAt,
        id: m.id || rem.id,
      },
      rem,
    );
  });

  const remoteOnly = b.filter((m) => !consumedRemote.has(m));
  const merged = !remoteOnly.length
    ? dedupeConsecutiveUserMessages(overlayChatImages(spine, b))
    : dedupeConsecutiveUserMessages([...spine, ...remoteOnly]);

  return sortChatMessagesStable(merged);
}

/**
 * Merge local + remote without dropping unique turns.
 * A short/partial server transcript must not replace a longer local chat
 * (join/refresh used to wipe the thread and make cards jump).
 */
export function mergeMessagesServerWinsPendingLocal(
  local: ChatMessage[],
  remote: ChatMessage[],
): ChatMessage[] {
  return mergeMessagesPreserveExact(local, remote);
}

/** Prefer an absolute/rebuild media URL when both sides have images. */
function pickPreferredImageUrl(left: string, right: string): string {
  const l = left.trim();
  const r = right.trim();
  if (!l) return r;
  if (!r) return l;
  const lRel = l.startsWith("/api/media/");
  const rRel = r.startsWith("/api/media/");
  const lAbs = /^https?:\/\//i.test(l);
  const rAbs = /^https?:\/\//i.test(r);
  // Prefer absolute https (cross-device) over relative when both differ.
  if (lAbs && !rAbs) return l;
  if (rAbs && !lAbs) return r;
  if (lRel && !rRel && !rAbs) return l;
  if (rRel && !lRel && !lAbs) return r;
  return r || l;
}

function mergeChatImageFields(
  primary: ChatMessage,
  donor: ChatMessage,
): ChatMessage {
  const pickUrls = unionChatMessageImages(
    resolveChatMessageImages(primary),
    resolveChatMessageImages(donor),
  );
  const pImg = primary.imageUrl?.trim() || pickUrls[0]?.url || "";
  const dImg = donor.imageUrl?.trim() || "";
  if (!pImg && !dImg && !pickUrls.length) return primary;
  return {
    ...primary,
    ...(pickUrls.length ? { imageUrls: pickUrls } : {}),
    imageUrl: pickPreferredImageUrl(
      pImg,
      dImg || pickUrls[0]?.url || "",
    ),
    imageFilename:
      primary.imageFilename ||
      donor.imageFilename ||
      pickUrls[0]?.filename,
  };
}

/** Copy image fields from donor transcript onto primary (by id, then role+text). */
function overlayChatImages(
  primary: ChatMessage[],
  donor: ChatMessage[],
): ChatMessage[] {
  const donors = Array.isArray(donor) ? donor : [];
  const used = new Set<number>();
  return primary.map((m) => {
    const di = donors.findIndex(
      (d, i) => !used.has(i) && d.id && m.id && d.id === m.id,
    );
    if (di < 0) return m;
    used.add(di);
    return mergeChatImageFields(m, donors[di]!);
  });
}

/**
 * Union local + session timelines. Frozen generationPins win on placement so a
 * stale local restack cannot move cards, and local-only cards are never dropped.
 */
function mergeTimelinePreferServer(
  remoteTimeline: DraftTemplateMoment[] | undefined,
  localTimeline: DraftTemplateMoment[] | undefined,
  messagesForPins: ChatMessage[],
  localMessages: ChatMessage[],
  generationPins?: Record<string, GenerationPin>,
): DraftTemplateMoment[] | undefined {
  const remote = Array.isArray(remoteTimeline) ? remoteTimeline : [];
  const local = Array.isArray(localTimeline) ? localTimeline : [];
  if (!remote.length && !local.length) return undefined;
  return mergeTimelinesPreserveLocal(
    local,
    remote,
    localMessages.length ? localMessages : messagesForPins,
    messagesForPins,
    generationPins,
  );
}

/** Map agent/socket session message rows → UI chat bubbles (preserves image_url). */
export type SessionMessageRow = {
  id?: string;
  role?: string;
  text?: string;
  created_at?: string;
  createdAt?: string;
  image_url?: string;
  imageUrl?: string;
  image_filename?: string;
  imageFilename?: string;
  image_urls?: { url?: string; filename?: string }[];
  imageUrls?: { url?: string; filename?: string }[];
};

export function sessionRowToChatMessage(
  m: SessionMessageRow | Record<string, unknown>,
): ChatMessage | null {
  const role = String(m.role || "");
  if (role !== "user" && role !== "assistant") return null;
  const imageUrl = String(
    (m as SessionMessageRow).image_url ||
      (m as SessionMessageRow).imageUrl ||
      "",
  ).trim();
  const imageFilename = String(
    (m as SessionMessageRow).image_filename ||
      (m as SessionMessageRow).imageFilename ||
      "",
  ).trim();
  const rawUrls =
    (m as SessionMessageRow).image_urls ??
    (m as SessionMessageRow).imageUrls ??
    [];
  const imageUrls: { url: string; filename?: string }[] = [];
  if (Array.isArray(rawUrls)) {
    for (const row of rawUrls) {
      if (!row || typeof row !== "object") continue;
      const url = String(row.url ?? "").trim();
      if (!url) continue;
      const fn = String(row.filename ?? "").trim();
      imageUrls.push(fn ? { url, filename: fn } : { url });
    }
  }
  const primaryUrl = imageUrl || imageUrls[0]?.url || "";
  const primaryFn =
    imageFilename || imageUrls[0]?.filename || "";
  return {
    id: String(m.id || crypto.randomUUID()),
    role: role as "user" | "assistant",
    text: String(m.text || ""),
    createdAt: String(
      (m as SessionMessageRow).createdAt ||
        (m as SessionMessageRow).created_at ||
        new Date().toISOString(),
    ),
    ...(primaryUrl ? { imageUrl: primaryUrl } : {}),
    ...(primaryFn ? { imageFilename: primaryFn } : {}),
    ...(imageUrls.length ? { imageUrls } : {}),
  };
}

export function sessionRowsToChatMessages(rows: unknown[]): ChatMessage[] {
  const mapped: ChatMessage[] = [];
  for (const row of rows || []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const msg = sessionRowToChatMessage(row as SessionMessageRow);
    if (msg) mapped.push(msg);
  }
  return sortChatMessagesStable(dedupeConsecutiveUserMessages(mapped));
}

/** Map agent session payload → UI draft (preserves local UI-only fields when merging). */
export function sessionPayloadToDraft(
  sessionId: string,
  payload: AgentSessionPayload,
  opts?: {
    campaignStatus?: string | null;
    campaignEndsAt?: string | null;
    local?: CampaignChatDraft | null;
    updatedAt?: string;
    createdAt?: string;
    /** When set (list API), server pin wins — do not OR with stale local cache. */
    pinned?: boolean;
  },
): CampaignChatDraft {
  const local = opts?.local ?? null;
  const campaign =
    payload.campaign &&
    typeof payload.campaign === "object" &&
    !Array.isArray(payload.campaign)
      ? (payload.campaign as Record<string, unknown>)
      : {};
  const audience =
    payload.audience &&
    typeof payload.audience === "object" &&
    !Array.isArray(payload.audience)
      ? (payload.audience as Record<string, unknown>)
      : {};
  const launch =
    payload.launch_plan &&
    typeof payload.launch_plan === "object" &&
    !Array.isArray(payload.launch_plan)
      ? (payload.launch_plan as Record<string, unknown>)
      : {};
  const ui =
    payload.ui && typeof payload.ui === "object" && !Array.isArray(payload.ui)
      ? (payload.ui as Record<string, unknown>)
      : {};

  const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const messages: ChatMessage[] = sessionRowsToChatMessages(rawMessages);

  const channels = Array.isArray(payload.channels)
    ? payload.channels.map((c) => String(c))
    : local?.channels || [];

  const name =
    String(campaign.name || "").trim() ||
    (local?.name && !isPlaceholderDraftName(local.name) ? local.name : "") ||
    "";
  const goal =
    String(campaign.goal || "").trim() || local?.goal || "Not set yet";
  const audienceLabel =
    String(audience.description || "").trim() ||
    (audience.matched_count != null
      ? `${audience.matched_count} contacts`
      : null) ||
    local?.audience ||
    "Not set yet";
  const schedule =
    String(launch.summary || launch.local_date || "").trim() ||
    local?.schedule ||
    "Not set yet";

  const statusFromUi = ui.status ? mapCampaignStatus(String(ui.status)) : null;
  // Linked campaign lifecycle (live/scheduled/completed) wins over stale ui.status
  // left behind at launch — Drafts tags must track Campaign.status.
  const statusFromCampaign = isLaunchedCampaignStatus(opts?.campaignStatus)
    ? mapCampaignStatus(opts?.campaignStatus)
    : null;
  const status =
    statusFromCampaign ||
    statusFromUi ||
    mapCampaignStatus(opts?.campaignStatus) ||
    (messages.length > 0 || (local?.messages?.length ?? 0) > 0
      ? "drafting"
      : "empty");

  const timelineFromUi = Array.isArray(ui.timelineTemplates)
    ? (ui.timelineTemplates as DraftTemplateMoment[])
    : undefined;

  const mergedMessages = mergeMessagesServerWinsPendingLocal(
    local?.messages || [],
    messages,
  );

  const generationPins = mergeGenerationPins(
    coerceGenerationPins(ui.generationPins),
    local?.generationPins,
  );

  const timelineTemplates = normalizeChatTimeline(
    mergeTimelinePreferServer(
      timelineFromUi,
      local?.timelineTemplates,
      mergedMessages,
      local?.messages || [],
      generationPins,
    ),
    mergedMessages,
  );

  return {
    id: sessionId,
    name,
    goal,
    objective: campaign.objective
      ? String(campaign.objective)
      : local?.objective,
    channels,
    audience: audienceLabel,
    schedule,
    flowSteps: local?.flowSteps || [
      "Audience enters campaign",
      "Add channels via chat",
    ],
    status,
    messages: mergedMessages,
    timelineTemplates,
    dirty: Boolean(ui.dirty ?? local?.dirty ?? false),
    createdAt:
      opts?.createdAt ||
      String(payload.created_at || local?.createdAt || new Date().toISOString()),
    updatedAt:
      opts?.updatedAt ||
      String(payload.updated_at || local?.updatedAt || new Date().toISOString()),
    launchedAt: local?.launchedAt ?? null,
    pinned:
      opts?.pinned !== undefined
        ? opts.pinned === true
        : ui.pinned === true || local?.pinned === true,
    completedAt:
      (opts?.campaignEndsAt && String(opts.campaignEndsAt).trim()) ||
      local?.completedAt ||
      null,
    whatsappApprovedTemplateId:
      (typeof ui.whatsappApprovedTemplateId === "string" &&
        ui.whatsappApprovedTemplateId.trim()) ||
      local?.whatsappApprovedTemplateId,
    whatsappApprovedAgentSessionId:
      (typeof ui.whatsappApprovedAgentSessionId === "string" &&
        ui.whatsappApprovedAgentSessionId.trim()) ||
      local?.whatsappApprovedAgentSessionId,
    linkedCampaignId:
      (typeof ui.linkedCampaignId === "string" && ui.linkedCampaignId.trim()) ||
      local?.linkedCampaignId,
    usedLibraryTemplateIds: local?.usedLibraryTemplateIds,
    libraryRun: local?.libraryRun,
    autoSaveOnLeave: local?.autoSaveOnLeave,
    cloneSourceName: local?.cloneSourceName,
    formEventId:
      (typeof ui.formEventId === "string" && ui.formEventId.trim()) ||
      local?.formEventId,
    formPublicUrl:
      (typeof ui.formPublicUrl === "string" && ui.formPublicUrl.trim()) ||
      local?.formPublicUrl,
    formTitle:
      (typeof ui.formTitle === "string" && ui.formTitle.trim()) ||
      local?.formTitle,
    generationPins,
    pendingGeneratePin: local?.pendingGeneratePin,
    inFlightProgress: local?.inFlightProgress,
  };
}

export function agentSessionListItemToDraft(
  item: AgentSessionListItem,
  local?: CampaignChatDraft | null,
): CampaignChatDraft {
  return sessionPayloadToDraft(item.id, item.session, {
    campaignStatus: item.campaign_status,
    campaignEndsAt: item.campaign_ends_at ?? null,
    local,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    // Top-level list field is source of truth (avoids stale local.pinned sticking).
    pinned: item.pinned === true,
  });
}

/** Build agent payload from UI draft — merges agent-owned fields when provided. */
export function draftToSessionPayload(
  draft: CampaignChatDraft,
  agent?: DraftCommitSnapshot | null,
): AgentSessionPayload {
  const cards = (draft.timelineTemplates || []).flatMap((b) => b.cards || []);
  const draftTemplates = cards.map((c) => ({
    template_id: c.template_id,
    channel: c.channel,
    logo: c.logo,
    launch_at: c.launch_at,
    how_it_works: c.how_it_works,
    fields: c.fields || {},
    generation_batch_id: c.generation_batch_id,
  }));
  const agentTemplates = Array.isArray(agent?.templates) ? agent!.templates : [];
  const templates = mergeSessionTemplates(
    agentTemplates as Array<Record<string, unknown>>,
    draftTemplates as Array<Record<string, unknown>>,
  );

  const agentCamp = agent?.campaign || {};
  const agentAud = agent?.audience || {};
  const agentChannels = (agent?.channels || []).map((c) => String(c).toLowerCase());
  const draftChannels = draft.channels.map((c) => c.toLowerCase());
  const channels = agentChannels.length ? agentChannels : draftChannels;

  const matchedCount =
    agentAud.matched_count != null && Number(agentAud.matched_count) > 0
      ? Number(agentAud.matched_count)
      : 0;

  return {
    session_id: draft.id,
    module: "create_campaign",
    stage:
      agent?.stage ||
      (draft.status === "empty" ? "intake" : "drafting"),
    campaign: {
      name:
        String(agentCamp.name || "").trim() ||
        (isPlaceholderDraftName(draft.name) ? "" : draft.name),
      goal:
        String(agentCamp.goal || "").trim() ||
        (draft.goal === "Not set yet" ? "" : draft.goal),
      objective:
        String(agentCamp.objective || "").trim() || draft.objective || "",
    },
    audience: {
      filters:
        agentAud.filters && typeof agentAud.filters === "object"
          ? agentAud.filters
          : {},
      matched_count: matchedCount,
      sample_names: Array.isArray(agentAud.sample_names)
        ? agentAud.sample_names.map(String)
        : [],
      description:
        String(agentAud.description || "").trim() ||
        (draft.audience === "Not set yet" ? "" : draft.audience),
    },
    channels,
    channel_plans: Array.isArray(agent?.channel_plans)
      ? agent!.channel_plans
      : [],
    confirmed_create_templates:
      Boolean(agent?.confirmed_create_templates) || templates.length > 0,
    templates,
    active_edit_channel: null,
    launch_plan: agent?.launch_plan ?? null,
    launch_confirmed: Boolean(agent?.launch_confirmed),
    messages: draft.messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      created_at: m.createdAt,
      ...(m.imageUrl ? { image_url: m.imageUrl } : {}),
      ...(m.imageFilename ? { image_filename: m.imageFilename } : {}),
      ...(m.imageUrls?.length ? { image_urls: m.imageUrls } : {}),
    })),
    ui: {
      status: draft.status,
      dirty: draft.dirty,
      /** Cross-device list gate — user chat or campaign work must remain listable. */
      committed: isDraftCommittable(draft, agent),
      timelineTemplates: draft.timelineTemplates || [],
      ...(Object.keys(draft.generationPins || {}).length
        ? { generationPins: draft.generationPins }
        : {}),
      ...(draft.cloneSourceName
        ? { cloneSourceName: draft.cloneSourceName, clone_mode: true }
        : {}),
      ...(draft.formEventId
        ? {
            formEventId: draft.formEventId,
            formPublicUrl: draft.formPublicUrl || "",
            formTitle: draft.formTitle || "",
          }
        : {}),
      ...(draft.whatsappApprovedTemplateId
        ? {
            whatsappApprovedTemplateId: draft.whatsappApprovedTemplateId,
            whatsappApprovedAgentSessionId:
              draft.whatsappApprovedAgentSessionId || "",
          }
        : {}),
      ...(draft.linkedCampaignId
        ? { linkedCampaignId: draft.linkedCampaignId }
        : {}),
    },
    created_at: draft.createdAt,
    updated_at: draftListActivityAt(draft),
  };
}

const MIGRATE_FLAG = "worktual.campaignChatDrafts.migratedToServer.v1";

/** One-time push of local-only drafts into agent-sessions. */
export async function migrateLocalDraftsToServer(): Promise<void> {
    if (!canUseStorage()) return;
  try {
    if (localStorage.getItem(MIGRATE_FLAG) === "1") return;
  } catch {
    return;
  }
  const local = readAll().filter((d) => isDraftCommittable(d));
  for (const draft of local) {
    try {
      await getOrCreateAgentSession(draft.id, "create_campaign");
      await saveAgentSession(draft.id, draftToSessionPayload(draft));
    } catch {
      /* best-effort per draft */
    }
  }
  try {
    localStorage.setItem(MIGRATE_FLAG, "1");
  } catch {
    /* ignore */
  }
}

export const CAMPAIGN_DRAFT_PAGE_SIZE = 30;

/** Contacts / Audience chat must never appear in Create-campaign Drafts. */
function isContactsModuleSession(
  item: AgentSessionListItem | { module?: string; session?: AgentSessionPayload },
): boolean {
  if (String(item.module || "").trim().toLowerCase() === "contacts") {
    return true;
  }
  const payload =
    item.session && typeof item.session === "object" ? item.session : null;
  if (!payload) return false;
  if (String(payload.module || "").trim().toLowerCase() === "contacts") {
    return true;
  }
  const draft =
    payload.draft_contact &&
    typeof payload.draft_contact === "object" &&
    !Array.isArray(payload.draft_contact)
      ? (payload.draft_contact as Record<string, unknown>)
      : null;
  if (!draft) return false;
  const camp =
    payload.campaign &&
    typeof payload.campaign === "object" &&
    !Array.isArray(payload.campaign)
      ? (payload.campaign as Record<string, unknown>)
      : {};
  const hasCampaignBits =
    Boolean(String(camp.name || "").trim()) ||
    Boolean(String(camp.goal || "").trim()) ||
    Boolean(String(camp.objective || "").trim());
  return !hasCampaignBits;
}

function draftsFromSessionList(
  sessions: AgentSessionListItem[],
  localById: Map<string, CampaignChatDraft>,
  opts?: { trustServerListable?: boolean },
): CampaignChatDraft[] {
  const mapped = sessions
    .filter((s) => !String(s.id || "").startsWith("hub-"))
    .filter((s) => !isContactsModuleSession(s))
    .map((s) => agentSessionListItemToDraft(s, localById.get(s.id) || null));
  // Paginated API already applied listable rules + total — do not re-filter
  // or pages go empty while Drafts (N) stays inflated.
  const drafts = opts?.trustServerListable
    ? mapped
    : mapped.filter((d) => isDraftCommittable(d));
  return sortCampaignDraftsForList(drafts);
}

/**
 * Paginated drafts from server (Create campaign drafts panel / landing).
 */
export async function listCampaignDraftsPageAsync(options?: {
  limit?: number;
  offset?: number;
  bucket?: DraftListBucket;
}): Promise<{ drafts: CampaignChatDraft[]; total: number }> {
  const limit = options?.limit ?? CAMPAIGN_DRAFT_PAGE_SIZE;
  const offset = options?.offset ?? 0;
  const bucket = options?.bucket ?? "all";
  try {
    await migrateLocalDraftsToServer();
    const { sessions, total } = await listCreateCampaignSessions({
      limit,
      offset,
      bucket,
    });
    const localById = new Map(readAll().map((d) => [d.id, d]));
    const drafts = draftsFromSessionList(sessions, localById, {
      trustServerListable: true,
    });
    for (const d of drafts) upsertCampaignDraft(d);
    return { drafts, total };
  } catch {
    const all = listCampaignDrafts();
    return {
      drafts: all.slice(offset, offset + limit),
      total: all.length,
    };
  }
}

/**
 * List drafts from server (preferred) with local cache merge.
 * Falls back to local-only if the API is unavailable.
 */
export async function listCampaignDraftsAsync(): Promise<CampaignChatDraft[]> {
  try {
    const { drafts } = await listCampaignDraftsPageAsync({
      limit: 100,
      offset: 0,
    });
    return drafts;
  } catch {
    return listCampaignDrafts();
  }
}

/** Pull server drafts into local cache after login (server wins for committable drafts). */
export async function hydrateCampaignDraftsFromServer(): Promise<
  CampaignChatDraft[]
> {
  try {
    const { drafts } = await listCampaignDraftsPageAsync({
      limit: 100,
      offset: 0,
    });
    const local = readAll();
    const serverIds = new Set(drafts.map((d) => d.id));
    const ephemeral = local.filter(
      (d) =>
        !serverIds.has(d.id) &&
        !String(d.id || "").startsWith("hub-") &&
        !isDraftCommittable(d),
    );
    writeAll([...drafts, ...ephemeral]);
    emitCampaignDraftsChanged();
  } catch {
    /* keep local cache */
  }
  return listCampaignDrafts();
}

/**
 * Ensure a draft exists on the server (create + optional payload push).
 * Used when starting chats and when leaving with content.
 */
/**
 * Collapse consecutive identical user bubbles (FE optimistic + agent append).
 * Image-only turns (empty text) are distinct when imageUrl differs — never drop them.
 */
export function dedupeConsecutiveUserMessages(
  messages: ChatMessage[],
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.role === "user" &&
      m.role === "user" &&
      prev.text.trim() === m.text.trim()
    ) {
      const prevImages = resolveChatMessageImages(prev);
      const nextImages = resolveChatMessageImages(m);
      const sameId = sameMessageId(prev, m);

      // Distinct image-only uploads share empty text but must stay separate bubbles.
      if (
        !prev.text.trim() &&
        prevImages.length &&
        nextImages.length &&
        !chatImageUrlsEqual(prevImages, nextImages)
      ) {
        out.push(m);
        continue;
      }

      if (sameId || chatImageUrlsEqual(prevImages, nextImages)) {
        out[out.length - 1] = mergeChatImageFields(prev, m);
        continue;
      }

      // Optimistic local + thinner server echo (same caption, same first thumbnail).
      out[out.length - 1] = mergeChatImageFields(prev, m);
      continue;
    }
    out.push(m);
  }
  return out;
}

/** Prefer the richer of two histories after dedupe (assistants win ties). */
export function preferRicherMessages(
  local: ChatMessage[],
  remote: ChatMessage[],
): ChatMessage[] {
  const a = dedupeConsecutiveUserMessages(local);
  const b = dedupeConsecutiveUserMessages(remote);
  if (!a.length) return b;
  if (!b.length) return a;
  if (b.length !== a.length) {
    return mergeMessagesPreferRicher(a, b);
  }
  const aAsst = a.filter((m) => m.role === "assistant").length;
  const bAsst = b.filter((m) => m.role === "assistant").length;
  if (bAsst !== aAsst) {
    const primary = bAsst > aAsst ? b : a;
    const donor = bAsst > aAsst ? a : b;
    return overlayChatImages(primary, donor);
  }
  return overlayChatImages(b, a);
}

/**
 * Merge remote into local — never drop unique user/assistant turns.
 * Local user text wins when the same turn exists on both sides.
 */
export function mergeMessagesVerbatimLocalWins(
  local: ChatMessage[],
  remote: ChatMessage[],
): ChatMessage[] {
  return mergeMessagesPreserveExact(local, remote);
}

/** @deprecated Use mergeMessagesVerbatimLocalWins — kept for imports during migration. */
export function mergeMessagesPreservePlacement(
  local: ChatMessage[],
  remote: ChatMessage[],
): ChatMessage[] {
  return mergeMessagesVerbatimLocalWins(local, remote);
}

/** DB row for channel-templates + drafts — call as soon as a create draft URL opens. */
export async function ensureAgentSessionShell(
  sessionId: string,
): Promise<void> {
  await getOrCreateAgentSession(sessionId, "create_campaign");
}

export async function ensureDraftOnServer(
  draft: CampaignChatDraft,
  agent?: DraftCommitSnapshot | null,
): Promise<void> {
  if (!isDraftCommittable(draft, agent)) return;
  const cleaned: CampaignChatDraft = {
    ...draft,
    messages: dedupeConsecutiveUserMessages(draft.messages),
  };
  upsertCampaignDraft(cleaned);
  await getOrCreateAgentSession(cleaned.id, "create_campaign");
  await saveAgentSession(cleaned.id, draftToSessionPayload(cleaned, agent));
}

/**
 * Load one draft.
 * - Local cache present → merge with get-or-create (new chats).
 * - No local → load only if session already exists (no recreate after delete).
 */
export async function getCampaignDraftAsync(
  id: string,
): Promise<CampaignChatDraft | null> {
  const local = getCampaignDraft(id);
  try {
    if (local) {
      if (!isDraftCommittable(local)) {
        return local;
      }
      const { session } = await getOrCreateAgentSession(id, "create_campaign");
      const draft = sessionPayloadToDraft(id, session, { local });
      upsertCampaignDraft(draft);
      if ((draft.timelineTemplates?.length ?? 0) > 0) return draft;
      const { reconcileTimelineFromSessionIfNeeded } = await import(
        "@/lib/append-session-channel-templates"
      );
      return (await reconcileTimelineFromSessionIfNeeded(id)) ?? draft;
    }
    const existing = await getAgentSessionIfExists(id, "create_campaign");
    if (!existing) return null;
    const draft = sessionPayloadToDraft(id, existing.session, { local: null });
    upsertCampaignDraft(draft);
    if ((draft.timelineTemplates?.length ?? 0) > 0) return draft;
    const { reconcileTimelineFromSessionIfNeeded } = await import(
      "@/lib/append-session-channel-templates"
    );
    return (await reconcileTimelineFromSessionIfNeeded(id)) ?? draft;
  } catch {
    return local;
  }
}

/** Delete on server + local cache. */
export async function deleteCampaignDraftAsync(id: string): Promise<void> {
  const existing = getCampaignDraft(id);
  if (existing && isCampaignDeleteLocked(existing.status)) {
    throw new Error(campaignCannotDeleteMessage(existing.status));
  }
  deleteCampaignDraft(id);
  try {
    await deleteAgentSession(id);
  } catch (err: unknown) {
    const status =
      err &&
      typeof err === "object" &&
      "response" in err &&
      (err as { response?: { status?: number } }).response?.status;
    // Never created on the server (or already gone).
    if (status === 404) return;
    throw err;
  }
}
