import type { DbClient } from "../lib/rls.js";
import { endNlpConversation, ensureNlpConversation } from "./nlp-conversations.js";
import {
  LEGAL_TRANSITIONS,
  LIFECYCLE_MAP,
  ownerForStatus,
  type ConversationOwner,
  type ConversationStatus,
  type LifecycleState,
  type TransitionEvent,
  isLegalTransition as isLegalTransitionContract,
} from "./lifecycle-contract.js";

export type {
  ConversationOwner,
  ConversationStatus,
  LifecycleState,
  TransitionEvent,
} from "./lifecycle-contract.js";

export {
  LEGAL_TRANSITIONS,
  LIFECYCLE_MAP,
  OWNER_BY_STATUS,
  capacityDeltaForAgentDisconnect,
  capacityDeltaForClose,
  expectedCapacityDelta,
  isLegalTransition,
  ownerForStatus,
} from "./lifecycle-contract.js";

type TransitionResult = {
  conversationId: string;
  status: ConversationStatus;
  lifecycleState: LifecycleState;
  owner: ConversationOwner;
  botActive: boolean;
  nlpEnabled: boolean;
  changed: boolean;
};

type ConversationRow = {
  id: string;
  status: string;
  lifecycle_state: string | null;
  bot_active: boolean;
  nlp_enabled: boolean;
  channel: string;
};

async function getConversationRow(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<ConversationRow | null> {
  const rows = await db.$queryRaw<ConversationRow[]>`
    SELECT id, status, lifecycle_state, bot_active, nlp_enabled, channel
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${conversationId}::bigint
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export class IllegalTransitionError extends Error {
  readonly httpStatus = 409;

  constructor(
    public readonly event: TransitionEvent,
    public readonly currentStatus: string,
    public readonly conversationId: string,
  ) {
    super(
      `Illegal transition "${event}" from status "${currentStatus}" for conversation ${conversationId}`,
    );
    this.name = "IllegalTransitionError";
  }
}

function botFlagsForEvent(event: TransitionEvent): { botActive: boolean; nlpEnabled: boolean } {
  switch (event) {
    case "start_bot":
    case "policy_reconcile_bot":
    case "reopen":
    case "routing_exhausted_to_bot":
      return { botActive: true, nlpEnabled: true };
    case "escalate":
    case "offer":
    case "accept":
    case "reject":
    case "offer_timeout":
    case "transfer":
    case "resolve":
    case "close":
    case "agent_disconnect":
    case "routing_exhausted_to_close":
    case "supervisor_takeover":
    case "supervisor_reassign":
    case "supervisor_force_close":
    default:
      return { botActive: false, nlpEnabled: false };
  }
}

function nlpRuntimeType(
  channel: string,
): "webchat_bot" | "whatsapp_bot" | "instagram_bot" | "facebook_bot" {
  if (channel === "whatsapp") return "whatsapp_bot";
  if (channel === "instagram") return "instagram_bot";
  if (channel === "facebook") return "facebook_bot";
  return "webchat_bot";
}

export async function transitionConversation(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  event: TransitionEvent,
  options: {
    queueId?: string | null;
    agentId?: string | null;
    userId?: string | null;
    reason?: string;
  } = {},
): Promise<TransitionResult> {
  const current = await getConversationRow(db, organizationId, conversationId);
  if (!current) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const currentStatus = current.status as ConversationStatus;
  const rule = LEGAL_TRANSITIONS[event];
  const targetStatus = rule.to;

  if (currentStatus === targetStatus && rule.idempotent) {
    return {
      conversationId,
      status: currentStatus,
      lifecycleState: (current.lifecycle_state as LifecycleState) ?? LIFECYCLE_MAP[currentStatus],
      owner: ownerForStatus(currentStatus),
      botActive: current.bot_active,
      nlpEnabled: current.nlp_enabled,
      changed: false,
    };
  }

  if (currentStatus === targetStatus) {
    return {
      conversationId,
      status: currentStatus,
      lifecycleState: (current.lifecycle_state as LifecycleState) ?? LIFECYCLE_MAP[currentStatus],
      owner: ownerForStatus(currentStatus),
      botActive: current.bot_active,
      nlpEnabled: current.nlp_enabled,
      changed: false,
    };
  }

  if (!isLegalTransitionContract(event, currentStatus)) {
    throw new IllegalTransitionError(event, currentStatus, conversationId);
  }

  const lifecycleState = LIFECYCLE_MAP[targetStatus];
  const { botActive, nlpEnabled } = botFlagsForEvent(event);

  if (event === "escalate") {
    await endNlpConversation(db, organizationId, conversationId, "escalated");
  }

  if (
    event === "policy_reconcile_bot" ||
    event === "reopen" ||
    event === "routing_exhausted_to_bot"
  ) {
    await ensureNlpConversation(
      db,
      organizationId,
      conversationId,
      nlpRuntimeType(current.channel),
    );
  }

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      status = ${targetStatus},
      lifecycle_state = ${lifecycleState},
      bot_active = ${botActive},
      nlp_enabled = ${nlpEnabled},
      queue_id = COALESCE(${options.queueId ?? null}::bigint, queue_id),
      assigned_agent_id = CASE
        WHEN ${event} IN ('accept', 'transfer', 'supervisor_takeover', 'supervisor_reassign')
          THEN ${options.agentId ?? null}::bigint
        WHEN ${event} IN (
          'reject', 'offer_timeout', 'escalate', 'close', 'resolve',
          'agent_disconnect', 'routing_exhausted_to_bot', 'routing_exhausted_to_close',
          'supervisor_force_close'
        ) THEN NULL
        ELSE assigned_agent_id
      END,
      queued_at = CASE
        WHEN ${event} IN ('escalate', 'agent_disconnect') THEN NOW()
        WHEN ${event} IN (
          'accept', 'policy_reconcile_bot', 'routing_exhausted_to_bot', 'supervisor_takeover'
        ) THEN NULL
        ELSE queued_at
      END,
      updated_at = NOW()
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
  `;

  return {
    conversationId,
    status: targetStatus,
    lifecycleState,
    owner: ownerForStatus(targetStatus),
    botActive,
    nlpEnabled,
    changed: true,
  };
}

export async function reconcilePolicyChange(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  policy: { botEnabled: boolean; liveAgentEnabled: boolean },
): Promise<TransitionResult | null> {
  const current = await getConversationRow(db, organizationId, conversationId);
  if (!current) return null;

  const status = current.status as ConversationStatus;

  if (!policy.botEnabled && status === "bot_active") {
    return transitionConversation(db, organizationId, conversationId, "escalate");
  }

  if (policy.botEnabled && status === "queued" && !current.bot_active) {
    const assigned = await db.$queryRaw<{ assigned_agent_id: string | null }[]>`
      SELECT assigned_agent_id FROM ccass.conversations
      WHERE id = ${conversationId}::bigint AND organization_id = ${organizationId}::bigint
    `;
    if (!assigned[0]?.assigned_agent_id) {
      return transitionConversation(db, organizationId, conversationId, "policy_reconcile_bot");
    }
  }

  return null;
}
