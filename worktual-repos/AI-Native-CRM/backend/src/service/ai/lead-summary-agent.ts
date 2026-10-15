/**
 * Autonomous lead summary agent.
 *
 * Produces a short narrative executive summary of a lead's current status and
 * buying intent (e.g. "Vijay Kumar from TTS Technologies has demonstrated high
 * buying intent by booking a product demo…"). It regenerates automatically when
 * the lead's *signature* — activities, lifecycle/lead status, BANT, deals and
 * firmographics — changes. No manual trigger.
 */

import { createHash } from "node:crypto";
import { getContact } from "@/dao/contacts/contact-service";
import { listContactActivities } from "@/dao/contacts/contact-activity-service";
import { getCompanySnapshot } from "@/dao/companies/sync-from-contacts";
import { listOrdersForContact } from "@/dao/sales/order-service";
import { listDealsForContact } from "@/dao/sales/deal-service";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { findLeadSummary, upsertLeadSummary, type LeadSummaryRow } from "@/dao/ai/lead-summary-store";
import { deriveProcessNextAction } from "@/service/ai/lead-next-action";
import { findScoringJobByContactId } from "@/dao/ai/lead-scoring-store";
import { findLeadEnrichmentSnapshot } from "@/dao/ai/lead-enrichment-snapshot";
import { parseNoteBody } from "@/lib/note-body";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { accountQuery } from "@/dao/db/account-pool";
import { prisma } from "@/dao/db/prisma";
import { isLeadSummaryRefreshQueued } from "@/service/ai/lead-summary-refresh";
import { publishLeadSummaryEvent } from "@/service/ai/lead-summary-events";

const CITABLE_ACTIVITY_TYPES = new Set(["email", "call", "meeting", "sms"]);

type ActivityLite = {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  transcriptText: string | null;
  createdAt: string;
  taskStatus: string | null;
  completedAt: string | null;
  dueAt: string | null;
};

export type LeadSummaryCitation = {
  text: string;
  sourceKind: "activity" | "omni" | "score";
  sourceId: string | null;
  activityType: string | null;
  conversationId: string | null;
};

export type LeadSummaryContext = {
  organizationId: string;
  contactId: string;
  displayName: string;
  firstName: string;
  title: string | null;
  companyName: string | null;
  industry: string | null;
  companyDescription: string | null;
  products: string | null;
  employeeCount: number | null;
  domain: string | null;
  linkedinUrl: string | null;
  contactType: string | null;
  leadStatus: string | null;
  status: string | null;
  leadSource: string | null;
  bant: { budget: boolean; authority: boolean; need: boolean; timeline: boolean };
  notes: string | null;
  orderCount: number;
  deals: Array<{ title: string; stage: string; amount: string | null }>;
  activities: ActivityLite[];
  /** Latest Fit/Intent score for LLM grounding (no invented numbers). */
  score: number | null;
  fitScore: number | null;
  intentScore: number | null;
  band: string | null;
  nextBestAction: string | null;
  scoreBreakdown: Record<string, number> | null;
  scoreRationale: string | null;
  manualScoreReason: string | null;
  ownerUserId: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  /** CCaaS paragraph on cdp.customer_profile.custom_fields.omniChannelSummary. Read only. */
  omniChannelSummary: string | null;
};

export type LeadSummaryView = {
  summary: string;
  headline: string | null;
  intent: string | null;
  recommendedAction: string | null;
  flags: unknown;
  citations: LeadSummaryCitation[];
  omniChannelSummary: string | null;
  source: string;
  updatedAt: string;
};

export function omniChannelHash(text: string | null | undefined): string | null {
  const value = text?.trim();
  if (!value) return null;
  return createHash("md5").update(value).digest("hex");
}

