/**
 * Transcript intake and analysis for the Lead Lifecycle Agent.
 *
 * Providers (Zoom / Meet / manual upload) attach raw text through
 * `attachActivityTranscript`; the agent analyzes anything unanalyzed before it
 * decides, caching structured insights on the activity so repeat runs are free.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { analyzeTranscript } from "@/service/ai/lead-lifecycle-signals";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import { triggerPostMeetingProcess } from "@/service/ai/post-meeting-process";
import { triggerMeetingMom } from "@/service/ai/meeting-mom";
import { triggerSalesCoachAssess } from "@/service/ai/sales-coach-assess";
import { enqueueLeadScoring } from "@/service/ai/lead-scoring-job";

/** MOM, post-meeting, coach — idempotent inside each agent. */
export function triggerPostMeetingAgentsForActivity(input: {
  activityId: string;
  contactId: string;
  organizationId: string;
  /** Re-run lead lifecycle + scoring (new/changed transcript). */
  includeLifecycle?: boolean;
  /** Re-score after terminal capture when lifecycle is skipped. Default true. */
  includeScoring?: boolean;
}): void {
  if (input.includeLifecycle) {
    triggerLeadLifecycle({
      contactId: input.contactId,
      organizationId: input.organizationId,
      triggerReason: "transcript_attached",
    });
  }

  if (input.includeLifecycle || input.includeScoring !== false) {
    void enqueueLeadScoring({
      contactId: input.contactId,
      organizationId: input.organizationId,
      triggerReason: "transcript_attached",
      processImmediately: true,
    }).catch((err) => {
      console.error("scoring enqueue after transcript failed", err);
    });
  }

  triggerPostMeetingProcess({
    activityId: input.activityId,
    contactId: input.contactId,
  });

  triggerMeetingMom({
    activityId: input.activityId,
    contactId: input.contactId,
  });

  triggerSalesCoachAssess({
    activityId: input.activityId,
    contactId: input.contactId,
  });
}

export async function attachActivityTranscript(input: {
  activityId: string;
  transcript: string;
  source?: string | null;
  /** MOM, post-meeting, coach — only when capture/meeting is terminal. Default true. */
  runPostMeetingAgents?: boolean;
}): Promise<{
  ok: boolean;
  contactId: string | null;
  unchanged?: boolean;
}> {
  const text = input.transcript?.trim();
  if (!text) return { ok: false, contactId: null };

  const source = input.source?.trim() || "manual";
  const runAgents = input.runPostMeetingAgents !== false;

  const existing = await prisma.contactActivity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      contactId: true,
      organizationId: true,
      transcriptText: true,
      transcriptSource: true,
    },
  });
  if (!existing) return { ok: false, contactId: null };

  const priorText = existing.transcriptText?.trim() || "";
  const priorSource = existing.transcriptSource?.trim() || "";

  if (priorText === text) {
    if (priorSource !== source) {
      await prisma.contactActivity.update({
        where: { id: input.activityId },
        data: { transcriptSource: source },
      });
    }
    if (runAgents) {
      triggerPostMeetingAgentsForActivity({
        activityId: existing.id,
        contactId: existing.contactId,
        organizationId: String(existing.organizationId),
        includeLifecycle: false,
      });
    }
    return { ok: true, contactId: existing.contactId, unchanged: true };
  }

  const textChanged = priorText !== text;
  const activity = await prisma.contactActivity.update({
    where: { id: input.activityId },
    data:
      runAgents && textChanged
        ? {
            transcriptText: text,
            transcriptSource: source,
            transcriptAnalyzedAt: null,
            transcriptInsights: Prisma.DbNull,
          }
        : {
            transcriptText: text,
            transcriptSource: source,
          },
    select: { contactId: true, id: true, organizationId: true },
  });

  if (textChanged) {
    const { scheduleLeadSummaryRefresh } = await import(
      "@/service/ai/lead-summary-refresh"
    );
    await scheduleLeadSummaryRefresh({
      organizationId: String(activity.organizationId),
      contactId: activity.contactId,
    }).catch((err) => {
      console.error("schedule lead summary refresh failed", err);
    });
  }

  if (!runAgents) {
    const { scheduleCustomerBantCapture } = await import(
      "@/service/ai/contact-bant-from-communication"
    );
    scheduleCustomerBantCapture({
      contactId: activity.contactId,
      type: "call",
      transcriptText: text,
    });
    return { ok: true, contactId: activity.contactId };
  }

  triggerPostMeetingAgentsForActivity({
    activityId: activity.id,
    contactId: activity.contactId,
    organizationId: String(activity.organizationId),
    includeLifecycle: true,
  });

  return { ok: true, contactId: activity.contactId };
}

