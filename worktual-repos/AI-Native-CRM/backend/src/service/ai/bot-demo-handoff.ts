/**
 * Bot-mail demo requests: assign a sales rep and acknowledge — never book on bot.
 * Calendar booking runs only on the assigned rep's connected mailbox.
 */

import { getContact } from "@/dao/contacts/contact-service";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { findScoringJobByContactId } from "@/dao/ai/lead-scoring-store";
import { skipPendingAutoReplyForContact } from "@/dao/ai/email-auto-reply-store";
import { notifyOwnerOrAdmins, notifyUsers } from "@/dao/notifications/notify-users";
import { listAdminUsers } from "@/service/account/user-directory";
import { sendCrmBotEmail } from "@/service/email/send-crm-bot-email";
import {
  crmBotEmailThreadingFromInbound,
  loadInboundEmailThreadHeaders,
} from "@/service/email/inbound-thread-headers";
import { routeLeadAfterScore } from "@/service/ai/lead-score-route";
import { enqueueLeadScoring } from "@/service/ai/lead-scoring-job";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import {
  parsePreferredDateTime,
  DEMO_TIMEZONE,
} from "@/service/ai/demo-booking";
import { resolveSetupUserDeliveryEmail } from "@/service/account/setup-users";
import {
  crmBotMailboxEmail,
  emailHeadersMention,
} from "@/dao/inbox/email-activity-user";
import {
  SALES_READY_SCORE,
  bandFromScore,
  gradeFromScore,
  type LeadScoreBand,
  type LeadScoreResult,
  type LeadGrade,
} from "@/service/ai/lead-score";
import type { ScoringJobRow } from "@/dao/ai/lead-scoring-store";

export const BOT_DEMO_HANDOFF_CATEGORY = "bot_demo_handoff";

export const DEMO_INTENT_RE =
  /\b(demo|product (?:demo|walkthrough|tour)|schedule (?:a )?(?:call|meeting|demo)|book (?:a )?(?:demo|call|meeting)|walk ?through|show me (?:the )?product|can we (?:meet|schedule))\b/i;

export function isBotMailboxContext(mailboxUserId: string | null | undefined): boolean {
  return !mailboxUserId?.trim();
}

export function detectDemoIntentOnInbound(input: {
  subject: string;
  latestInboundBody: string;
  timezone?: string | null;
  openDemoPhase?: string | null;
}): boolean {
  const haystack = `${input.subject}\n${input.latestInboundBody}`;
  const hasDatetime = Boolean(
    parsePreferredDateTime(
      input.latestInboundBody,
      new Date(),
      input.timezone?.trim() || DEMO_TIMEZONE,
    ),
  );
  return (
    DEMO_INTENT_RE.test(haystack) ||
    hasDatetime ||
    Boolean(input.openDemoPhase && input.openDemoPhase !== "booked")
  );
}

function scoringJobToLeadScoreResult(job: ScoringJobRow | null): LeadScoreResult {
  const score = job?.score ?? 25;
  const fitScore = job?.fitScore ?? 10;
  const intentScore = job?.intentScore ?? 15;
  const band = (job?.band as LeadScoreBand | null) ?? bandFromScore(score);
  const grade = (job?.grade as LeadGrade | null) ?? gradeFromScore(score);
  const factors = Array.isArray(job?.factors)
    ? job!.factors.filter((f): f is string => typeof f === "string")
    : [];

  return {
    score,
    fitScore,
    intentScore,
    band,
    grade,
    salesReady: score >= SALES_READY_SCORE,
    rationale:
      job?.rationale?.trim() ||
      "Demo or meeting interest detected on nurture thread.",
    scoreBreakdown: { fit: fitScore, intent: intentScore },
    pillars: {
      demographics: Math.min(25, fitScore),
      firmographics: Math.max(0, fitScore - 25),
      behavioural: intentScore,
    },
    positiveReasons: [],
    negativeReasons: [],
    behaviouralPositiveReasons: [],
    behaviouralNegativeReasons: [],
    behaviouralReasons: [],
    factors,
    nextBestAction:
      job?.nextBestAction?.trim() ||
      "Sales rep to schedule demo personally from their mailbox.",
  };
}

export type BotDemoHandoffResult = {
  status: "replied" | "escalated";
  decision: "safe_auto_reply";
  sensitivity: "safe" | "unknown";
  category: typeof BOT_DEMO_HANDOFF_CATEGORY;
  reason: string;
  replyActivityId: string | null;
  escalatedToUserId: string | null;
  lastError: string | null;
  nextRetryAt: null;
  assignedOwnerUserId: string | null;
};