export function clampLeadSummaryCitations(
  raw: unknown,
  ctx: {
    activities: ActivityLite[];
    omniChannelSummary: string | null;
    manualScoreReason?: string | null;
  },
): LeadSummaryCitation[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Map(
    ctx.activities
      .filter((activity) => CITABLE_ACTIVITY_TYPES.has(activity.type))
      .map((activity) => [activity.id, activity]),
  );
  const omni = ctx.omniChannelSummary?.trim() || "";
  const lines: LeadSummaryCitation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const text = String(row.text || "").trim().slice(0, 500);
    if (!text) continue;
    const kind = String(row.sourceKind || "");
    if (kind === "activity") {
      const sourceId = String(row.sourceId || "").trim();
      const activity = allowed.get(sourceId);
      if (!activity) continue;
      lines.push({
        text,
        sourceKind: "activity",
        sourceId,
        activityType: activity.type,
        conversationId: null,
      });
    } else if (kind === "omni" && omni) {
      let conversationId = String(row.conversationId || "").trim();
      if (conversationId && !omni.includes(conversationId)) conversationId = "";
      lines.push({
        text,
        sourceKind: "omni",
        sourceId: null,
        activityType: null,
        conversationId: conversationId || null,
      });
    } else if (kind === "score" && ctx.manualScoreReason?.trim()) {
      lines.push({
        text,
        sourceKind: "score",
        sourceId: null,
        activityType: null,
        conversationId: null,
      });
    }
    if (lines.length >= 20) break;
  }
  return lines;
}

function summaryFlags(
  ctx: LeadSummaryContext,
  flags: unknown,
  citations: LeadSummaryCitation[],
): Record<string, unknown> {
  const base =
    flags && typeof flags === "object" && !Array.isArray(flags)
      ? { ...(flags as Record<string, unknown>) }
      : {};
  return {
    ...base,
    citations,
    omniHash: omniChannelHash(ctx.omniChannelSummary),
    fitScore: ctx.fitScore,
    intentScore: ctx.intentScore,
    band: ctx.band,
    score: ctx.score,
  };
}

function overviewFromFlags(flags: unknown): string {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return "";
  const text = (flags as Record<string, unknown>).overview;
  return typeof text === "string" ? text.trim() : "";
}

function overviewReady(flags: unknown): boolean {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return false;
  return (flags as Record<string, unknown>).overviewReady === true;
}

function citationsFromFlags(flags: unknown): LeadSummaryCitation[] {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return [];
  const raw = (flags as Record<string, unknown>).citations;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const text = String(row.text || "").trim();
    const sourceKind =
      row.sourceKind === "omni"
        ? "omni"
        : row.sourceKind === "activity"
          ? "activity"
          : row.sourceKind === "score"
            ? "score"
            : null;
    if (!text || !sourceKind) return [];
    return [
      {
        text,
        sourceKind,
        sourceId: row.sourceId == null ? null : String(row.sourceId),
        activityType: row.activityType == null ? null : String(row.activityType),
        conversationId: row.conversationId == null ? null : String(row.conversationId),
      },
    ];
  });
}

export async function loadOmniChannelSummary(contactId: string): Promise<string | null> {
  try {
    const result = await accountQuery<{ summary: string | null }>(
      `
      SELECT NULLIF(BTRIM(custom_fields->>'omniChannelSummary'), '') AS summary
      FROM cdp.customer_profile
      WHERE cdp_id = $1
      LIMIT 1
      `,
      [contactId],
    );
    const text = result.rows[0]?.summary?.trim();
    return text || null;
  } catch (err) {
    console.error("omniChannelSummary read failed", contactId, err);
    return null;
  }
}

function plainBody(type: string, body: string | null): string | null {
  if (!body) return null;
  if (type === "note") {
    try {
      return parseNoteBody(body).plain || null;
    } catch {
      /* fall through */
    }
  }
  return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
}

