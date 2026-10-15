/**
 * Full-signal context for the Lead Lifecycle Agent: the contact, its owner's
 * business type, every recent activity (including transcripts), the current
 * lead score, and the open deal / quote state.
 */

import type { DealStage, QuoteStatus } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { accountQuery } from "@/dao/db/account-pool";
import { getContact } from "@/dao/contacts/contact-service";
import { getContactProfileByAccountId } from "@/dao/contacts/contact-profile-repository";
import { getCompanySnapshot } from "@/dao/companies/sync-from-contacts";
import { getLeadScoreStatus } from "@/service/ai/lead-scoring-job";
import { loadOmniChannelSummary } from "@/service/ai/lead-summary-agent";
import {
  extractSignals,
  type LifecycleSignals,
  type SignalActivity,
} from "@/service/ai/lead-lifecycle-signals";
import type { BusinessType } from "@/config/modules";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { effectiveContactType } from "@/lib/contact-lifecycle";

/** Subject prefix used by `lead-lifecycle-apply` for its timeline notes. */
export const AGENT_NOTE_PREFIX = "Lifecycle agent:";

export type LifecycleDealContext = {
  id: string;
  title: string;
  stage: DealStage;
  amount: number | null;
  companyId: string | null;
  ownerUserId: string | null;
  closed: boolean;
  quotes: Array<{
    id: string;
    number: string;
    status: QuoteStatus;
    total: number;
    sentAt: string | null;
  }>;
  /** True when at least one invoice on this deal is paid (manual finance action). */
  hasPaidInvoice: boolean;
};

export type LifecycleContext = {
  organizationId: string;
  contactId: string;
  displayName: string;
  email: string;
  ownerUserId: string | null;
  businessType: BusinessType;
  contactType: string | null;
  leadStatus: string | null;
  contactStatus: string | null;
  companyId: string | null;
  companyName: string | null;
  /** Contact region — used to route ownership to a sales rep in that area. */
  country: string | null;
  city: string | null;
  convertedDealId: string | null;
  bant: {
    budget: boolean;
    authority: boolean;
    need: boolean;
    timeline: boolean;
    budgetDetail: string | null;
    authorityDetail: string | null;
    needDetail: string | null;
    timelineDetail: string | null;
  };
  /** CCaaS write-up of email, web chat, call, and messaging touchpoints. */
  omniChannelSummary: string | null;
  /** Newest customer and rep interactions, short enough for the qualification agent. */
  touchpoints: string[];
  score: number | null;
  salesReady: boolean;
  activityCount: number;
  outboundTouches: number;
  inboundReplies: number;
  meetings: number;
  daysSinceLastActivity: number | null;
  signals: LifecycleSignals;
  deal: LifecycleDealContext | null;
  /**
   * Past CRM meeting(s) ended without a capture transcript — agents must not
   * treat the meeting as conversation evidence for auto-advance.
   */
  missingMeetingCapture: boolean;
  /** Latest Meeting Analysis Agent row (structured — never raw transcript). */
  meetingAnalysis: {
    outcome: string | null;
    confidence: number;
    bantBudget: boolean | null;
    bantAuthority: boolean | null;
    bantNeed: boolean | null;
    nextStepAgreed: string | null;
  } | null;
  /** Hybrid CRM: human stage ownership stamp on contact_profiles. */
  lifecycleLastAction: string | null;
  lifecycleLastReason: string | null;
  lifecycleLastRunAt: string | null;
};

function clip(value: string | null | undefined, max = 180): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function touchpointLines(activities: SignalActivity[]): string[] {
  const lines: string[] = [];
  for (const activity of activities) {
    if (lines.length >= 8) break;
    const subject = activity.subject?.trim() ?? "";
    const body = clip(activity.body, 180);
    const text = [subject, body].filter(Boolean).join(" — ");
    if (!text) continue;
    const direction = activity.emailDirection ? ` ${activity.emailDirection}` : "";
    const when = activity.createdAt.slice(0, 10);
    lines.push(`${when} ${activity.type}${direction}: ${text}`);
  }
  return lines;
}

function parseBusinessType(raw: string | null | undefined): BusinessType | null {
  const v = raw?.trim().toLowerCase();
  if (v === "b2b" || v === "b2c" || v === "b2b2c") return v;
  return null;
}

