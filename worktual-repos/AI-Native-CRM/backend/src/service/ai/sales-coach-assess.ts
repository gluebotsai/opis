/**
 * Sales & Pre-sales Coach Agent — after a call/meeting transcript is
 * attached, gives the rep private, evidence-based coaching feedback.
 *
 * Stateless / event-driven, same shape as `meeting-mom.ts` /
 * `post-meeting-analyze.ts`: this file gathers all context and makes one
 * `callAiServiceAgent` call; the Python agent never calls back into the CRM.
 *
 * HITL rule: the raw coaching note stays private to the rep. Sales managers
 * and organization admins receive a performance summary (impression +
 * strengths/growth areas) — never the coaching note or transcript. Aggregate
 * counts also live in `report-service.ts`.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { getContact } from "@/dao/contacts/contact-service";
import { getUserLabelsByIds } from "@/service/account/user-directory";
import { notifyUsers } from "@/dao/notifications/notify-users";
import { notifySalesEscalation } from "@/service/ai/sales-escalation-notify";
import { writeAuditLog } from "@/dao/audit/audit-log";
import {
  callAiServiceAgent,
  AI_SERVICE_JOB_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";

const MIN_TRANSCRIPT_CHARS = 150;
const DAY_MS = 24 * 60 * 60_000;
const OVERALL_IMPRESSIONS = new Set(["strong", "solid", "needs_work"]);

export type SalesCoachInsight = {
  overallImpression: "strong" | "solid" | "needs_work";
  discoveryQuality: string | null;
  objectionHandling: string | null;
  methodologyNote: string | null;
  talkBalanceNote: string | null;
  strengths: string[];
  growthAreas: string[];
  highlightedMoment: string | null;
  coachingNote: string;
};

const IMPRESSION_LABEL: Record<
  SalesCoachInsight["overallImpression"],
  string
> = {
  strong: "Strong",
  solid: "Solid",
  needs_work: "Needs work",
};

/** Leadership copy — never include `coachingNote` or transcript excerpts. */
export function buildRepPerformanceNotice(input: {
  repName: string | null;
  contactName: string | null;
  activityType: string;
  overallImpression: SalesCoachInsight["overallImpression"];
  strengths: string[];
  growthAreas: string[];
}): { title: string; body: string; nextStep: string } {
  const impression = IMPRESSION_LABEL[input.overallImpression];
  const who = input.repName?.trim() || "Sales rep";
  const contact = input.contactName?.trim() || "the contact";
  const growth =
    input.growthAreas
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join("; ") || "No specific growth areas noted.";
  const strengths = input.strengths
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("; ");

  return {
    title: `Rep performance: ${who} — ${impression}`,
    body: [
      `${who} received a ${impression.toLowerCase()} signal on the ${input.activityType} with ${contact}.`,
      strengths ? `Strengths: ${strengths}` : null,
      `Focus areas: ${growth}`,
    ]
      .filter(Boolean)
      .join(" "),
    nextStep:
      input.overallImpression === "needs_work"
        ? "Review the meeting with the rep and confirm follow-up actions are logged in CRM."
        : "Scan the focus areas and use them in the next 1:1 if they recur.",
  };
}

export type SalesCoachResult = {
  ran: boolean;
  skipped?: string;
  insightId?: string;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function normalizeInsight(raw: unknown): SalesCoachInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const impression = String(obj.overallImpression || "").trim().toLowerCase();
  if (!OVERALL_IMPRESSIONS.has(impression)) return null;
  const coachingNote = String(obj.coachingNote || "").trim();
  if (!coachingNote) return null;

  return {
    overallImpression: impression as SalesCoachInsight["overallImpression"],
    discoveryQuality: obj.discoveryQuality ? String(obj.discoveryQuality).trim() : null,
    objectionHandling: obj.objectionHandling ? String(obj.objectionHandling).trim() : null,
    methodologyNote: obj.methodologyNote ? String(obj.methodologyNote).trim() : null,
    talkBalanceNote: obj.talkBalanceNote ? String(obj.talkBalanceNote).trim() : null,
    strengths: toStringArray(obj.strengths),
    growthAreas: toStringArray(obj.growthAreas),
    highlightedMoment: obj.highlightedMoment ? String(obj.highlightedMoment).trim() : null,
    coachingNote,
  };
}

/**
 * Analyze one call/meeting transcript and privately notify the rep.
 * Idempotent via `CoachingInsight.activityId` upsert — safe to call more
 * than once for the same activity (e.g. transcript re-attached).
 */
