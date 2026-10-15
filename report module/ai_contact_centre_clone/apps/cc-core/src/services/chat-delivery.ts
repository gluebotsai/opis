import type { DbClient } from "../lib/rls.js";

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL ?? "http://localhost:3002";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
/** Bound provider HTTP so delivery never holds an interactive DB transaction open. */
const CHAT_FETCH_TIMEOUT_MS = Number(process.env.CHAT_FETCH_TIMEOUT_MS ?? 8_000);

async function resolveAssignedAgentName(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<string | null> {
  const rows = await db.$queryRaw<{ display_name: string | null }[]>`
    SELECT a.display_name
    FROM ccass.conversations c
    INNER JOIN ccass.agents a
      ON a.id = c.assigned_agent_id
     AND a.organization_id = c.organization_id
    WHERE c.id = ${conversationId}::bigint
      AND c.organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const name = rows[0]?.display_name?.trim();
  return name || null;
}

export async function deliverMessageToWebchat(input: {
  organizationId: string;
  conversationId: string;
  body: string;
  messageId?: string;
  senderType?: "agent" | "system";
  agentName?: string | null;
  webchatId?: string | null;
  visitorId?: string | null;
  attachments?: Array<{
    externalId?: string;
    storageKey: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    checksumSha256?: string;
    downloadUrl?: string;
  }>;
}): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (INTERNAL_SERVICE_KEY) {
      headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
    }
    headers["x-tenant-id"] = input.organizationId;

    const response = await fetch(`${CHAT_SERVICE_URL}/internal/v1/webchat/deliver`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        conversationId: input.conversationId,
        body: input.body,
        messageId: input.messageId,
        senderType: input.senderType ?? "agent",
        ...(input.senderType !== "system" && input.agentName
          ? { agent_name: input.agentName }
          : {}),
        webchatId: input.webchatId ?? undefined,
        visitorId: input.visitorId ?? undefined,
        attachments: input.attachments,
      }),
      signal: AbortSignal.timeout(CHAT_FETCH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function triggerWebchatBot(input: {
  webchatId: string;
  visitorId: string;
  text?: string;
  openPanel?: boolean;
  openMode?: "bubble" | "panel";
  autoSessionStart?: boolean;
  reason?: string;
  pageUrl?: string;
}): Promise<
  | { ok: true; conversationId?: string; sessionStarted: boolean }
  | { ok: false; status: number; error: string }
> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (INTERNAL_SERVICE_KEY) {
      headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
    }

    const response = await fetch(`${CHAT_SERVICE_URL}/internal/v1/webchat/trigger-bot`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return {
        ok: false,
        status: response.status,
        error: body?.error ?? "chat-service trigger failed",
      };
    }

    const body = (await response.json()) as {
      conversationId?: string;
      sessionStarted?: boolean;
    };
    return {
      ok: true,
      conversationId: body.conversationId,
      sessionStarted: body.sessionStarted ?? true,
    };
  } catch {
    return { ok: false, status: 502, error: "chat-service unreachable" };
  }
}

export async function deliverRealtimeEventToWebchat(input:
  | {
      organizationId: string;
      conversationId: string;
      type: "typing.started" | "typing.stopped";
    }
  | {
      organizationId: string;
      conversationId: string;
      type: "receipt.delivered" | "receipt.read";
      messageId: string;
      occurredAt: string;
    }
  | {
      organizationId: string;
      conversationId: string;
      type: "session.ended";
      reason: string;
    }): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-tenant-id": input.organizationId,
    };
    if (INTERNAL_SERVICE_KEY) headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
    const response = await fetch(`${CHAT_SERVICE_URL}/internal/v1/webchat/event`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function deliverPersistedMessageToWebchat(
  db: DbClient,
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    body: string;
    senderType?: "agent" | "system";
    agentName?: string | null;
    webchatId?: string | null;
    visitorId?: string | null;
  },
): Promise<boolean> {
  let webchatId = input.webchatId ?? null;
  let visitorId = input.visitorId ?? null;
  let agentName = input.agentName ?? null;
  if (!webchatId || !visitorId) {
    const rows = await db.$queryRaw<Array<{ webchat_id: string | null; visitor_id: string | null }>>`
      SELECT webchat_id, visitor_id
      FROM ccass.conversations
      WHERE id = ${input.conversationId}::bigint
        AND organization_id = ${input.organizationId}::bigint
      LIMIT 1
    `;
    webchatId = webchatId ?? rows[0]?.webchat_id ?? null;
    visitorId = visitorId ?? rows[0]?.visitor_id ?? null;
  }
  if ((input.senderType ?? "agent") === "agent" && !agentName) {
    agentName = await resolveAssignedAgentName(db, input.organizationId, input.conversationId);
  }

  const deliveryInput = { ...input, webchatId, visitorId, agentName };
  // Keep attempts low: callers often run this inside a 30s interactive transaction.
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const inserted = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO ccass.message_delivery_attempts (
        organization_id, message_id, destination, attempt_number, status
      ) VALUES (
        ${input.organizationId}::bigint,
        ${input.messageId}::bigint,
        'webchat',
        ${attempt},
        'pending'
      )
      RETURNING id
    `;
    const attemptId = inserted[0]?.id;
    if (!attemptId) {
      throw Object.assign(new Error("message delivery attempt insert did not return id"), { status: 500 });
    }

    const delivered = await deliverMessageToWebchat(deliveryInput);
    await db.$executeRaw`
      UPDATE ccass.message_delivery_attempts
      SET
        status = ${delivered ? "delivered" : "failed"},
        provider_response = ${JSON.stringify({ delivered })}::jsonb,
        error_message = ${delivered ? null : "chat-service delivery failed"},
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
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
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

/** @deprecated Use deliverMessageToWebchat */
export async function deliverAgentMessageToWebchat(input: {
  organizationId: string;
  conversationId: string;
  body: string;
  messageId?: string;
}): Promise<boolean> {
  return deliverMessageToWebchat({ ...input, senderType: "agent" });
}
