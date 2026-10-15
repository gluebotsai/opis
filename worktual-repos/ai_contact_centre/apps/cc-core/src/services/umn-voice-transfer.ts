import { randomUUID } from "node:crypto";
import { z } from "zod";

import { CALL_CHANNEL, isCallChannel } from "../lib/channels.js";
import { entityIdSchema, serializeEntityId, serializeEntityIdOptional } from "../lib/id-schema.js";
import { getRedisClient } from "../lib/redis-client.js";
import type { DbClient } from "../lib/rls.js";
import { getConversation, type ConversationTransferRecord } from "./conversations.js";
import {
  emitTransferCancelled,
  emitTransferOffered,
  emitVoiceCallOpened,
  emitVoiceConsultUpdated,
} from "./realtime.js";
import { umnCallPublishChannel } from "./umn-call-session.js";
import {
  claimTransferActionOperation,
  transitionTransferActionOperation,
} from "./transfer-action-operations.js";

export const TRANSFER_TYPE_NULL = 0;
export const TRANSFER_TYPE_AGENT = 1;
export const TRANSFER_TYPE_PSTN = 2;

export const TRANSFER_ACTION_NULL = 0;
export const TRANSFER_ACTION_TRANSFEROR_MERGE = 1;
export const TRANSFER_ACTION_TRANSFEROR_TRANSFER = 2;
export const TRANSFER_ACTION_TRANSFEROR_CANCEL = 3;
export const TRANSFER_ACTION_TRANSFEROR_LEAVE = 4;
export const TRANSFER_ACTION_TRANSFEROR_ENDALL = 5;
export const TRANSFER_ACTION_TRANSFEREE_LEAVE = 6;
export const VOICE_CONSULT_OUTCOME_MERGED = "voice_consult_merged";
export const VOICE_CONSULT_OUTCOME_TRANSFERRED = "voice_consult_transferred";

export const voiceTransferInviteSchema = z.object({
  queueId: entityIdSchema,
  agentId: entityIdSchema,
  ext: z.string().trim().min(1).max(32).optional(),
});

export const voiceTransferActionSchema = z.object({
  action: z.union([
    z.literal(TRANSFER_ACTION_TRANSFEROR_MERGE),
    z.literal(TRANSFER_ACTION_TRANSFEROR_TRANSFER),
    z.literal(TRANSFER_ACTION_TRANSFEROR_CANCEL),
    z.literal(TRANSFER_ACTION_TRANSFEROR_LEAVE),
    z.literal(TRANSFER_ACTION_TRANSFEROR_ENDALL),
    z.literal(TRANSFER_ACTION_TRANSFEREE_LEAVE),
  ]),
  operationId: z.string().uuid().optional(),
});

export type VoiceTransferInviteInput = z.infer<typeof voiceTransferInviteSchema>;
export type VoiceTransferActionInput = z.infer<typeof voiceTransferActionSchema>;

type SetupUserRow = {
  id: string;
  ext: number | null;
  work_email: string;
  first_name: string;
  last_name: string;
};

function displayName(user: Pick<SetupUserRow, "first_name" | "last_name">): string {
  return `${user.first_name} ${user.last_name}`.trim();
}

async function publishAcd(body: Record<string, unknown>): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    throw Object.assign(new Error("ACD voice transfer is unavailable"), { status: 503 });
  }
  try {
    await redis.publish(umnCallPublishChannel(), JSON.stringify(body));
  } catch (error) {
    throw Object.assign(new Error("Failed to send the voice transfer to ACD"), {
      status: 503,
      cause: error,
    });
  }
}

async function conversationSessionId(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<string> {
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation || !isCallChannel(conversation.channel)) {
    throw Object.assign(new Error("Voice conversation not found"), { status: 404 });
  }
  const sessionId = conversation.providerThreadId || conversation.externalThreadId;
  if (!sessionId) {
    throw Object.assign(new Error("Call session id is missing"), { status: 409 });
  }
  return sessionId;
}