export async function buildLeadSummaryContext(
  contactId: string,
  organizationId?: string | null,
): Promise<LeadSummaryContext | null> {
  const contact = await getContact(contactId);
  if (!contact) return null;

  const orgId = await resolveRequestOrganizationId(organizationId);
  const { person, crm, displayName } = contact;

  const [activities, orders, deals, companySnapshot, scoreJob, enrichmentSnap, omniChannelSummary] =
    await Promise.all([
      listContactActivities(contactId, 40),
      listOrdersForContact(contactId).catch(() => []),
      listDealsForContact(contactId).catch(() => []),
      person.companyId
        ? getCompanySnapshot(person.companyId).catch(() => null)
        : Promise.resolve(null),
      findScoringJobByContactId(contactId).catch(() => null),
      findLeadEnrichmentSnapshot(orgId, contactId).catch(() => null),
      loadOmniChannelSummary(contactId),
    ]);

  const callOrMeetingIds = activities
    .filter((activity) => activity.type === "call" || activity.type === "meeting")
    .map((activity) => activity.id);
  const transcriptById = new Map<string, string>();
  if (callOrMeetingIds.length) {
    const transcriptRows = await prisma.contactActivity
      .findMany({
        where: { id: { in: callOrMeetingIds }, transcriptText: { not: null } },
        select: { id: true, transcriptText: true },
      })
      .catch(() => []);
    for (const row of transcriptRows) {
      const text = row.transcriptText?.trim();
      if (text) transcriptById.set(row.id, text);
    }
  }

  const summaryJson =
    scoreJob?.resultSummary &&
    typeof scoreJob.resultSummary === "object" &&
    !Array.isArray(scoreJob.resultSummary)
      ? (scoreJob.resultSummary as Record<string, unknown>)
      : {};
  const breakdown =
    summaryJson.scoreBreakdown &&
    typeof summaryJson.scoreBreakdown === "object" &&
    !Array.isArray(summaryJson.scoreBreakdown)
      ? (summaryJson.scoreBreakdown as Record<string, number>)
      : null;

  return {
    organizationId: orgId,
    contactId,
    displayName,
    firstName: person.firstName,
    title: person.title,
    companyName: companySnapshot?.name ?? person.company?.name ?? null,
    industry: companySnapshot?.industry ?? person.company?.industry ?? null,
    companyDescription:
      enrichmentSnap?.company_description == null
        ? null
        : String(enrichmentSnap.company_description).trim() || null,
    products:
      enrichmentSnap?.products == null
        ? null
        : String(enrichmentSnap.products).trim() || null,
    employeeCount: companySnapshot?.employeeCount ?? null,
    domain: companySnapshot?.domain ?? person.company?.domain ?? null,
    linkedinUrl: companySnapshot?.linkedinUrl ?? null,
    contactType: person.contactType,
    leadStatus: person.leadStatus,
    status: crm.status,
    leadSource: crm.leadSource,
    bant: {
      budget: Boolean(person.bantBudget),
      authority: Boolean(person.bantAuthority),
      need: Boolean(person.bantNeed),
      timeline: Boolean(person.bantTimeline),
    },
    notes: crm.notes,
    orderCount: orders.length,
    deals: deals.map((d) => ({
      title: d.title,
      stage: d.stage,
      amount: d.amount?.toString() ?? null,
    })),
    activities: activities.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      body: plainBody(a.type, a.body),
      transcriptText: transcriptById.get(a.id) ?? null,
      createdAt: a.createdAt,
      taskStatus: a.taskStatus,
      completedAt: a.completedAt,
      dueAt: a.dueAt,
    })),
    score: scoreJob?.score ?? null,
    fitScore: scoreJob?.fitScore ?? null,
    intentScore: scoreJob?.intentScore ?? null,
    band: scoreJob?.band ?? null,
    nextBestAction: scoreJob?.nextBestAction ?? null,
    scoreBreakdown: breakdown,
    scoreRationale: scoreJob?.rationale ?? null,
    manualScoreReason:
      typeof summaryJson.manualReason === "string"
        ? summaryJson.manualReason.trim() || null
        : null,
    ownerUserId: person.ownerUserId?.trim() || crm.ownerUserId?.trim() || null,
    hasEmail: Boolean(person.email?.trim()),
    hasPhone: Boolean(person.phone?.trim()),
    omniChannelSummary,
  };
}

/**
 * Stable fingerprint of everything that should trigger a regen. When this
 * changes (new meeting booked, call logged with notes, stage moved, firmographics
 * enriched), the cached summary is invalidated.
 */
