/**
 * Meeting Brief Agent — HTML pre-call briefing to the contact owner
 * (booking, T−24h, T−1h). Customer participant reminders use rich HTML via ai-service.
 */


import { prisma } from "@/dao/db/prisma";
import { getContact } from "@/dao/contacts/contact-service";
import { listDealsForContact } from "@/dao/sales/deal-service";
import { getCompanySnapshot } from "@/dao/companies/sync-from-contacts";
import { getLeadScoreStatus } from "@/service/ai/lead-scoring-job";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { sendCrmBotEmail } from "@/service/email/send-crm-bot-email";
import {
  parseMeetingLinkFromBody,
  parseProviderFromMeetingBody,
  parseTopicFromMeetingBody,
  parseWhenLabelFromMeetingBody,
} from "@/lib/meeting-body";
import { meetingProviderLabel } from "@/lib/meeting-provider";
import { notifyOwnerOrAdmins } from "@/dao/notifications/notify-users";
import { resolveSetupUserDeliveryEmail } from "@/service/account/setup-users";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { DEAL_STAGE_LABELS } from "@/service/sales/stages";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { isHtmlEmailBody } from "@/lib/email-body";
import { resolveOrgBrand } from "@/lib/org-brand";

export type MeetingBriefContext = {
  organizationId: string;
  activityId: string;
  contactId: string;
  contactName: string;
  contactTitle: string | null;
  contactEmail: string | null;
  companyName: string | null;
  industry: string | null;
  domain: string | null;
  contactType: string;
  leadStatus: string;
  leadSource: string | null;
  alignment: string;
  pipelineStage: string | null;
  pipelineDealTitle: string | null;
  pipelineAmount: string | null;
  authority: string;
  bantAuthority: boolean;
  interest: string;
  leadScore: number | null;
  leadGrade: string | null;
  bantNeed: boolean;
  bantBudget: boolean;
  bantTimeline: boolean;
  employeeCount: number | null;
  daysSinceInquiry: number | null;
  firstTouchAt: string | null;
  topic: string | null;
  whenLabel: string | null;
  meetingLink: string | null;
  provider: string;
  dueAt: string | null;
  ownerUserId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  senderUserId: string | null;
  contactHref: string;
  sellerName: string;
  orgLogoUrl: string;
  recentActivities: Array<{
    type: string;
    direction: string | null;
    subject: string;
    detail: string | null;
    occurredAt: string;
  }>;
};

function authorityLabel(title: string | null, bantAuthority: boolean): string {
  const parts: string[] = [];
  if (title?.trim()) parts.push(title.trim());
  if (bantAuthority) parts.push("Marked as decision-maker (BANT Authority)");
  if (parts.length === 0) return "Unknown — confirm authority in discovery";
  return parts.join(" · ");
}

function alignmentLabel(lifecycle: string, leadStatus: string): string {
  return `${lifecycle} / ${leadStatus}`;
}

function interestFromContext(input: {
  leadSource: string | null;
  notes: string | null;
  topic: string | null;
  scoreBand: string | null;
  intentHints: string[];
}): string {
  const bits: string[] = [];
  if (input.topic) bits.push(`Meeting topic: ${input.topic}`);
  if (input.leadSource) bits.push(`Source: ${input.leadSource}`);
  if (input.scoreBand) bits.push(`Score band: ${input.scoreBand}`);
  if (input.intentHints.length) bits.push(input.intentHints.slice(0, 3).join("; "));
  if (input.notes?.trim()) bits.push(`Notes: ${input.notes.trim().slice(0, 180)}`);
  return bits.join(" · ") || "Interest not yet captured — use discovery questions.";
}

