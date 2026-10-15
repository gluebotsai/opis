// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import {
  contactIdForCampaign,
  toStableDbId,
} from "../helpers/id-schema.js";

export type AgentSessionPayload = Record<string, unknown>;

export type AgentSessionModule = "create_campaign" | "contacts" | "monitoring";

function emptyPayload(
  sessionId: string,
  userId: string,
  module: AgentSessionModule = "create_campaign",
): AgentSessionPayload {
  const now = new Date().toISOString();
  if (module === "contacts") {
    return {
      session_id: sessionId,
      user_id: userId,
      organization_id: null,
      branch_id: null,
      module: "contacts",
      stage: "idle",
      focus_contact_id: null,
      draft_contact: {
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        company_name: "",
        city: "",
      },
      draft_mode: null,
      module_skills: {},
      llm_memory: [],
      chat_memory_note: "",
      contact_create_asked: {},
      candidates: [],
      pending_delete_id: null,
      last_action: null,
      messages: [],
      created_at: now,
      updated_at: now,
    };
  }
  if (module === "monitoring") {
    return {
      session_id: sessionId,
      user_id: userId,
      organization_id: null,
      branch_id: null,
      module: "monitoring",
      stage: "idle",
      focus_campaign_id: null,
      focus_campaign_name: null,
      monitor_bucket: "live",
      last_report: null,
      last_action: null,
      messages: [],
      created_at: now,
      updated_at: now,
    };
  }
  return {
    session_id: sessionId,
    user_id: userId,
    organization_id: null,
    branch_id: null,
    module: "create_campaign",
    stage: "intake",
    campaign: { name: "", goal: "", objective: "" },
    audience: {
      filters: {},
      matched_count: 0,
      sample_names: [],
      description: "",
    },
    channels: [],
    channel_plans: [],
    confirmed_create_templates: false,
    templates: [],
    active_edit_channel: null,
    messages: [],
    created_at: now,
    updated_at: now,
  };
}

function toPublicSession(
  row: {
    id: string;
    organizationId: string;
    branchId: string;
    createdByUserId: string;
    stage: string;
    payload: Prisma.JsonValue;
  },
  contactIds: string[] = [],
) {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? ({ ...(row.payload as AgentSessionPayload) } as AgentSessionPayload)
      : emptyPayload(row.id, row.createdByUserId);

  payload.session_id = row.id;
  payload.user_id = row.createdByUserId;
  payload.organization_id = row.organizationId;
  if (!payload.organization_id && payload.tenant_id != null) {
    payload.organization_id = payload.tenant_id;
  }
  payload.branch_id = row.branchId;
  payload.stage = row.stage || String(payload.stage || "intake");

  return {
    session: payload,
    contact_ids: contactIds,
  };
}

function normalizeModule(raw?: string | null): AgentSessionModule {
  if (raw === "contacts") return "contacts";
  if (raw === "monitoring") return "monitoring";
  return "create_campaign";
}

function lastUserKey(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const m = row as Record<string, unknown>;
    if (String(m.role || "") !== "user") continue;
    return `${String(m.id || "")}|${String(m.text || "").trim()}`;
  }
  return "";
}

function metaKey(payload: Record<string, unknown>): string {
  const camp =
    payload.campaign &&
    typeof payload.campaign === "object" &&
    !Array.isArray(payload.campaign)
      ? (payload.campaign as Record<string, unknown>)
      : {};
  const aud =
    payload.audience &&
    typeof payload.audience === "object" &&
    !Array.isArray(payload.audience)
      ? (payload.audience as Record<string, unknown>)
      : {};
  const channels = Array.isArray(payload.channels) ? payload.channels : [];
  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  return [
    String(camp.name || "").trim(),
    String(camp.goal || "").trim(),
    String(camp.objective || "").trim(),
    String(aud.matched_count || 0),
    channels.map((c) => String(c)).join(","),
    String(templates.length),
    payload.launch_confirmed ? "1" : "0",
  ].join("|");
}

