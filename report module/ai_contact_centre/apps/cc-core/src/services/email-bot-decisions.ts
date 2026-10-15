import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import { appendConversationMessage, getConversation } from "./conversations.js";
import { urgencyToPriority } from "./email-priority.js";
import { recordNlpTurn } from "./nlp-conversations.js";
import { resolveEmailMailboxPolicy, toEmailMailboxPolicy } from "./email-policies.js";
import { entityIdSchema, serializeEntityIdOptional } from "../lib/id-schema.js";

const optionalCapturedEmailSchema = z.preprocess(
  (value) => {
    if (value == null) return null;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return z.string().email().safeParse(trimmed).success ? trimmed : null;
  },
  z.string().email().nullable().optional(),
);

export const commitEmailBotDecisionSchema = z.object({
  customerMessageId: entityIdSchema,
  customerText: z.string().min(1),
  reply: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  grounded: z.boolean(),
  intent: z.string().max(128).nullable(),
  selectedQueueKey: entityIdSchema.nullable(),
  candidateSkills: z.array(z.string().max(128)).max(50),
  summary: z.string().max(2000).nullable(),
  sentiment: z.string().max(50).nullable(),
  importantFacts: z.array(z.string().max(300)).max(20),
  knowledgeUsed: z.array(z.string().max(300)).max(20),
  contactEntities: z
    .object({
      email: optionalCapturedEmailSchema,
      phone: z.string().max(50).nullable().optional(),
      displayName: z.string().max(200).nullable().optional(),
      company: z.string().max(200).nullable().optional(),
      city: z.string().max(160).nullable().optional(),
      country: z.string().max(160).nullable().optional(),
    })
    .optional(),
  handoffRecommended: z.boolean(),
  handoffReason: z.string().max(128).nullable(),
  guardPassed: z.boolean(),
  guardReasons: z.array(z.string().max(300)).max(20),
  urgency: z.enum(["normal", "high", "critical"]).default("normal"),
  traceId: z.string().max(128).nullable(),
  modelName: z.string().max(128),
  latencyMs: z.number().int().min(0).max(300_000).optional(),
  queueProfileVersion: z.string().max(64).nullable(),
  delivery: z
    .object({
      connectionId: entityIdSchema,
      recipientEmail: z.string().email(),
      subject: z.string().min(1).max(512),
      providerThreadId: z.string().max(255),
      inReplyTo: z.string().max(998).nullable(),
      references: z.string().max(8000).nullable(),
    })
    .nullable(),
});