export async function buildMeetingBriefContext(
  activityId: string,
  organizationId?: string | null,
): Promise<MeetingBriefContext | null> {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      contactId: true,
      type: true,
      subject: true,
      body: true,
      dueAt: true,
      createdByUserId: true,
    },
  });
  if (!activity || activity.type !== "meeting") return null;

  const contact = await getContact(activity.contactId);
  if (!contact) return null;

  const orgId = await resolveRequestOrganizationId(
    organizationId || contact.person.organizationId,
  );
  const { person, crm, displayName } = contact;

  const [
    deals,
    companySnapshot,
    score,
    recentActivities,
    profileMeta,
    firstActivity,
    orgBrand,
  ] = await Promise.all([
    listDealsForContact(activity.contactId).catch(() => []),
    person.companyId
      ? getCompanySnapshot(person.companyId).catch(() => null)
      : Promise.resolve(null),
    getLeadScoreStatus(activity.contactId).catch(() => null),
    prisma.contactActivity.findMany({
      where: {
        organizationId: BigInt(orgId),
        contactId: activity.contactId,
        id: { not: activity.id },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        type: true,
        emailDirection: true,
        subject: true,
        body: true,
        completedAt: true,
        dueAt: true,
        createdAt: true,
      },
    }).catch(() => []),
    prisma.contactProfile.findUnique({
      where: { accountContactId: activity.contactId },
      select: { createdAt: true },
    }).catch(() => null),
    prisma.contactActivity.findFirst({
      where: {
        organizationId: BigInt(orgId),
        contactId: activity.contactId,
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }).catch(() => null),
    resolveOrgBrand(orgId),
  ]);

  const primaryDeal = deals[0] ?? null;
  const topic =
    parseTopicFromMeetingBody(activity.body) ||
    activity.subject.replace(/^Meeting:\s*/i, "").trim() ||
    null;
  const meetingLink = parseMeetingLinkFromBody(activity.body);
  const provider = parseProviderFromMeetingBody(activity.body);
  const whenLabel =
    parseWhenLabelFromMeetingBody(activity.body) ||
    (activity.dueAt
      ? activity.dueAt.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null);

  const ownerUserIdRaw = person.ownerUserId || crm.ownerUserId || null;
  const ownerUserId = ownerUserIdRaw ? String(ownerUserIdRaw) : null;
  const senderUserId = activity.createdByUserId
    ? String(activity.createdByUserId)
    : ownerUserId;
  let ownerEmail: string | null = null;
  let ownerName: string | null = null;
  if (ownerUserId) {
    const ownerDelivery = await resolveSetupUserDeliveryEmail(
      ownerUserId,
      orgId,
    );
    ownerEmail = ownerDelivery?.email ?? null;
    ownerName = ownerDelivery?.displayName ?? null;
  }

  const stageLabel = primaryDeal
    ? DEAL_STAGE_LABELS[primaryDeal.stage as keyof typeof DEAL_STAGE_LABELS] ||
      primaryDeal.stage
    : null;

  const firstTouch =
    firstActivity?.createdAt ?? profileMeta?.createdAt ?? null;
  const daysSinceInquiry =
    firstTouch != null
      ? Math.max(
          0,
          Math.floor((Date.now() - firstTouch.getTime()) / 86_400_000),
        )
      : null;

  return {
    organizationId: orgId,
    activityId: activity.id,
    contactId: activity.contactId,
    contactName: displayName,
    contactTitle: person.title,
    contactEmail: person.email || null,
    companyName: companySnapshot?.name ?? person.company?.name ?? null,
    industry: companySnapshot?.industry ?? person.company?.industry ?? null,
    domain: companySnapshot?.domain ?? person.company?.domain ?? null,
    contactType: person.contactType,
    leadStatus: person.leadStatus,
    leadSource: crm.leadSource,
    alignment: alignmentLabel(person.contactType, person.leadStatus),
    pipelineStage: stageLabel,
    pipelineDealTitle: primaryDeal?.title ?? null,
    pipelineAmount: primaryDeal?.amount?.toString() ?? null,
    authority: authorityLabel(person.title, Boolean(person.bantAuthority)),
    bantAuthority: Boolean(person.bantAuthority),
    interest: interestFromContext({
      leadSource: crm.leadSource,
      notes: crm.notes,
      topic,
      scoreBand: score?.band ?? null,
      intentHints: [
        person.bantNeed ? "Need confirmed" : "",
        person.bantBudget ? "Budget signal" : "",
        person.bantTimeline ? "Timeline signal" : "",
      ].filter(Boolean),
    }),
    leadScore: score?.score ?? null,
    leadGrade: score?.grade ?? null,
    bantNeed: Boolean(person.bantNeed),
    bantBudget: Boolean(person.bantBudget),
    bantTimeline: Boolean(person.bantTimeline),
    employeeCount: companySnapshot?.employeeCount ?? null,
    daysSinceInquiry,
    firstTouchAt: firstTouch?.toISOString() ?? null,
    topic,
    whenLabel,
    meetingLink,
    provider: meetingProviderLabel(provider),
    dueAt: activity.dueAt?.toISOString() ?? null,
    ownerUserId,
    ownerEmail,
    ownerName,
    senderUserId,
    contactHref: `/contact/${activity.contactId}`,
    sellerName: orgBrand.sellerName,
    orgLogoUrl: orgBrand.logoUrl,
    recentActivities: recentActivities.map((row) => ({
      type: row.type,
      direction: row.emailDirection ?? null,
      subject: row.subject,
      detail: row.body?.replace(/\s+/g, " ").trim().slice(0, 400) || null,
      occurredAt: (
        row.completedAt ??
        row.dueAt ??
        row.createdAt
      ).toISOString(),
    })),
  };
}

