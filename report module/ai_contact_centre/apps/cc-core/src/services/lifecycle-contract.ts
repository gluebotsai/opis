/**
 * Canonical contact-center lifecycle contract.
 * Conversation status transitions, ownership, capacity deltas, and typed reasons.
 */

export type ConversationStatus =
  | "bot_active"
  | "queued"
  | "assigned"
  | "active"
  | "resolved"
  | "closed";

export type LifecycleState = "bot" | "waiting" | "offered" | "connected" | "ended";

export type ConversationOwner =
  | "bot"
  | "queue"
  | "offered_agent"
  | "active_agent"
  | "closed";

/** Events that mutate conversation.status through the transition engine. */
export type TransitionEvent =
  | "start_bot"
  | "escalate"
  | "offer"
  | "accept"
  | "reject"
  | "offer_timeout"
  | "transfer"
  | "resolve"
  | "close"
  | "agent_disconnect"
  | "routing_exhausted_to_bot"
  | "routing_exhausted_to_close"
  | "supervisor_takeover"
  | "supervisor_reassign"
  | "supervisor_force_close"
  | "policy_reconcile_bot"
  | "reopen";

export type LifecycleReasonCode =
  | "no_agent"
  | "all_agents_busy"
  | "all_agents_rejected"
  | "offer_timeout"
  | "routing_exhausted"
  | "customer_disconnected"
  | "agent_disconnected"
  | "delivery_failed"
  | "policy_changed"
  | "explicit_human_request"
  | "low_confidence"
  | "customer_left"
  | "agent_ended"
  | "supervisor_action"
  | "session_expired"
  | "inactivity";

export type CapacityDelta = {
  reserved: number;
  active: number;
};

export type TransitionRule = {
  from: ConversationStatus[];
  to: ConversationStatus;
  owner: ConversationOwner;
  /** Default capacity change for the agent involved; close/agent_disconnect use helpers. */
  capacityDelta: CapacityDelta;
  idempotent: boolean;
};

export const LIFECYCLE_MAP: Record<ConversationStatus, LifecycleState> = {
  bot_active: "bot",
  queued: "waiting",
  assigned: "offered",
  active: "connected",
  resolved: "ended",
  closed: "ended",
};

export const OWNER_BY_STATUS: Record<ConversationStatus, ConversationOwner> = {
  bot_active: "bot",
  queued: "queue",
  assigned: "offered_agent",
  active: "active_agent",
  resolved: "closed",
  closed: "closed",
};