/** Opening a draft (join / hydrate / leave without a new chat) must not bump list time. */
function sessionHasUserFacingActivity(
  existingPayload: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  const existingMessages = Array.isArray(existingPayload.messages)
    ? existingPayload.messages
    : [];
  const incomingMessages = Array.isArray(next.messages) ? next.messages : [];
  if (incomingMessages.length > existingMessages.length) return true;
  if (lastUserKey(incomingMessages) !== lastUserKey(existingMessages)) {
    return true;
  }
  return metaKey(next) !== metaKey(existingPayload);
}


export async function getOrCreateAgentSessionDao(
  session: CampaignSessionUser,
  sessionId: string,
  moduleHint?: string | null,
  options?: { createIfMissing?: boolean },
) {
  sessionId = toStableDbId(sessionId);
  const module = normalizeModule(moduleHint);
  const createIfMissing = options?.createIfMissing !== false;

  // Lookup by id first (not tenant-scoped) so a tenant mismatch becomes 403,
  // not a blind create that hits the UUID unique constraint (Prisma → 500).
  const existing = await prisma.campaignAgentSession.findFirst({
    where: { id: sessionId },
    include: { audienceRefs: { select: { contactId: true } } },
  });

  if (existing) {
    if (
      existing.organizationId !== session.organizationId ||
      existing.createdByUserId !== session.id
    ) {
      throw new AppError(
        "You do not have access to this campaign session.",
        403,
      );
    }
    return toPublicSession(
      existing,
      existing.audienceRefs.map((r) => r.contactId),
    );
  }

  if (!createIfMissing) {
    throw new AppError("Campaign session not found.", 404);
  }

  const payload = emptyPayload(sessionId, session.id, module);
  payload.organization_id = session.organizationId;
  payload.branch_id = session.branchId;

  try {
    const created = await prisma.campaignAgentSession.create({
      data: {
        id: sessionId,
        organizationId: session.organizationId,
        branchId: session.branchId,
        createdByUserId: session.id,
        module,
        stage:
          module === "contacts" || module === "monitoring" ? "idle" : "intake",
        payload: payload as Prisma.InputJsonValue,
      },
    });
    return toPublicSession(created, []);
  } catch (err: unknown) {
    // Concurrent create race — re-read.
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "P2002") {
      const again = await prisma.campaignAgentSession.findFirst({
        where: { id: sessionId },
        include: { audienceRefs: { select: { contactId: true } } },
      });
      if (
        again &&
        again.organizationId === session.organizationId &&
        again.createdByUserId === session.id
      ) {
        return toPublicSession(
          again,
          again.audienceRefs.map((r) => r.contactId),
        );
      }
    }
    throw err;
  }
}

