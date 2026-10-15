/**
 * Meeting miss escalation — after capture grace, escalate meetings with no
 * transcript evidence. Cron detects; Python meeting-miss-escalation agent
 * analyzes (LLM primary). Delivery uses the shared notifyAdmins + CRM-bot
 * HTML notification — not a connected-inbox email.
 *
 * One attempt per meeting: stamp missEscalatedAt after notify.
 */

import { prisma } from "@/dao/db/prisma";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { notifyAdmins } from "@/dao/notifications/notify-admins";
import {
  missingGraceHours,
  patchCaptureBotMeta,
  readCaptureBotMeta,
  reconcileDueMeetingCaptures,
  reconcileMeetingCapture,
} from "@/service/transcripts/meeting-capture";
import { buildMeetingBriefContext } from "@/service/ai/meeting-brief";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";

export type MeetingMissEscalationResult = {
  checked: number;
  escalated: number;
  notifyOnly: number;
  errors: string[];
};

async function contactSweepHeld(
  organizationId: string,
  contactId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ held: boolean }>>(
    `
    SELECT EXISTS (
      SELECT 1 FROM lead_nurture_jobs
      WHERE organization_id = $1::bigint
        AND contact_id = $2::text
        AND next_retry_at > NOW() + INTERVAL '1 year'
    ) AS held
    `,
    organizationId,
    contactId,
  );
  return rows[0]?.held === true;
}

/**
 * Org-wide sweep. Safe to call every 15–30 minutes via cron.
 */
