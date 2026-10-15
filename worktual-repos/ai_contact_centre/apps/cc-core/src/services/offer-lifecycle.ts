import type { FastifyInstance } from "fastify";

import { withOrganizationContext, withStaffContext } from "../lib/rls.js";
import type { DbClient } from "../lib/rls.js";
import { deliverMessageToWebchat, deliverPersistedMessageToWebchat } from "./chat-delivery.js";
import { serializeEntityId } from "../lib/id-schema.js";
import { expireConversationOffer, type ConversationRecord, type ConversationTransferRecord, type MessageRecord } from "./conversations.js";
import type { AgentMissedContactRecord } from "./agent-missed-contacts.js";
import type { AgentPresenceRecord } from "./presence.js";
import { listAgentMissedContacts } from "./agent-missed-contacts.js";
import {
  DEFAULT_LIVE_OFFER_TIMEOUT_SECONDS,
  resolveLiveOfferTimeoutSeconds,
} from "./offer-timeout-config.js";
import {
  emitConversationQueued,
  emitConversationRejected,
  emitConversationRouted,
  emitMissedContactCreated,
  emitPresenceUpdated,
  emitPresenceUpdatedForAgent,
  emitTransferExpired,
  shouldScheduleOfferExpiration,
} from "./realtime.js";
import {
  deliverPersistedMessageToSocial,
  deliverPersistedMessageToWhatsApp,
} from "./social-delivery.js";

const offerTimers = new Map<string, NodeJS.Timeout>();
let offerSweepTimer: NodeJS.Timeout | null = null;
const OFFER_EXPIRATION_TX_TIMEOUT_MS = 120_000;

function timerKey(
  organizationId: string | number | bigint,
  conversationId: string | number | bigint,
): string {
  return `${serializeEntityId(organizationId)}:${serializeEntityId(conversationId)}`;
}

export function computeOfferExpiresAt(offeredAt: Date, timeoutSeconds: number): Date {
  return new Date(offeredAt.getTime() + Math.max(1, timeoutSeconds) * 1000);
}

/** Documented SQL shape used by the durable expiry worker. */
export function listExpiredOfferCandidates(): string {
  return `
    SELECT id, organization_id, conversation_id, agent_id
    FROM ccass.conversation_assignments
    WHERE state = 'offered'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
    ORDER BY expires_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 50
  `;
}

export function notifyConversationRouted(
  app: FastifyInstance,
  organizationId: string,
  conversation: ConversationRecord,
  userId: string,
): void {
  emitConversationRouted(organizationId, conversation, userId);
  if (shouldScheduleOfferExpiration(conversation)) {
    void scheduleOfferExpiration(app, organizationId, conversation.id).catch((error) => {
      app.log.error(
        { err: error, organizationId, conversationId: conversation.id },
        "failed to schedule offer expiration",
      );
    });
  }
}

type OfferExpirationResult = {
  conversation: ConversationRecord;
  nextUserId: string | null;
  rerouted: boolean;
  timedOutUserId: string | null;
  timedOutPresence: AgentPresenceRecord | null;
  missedContact: AgentMissedContactRecord | null;
  missedContactUnreadCount?: number;
  systemMessage: MessageRecord | null;
  transfer?: ConversationTransferRecord | null;
};

async function deliverOfferExpirationSystemMessage(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  conversation: ConversationRecord,
  systemMessage: MessageRecord,
): Promise<void> {
  if (conversation.channel === "webchat") {
    await deliverPersistedMessageToWebchat(db, {
      organizationId,
      conversationId,
      messageId: systemMessage.id,
      body: systemMessage.body,
      senderType: "system",
      webchatId: conversation.webchatId,
      visitorId: conversation.visitorId,
    });
    return;
  }

  if (
    conversation.channel === "whatsapp" &&
    conversation.channelConfigId &&
    conversation.visitorId
  ) {
    await deliverPersistedMessageToWhatsApp(db, {
      organizationId,
      conversationId,
      body: systemMessage.body,
      messageId: systemMessage.id,
      channelConfigId: conversation.channelConfigId,
      recipientPhone: conversation.visitorId,
    });
    return;
  }

  if (
    (conversation.channel === "instagram" || conversation.channel === "facebook") &&
    conversation.channelConfigId &&
    conversation.visitorId
  ) {
    await deliverPersistedMessageToSocial(db, {
      organizationId,
      conversationId,
      body: systemMessage.body,
      messageId: systemMessage.id,
      channel: conversation.channel,
      channelConfigId: conversation.channelConfigId,
      recipientRef: conversation.visitorId,
    });
  }
}

