import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import {
  endConversation,
  getConversation,
  type ConversationRecord,
} from "./conversations.js";
import { routeConversationToAgent, toRoutableChannel } from "./routing.js";
import { transitionConversation } from "./conversation-transitions.js";
import { projectInteractionEvent } from "./cdp-projection.js";
import { entityIdSchema } from "../lib/id-schema.js";

export const supervisorActionSchema = z.object({
  reason: z.string().min(1).max(500),
  agentId: entityIdSchema.optional(),
  queueId: entityIdSchema.optional(),
  disposition: z
    .object({
      dispositionId: entityIdSchema.optional(),
      code: z.string().min(1).max(64).optional(),
      note: z.string().max(4000).optional(),
    })
    .optional(),
});

async function getAgentForUser(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<{ id: string }> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND setup_user_id = ${userId}::bigint
    LIMIT 1
  `;
  if (!rows[0]) {
    throw Object.assign(new Error("Agent profile not found for user"), { status: 404 });
  }
  return rows[0];
}

async function assertSupervisor(db: DbClient, organizationId: string, userId: string) {
  const rows = await db.$queryRaw<{ role: string }[]>`
    SELECT role
    FROM accounts.setup_users
    WHERE id = ${userId}::bigint
      AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const role = (rows[0]?.role ?? "").toLowerCase();
  if (!["admin", "supervisor", "owner"].includes(role)) {
    throw Object.assign(new Error("Supervisor permission required"), { status: 403 });
  }
}

export async function supervisorForceClose(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  input: z.infer<typeof supervisorActionSchema>,
): Promise<ConversationRecord> {
  await assertSupervisor(db, organizationId, userId);
  const payload = supervisorActionSchema.parse(input);
  const result = await endConversation(db, organizationId, userId, conversationId, {
    actor: "session",
    reason: `supervisor_force_close:${payload.reason}`,
    disposition: payload.disposition
      ? { ...payload.disposition, isFinal: true }
      : undefined,
  });
  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "conversation.supervisor.force_close",
    metadata: { userId, reason: payload.reason },
  });
  return result.conversation;
}

export async function supervisorTakeover(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  input: z.infer<typeof supervisorActionSchema>,
): Promise<ConversationRecord> {
  await assertSupervisor(db, organizationId, userId);
  const payload = supervisorActionSchema.parse(input);
  const supervisorAgent = await getAgentForUser(db, organizationId, userId);
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }

  await db.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET state = 'ended', ended_at = NOW(), reason = 'supervisor_takeover'
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state IN ('offered', 'accepted')
  `;

  await transitionConversation(db, organizationId, conversationId, "supervisor_takeover", {
    agentId: supervisorAgent.id,
    userId,
    reason: payload.reason,
  });

  await db.$executeRaw`
    INSERT INTO ccass.conversation_assignments (
      organization_id, conversation_id, queue_id, agent_id, state, reason, offered_at, accepted_at
    ) VALUES (
      ${organizationId}::bigint,
      ${conversationId}::bigint,
      ${conversation.queueId}::bigint,
      ${supervisorAgent.id}::bigint,
      'accepted',
      ${`supervisor_takeover:${payload.reason}`},
      NOW(),
      NOW()
    )
  `;

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      assigned_agent_id = ${supervisorAgent.id}::bigint,
      assigned_user_id = ${userId}::bigint,
      assigned_at = NOW(),
      status = 'active',
      lifecycle_state = 'connected',
      bot_active = FALSE,
      updated_at = NOW()
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
  `;

  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "conversation.supervisor.takeover",
    metadata: { userId, reason: payload.reason, agentId: supervisorAgent.id },
  });

  const updated = await getConversation(db, organizationId, conversationId);
  if (!updated) {
    throw Object.assign(new Error("Conversation not found after takeover"), { status: 500 });
  }
  return updated;
}

export async function supervisorReassign(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  input: z.infer<typeof supervisorActionSchema>,
): Promise<{ conversation: ConversationRecord; nextUserId: string | null }> {
  await assertSupervisor(db, organizationId, userId);
  const payload = supervisorActionSchema.parse(input);
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  const queueId = payload.queueId ?? conversation.queueId;
  if (!queueId) {
    throw Object.assign(new Error("Queue is required for reassignment"), { status: 400 });
  }

  await db.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET state = 'ended', ended_at = NOW(), reason = 'supervisor_reassign'
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state IN ('offered', 'accepted')
  `;

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      status = 'queued',
      lifecycle_state = 'waiting',
      queue_id = ${queueId}::bigint,
      assigned_agent_id = NULL,
      assigned_user_id = NULL,
      assigned_at = NULL,
      queued_at = NOW(),
      bot_active = FALSE,
      updated_at = NOW()
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
  `;

  const routed = await routeConversationToAgent(db, organizationId, conversationId, queueId, {
    reason: `supervisor_reassign:${payload.reason}`,
    preferredAgentId: payload.agentId,
    channel: toRoutableChannel(conversation.channel),
  });

  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "conversation.supervisor.reassign",
    metadata: {
      userId,
      reason: payload.reason,
      queueId,
      preferredAgentId: payload.agentId ?? null,
      assigned: routed.assigned,
    },
  });

  const updated = await getConversation(db, organizationId, conversationId);
  if (!updated) {
    throw Object.assign(new Error("Conversation not found after reassign"), { status: 500 });
  }
  return { conversation: updated, nextUserId: routed.userId };
}