export async function commitEmailBotDecision(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  input: z.infer<typeof commitEmailBotDecisionSchema>,
): Promise<{
  acceptedForDelivery: boolean;
  messageId: string | null;
  deliveryId: string | null;
  deliveryStatus: string | null;
}> {
  const payload = commitEmailBotDecisionSchema.parse(input);
  await db.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${payload.customerMessageId}, 0))
  `;
  const existingRows = await db.$queryRaw<
    Array<{ message_id: string | null; delivery_id: string | null; delivery_status: string | null }>
  >`
    SELECT
      turn.bot_message_id AS message_id,
      delivery.id AS delivery_id,
      delivery.status AS delivery_status
    FROM ccass.nlp_turns turn
    LEFT JOIN ccass.email_delivery_outbox delivery
      ON delivery.source_message_id = turn.customer_message_id
      AND delivery.organization_id = turn.organization_id
    WHERE turn.organization_id = ${organizationId}::bigint
      AND turn.conversation_id = ${conversationId}::bigint
      AND turn.customer_message_id = ${payload.customerMessageId}::bigint
    ORDER BY turn.created_at DESC
    LIMIT 1
  `;
  if (existingRows[0]) {
    return {
      acceptedForDelivery: Boolean(existingRows[0].delivery_id),
      messageId: serializeEntityIdOptional(existingRows[0].message_id),
      deliveryId: serializeEntityIdOptional(existingRows[0].delivery_id),
      deliveryStatus: existingRows[0].delivery_status,
    };
  }
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation || conversation.channel !== "email") {
    throw Object.assign(new Error("Email conversation not found"), { status: 404 });
  }

  const policyRows = await db.$queryRaw<
    Array<{
      bot_enabled: boolean;
      auto_send_enabled: boolean;
      shadow_mode: boolean;
      confidence_threshold: unknown;
    }>
  >`
    SELECT bot_enabled, auto_send_enabled, shadow_mode, confidence_threshold
    FROM ccass.email_mailbox_policies
    WHERE organization_id = ${organizationId}::bigint
      AND connection_id = ${payload.delivery?.connectionId ?? null}::bigint
      AND status = 'active'
    LIMIT 1
  `;
  const persistedPolicy = policyRows[0];
  let channelPolicy = null;
  if (payload.delivery?.connectionId) {
    const mailboxRows = await db.$queryRaw<{ account_email: string | null }[]>`
      SELECT COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email
      FROM accounts.setup_email_configs ec
      LEFT JOIN accounts.mail_oauth_connections oauth ON oauth.id = ec.oauth_connection_id
      WHERE ec.channel_config_id = ${payload.delivery.connectionId}::bigint
      LIMIT 1
    `;
    const accountEmail = mailboxRows[0]?.account_email;
    if (accountEmail) {
      const resolvedPolicy = await resolveEmailMailboxPolicy(db, organizationId, {
        connectionId: payload.delivery.connectionId,
        accountEmail,
      });
      channelPolicy = toEmailMailboxPolicy(resolvedPolicy);
    }
  }
  const policy = persistedPolicy ?? (channelPolicy
    ? {
        bot_enabled: channelPolicy.botEnabled,
        auto_send_enabled: channelPolicy.autoSendEnabled,
        shadow_mode: channelPolicy.shadowMode,
        confidence_threshold: channelPolicy.confidenceThreshold,
      }
    : null);
  const acceptedForDelivery = Boolean(
    payload.delivery &&
      payload.reply &&
      policy?.bot_enabled &&
      policy.auto_send_enabled &&
      !policy.shadow_mode &&
      conversation.botActive &&
      conversation.status === "bot_active" &&
      !payload.handoffRecommended &&
      payload.grounded &&
      payload.guardPassed &&
      payload.confidence >= Number(policy.confidence_threshold),
  );

  let messageId: string | null = null;
  let deliveryId: string | null = null;
  if (acceptedForDelivery && payload.delivery && payload.reply) {
    const result = await appendConversationMessage(
      db,
      organizationId,
      conversationId,
      {
        senderType: "bot",
        direction: "outbound",
        visibility: "customer",
        body: payload.reply,
        modelMetadata: {
          runtimeType: "email_bot",
          grounded: payload.grounded,
          guardPassed: payload.guardPassed,
          knowledgeReferences: payload.knowledgeUsed,
          traceId: payload.traceId,
          deliveryStatus: "pending",
        },
      },
      { deferProjection: true },
    );
    messageId = result.message.id;
    const deliveryRows = await db.$queryRaw<{ id: string | bigint }[]>`
      INSERT INTO ccass.email_delivery_outbox (
        organization_id, conversation_id, message_id, source_message_id, connection_id,
        recipient_email, subject, provider_thread_id, in_reply_to, references_header,
        next_attempt_at
      ) VALUES (
        ${organizationId}::bigint,
        ${conversationId}::bigint,
        ${messageId}::bigint,
        ${payload.customerMessageId}::bigint,
        ${payload.delivery.connectionId}::bigint,
        ${payload.delivery.recipientEmail},
        ${payload.delivery.subject},
        ${payload.delivery.providerThreadId},
        ${payload.delivery.inReplyTo},
        ${payload.delivery.references},
        NOW() + INTERVAL '30 seconds'
      )
      ON CONFLICT (organization_id, source_message_id) DO UPDATE
      SET updated_at = NOW()
      RETURNING id
    `;
    deliveryId = serializeEntityIdOptional(deliveryRows[0]?.id) ?? null;
  }

  await recordNlpTurn(db, organizationId, conversationId, {
    customerText: payload.customerText,
    customerMessageId: payload.customerMessageId,
    botReply: acceptedForDelivery ? (payload.reply ?? undefined) : undefined,
    botMessageId: messageId ?? undefined,
    confidence: payload.confidence,
    intent: payload.intent ?? undefined,
    candidateSkills: payload.candidateSkills,
    summary: payload.summary,
    sentiment: payload.sentiment,
    importantFacts: payload.importantFacts,
    knowledgeUsed: payload.knowledgeUsed,
    contactEntities: payload.contactEntities,
    handoffRecommended: payload.handoffRecommended || !acceptedForDelivery,
    handoffReason: payload.handoffReason ?? (!acceptedForDelivery ? "auto_send_gate" : undefined),
    modelName: payload.modelName,
    latencyMs: payload.latencyMs,
    traceId: payload.traceId ?? undefined,
    runtimeType: "email_bot",
    selectedQueueKey: payload.selectedQueueKey,
    queueProfileVersion: payload.queueProfileVersion,
    grounded: payload.grounded,
    guardPassed: payload.guardPassed,
    guardReasons: payload.guardReasons,
    knowledgeReferences: payload.knowledgeUsed,
    deliveryMessageId: deliveryId,
  });

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET priority = ${urgencyToPriority(payload.urgency)}, updated_at = NOW()
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
  `;

  return {
    acceptedForDelivery,
    messageId: serializeEntityIdOptional(messageId),
    deliveryId: serializeEntityIdOptional(deliveryId),
    deliveryStatus: deliveryId ? "pending" : null,
  };
}