async function notifyOfferExpirationResult(
  app: FastifyInstance,
  organizationId: string,
  conversationId: string,
  result: OfferExpirationResult,
): Promise<void> {
  if (result.transfer) {
    emitTransferExpired(
      organizationId,
      result.transfer,
      result.timedOutUserId,
      result.conversation,
    );
    return;
  }
  if (result.systemMessage) {
    const deliveryInput = {
      organizationId: serializeEntityId(organizationId),
      conversationId: serializeEntityId(conversationId),
      messageId: result.systemMessage.id,
      body: result.systemMessage.body,
      senderType: "system" as const,
      webchatId: result.conversation.webchatId,
      visitorId: result.conversation.visitorId,
    };

    let delivered = false;
    try {
      delivered = await deliverMessageToWebchat(deliveryInput);
    } catch (error) {
      app.log.warn(
        { error, conversationId, messageId: result.systemMessage.id },
        "Offer-timeout direct webchat delivery failed",
      );
    }

    if (!delivered) {
      try {
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          deliverOfferExpirationSystemMessage(
            db,
            organizationId,
            conversationId,
            result.conversation,
            result.systemMessage!,
          ),
        );
      } catch (error) {
        app.log.error(
          { error, conversationId, messageId: result.systemMessage.id },
          "Offer-timeout persisted webchat delivery failed",
        );
      }
    }
  }

  if (result.timedOutUserId) {
    emitConversationRejected(organizationId, result.conversation, result.timedOutUserId);
    if (result.timedOutPresence) {
      emitPresenceUpdatedForAgent(
        organizationId,
        result.timedOutUserId,
        result.timedOutPresence,
      );
      emitPresenceUpdated(organizationId, result.timedOutPresence, result.timedOutUserId);
    }
    if (result.missedContact) {
      try {
        const unreadCount =
          result.missedContactUnreadCount ??
          (
            await withOrganizationContext(app.prisma, organizationId, (db) =>
              listAgentMissedContacts(db, organizationId, result.timedOutUserId!, { limit: 1 }),
            )
          ).unreadCount;
        emitMissedContactCreated(organizationId, result.timedOutUserId, {
          item: {
            id: result.missedContact.id,
            conversationId: result.missedContact.conversationId,
            channel: result.missedContact.channel,
            reason: result.missedContact.reason,
            customerName: result.missedContact.customerName,
            missedAt: result.missedContact.missedAt,
          },
          unreadCount,
        });
      } catch (error) {
        app.log.warn(
          { error, conversationId, timedOutUserId: result.timedOutUserId },
          "Offer-timeout missed-contact notification failed",
        );
      }
    }
  }
  if (result.rerouted && result.nextUserId) {
    emitConversationRouted(organizationId, result.conversation, result.nextUserId);
    if (shouldScheduleOfferExpiration(result.conversation)) {
      await scheduleOfferExpiration(app, organizationId, conversationId);
    }
  } else {
    emitConversationQueued(organizationId, result.conversation);
  }
}

async function readOfferTimeoutSeconds(
  app: FastifyInstance,
  organizationId: string,
  conversationId: string,
): Promise<number> {
  return withOrganizationContext(app.prisma, organizationId, async (db) => {
    const rows = await db.$queryRaw<{ offer_timeout_seconds: number | null }[]>`
      SELECT CASE
        WHEN c.channel = 'email' THEN COALESCE(rp.email_offer_timeout_seconds, 3600)
        ELSE rp.offer_timeout_seconds
      END AS offer_timeout_seconds
      FROM ccass.conversations c
      LEFT JOIN ccass.routing_policies rp
        ON rp.queue_id = c.queue_id
       AND rp.organization_id = c.organization_id
      WHERE c.id = ${conversationId}::bigint
        AND c.organization_id = ${organizationId}::bigint
      LIMIT 1
    `;
    return resolveLiveOfferTimeoutSeconds(rows[0]?.offer_timeout_seconds);
  });
}

export async function persistOfferExpiration(
  app: FastifyInstance,
  organizationId: string,
  conversationId: string,
): Promise<Date> {
  const timeoutSeconds = await readOfferTimeoutSeconds(app, organizationId, conversationId);
  await withOrganizationContext(app.prisma, organizationId, async (db) => {
    await db.$executeRaw`
      UPDATE ccass.conversation_assignments
      SET expires_at = COALESCE(offered_at, NOW()) + (${timeoutSeconds} || ' seconds')::interval
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND state = 'offered'
    `;
  });

  const expiresAt = await withOrganizationContext(app.prisma, organizationId, async (db) => {
    const rows = await db.$queryRaw<{ expires_at: Date | null }[]>`
      SELECT expires_at
      FROM ccass.conversation_assignments
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND state = 'offered'
      ORDER BY offered_at DESC NULLS LAST
      LIMIT 1
    `;
    return rows[0]?.expires_at ?? computeOfferExpiresAt(new Date(), timeoutSeconds);
  });
  return expiresAt;
}

