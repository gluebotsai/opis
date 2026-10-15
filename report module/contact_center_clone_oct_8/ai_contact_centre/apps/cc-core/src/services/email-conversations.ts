import { z } from "zod";

import { createEmailProcessLog } from "@ai-contact-center/observability";
import type { DbClient } from "../lib/rls.js";
import { channelConfigIdFromMailbox } from "./channel-config-id.js";
import { projectInteractionEvent } from "./cdp-projection.js";
import { resolveInboundConversationContact } from "./contact-identity.js";
import {
  resolveEmailMailboxPolicy,
  resolveEmailHandoffQueueId,
  toEmailMailboxPolicy,
  getEmailTenantContext,
  listEmailQueueProfiles,
  type EmailMailboxPolicy,
  type EmailQueueProfile,
  type EmailTenantContext,
} from "./email-policies.js";
import {
  appendConversationMessage,
  addMessageAttachmentMetadata,
  getConversation,
  type ConversationRecord,
  type MessageRecord,
} from "./conversations.js";
import { ensureNlpConversation } from "./nlp-conversations.js";
import { classifyEmailPriority } from "./nlp-email-client.js";
import { urgencyToPriority } from "./email-priority.js";
import { preemptAndRouteEmail, routeConversationToAgent } from "./routing.js";
import { entityIdSchema, serializeEntityIdOptional } from "../lib/id-schema.js";

const ingestInboundEmailSchema = z.object({
  organizationId: entityIdSchema,
  externalThreadId: z.string().min(1).max(128),
  externalMessageId: z.string().min(1).max(128),
  customerEmail: z.string().email(),
  customerName: z.string().optional().nullable(),
  subject: z.string().min(1).max(512),
  body: z.string().min(1).max(200_000),
  occurredAt: z.string().datetime(),
  mailboxConnectionId: entityIdSchema.optional(),
  mailboxEmail: z.string().email().optional(),
  rfcMessageId: z.string().max(998).optional().nullable(),
  inReplyTo: z.string().max(998).optional().nullable(),
  references: z.string().max(8000).optional().nullable(),
  providerHeaders: z.record(z.string().max(128), z.string().max(8_000)).optional(),
  attachments: z
    .array(
      z.object({
        attachmentId: z.string().max(1024).nullable(),
        fileName: z.string().min(1).max(512),
        contentType: z.string().min(1).max(255),
        byteSize: z.number().int().min(0).max(25 * 1024 * 1024),
        storageKey: z.string().min(1).max(2048).optional(),
      }),
    )
    .max(20)
    .optional(),
}).refine(
  (value) =>
    (value.attachments ?? []).reduce((total, attachment) => total + attachment.byteSize, 0) <=
    25 * 1024 * 1024,
  "Total attachment size exceeds 25 MB",
);

type ConversationRowRaw = {
  id: string | bigint;
  organization_id: string | bigint;
  channel: string;
  external_thread_id: string;
  provider_thread_id: string | null;
  visitor_id: string | null;
  subject: string | null;
  status: string;
  queue_id: string | bigint | null;
};

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
};

function mapConversationRow(row: ConversationRowRaw): ConversationRow {
  return {
    ...row,
    id: serializeEntityIdOptional(row.id)!,
    organization_id: serializeEntityIdOptional(row.organization_id)!,
    queue_id: serializeEntityIdOptional(row.queue_id),
  };
}

async function resolveEmailQueue(db: DbClient, organizationId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string | bigint }[]>`
    SELECT q.id
    FROM ccass.queues q
    INNER JOIN ccass.queue_members qm ON qm.queue_id = q.id
    WHERE q.organization_id = ${organizationId}::bigint
      AND q.status = 'active'
      AND qm.handles_email = TRUE
    GROUP BY q.id, q.published_at
    ORDER BY q.published_at ASC, q.id ASC
    LIMIT 1
  `;
  return serializeEntityIdOptional(rows[0]?.id);
}

async function findOpenEmailConversation(
  db: DbClient,
  organizationId: string,
  customerEmail: string,
  providerThreadId: string,
  mailboxConnectionId?: string | null,
): Promise<ConversationRow | null> {
  const rows = await db.$queryRaw<ConversationRowRaw[]>`
    SELECT id, organization_id, channel, external_thread_id, provider_thread_id, visitor_id, subject, status, queue_id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel = 'email'
      AND provider_thread_id = ${providerThreadId}
      AND lower(visitor_id) = lower(${customerEmail})
      AND mailbox_connection_id IS NOT DISTINCT FROM ${mailboxConnectionId ?? null}::bigint
      AND status NOT IN ('resolved', 'closed')
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] ? mapConversationRow(rows[0]) : null;
}

async function findPreviousClosedEmailConversation(
  db: DbClient,
  organizationId: string,
  customerEmail: string,
  mailboxConnectionId?: string | null,
): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string | bigint }[]>`
    SELECT id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel = 'email'
      AND lower(visitor_id) = lower(${customerEmail})
      AND mailbox_connection_id IS NOT DISTINCT FROM ${mailboxConnectionId ?? null}::bigint
      AND status IN ('resolved', 'closed')
    ORDER BY ended_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  return serializeEntityIdOptional(rows[0]?.id);
}