export const updateEmailDeliverySchema = z.object({
  status: z.enum(["sent", "retry", "failed", "bounced"]),
  providerMessageId: z.string().max(255).nullable().optional(),
  providerRfcMessageId: z.string().max(998).nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
  retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
});

export async function updateEmailDelivery(
  db: DbClient,
  organizationId: string,
  deliveryId: string,
  input: z.infer<typeof updateEmailDeliverySchema>,
): Promise<boolean> {
  const payload = updateEmailDeliverySchema.parse(input);
  const rows = await db.$queryRaw<{ message_id: string }[]>`
    UPDATE ccass.email_delivery_outbox
    SET
      status = ${payload.status},
      attempt_count = attempt_count + 1,
      provider_message_id = COALESCE(${payload.providerMessageId ?? null}, provider_message_id),
      provider_rfc_message_id = COALESCE(
        ${payload.providerRfcMessageId ?? null},
        provider_rfc_message_id
      ),
      last_error = ${payload.error ?? null},
      next_attempt_at = CASE
        WHEN ${payload.status} = 'retry'
          THEN NOW() + (${payload.retryAfterSeconds ?? 60} * INTERVAL '1 second')
        ELSE next_attempt_at
      END,
      delivered_at = CASE WHEN ${payload.status} = 'sent' THEN NOW() ELSE delivered_at END,
      updated_at = NOW()
    WHERE id = ${deliveryId}::bigint
      AND organization_id = ${organizationId}::bigint
    RETURNING message_id
  `;
  if (!rows[0]) return false;
  await db.$executeRaw`
    UPDATE ccass.conversation_messages
    SET
      model_metadata = model_metadata || ${JSON.stringify({
        deliveryStatus: payload.status,
        providerMessageId: payload.providerMessageId ?? undefined,
        providerRfcMessageId: payload.providerRfcMessageId ?? undefined,
      })}::jsonb
    WHERE id = ${rows[0].message_id}::bigint
      AND organization_id = ${organizationId}::bigint
  `;
  return true;
}

export async function claimDueEmailDeliveries(
  db: DbClient,
  limit = 10,
): Promise<
  Array<{
    id: string;
    organizationId: string;
    connectionId: string;
    recipientEmail: string;
    subject: string;
    providerThreadId: string | null;
    inReplyTo: string | null;
    references: string | null;
    body: string;
    attemptCount: number;
  }>
> {
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      organization_id: string;
      connection_id: string;
      recipient_email: string;
      subject: string;
      provider_thread_id: string | null;
      in_reply_to: string | null;
      references_header: string | null;
      body: string;
      attempt_count: number;
    }>
  >`
    WITH due AS (
      SELECT delivery.id
      FROM ccass.email_delivery_outbox delivery
      WHERE delivery.status IN ('pending', 'retry')
        AND delivery.next_attempt_at <= NOW()
        AND delivery.attempt_count < 5
      ORDER BY delivery.next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${Math.min(Math.max(limit, 1), 50)}
    )
    UPDATE ccass.email_delivery_outbox delivery
    SET status = 'processing', updated_at = NOW()
    FROM due, ccass.conversation_messages message
    WHERE delivery.id = due.id
      AND message.id = delivery.message_id
    RETURNING
      delivery.id,
      delivery.organization_id,
      delivery.connection_id,
      delivery.recipient_email,
      delivery.subject,
      delivery.provider_thread_id,
      delivery.in_reply_to,
      delivery.references_header,
      message.body,
      delivery.attempt_count
  `;
  return rows.map((row) => ({
    id: serializeEntityIdOptional(row.id)!,
    organizationId: serializeEntityIdOptional(row.organization_id)!,
    connectionId: serializeEntityIdOptional(row.connection_id)!,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    providerThreadId: row.provider_thread_id,
    inReplyTo: row.in_reply_to,
    references: row.references_header,
    body: row.body,
    attemptCount: row.attempt_count,
  }));
}