export async function handOffBotMailDemoRequest(input: {
  organizationId: string;
  contactId: string;
  activityId: string;
  contactName: string;
  contactEmail: string | null;
  subject: string;
  threadId: string | null;
  timezone?: string | null;
  latestInboundBody: string;
  openDemoPhase?: string | null;
}): Promise<BotDemoHandoffResult | null> {
  if (!input.contactEmail?.includes("@")) return null;

  if (
    !detectDemoIntentOnInbound({
      subject: input.subject,
      latestInboundBody: input.latestInboundBody,
      timezone: input.timezone,
      openDemoPhase: input.openDemoPhase,
    })
  ) {
    return null;
  }

  void enqueueLeadScoring({
    contactId: input.contactId,
    organizationId: input.organizationId,
    triggerReason: "inbound_email",
    processImmediately: true,
  }).catch((err) =>
    console.error("bot demo handoff: rescore enqueue failed", err),
  );

  const scoreJob = await findScoringJobByContactId(input.contactId);
  const scoreResult = scoringJobToLeadScoreResult(scoreJob);

  const route = await routeLeadAfterScore({
    contactId: input.contactId,
    organizationId: input.organizationId,
    scoreResult,
    previousScore: scoreJob?.score ?? null,
    forceSalesIntent: true,
  });

  await skipPendingAutoReplyForContact(
    input.contactId,
    "demo_handoff_to_sales",
  ).catch((err) =>
    console.error("bot demo handoff: skip awaiting demo jobs failed", err),
  );

  triggerLeadLifecycle({
    contactId: input.contactId,
    organizationId: input.organizationId,
    triggerReason: "inbound:demo_request",
  });

  const contact = await getContact(input.contactId);
  const ownerId =
    contact?.person.ownerUserId?.trim() || route.ownerUserId?.trim() || null;

  let ownerName = "a member of our sales team";
  if (ownerId) {
    const delivery = await resolveSetupUserDeliveryEmail(
      ownerId,
      input.organizationId,
    );
    ownerName =
      delivery?.displayName?.trim() || "your dedicated sales representative";
  } else {
    const admins = await listAdminUsers(input.organizationId);
    if (admins.length > 0) {
      await notifyUsers({
        organizationId: input.organizationId,
        recipientUserIds: admins.map((a) => a.id),
        kind: "demo_scheduling_needed",
        title: `Demo requested — assign manually: ${input.contactName}`,
        body: "Lead asked to schedule a demo on the CRM bot thread. No eligible rep was available for auto-assignment.",
        href: `/contact/${input.contactId}`,
        contactId: input.contactId,
        entityType: "contact_activity",
        entityId: input.activityId,
      });
    }
  }

  const firstName = input.contactName.trim().split(/\s+/)[0] || "there";
  const subject = /^re:/i.test(input.subject.trim())
    ? input.subject.trim()
    : `Re: ${input.subject.trim()}`;
  const body = [
    `Hi ${firstName},`,
    "",
    "Thank you for your interest in a demo.",
    ownerId
      ? `${ownerName} from our team has been assigned to you and will reach out shortly to schedule a time that works.`
      : "Someone from our sales team will reach out shortly to schedule a time that works.",
    "",
    "Best regards,",
    "Worktual",
  ].join("\n");

  const inbound = await loadInboundEmailThreadHeaders(input.activityId);

  const sent = await sendCrmBotEmail({
    organizationId: input.organizationId,
    to: input.contactEmail,
    subject,
    body,
    ...crmBotEmailThreadingFromInbound(inbound),
  });

  if (!sent.ok) {
    return {
      status: "escalated",
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: BOT_DEMO_HANDOFF_CATEGORY,
      reason: sent.error || "bot_handoff_send_failed",
      replyActivityId: null,
      escalatedToUserId: ownerId,
      lastError: sent.error ?? null,
      nextRetryAt: null,
      assignedOwnerUserId: ownerId,
    };
  }

  const botEmail = await crmBotMailboxEmail(input.organizationId);
  const storedBody =
    botEmail && !emailHeadersMention(body, botEmail)
      ? `From: ${botEmail}\n\n${body}`
      : body;
  const replyActivity = await createContactActivity(input.contactId, {
    type: "email",
    subject,
    body: storedBody,
    folder: "sent",
    emailDirection: "outbound",
    createdByUserId: ownerId,
    threadId: input.threadId ?? input.activityId,
    gmailMessageId: sent.messageId ?? null,
    gmailThreadId: sent.threadId ?? inbound?.gmail_thread_id ?? null,
    rfcMessageId: sent.rfcMessageId ?? null,
  }).catch(() => null);

  if (ownerId) {
    await notifyOwnerOrAdmins({
      organizationId: input.organizationId,
      ownerUserId: ownerId,
      kind: "email_manual_response_needed",
      title: `Demo requested — schedule personally: ${input.contactName}`,
      body:
        "The lead asked to schedule a demo on a nurture (bot) thread. We acknowledged that you will contact them — please schedule from your connected mailbox and calendar.",
      href: `/inbox?thread=${input.threadId ?? input.activityId}`,
      entityType: "contact_activity",
      entityId: input.activityId,
      contactId: input.contactId,
    });
  }

  return {
    status: "replied",
    decision: "safe_auto_reply",
    sensitivity: "safe",
    category: BOT_DEMO_HANDOFF_CATEGORY,
    reason: ownerId
      ? "Demo on bot mail — assigned rep will schedule personally."
      : "Demo on bot mail — acknowledged; awaiting manual assignment.",
    replyActivityId: replyActivity?.id ?? null,
    escalatedToUserId: ownerId,
    lastError: null,
    nextRetryAt: null,
    assignedOwnerUserId: ownerId,
  };
}