export function computeSignature(ctx: LeadSummaryContext): string {
  const salient = {
    t: ctx.title,
    c: ctx.companyName,
    ind: ctx.industry,
    desc: ctx.companyDescription,
    products: ctx.products,
    emp: ctx.employeeCount,
    li: ctx.linkedinUrl,
    ls: ctx.leadStatus,
    lc: ctx.contactType,
    st: ctx.status,
    src: ctx.leadSource,
    bant: ctx.bant,
    notes: ctx.notes,
    orders: ctx.orderCount,
    deals: ctx.deals,
    score: ctx.score,
    fit: ctx.fitScore,
    intent: ctx.intentScore,
    band: ctx.band,
    scoreReason: ctx.manualScoreReason,
    owner: ctx.ownerUserId,
    omni: ctx.omniChannelSummary,
    acts: ctx.activities.map((a) => [
      a.id,
      a.type,
      a.subject,
      a.body,
      a.transcriptText
        ? createHash("sha1").update(a.transcriptText).digest("hex")
        : null,
      a.taskStatus,
      a.completedAt,
      a.dueAt,
    ]),
  };
  return createHash("sha1").update(JSON.stringify(salient)).digest("hex");
}


export function computeLeadSummarySignature(ctx: LeadSummaryContext): string {
  return computeSignature(ctx);
}

export function deriveLeadIntent(ctx: LeadSummaryContext): string {
  return deriveIntent(ctx);
}

/** Short intent label when the LLM omits one — not used for narrative body. */
function deriveIntent(ctx: LeadSummaryContext): string {
  const meetings = ctx.activities.filter((a) => a.type === "meeting");
  const upcomingMeeting = meetings.some(
    (m) => m.dueAt && new Date(m.dueAt).getTime() > Date.now(),
  );
  const bantScore =
    Number(ctx.bant.budget) +
    Number(ctx.bant.authority) +
    Number(ctx.bant.need) +
    Number(ctx.bant.timeline);

  if (ctx.leadStatus === "converted") return "Converted";
  if (ctx.leadStatus === "disqualified") return "Disqualified";
  if (ctx.deals.length || upcomingMeeting || bantScore >= 3) {
    return "High buying intent";
  }
  if (meetings.length || ctx.activities.some((a) => a.type === "call")) {
    return "Active engagement";
  }
  if (ctx.activities.length) return "Exploratory";
  return "New lead";
}


/**
 * Lead summaries are LLM-only (Python summarize-lead). No heuristic narrative.
 * Returns null when the model is unavailable so callers can keep a prior AI
 * summary or show an empty state — never invent templated copy.
 */
export async function generateLeadSummary(
  _ctx: LeadSummaryContext,
): Promise<{ summary: string; source: "ai"; model: string | null } | null> {
  return null;
}