/** Contacts are tagged with their business type at create/import time. */
function businessTypeFromTags(tags: string[]): BusinessType | null {
  for (const tag of tags) {
    const parsed = parseBusinessType(tag);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Cron has no session, so business type comes from the record owner and falls
 * back to the org's dominant configured type.
 */
export async function resolveBusinessTypeForContact(
  organizationId: string,
  ownerUserId: string | null,
): Promise<BusinessType> {
  try {
    if (ownerUserId) {
      const { rows } = await accountQuery<{ business_type: string | null }>(
        `SELECT o.business_type
         FROM accounts.setup_users u
         LEFT JOIN accounts.organizations o ON o.id = u.organization_id
         WHERE u.id = $1::bigint
         LIMIT 1`,
        [ownerUserId],
      );
      const owned = parseBusinessType(rows[0]?.business_type);
      if (owned) return owned;
    }

    const { rows } = await accountQuery<{
      business_type: string | null;
      count: string;
    }>(
      `SELECT o.business_type, COUNT(*)::text AS count
       FROM accounts.setup_users u
       JOIN accounts.organizations o ON o.id = u.organization_id
       WHERE u.status = 'active'
         AND o.business_type IS NOT NULL
         AND u.organization_id = $1::bigint
       GROUP BY o.business_type
       ORDER BY COUNT(*) DESC
       LIMIT 1`,
      [organizationId],
    );
    return parseBusinessType(rows[0]?.business_type) ?? "b2b";
  } catch (err) {
    console.error("resolveBusinessTypeForContact failed", err);
    return "b2b";
  }
}

async function loadDealContext(
  organizationId: string,
  contactId: string,
  convertedDealId: string | null,
): Promise<LifecycleDealContext | null> {
  const deals = await prisma.deal.findMany({
    where: {
      organizationId,
      OR: [
        { contactId },
        ...(convertedDealId ? [{ id: convertedDealId }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      stage: true,
      amount: true,
      companyId: true,
      ownerUserId: true,
    },
    take: 10,
  });
  if (deals.length === 0) return null;

  // Prefer an open deal — a re-opened conversation should not drive a won deal.
  const open = deals.find(
    (d) => d.stage !== "closed_won" && d.stage !== "closed_lost",
  );
  const deal = open ?? deals[0]!;

  const [quotes, paidInvoiceCount] = await Promise.all([
    prisma.quote.findMany({
      where: { dealId: deal.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        sentAt: true,
      },
      take: 20,
    }),
    prisma.invoice.count({
      where: { dealId: deal.id, status: "paid" },
    }),
  ]);

  return {
    id: deal.id,
    title: deal.title,
    stage: deal.stage,
    amount: deal.amount == null ? null : Number(deal.amount),
    companyId: deal.companyId,
    ownerUserId: deal.ownerUserId,
    closed: deal.stage === "closed_won" || deal.stage === "closed_lost",
    quotes: quotes.map((q) => ({
      id: q.id,
      number: q.number,
      status: q.status,
      total: Number(q.total),
      sentAt: q.sentAt?.toISOString() ?? null,
    })),
    hasPaidInvoice: paidInvoiceCount > 0,
  };
}

/**
 * Loads timeline activities as signal inputs. Transcript columns are new, so a
 * dev server running a stale Prisma client would otherwise throw
 * `Unknown field transcriptText` and block the whole agent — fall back to the
 * pre-transcript columns in that case (keyword extraction still works).
 */
async function loadSignalActivities(
  contactId: string,
): Promise<SignalActivity[]> {
  const where = {
    contactId,
    folder: { not: "trash" as const },
    // The agent's own audit notes must never read back as customer signal.
    NOT: { type: "note" as const, subject: { startsWith: AGENT_NOTE_PREFIX } },
  };
  const baseArgs = {
    where,
    orderBy: { createdAt: "desc" as const },
    take: 40,
  };

  try {
    const rows = await prisma.contactActivity.findMany({
      ...baseArgs,
      select: {
        type: true,
        subject: true,
        body: true,
        emailDirection: true,
        createdAt: true,
        dueAt: true,
        transcriptText: true,
        transcriptSource: true,
        transcriptInsights: true,
      },
    });
    return rows.map((a) => ({
      type: a.type,
      subject: a.subject,
      body: a.body,
      emailDirection: a.emailDirection,
      createdAt: a.createdAt.toISOString(),
      dueAt: a.dueAt?.toISOString() ?? null,
      transcriptText: a.transcriptText,
      transcriptSource: a.transcriptSource,
      transcriptInsights: a.transcriptInsights,
    }));
  } catch (err) {
    console.warn(
      "lifecycle: transcript columns unavailable (stale Prisma client?), falling back",
      err,
    );
    const rows = await prisma.contactActivity.findMany({
      ...baseArgs,
      select: {
        type: true,
        subject: true,
        body: true,
        emailDirection: true,
        createdAt: true,
      },
    });
    return rows.map((a) => ({
      type: a.type,
      subject: a.subject,
      body: a.body,
      emailDirection: a.emailDirection,
      createdAt: a.createdAt.toISOString(),
      transcriptText: null,
      transcriptInsights: null,
    }));
  }
}

export async function buildLifecycleContext(
  contactId: string,
  organizationId?: string | null,
): Promise<LifecycleContext | null> {
  const contact = await getContact(contactId);
  const overlay = contact
    ? null
    : await getContactProfileByAccountId(contactId);
  if (!contact && !overlay) return null;

  const company =
    !contact && overlay?.companyId
      ? await getCompanySnapshot(overlay.companyId).catch(() => null)
      : null;
  const person = contact?.person ?? {
    id: contactId,
    firstName: "",
    lastName: "",
    email: "",
    phone: null,
    secondaryEmails: [],
    secondaryPhones: [],
    title: null,
    addressLine: null,
    city: null,
    country: null,
    companyId: overlay!.companyId,
    locationId: overlay!.locationId,
    company: company
      ? {
          id: company.id,
          name: company.name,
          domain: company.domain,
          industry: company.industry,
        }
      : null,
    ownerUserId: overlay!.ownerUserId,
    organizationId: overlay!.organizationId,
    contactType: "lead" as const,
    leadSource: overlay!.leadSource,
    leadStatus: overlay!.leadStatus,
    disqualifyReason: overlay!.disqualifyReason,
    bantBudget: overlay!.bantBudget,
    bantAuthority: overlay!.bantAuthority,
    bantNeed: overlay!.bantNeed,
    bantTimeline: overlay!.bantTimeline,
    bantBudgetDetail: overlay!.bantBudgetDetail,
    bantAuthorityDetail: overlay!.bantAuthorityDetail,
    bantNeedDetail: overlay!.bantNeedDetail,
    bantTimelineDetail: overlay!.bantTimelineDetail,
    convertedDealId: overlay!.convertedDealId,
    tags: overlay!.tags,
    status: overlay!.status,
    notes: overlay!.notes,
    isPinned: overlay!.isPinned,
    createdAt: overlay!.createdAt,
    updatedAt: overlay!.updatedAt,
  };
  const crm = contact?.crm ?? {
    ownerUserId: overlay!.ownerUserId,
    createdByUserId: overlay!.createdByUserId,
    leadSource: overlay!.leadSource,
    tags: overlay!.tags,
    status: overlay!.status,
    notes: overlay!.notes,
  };
  const displayName = contact?.displayName ?? "Contact";

  const orgId = await resolveRequestOrganizationId(
    organizationId ?? person.organizationId,
  );

  const [activities, ownerBusinessType, score, deal, omniChannelSummary] =
    await Promise.all([
      loadSignalActivities(contactId),
      resolveBusinessTypeForContact(orgId, crm.ownerUserId),
      getLeadScoreStatus(contactId).catch(() => null),
      loadDealContext(orgId, contactId, person.convertedDealId ?? null),
      loadOmniChannelSummary(contactId),
    ]);

  const { markMissingMeetingCapturesForContact, contactHasMissingMeetingCapture } =
    await import("@/service/transcripts/meeting-capture");
  await markMissingMeetingCapturesForContact(contactId).catch(() => 0);
  const missingMeetingCapture = await contactHasMissingMeetingCapture(
    contactId,
  ).catch(() => false);

  // The contact's own tag is the most reliable per-record signal; the owner's
  // configured type and the org's dominant type are fallbacks only.
  const businessType =
    businessTypeFromTags(person.tags ?? []) ?? ownerBusinessType;

  const outboundTouches = activities.filter(
    (a) =>
      a.type === "call" ||
      a.type === "meeting" ||
      (a.type === "email" && a.emailDirection !== "inbound"),
  ).length;
  const inboundReplies = activities.filter(
    (a) => a.type === "email" && a.emailDirection === "inbound",
  ).length;
  const meetings = activities.filter(
    (a) => a.type === "meeting" || a.type === "call",
  ).length;

  const last = activities[0];
  const daysSinceLastActivity = last
    ? Math.floor(
        (Date.now() - new Date(last.createdAt).getTime()) / (24 * 60 * 60_000),
      )
    : null;

  const signals = extractSignals(activities, crm.notes);

  let meetingAnalysis: LifecycleContext["meetingAnalysis"] = null;
  try {
    const { latestMeetingAnalysisForContact } = await import(
      "@/dao/ai/meeting-analysis-store"
    );
    const row = await latestMeetingAnalysisForContact(contactId);
    if (row) {
      meetingAnalysis = {
        outcome: (row.outcome as string) ?? null,
        confidence: Number(row.confidence ?? 0),
        bantBudget:
          row.bant_budget == null ? null : Boolean(row.bant_budget),
        bantAuthority:
          row.bant_authority == null ? null : Boolean(row.bant_authority),
        bantNeed: row.bant_need == null ? null : Boolean(row.bant_need),
        nextStepAgreed: (row.next_step_agreed as string) ?? null,
      };
      if (meetingAnalysis.bantBudget) signals.budget = true;
      if (meetingAnalysis.bantAuthority) signals.authority = true;
      if (meetingAnalysis.bantNeed) signals.need = true;
      if (
        meetingAnalysis.confidence >= 0.5 &&
        meetingAnalysis.outcome &&
        meetingAnalysis.outcome !== "no_show"
      ) {
        signals.meetingHeld = true;
        if (
          !signals.evidence.some((e) => e.startsWith("meeting analysis"))
        ) {
          signals.evidence.push(
            `meeting analysis (${meetingAnalysis.outcome})`,
          );
        }
      }
    }
  } catch {
    /* table may not exist until migration */
  }

  let lifecycleLastAction: string | null = null;
  let lifecycleLastReason: string | null = null;
  let lifecycleLastRunAt: string | null = null;
  try {
    const meta = await prisma.contactProfile.findUnique({
      where: { accountContactId: contactId },
      select: {
        lifecycleLastAction: true,
        lifecycleLastReason: true,
        lifecycleLastRunAt: true,
      },
    });
    lifecycleLastAction = meta?.lifecycleLastAction ?? null;
    lifecycleLastReason = meta?.lifecycleLastReason ?? null;
    lifecycleLastRunAt = meta?.lifecycleLastRunAt?.toISOString() ?? null;
  } catch {
    /* columns may be absent until migration */
  }

  return {
    organizationId: orgId,
    contactId,
    displayName,
    email: person.email,
    ownerUserId: crm.ownerUserId,
    businessType,
    contactType: effectiveContactType(person.contactType),
    leadStatus: person.leadStatus,
    contactStatus: crm.status,
    companyId: person.companyId ?? null,
    companyName: person.company?.name ?? null,
    country: person.country?.trim() || null,
    city: person.city?.trim() || null,
    convertedDealId: person.convertedDealId ?? null,
    bant: {
      budget: Boolean(person.bantBudget) || Boolean(meetingAnalysis?.bantBudget),
      authority:
        Boolean(person.bantAuthority) || Boolean(meetingAnalysis?.bantAuthority),
      need: Boolean(person.bantNeed) || Boolean(meetingAnalysis?.bantNeed),
      timeline: Boolean(person.bantTimeline),
      budgetDetail: clip(person.bantBudgetDetail, 240),
      authorityDetail: clip(person.bantAuthorityDetail, 240),
      needDetail: clip(person.bantNeedDetail, 240),
      timelineDetail: clip(person.bantTimelineDetail, 240),
    },
    score: score?.score ?? null,
    salesReady: Boolean(score?.salesReady),
    omniChannelSummary: clip(omniChannelSummary, 1200),
    touchpoints: touchpointLines(activities),
    activityCount: activities.length,
    outboundTouches,
    inboundReplies,
    meetings,
    daysSinceLastActivity,
    signals,
    deal,
    missingMeetingCapture,
    meetingAnalysis,
    lifecycleLastAction,
    lifecycleLastReason,
    lifecycleLastRunAt,
  };
}