export async function saveAgentSessionDao(
  session: CampaignSessionUser,
  sessionId: string,
  payload: AgentSessionPayload,
) {
  const existing = await prisma.campaignAgentSession.findFirst({
    where: { id: sessionId, organizationId: session.organizationId },
  });
  if (!existing) {
    throw new AppError("Campaign session not found.", 404);
  }
  if (existing.createdByUserId !== session.id) {
    throw new AppError("You do not have access to this campaign session.", 403);
  }

  const next = { ...payload };
  next.session_id = sessionId;
  next.user_id = session.id;
  next.organization_id = session.organizationId;
  next.branch_id = session.branchId;
  const stage = String(next.stage || existing.stage || "intake");
  const module = normalizeModule(
    typeof next.module === "string" ? next.module : existing.module,
  );
  next.module = module;

  // Never let a stale FE save wipe a longer agent-owned transcript
  // (common when chat unmounts mid-turn and leave/autosave races).
  const existingPayload =
    existing.payload &&
    typeof existing.payload === "object" &&
    !Array.isArray(existing.payload)
      ? (existing.payload as Record<string, unknown>)
      : {};
  const existingMessages = Array.isArray(existingPayload.messages)
    ? existingPayload.messages
    : [];
  const incomingMessages = Array.isArray(next.messages) ? next.messages : [];
  if (existingMessages.length > incomingMessages.length) {
    next.messages = existingMessages;
  }

  // Never let a stale FE autosave wipe agent-owned campaign state.
  const exAud =
    existingPayload.audience &&
    typeof existingPayload.audience === "object" &&
    !Array.isArray(existingPayload.audience)
      ? (existingPayload.audience as Record<string, unknown>)
      : {};
  const inAud =
    next.audience &&
    typeof next.audience === "object" &&
    !Array.isArray(next.audience)
      ? (next.audience as Record<string, unknown>)
      : {};
  const exCount = Number(exAud.matched_count || 0);
  const inCount = Number(inAud.matched_count || 0);
  if (exCount > inCount) {
    next.audience = { ...inAud, ...exAud, matched_count: exCount };
  }

  const exChannels = Array.isArray(existingPayload.channels)
    ? existingPayload.channels
    : [];
  const inChannels = Array.isArray(next.channels) ? next.channels : [];
  if (exChannels.length > inChannels.length) {
    next.channels = exChannels;
  }

  const exPlans = Array.isArray(existingPayload.channel_plans)
    ? existingPayload.channel_plans
    : [];
  const inPlans = Array.isArray(next.channel_plans) ? next.channel_plans : [];
  if (exPlans.length > inPlans.length) {
    next.channel_plans = exPlans;
  }

  const exTemplates = Array.isArray(existingPayload.templates)
    ? existingPayload.templates
    : [];
  const inTemplates = Array.isArray(next.templates) ? next.templates : [];
  if (exTemplates.length > inTemplates.length) {
    next.templates = exTemplates;
  }

  if (existingPayload.launch_confirmed && !next.launch_confirmed) {
    next.launch_confirmed = existingPayload.launch_confirmed;
  }
  if (existingPayload.launch_plan && !next.launch_plan) {
    next.launch_plan = existingPayload.launch_plan;
  }
  if (
    existingPayload.confirmed_create_templates &&
    !next.confirmed_create_templates
  ) {
    next.confirmed_create_templates = existingPayload.confirmed_create_templates;
  }

  // Preserve timeline cards when agent/FE saves omit ui.timelineTemplates.
  const exUi =
    existingPayload.ui &&
    typeof existingPayload.ui === "object" &&
    !Array.isArray(existingPayload.ui)
      ? (existingPayload.ui as Record<string, unknown>)
      : {};
  const inUi =
    next.ui && typeof next.ui === "object" && !Array.isArray(next.ui)
      ? (next.ui as Record<string, unknown>)
      : {};
  const exTimeline = Array.isArray(exUi.timelineTemplates)
    ? exUi.timelineTemplates
    : [];
  const inTimeline = Array.isArray(inUi.timelineTemplates)
    ? inUi.timelineTemplates
    : [];
  if (exTimeline.length > inTimeline.length) {
    next.ui = {
      ...inUi,
      ...exUi,
      ...inUi,
      timelineTemplates: exTimeline,
      pinned: "pinned" in inUi ? inUi.pinned === true : exUi.pinned === true,
      committed:
        inUi.committed === true ||
        exUi.committed === true ||
        exTimeline.length > 0,
    };
  } else if (Object.keys(exUi).length || Object.keys(inUi).length) {
    next.ui = {
      ...exUi,
      ...inUi,
      pinned: "pinned" in inUi ? inUi.pinned === true : exUi.pinned === true,
      committed:
        inUi.committed === true ||
        exUi.committed === true ||
        inTimeline.length > 0 ||
        exTimeline.length > 0,
    };
  }

  const touchList = sessionHasUserFacingActivity(existingPayload, next);
  const keptUpdatedAt =
    typeof existingPayload.updated_at === "string" && existingPayload.updated_at
      ? existingPayload.updated_at
      : existing.updatedAt.toISOString();
  next.updated_at = touchList ? new Date().toISOString() : keptUpdatedAt;

  const updated = await prisma.campaignAgentSession.update({
    where: { id: sessionId },
    data: {
      stage,
      module,
      payload: next as Prisma.InputJsonValue,
      ...(touchList ? {} : { updatedAt: existing.updatedAt }),
    },
    include: { audienceRefs: { select: { contactId: true } } },
  });

  return toPublicSession(
    updated,
    updated.audienceRefs.map((r) => r.contactId),
  );
}