export type MeetingReminderWindow = "24h" | "1h";

function heuristicBriefEmail(
  ctx: MeetingBriefContext,
  options?: {
    window?: MeetingReminderWindow;
    leadSummary?: string | null;
  },
): {
  subject: string;
  body: string;
} {
  const window = options?.window;
  const timing =
    window === "24h"
      ? "in about 24 hours"
      : window === "1h"
        ? "in about 1 hour"
        : null;
  const subject = timing
    ? `Meeting reminder (${timing}): ${ctx.contactName}${
        ctx.companyName ? ` @ ${ctx.companyName}` : ""
      }`
    : `Meeting brief: ${ctx.contactName}${
        ctx.companyName ? ` @ ${ctx.companyName}` : ""
      } — ${ctx.whenLabel || "upcoming"}`;

  const intro = timing
    ? `Reminder: your meeting with this lead starts ${timing}. Here's a 360 brief:`
    : "A meeting was booked with your lead. Here's a quick brief before the call:";

  const lines = [
    `Hi ${ctx.ownerName || "there"},`,
    "",
    intro,
    "",
    `Contact: ${ctx.contactName}`,
    ctx.contactTitle ? `Title: ${ctx.contactTitle}` : null,
    ctx.contactEmail ? `Email: ${ctx.contactEmail}` : null,
    ctx.companyName ? `Company: ${ctx.companyName}` : null,
    ctx.industry ? `Industry: ${ctx.industry}` : null,
    ctx.domain ? `Domain: ${ctx.domain}` : null,
    "",
    `Alignment: ${ctx.alignment}`,
    ctx.pipelineStage
      ? `Pipeline: ${ctx.pipelineDealTitle || "Deal"} — ${ctx.pipelineStage}${
          ctx.pipelineAmount ? ` (${ctx.pipelineAmount})` : ""
        }`
      : "Pipeline: No open deal yet",
    `Authority: ${ctx.authority}`,
    `Interest: ${ctx.interest}`,
    ctx.leadScore != null
      ? `Lead score: ${ctx.leadScore}${ctx.leadGrade ? ` (${ctx.leadGrade})` : ""}`
      : null,
    options?.leadSummary
      ? ["", "AI summary:", options.leadSummary.slice(0, 1200)]
      : null,
    ctx.recentActivities.length
      ? [
          "",
          "Recent CRM activity:",
          ...ctx.recentActivities.slice(0, 8).map(
            (item) =>
              `• ${new Date(item.occurredAt).toLocaleString()} · ${item.type}${
                item.direction ? ` (${item.direction})` : ""
              } · ${item.subject}${
                item.detail ? ` — ${item.detail.slice(0, 180)}` : ""
              }`,
          ),
        ]
      : ["", "Recent CRM activity: None recorded"],
    "",
    `Meeting: ${ctx.topic || "Meeting"}`,
    ctx.whenLabel ? `When: ${ctx.whenLabel}` : null,
    `Provider: ${ctx.provider}`,
    ctx.meetingLink ? `Join: ${ctx.meetingLink}` : null,
    "",
    `Open contact: ${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000"}${ctx.contactHref}`,
    "",
    timing
      ? "— Worktual Meeting Reminder Agent"
      : "— Worktual Meeting Brief Agent",
  ]
    .flat()
    .filter((l) => l !== null) as string[];

  return { subject, body: lines.join("\n") };
}