export async function processMeetingMissEscalations(): Promise<MeetingMissEscalationResult> {
  await reconcileDueMeetingCaptures().catch(() => ({ checked: 0, pulled: 0 }));

  const graceMs = missingGraceHours() * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - graceMs);
  const graceHours = missingGraceHours();

  const meetings = await prisma.contactActivity.findMany({
    where: {
      type: "meeting",
      missEscalatedAt: null,
      dueAt: { lte: cutoff },
      OR: [{ transcriptText: null }, { transcriptText: "" }],
    },
    take: 50,
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      contactId: true,
      organizationId: true,
      subject: true,
      body: true,
      dueAt: true,
      createdByUserId: true,
    },
  });

  let escalated = 0;
  let notifyOnly = 0;
  const errors: string[] = [];

  for (const meeting of meetings) {
    const organizationId = String(meeting.organizationId);
    if (
      meeting.contactId &&
      (await contactSweepHeld(organizationId, meeting.contactId))
    ) {
      await prisma.contactActivity.update({
        where: { id: meeting.id },
        data: { missEscalatedAt: new Date() },
      });
      continue;
    }
    try {
      const session = await prisma.meetingAssistSession.findUnique({
        where: { activityId: meeting.id },
        select: { id: true, meta: true },
      });
      let captureStatus: string | null = null;
      let captureError: string | null = null;
      if (session) {
        const pulled = await reconcileMeetingCapture(meeting.id).catch(() => false);
        if (pulled) continue;
        const cap = readCaptureBotMeta(
          (
            await prisma.meetingAssistSession.findUnique({
              where: { id: session.id },
              select: { meta: true },
            })
          )?.meta ?? session.meta,
        );
        captureStatus = cap?.status ?? null;
        captureError = cap?.error ?? null;
        if (cap?.status !== "done" && cap?.status !== "missing") {
          await patchCaptureBotMeta(session.id, {
            status: "missing",
            botId: cap?.botId,
            error:
              cap?.status === "failed"
                ? cap.error || "Capture failed."
                : "No transcript after meeting ended — bot may not have been admitted, or capture failed.",
          });
          captureStatus = "missing";
        }
      }

      await prisma.contactActivity.update({
        where: { id: meeting.id },
        data: {
          transcriptSource: "missing_capture",
        },
      });

      const brief = await buildMeetingBriefContext(
        meeting.id,
        organizationId,
      );
      if (!brief) {
        errors.push(`${meeting.id}: context_not_found`);
        // Terminal — do not retry forever when context cannot be built.
        await prisma.contactActivity.update({
          where: { id: meeting.id },
          data: { missEscalatedAt: new Date() },
        });
        continue;
      }

      let leadSummary: string | null = null;
      try {
        const { getOrRefreshLeadSummary } = await import(
          "@/service/ai/lead-summary-agent"
        );
        const summary = await getOrRefreshLeadSummary(meeting.contactId, {
          organizationId,
        });
        leadSummary = summary?.summary?.trim() || null;
      } catch {
        leadSummary = null;
      }

      const context = {
        ...brief,
        captureStatus,
        captureError,
        graceHours,
        leadSummary,
        dueAt: meeting.dueAt?.toISOString() ?? null,
        organizerName: brief.ownerName,
        // meeting_miss_escalation_agent.run() reads contact_id from
        // ctx.get("contactId") — it has no separate contactId kwarg.
        contactId: meeting.contactId,
      };

      const agent = await callAiServiceAgent<{
        ok?: boolean;
        subject?: string | null;
        body?: string | null;
        inAppTitle?: string | null;
        inAppBody?: string | null;
        importanceTier?: string | null;
        reason?: string | null;
        source?: string | null;
        analysis?: { recommendedNextStep?: string | null } | null;
      }>(
        "meeting-miss-escalation",
        {
          context,
          organizationId,
          activityId: meeting.id,
        },
        { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
      );

      const agentOk = Boolean(agent?.ok && agent.subject?.trim() && agent.body?.trim());
      const source = agent?.source === "heuristic" ? "heuristic" : agentOk ? "ai" : null;
      if (!agentOk) {
        errors.push(
          `${meeting.id}: agent_failed:${agent?.reason || "empty_or_unavailable"}`,
        );
      } else if (source === "heuristic") {
        console.warn(
          "meeting-miss agent used offline fallback",
          meeting.id,
          agent?.reason,
        );
      }

      const notified = await notifyAdmins({
        organizationId,
        kind: "meeting_miss",
        href: `/contact/${meeting.contactId}`,
        entityType: "contact_activity",
        entityId: meeting.id,
        contactId: meeting.contactId,
        contactName: brief.contactName,
        companyName: brief.companyName,
        activityType: "meeting",
        activitySubject: meeting.subject,
        ownerUserId: brief.ownerUserId,
        detail: agent?.inAppBody?.trim() || agent?.body?.trim()?.slice(0, 500) || null,
        nextStep: agent?.analysis?.recommendedNextStep?.trim() || null,
        metadata: {
          agent: "meeting_miss_escalation",
          activityId: meeting.id,
          importanceTier: agent?.importanceTier ?? null,
          ownerUserId: brief.ownerUserId,
          source,
        },
      });

      const outcome = notified.length > 0 ? "notified" : "notify_empty";

      await writeAuditLog({
        actorUserId: brief.ownerUserId,
        action: "update",
        entityType: "contact_activity",
        entityId: meeting.id,
        organizationId,
        meta: {
          agent: "meeting_miss_escalation",
          outcome,
          contactId: meeting.contactId,
          ownerUserId: brief.ownerUserId,
          recipientCount: notified.length,
          importanceTier: agent?.importanceTier ?? null,
          source,
          reason: agent?.reason ?? null,
        },
      });

      await prisma.contactActivity.update({
        where: { id: meeting.id },
        data: { missEscalatedAt: new Date() },
      });

      if (outcome === "notified") escalated += 1;
      else notifyOnly += 1;
    } catch (err) {
      errors.push(
        `${meeting.id}: ${err instanceof Error ? err.message : "escalation failed"}`,
      );
      await writeAuditLog({
        action: "update",
        entityType: "contact_activity",
        entityId: meeting.id,
        organizationId,
        meta: {
          agent: "meeting_miss_escalation",
          outcome: "failed",
          contactId: meeting.contactId,
          reason: err instanceof Error ? err.message : "unknown",
        },
      }).catch(() => undefined);
      // Terminal stamp so cron does not hammer the same meeting.
      await prisma.contactActivity
        .update({
          where: { id: meeting.id },
          data: { missEscalatedAt: new Date() },
        })
        .catch(() => undefined);
    }
  }

  return {
    checked: meetings.length,
    escalated,
    notifyOnly,
    errors,
  };
}
