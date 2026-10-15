/**
 * Minutes of Meeting (MOM) agent — after a transcript is attached, analyze the
 * full conversation, email a customer-safe MOM to the contact, and email the
 * detailed internal MOM to sales leadership.
 * Customer MOM: assigned owner's connected inbox when owned; CRM bot if unassigned.
 * Internal MOM: CRM bot to sales managers and organization admins, plus the contact owner.
 * Idempotent via ContactActivity.momSentAt.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { notifyUsers } from "@/dao/notifications/notify-users";
import { getContact } from "@/dao/contacts/contact-service";
import {
  escalationRecipientViaLabel,
  getUserLabelsByIds,
  listMeetingEscalationRecipients,
  type EscalationRecipientVia,
} from "@/service/account/user-directory";
import { resolveSetupUserDeliveryEmail } from "@/service/account/setup-users";
import {
  parseMeetingLinkFromBody,
  parseTopicFromMeetingBody,
  parseWhenLabelFromMeetingBody,
} from "@/lib/meeting-body";
import { formatMeetingWhenLabel } from "@/service/calendar/meeting-mail";
import { sendCrmBotEmail } from "@/service/email/send-crm-bot-email";
import { sendTransactionalEmail } from "@/service/mail/send-transactional";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { isHtmlEmailBody } from "@/lib/email-body";
import { resolveOrgBrand } from "@/lib/org-brand";
import {
  buildMeetingSpeakerRoster,
  formatSpeakerLine,
  type SpeakerRoster,
} from "@/service/transcripts/speaker-resolve";
import { notifySalesEscalation } from "@/service/ai/sales-escalation-notify";

export type MeetingMomParticipant = {
  name: string;
  role: string;
  organization: string;
};

export type MeetingMomDocument = {
  executiveSummary: string;
  discussionTopics: string[];
  keyDetails: string[];
  decisions: string[];
  actionItems: string[];
  commitments: string[];
  objections: string[];
  nextSteps: string[];
  openQuestions: string[];
  risks: string[];
  sentiment: string | null;
  proposalRequested?: boolean;
  buyingIntent?: string | null;
  currentSolution?: string | null;
  painPoints?: string[];
  evaluationCriteria?: string[];
  nextBestAction?: string | null;
  followUpBy?: string | null;
};

export type MeetingMomResult = {
  ran: boolean;
  skipped?: string;
  emailed?: number;
  notifyOnly?: boolean;
  via?: "sales_manager" | "admin";
};

type CustomerMomEmail = {
  subject: string;
  body: string;
};

type InternalMomEmail = {
  subject: string;
  body: string;
};

type MeetingMomAnalysis = {
  mom: MeetingMomDocument;
  customerEmail: CustomerMomEmail | null;
  internalEmail: InternalMomEmail | null;
};

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

function customerMomBodyForSender(body: string, ownerName: string | null): string {
  const out = body.trim();
  if (isHtmlEmailBody(out)) return out;
  let text = out;
  text = text.replace(/\s*—\s*Worktual[^\n]*$/im, "").trim();
  text = text.replace(/\s*Best regards,?\s*Worktual[^\n]*$/im, "").trim();
  if (ownerName) {
    text = `${text}\n\nBest regards,\n${ownerName}`;
  }
  return text;
}

async function sendCustomerMomEmail(input: {
  organizationId: string;
  contactId: string;
  activityId: string;
  ownerUserId: string | null;
  ownerName: string | null;
  to: string;
  subject: string;
  body: string;
}): Promise<
  | { ok: true; via: "owner_mailbox" | "crm_bot" }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  const body = customerMomBodyForSender(input.body, input.ownerName);

  if (input.ownerUserId) {
    const sent = await sendTransactionalEmail({
      userId: input.ownerUserId,
      to: input.to,
      subject: input.subject,
      body,
      contactId: input.contactId,
    });
    if (sent.ok) return { ok: true, via: "owner_mailbox" };
    if (sent.needsConnect) {
      const botSent = await sendCrmBotEmail({
        organizationId: input.organizationId,
        to: input.to,
        subject: input.subject,
        body,
      });
      if (botSent.ok) {
        await notifyUsers({
          organizationId: input.organizationId,
          recipientUserIds: [input.ownerUserId],
          kind: "meeting_mom_sent_via_bot",
          title: "Meeting minutes sent from CRM bot",
          body: "Your mailbox is not connected — the customer received the summary from the org CRM bot. Connect Configuration → Email so future minutes send from your address.",
          href: "/configuration/email",
          contactId: input.contactId,
          entityType: "contact_activity",
          entityId: input.activityId,
        }).catch(() => undefined);
        return { ok: true, via: "crm_bot" };
      }
      await notifyUsers({
        organizationId: input.organizationId,
        recipientUserIds: [input.ownerUserId],
        kind: "meeting_mom_send_failed",
        title: "Meeting MOM not sent to customer",
        body: sent.error.includes("connect")
          ? `Connect your email in Configuration to send the meeting summary to your contact.`
          : `Could not email meeting minutes to your contact: ${sent.error}`,
        href: `/contact/${input.contactId}`,
        contactId: input.contactId,
        entityType: "contact_activity",
        entityId: input.activityId,
      }).catch(() => undefined);
    }
    return {
      ok: false,
      error: sent.error,
      needsConnect: sent.needsConnect,
    };
  }

  const sent = await sendCrmBotEmail({
    organizationId: input.organizationId,
    to: input.to,
    subject: input.subject,
    body,
  });
  if (sent.ok) return { ok: true, via: "crm_bot" };
  return { ok: false, error: sent.error, needsConnect: sent.needsConnect };
}

function dedupeLines(items: string[], max = 20): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const s = raw.trim();
    if (!s) continue;
    const norm = s.toLowerCase().replace(/\s+/g, " ");
    if (out.some((o) => o.toLowerCase().replace(/\s+/g, " ") === norm)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeMomTranscript(input: {
  transcript: string;
  roster: SpeakerRoster;
  contactName: string;
  repFallback: string | null;
}): string {
  return input.transcript
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      const m = trimmed.match(/^(?:(\[[^\]]+\])\s*)?([^:]{1,120}):\s*(.+)$/);
      if (!m) return trimmed;
      const prefix = m[1]?.trim() || "";
      const speaker = m[2]?.trim() || "";
      const text = m[3]?.trim() || "";
      if (!text) return trimmed;
      const resolved = formatSpeakerLine({
        roster: input.roster,
        speaker,
        speakerEmail: speaker.includes("@") ? speaker : null,
        customerFallback: input.contactName,
        repFallback: input.repFallback,
        text,
      });
      return prefix ? `${prefix} ${resolved}` : resolved;
    })
    .filter(Boolean)
    .join("\n");
}

function participantsFromRoster(input: {
  roster: SpeakerRoster;
  ownerName: string | null;
  contactName: string;
  companyName: string | null;
  sellerName: string;
}): MeetingMomParticipant[] {
  const out: MeetingMomParticipant[] = [];
  const seen = new Set<string>();

  const add = (name: string, role: string, organization: string) => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: name.trim(), role, organization });
  };

  if (input.ownerName) {
    add(input.ownerName, "Sales Representative", input.sellerName);
  }
  for (const [, entry] of input.roster) {
    if (entry.role !== "rep") continue;
    add(entry.label, "Sales Representative", input.sellerName);
  }
  add(
    input.contactName,
    "Customer",
    input.companyName?.trim() || "Client",
  );
  for (const [, entry] of input.roster) {
    if (entry.role !== "guest") continue;
    add(entry.label, "Guest", input.companyName?.trim() || "");
  }
  return out;
}

function bulletLines(items: string[], max = 20): string[] {
  return items
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max)
    .map((s) => `• ${s}`);
}

function section(title: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return ["", title, ...bulletLines(items), ""];
}

/** Offline heuristic when ai-service is unavailable. */
export function analyzeMeetingMomHeuristic(transcript: string): MeetingMomDocument {
  const text = transcript.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);

  const lower = text.toLowerCase();
  const pick = (re: RegExp, cap = 8): string[] => {
    const out: string[] = [];
    for (const s of sentences) {
      if (re.test(s) && !out.includes(s)) out.push(s);
      if (out.length >= cap) break;
    }
    return out;
  };

  const proposalRequested =
    /\b(proposal|quote|pricing document|formal offer|send (me )?(a )?quote)\b/i.test(
      lower,
    );

  const actionItems = dedupeLines(
    pick(
      /\b(will|shall|action|todo|follow[- ]?up|next step|i('ll| will)|we('ll| will)|please|need to|assign|send|schedule|book|prepare|draft)\b/i,
    ),
  );
  const decisions = pick(
    /\b(decid(ed|e)|agreed|approval|go ahead|confirmed|we'll go with|chosen|selected)\b/i,
  );
  const objections = pick(
    /\b(concern|worried|expensive|budget|not sure|hesitat|competitor|delay|issue|problem|object)\b/i,
  );
  const openQuestions = pick(/\b(\?|unclear|need to know|who|when|how much|what if)\b/i, 6);
  const commitments = pick(
    /\b(promise|commit|guarantee|by (monday|tuesday|friday|eod|eow|next week)|deliver)\b/i,
    6,
  );
  const risks = pick(
    /\b(risk|blocker|dependency|legal|security|compliance|timeline slip)\b/i,
    5,
  );

  const themes: string[] = [];
  for (const t of [
    "pricing",
    "proposal",
    "integration",
    "timeline",
    "demo",
    "contract",
    "support",
    "security",
    "onboarding",
    "roi",
  ]) {
    if (lower.includes(t)) themes.push(t);
  }

  const discussionTopics =
    themes.length > 0
      ? themes.map((t) => `Discussed ${t}`)
      : sentences.slice(0, 5).map((s) => s.slice(0, 160));

  const keyDetails = sentences
    .filter((s) => s.length > 40)
    .slice(0, 12)
    .map((s) => s.slice(0, 280));

  let sentiment: string | null = null;
  if (/\b(excited|great|love|perfect|looking forward)\b/i.test(text)) {
    sentiment = "Positive";
  } else if (/\b(frustrated|disappointed|angry|not interested|cancel)\b/i.test(text)) {
    sentiment = "Negative / at risk";
  } else if (text.length > 80) {
    sentiment = "Neutral / mixed";
  }

  const executiveSummary =
    text.length < 80
      ? "Transcript is too short for a reliable summary; key lines below are best-effort."
      : sentences.slice(0, 3).join(" ").slice(0, 700) || text.slice(0, 500);

  const painPoints = pick(
    /\b(pain|problem|issue|frustrat|slow|manual|legacy|traditional|incumbent|current provider|current tool)\b/i,
    6,
  );
  const evaluationCriteria = pick(
    /\b(advantage|compare|versus|vs\.|criteria|requirement|must have|need to|integration|cost|price)\b/i,
    6,
  );

  let currentSolution: string | null = null;
  const currentMatch = sentences.find((s) =>
    /\b(currently using|current provider|traditional|incumbent|existing (tool|system|vendor))\b/i.test(
      s,
    ),
  );
  if (currentMatch) currentSolution = currentMatch.slice(0, 280);

  let buyingIntent: string | null = null;
  const buyMatch = sentences.find((s) =>
    /\b(need to buy|looking to buy|ready to buy|evaluation|shortlist|purchase)\b/i.test(
      s,
    ),
  );
  if (buyMatch) buyingIntent = buyMatch.slice(0, 280);

  const nextBestAction = proposalRequested
    ? "Prepare and send proposal."
    : actionItems[0] || "Review transcript and confirm follow-ups in CRM.";

  const nextSteps = dedupeLines(
    proposalRequested
      ? ["Prepare and send proposal.", ...actionItems.slice(0, 4)]
      : actionItems.length > 0
        ? actionItems.slice(0, 5)
        : [nextBestAction],
  );

  let followUpBy: string | null = null;
  if (/\b(within\s+two\s+business\s+days|in\s+2\s+business\s+days)\b/i.test(text)) {
    followUpBy = "Within 2 business days";
  } else if (/\bby\s+friday\b/i.test(text)) {
    followUpBy = "By Friday";
  } else if (/\bnext\s+week\b/i.test(text)) {
    followUpBy = "Next week";
  }

  return {
    executiveSummary,
    discussionTopics: proposalRequested
      ? dedupeLines(["Customer requested a proposal", ...discussionTopics])
      : discussionTopics,
    keyDetails,
    decisions,
    actionItems,
    commitments,
    objections,
    nextSteps,
    openQuestions,
    risks,
    sentiment,
    proposalRequested,
    buyingIntent,
    currentSolution,
    painPoints,
    evaluationCriteria,
    nextBestAction,
    followUpBy,
  };
}

