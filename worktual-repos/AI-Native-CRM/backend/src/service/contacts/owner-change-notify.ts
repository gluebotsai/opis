/**
 * When an admin/manager reassigns contact or deal ownership, notify the customer
 * from the new owner's connected mailbox that their point of contact has changed.
 *
 * Skips first-time assignment (no previous owner) — welcome email covers that path.
 */

import { getContact } from "@/dao/contacts/contact-service";
import { getCompanySnapshot } from "@/dao/companies/sync-from-contacts";
import { notifyUsers } from "@/dao/notifications/notify-users";
import { resolveSetupUserDeliveryEmail } from "@/service/account/setup-users";
import {
  AI_SERVICE_JOB_TIMEOUT_MS,
  callAiServiceAgent,
} from "@/service/ai/ai-service-client";
import { sendTransactionalEmail } from "@/service/mail/send-transactional";

export type OwnerChangeNotifyContext = {
  contactId: string;
  contactName: string;
  contactFirstName: string;
  contactEmail: string;
  companyName: string | null;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  previousOwnerUserId: string;
  previousOwnerName: string | null;
};

export function shouldNotifyCustomerOfOwnerChange(input: {
  previousOwnerUserId: string | null | undefined;
  newOwnerUserId: string | null | undefined;
}): boolean {
  const previous = input.previousOwnerUserId?.trim() || null;
  const next = input.newOwnerUserId?.trim() || null;
  return Boolean(previous && next && previous !== next);
}

export async function buildOwnerChangeNotifyContext(input: {
  contactId: string;
  newOwnerUserId: string;
  previousOwnerUserId: string;
  organizationId: string;
}): Promise<OwnerChangeNotifyContext | null> {
  const contact = await getContact(input.contactId);
  if (!contact) return null;

  const email = contact.person.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;

  const companySnapshot = contact.person.companyId
    ? await getCompanySnapshot(contact.person.companyId).catch(() => null)
    : null;

  const ownerDelivery = await resolveSetupUserDeliveryEmail(
    input.newOwnerUserId,
    input.organizationId,
  );
  if (!ownerDelivery?.email) return null;

  const previousDelivery = await resolveSetupUserDeliveryEmail(
    input.previousOwnerUserId,
    input.organizationId,
  );

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
    companyName: companySnapshot?.name ?? contact.person.company?.name ?? null,
    ownerUserId: input.newOwnerUserId,
    ownerName: ownerDelivery.displayName,
    ownerEmail: ownerDelivery.email,
    previousOwnerUserId: input.previousOwnerUserId,
    previousOwnerName: previousDelivery?.displayName?.trim() || null,
  };
}

export async function sendOwnerChangeCustomerNotice(input: {
  contactId: string;
  organizationId: string;
  newOwnerUserId: string;
  previousOwnerUserId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (
    !shouldNotifyCustomerOfOwnerChange({
      previousOwnerUserId: input.previousOwnerUserId,
      newOwnerUserId: input.newOwnerUserId,
    })
  ) {
    return { ok: false, reason: "owner_unchanged_or_first_assign" };
  }

  const ctx = await buildOwnerChangeNotifyContext(input);
  if (!ctx) {
    return { ok: false, reason: "notify_context_missing" };
  }

  const agent = await callAiServiceAgent<{
    ok?: boolean;
    subject?: string | null;
    body?: string | null;
    reason?: string | null;
    source?: string;
  }>(
    "owner-change-notify",
    {
      contactId: input.contactId,
      organizationId: input.organizationId,
      ownerUserId: input.newOwnerUserId,
      context: ctx,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  const subject = agent?.subject?.trim();
  const body = agent?.body?.trim();
  if (!subject || !body) {
    return { ok: false, reason: agent?.reason || "notify_compose_failed" };
  }

  const sent = await sendTransactionalEmail({
    userId: input.newOwnerUserId,
    to: ctx.contactEmail,
    subject,
    body,
    contactId: input.contactId,
  });

  if (!sent.ok) {
    await notifyUsers({
      organizationId: input.organizationId,
      recipientUserIds: [input.newOwnerUserId],
      kind: "owner_change_notify_failed",
      title: "Point-of-contact email not sent",
      body: sent.needsConnect
        ? `Connect your email in Configuration to notify ${ctx.contactName} that you are their new contact.`
        : `Could not notify ${ctx.contactName} about the owner change: ${sent.error}`,
      href: `/contact/${input.contactId}`,
      contactId: input.contactId,
      entityType: "contact",
      entityId: input.contactId,
      metadata: {
        needsConnect: Boolean(sent.needsConnect),
        previousOwnerUserId: input.previousOwnerUserId,
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

/** Fire-and-forget wrapper for command layers. */
export function notifyCustomerOfOwnerChangeAsync(input: {
  contactId: string;
  organizationId: string;
  newOwnerUserId: string;
  previousOwnerUserId: string | null | undefined;
}): void {
  const previous = input.previousOwnerUserId?.trim() || null;
  const next = input.newOwnerUserId?.trim() || null;
  if (!previous || !next || previous === next) return;

  void sendOwnerChangeCustomerNotice({
    contactId: input.contactId,
    organizationId: input.organizationId,
    newOwnerUserId: next,
    previousOwnerUserId: previous,
  }).catch((err) => {
    console.error("owner change customer notify failed", input.contactId, err);
  });
}
