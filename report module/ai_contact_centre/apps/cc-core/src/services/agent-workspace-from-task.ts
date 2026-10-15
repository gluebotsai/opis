import { randomUUID } from "node:crypto";

import { isCallChannel } from "../lib/channels.js";
import type { DbClient } from "../lib/rls.js";
import { serializeEntityId } from "../lib/id-schema.js";
import {
  getConversation,
  type ConversationRecord,
} from "./conversations.js";
import { getAgentTask } from "./agent-tasks.js";
import { setAgentPresenceByAgentId } from "./presence.js";
import { toRoutableChannel } from "./routing.js";

type OpenWorkspaceResult = {
  conversation: ConversationRecord;
  created: boolean;
};

async function getAgentForUser(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<{ id: string }> {
  const agentRows = await db.$queryRaw<{ id: string | bigint }[]>`
    SELECT id FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint AND setup_user_id = ${userId}::bigint
    LIMIT 1
  `;
  const agent = agentRows[0];
  if (!agent) {
    throw Object.assign(new Error("Agent profile not found"), { status: 403 });
  }
  return { id: serializeEntityId(agent.id) };
}

function isClosedStatus(status: string): boolean {
  return status === "resolved" || status === "closed";
}

async function findOpenConversationForContactChannel(
  db: DbClient,
  organizationId: string,
  input: {
    contactId: string | null;
    channel: string;
    providerThreadId: string | null;
    visitorId: string | null;
    mailboxConnectionId: string | null;
    excludeConversationId?: string | null;
  },
): Promise<ConversationRecord | null> {
  const excludeId = input.excludeConversationId ?? null;

  if (input.contactId) {
    const rows = await db.$queryRaw<{ id: string | bigint }[]>`
      SELECT id
      FROM ccass.conversations
      WHERE organization_id = ${organizationId}::bigint
        AND contact_id = ${input.contactId}
        AND channel = ${input.channel}
        AND status NOT IN ('resolved', 'closed')
        AND (${excludeId}::bigint IS NULL OR id <> ${excludeId}::bigint)
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (rows[0]?.id != null) {
      return getConversation(db, organizationId, serializeEntityId(rows[0].id));
    }
  }

  if (input.providerThreadId && input.channel !== "webchat") {
    const rows = await db.$queryRaw<{ id: string | bigint }[]>`
      SELECT id
      FROM ccass.conversations
      WHERE organization_id = ${organizationId}::bigint
        AND channel = ${input.channel}
        AND provider_thread_id = ${input.providerThreadId}
        AND status NOT IN ('resolved', 'closed')
        AND (${excludeId}::bigint IS NULL OR id <> ${excludeId}::bigint)
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (rows[0]?.id != null) {
      return getConversation(db, organizationId, serializeEntityId(rows[0].id));
    }
  }

  if (input.visitorId) {
    const rows = await db.$queryRaw<{ id: string | bigint }[]>`
      SELECT id
      FROM ccass.conversations
      WHERE organization_id = ${organizationId}::bigint
        AND channel = ${input.channel}
        AND visitor_id = ${input.visitorId}
        AND status NOT IN ('resolved', 'closed')
        AND (${excludeId}::bigint IS NULL OR id <> ${excludeId}::bigint)
        AND (
          ${input.mailboxConnectionId}::bigint IS NULL
          OR mailbox_connection_id = ${input.mailboxConnectionId}::bigint
        )
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (rows[0]?.id != null) {
      return getConversation(db, organizationId, serializeEntityId(rows[0].id));
    }
  }

  return null;
}

async function assignConversationToAgent(
  db: DbClient,
  organizationId: string,
  userId: string,
  agentId: string,
  conversation: ConversationRecord,
): Promise<ConversationRecord> {
  if (conversation.assignedAgentId === agentId && conversation.status === "active") {
    return conversation;
  }

  const queueId = conversation.queueId;
  if (!queueId) {
    throw Object.assign(new Error("Conversation has no queue"), { status: 400 });
  }

  const channel = toRoutableChannel(conversation.channel);
  const capacityRows = await db.$queryRaw<{ channel_concurrency: number }[]>`
    SELECT
      CASE
        WHEN ${channel} = 'email' THEN email_concurrency
        WHEN ${channel} = 'whatsapp' THEN whatsapp_concurrency
        WHEN ${channel} = 'instagram' THEN instagram_concurrency
        WHEN ${channel} = 'facebook' THEN facebook_concurrency
        ELSE chat_concurrency
      END AS channel_concurrency
    FROM ccass.queue_members
    WHERE agent_id = ${agentId}::bigint AND queue_id = ${queueId}::bigint
    LIMIT 1
  `;
  const channelConcurrency = capacityRows[0]?.channel_concurrency ?? 1;

  const previousAgentId = conversation.assignedAgentId;
  const wasActiveWithOtherAgent =
    previousAgentId && previousAgentId !== agentId && conversation.status === "active";

  if (wasActiveWithOtherAgent) {
    await db.$executeRaw`
      UPDATE ccass.agent_capacity
      SET active_count = GREATEST(active_count - 1, 0), updated_at = NOW()
      WHERE agent_id = ${previousAgentId}::bigint
        AND channel = ${channel}
    `;
  }

  await db.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET state = 'ended', ended_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversation.id}::bigint
      AND state IN ('offered', 'accepted')
  `;

  await db.$executeRaw`
    INSERT INTO ccass.conversation_assignments (
      organization_id, conversation_id, queue_id, agent_id, state, reason, offered_at, accepted_at
    ) VALUES (
      ${organizationId}::bigint,
      ${conversation.id}::bigint,
      ${queueId}::bigint,
      ${agentId}::bigint,
      'accepted',
      'task_workspace',
      NOW(),
      NOW()
    )
  `;

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      status = 'active',
      lifecycle_state = 'connected',
      bot_active = FALSE,
      assigned_agent_id = ${agentId}::bigint,
      assigned_user_id = ${userId}::bigint,
      assigned_at = NOW(),
      updated_at = NOW()
    WHERE id = ${conversation.id}::bigint
      AND organization_id = ${organizationId}::bigint
  `;

  const alreadyCounted =
    conversation.assignedAgentId === agentId &&
    (conversation.status === "active" || conversation.status === "assigned");

  if (!alreadyCounted) {
    await db.$executeRaw`
      INSERT INTO ccass.agent_capacity (organization_id, agent_id, channel, max_concurrency, active_count)
      VALUES (${organizationId}::bigint, ${agentId}::bigint, ${channel}, ${channelConcurrency}, 1)
      ON CONFLICT (agent_id, channel) DO UPDATE
        SET
          reserved_count = GREATEST(ccass.agent_capacity.reserved_count - 1, 0),
          active_count = ccass.agent_capacity.active_count + 1,
          updated_at = NOW()
    `;
  }

  if (channel !== "email" && !isCallChannel(conversation.channel)) {
    await setAgentPresenceByAgentId(db, organizationId, agentId, "busy", {
      userId,
      source: "routing",
    });
  }

  const updated = await getConversation(db, organizationId, conversation.id);
  if (!updated) {
    throw Object.assign(new Error("Conversation not found after assignment"), { status: 500 });
  }
  return updated;
}

async function createConversationFromSource(
  db: DbClient,
  organizationId: string,
  userId: string,
  agentId: string,
  source: ConversationRecord,
): Promise<ConversationRecord> {
  const queueId = source.queueId;
  if (!queueId) {
    throw Object.assign(new Error("Source conversation has no queue"), { status: 400 });
  }

  const conversationId = randomUUID();
  const externalThreadId = conversationId;
  const subject =
    source.subject?.trim() ||
    (source.channel === "email" ? "Follow-up" : "Agent follow-up");

  await db.$executeRaw`
    INSERT INTO ccass.conversations (
      id,
      organization_id,
      channel,
      external_thread_id,
      provider_thread_id,
      previous_conversation_id,
      webchat_id,
      visitor_id,
      subject,
      queue_id,
      channel_config_id,
      mailbox_connection_id,
      contact_id,
      status,
      lifecycle_state,
      direction,
      bot_active,
      nlp_enabled,
      live_agent_enabled,
      assigned_agent_id,
      assigned_user_id,
      assigned_at
    ) VALUES (
      ${conversationId}::bigint,
      ${organizationId}::bigint,
      ${source.channel},
      ${externalThreadId},
      ${source.providerThreadId},
      ${source.id}::bigint,
      ${source.webchatId},
      ${source.visitorId},
      ${subject},
      ${queueId}::bigint,
      ${source.channelConfigId}::bigint,
      ${source.mailboxConnectionId}::bigint,
      ${source.contactId},
      'active',
      'connected',
      'outbound',
      FALSE,
      FALSE,
      ${source.liveAgentEnabled},
      ${agentId}::bigint,
      ${userId}::bigint,
      NOW()
    )
  `;

  await db.$executeRaw`
    INSERT INTO ccass.conversation_participants (
      organization_id, conversation_id, participant_type, identity_ref
    )
    SELECT
      organization_id,
      ${conversationId}::bigint,
      participant_type,
      identity_ref
    FROM ccass.conversation_participants
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${source.id}::bigint
  `;

  await db.$executeRaw`
    INSERT INTO ccass.conversation_assignments (
      organization_id, conversation_id, queue_id, agent_id, state, reason, offered_at, accepted_at
    ) VALUES (
      ${organizationId}::bigint,
      ${conversationId}::bigint,
      ${queueId}::bigint,
      ${agentId}::bigint,
      'accepted',
      'task_workspace',
      NOW(),
      NOW()
    )
  `;

  const channel = toRoutableChannel(source.channel);
  const capacityRows = await db.$queryRaw<{ channel_concurrency: number }[]>`
    SELECT
      CASE
        WHEN ${channel} = 'email' THEN email_concurrency
        WHEN ${channel} = 'whatsapp' THEN whatsapp_concurrency
        WHEN ${channel} = 'instagram' THEN instagram_concurrency
        WHEN ${channel} = 'facebook' THEN facebook_concurrency
        ELSE chat_concurrency
      END AS channel_concurrency
    FROM ccass.queue_members
    WHERE agent_id = ${agentId}::bigint AND queue_id = ${queueId}::bigint
    LIMIT 1
  `;
  const channelConcurrency = capacityRows[0]?.channel_concurrency ?? 1;

  await db.$executeRaw`
    INSERT INTO ccass.agent_capacity (organization_id, agent_id, channel, max_concurrency, active_count)
    VALUES (${organizationId}::bigint, ${agentId}::bigint, ${channel}, ${channelConcurrency}, 1)
    ON CONFLICT (agent_id, channel) DO UPDATE
      SET active_count = ccass.agent_capacity.active_count + 1, updated_at = NOW()
  `;

  if (channel !== "email" && !isCallChannel(source.channel)) {
    await setAgentPresenceByAgentId(db, organizationId, agentId, "busy", {
      userId,
      source: "routing",
    });
  }

  const created = await getConversation(db, organizationId, conversationId);
  if (!created) {
    throw Object.assign(new Error("Conversation not found after create"), { status: 500 });
  }
  return created;
}

async function linkTaskToWorkspaceConversation(
  db: DbClient,
  organizationId: string,
  userId: string,
  taskId: string,
  conversationId: string,
): Promise<void> {
  await db.$executeRaw`
    UPDATE ccass.agent_tasks
    SET conversation_id = ${conversationId}::bigint,
        updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND assigned_user_id = ${userId}::bigint
      AND id = ${taskId}::bigint
      AND status = 'open'
  `;
}

async function markConversationOutboundFollowUp(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await db.$executeRaw`
    UPDATE ccass.conversations
    SET direction = 'outbound',
        updated_at = NOW()
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
  `;
}

export async function openAgentWorkspaceFromTask(
  db: DbClient,
  organizationId: string,
  userId: string,
  taskId: string,
): Promise<OpenWorkspaceResult> {
  const task = await getAgentTask(db, organizationId, userId, taskId);
  if (!task) {
    throw Object.assign(new Error("Task not found"), { status: 404 });
  }

  const agent = await getAgentForUser(db, organizationId, userId);

  let source: ConversationRecord | null = null;
  if (task.conversationId) {
    source = await getConversation(db, organizationId, task.conversationId);
    if (!source) {
      throw Object.assign(new Error("Source conversation not found"), { status: 404 });
    }
  }

  const channel = task.channel ?? source?.channel;
  if (!channel) {
    throw Object.assign(new Error("Task has no channel"), { status: 400 });
  }

  const contactId = task.contactId ?? source?.contactId ?? null;
  const providerThreadId = source?.providerThreadId ?? null;
  const visitorId = source?.visitorId ?? null;
  const mailboxConnectionId = source?.mailboxConnectionId ?? null;

  if (!source && !contactId && !providerThreadId && !visitorId) {
    throw Object.assign(new Error("Task has no contact or conversation context"), { status: 400 });
  }

  if (source && !isClosedStatus(source.status)) {
    const conversation = await assignConversationToAgent(
      db,
      organizationId,
      userId,
      agent.id,
      source,
    );
    await linkTaskToWorkspaceConversation(
      db,
      organizationId,
      userId,
      taskId,
      conversation.id,
    );
    await markConversationOutboundFollowUp(db, organizationId, conversation.id);
    return { conversation, created: false };
  }

  const existingOpen = await findOpenConversationForContactChannel(db, organizationId, {
    contactId,
    channel,
    providerThreadId,
    visitorId,
    mailboxConnectionId,
    excludeConversationId: source?.id ?? null,
  });

  if (existingOpen) {
    const conversation = await assignConversationToAgent(
      db,
      organizationId,
      userId,
      agent.id,
      existingOpen,
    );
    await linkTaskToWorkspaceConversation(
      db,
      organizationId,
      userId,
      taskId,
      conversation.id,
    );
    await markConversationOutboundFollowUp(db, organizationId, conversation.id);
    return { conversation, created: false };
  }

  if (!source) {
    throw Object.assign(new Error("Source conversation required to start a new thread"), {
      status: 400,
    });
  }

  const conversation = await createConversationFromSource(
    db,
    organizationId,
    userId,
    agent.id,
    source,
  );
  await linkTaskToWorkspaceConversation(
    db,
    organizationId,
    userId,
    taskId,
    conversation.id,
  );
  await markConversationOutboundFollowUp(db, organizationId, conversation.id);
  return { conversation, created: true };
}
