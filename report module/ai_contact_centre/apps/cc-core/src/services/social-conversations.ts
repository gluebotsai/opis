import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import { projectInteractionEvent } from "./cdp-projection.js";
import { resolveInboundConversationContact } from "./contact-identity.js";
import {
  appendConversationMessage,
  getConversation,
  type ConversationRecord,
  type MessageRecord,
} from "./conversations.js";
import {
  listActiveQueuesForChannel,
  resolveHandoffQueue,
  routeConversationToAgent,
  type HandoffQueueCandidate,
  type RoutableChannel,
} from "./routing.js";
import { ensureNlpConversation } from "./nlp-conversations.js";
import { reconcilePolicyChange } from "./conversation-transitions.js";
import { resolveChannelPolicy } from "./channel-policies.js";
import { entityIdSchema, serializeEntityIdOptional } from "../lib/id-schema.js";
import { expireIdleSocialBotSessionIfNeeded } from "./social-session.js";
import { resolveCustomerDisplayLabel } from "../lib/person-display-name.js";

export const socialChannelTypeSchema = z.enum(["whatsapp", "instagram", "facebook"]);
export type SocialChannelType = z.infer<typeof socialChannelTypeSchema>;

/** Meta IG/FB mids are ~160+ chars; keep headroom for future formats. */
export const SOCIAL_EXTERNAL_MESSAGE_ID_MAX = 512;

