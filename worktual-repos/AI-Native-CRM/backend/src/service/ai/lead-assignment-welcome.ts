/**
 * After score-gated assignment (≥40): compose a welcome email via the
 * welcome-lead agent and send it from the assigned owner's connected inbox.
 *
 * Low-score leads stay on the nurture path (CRM bot mailbox) — see lead-nurture-job.ts.
 */

import { resolveSetupUserDeliveryEmail } from "@/service/account/setup-users";
import { getContact } from "@/dao/contacts/contact-service";
import { getCompanySnapshot } from "@/dao/companies/sync-from-contacts";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import type { LeadScoreResult } from "@/service/ai/lead-score";
import { sendTransactionalEmail } from "@/service/mail/send-transactional";
import { notifyUsers } from "@/dao/notifications/notify-users";

export type WelcomeLeadContext = {
  contactId: string;
  contactName: string;
  contactFirstName: string;
  contactEmail: string;
  contactTitle: string | null;
  companyName: string | null;
  industry: string | null;
  leadSource: string | null;
  leadScore: number;
  leadBand: string;
  leadGrade: string;
  nextBestAction: string;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
};

export async function buildWelcomeLeadContext(input: {
  contactId: string;
  ownerUserId: string;
  scoreResult: LeadScoreResult;
}): Promise<WelcomeLeadContext | null> {
  const contact = await getContact(input.contactId);
  if (!contact) return null;

  const email = contact.person.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;

  const companySnapshot = contact.person.companyId
    ? await getCompanySnapshot(contact.person.companyId).catch(() => null)
    : null;

  const ownerDelivery = await resolveSetupUserDeliveryEmail(
    input.ownerUserId,
    contact.person.organizationId,
  );
  if (!ownerDelivery?.email) return null;

  const displayName =
    `${contact.person.firstName} ${contact.person.lastName}`.trim() ||
    contact.displayName;
  const firstName =
    contact.person.firstName?.trim() ||
    displayName.split(/\s+/)[0] ||
    "there";

  return {
    contactId: input.contactId,
    contactName: displayName,
    contactFirstName: firstName,
    contactEmail: email,
    contactTitle: contact.person.title,
    companyName: companySnapshot?.name ?? contact.person.company?.name ?? null,
    industry: companySnapshot?.industry ?? contact.person.company?.industry ?? null,
    leadSource: contact.crm.leadSource,
    leadScore: input.scoreResult.score,
    leadBand: input.scoreResult.band,
    leadGrade: input.scoreResult.grade,
    nextBestAction: input.scoreResult.nextBestAction,
    ownerUserId: input.ownerUserId,
    ownerName: ownerDelivery.displayName,
    ownerEmail: ownerDelivery.email,
  };
}

export async function sendLeadAssignmentWelcome(input: {
  contactId: string;
  organizationId: string;
  ownerUserId: string;
  scoreResult: LeadScoreResult;
}): Promise<{ ok: boolean; reason?: string }> {
  const ctx = await buildWelcomeLeadContext({
    contactId: input.contactId,
    ownerUserId: input.ownerUserId,
    scoreResult: input.scoreResult,
  });
  if (!ctx) {
    return { ok: false, reason: "welcome_context_missing" };
  }

  const agent = await callAiServiceAgent<{
    ok?: boolean;
    subject?: string | null;
    body?: string | null;
    reason?: string | null;
    source?: string;
  }>(
    "welcome-lead",
    {
      contactId: input.contactId,
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      context: ctx,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  const subject = agent?.subject?.trim();
  const body = agent?.body?.trim();
  if (!subject || !body) {
    return { ok: false, reason: agent?.reason || "welcome_compose_failed" };
  }

  const sent = await sendTransactionalEmail({
    userId: input.ownerUserId,
    to: ctx.contactEmail,
    subject,
    body,
    contactId: input.contactId,
  });

  if (!sent.ok) {
    await notifyUsers({
      organizationId: input.organizationId,
      recipientUserIds: [input.ownerUserId],
      kind: "lead_welcome_send_failed",
      title: "Welcome email not sent",
      body: sent.needsConnect
        ? `Connect your email in Configuration to send the welcome message to ${ctx.contactName}.`
        : `Could not send welcome email to ${ctx.contactName}: ${sent.error}`,
      href: `/contact/${input.contactId}`,
      contactId: input.contactId,
      entityType: "contact",
      entityId: input.contactId,
      metadata: {
        needsConnect: Boolean(sent.needsConnect),
        agentSource: agent?.source ?? null,
      },
    }).catch(() => null);
    return {
      ok: false,
      reason: sent.needsConnect ? "owner_needs_connect" : "send_failed",
    };
  }

  return { ok: true };
}
