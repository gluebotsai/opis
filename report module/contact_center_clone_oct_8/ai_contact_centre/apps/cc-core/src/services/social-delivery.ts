import type { DbClient } from "../lib/rls.js";

const SOCIAL_SERVICE_URL = process.env.SOCIAL_SERVICE_URL ?? "http://localhost:3004";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
/** Bound provider HTTP so delivery never holds an interactive DB transaction open. */
const SOCIAL_FETCH_TIMEOUT_MS = Number(process.env.SOCIAL_FETCH_TIMEOUT_MS ?? 8_000);

export type SocialDeliveryChannel = "whatsapp" | "instagram" | "facebook";

function sendPathForChannel(channel: SocialDeliveryChannel): string {
  if (channel === "instagram") return "/internal/v1/instagram/messages";
  if (channel === "facebook") return "/internal/v1/facebook/messages";
  return "/internal/v1/whatsapp/messages";
}

export async function deliverMessageToSocial(input: {
  organizationId: string;
  channel: SocialDeliveryChannel;
  channelConfigId: string;
  to: string;
  body: string;
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

    const response = await fetch(
      `${SOCIAL_SERVICE_URL}${sendPathForChannel(input.channel)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          channelConfigId: input.channelConfigId,
          to: input.to,
          body: input.body,
        }),
        signal: AbortSignal.timeout(SOCIAL_FETCH_TIMEOUT_MS),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** @deprecated Prefer deliverMessageToSocial — kept for WhatsApp call sites. */
export async function deliverMessageToWhatsApp(input: {
  organizationId: string;
  channelConfigId: string;
  to: string;
  body: string;
}): Promise<boolean> {
  return deliverMessageToSocial({ ...input, channel: "whatsapp" });
}

export async function deliverPersistedMessageToSocial(
  db: DbClient,
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    body: string;
    channel: SocialDeliveryChannel;
    channelConfigId: string;
    recipientRef: string;
  },
): Promise<boolean> {
  // Keep attempts low: callers often run this inside a 30s interactive transaction.
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const inserted = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO ccass.message_delivery_attempts (
        organization_id, message_id, destination, attempt_number, status
      ) VALUES (
        ${input.organizationId}::bigint,
        ${input.messageId}::bigint,
        ${input.channel},
        ${attempt},
        'pending'
      )
      RETURNING id
    `;
    const attemptId = inserted[0]?.id;
    if (!attemptId) {
      throw Object.assign(new Error("message delivery attempt insert did not return id"), { status: 500 });
    }

    const delivered = await deliverMessageToSocial({
      organizationId: input.organizationId,
      channel: input.channel,
      channelConfigId: input.channelConfigId,
      to: input.recipientRef,
      body: input.body,
    });

    await db.$executeRaw`
      UPDATE ccass.message_delivery_attempts
      SET
        status = ${delivered ? "delivered" : "failed"},
        provider_response = ${JSON.stringify({ delivered })}::jsonb,
        error_message = ${delivered ? null : "social-service delivery failed"},
        delivered_at = ${delivered ? new Date() : null}
      WHERE id = ${attemptId}::bigint
    `;

    if (delivered) {
      await db.$executeRaw`
        UPDATE ccass.conversation_messages
        SET delivery_state = 'delivered', delivered_at = NOW()
        WHERE id = ${input.messageId}::bigint
          AND organization_id = ${input.organizationId}::bigint
      `;
      return true;
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }

  await db.$executeRaw`
    UPDATE ccass.conversation_messages
    SET delivery_state = 'failed'
    WHERE id = ${input.messageId}::bigint
      AND organization_id = ${input.organizationId}::bigint
  `;
  return false;
}

/** @deprecated Prefer deliverPersistedMessageToSocial — kept for WhatsApp call sites. */
export async function deliverPersistedMessageToWhatsApp(
  db: DbClient,
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    body: string;
    channelConfigId: string;
    recipientPhone: string;
  },
): Promise<boolean> {
  return deliverPersistedMessageToSocial(db, {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    body: input.body,
    channel: "whatsapp",
    channelConfigId: input.channelConfigId,
    recipientRef: input.recipientPhone,
  });
}