async function loadAssignedAgentUser(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  userId: string,
): Promise<{ conversationId: string; agentId: string; userId: string; queueId: string | null }> {
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation || !isCallChannel(conversation.channel)) {
    throw Object.assign(new Error("Voice conversation not found"), { status: 404 });
  }
  const agentRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND setup_user_id = ${userId}::bigint
    LIMIT 1
  `;
  const agent = agentRows[0];
  if (!agent || conversation.assignedAgentId !== serializeEntityId(agent.id)) {
    throw Object.assign(new Error("Only the assigned agent can transfer this call"), {
      status: 409,
    });
  }
  return {
    conversationId: conversation.id,
    agentId: serializeEntityId(agent.id),
    userId,
    queueId: conversation.queueId,
  };
}

async function loadTargetUser(
  db: DbClient,
  organizationId: string,
  agentId: string,
  requestedExt?: string,
): Promise<SetupUserRow & { agentId: string }> {
  const rows = await db.$queryRaw<SetupUserRow[]>`
    SELECT su.id::text AS id, su.ext, su.work_email, su.first_name, su.last_name
    FROM ccass.agents a
    INNER JOIN accounts.setup_users su ON su.id = a.setup_user_id
    WHERE a.organization_id = ${organizationId}::bigint
      AND a.id = ${agentId}::bigint
    LIMIT 1
  `;
  const user = rows[0];
  if (!user || user.ext == null) {
    throw Object.assign(new Error("Transfer target has no SIP extension"), { status: 409 });
  }
  if (requestedExt && normalizeExt(requestedExt) !== String(user.ext)) {
    throw Object.assign(new Error("Transfer target extension does not match"), { status: 409 });
  }
  return { ...user, agentId };
}

function normalizeExt(value: string): string {
  return value.trim().replace(/[^\d*#]/g, "");
}

type OpenVoiceConsultRow = {
  id: string;
  requested_agent_id: string | null;
  offered_agent_id: string | null;
  to_queue_id: string | null;
  from_user_id: string | null;
};

async function loadOpenVoiceConsult(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<OpenVoiceConsultRow | null> {
  const rows = await db.$queryRaw<OpenVoiceConsultRow[]>`
    SELECT id::text, requested_agent_id::text, offered_agent_id::text, to_queue_id::text, from_user_id::text
    FROM ccass.conversation_transfers
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state IN ('offered', 'accepted')
      AND requested_agent_id IS NOT NULL
    ORDER BY offered_at DESC NULLS LAST
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function loadAgentUser(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<{ agentId: string; userId: string } | null> {
  const rows = await db.$queryRaw<{ id: string; setup_user_id: string }[]>`
    SELECT id::text AS id, setup_user_id::text AS setup_user_id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${agentId}::bigint
    LIMIT 1
  `;
  const agent = rows[0];
  if (!agent?.setup_user_id) return null;
  return { agentId: agent.id, userId: agent.setup_user_id };
}

async function reserveVoiceConsultCapacity(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<void> {
  const reserved = await db.$queryRaw<{ agent_id: string }[]>`
    INSERT INTO ccass.agent_capacity (
      organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
    ) VALUES (
      ${organizationId}::bigint, ${agentId}::bigint, ${CALL_CHANNEL}, 1, 1, 0
    )
    ON CONFLICT (agent_id, channel) DO UPDATE
      SET reserved_count = ccass.agent_capacity.reserved_count + 1,
          updated_at = NOW()
      WHERE ccass.agent_capacity.organization_id = ${organizationId}::bigint
        AND ccass.agent_capacity.active_count + ccass.agent_capacity.reserved_count
          < ccass.agent_capacity.max_concurrency
    RETURNING agent_id::text
  `;
  if (!reserved[0]) {
    throw Object.assign(new Error("Requested agent reached voice capacity"), { status: 409 });
  }
}

async function releaseVoiceConsultCapacity(
  db: DbClient,
  organizationId: string,
  agentId: string | null,
): Promise<void> {
  if (!agentId) return;
  await db.$executeRaw`
    UPDATE ccass.agent_capacity
    SET reserved_count = GREATEST(reserved_count - 1, 0), updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND agent_id = ${agentId}::bigint
      AND channel = ${CALL_CHANNEL}
  `;
}

async function reassignConversationToConsultTarget(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  sessionId: string,
): Promise<{ userId: string } | null> {
  const consult = await loadOpenVoiceConsult(db, organizationId, conversationId);
  if (!consult?.requested_agent_id) return null;
  const target = await loadAgentUser(db, organizationId, consult.requested_agent_id);
  if (!target) return null;
  const conversationBeforeTransfer = await getConversation(db, organizationId, conversationId);
  const previousAgentId = conversationBeforeTransfer?.assignedAgentId ?? null;
  await db.$executeRaw`
    UPDATE ccass.conversations
    SET assigned_agent_id = ${target.agentId}::bigint,
        assigned_user_id = ${target.userId}::bigint,
        queue_id = COALESCE(${consult.to_queue_id}::bigint, queue_id),
        transferred_at = NOW(),
        updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${conversationId}::bigint
  `;
  if (previousAgentId && previousAgentId !== target.agentId) {
    const endedPreviousAssignments = await db.$queryRaw<{ id: string }[]>`
      UPDATE ccass.conversation_assignments
      SET state = 'ended', ended_at = NOW(), reason = 'voice_transfer'
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND agent_id = ${previousAgentId}::bigint
        AND state = 'accepted'
      RETURNING id::text
    `;
    const acceptedTargetAssignments = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO ccass.conversation_assignments (
        organization_id, conversation_id, queue_id, agent_id, state,
        reason, offered_at, accepted_at
      )
      SELECT
        ${organizationId}::bigint, ${conversationId}::bigint,
        ${consult.to_queue_id}::bigint, ${target.agentId}::bigint,
        'accepted', 'voice_transfer', NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1
        FROM ccass.conversation_assignments
        WHERE organization_id = ${organizationId}::bigint
          AND conversation_id = ${conversationId}::bigint
          AND agent_id = ${target.agentId}::bigint
          AND state = 'accepted'
      )
      RETURNING id::text
    `;
    if (endedPreviousAssignments[0]) {
      await db.$executeRaw`
        UPDATE ccass.agent_capacity
        SET active_count = GREATEST(active_count - 1, 0), updated_at = NOW()
        WHERE agent_id = ${previousAgentId}::bigint AND channel = ${CALL_CHANNEL}
      `;
    }
    if (acceptedTargetAssignments[0]) {
      await db.$executeRaw`
        UPDATE ccass.agent_capacity
        SET reserved_count = GREATEST(reserved_count - 1, 0),
            active_count = active_count + 1,
            updated_at = NOW()
        WHERE agent_id = ${target.agentId}::bigint AND channel = ${CALL_CHANNEL}
      `;
    }
  }
  const conversation = await getConversation(db, organizationId, conversationId);
  if (conversation) {
    emitVoiceCallOpened(organizationId, target.userId, conversation, sessionId);
  }
  return { userId: target.userId };
}

async function addVoiceConsultParticipantAssignment(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  const consult = await loadOpenVoiceConsult(db, organizationId, conversationId);
  if (!consult?.requested_agent_id) return;
  const inserted = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO ccass.conversation_assignments (
      organization_id, conversation_id, queue_id, agent_id, state,
      reason, offered_at, accepted_at
    )
    SELECT
      ${organizationId}::bigint, ${conversationId}::bigint,
      ${consult.to_queue_id}::bigint, ${consult.requested_agent_id}::bigint,
      'accepted', 'voice_merge', NOW(), NOW()
    WHERE NOT EXISTS (
      SELECT 1
      FROM ccass.conversation_assignments
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND agent_id = ${consult.requested_agent_id}::bigint
        AND state = 'accepted'
    )
    RETURNING id::text
  `;
  if (!inserted[0]) return;
  await db.$executeRaw`
    UPDATE ccass.agent_capacity
    SET reserved_count = GREATEST(reserved_count - 1, 0),
        active_count = active_count + 1,
        updated_at = NOW()
    WHERE agent_id = ${consult.requested_agent_id}::bigint
      AND channel = ${CALL_CHANNEL}
  `;
}

async function releaseVoiceConsultParticipantAssignment(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  userId: string,
): Promise<void> {
  const agentRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND setup_user_id = ${userId}::bigint
    LIMIT 1
  `;
  const agentId = agentRows[0]?.id;
  if (!agentId) return;
  const ended = await db.$queryRaw<{ id: string }[]>`
    UPDATE ccass.conversation_assignments
    SET state = 'ended', ended_at = NOW(), reason = 'voice_merge_left'
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND agent_id = ${agentId}::bigint
      AND state = 'accepted'
      AND reason = 'voice_merge'
    RETURNING id::text
  `;
  if (!ended[0]) return;
  await db.$executeRaw`
    UPDATE ccass.agent_capacity
    SET active_count = GREATEST(active_count - 1, 0), updated_at = NOW()
    WHERE agent_id = ${agentId}::bigint AND channel = ${CALL_CHANNEL}
  `;
}

async function notifyConsultTarget(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  sessionId: string,
  action: number,
  merged: boolean,
): Promise<void> {
  const consult = await loadOpenVoiceConsult(db, organizationId, conversationId);
  if (!consult?.requested_agent_id) return;
  const target = await loadAgentUser(db, organizationId, consult.requested_agent_id);
  if (!target) return;
  emitVoiceConsultUpdated(organizationId, target.userId, {
    conversationId,
    sessionId,
    action,
    merged,
  });
  if (!merged) return;
  const conversation = await getConversation(db, organizationId, conversationId);
  if (conversation) {
    emitVoiceCallOpened(organizationId, target.userId, conversation, sessionId);
  }
}

export function agentTransferPublishBody(input: {
  sessionId: string;
  ext: string;
  email: string;
  name: string;
  userId: string;
}): Record<string, unknown> {
  return {
    session_id: input.sessionId,
    req_type: "AGENT_TRANSFER",
    transfer_type: TRANSFER_TYPE_AGENT,
    ddi: Number(input.ext) || input.ext,
    email: input.email,
    name: input.name,
    userId: input.userId,
  };
}

/** Transfer hands the customer to B but leaves wrap-up open for A. */
export function voiceConsultStateAfterAction(
  action: number,
): "accepted" | "completed" | "cancelled" | null {
  if (action === TRANSFER_ACTION_TRANSFEROR_TRANSFER) return "accepted";
  if (action === TRANSFER_ACTION_TRANSFEROR_MERGE) return "accepted";
  if (action === TRANSFER_ACTION_TRANSFEROR_CANCEL) return "cancelled";
  if (
    action === TRANSFER_ACTION_TRANSFEROR_LEAVE ||
    action === TRANSFER_ACTION_TRANSFEROR_ENDALL
  ) {
    return "completed";
  }
  return null;
}

export function transferActionPublishBody(input: {
  sessionId: string;
  action: number;
  ext?: string | null;
  agentType?: "PRIMARY" | "SECONDARY" | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    session_id: input.sessionId,
    req_type: "TRANSFER_ACTION",
    action: input.action,
    ddi: input.ext ? Number(input.ext) || input.ext : null,
  };
  if (input.agentType) body.agentType = input.agentType;
  return body;
}

type VoiceConsultTransferRow = {
  id: string;
  conversation_id: string;
  from_queue_id: string | null;
  from_agent_id: string | null;
  from_user_id: string | null;
  to_queue_id: string;
  requested_agent_id: string | null;
  offered_agent_id: string | null;
  accepted_agent_id: string | null;
  accepted_user_id: string | null;
  state: ConversationTransferRecord["state"];
  notes: string | null;
  outcome_reason: string | null;
  channel: string | null;
  requested_at: Date;
  offered_at: Date | null;
  accepted_at: Date | null;
  completed_at: Date | null;
  rejected_at: Date | null;
  expired_at: Date | null;
  cancelled_at: Date | null;
};

function mapVoiceConsultTransfer(row: VoiceConsultTransferRow): ConversationTransferRecord {
  return {
    id: serializeEntityId(row.id)!,
    conversationId: serializeEntityId(row.conversation_id)!,
    fromQueueId: serializeEntityIdOptional(row.from_queue_id),
    fromAgentId: serializeEntityIdOptional(row.from_agent_id),
    fromUserId: serializeEntityIdOptional(row.from_user_id),
    toQueueId: serializeEntityId(row.to_queue_id)!,
    requestedAgentId: serializeEntityIdOptional(row.requested_agent_id),
    offeredAgentId: serializeEntityIdOptional(row.offered_agent_id),
    acceptedAgentId: serializeEntityIdOptional(row.accepted_agent_id),
    acceptedUserId: serializeEntityIdOptional(row.accepted_user_id),
    state: row.state,
    notes: row.notes,
    outcomeReason: row.outcome_reason,
    channel: row.channel,
    requestedAt: row.requested_at.toISOString(),
    offeredAt: row.offered_at?.toISOString() ?? null,
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    rejectedAt: row.rejected_at?.toISOString() ?? null,
    expiredAt: row.expired_at?.toISOString() ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
  };
}

async function recordVoiceConsult(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  from: { agentId: string; userId: string; queueId: string | null },
  to: { agentId: string; queueId: string },
): Promise<ConversationTransferRecord> {
  const reused = await db.$queryRaw<VoiceConsultTransferRow[]>`
    UPDATE ccass.conversation_transfers
    SET from_queue_id = ${from.queueId}::bigint,
        from_agent_id = ${from.agentId}::bigint,
        from_user_id = ${from.userId}::bigint,
        to_queue_id = ${to.queueId}::bigint,
        requested_agent_id = ${to.agentId}::bigint,
        offered_agent_id = ${to.agentId}::bigint,
        requested_by_user_id = ${from.userId}::bigint,
        state = 'offered',
        notes = NULL,
        outcome_reason = NULL,
        resolution_data = '{}'::jsonb,
        channel = ${CALL_CHANNEL},
        offered_at = NOW(),
        accepted_at = NULL,
        accepted_agent_id = NULL,
        accepted_user_id = NULL,
        completed_at = NULL,
        cancelled_at = NULL,
        rejected_at = NULL,
        expired_at = NULL,
        updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM ccass.conversation_transfers
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND requested_agent_id IS NOT NULL
        AND state = 'offered'
      ORDER BY offered_at DESC NULLS LAST
      LIMIT 1
      FOR UPDATE
    )
    RETURNING
      id::text, conversation_id::text, from_queue_id::text, from_agent_id::text,
      from_user_id::text, to_queue_id::text, requested_agent_id::text,
      offered_agent_id::text, accepted_agent_id::text, accepted_user_id::text,
      state, notes, outcome_reason, channel, requested_at, offered_at, accepted_at,
      completed_at, rejected_at, expired_at, cancelled_at
  `;
  if (reused[0]) return mapVoiceConsultTransfer(reused[0]);

  const inserted = await db.$queryRaw<VoiceConsultTransferRow[]>`
    INSERT INTO ccass.conversation_transfers (
      organization_id, conversation_id, from_queue_id, from_agent_id, from_user_id,
      to_queue_id, requested_agent_id, offered_agent_id, requested_by_user_id,
      state, notes, resolution_data, offered_at, channel
    ) VALUES (
      ${organizationId}::bigint, ${conversationId}::bigint, ${from.queueId}::bigint,
      ${from.agentId}::bigint, ${from.userId}::bigint, ${to.queueId}::bigint,
      ${to.agentId}::bigint, ${to.agentId}::bigint, ${from.userId}::bigint,
      'offered', NULL, '{}'::jsonb, NOW(), ${CALL_CHANNEL}
    )
    ON CONFLICT (organization_id, conversation_id)
      WHERE requested_agent_id IS NOT NULL AND state = 'offered'
    DO UPDATE SET
      from_queue_id = EXCLUDED.from_queue_id,
      from_agent_id = EXCLUDED.from_agent_id,
      from_user_id = EXCLUDED.from_user_id,
      to_queue_id = EXCLUDED.to_queue_id,
      requested_agent_id = EXCLUDED.requested_agent_id,
      offered_agent_id = EXCLUDED.offered_agent_id,
      requested_by_user_id = EXCLUDED.requested_by_user_id,
      notes = NULL,
      outcome_reason = NULL,
      resolution_data = '{}'::jsonb,
      channel = EXCLUDED.channel,
      offered_at = NOW(),
      accepted_at = NULL,
      accepted_agent_id = NULL,
      accepted_user_id = NULL,
      completed_at = NULL,
      cancelled_at = NULL,
      rejected_at = NULL,
      expired_at = NULL,
      updated_at = NOW()
    RETURNING
      id::text, conversation_id::text, from_queue_id::text, from_agent_id::text,
      from_user_id::text, to_queue_id::text, requested_agent_id::text,
      offered_agent_id::text, accepted_agent_id::text, accepted_user_id::text,
      state, notes, outcome_reason, channel, requested_at, offered_at, accepted_at,
      completed_at, rejected_at, expired_at, cancelled_at
  `;
  if (!inserted[0]) {
    throw Object.assign(new Error("Unable to create the voice consult"), { status: 409 });
  }
  return mapVoiceConsultTransfer(inserted[0]);
}

async function closeOpenVoiceConsult(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  state: "completed" | "cancelled" | "accepted",
  outcomeReason?: string,
): Promise<ConversationTransferRecord | null> {
  const rows = await db.$queryRaw<VoiceConsultTransferRow[]>`
    UPDATE ccass.conversation_transfers AS transfer
    SET state = ${state},
        completed_at = CASE WHEN ${state} = 'completed' THEN NOW() ELSE transfer.completed_at END,
        cancelled_at = CASE WHEN ${state} = 'cancelled' THEN NOW() ELSE transfer.cancelled_at END,
        accepted_at = CASE
          WHEN ${state} IN ('accepted', 'completed') THEN COALESCE(transfer.accepted_at, NOW())
          ELSE transfer.accepted_at
        END,
        accepted_agent_id = CASE
          WHEN ${state} IN ('accepted', 'completed')
            THEN COALESCE(transfer.accepted_agent_id, transfer.requested_agent_id)
          ELSE transfer.accepted_agent_id
        END,
        accepted_user_id = CASE
          WHEN ${state} IN ('accepted', 'completed')
            THEN COALESCE(transfer.accepted_user_id, agent.setup_user_id)
          ELSE transfer.accepted_user_id
        END,
        outcome_reason = COALESCE(${outcomeReason ?? null}, transfer.outcome_reason),
        updated_at = NOW()
    FROM ccass.agents AS agent
    WHERE transfer.organization_id = ${organizationId}::bigint
      AND transfer.conversation_id = ${conversationId}::bigint
      AND transfer.state IN ('offered', 'accepted')
      AND transfer.requested_agent_id IS NOT NULL
      AND agent.id = transfer.requested_agent_id
    RETURNING
      transfer.id::text, transfer.conversation_id::text, transfer.from_queue_id::text,
      transfer.from_agent_id::text, transfer.from_user_id::text, transfer.to_queue_id::text,
      transfer.requested_agent_id::text, transfer.offered_agent_id::text,
      transfer.accepted_agent_id::text, transfer.accepted_user_id::text,
      transfer.state, transfer.notes, transfer.outcome_reason, transfer.channel,
      transfer.requested_at, transfer.offered_at, transfer.accepted_at,
      transfer.completed_at, transfer.rejected_at, transfer.expired_at, transfer.cancelled_at
  `;
  return rows[0] ? mapVoiceConsultTransfer(rows[0]) : null;
}

export async function inviteVoiceConsultTransfer(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  input: VoiceTransferInviteInput,
): Promise<{ sessionId: string; ext: string; target: { email: string; name: string; userId: string } }> {
  const payload = voiceTransferInviteSchema.parse(input);
  const assigned = await loadAssignedAgentUser(db, organizationId, conversationId, userId);
  const sessionId = await conversationSessionId(db, organizationId, conversationId);
  const target = await loadTargetUser(db, organizationId, payload.agentId, payload.ext);
  if (await loadOpenVoiceConsult(db, organizationId, conversationId)) {
    throw Object.assign(new Error("A voice consult is already in progress"), { status: 409 });
  }
  const transfer = await recordVoiceConsult(db, organizationId, conversationId, assigned, {
    agentId: target.agentId,
    queueId: payload.queueId,
  });
  try {
    await reserveVoiceConsultCapacity(db, organizationId, target.agentId);
  } catch (error) {
    await closeOpenVoiceConsult(db, organizationId, conversationId, "cancelled");
    throw error;
  }
  const body = agentTransferPublishBody({
    sessionId,
    ext: String(target.ext),
    email: target.work_email,
    name: displayName(target),
    userId: target.id,
  });
  try {
    await publishAcd(body);
  } catch (error) {
    await closeOpenVoiceConsult(db, organizationId, conversationId, "cancelled");
    await releaseVoiceConsultCapacity(db, organizationId, target.agentId);
    throw error;
  }
  const conversation = await getConversation(db, organizationId, conversationId);
  if (conversation) {
    emitTransferOffered(organizationId, transfer, target.id, conversation);
  }
  return {
    sessionId,
    ext: String(target.ext),
    target: {
      email: target.work_email,
      name: displayName(target),
      userId: target.id,
    },
  };
}

export async function rejectVoiceConsultTransfer(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<{ sessionId: string }> {
  const agentRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND setup_user_id = ${userId}::bigint
    LIMIT 1
  `;
  const agentId = agentRows[0]?.id;
  const consult = await loadOpenVoiceConsult(db, organizationId, conversationId);
  if (!agentId || !consult?.requested_agent_id || consult.requested_agent_id !== agentId) {
    throw Object.assign(new Error("Only the consulted agent can reject this invite"), {
      status: 409,
    });
  }
  const sessionId = await conversationSessionId(db, organizationId, conversationId);
  const cancelledTransfer = await closeOpenVoiceConsult(
    db,
    organizationId,
    conversationId,
    "cancelled",
  );
  const conversation = await getConversation(db, organizationId, conversationId);
  if (cancelledTransfer && conversation) {
    emitTransferCancelled(
      organizationId,
      cancelledTransfer,
      userId,
      conversation,
    );
  }
  await releaseVoiceConsultCapacity(db, organizationId, consult.requested_agent_id);
  return { sessionId };
}

export async function markVoiceConsultAnswered(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<{ sessionId: string }> {
  const agentRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND setup_user_id = ${userId}::bigint
    LIMIT 1
  `;
  const agentId = agentRows[0]?.id;
  const consult = await loadOpenVoiceConsult(db, organizationId, conversationId);
  if (!agentId || !consult?.requested_agent_id || consult.requested_agent_id !== agentId) {
    throw Object.assign(new Error("Only the consulted agent can answer this invite"), {
      status: 409,
    });
  }
  const sessionId = await conversationSessionId(db, organizationId, conversationId);
  await closeOpenVoiceConsult(
    db,
    organizationId,
    conversationId,
    "accepted",
  );
  const conversation = await getConversation(db, organizationId, conversationId);
  if (conversation) {
    emitVoiceCallOpened(
      organizationId,
      userId,
      conversation,
      sessionId,
      { consultAnswered: true },
    );
  }
  return { sessionId };
}

async function authorizeVoiceTransferAction(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  action: number,
): Promise<void> {
  if (action === TRANSFER_ACTION_TRANSFEREE_LEAVE) {
    const agentRows = await db.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM ccass.agents
      WHERE organization_id = ${organizationId}::bigint
        AND setup_user_id = ${userId}::bigint
      LIMIT 1
    `;
    const agentId = agentRows[0]?.id;
    const consult = await loadOpenVoiceConsult(db, organizationId, conversationId);
    if (!agentId || !consult?.requested_agent_id || consult.requested_agent_id !== agentId) {
      throw Object.assign(new Error("Only the consulted agent can leave this conference"), {
        status: 409,
      });
    }
    return;
  }
  const consult = await loadOpenVoiceConsult(db, organizationId, conversationId);
  if (consult?.from_user_id && consult.from_user_id === userId) return;
  await loadAssignedAgentUser(db, organizationId, conversationId, userId);
}

export async function publishVoiceTransferAction(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  input: VoiceTransferActionInput,
): Promise<{ sessionId: string; action: number }> {
  const payload = voiceTransferActionSchema.parse(input);
  await authorizeVoiceTransferAction(db, organizationId, userId, conversationId, payload.action);
  const sessionId = await conversationSessionId(db, organizationId, conversationId);
  const consult = await loadOpenVoiceConsult(db, organizationId, conversationId);
  const operationId = payload.operationId ?? randomUUID();
  if (consult?.id) {
    await claimTransferActionOperation(db, organizationId, {
      operationId,
      conversationId,
      transferId: consult.id,
      requestedByUserId: userId,
      acdSessionId: sessionId,
      action: payload.action,
    });
  }
  const userRows = await db.$queryRaw<SetupUserRow[]>`
    SELECT id::text AS id, ext, work_email, first_name, last_name
    FROM accounts.setup_users
    WHERE organization_id = ${organizationId}::bigint AND id = ${userId}::bigint
    LIMIT 1
  `;
  const self = userRows[0];
  const ext = self?.ext == null ? null : String(self.ext);
  let agentType: "PRIMARY" | "SECONDARY" | null = null;
  if (payload.action === TRANSFER_ACTION_TRANSFEROR_LEAVE) agentType = "PRIMARY";
  if (payload.action === TRANSFER_ACTION_TRANSFEREE_LEAVE) agentType = "SECONDARY";

  if (payload.action === TRANSFER_ACTION_TRANSFEROR_CANCEL) {
    let cancelPublished = true;
    try {
      await publishAcd(transferActionPublishBody({ sessionId, action: payload.action }));
    } catch (error) {
      cancelPublished = false;
      if (consult?.id) {
        await transitionTransferActionOperation(db, organizationId, operationId, "failed", {
          errorDetail: error instanceof Error ? error.message : "ACD publish failed",
        });
      }
      // The consult row must still close when ACD has already rejected or timed out the leg.
    }
    const cancelledTransfer = await closeOpenVoiceConsult(
      db,
      organizationId,
      conversationId,
      "cancelled",
    );
    if (cancelledTransfer) {
      const targetAgentId =
        cancelledTransfer.acceptedAgentId ??
        cancelledTransfer.offeredAgentId ??
        cancelledTransfer.requestedAgentId;
      await releaseVoiceConsultCapacity(db, organizationId, targetAgentId);
      const target = targetAgentId
        ? await loadAgentUser(db, organizationId, targetAgentId)
        : null;
      const conversation = await getConversation(db, organizationId, conversationId);
      if (conversation) {
        emitTransferCancelled(
          organizationId,
          cancelledTransfer,
          target?.userId ?? null,
          conversation,
        );
      }
    }
    if (cancelPublished && consult?.id) {
      await transitionTransferActionOperation(db, organizationId, operationId, "acknowledged");
    }
    return { sessionId, action: payload.action };
  }

  try {
  await publishAcd(
    transferActionPublishBody({
      sessionId,
      action: payload.action,
      ext:
        payload.action === TRANSFER_ACTION_TRANSFEROR_LEAVE ||
        payload.action === TRANSFER_ACTION_TRANSFEREE_LEAVE
          ? ext
          : null,
      agentType,
    }),
  );
  } catch (error) {
    if (consult?.id) {
      await transitionTransferActionOperation(db, organizationId, operationId, "failed", {
        errorDetail: error instanceof Error ? error.message : "ACD publish failed",
      });
    }
    throw error;
  }

  if (payload.action === TRANSFER_ACTION_TRANSFEROR_TRANSFER) {
    await reassignConversationToConsultTarget(db, organizationId, conversationId, sessionId);
    await closeOpenVoiceConsult(
      db,
      organizationId,
      conversationId,
      "accepted",
      VOICE_CONSULT_OUTCOME_TRANSFERRED,
    );
  } else if (payload.action === TRANSFER_ACTION_TRANSFEROR_MERGE) {
    await addVoiceConsultParticipantAssignment(db, organizationId, conversationId);
    await notifyConsultTarget(db, organizationId, conversationId, sessionId, payload.action, true);
    await closeOpenVoiceConsult(
      db,
      organizationId,
      conversationId,
      "accepted",
      VOICE_CONSULT_OUTCOME_MERGED,
    );
  } else if (payload.action === TRANSFER_ACTION_TRANSFEROR_LEAVE) {
    await reassignConversationToConsultTarget(db, organizationId, conversationId, sessionId);
    await closeOpenVoiceConsult(db, organizationId, conversationId, "completed");
  } else if (payload.action === TRANSFER_ACTION_TRANSFEROR_ENDALL) {
    await closeOpenVoiceConsult(db, organizationId, conversationId, "completed");
  } else if (payload.action === TRANSFER_ACTION_TRANSFEREE_LEAVE) {
    await releaseVoiceConsultParticipantAssignment(db, organizationId, conversationId, userId);
    await releaseVoiceConsultCapacity(
      db,
      organizationId,
      consult?.requested_agent_id ?? null,
    );
    await closeOpenVoiceConsult(db, organizationId, conversationId, "cancelled");
  }

  if (consult?.id) {
    await transitionTransferActionOperation(db, organizationId, operationId, "acknowledged");
  }
  return { sessionId, action: payload.action };
}