/**
 * Runs the extractor over transcripts that have not been analyzed yet.
 * Bounded per run so one chatty contact cannot eat the job budget.
 */
export async function analyzePendingTranscripts(
  contactId: string,
  limit = 3,
): Promise<number> {
  const pending = await prisma.contactActivity.findMany({
    where: {
      contactId,
      transcriptText: { not: null },
      transcriptAnalyzedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, transcriptText: true, type: true },
  });
  if (pending.length === 0) return 0;

  let analyzed = 0;
  for (const row of pending) {
    if (!row.transcriptText) continue;
    let insights: Record<string, unknown> | null = null;
    try {
      insights = await analyzeTranscript(row.transcriptText);
    } catch (err) {
      console.error("transcript analysis failed", row.id, err);
    }

    // Mark analyzed either way: without AI the keyword pass over
    // `transcriptText` still feeds the decision, and we should not retry
    // forever.
    await prisma.contactActivity.update({
      where: { id: row.id },
      data: {
        transcriptAnalyzedAt: new Date(),
        ...(insights
          ? { transcriptInsights: insights as Prisma.InputJsonObject }
          : {}),
      },
    });
    if (insights) {
      analyzed += 1;
      try {
        const { upsertMeetingAnalysis } = await import(
          "@/dao/ai/meeting-analysis-store"
        );
        const { resolveRequestOrganizationId } = await import(
          "@/service/auth/require-role"
        );
        const organizationId = await resolveRequestOrganizationId();
        // CRM meeting/call transcripts imply a held conversation — prefer
        // positive so neutral default does not trap post-meeting elevation.
        const outcome = insights.declined
          ? "objection"
          : insights.accepted ||
              insights.discoveryDone ||
              insights.need ||
              insights.meetingBooked ||
              row.type === "meeting" ||
              row.type === "call"
            ? "positive"
            : "neutral";
        const { persistCustomerBantFlags } = await import(
          "@/service/ai/contact-bant-from-communication"
        );
        await persistCustomerBantFlags(contactId, {
          budget: insights.budget,
          authority: insights.authority,
          need: insights.need,
          timeline: insights.timeline,
          budgetDetail: insights.budgetDetail,
          authorityDetail: insights.authorityDetail,
          needDetail: insights.needDetail,
          timelineDetail: insights.timelineDetail,
        }).catch((err) => {
          console.error("contact BANT from transcript failed", row.id, err);
        });
        await upsertMeetingAnalysis({
          organizationId,
          activityId: row.id,
          contactId,
          outcome,
          bantBudget: insights.budget === true,
          bantAuthority: insights.authority === true,
          bantNeed: insights.need === true,
          bantTimelineText:
            typeof insights.timelineDetail === "string" &&
            insights.timelineDetail.trim()
              ? insights.timelineDetail.trim().slice(0, 256)
              : insights.timeline === true
                ? "mentioned"
                : null,
          confidence: 0.7,
          evidence: Array.isArray(insights.evidence)
            ? (insights.evidence as string[]).filter((e) => typeof e === "string")
            : [],
        });
      } catch (err) {
        console.error("meeting analysis persist failed", row.id, err);
      }
    }
  }
  return analyzed;
}