export async function scheduleOfferExpiration(
  app: FastifyInstance,
  organizationId: string | number | bigint,
  conversationId: string | number | bigint,
): Promise<void> {
  const orgId = serializeEntityId(organizationId);
  const convId = serializeEntityId(conversationId);
  const key = timerKey(orgId, convId);
  const current = offerTimers.get(key);
  if (current) clearTimeout(current);

  const expiresAt = await persistOfferExpiration(app, orgId, convId);
  const delayMs = Math.max(1, expiresAt.getTime() - Date.now());

  const timer = setTimeout(async () => {
    offerTimers.delete(key);
    try {
      const result = await withOrganizationContext(
        app.prisma,
        orgId,
        (db) => expireConversationOffer(db, orgId, convId),
        { timeoutMs: OFFER_EXPIRATION_TX_TIMEOUT_MS },
      );
      if (!result) return;
      await notifyOfferExpirationResult(app, orgId, convId, result);
    } catch (error) {
      app.log.error(
        { err: error, organizationId, conversationId },
        "conversation offer expiration failed",
      );
    }
  }, delayMs);
  timer.unref();
  offerTimers.set(key, timer);
}

export function cancelOfferExpiration(
  organizationId: string,
  conversationId: string,
): void {
  const key = timerKey(organizationId, conversationId);
  const timer = offerTimers.get(key);
  if (timer) clearTimeout(timer);
  offerTimers.delete(key);
}

export async function clearPendingOfferExpiration(
  app: FastifyInstance,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  cancelOfferExpiration(organizationId, conversationId);
  await withOrganizationContext(app.prisma, organizationId, (db) =>
    db.$executeRaw`
      UPDATE ccass.conversation_assignments
      SET expires_at = NULL
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND state = 'offered'
    `,
  );
}

type ExpiredOfferRow = {
  organization_id: string;
  conversation_id: string;
};

export async function sweepExpiredOffers(
  app: FastifyInstance,
): Promise<number> {
  const rows = await withStaffContext(app.prisma, async (db) =>
    db.$queryRaw<ExpiredOfferRow[]>`
      SELECT organization_id, conversation_id
      FROM ccass.conversation_assignments
      WHERE state = 'offered'
        AND expires_at IS NOT NULL
        AND expires_at <= NOW()
      ORDER BY expires_at ASC
      LIMIT 50
    `,
  );

  let processed = 0;
  for (const row of rows) {
    const organizationId = serializeEntityId(row.organization_id);
    const conversationId = serializeEntityId(row.conversation_id);
    try {
      const result = await withOrganizationContext(
        app.prisma,
        organizationId,
        (db) => expireConversationOffer(db, organizationId, conversationId),
        { timeoutMs: OFFER_EXPIRATION_TX_TIMEOUT_MS },
      );
      if (!result) continue;
      processed += 1;
      cancelOfferExpiration(organizationId, conversationId);
      await notifyOfferExpirationResult(
        app,
        organizationId,
        conversationId,
        result,
      );
    } catch (error) {
      app.log.error(
        {
          err: error,
          organizationId: row.organization_id,
          conversationId: row.conversation_id,
        },
        "durable offer sweep failed",
      );
    }
  }
  return processed;
}

export async function reschedulePendingOfferExpirations(
  app: FastifyInstance,
): Promise<number> {
  const rows = await withStaffContext(app.prisma, async (db) =>
    db.$queryRaw<{ organization_id: string; conversation_id: string }[]>`
      SELECT organization_id, conversation_id
      FROM ccass.conversation_assignments
      WHERE state = 'offered'
      ORDER BY offered_at ASC NULLS LAST
      LIMIT 100
    `,
  );

  let scheduled = 0;
  for (const row of rows) {
    try {
      await scheduleOfferExpiration(
        app,
        serializeEntityId(row.organization_id),
        serializeEntityId(row.conversation_id),
      );
      scheduled += 1;
    } catch (error) {
      app.log.error(
        {
          err: error,
          organizationId: row.organization_id,
          conversationId: row.conversation_id,
        },
        "failed to reschedule pending offer expiration",
      );
    }
  }
  return scheduled;
}

export function startOfferExpirationSweeper(app: FastifyInstance): void {
  if (offerSweepTimer) return;
  const intervalMs = Number(process.env.OFFER_SWEEP_INTERVAL_MS ?? 5_000);
  void reschedulePendingOfferExpirations(app).catch((error) => {
    app.log.error({ err: error }, "initial offer expiration reschedule failed");
  });
  void sweepExpiredOffers(app).catch((error) => {
    app.log.error({ err: error }, "initial offer sweep failed");
  });
  offerSweepTimer = setInterval(() => {
    void sweepExpiredOffers(app).catch((error) => {
      app.log.error({ err: error }, "offer sweep failed");
    });
  }, Math.max(1_000, intervalMs));
  offerSweepTimer.unref();
}

export { DEFAULT_LIVE_OFFER_TIMEOUT_SECONDS };