export const ingestInboundSocialSchema = z.object({
  organizationId: entityIdSchema,
  channelConfigId: entityIdSchema,
  channelType: socialChannelTypeSchema,
  externalThreadId: z.string().min(1).max(128),
  externalMessageId: z.string().min(1).max(SOCIAL_EXTERNAL_MESSAGE_ID_MAX),
  customerRef: z.string().min(1).max(128),
  customerName: z.string().optional().nullable(),
  body: z.string().min(1).max(4096),
  messageType: z.string().max(64).optional(),
  phoneNumberId: z.string().max(64).optional(),
  pageId: z.string().max(64).optional(),
  igBusinessAccountId: z.string().max(64).optional(),
  occurredAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

type ConversationRow = {
  id: string;
  organization_id: string;
  channel: string;
  external_thread_id: string;
  provider_thread_id: string | null;
  visitor_id: string | null;
  subject: string | null;
  status: string;
  queue_id: string | null;
  channel_config_id: string | null;
  bot_active: boolean;
  updated_at: Date;
};

function channelSubject(channel: SocialChannelType): string {
  if (channel === "instagram") return "Instagram";
  if (channel === "facebook") return "Facebook";
  return "WhatsApp";
}

async function syncSocialConversationSubject(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  input: {
    channel: SocialChannelType;
    channelDisplayName?: string | null;
    visitorId: string;
  },
): Promise<void> {
  const rows = await db.$queryRaw<
    Array<{
      first_name: string | null;
      last_name: string | null;
      display_name: string | null;
    }>
  >`
    SELECT
      cp.first_name,
      cp.last_name,
      NULLIF(
        TRIM(CONCAT(NULLIF(TRIM(cp.first_name), ''), ' ', NULLIF(TRIM(cp.last_name), ''))),
        ''
      ) AS display_name
    FROM ccass.conversations c
    LEFT JOIN cdp.customer_profile cp
      ON cp.organization_id = c.organization_id
     AND c.contact_id IS NOT NULL
     AND cp.cdp_id = c.contact_id
    WHERE c.organization_id = ${organizationId}::bigint
      AND c.id = ${conversationId}::bigint
    LIMIT 1
  `;

  const profile = rows[0];
  const subject = resolveCustomerDisplayLabel({
    profileFullName: profile?.display_name,
    profileFirstName: profile?.first_name,
    profileLastName: profile?.last_name,
    channelDisplayName: input.channelDisplayName,
    visitorId: input.visitorId,
    channelFallback: channelSubject(input.channel),
  });

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET subject = ${subject}, updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${conversationId}::bigint
  `;
}

/** Unique per conversation row; provider_thread_id carries the stable customer thread key. */
export function buildSocialSessionExternalThreadId(channel: SocialChannelType): string {
  return `${channel}:${randomUUID()}`;
}

function toRoutableSocialChannel(channel: SocialChannelType): RoutableChannel {
  return channel;
}

function toQueueProfiles(queues: HandoffQueueCandidate[]) {
  return queues.map((queue) => ({
    key: queue.id,
    id: queue.id,
    name: queue.name,
    description: queue.description ?? queue.name,
    skills: queue.skills,
    intents: queue.intents,
  }));
}

async function findOpenSocialConversation(
  db: DbClient,
  organizationId: string,
  channel: SocialChannelType,
  providerThreadId: string,
): Promise<ConversationRow | null> {
  const rows = await db.$queryRaw<ConversationRow[]>`
    SELECT
      id,
      organization_id,
      channel,
      external_thread_id,
      provider_thread_id,
      visitor_id,
      subject,
      status,
      queue_id,
      channel_config_id,
      bot_active,
      updated_at
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel = ${channel}
      AND provider_thread_id = ${providerThreadId}
      AND status NOT IN ('resolved', 'closed')
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPreviousClosedSocialConversation(
  db: DbClient,
  organizationId: string,
  channel: SocialChannelType,
  providerThreadId: string,
): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel = ${channel}
      AND provider_thread_id = ${providerThreadId}
      AND status IN ('resolved', 'closed')
    ORDER BY ended_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export async function ingestInboundSocialConversation(
  db: DbClient,
  input: z.infer<typeof ingestInboundSocialSchema>,
): Promise<{
  conversation: ConversationRecord;
  message: MessageRecord;
  created: boolean;
  assignment: { agentId: string; userId: string } | null;
  queued: boolean;
  duplicate: boolean;
  botEligible: boolean;
  policy: {
    confidenceThreshold: number;
    handoffMessage: string | null;
    liveAgentEnabled: boolean;
  };
  queueProfiles: Array<{
    key: string;
    id: string;
    name: string;
    description: string | null;
    skills: string[];
    intents: string[];
  }>;
}> {
  const payload = ingestInboundSocialSchema.parse(input);
  const channel = payload.channelType;
  const providerThreadId = payload.externalThreadId;
  const defaultSubject = channelSubject(channel);

  const existingMessageRows = await db.$queryRaw<
    Array<{ conversation_id: string; message_id: string }>
  >`
    SELECT conversation_id, id AS message_id
    FROM ccass.conversation_messages
    WHERE organization_id = ${payload.organizationId}::bigint
      AND external_id = ${payload.externalMessageId}
    LIMIT 1
  `;
  if (existingMessageRows[0]) {
    const conversation = await getConversation(
      db,
      payload.organizationId,
      existingMessageRows[0].conversation_id,
    );
    if (!conversation) {
      throw Object.assign(new Error("Duplicate social event without conversation"), {
        status: 500,
      });
    }
    const messageRows = await db.$queryRaw<
      Array<{
        id: string;
        conversation_id: string;
        sender_type: string;
        direction: string;
        visibility: string;
        body: string;
        delivery_state: string;
        created_at: Date;
      }>
    >`
      SELECT id, conversation_id, sender_type, direction, visibility, body, delivery_state, created_at
      FROM ccass.conversation_messages
      WHERE id = ${existingMessageRows[0].message_id}::bigint
      LIMIT 1
    `;
    const row = messageRows[0];
    if (!row) {
      throw Object.assign(new Error("Duplicate social event without message"), { status: 500 });
    }
    const duplicatePolicy = await resolveChannelPolicy(db, payload.organizationId, {
      channelConfigId: payload.channelConfigId,
      channel,
    });
    const queueProfiles = toQueueProfiles(
      await listActiveQueuesForChannel(db, payload.organizationId, channel),
    );
    return {
      conversation,
      message: {
        id: serializeEntityIdOptional(row.id)!,
        conversationId: serializeEntityIdOptional(row.conversation_id)!,
        senderType: row.sender_type,
        direction: row.direction,
        visibility: row.visibility,
        body: row.body,
        deliveryState: row.delivery_state,
        messageType: "text",
        sentAt: row.created_at.toISOString(),
        attachments: [],
        createdAt: row.created_at.toISOString(),
      },
      created: false,
      assignment: null,
      queued: conversation.status === "queued",
      duplicate: true,
      botEligible: conversation.botActive,
      policy: {
        confidenceThreshold: duplicatePolicy.confidenceThreshold,
        handoffMessage: duplicatePolicy.handoffMessage,
        liveAgentEnabled: duplicatePolicy.liveAgentEnabled,
      },
      queueProfiles,
    };
  }

  let openConversation = await findOpenSocialConversation(
    db,
    payload.organizationId,
    channel,
    providerThreadId,
  );

  if (openConversation) {
    const expired = await expireIdleSocialBotSessionIfNeeded(db, payload.organizationId, {
      id: openConversation.id,
      channel: openConversation.channel,
      status: openConversation.status,
      botActive: openConversation.bot_active,
      updatedAt: openConversation.updated_at,
      channelConfigId: openConversation.channel_config_id,
    });
    if (expired) {
      openConversation = null;
    }
  }

  let conversationId = openConversation?.id ?? null;
  let created = false;
  const policy = await resolveChannelPolicy(db, payload.organizationId, {
    channelConfigId: payload.channelConfigId,
    channel,
  });
  const botEnabled = policy.botEnabled;
  const queueProfiles = toQueueProfiles(
    await listActiveQueuesForChannel(db, payload.organizationId, channel),
  );
  const queueId =
    openConversation?.queue_id ??
    (await resolveHandoffQueue(db, payload.organizationId, channel, {
      selectedQueueKey: policy.defaultQueueId,
    }));

  if (!openConversation) {
    const previousConversationId = await findPreviousClosedSocialConversation(
      db,
      payload.organizationId,
      channel,
      providerThreadId,
    );
    const sessionExternalThreadId = buildSocialSessionExternalThreadId(channel);
    const subject = payload.customerName?.trim() || defaultSubject;

    const inserted = await db.$queryRaw<ConversationRow[]>`
      INSERT INTO ccass.conversations (
        organization_id,
        channel,
        external_thread_id,
        provider_thread_id,
        previous_conversation_id,
        visitor_id,
        subject,
        queue_id,
        channel_config_id,
        status,
        lifecycle_state,
        queued_at,
        bot_active,
        nlp_enabled,
        live_agent_enabled
      ) VALUES (
        ${payload.organizationId}::bigint,
        ${channel},
        ${sessionExternalThreadId},
        ${providerThreadId},
        ${previousConversationId}::bigint,
        ${payload.customerRef},
        ${subject},
        ${queueId}::bigint,
        ${payload.channelConfigId}::bigint,
        ${botEnabled ? "bot_active" : "queued"},
        ${botEnabled ? "bot" : "waiting"},
        ${botEnabled ? null : new Date()},
        ${botEnabled},
        ${botEnabled},
        TRUE
      )
      RETURNING
        id,
        organization_id,
        channel,
        external_thread_id,
        provider_thread_id,
        visitor_id,
        subject,
        status,
        queue_id,
        channel_config_id,
        bot_active,
        updated_at
    `;
    conversationId = inserted[0]?.id ?? null;
    if (!conversationId) {
      throw Object.assign(new Error("Social conversation insert did not return id"), { status: 500 });
    }
    created = true;

    if (botEnabled) {
      await ensureNlpConversation(db, payload.organizationId, conversationId, `${channel}_bot`);
    }

    await db.$executeRaw`
      INSERT INTO ccass.conversation_participants (
        organization_id, conversation_id, participant_type, identity_ref
      )
      SELECT
        ${payload.organizationId}::bigint,
        ${conversationId}::bigint,
        'customer',
        ${payload.customerRef}
      WHERE NOT EXISTS (
        SELECT 1
        FROM ccass.conversation_participants
        WHERE conversation_id = ${conversationId}::bigint
          AND participant_type = 'customer'
          AND identity_ref = ${payload.customerRef}
      )
    `;
  } else if (!openConversation.queue_id && queueId) {
    await db.$executeRaw`
      UPDATE ccass.conversations
      SET
        queue_id = ${queueId}::bigint,
        channel_config_id = COALESCE(channel_config_id, ${payload.channelConfigId}::bigint),
        queued_at = COALESCE(queued_at, NOW()),
        updated_at = NOW()
      WHERE id = ${conversationId}::bigint
        AND organization_id = ${payload.organizationId}::bigint
    `;
  } else {
    await db.$executeRaw`
      UPDATE ccass.conversations
      SET
        channel_config_id = COALESCE(channel_config_id, ${payload.channelConfigId}::bigint),
        updated_at = NOW()
      WHERE id = ${conversationId}::bigint
        AND organization_id = ${payload.organizationId}::bigint
    `;
  }

  if (!conversationId) {
    throw Object.assign(new Error("Social conversation id missing after ingest"), { status: 500 });
  }

  await resolveInboundConversationContact(db, payload.organizationId, conversationId, {
    channel,
    phone: channel === "whatsapp" ? payload.customerRef : undefined,
    // Instagram / Facebook customerRefs are PSIDs/IGSIDs (same role as WhatsApp phone).
    visitorId: payload.customerRef,
    displayName: payload.customerName ?? undefined,
  });

  await syncSocialConversationSubject(db, payload.organizationId, conversationId, {
    channel,
    channelDisplayName: payload.customerName,
    visitorId: payload.customerRef,
  });

  const { message } = await appendConversationMessage(
    db,
    payload.organizationId,
    conversationId,
    {
      externalId: payload.externalMessageId,
      senderType: "customer",
      direction: "inbound",
      visibility: "customer",
      body: payload.body,
      modelMetadata: {
        customerName: payload.customerName ?? null,
        messageType: payload.messageType ?? "text",
        phoneNumberId: payload.phoneNumberId ?? null,
        pageId: payload.pageId ?? null,
        igBusinessAccountId: payload.igBusinessAccountId ?? null,
        occurredAt: payload.occurredAt,
        metadata: payload.metadata ?? {},
      },
    },
    { deferProjection: true, deferContactEnrichment: true },
  );

  let conversation = await getConversation(db, payload.organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Social conversation not found after ingest"), { status: 500 });
  }

  let assignment: { agentId: string; userId: string } | null = null;
  if (conversation.status === "queued" && conversation.queueId && !conversation.botActive) {
    const reconciled = await reconcilePolicyChange(db, payload.organizationId, conversationId, {
      botEnabled: policy.botEnabled,
      liveAgentEnabled: policy.liveAgentEnabled,
    });
    if (reconciled?.changed) {
      conversation = (await getConversation(db, payload.organizationId, conversationId)) ?? conversation;
    } else if (!botEnabled || conversation.assignedAgentId) {
      const routed = await routeConversationToAgent(
        db,
        payload.organizationId,
        conversationId,
        conversation.queueId,
        {
          channel: toRoutableSocialChannel(channel),
          reason: created ? `${channel}_ingest` : `${channel}_follow_up`,
        },
      );
      if (routed.assigned && routed.agentId && routed.userId) {
        assignment = { agentId: routed.agentId, userId: routed.userId };
      }
      conversation = (await getConversation(db, payload.organizationId, conversationId)) ?? conversation;
    }
  }

  await projectInteractionEvent(db, payload.organizationId, {
    conversationId,
    messageId: message.id,
    eventType: created ? "conversation.started" : "message.created",
    metadata: {
      channel,
      customerRef: payload.customerRef,
      senderType: "customer",
      direction: "inbound",
    },
  });

  return {
    conversation,
    message,
    created,
    assignment,
    queued: conversation.status === "queued",
    duplicate: false,
    botEligible: conversation.botActive,
    policy: {
      confidenceThreshold: policy.confidenceThreshold,
      handoffMessage: policy.handoffMessage,
      liveAgentEnabled: policy.liveAgentEnabled,
    },
    queueProfiles,
  };
}