export async function analyzeMeetingMom(input: {
  transcript: string;
  contactName?: string | null;
  topic?: string | null;
  companyName?: string | null;
  whenLabel?: string | null;
  ownerName?: string | null;
  sellerName?: string | null;
  orgLogoUrl?: string | null;
  meetLink?: string | null;
  contactHref?: string | null;
  transcriptExcerpt?: string | null;
  activityId?: string | null;
  contactId?: string | null;
  organizationId?: string | null;
  participants?: MeetingMomParticipant[];
}): Promise<MeetingMomAnalysis> {
  const fallback = analyzeMeetingMomHeuristic(input.transcript);
  const transcriptExcerpt =
    input.transcriptExcerpt?.trim() ||
    input.transcript.slice(0, 2500) + (input.transcript.length > 2500 ? "…" : "");

  const ai = await callAiServiceAgent<{
    mom?: Partial<MeetingMomDocument>;
    customerEmail?: Partial<CustomerMomEmail> | null;
    internalEmail?: Partial<InternalMomEmail> | null;
    ok?: boolean;
  }>(
    "meeting-mom",
    {
      transcript: input.transcript.slice(0, 16000),
      contactName: input.contactName,
      topic: input.topic,
      companyName: input.companyName,
      whenLabel: input.whenLabel,
      ownerName: input.ownerName,
      sellerName: input.sellerName ?? "Worktual",
      orgLogoUrl: input.orgLogoUrl,
      meetLink: input.meetLink,
      contactHref: input.contactHref,
      transcriptExcerpt,
      heuristic: fallback,
      participants: input.participants,
      activityId: input.activityId,
      contactId: input.contactId,
      organizationId: input.organizationId,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  if (!ai?.mom) {
    return { mom: fallback, customerEmail: null, internalEmail: null };
  }

  const mergeList = (a?: string[], b?: string[]) =>
    a && a.length > 0 ? a.map(String).filter(Boolean) : (b ?? []);

  const mom: MeetingMomDocument = {
    executiveSummary:
      (ai.mom.executiveSummary && String(ai.mom.executiveSummary).trim()) ||
      fallback.executiveSummary,
    discussionTopics: mergeList(ai.mom.discussionTopics, fallback.discussionTopics),
    keyDetails: mergeList(ai.mom.keyDetails, fallback.keyDetails),
    decisions: mergeList(ai.mom.decisions, fallback.decisions),
    actionItems: mergeList(ai.mom.actionItems, fallback.actionItems),
    commitments: mergeList(ai.mom.commitments, fallback.commitments),
    objections: mergeList(ai.mom.objections, fallback.objections),
    nextSteps: mergeList(ai.mom.nextSteps, fallback.nextSteps),
    openQuestions: mergeList(ai.mom.openQuestions, fallback.openQuestions),
    risks: mergeList(ai.mom.risks, fallback.risks),
    sentiment:
      ai.mom.sentiment != null
        ? String(ai.mom.sentiment)
        : fallback.sentiment,
    proposalRequested:
      ai.mom.proposalRequested === true || fallback.proposalRequested === true,
    buyingIntent:
      (ai.mom.buyingIntent && String(ai.mom.buyingIntent).trim()) ||
      fallback.buyingIntent ||
      null,
    currentSolution:
      (ai.mom.currentSolution && String(ai.mom.currentSolution).trim()) ||
      fallback.currentSolution ||
      null,
    painPoints: mergeList(ai.mom.painPoints, fallback.painPoints),
    evaluationCriteria: mergeList(
      ai.mom.evaluationCriteria,
      fallback.evaluationCriteria,
    ),
    nextBestAction:
      (ai.mom.nextBestAction && String(ai.mom.nextBestAction).trim()) ||
      fallback.nextBestAction ||
      null,
    followUpBy:
      (ai.mom.followUpBy && String(ai.mom.followUpBy).trim()) ||
      fallback.followUpBy ||
      null,
  };
  const customerSubject = ai.customerEmail?.subject?.trim() || "";
  const customerBody = ai.customerEmail?.body?.trim() || "";
  const internalSubject = ai.internalEmail?.subject?.trim() || "";
  const internalBody = ai.internalEmail?.body?.trim() || "";
  return {
    mom,
    customerEmail:
      customerSubject && customerBody
        ? {
            subject: customerSubject.slice(0, 180),
            body: customerBody.slice(0, 80_000),
          }
        : null,
    internalEmail:
      internalSubject && internalBody
        ? {
            subject: internalSubject.slice(0, 180),
            body: internalBody.slice(0, 80_000),
          }
        : null,
  };
}

function buildMomEmail(args: {
  topic: string;
  whenLabel: string;
  contactName: string;
  companyName: string | null;
  ownerName: string | null;
  meetLink: string | null;
  contactHref: string;
  recipientVia: EscalationRecipientVia;
  mom: MeetingMomDocument;
  transcriptExcerpt: string;
}): { subject: string; body: string } {
  const subject = `Minutes of Meeting: ${args.topic} — ${args.contactName}`;
  const viaLabel = escalationRecipientViaLabel(args.recipientVia);

  const body = [
    "Hi,",
    "",
    `Minutes of Meeting from a completed CRM sales meeting (sent to ${viaLabel}).`,
    "",
    "— Meeting —",
    `Topic: ${args.topic}`,
    `When: ${args.whenLabel}`,
    `Contact: ${args.contactName}`,
    args.companyName ? `Company: ${args.companyName}` : null,
    args.ownerName ? `Sales owner: ${args.ownerName}` : null,
    args.meetLink ? `Join link: ${args.meetLink}` : null,
    args.mom.sentiment ? `Overall tone: ${args.mom.sentiment}` : null,
    "",
    "— Executive summary —",
    args.mom.executiveSummary,
    ...section("— Discussion topics —", args.mom.discussionTopics),
    ...section("— Key details from the conversation —", args.mom.keyDetails),
    ...section("— Decisions —", args.mom.decisions),
    ...section("— Action items —", args.mom.actionItems),
    ...section("— Commitments —", args.mom.commitments),
    ...section("— Objections / concerns —", args.mom.objections),
    ...section("— Next steps —", args.mom.nextSteps),
    ...section("— Open questions —", args.mom.openQuestions),
    ...section("— Risks / blockers —", args.mom.risks),
    "",
    "— Transcript excerpt —",
    args.transcriptExcerpt,
    "",
    `Open contact: ${args.contactHref}`,
    "",
    "— Worktual Minutes of Meeting Agent",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { subject, body };
}

/**
 * Analyze transcript and email MOM. Safe to fire-and-forget after attach.
 * Skips if momSentAt is already set (idempotent).
 */
export async function runMeetingMom(input: {
  activityId: string;
  contactId?: string | null;
}): Promise<MeetingMomResult> {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      contactId: true,
      organizationId: true,
      subject: true,
      body: true,
      dueAt: true,
      type: true,
      transcriptText: true,
      momSentAt: true,
      createdByUserId: true,
    },
  });

  if (!activity) return { ran: false, skipped: "not_found" };
  if (activity.type !== "meeting") return { ran: false, skipped: "not_meeting" };
  if (activity.momSentAt) return { ran: false, skipped: "already_sent" };
  const organizationId = String(activity.organizationId);

  const transcript = activity.transcriptText?.trim() || "";
  if (transcript.length < 40) {
    return { ran: false, skipped: "transcript_too_short" };
  }

  const contact = await getContact(activity.contactId);
  const contactName =
    contact?.displayName?.trim() ||
    [contact?.person.firstName, contact?.person.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    contact?.person.email ||
    "Contact";
  const companyName = contact?.person.company?.name?.trim() || null;

  const ownerUserIdRaw =
    contact?.person.ownerUserId ||
    contact?.crm.ownerUserId ||
    activity.createdByUserId ||
    null;
  const ownerUserId = ownerUserIdRaw ? String(ownerUserIdRaw) : null;
  const ownerDelivery = ownerUserId
    ? await resolveSetupUserDeliveryEmail(ownerUserId, organizationId)
    : null;
  const labels = ownerUserId
    ? await getUserLabelsByIds([ownerUserId])
    : new Map<string, string>();
  const ownerName =
    ownerDelivery?.displayName ||
    (ownerUserId ? labels.get(ownerUserId) ?? null : null);

  const topic =
    parseTopicFromMeetingBody(activity.body) ||
    activity.subject.replace(/^Meeting:\s*/i, "").trim() ||
    activity.subject;
  const whenLabel =
    parseWhenLabelFromMeetingBody(activity.body) ||
    (activity.dueAt
      ? formatMeetingWhenLabel(
          activity.dueAt,
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        )
      : "Unknown time");
  const meetLink = parseMeetingLinkFromBody(activity.body);
  const contactHref = `${appBaseUrl()}/contact/${activity.contactId}`;

  const orgBrand = await resolveOrgBrand(organizationId);

  const roster = await buildMeetingSpeakerRoster({
    organizationId,
    contactId: activity.contactId,
    activityBody: activity.body,
    activityId: activity.id,
    hostUserId: activity.createdByUserId
      ? String(activity.createdByUserId)
      : null,
    ownerUserId: ownerUserId,
  });
  let repFallback: string | null = ownerName;
  for (const [, entry] of roster) {
    if (entry.role === "rep") {
      repFallback = entry.label;
      break;
    }
  }
  const resolvedTranscript = normalizeMomTranscript({
    transcript,
    roster,
    contactName,
    repFallback,
  });
  const participants = participantsFromRoster({
    roster,
    ownerName,
    contactName,
    companyName,
    sellerName: orgBrand.sellerName,
  });

  const customerAddress = contact?.person.email?.trim().toLowerCase() || null;
  if (!customerAddress) {
    await writeAuditLog({
      actorUserId: ownerUserId,
      action: "update",
      entityType: "contact_activity",
      entityId: activity.id,
      organizationId,
      meta: {
        agent: "meeting_mom",
        outcome: "failed",
        reason: "customer_email_missing",
        contactId: activity.contactId,
      },
    });
    return { ran: false, skipped: "customer_email_missing" };
  }

  const claimed = await prisma.contactActivity.updateMany({
    where: { id: activity.id, momSentAt: null },
    data: { momSentAt: new Date() },
  });
  if (claimed.count === 0) {
    return { ran: false, skipped: "already_sent" };
  }

  const releaseMomClaim = async () => {
    await prisma.contactActivity.updateMany({
      where: { id: activity.id },
      data: { momSentAt: null },
    });
  };

  let analysis: MeetingMomAnalysis;
  try {
    analysis = await analyzeMeetingMom({
      transcript: resolvedTranscript,
      contactName,
      topic,
      companyName,
      whenLabel,
      ownerName,
      sellerName: orgBrand.sellerName,
      orgLogoUrl: orgBrand.logoUrl,
      meetLink,
      contactHref,
      transcriptExcerpt:
        resolvedTranscript.slice(0, 2500) +
        (resolvedTranscript.length > 2500 ? "…" : ""),
      activityId: activity.id,
      contactId: activity.contactId,
      organizationId,
      participants,
    });
  } catch (err) {
    await releaseMomClaim();
    throw err;
  }
  const { mom, customerEmail, internalEmail } = analysis;

  if (!customerEmail) {
    await releaseMomClaim();
    await writeAuditLog({
      actorUserId: ownerUserId,
      action: "update",
      entityType: "contact_activity",
      entityId: activity.id,
      organizationId,
      meta: {
        agent: "meeting_mom",
        outcome: "failed",
        reason: "customer_mom_agent_unavailable",
        contactId: activity.contactId,
      },
    });
    return { ran: false, skipped: "customer_mom_agent_unavailable" };
  }

  // Customer is the required delivery leg. Send it first so a retry cannot
  // duplicate internal leadership emails after a customer-send failure.
  const customerSend = await sendCustomerMomEmail({
    organizationId,
    contactId: activity.contactId,
    activityId: activity.id,
    ownerUserId,
    ownerName,
    to: customerAddress,
    subject: customerEmail.subject,
    body: customerEmail.body,
  });
  if (!customerSend.ok) {
    await releaseMomClaim();
    await writeAuditLog({
      actorUserId: ownerUserId,
      action: "update",
      entityType: "contact_activity",
      entityId: activity.id,
      organizationId,
      meta: {
        agent: "meeting_mom",
        outcome: "failed",
        reason: customerSend.error,
        leg: "customer",
        needsConnect: Boolean(customerSend.needsConnect),
        contactId: activity.contactId,
      },
    });
    void notifySalesEscalation({
      organizationId,
      kind: "meeting_mom_send_failed",
      title: `Customer MOM not sent: ${contactName}`,
      body: customerSend.needsConnect
        ? `The sales rep's mailbox is not connected — the customer did not receive meeting minutes.`
        : `Customer meeting minutes failed to send: ${customerSend.error}`,
      href: `/contact/${activity.contactId}`,
      contactId: activity.contactId,
      entityType: "contact_activity",
      entityId: activity.id,
      ownerUserId,
      contactName,
      companyName,
      actorUserId: ownerUserId,
      nextStep: "Ensure the rep connects email in Configuration and follows up with the customer.",
    }).catch(() => undefined);
    return { ran: false, skipped: customerSend.error };
  }

  const priorInsights =
    (
      await prisma.contactActivity.findUnique({
        where: { id: activity.id },
        select: { transcriptInsights: true },
      })
    )?.transcriptInsights;
  const insightBase =
    priorInsights && typeof priorInsights === "object" && !Array.isArray(priorInsights)
      ? (priorInsights as Record<string, unknown>)
      : {};

  await prisma.contactActivity.update({
    where: { id: activity.id },
    data: {
      transcriptInsights: {
        ...insightBase,
        momProposalRequested: mom.proposalRequested === true,
        momNextBestAction: mom.nextBestAction ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  const { recipients, via } = await listMeetingEscalationRecipients(
    organizationId,
  ).catch(() => ({
    recipients: [],
    via: "admin" as EscalationRecipientVia,
  }));

  const mail =
    internalEmail ??
    buildMomEmail({
      topic,
      whenLabel,
      contactName,
      companyName,
      ownerName,
      meetLink,
      contactHref,
      recipientVia: via,
      mom,
      transcriptExcerpt:
        resolvedTranscript.slice(0, 2500) +
        (resolvedTranscript.length > 2500 ? "…" : ""),
    });

  const detail = [
    `MOM: ${topic}`,
    whenLabel,
    ownerName ? `Owner: ${ownerName}` : null,
    mom.sentiment,
    `${mom.actionItems.length} action item(s)`,
  ]
    .filter(Boolean)
    .join(" · ");

  if (recipients.length > 0) {
    await notifyUsers({
      organizationId,
      recipientUserIds: recipients.map((r) => r.id),
      kind: "meeting_mom",
      title: `Minutes of Meeting: ${contactName}`,
      body: detail,
      href: `/contact/${activity.contactId}`,
      entityType: "contact_activity",
      entityId: activity.id,
      contactId: activity.contactId,
      actorUserId: ownerUserId,
      metadata: {
        agent: "meeting_mom",
        activityId: activity.id,
        via,
      },
    }).catch(() => undefined);
  }

  // Internal MOM email: sales managers and admins, plus the contact owner.
  const internalRecipientIds = [
    ...new Set([
      ...recipients.map((r) => r.id),
      ...(ownerUserId ? [ownerUserId] : []),
    ]),
  ];

  const emails = [
    ...new Set(
      (
        await Promise.all(
          internalRecipientIds.map(async (userId) => {
            const delivery = await resolveSetupUserDeliveryEmail(
              userId,
              organizationId,
            );
            return delivery?.email?.trim().toLowerCase() || null;
          }),
        )
      ).filter((e): e is string => Boolean(e)),
    ),
  ];

  let emailed = 1;
  const errors: string[] = [];
  for (const to of emails) {
    const send = await sendCrmBotEmail({
      organizationId,
      to,
      subject: mail.subject,
      body: mail.body,
    }).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : "Internal MOM send failed.",
    }));
    if (send.ok) emailed += 1;
    else errors.push(`${to}: ${send.error}`);
  }

  if (mom.proposalRequested) {
    void notifySalesEscalation({
      organizationId,
      kind: "proposal_follow_up_required",
      title: `Proposal requested: ${contactName}`,
      body: `The customer asked for a proposal during "${topic}". Next best action: ${mom.nextBestAction || "Prepare and send proposal."}`,
      href: `/contact/${activity.contactId}`,
      contactId: activity.contactId,
      entityType: "contact_activity",
      entityId: activity.id,
      ownerUserId,
      contactName,
      companyName,
      actorUserId: ownerUserId,
      nextStep:
        mom.nextBestAction ||
        "Rep should prepare and send the proposal within 2 business days.",
      includeOwner: true,
      metadata: {
        activityId: activity.id,
        proposalRequested: true,
      },
    }).catch(() => undefined);
  }

  await writeAuditLog({
    actorUserId: ownerUserId,
    action: "update",
    entityType: "contact_activity",
    entityId: activity.id,
    organizationId,
    meta: {
      agent: "meeting_mom",
      outcome: "sent",
      via,
      customerVia: customerSend.via,
      contactId: activity.contactId,
      ownerUserId,
      emailsSent: emailed,
      customerEmail: customerAddress,
      customerEmailSent: true,
      internalRecipientCount: emails.length,
      actionItems: mom.actionItems.length,
      decisions: mom.decisions.length,
      errors: errors.length ? errors.slice(0, 5) : undefined,
    },
  });

  return {
    ran: true,
    emailed,
    notifyOnly: false,
    via,
  };
}

export function triggerMeetingMom(input: {
  activityId: string;
  contactId?: string | null;
}): void {
  void runMeetingMom(input).catch((err) => {
    console.error("meeting MOM failed", input.activityId, err);
    void writeAuditLog({
      action: "update",
      entityType: "contact_activity",
      entityId: input.activityId,
      meta: {
        agent: "meeting_mom",
        outcome: "failed",
        reason: err instanceof Error ? err.message : "unknown",
        contactId: input.contactId ?? null,
      },
    });
  });
}
