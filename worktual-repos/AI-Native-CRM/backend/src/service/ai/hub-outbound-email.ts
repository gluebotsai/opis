/**
 * Hub A2A outbound mail — CRM bot mailbox only.
 * Used when the spoke supervisor chains compose-email → send.
 * Does not touch inbox UI, coworker Confirm, nurture jobs, or auto-reply.
 */

import { getContact } from "@/dao/contacts/contact-service";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import {
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";
import { resolveCrmBotMailbox } from "@/dao/account/crm-bot-mailbox";
import { sendCrmBotEmail } from "@/service/email/send-crm-bot-email";
import { resolveNurtureEmail } from "@/service/ai/lead-nurture-job";
import { prisma } from "@/dao/db/prisma";
import { resolveContactOwnerUserId } from "@/dao/inbox/email-activity-user";

export async function sendHubOutboundEmail(
  contactId: string,
  input: {
    organizationId?: string | null;
    subject: string;
    body: string;
    reason?: string | null;
  },
): Promise<{
  ok: boolean;
  status: "sent" | "failed" | "skipped";
  to?: string;
  fromEmail?: string | null;
  messageId?: string | null;
  lastError?: string | null;
  activityId?: string | null;
}> {
  const subject = (input.subject || "").trim();
  const body = (input.body || "").trim();
  if (!subject || !body) {
    return {
      ok: false,
      status: "failed",
      lastError: "subject_and_body_required",
    };
  }

  const contact = await getContact(contactId);
  if (!contact) {
    return { ok: false, status: "skipped", lastError: "contact_not_found" };
  }

  const orgId = await resolveRequestOrganizationId(
    input.organizationId ?? contact.person.organizationId,
  );

  const optOut = await prisma.contactProfile.findFirst({
    where: { organizationId: orgId, accountContactId: contactId },
    select: { marketingOptOut: true },
  });
  if (optOut?.marketingOptOut) {
    return {
      ok: false,
      status: "skipped",
      lastError: "marketing_opt_out",
    };
  }

  const to = resolveNurtureEmail(
    contact.person.email,
    contact.person.secondaryEmails ?? [],
  );
  if (!to) {
    return { ok: false, status: "skipped", lastError: "no_contact_email" };
  }

  const mailbox = await resolveCrmBotMailbox(orgId).catch(() => null);
  if (!mailbox) {
    return {
      ok: false,
      status: "skipped",
      lastError: "no_crm_bot_mailbox",
      to,
    };
  }

  const sent = await sendCrmBotEmail({
    organizationId: orgId,
    to,
    subject,
    body,
  });

  if (!sent.ok) {
    return {
      ok: false,
      status: "failed",
      to,
      lastError: sent.error ?? "send_failed",
    };
  }

  const activity = await createContactActivity(contactId, {
    type: "email",
    subject,
    body: [
      "Hub outbound (A2A compose → send).",
      input.reason ? `Reason: ${input.reason}` : null,
      sent.fromEmail ? `From: ${sent.fromEmail}` : null,
      "",
      body,
    ]
      .filter((line) => line != null)
      .join("\n"),
    folder: "sent",
    emailDirection: "outbound",
    createdByUserId:
      contact.person.ownerUserId?.trim() ||
      (await resolveContactOwnerUserId(contactId)),
    gmailMessageId: sent.messageId ?? null,
    gmailThreadId: sent.threadId ?? null,
    rfcMessageId: sent.rfcMessageId ?? null,
  });

  return {
    ok: true,
    status: "sent",
    to,
    fromEmail: sent.fromEmail ?? null,
    messageId: sent.messageId ?? sent.rfcMessageId ?? null,
    activityId: activity?.id ?? null,
  };
}