export const LEGAL_TRANSITIONS: Record<TransitionEvent, TransitionRule> = {
  start_bot: {
    from: [],
    to: "bot_active",
    owner: "bot",
    capacityDelta: { reserved: 0, active: 0 },
    idempotent: true,
  },
  escalate: {
    from: ["bot_active"],
    to: "queued",
    owner: "queue",
    capacityDelta: { reserved: 0, active: 0 },
    idempotent: false,
  },
  offer: {
    from: ["queued"],
    to: "assigned",
    owner: "offered_agent",
    capacityDelta: { reserved: 1, active: 0 },
    idempotent: false,
  },
  accept: {
    from: ["assigned"],
    to: "active",
    owner: "active_agent",
    capacityDelta: { reserved: -1, active: 1 },
    idempotent: false,
  },
  reject: {
    from: ["assigned"],
    to: "queued",
    owner: "queue",
    capacityDelta: { reserved: -1, active: 0 },
    idempotent: false,
  },
  offer_timeout: {
    from: ["assigned"],
    to: "queued",
    owner: "queue",
    capacityDelta: { reserved: -1, active: 0 },
    idempotent: false,
  },
  transfer: {
    from: ["active"],
    to: "assigned",
    owner: "offered_agent",
    capacityDelta: { reserved: 1, active: 0 },
    idempotent: false,
  },
  resolve: {
    from: ["active"],
    to: "resolved",
    owner: "closed",
    capacityDelta: { reserved: 0, active: -1 },
    idempotent: false,
  },
  close: {
    from: ["bot_active", "queued", "assigned", "active", "resolved"],
    to: "closed",
    owner: "closed",
    capacityDelta: { reserved: 0, active: 0 },
    idempotent: true,
  },
  agent_disconnect: {
    from: ["assigned", "active"],
    to: "queued",
    owner: "queue",
    capacityDelta: { reserved: 0, active: 0 },
    idempotent: false,
  },
  routing_exhausted_to_bot: {
    from: ["queued", "assigned"],
    to: "bot_active",
    owner: "bot",
    capacityDelta: { reserved: 0, active: 0 },
    idempotent: false,
  },
  routing_exhausted_to_close: {
    from: ["queued", "assigned"],
    to: "closed",
    owner: "closed",
    capacityDelta: { reserved: 0, active: 0 },
    idempotent: false,
  },
  supervisor_takeover: {
    from: ["queued", "assigned", "active"],
    to: "active",
    owner: "active_agent",
    capacityDelta: { reserved: 0, active: 1 },
    idempotent: false,
  },
  supervisor_reassign: {
    from: ["assigned", "active"],
    to: "assigned",
    owner: "offered_agent",
    capacityDelta: { reserved: 1, active: -1 },
    idempotent: false,
  },
  supervisor_force_close: {
    from: ["bot_active", "queued", "assigned", "active", "resolved"],
    to: "closed",
    owner: "closed",
    capacityDelta: { reserved: 0, active: 0 },
    idempotent: true,
  },
  policy_reconcile_bot: {
    from: ["queued"],
    to: "bot_active",
    owner: "bot",
    capacityDelta: { reserved: 0, active: 0 },
    idempotent: false,
  },
  reopen: {
    from: ["resolved", "closed"],
    to: "bot_active",
    owner: "bot",
    capacityDelta: { reserved: 0, active: 0 },
    idempotent: false,
  },
};

export function ownerForStatus(status: ConversationStatus): ConversationOwner {
  return OWNER_BY_STATUS[status];
}

export function isLegalTransition(
  event: TransitionEvent,
  currentStatus: ConversationStatus,
): boolean {
  const rule = LEGAL_TRANSITIONS[event];
  if (rule.from.length === 0) return true;
  return rule.from.includes(currentStatus);
}

export function expectedCapacityDelta(event: TransitionEvent): CapacityDelta {
  return LEGAL_TRANSITIONS[event].capacityDelta;
}

export function capacityDeltaForClose(currentStatus: ConversationStatus): CapacityDelta {
  if (currentStatus === "assigned") return { reserved: -1, active: 0 };
  if (currentStatus === "active") return { reserved: 0, active: -1 };
  return { reserved: 0, active: 0 };
}

export function capacityDeltaForAgentDisconnect(
  currentStatus: ConversationStatus,
): CapacityDelta {
  if (currentStatus === "assigned") return { reserved: -1, active: 0 };
  if (currentStatus === "active") return { reserved: 0, active: -1 };
  return { reserved: 0, active: 0 };
}

export const LIFECYCLE_REASON_CODES: readonly LifecycleReasonCode[] = [
  "no_agent",
  "all_agents_busy",
  "all_agents_rejected",
  "offer_timeout",
  "routing_exhausted",
  "customer_disconnected",
  "agent_disconnected",
  "delivery_failed",
  "policy_changed",
  "explicit_human_request",
  "low_confidence",
  "customer_left",
  "agent_ended",
  "supervisor_action",
  "session_expired",
  "inactivity",
] as const;

export type ScenarioExpectation = {
  id: number;
  name: string;
  category: string;
  expectedStatus: ConversationStatus | ConversationStatus[];
  expectedOwner: ConversationOwner | ConversationOwner[];
  capacityDelta?: CapacityDelta;
  customerMessage?: string | null;
  memoryAction?: "none" | "write_summary" | "write_facts" | "handoff_context" | "preserve";
  websocketEvent?: string | null;
  reasonCode?: LifecycleReasonCode | null;
};