export async function runSalesCoachAssess(input: {
  activityId: string;
  contactId?: string | null;
}): Promise<SalesCoachResult> {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      contactId: true,
      organizationId: true,
      type: true,
      transcriptText: true,
      createdByUserId: true,
    },
  });
  if (!activity) return { ran: false, skipped: "not_found" };
  if (activity.type !== "meeting" && activity.type !== "call") {
    return { ran: false, skipped: "not_call_or_meeting" };
  }
  const repUserId = activity.createdByUserId ? String(activity.createdByUserId) : null;
  if (!repUserId) return { ran: false, skipped: "no_rep" };

  const transcript = activity.transcriptText?.trim() || "";
  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    return { ran: false, skipped: "transcript_too_short" };
  }

  const organizationId = String(activity.organizationId);
  const contactId = input.contactId || activity.contactId;

  const [contact, repLabels, priorInsights, openDeal] = await Promise.all([
    getContact(contactId),
    getUserLabelsByIds([repUserId]),
    prisma.coachingInsight.findMany({
      where: { organizationId: BigInt(organizationId), repUserId: BigInt(repUserId) },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { growthAreas: true },
    }),
    prisma.deal.findFirst({
      where: { organizationId: BigInt(organizationId), contactId, closedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
    }),
  ]);

  const contactName =
    contact?.displayName?.trim() ||
    [contact?.person.firstName, contact?.person.lastName].filter(Boolean).join(" ").trim() ||
    contact?.person.email ||
    null;
  const companyName = contact?.person.company?.name?.trim() || null;
  const repName = repLabels.get(repUserId) || null;
  const priorGrowthAreas = [
    ...new Set(
      priorInsights.flatMap((row: { growthAreas: unknown }) =>
        toStringArray(row.growthAreas),
      ),
    ),
  ].slice(0, 6);

  const ai = await callAiServiceAgent<{ ok?: boolean; insight?: unknown }>(
    "sales-coach",
    {
      transcript: transcript.slice(0, 16000),
      repName,
      contactName,
      companyName,
      priorGrowthAreas,
      activityId: activity.id,
      contactId,
      organizationId,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  const insight = normalizeInsight(ai?.insight);
  if (!ai?.ok || !insight) {
    await writeAuditLog({
      actorUserId: repUserId,
      action: "update",
      entityType: "contact_activity",
      entityId: activity.id,
      organizationId,
      meta: { agent: "sales_coach", outcome: "failed", contactId },
    }).catch(() => {});
    return { ran: false, skipped: "no_insight" };
  }

  const existingInsight = await prisma.coachingInsight.findUnique({
    where: { activityId: activity.id },
    select: { id: true },
  });

  const saved = await prisma.coachingInsight.upsert({
    where: { activityId: activity.id },
    create: {
      organizationId: BigInt(organizationId),
      activityId: activity.id,
      contactId,
      dealId: openDeal?.id ?? null,
      repUserId: BigInt(repUserId),
      interactionType: activity.type,
      overallImpression: insight.overallImpression,
      discoveryQuality: insight.discoveryQuality,
      objectionHandling: insight.objectionHandling,
      methodologyNote: insight.methodologyNote,
      talkBalanceNote: insight.talkBalanceNote,
      strengths: insight.strengths as Prisma.InputJsonValue,
      growthAreas: insight.growthAreas as Prisma.InputJsonValue,
      highlightedMoment: insight.highlightedMoment,
      coachingNote: insight.coachingNote,
    },
    update: {
      overallImpression: insight.overallImpression,
      discoveryQuality: insight.discoveryQuality,
      objectionHandling: insight.objectionHandling,
      methodologyNote: insight.methodologyNote,
      talkBalanceNote: insight.talkBalanceNote,
      strengths: insight.strengths as Prisma.InputJsonValue,
      growthAreas: insight.growthAreas as Prisma.InputJsonValue,
      highlightedMoment: insight.highlightedMoment,
      coachingNote: insight.coachingNote,
      analyzedAt: new Date(),
    },
    select: { id: true },
  });

  // Private coaching note → the rep. Performance summary → managers + admins.
  // Notify once per activity (upsert may re-run).
  if (!existingInsight) {
    await notifyUsers({
      organizationId,
      recipientUserIds: [repUserId],
      kind: "coaching_insight",
      title: "New coaching feedback on your last call",
      body: insight.coachingNote,
      href: "/dashboard",
      entityType: "coaching_insight",
      entityId: saved.id,
      contactId,
    }).catch((err) => {
      console.error("sales-coach notifyUsers failed", err);
    });

    const notice = buildRepPerformanceNotice({
      repName,
      contactName,
      activityType: activity.type,
      overallImpression: insight.overallImpression,
      strengths: insight.strengths,
      growthAreas: insight.growthAreas,
    });
    void notifySalesEscalation({
      organizationId,
      kind: "rep_performance",
      title: notice.title,
      body: notice.body,
      href: `/contact/${contactId}`,
      contactId,
      entityType: "contact_activity",
      entityId: activity.id,
      ownerUserId: repUserId,
      contactName,
      companyName,
      dealTitle: openDeal?.title ?? null,
      actorUserId: repUserId,
      nextStep: notice.nextStep,
      metadata: {
        coachingInsightId: saved.id,
        overallImpression: insight.overallImpression,
      },
    }).catch(() => undefined);

    if (insight.overallImpression === "needs_work" && activity.type === "meeting") {
      const needsWorkCount = await prisma.coachingInsight.count({
        where: {
          organizationId: BigInt(organizationId),
          repUserId: BigInt(repUserId),
          overallImpression: "needs_work",
          analyzedAt: { gte: new Date(Date.now() - 30 * DAY_MS) },
        },
      });
      if (needsWorkCount === 3) {
        void notifySalesEscalation({
          organizationId,
          kind: "rep_coaching_pattern",
          title: `Rep coaching pattern: ${repName || "Sales rep"}`,
          body: `${repName || "This rep"} has ${needsWorkCount} needs-work coaching signals in the last 30 days. Review enablement or ride-along support.`,
          href: "/reports",
          ownerUserId: repUserId,
          actorUserId: repUserId,
          nextStep: "Schedule coaching or review recent meetings for recurring gaps.",
          metadata: {
            needsWorkCount,
            windowDays: 30,
          },
        }).catch(() => undefined);
      }
    }
  }

  await writeAuditLog({
    actorUserId: repUserId,
    action: "update",
    entityType: "contact_activity",
    entityId: activity.id,
    organizationId,
    meta: {
      agent: "sales_coach",
      outcome: "completed",
      overallImpression: insight.overallImpression,
      contactId,
    },
  });

  return { ran: true, insightId: saved.id };
}

/** Fire-and-forget wrapper — call right after a transcript is attached. */
export function triggerSalesCoachAssess(input: {
  activityId: string;
  contactId?: string | null;
}): void {
  void runSalesCoachAssess(input).catch((err) => {
    console.error("sales-coach assess failed", input.activityId, err);
  });
}