export async function ingestInboundEmailConversation(
  db: DbClient,
  input: z.infer<typeof ingestInboundEmailSchema>,
): Promise<{
  conversation: ConversationRecord;
  message: MessageRecord;
  created: boolean;
  assignment: { agentId: string; userId: string } | null;
  queued: boolean;
  duplicate: boolean;
  automation: {
    policy: EmailMailboxPolicy | null;
    queueProfiles: EmailQueueProfile[];
    tenantContext: EmailTenantContext;
  };
}> {
  const payload = ingestInboundEmailSchema.parse(input);
  const providerThreadId = payload.externalThreadId;
  const customerEmail = payload.customerEmail.toLowerCase();
  const mailboxEmail = payload.mailboxEmail ?? "";
  const processLog = createEmailProcessLog({
    organizationId: payload.organizationId,
    from: customerEmail,
    to: mailboxEmail || "unknown",
    mail: payload.body,
    subject: payload.subject,
    messageId: payload.externalMessageId,
  });
  processLog.step("ingest_started");
  const resolvedPolicy = mailboxEmail
    ? await resolveEmailMailboxPolicy(db, payload.organizationId, {
        connectionId: payload.mailboxConnectionId,
        accountEmail: mailboxEmail,
      })
    : null;
  const policy = toEmailMailboxPolicy(resolvedPolicy);
  const queueProfiles = await listEmailQueueProfiles(
    db,
    payload.organizationId,
    policy?.allowedQueueIds ?? [],
  );
  const tenantContext = await getEmailTenantContext(db, payload.organizationId);
  const automationEnabled = Boolean(
    policy?.botEnabled && !policy.shadowMode && policy.autoSendEnabled,
  );
  processLog.step("mailbox_policy_resolved", {
    botEnabled: policy?.botEnabled ?? false,
    liveAgentEnabled: policy?.liveAgentEnabled ?? true,
    shadowMode: policy?.shadowMode ?? true,
    autoSendEnabled: policy?.autoSendEnabled ?? false,
    automationEnabled,
  });

  // Serialize one Gmail thread. Overlapping Pub/Sub notifications for that
  // thread must not both miss the open conversation and insert a second one.
  const conversationLockKey = [
    "email-conversation",
    payload.organizationId,
    payload.mailboxConnectionId ?? "mailbox",
    providerThreadId,
  ].join(":");
  await db.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${conversationLockKey}, 0))
  `;

  const eventRows = await db.$queryRaw<{ status: string; is_new: boolean }[]>`
    INSERT INTO ccass.email_provider_events (
      organization_id, connection_id, provider, event_id, mailbox_email, status
    ) VALUES (
      ${payload.organizationId}::bigint,
      ${payload.mailboxConnectionId ?? null}::bigint,
      'gmail',
      ${payload.externalMessageId},
      ${mailboxEmail || "unknown"},
      'processing'
    )
    ON CONFLICT (organization_id, provider, event_id) DO UPDATE
    SET
      attempt_count = ccass.email_provider_events.attempt_count + 1,
      updated_at = NOW()
    RETURNING status, (xmax = 0) AS is_new
  `;
  const duplicate = eventRows[0]?.status === "processed";

  if (duplicate) {
    processLog.step("duplicate_detected");
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
        throw Object.assign(new Error("Duplicate email event without conversation"), { status: 500 });
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
        throw Object.assign(new Error("Duplicate email event without message"), { status: 500 });
      }
      processLog.complete({ duplicate: true, conversationId: conversation.id });
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
        automation: { policy, queueProfiles, tenantContext },
      };
    }
  }

  const openConversation = await findOpenEmailConversation(
    db,
    payload.organizationId,
    customerEmail,
    providerThreadId,
    payload.mailboxConnectionId,
  );

  let conversationId = openConversation?.id ?? null;
  let created = false;
  const queueId =
    (await resolveEmailHandoffQueueId(db, payload.organizationId, {
      mailboxConnectionId: payload.mailboxConnectionId ?? null,
      preferredQueueId: openConversation?.queue_id ?? null,
      allowedQueueIds: policy?.allowedQueueIds ?? [],
      defaultQueueId: policy?.defaultQueueId ?? null,
    })) ?? (await resolveEmailQueue(db, payload.organizationId));

  if (!openConversation) {
    const previousConversationId = await findPreviousClosedEmailConversation(
      db,
      payload.organizationId,
      customerEmail,
      payload.mailboxConnectionId,
    );
    // external_thread_id is unique for the lifetime of the database. A closed
    // conversation already owns the legacy email:<address> value, so give each
    // newly opened lifecycle a unique key. Follow-up messages still reuse the
    // open conversation selected above.
    const sessionExternalThreadId = [
      "email",
      payload.mailboxConnectionId ?? "mailbox",
      customerEmail,
      payload.externalMessageId,
    ].join(":");

    const emailChannelConfigId = channelConfigIdFromMailbox(payload.mailboxConnectionId);

    const inserted = await db.$queryRaw<ConversationRowRaw[]>`
      INSERT INTO ccass.conversations (
        organization_id,
        channel,
        external_thread_id,
        provider_thread_id,
        previous_conversation_id,
        visitor_id,
        subject,
        queue_id,
        status,
        lifecycle_state,
        queued_at,
        bot_active,
        nlp_enabled,
        live_agent_enabled,
        mailbox_connection_id,
        channel_config_id,
        automation_policy_version
      ) VALUES (
        ${payload.organizationId}::bigint,
        'email',
        ${sessionExternalThreadId},
        ${providerThreadId},
        ${previousConversationId}::bigint,
        ${customerEmail},
        ${payload.subject},
        ${queueId}::bigint,
        ${automationEnabled ? "bot_active" : "queued"},
        ${automationEnabled ? "bot" : "waiting"},
        ${automationEnabled ? null : new Date()},
        ${automationEnabled},
        ${Boolean(policy?.botEnabled)},
        ${policy?.liveAgentEnabled ?? true},
        ${payload.mailboxConnectionId ?? null}::bigint,
        ${emailChannelConfigId}::bigint,
        ${policy?.policyVersion ?? null}
      )
      RETURNING id, organization_id, channel, external_thread_id, provider_thread_id, visitor_id, subject, status, queue_id
    `;
    conversationId = serializeEntityIdOptional(inserted[0]?.id) ?? null;
    if (!conversationId) {
      throw Object.assign(new Error("Email conversation insert did not return id"), { status: 500 });
    }
    created = true;
    processLog.step("conversation_created", { conversationId, queueId, status: automationEnabled ? "bot_active" : "queued" });

    await db.$executeRaw`
      INSERT INTO ccass.conversation_participants (
        organization_id, conversation_id, participant_type, identity_ref
      )
      SELECT
        ${payload.organizationId}::bigint,
        ${conversationId}::bigint,
        'customer',
        ${customerEmail}
      WHERE NOT EXISTS (
        SELECT 1
        FROM ccass.conversation_participants
        WHERE conversation_id = ${conversationId}::bigint
          AND participant_type = 'customer'
          AND identity_ref = ${customerEmail}
      )
    `;
  } else {
    await db.$executeRaw`
      UPDATE ccass.conversations
      SET
        provider_thread_id = COALESCE(provider_thread_id, ${providerThreadId}),
        subject = COALESCE(subject, ${payload.subject}),
        queue_id = COALESCE(queue_id, ${queueId}::bigint),
        channel_config_id = COALESCE(
          channel_config_id,
          ${channelConfigIdFromMailbox(payload.mailboxConnectionId)}::bigint
        ),
        queued_at = CASE WHEN status = 'queued' THEN COALESCE(queued_at, NOW()) ELSE queued_at END,
        updated_at = NOW()
      WHERE id = ${conversationId}::bigint
        AND organization_id = ${payload.organizationId}::bigint
    `;
    processLog.step("conversation_reused", { conversationId, status: openConversation.status });
  }

  if (!conversationId) {
    throw Object.assign(new Error("Email conversation id missing after ingest"), { status: 500 });
  }

  await resolveInboundConversationContact(db, payload.organizationId, conversationId, {
    channel: "email",
    email: customerEmail,
    displayName: payload.customerName ?? undefined,
  });
  processLog.step("contact_resolved", { conversationId });

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
        subject: payload.subject,
        customerName: payload.customerName ?? null,
        occurredAt: payload.occurredAt,
      },
    },
    { deferProjection: true },
  );
  processLog.step("message_stored", { messageId: message.id, conversationId });

  await db.$executeRaw`
    UPDATE ccass.conversation_messages
    SET
      rfc_message_id = COALESCE(${payload.rfcMessageId ?? null}, rfc_message_id),
      in_reply_to = COALESCE(${payload.inReplyTo ?? null}, in_reply_to),
      references_header = COALESCE(${payload.references ?? null}, references_header),
      provider_received_at = COALESCE(${new Date(payload.occurredAt)}, provider_received_at),
      provider_headers = provider_headers || ${JSON.stringify(payload.providerHeaders ?? {})}::jsonb
    WHERE id = ${message.id}::bigint
      AND organization_id = ${payload.organizationId}::bigint
  `;

  for (const attachment of payload.attachments ?? []) {
    await addMessageAttachmentMetadata(
      db,
      payload.organizationId,
      conversationId,
      message.id,
      {
        externalId: attachment.attachmentId?.slice(0, 128),
        storageKey:
          attachment.storageKey ??
          `gmail://${providerThreadId}/${payload.externalMessageId}/${encodeURIComponent(attachment.fileName)}`,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
        status: attachment.storageKey ? "available" : "pending",
        metadata: {
          provider: "gmail",
          scanState: attachment.storageKey ? "available" : "pending",
          providerAttachmentId: attachment.attachmentId,
        },
      },
    );
  }

  let conversation = await getConversation(db, payload.organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Email conversation not found after ingest"), { status: 500 });
  }

  let assignment: { agentId: string; userId: string } | null = null;
  if (!duplicate && conversation.status === "queued" && conversation.queueId) {
    let priority = 0;
    if (!policy?.botEnabled || policy.shadowMode) {
      const urgency = await classifyEmailPriority({
        organizationId: payload.organizationId,
        conversationId,
        subject: payload.subject,
        message: payload.body,
      });
      priority = urgencyToPriority(urgency);
      processLog.step("priority_classified", { urgency, priority });
      await db.$executeRaw`
        UPDATE ccass.conversations
        SET priority = ${priority}, updated_at = NOW()
        WHERE id = ${conversationId}::bigint
          AND organization_id = ${payload.organizationId}::bigint
      `;
    }

    const routed = await routeConversationToAgent(
      db,
      payload.organizationId,
      conversationId,
      conversation.queueId,
      { channel: "email", reason: created ? "email_ingest" : "email_follow_up" },
    );
    if (routed.assigned && routed.agentId && routed.userId) {
      assignment = { agentId: routed.agentId, userId: routed.userId };
      processLog.step("agent_assigned", {
        agentId: routed.agentId,
        userId: routed.userId,
        queueId: conversation.queueId,
      });
    } else if (priority >= 1) {
      processLog.step("routing_queued", { queueId: conversation.queueId, priority });
      const preempted = await preemptAndRouteEmail(
        db,
        payload.organizationId,
        conversationId,
        conversation.queueId,
        priority,
      );
      if (preempted.assigned && preempted.agentId && preempted.userId) {
        assignment = { agentId: preempted.agentId, userId: preempted.userId };
        processLog.step("priority_preemption_assigned", {
          agentId: preempted.agentId,
          userId: preempted.userId,
          priority,
        });
      }
    } else {
      processLog.step("routing_queued", { queueId: conversation.queueId });
    }
    conversation = (await getConversation(db, payload.organizationId, conversationId)) ?? conversation;
  }

  if (!duplicate && conversation.botActive && policy?.botEnabled) {
    await ensureNlpConversation(db, payload.organizationId, conversationId, "email_bot");
    processLog.step("nlp_session_ready", { conversationId });
  }

  await projectInteractionEvent(db, payload.organizationId, {
    conversationId,
    messageId: message.id,
    eventType: created ? "conversation.started" : "message.created",
    metadata: {
      channel: "email",
      customerEmail,
      subject: payload.subject,
      senderType: "customer",
      direction: "inbound",
    },
  });
  processLog.step("cdp_projected", { conversationId, messageId: message.id });

  await db.$executeRaw`
    UPDATE ccass.email_provider_events
    SET status = 'processed', processed_at = NOW(), last_error = NULL, updated_at = NOW()
    WHERE organization_id = ${payload.organizationId}::bigint
      AND provider = 'gmail'
      AND event_id = ${payload.externalMessageId}
  `;

  processLog.complete({
    conversationId,
    messageId: message.id,
    created,
    duplicate,
    status: conversation.status,
    botActive: conversation.botActive,
    assigned: Boolean(assignment),
  });

  return {
    conversation,
    message,
    created,
    assignment,
    queued: conversation.status === "queued",
    duplicate,
    automation: { policy, queueProfiles, tenantContext },
  };
}

export { ingestInboundEmailSchema };