function toView(row: LeadSummaryRow, ctx?: LeadSummaryContext): LeadSummaryView {
  const citations = citationsFromFlags(row.flags);
  // Prefer cited signal lines over a legacy free-form headline/body that can
  // claim "no activity" while the timeline and citations show calls/messages.
  const citedSummary = citations.map((line) => line.text).join("\n\n").trim();
  const overview = overviewFromFlags(row.flags);
  return {
    summary: citedSummary || row.summary,
    headline: overview || (citedSummary ? null : row.headline),
    intent: row.intent,
    recommendedAction: ctx
      ? deriveProcessNextAction(ctx, row.recommendedAction)
      : row.recommendedAction,
    flags: row.flags,
    citations,
    omniChannelSummary: ctx?.omniChannelSummary ?? null,
    source: row.source,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Return the current lead summary, regenerating only when the lead signature
 * changed since the last generation (or when `force` is set).
 * Regeneration requires the AI summarize-lead agent — never heuristic text.
 */
export async function getOrRefreshLeadSummary(
  contactId: string,
  options?: { force?: boolean; fromQueue?: boolean; organizationId?: string | null },
): Promise<LeadSummaryView | null> {
  let existing: LeadSummaryRow | null = null;
  try {
    const ctx = await buildLeadSummaryContext(contactId, options?.organizationId);
    if (!ctx) return null;

    const signature = computeSignature(ctx);
    existing = await findLeadSummary(ctx.organizationId, contactId);
    const queued = await isLeadSummaryRefreshQueued(ctx.organizationId, contactId);
    if (queued && !options?.force && !options?.fromQueue) {
      if (existing?.source === "ai" && existing.summary.trim()) {
        return toView(existing, ctx);
      }
      return null;
    }
    if (
      existing &&
      existing.signature === signature &&
      !options?.force &&
      existing.source === "ai" &&
      existing.summary.trim() &&
      overviewReady(existing.flags)
    ) {
      return toView(existing, ctx);
    }

    const py = await callAiServiceAgent<{
      status?: string;
      summary?: string;
      intent?: string;
      source?: string;
      recommendedAction?: string | null;
      flags?: unknown;
      persistResult?: {
        summary?: string;
        intent?: string | null;
        source?: string;
        updatedAt?: string;
      };
    }>("summarize-lead", {
      contactId,
      organizationId: ctx.organizationId,
      force: Boolean(options?.force),
    }, { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS });

    const aiText = py?.summary?.trim() || "";
    const isAi =
      py?.status === "ok" &&
      Boolean(aiText) &&
      (py.source === "ai" || py.source == null);

    const citations = clampLeadSummaryCitations(
      py?.flags && typeof py.flags === "object"
        ? (py.flags as { citations?: unknown }).citations
        : null,
      ctx,
    );
    if (!isAi || citations.length === 0) {
      console.error(
        "getOrRefreshLeadSummary: AI summary required but unavailable",
        contactId,
        py?.status,
        py?.source,
        citations.length,
      );
      if (existing?.source === "ai" && existing.summary.trim()) {
        return toView(existing, ctx);
      }
      return null;
    }

    const citedSummary = citations.map((line) => line.text).join("\n\n");
    if (py.persistResult?.summary && py.persistResult.source === "ai") {
      const row = await findLeadSummary(ctx.organizationId, contactId);
      if (row?.source === "ai" && row.summary.trim() && citationsFromFlags(row.flags).length) {
        if (options?.fromQueue) {
          publishLeadSummaryEvent({ contactId, reason: "summary_refresh" });
        }
        return toView(row, ctx);
      }
    }

    const scoreJob = await findScoringJobByContactId(contactId);
    const flags = summaryFlags(ctx, py.flags, citations);
    const overview = overviewFromFlags(flags);
    flags.overview = overview;
    flags.overviewReady = true;
    flags.salesReady =
      typeof (ctx.score ?? scoreJob?.score) === "number" &&
      Number(ctx.score ?? scoreJob?.score) >= 40;
    const saved = await upsertLeadSummary({
      organizationId: ctx.organizationId,
      contactId,
      summary: citedSummary || aiText,
      headline: overview || null,
      intent: py.intent?.trim() || deriveIntent(ctx),
      recommendedAction: deriveProcessNextAction(
        ctx,
        py.recommendedAction?.trim() ||
          ctx.nextBestAction ||
          scoreJob?.nextBestAction ||
          null,
      ),
      flags,
      signature,
      source: "ai",
      model: "ai-service",
    });
    if (options?.fromQueue) {
      publishLeadSummaryEvent({ contactId, reason: "summary_refresh" });
    }
    return toView(saved, ctx);
  } catch (err) {
    console.error("getOrRefreshLeadSummary failed", err);
    if (existing?.source === "ai" && existing.summary.trim()) {
      return {
        summary: existing.summary,
        headline: existing.headline,
        intent: existing.intent,
        recommendedAction: existing.recommendedAction,
        flags: existing.flags,
        citations: citationsFromFlags(existing.flags),
        omniChannelSummary: null,
        source: existing.source,
        updatedAt: existing.updatedAt.toISOString(),
      };
    }
    return null;
  }
}
