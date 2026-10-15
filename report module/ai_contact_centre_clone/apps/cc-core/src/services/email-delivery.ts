import type { DbClient } from "../lib/rls.js";

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL ?? "http://localhost:3002";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

export async function deliverMessageToEmail(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  body: string;
  threadId: string;
  subject: string;
  recipientEmail: string;
  deliveryId: string;
  connectionId: string;
  inReplyTo?: string | null;
  references?: string | null;
}): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-tenant-id": input.organizationId,
    };
    if (INTERNAL_SERVICE_KEY) {
      headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
    }

    const response = await fetch(`${CHAT_SERVICE_URL}/internal/v1/email/deliver`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function deliverPersistedMessageToEmail(
  db: DbClient,
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    body: string;
    threadId: string;
    subject: string;
    recipientEmail: string;
    connectionId: string;
    inReplyTo?: string | null;
    references?: string | null;
  },
): Promise<boolean> {
  const deliveryRows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO ccass.email_delivery_outbox (
      organization_id, conversation_id, message_id, source_message_id, connection_id,
      recipient_email, subject, provider_thread_id, in_reply_to, references_header,
      next_attempt_at
    ) VALUES (
      ${input.organizationId}::bigint,
      ${input.conversationId}::bigint,
      ${input.messageId}::bigint,
      ${input.messageId}::bigint,
      ${input.connectionId}::bigint,
      ${input.recipientEmail},
      ${input.subject},
      ${input.threadId},
      ${input.inReplyTo ?? null},
      ${input.references ?? null},
      NOW() + INTERVAL '30 seconds'
    )
    ON CONFLICT (organization_id, source_message_id) DO UPDATE
    SET updated_at = NOW()
    RETURNING id
  `;
  const deliveryId = deliveryRows[0]!.id;
  const delivered = await deliverMessageToEmail({ ...input, deliveryId });
  if (delivered) {
    await db.$executeRaw`
      UPDATE ccass.conversation_messages
      SET delivery_state = 'delivered', delivered_at = NOW()
      WHERE id = ${input.messageId}::bigint
        AND organization_id = ${input.organizationId}::bigint
    `;
  }
  return delivered;
}
