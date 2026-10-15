import { prisma } from "@/dao/db/prisma";

export type InboundEmailThreadHeaders = {
  gmail_thread_id: string | null;
  gmail_message_id: string | null;
  rfc_message_id: string | null;
  provider_thread_id: string | null;
  mail_provider: string | null;
};

export async function loadInboundEmailThreadHeaders(
  activityId: string,
): Promise<InboundEmailThreadHeaders | null> {
  const rows = await prisma.$queryRawUnsafe<InboundEmailThreadHeaders[]>(
    `
    SELECT gmail_thread_id, gmail_message_id, rfc_message_id,
           provider_thread_id, mail_provider::text AS mail_provider
    FROM contact_activities WHERE id = $1 LIMIT 1
    `,
    activityId,
  );
  return rows[0] ?? null;
}

export function crmBotEmailThreadingFromInbound(
  inbound: InboundEmailThreadHeaders | null,
): {
  gmailThreadId?: string | null;
  inReplyToRfcMessageId?: string | null;
  inReplyToGmailMessageId?: string | null;
  references?: string | null;
} {
  if (!inbound) return {};
  return {
    gmailThreadId: inbound.gmail_thread_id,
    inReplyToRfcMessageId: inbound.rfc_message_id,
    inReplyToGmailMessageId: inbound.gmail_message_id,
    references: inbound.rfc_message_id,
  };
}

/** Prefer the rep mailbox Gmail thread when replying from CRM inbox. */
export function resolveGmailThreadIdFromActivities(
  rows: Array<{
    gmail_thread_id: string | null;
    email_direction: string | null;
    created_by_user_id?: string | null;
  }>,
  options?: { mailboxUserId?: string | null },
): string | null {
  const mailboxUserId = options?.mailboxUserId?.trim();
  if (mailboxUserId) {
    const ownerInbound = rows.find(
      (r) =>
        r.email_direction === "inbound" &&
        r.gmail_thread_id &&
        String(r.created_by_user_id ?? "") === mailboxUserId,
    );
    if (ownerInbound?.gmail_thread_id) return ownerInbound.gmail_thread_id;

    const ownerMessage = rows.find(
      (r) =>
        r.gmail_thread_id &&
        String(r.created_by_user_id ?? "") === mailboxUserId,
    );
    if (ownerMessage?.gmail_thread_id) return ownerMessage.gmail_thread_id;
  }

  return (
    rows.find((r) => r.email_direction === "inbound" && r.gmail_thread_id)
      ?.gmail_thread_id ??
    rows.find((r) => r.gmail_thread_id)?.gmail_thread_id ??
    null
  );
}