export async function sendMeetingBriefToOwner(input: {
  activityId: string;
  contactId: string;
  organizationId?: string | null;
  senderUserId?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const ctx = await buildMeetingBriefContext(
    input.activityId,
    input.organizationId,
  );
  if (!ctx) return { ok: false, reason: "context_not_found" };

  const recipientUserId = ctx.ownerUserId;
  if (!recipientUserId) {
    return { ok: false, reason: "owner_email_missing" };
  }

  const ownerDelivery = await resolveSetupUserDeliveryEmail(
    recipientUserId,
    ctx.organizationId,
  );
  const recipientEmail = ownerDelivery?.email ?? ctx.ownerEmail;
  if (!recipientEmail) {
    return { ok: false, reason: "owner_email_missing" };
  }

  const actorUserId =
    input.senderUserId || ctx.senderUserId || ctx.ownerUserId;

  const agent = await callAiServiceAgent<{
    ok?: boolean;
    subject?: string | null;
    body?: string | null;
    reason?: string | null;
  }>(
    "meeting-brief-email",
    {
      activityId: input.activityId,
      contactId: input.contactId,
      organizationId: ctx.organizationId,
      audience: "owner",
      context: ctx,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  const subject = agent?.subject?.trim();
  const body = agent?.body?.trim();
  if (!agent?.ok || !subject || !body) {
    // Keep prior state — do not invent brief copy in TypeScript.
    return {
      ok: false,
      reason: agent?.reason || "agent_unavailable",
    };
  }

  const send = await sendCrmBotEmail({
    organizationId: ctx.organizationId,
    to: recipientEmail,
    subject,
    body,
  });

  if (!send.ok) {
    // Still notify in-app so the owner sees something
    await notifyOwnerOrAdmins({
      ownerUserId: recipientUserId,
      organizationId: ctx.organizationId,
      kind: "meeting_brief",
      title: subject,
      body: `Meeting with ${ctx.contactName}${
        ctx.whenLabel ? ` — ${ctx.whenLabel}` : ""
      }. Email send failed: ${send.error}`,
      href: ctx.contactHref,
    }).catch(() => undefined);
    await writeAuditLog({
      actorUserId,
      action: "update",
      entityType: "contact_activity",
      entityId: input.activityId,
      organizationId: ctx.organizationId,
      meta: {
        agent: "meeting_brief",
        outcome: "failed",
        contactId: input.contactId,
        reason: send.error,
      },
    });
    return { ok: false, reason: send.error };
  }

  await notifyOwnerOrAdmins({
    ownerUserId: recipientUserId,
    organizationId: ctx.organizationId,
    kind: "meeting_brief",
    title: `Meeting brief sent: ${ctx.contactName}`,
    body: `${ctx.whenLabel || "Upcoming meeting"}${
      ctx.meetingLink ? ` · ${ctx.provider}` : ""
    }`,
    href: ctx.contactHref,
  }).catch(() => undefined);

  await writeAuditLog({
    actorUserId,
    action: "update",
    entityType: "contact_activity",
    entityId: input.activityId,
    organizationId: ctx.organizationId,
    meta: {
      agent: "meeting_brief",
      outcome: "sent",
      contactId: input.contactId,
    },
  });

  return { ok: true };
}

/**
 * Pre-meeting reminder to the sales owner with AI 360 participant context.
 * Used by the T−24h / T−1h reminder cron (separate from booking-time brief).
 */
export async function sendMeetingReminderBriefToOwner(input: {
  activityId: string;
  contactId: string;
  window: MeetingReminderWindow;
  organizationId?: string | null;
  senderUserId?: string | null;
}): Promise<{ ok: boolean; reason?: string; permanent?: boolean }> {
  const ctx = await buildMeetingBriefContext(
    input.activityId,
    input.organizationId,
  );
  if (!ctx) return { ok: false, reason: "context_not_found", permanent: true };

  const senderUserId =
    input.senderUserId || ctx.senderUserId || ctx.ownerUserId;
  if (!senderUserId) {
    return { ok: false, reason: "sender_missing", permanent: true };
  }

  let recipientEmail: string | null = null;
  let recipientUserId: string | null = null;

  if (ctx.ownerUserId) {
    const ownerDelivery = await resolveSetupUserDeliveryEmail(
      ctx.ownerUserId,
      ctx.organizationId,
    );
    recipientEmail = ownerDelivery?.email ?? ctx.ownerEmail;
    recipientUserId = ctx.ownerUserId;
    if (ownerDelivery?.displayName) {
      ctx.ownerName = ownerDelivery.displayName;
    }
    if (
      recipientEmail &&
      ctx.contactEmail &&
      recipientEmail.toLowerCase() === ctx.contactEmail.toLowerCase()
    ) {
      return {
        ok: false,
        reason: "recipient_is_contact_email",
        permanent: true,
      };
    }
    if (!recipientEmail) {
      return {
        ok: false,
        reason: "assigned_owner_email_missing",
        permanent: true,
      };
    }
  } else {
    const creatorDelivery = await resolveSetupUserDeliveryEmail(
      senderUserId,
      ctx.organizationId,
    );
    recipientEmail = creatorDelivery?.email ?? null;
    recipientUserId = senderUserId;
    if (creatorDelivery?.displayName) {
      ctx.ownerName = creatorDelivery.displayName;
    }
    if (!recipientEmail || !recipientUserId) {
      return { ok: false, reason: "owner_email_missing", permanent: true };
    }
  }

  let leadSummary: string | null = null;
  try {
    const { getOrRefreshLeadSummary } = await import(
      "@/service/ai/lead-summary-agent"
    );
    const summary = await getOrRefreshLeadSummary(input.contactId, {
      organizationId: ctx.organizationId,
    });
    leadSummary = summary?.summary?.trim() || null;
  } catch {
    leadSummary = null;
  }

  const agent = await callAiServiceAgent<{
    ok?: boolean;
    subject?: string | null;
    body?: string | null;
    reason?: string | null;
  }>(
    "meeting-brief-email",
    {
      activityId: input.activityId,
      contactId: input.contactId,
      organizationId: ctx.organizationId,
      reminderWindow: input.window,
      leadSummary,
      audience: "owner",
      context: ctx,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  const subject = agent?.subject?.trim();
  let body = agent?.body?.trim() || "";
  if (!agent?.ok || !subject || !body) {
    return {
      ok: false,
      reason: agent?.reason || "agent_unavailable",
      permanent: false,
    };
  }
  if (
    leadSummary &&
    !isHtmlEmailBody(body) &&
    !body.includes(leadSummary.slice(0, 80))
  ) {
    body = `${body}\n\nAI summary:\n${leadSummary.slice(0, 1200)}`;
  }

  const send = await sendCrmBotEmail({
    organizationId: ctx.organizationId,
    to: recipientEmail,
    subject,
    body,
  });

  const timingLabel =
    input.window === "24h" ? "in ~24 hours" : "in ~1 hour";

  if (!send.ok) {
    await notifyOwnerOrAdmins({
      ownerUserId: recipientUserId,
      organizationId: ctx.organizationId,
      kind: "meeting_brief",
      title: subject,
      body: `Meeting with ${ctx.contactName} ${timingLabel}. Email send failed: ${send.error}`,
      href: ctx.contactHref,
    }).catch(() => undefined);
    return {
      ok: false,
      reason: send.error,
      permanent: Boolean(send.needsConnect),
    };
  }

  await notifyOwnerOrAdmins({
    ownerUserId: recipientUserId,
    organizationId: ctx.organizationId,
    kind: "meeting_brief",
    title: `Meeting reminder (${timingLabel}): ${ctx.contactName}`,
    body: `${ctx.whenLabel || "Upcoming meeting"}${
      ctx.meetingLink ? ` · ${ctx.provider}` : ""
    }`,
    href: ctx.contactHref,
  }).catch(() => undefined);

  return { ok: true };
}

/**
 * Personalized don’t-miss reminder for a CRM participant (customer/lead).
 * Requires LLM success — no blank template success path.
 */
export async function composeMeetingParticipantReminder(input: {
  activityId: string;
  contactId: string;
  window: MeetingReminderWindow;
  organizationId?: string | null;
  participantFirstName: string;
  organizerName: string;
}): Promise<{ ok: boolean; subject?: string; body?: string; reason?: string }> {
  const ctx = await buildMeetingBriefContext(
    input.activityId,
    input.organizationId,
  );
  if (!ctx) return { ok: false, reason: "context_not_found" };

  const agent = await callAiServiceAgent<{
    ok?: boolean;
    subject?: string | null;
    body?: string | null;
  }>(
    "meeting-brief-email",
    {
      activityId: input.activityId,
      contactId: input.contactId,
      organizationId: ctx.organizationId,
      reminderWindow: input.window,
      audience: "participant",
      context: ctx,
      participantFirstName: input.participantFirstName,
      organizerName: input.organizerName,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  const subject = agent?.subject?.trim();
  const body = agent?.body?.trim();
  if (!agent?.ok || !subject || !body) {
    return {
      ok: false,
      reason: agent?.ok === false ? "agent_failed" : "llm_empty_email",
    };
  }
  return { ok: true, subject, body };
}