export async function replaceAudienceRefsDao(
  session: CampaignSessionUser,
  sessionId: string,
  contactIds: string[],
) {
  const existing = await prisma.campaignAgentSession.findFirst({
    where: { id: sessionId, organizationId: session.organizationId },
  });
  if (!existing) {
    throw new AppError("Campaign session not found.", 404);
  }
  if (existing.createdByUserId !== session.id) {
    throw new AppError("You do not have access to this campaign session.", 403);
  }

  const unique = [
    ...new Set(contactIds.filter(Boolean).map((id) => contactIdForCampaign(id))),
  ];

  await prisma.$transaction([
    prisma.campaignAudienceRef.deleteMany({ where: { sessionId } }),
    ...(unique.length
      ? [
          prisma.campaignAudienceRef.createMany({
            data: unique.map((contactId) => ({ sessionId, contactId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  return { contact_ids: unique };
}

export async function loadAudienceRefsDao(
  session: CampaignSessionUser,
  sessionId: string,
) {
  const existing = await prisma.campaignAgentSession.findFirst({
    where: { id: sessionId, organizationId: session.organizationId },
    include: { audienceRefs: { select: { contactId: true } } },
  });
  if (!existing) {
    throw new AppError("Campaign session not found.", 404);
  }
  if (existing.createdByUserId !== session.id) {
    throw new AppError("You do not have access to this campaign session.", 403);
  }
  return {
    contact_ids: existing.audienceRefs.map((r) => r.contactId),
  };
}

export type AgentSessionListItem = {
  id: string;
  module: string;
  stage: string;
  campaign_name: string;
  goal: string;
  message_count: number;
  channels: string[];
  campaign_id: string | null;
  campaign_status: string | null;
  /** Linked campaign endsAt (ISO) — used for Completed Drafts list date. */
  campaign_ends_at: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  /** Full payload for FE draft hydration when needed. */
  session: AgentSessionPayload;
};

function slimSessionPayloadForList(
  payload: AgentSessionPayload,
  messages: unknown[],
): AgentSessionPayload {
  const rows = Array.isArray(messages) ? messages : [];
  const tail = rows
    .filter(
      (m) =>
        m &&
        typeof m === "object" &&
        !Array.isArray(m) &&
        (m as { role?: string }).role !== "system",
    )
    .slice(-6);
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
  const ui =
    payload.ui && typeof payload.ui === "object" && !Array.isArray(payload.ui)
      ? (payload.ui as Record<string, unknown>)
      : {};
  const timelineTemplates = Array.isArray(ui.timelineTemplates)
    ? ui.timelineTemplates
    : [];
  return {
    session_id: payload.session_id,
    module: payload.module,
    stage: payload.stage,
    campaign,
    audience: {
      description: audience.description,
      matched_count: audience.matched_count,
    },
    channels: payload.channels,
    ui: {
      status: ui.status,
      committed: ui.committed,
      pinned: ui.pinned === true,
      // Keep timeline cards on list payloads so hydrate does not drop pins.
      ...(timelineTemplates.length ? { timelineTemplates } : {}),
    },
    messages: tail,
    templates: [],
  };
}

type SessionRow = Awaited<
  ReturnType<typeof prisma.campaignAgentSession.findMany>
>[number];

function parsedSessionPayload(row: SessionRow) {
  const pub = toPublicSession(row, []);
  const payload = pub.session;
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const campaign =
    payload.campaign &&
    typeof payload.campaign === "object" &&
    !Array.isArray(payload.campaign)
      ? (payload.campaign as Record<string, unknown>)
      : {};
  const channels = Array.isArray(payload.channels)
    ? payload.channels.map((c) => String(c))
    : [];
  const audience =
    payload.audience &&
    typeof payload.audience === "object" &&
    !Array.isArray(payload.audience)
      ? (payload.audience as Record<string, unknown>)
      : {};
  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  const ui =
    payload.ui && typeof payload.ui === "object" && !Array.isArray(payload.ui)
      ? (payload.ui as Record<string, unknown>)
      : {};
  return { payload, messages, campaign, channels, audience, templates, ui };
}

/** In-progress sort — last message or row updatedAt. */
function rowListActivityMs(row: SessionRow): number {
  const { messages } = parsedSessionPayload(row);
  let max = row.updatedAt.getTime();
  for (const raw of messages) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const m = raw as Record<string, unknown>;
    const iso = m.created_at ?? m.createdAt;
    if (!iso) continue;
    const ms = new Date(String(iso)).getTime();
    if (!Number.isNaN(ms)) max = Math.max(max, ms);
  }
  return max;
}

type LinkedCampaignSort = {
  status: string;
  endsAt: Date | null;
  startsAt: Date | null;
};

/** Matches FE draftListDisplayAt — lifecycle date for launched campaigns. */
function rowListDisplayMs(
  row: SessionRow,
  linked?: LinkedCampaignSort | null,
): number {
  const linkedStatus = String(linked?.status || "").trim().toLowerCase();
  if (
    linkedStatus === "completed" ||
    linkedStatus === "scheduled" ||
    linkedStatus === "live"
  ) {
    if (linked?.endsAt && !Number.isNaN(linked.endsAt.getTime())) {
      return linked.endsAt.getTime();
    }
    if (linked?.startsAt && !Number.isNaN(linked.startsAt.getTime())) {
      return linked.startsAt.getTime();
    }
  }
  return rowListActivityMs(row);
}

/** Same rules as FE isDraftCommittable — only listable drafts count for total/pages. */
function isContactDraftSessionPayload(payload: Record<string, unknown>): boolean {
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
  // Contact create/update draft without campaign fields must never appear in Drafts.
  return !hasCampaignBits;
}

function isPlaceholderCampaignName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return !n || n === "new campaign" || n === "untitled campaign";
}

const LAUNCHED_OR_SAVED_STATUSES = new Set([
  "scheduled",
  "live",
  "completed",
  "cancelled",
  "ready",
  "draft_saved",
]);

/**
 * Drafts listability — must match what the FE shows after mapping.
 * Assistant-only welcome chats do NOT count (same as FE hasUserChatInitiated).
 */
function isListableAgentSessionRow(
  row: SessionRow,
  linked?: { status: string; name: string } | null,
): boolean {
  if (String(row.module || "").trim().toLowerCase() === "contacts") {
    return false;
  }
  const { payload, messages, campaign, channels, audience, templates, ui } =
    parsedSessionPayload(row);
  if (isContactDraftSessionPayload(payload)) {
    return false;
  }

  const statusHint = String(
    linked?.status || ui.status || row.stage || "",
  )
    .trim()
    .toLowerCase();
  if (LAUNCHED_OR_SAVED_STATUSES.has(statusHint)) {
    return true;
  }

  const campaignName = String(
    campaign.name || linked?.name || "",
  ).trim();
  const hasRealName = Boolean(campaignName) && !isPlaceholderCampaignName(campaignName);
  const matchedCount = Number(audience.matched_count || 0);
  const timelineTemplates = Array.isArray(ui.timelineTemplates)
    ? ui.timelineTemplates
    : [];
  /** FE only counts user turns — assistant welcome alone must not inflate Drafts. */
  const hasUserChat = messages.some((m) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) return false;
    const role = String((m as { role?: string }).role || "");
    if (role !== "user") return false;
    const text = String(
      (m as { text?: string }).text ||
        (m as { content?: string }).content ||
        "",
    ).trim();
    return Boolean(text);
  });

  if (hasUserChat) return true;
  if (ui.committed === true) return true;
  if (hasRealName) return true;
  if (Boolean(String(campaign.goal || "").trim())) return true;
  if (Boolean(String(campaign.objective || "").trim())) return true;
  if (matchedCount > 0) return true;
  if (channels.length > 0) return true;
  if (templates.length > 0) return true;
  if (timelineTemplates.length > 0) return true;

  return false;
}

function payloadUiPinned(row: SessionRow): boolean {
  const { ui } = parsedSessionPayload(row);
  return ui.pinned === true;
}

export type DraftListBucket =
  | "all"
  | "live"
  | "scheduled"
  | "completed"
  | "in_progress";

/** Same status the Drafts tag shows: linked campaign lifecycle wins. */
function draftListBucket(
  row: SessionRow,
  linked?: { status: string } | null,
): Exclude<DraftListBucket, "all"> | "cancelled" {
  const linkedStatus = String(linked?.status || "").trim().toLowerCase();
  const { ui } = parsedSessionPayload(row);
  const uiStatus = String(ui.status || row.stage || "").trim().toLowerCase();
  const raw = ["live", "scheduled", "completed", "cancelled"].includes(
    linkedStatus,
  )
    ? linkedStatus
    : uiStatus;
  if (raw === "live" || raw === "scheduled" || raw === "completed") return raw;
  if (raw === "cancelled") return "cancelled";
  return "in_progress";
}

function matchesDraftBucket(
  bucket: DraftListBucket,
  rowBucket: ReturnType<typeof draftListBucket>,
): boolean {
  if (bucket === "all") return true;
  return rowBucket === bucket;
}

function agentSessionRowToListItem(
  row: SessionRow,
  campaignBySession: Map<
    string,
    {
      id: string;
      sessionId: string | null;
      status: string;
      name: string;
      endsAt: Date | null;
      startsAt: Date | null;
    }
  >,
): AgentSessionListItem {
  const { payload, messages, campaign, channels } = parsedSessionPayload(row);
  const linked = campaignBySession.get(row.id);
  const name =
    String(campaign.name || linked?.name || "").trim() || "New campaign";
  const goal = String(campaign.goal || "").trim() || "Not set yet";
  const endsAt =
    linked?.endsAt && !Number.isNaN(linked.endsAt.getTime())
      ? linked.endsAt.toISOString()
      : linked?.startsAt && !Number.isNaN(linked.startsAt.getTime())
        ? linked.startsAt.toISOString()
        : null;

  return {
    id: row.id,
    module: row.module,
    stage: row.stage,
    campaign_name: name,
    goal,
    message_count: messages.length,
    channels,
    campaign_id:
      linked?.id ?? (payload.campaign_id ? String(payload.campaign_id) : null),
    campaign_status: linked?.status ?? null,
    campaign_ends_at: endsAt,
    pinned: payloadUiPinned(row),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    session: slimSessionPayloadForList(payload, messages),
  };
}

/**
 * List create-campaign (or module) sessions for the current user.
 * Used by Create campaign landing “Drafts” list.
 */
export async function listAgentSessionsDao(
  session: CampaignSessionUser,
  moduleHint?: string | null,
  options?: { limit?: number; offset?: number; bucket?: DraftListBucket },
) {
  const module = normalizeModule(moduleHint ?? "create_campaign");
  const limit = Math.min(Math.max(Number(options?.limit ?? 30) || 30, 1), 100);
  const offset = Math.max(Number(options?.offset ?? 0) || 0, 0);
  const bucket: DraftListBucket =
    options?.bucket &&
    ["all", "live", "scheduled", "completed", "in_progress"].includes(
      options.bucket,
    )
      ? options.bucket
      : "all";
  const where = {
    organizationId: session.organizationId,
    createdByUserId: session.id,
    module,
  };

  const rows = await prisma.campaignAgentSession.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });

  const sessionIds = rows.map((r) => r.id);
  const campaigns =
    sessionIds.length === 0
      ? []
      : await prisma.campaign.findMany({
          where: {
            organizationId: session.organizationId,
            sessionId: { in: sessionIds },
          },
          select: {
            id: true,
            sessionId: true,
            status: true,
            name: true,
            endsAt: true,
            startsAt: true,
          },
        });
  const campaignBySession = new Map(
    campaigns
      .filter((c) => c.sessionId)
      .map((c) => [c.sessionId as string, c]),
  );

  const listableRows = rows
    .filter((row) =>
      isListableAgentSessionRow(row, campaignBySession.get(row.id) ?? null),
    )
    .filter((row) =>
      matchesDraftBucket(bucket, draftListBucket(row, campaignBySession.get(row.id) ?? null)),
    )
    .sort((a, b) => {
      const pinDiff = Number(payloadUiPinned(b)) - Number(payloadUiPinned(a));
      if (pinDiff !== 0) return pinDiff;
      return (
        rowListDisplayMs(b, campaignBySession.get(b.id) ?? null) -
        rowListDisplayMs(a, campaignBySession.get(a.id) ?? null)
      );
    });
  const total = listableRows.length;
  const pageRows = listableRows.slice(offset, offset + limit);

  const items = pageRows.map((row) =>
    agentSessionRowToListItem(row, campaignBySession),
  );

  return { sessions: items, total };
}

/** Pin/unpin a draft without changing list activity time. */
export async function setAgentSessionPinnedDao(
  session: CampaignSessionUser,
  sessionId: string,
  pinned: boolean,
) {
  const existing = await prisma.campaignAgentSession.findFirst({
    where: { id: sessionId, organizationId: session.organizationId },
  });
  if (!existing) {
    throw new AppError("Campaign session not found.", 404);
  }
  if (existing.createdByUserId !== session.id) {
    throw new AppError("You do not have access to this campaign session.", 403);
  }
  const payload =
    existing.payload &&
    typeof existing.payload === "object" &&
    !Array.isArray(existing.payload)
      ? { ...(existing.payload as Record<string, unknown>) }
      : {};
  const ui =
    payload.ui && typeof payload.ui === "object" && !Array.isArray(payload.ui)
      ? { ...(payload.ui as Record<string, unknown>) }
      : {};
  ui.pinned = pinned;
  payload.ui = ui;
  // Preserve updatedAt so Completed list dates / relative clocks stay stable
  // (same pattern as save when touchList is false).
  await prisma.campaignAgentSession.update({
    where: { id: existing.id },
    data: {
      payload: payload as Prisma.InputJsonValue,
      updatedAt: existing.updatedAt,
    },
  });
  return { id: sessionId, pinned };
}

/**
 * Delete an agent session owned by the user.
 * Also removes linked Campaign rows that are still in draft status.
 */
export async function deleteAgentSessionDao(
  session: CampaignSessionUser,
  sessionId: string,
) {
  const existing = await prisma.campaignAgentSession.findFirst({
    where: { id: sessionId, organizationId: session.organizationId },
  });
  if (!existing) {
    throw new AppError("Campaign session not found.", 404);
  }
  if (existing.createdByUserId !== session.id) {
    throw new AppError("You do not have access to this campaign session.", 403);
  }

  await prisma.$transaction(async (tx) => {
    await tx.campaign.deleteMany({
      where: {
        organizationId: session.organizationId,
        sessionId,
        status: "draft",
      },
    });
    // Clear sessionId on non-draft campaigns so we can delete the session row
    await tx.campaign.updateMany({
      where: {
        organizationId: session.organizationId,
        sessionId,
        status: { not: "draft" },
      },
      data: { sessionId: null },
    });
    await tx.campaignAgentSession.delete({ where: { id: sessionId } });
  });

  return { id: sessionId, deleted: true };
}
