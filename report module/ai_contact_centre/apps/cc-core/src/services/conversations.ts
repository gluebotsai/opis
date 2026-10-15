import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { isCallChannel } from "../lib/channels.js";
import type { DbClient } from "../lib/rls.js";
import { entityIdSchema, serializeEntityId, serializeEntityIdOptional } from "../lib/id-schema.js";
import { projectInteractionEvent } from "./cdp-projection.js";
import { scheduleOmniChannelSummaryRefresh } from "./omni-channel-summary.js";
import {
  extractPrechatIdentity,
  maybeEnrichContactFromCustomerMessage,
  resolveInboundConversationContact,
  type ContactEnrichmentResult,
} from "./contact-identity.js";
import { resolveWebchatChannelConfigId } from "./channel-config-id.js";
import { deliverPersistedMessageToWebchat } from "./chat-delivery.js";
import { emitContactEnriched, emitMonitoringUpdated } from "./realtime.js";
import { endNlpConversation, ensureNlpConversation, listNlpTurns } from "./nlp-conversations.js";
import { upsertConversationMemory } from "./conversation-memory.js";
import { setAgentPresenceByAgentId, type AgentPresenceRecord } from "./presence.js";
import {
  recordAgentMissedContact,
  recordHandoffFailureMissedContact,
  type AgentMissedContactRecord,
} from "./agent-missed-contacts.js";
import { resolveEmailMailboxPolicy } from "./email-policies.js";
import {
  isSocialRoutableChannel,
  listEligibleTransferTargets,
  preemptAndRouteEmail,
  resolveHandoffQueue,
  routeConversationToAgent,
  toRoutableChannel,
  type RoutableChannel,
  type RoutingFailureReason,
} from "./routing.js";
import {
  applyNoAgentBehavior,
  DEFAULT_BUSY_MESSAGE,
  DEFAULT_HANDOFF_HOLD_MESSAGE,
  formatConnectedToAgentMessage,
  type NoAgentReasonCode,
} from "./no-agent-policy.js";
import {
  finalizeConversationSla,
  markFirstResponseSlaMet,
  startConversationSla,
} from "./conversation-sla.js";

export const conversationStatusSchema = z.enum([
  "bot_active",
  "queued",
  "assigned",
  "active",
  "resolved",
  "closed",
]);

export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export type ConversationDirection = "inbound" | "outbound";

export function automaticVoiceDispositionSummary(reason: string | null | undefined): string | null {
  switch (reason) {
    case "customer_disconnected":
      return "Customer disconnected before the agent completed wrap-up.";
    case "abandoned":
      return "Customer abandoned the call before it connected.";
    case "browser_disconnected":
      return "The agent browser disconnected before wrap-up was completed.";
    case "agent_declined":
    case "rejected":
      return "The incoming call was declined by the agent.";
    default:
      return null;
  }
}

export type ConversationRecord = {
  id: string;
  organizationId: string;
  channel: string;
  direction: ConversationDirection;
  externalThreadId: string;
  providerThreadId: string | null;
  previousConversationId: string | null;
  webchatId: string | null;
  visitorId: string | null;
  queueId: string | null;
  assignedAgentId: string | null;
  assignedUserId: string | null;
  status: ConversationStatus;
  lifecycleState: ConversationLifecycleState;
  subject: string | null;
  handoffReason: string | null;
  botActive: boolean;
  nlpEnabled: boolean;
  liveAgentEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  assignedAt: string | null;
  resolvedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  endActor: string | null;
  transferredAt: string | null;
  dispositionCode: string | null;
  dispositionNote?: string | null;
  resolutionCode: string | null;
  resolutionSummary?: string | null;
  mailboxConnectionId: string | null;
  channelConfigId: string | null;
  contactId: string | null;
  eventSequence: number;
  pendingOffer?: boolean;
  transfer?: ConversationTransferRecord | null;
  transferHistory?: ConversationTransferRecord[];
  emailHandoffContext: {
    subject: string | null;
    sender: string | null;
    summary: string | null;
    intent: string | null;
    sentiment: string | null;
    importantFacts: string[];
    knowledgeReferences: string[];
    waitSeconds: number;
  } | null;
};

type TriedRoutingAssignment = {
  agent_id: string;
  offered_at: Date;
};

/**
 * A request made after routing has already fallen back to the bot is a new
 * handoff episode. Repeated requests while an offer is still queued/ringing
 * remain in the existing episode.
 */
export function startsNewHandoffEpisode(status: string): boolean {
  return status !== "queued" && status !== "assigned";
}

/**
 * Return agents tried since the current handoff entered the queue.
 * Older rejected/expired offers belong to previous handoff cycles and must
 * not prevent those agents from being considered again.
 */
export function triedAgentIdsForCurrentRoutingCycle(
  assignments: TriedRoutingAssignment[],
  queuedAt: string | null,
): string[] {
  if (!queuedAt) {
    return [...new Set(assignments.map((assignment) => String(assignment.agent_id)))];
  }

  const cycleStartedAt = Date.parse(queuedAt);
  if (!Number.isFinite(cycleStartedAt)) {
    return [...new Set(assignments.map((assignment) => String(assignment.agent_id)))];
  }

  return [
    ...new Set(
      assignments
        .filter((assignment) => assignment.offered_at.getTime() >= cycleStartedAt)
        .map((assignment) => String(assignment.agent_id)),
    ),
  ];
}

export type MessageRecord = {
  id: string;
  conversationId: string;
  senderType: string;
  direction: string;
  visibility: string;
  body: string;
  deliveryState: string;
  messageType: string;
  sentAt: string;
  attachments: AttachmentRecord[];
  createdAt: string;
  senderUserId?: string | null;
  senderName?: string | null;
  transcriptPhase?: "bot" | "live_agent" | null;
};

export type ReceiptStatus = "sent" | "delivered" | "read";

export type MessageReceiptRecord = {
  id: string;
  conversationId: string;
  messageId: string;
  recipientType: string;
  recipientRef: string;
  status: ReceiptStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  updatedAt: string;
};

export type AttachmentRecord = {
  id: string;
  messageId: string;
  externalId: string | null;
  storageKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string | null;
  downloadUrl: string | null;
  status: "pending" | "available" | "blocked" | "expired";
  metadata: Record<string, unknown>;
  createdAt: string;
};

const startConversationSchema = z.object({
  webchatId: z.string().min(1),
  visitorId: z.string().min(1),
  /** Client correlation id from chat-service; not the ccass.conversations PK. */
  conversationId: z.string().min(1).optional(),
  externalThreadId: z.string().min(1).optional(),
  pageUrl: z.string().optional(),
  pageOrigin: z.string().optional(),
  consent: z.record(z.unknown()).optional(),
  prechatAnswers: z.record(z.unknown()).optional(),
  queueId: entityIdSchema.nullable().optional(),
  nlpEnabled: z.boolean().optional(),
  liveAgentEnabled: z.boolean().optional(),
  greetingBody: z.string().min(1).optional(),
});

async function findOpenWebchatConversation(
  db: DbClient,
  organizationId: string,
  webchatId: string,
  visitorId: string,
): Promise<ConversationRow | null> {
  const rows = await db.$queryRaw<ConversationRow[]>`
    SELECT *
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel = 'webchat'
      AND webchat_id = ${webchatId}
      AND visitor_id = ${visitorId}
      AND status NOT IN ('resolved', 'closed')
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPreviousClosedWebchatConversation(
  db: DbClient,
  organizationId: string,
  webchatId: string,
  visitorId: string,
): Promise<string | null> {
  const providerThreadId = `${webchatId}:${visitorId}`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel = 'webchat'
      AND (
        provider_thread_id = ${providerThreadId}
        OR external_thread_id = ${providerThreadId}
      )
      AND status IN ('resolved', 'closed')
    ORDER BY ended_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function upsertWebchatSessionForConversation(
  db: DbClient,
  organizationId: string,
  input: {
    conversationId: string;
    webchatId: string;
    visitorId: string;
    tokenHash: string;
    pageOrigin?: string | null;
    pageUrl?: string | null;
    consent?: Record<string, unknown> | null;
    prechatAnswers?: Record<string, unknown> | null;
  },
): Promise<string> {
  const sessionRows = await db.$queryRaw<{ session_id: string }[]>`
    INSERT INTO ccass.webchat_sessions (
      organization_id, conversation_id, webchat_id, visitor_id, token_hash,
      page_origin, page_url, consent, prechat_answers, connection_state
    ) VALUES (
      ${organizationId}::bigint,
      ${input.conversationId}::bigint,
      ${input.webchatId},
      ${input.visitorId},
      ${input.tokenHash},
      ${input.pageOrigin ?? null},
      ${input.pageUrl ?? null},
      ${input.consent ? JSON.stringify(input.consent) : null}::jsonb,
      ${input.prechatAnswers ? JSON.stringify(input.prechatAnswers) : null}::jsonb,
      'connected'
    )
    ON CONFLICT (conversation_id) DO UPDATE
      SET
        connection_state = 'connected',
        disconnected_at = NULL,
        ended_at = NULL,
        end_reason = NULL,
        ended_by = NULL,
        page_origin = COALESCE(EXCLUDED.page_origin, ccass.webchat_sessions.page_origin),
        page_url = COALESCE(EXCLUDED.page_url, ccass.webchat_sessions.page_url),
        updated_at = NOW()
    RETURNING id AS session_id
  `;
  const sessionId = sessionRows[0]?.session_id;
  if (!sessionId) {
    throw Object.assign(new Error("Failed to upsert webchat session"), { status: 500 });
  }
  return sessionId;
}

const appendMessageSchema = z.object({
  messageId: entityIdSchema.optional(),
  externalId: z.string().optional(),
  senderType: z.enum(["customer", "bot", "agent", "system"]),
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  visibility: z.enum(["customer", "internal"]).default("customer"),
  body: z.string().min(1),
  modelMetadata: z.record(z.unknown()).optional(),
});

export const messageReceiptSchema = z.object({
  messageId: entityIdSchema,
  recipientType: z.enum(["visitor", "agent", "system"]),
  recipientRef: z.string().max(128).optional().default(""),
  status: z.enum(["sent", "delivered", "read"]),
  occurredAt: z.string().datetime().optional(),
});

export const attachmentMetadataSchema = z.object({
  externalId: z.string().max(128).optional(),
  storageKey: z.string().min(1).max(2048),
  fileName: z.string().min(1).max(512),
  contentType: z.string().min(1).max(255),
  byteSize: z.number().int().nonnegative(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  downloadUrl: z
    .string()
    .url()
    .max(4096)
    .refine((url) => /^https?:\/\//i.test(url), "downloadUrl must use http or https")
    .optional(),
  status: z.enum(["pending", "available", "blocked", "expired"]).optional().default("available"),
  metadata: z.record(z.unknown()).optional(),
});

const handoffSchema = z.object({
  reason: z.string().min(1),
  queueId: entityIdSchema.optional(),
  selectedQueueKey: z.string().max(255).optional(),
  intent: z.string().max(255).optional(),
  message: z.string().max(20_000).optional(),
  candidateSkills: z.array(z.string()).optional(),
});

export const conversationLifecycleStateSchema = z.enum([
  "bot",
  "waiting",
  "offered",
  "connected",
  "transferred",
  "wrap_up",
  "ended",
]);

export type ConversationLifecycleState = z.infer<typeof conversationLifecycleStateSchema>;

export function mapLegacyStatusToLifecycle(status: string): ConversationLifecycleState {
  switch (status) {
    case "bot_active":
      return "bot";
    case "queued":
      return "waiting";
    case "assigned":
      return "offered";
    case "active":
      return "connected";
    case "resolved":
    case "closed":
      return "ended";
    default:
      return "waiting";
  }
}

export function isEndedConversationStatus(status: string): boolean {
  return status === "resolved" || status === "closed";
}

const resolutionSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  summary: z.string().max(4000).optional(),
  data: z.record(z.unknown()).optional(),
});

const dispositionInputShape = {
  dispositionId: entityIdSchema.optional(),
  code: z.string().min(1).max(64).optional(),
  note: z.string().max(4000).optional(),
  resolution: resolutionSchema.optional(),
};

export const saveDispositionSchema = z
  .object({
    ...dispositionInputShape,
    isFinal: z.boolean().optional().default(false),
    source: z.enum(["agent", "transfer", "merge", "customer", "system"]).optional().default("agent"),
  })
  .refine((value) => Boolean(value.dispositionId || value.code), {
    message: "dispositionId or code is required",
  });

export const transferConversationSchema = z.object({
  queueId: entityIdSchema,
  agentId: entityIdSchema.optional(),
  notes: z.string().max(4000).optional(),
  disposition: z.object(dispositionInputShape).optional(),
  resolution: resolutionSchema.optional(),
});

export const transferTargetsQuerySchema = z.object({
  queueId: entityIdSchema,
  search: z.string().max(255).optional(),
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  voice: z
    .preprocess((value) => value === true || value === "true" || value === "1", z.boolean())
    .optional()
    .default(false),
});

export const completeTransferSchema = z.object({
  summary: z.string().min(1).max(4000),
  dispositionCode: z.string().min(1).max(64),
  conclusion: z.string().max(4000).optional(),
});

export const endConversationSchema = z.object({
  actor: z.enum(["agent", "customer", "session", "system"]),
  reason: z.string().min(1).max(128),
  disposition: z
    .object({
      ...dispositionInputShape,
      isFinal: z.boolean().optional().default(true),
    })
    .optional(),
  resolution: resolutionSchema.optional(),
});

const listQuerySchema = z.object({
  status: z.string().optional(),
  assignedToMe: z.coerce.boolean().optional(),
  inbox: z.enum(["all", "open", "transferred", "closed"]).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const messagesQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  anchor: z.enum(["start", "end"]).optional().default("end"),
});

export const interactionsQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(50).optional().default(15),
});

type ConversationRow = {
  id: string;
  organization_id: string;
  channel: string;
  direction?: string | null;
  external_thread_id: string;
  provider_thread_id?: string | null;
  previous_conversation_id?: string | null;
  webchat_id: string | null;
  visitor_id: string | null;
  queue_id: string | null;
  assigned_agent_id: string | null;
  assigned_user_id: string | null;
  status: string;
  lifecycle_state?: string;
  subject: string | null;
  handoff_reason: string | null;
  bot_active: boolean;
  nlp_enabled: boolean;
  live_agent_enabled: boolean;
  created_at: Date;
  updated_at: Date;
  queued_at: Date | null;
  assigned_at: Date | null;
  resolved_at: Date | null;
  ended_at?: Date | null;
  end_reason?: string | null;
  end_actor?: string | null;
  transferred_at?: Date | null;
  disposition_code?: string | null;
  disposition_note?: string | null;
  resolution_code?: string | null;
  resolution_summary?: string | null;
  mailbox_connection_id?: string | null;
  channel_config_id?: string | null;
  contact_id?: string | null;
  event_sequence?: number | bigint | null;
  email_handoff_context?: unknown;
};

type ConversationTransferRow = {
  id: string | bigint;
  conversation_id: string | bigint;
  from_queue_id: string | bigint | null;
  from_agent_id: string | bigint | null;
  from_user_id: string | bigint | null;
  to_queue_id: string | bigint;
  requested_agent_id: string | bigint | null;
  offered_agent_id: string | bigint | null;
  accepted_agent_id: string | bigint | null;
  accepted_user_id: string | bigint | null;
  state: ConversationTransferState;
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
  from_agent_name?: string | null;
  requested_agent_name?: string | null;
  offered_agent_name?: string | null;
  accepted_agent_name?: string | null;
  from_queue_name?: string | null;
  to_queue_name?: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: string;
  direction: string;
  visibility: string;
  body: string;
  delivery_state: string;
  message_type?: string;
  sent_at?: Date | null;
  attachments?: unknown;
  model_metadata?: unknown;
  created_at: Date;
};

type MessageReceiptRow = {
  id: string;
  conversation_id: string;
  message_id: string;
  recipient_type: string;
  recipient_ref: string;
  status: ReceiptStatus;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  updated_at: Date;
};

type AttachmentRow = {
  id: string;
  message_id: string;
  external_id: string | null;
  storage_key: string;
  file_name: string;
  content_type: string;
  byte_size: bigint | number;
  checksum_sha256: string | null;
  download_url: string | null;
  status: AttachmentRecord["status"];
  metadata: unknown;
  created_at: Date | string;
};

function rowEntityId(value: string | bigint | number | null | undefined): string | null {
  if (value == null) return null;
  return serializeEntityId(value);
}

function mapConversation(row: ConversationRow): ConversationRecord {
  const automaticDispositionSummary =
    isCallChannel(row.channel) && row.end_actor === "system"
      ? automaticVoiceDispositionSummary(row.end_reason)
      : null;
  return {
    id: rowEntityId(row.id)!,
    organizationId: rowEntityId(row.organization_id)!,
    channel: row.channel,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    externalThreadId: row.external_thread_id,
    providerThreadId: row.provider_thread_id ?? null,
    previousConversationId: rowEntityId(row.previous_conversation_id),
    webchatId: row.webchat_id,
    visitorId: row.visitor_id,
    queueId: rowEntityId(row.queue_id),
    assignedAgentId: rowEntityId(row.assigned_agent_id),
    assignedUserId: rowEntityId(row.assigned_user_id),
    status: row.status as ConversationStatus,
    lifecycleState: conversationLifecycleStateSchema.catch(mapLegacyStatusToLifecycle(row.status)).parse(
      row.lifecycle_state,
    ),
    subject: row.subject,
    handoffReason: row.handoff_reason,
    botActive: row.bot_active,
    nlpEnabled: row.nlp_enabled,
    liveAgentEnabled: row.live_agent_enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    queuedAt: row.queued_at?.toISOString() ?? null,
    assignedAt: row.assigned_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    endReason: row.end_reason ?? null,
    endActor: row.end_actor ?? null,
    transferredAt: row.transferred_at?.toISOString() ?? null,
    dispositionCode: row.disposition_code ?? null,
    dispositionNote: row.disposition_note ?? automaticDispositionSummary,
    resolutionCode: row.resolution_code ?? null,
    resolutionSummary: row.resolution_summary ?? automaticDispositionSummary,
    mailboxConnectionId: rowEntityId(row.mailbox_connection_id),
    channelConfigId: rowEntityId(row.channel_config_id),
    contactId: row.contact_id?.trim() || rowEntityId(row.contact_id),
    eventSequence: Number(row.event_sequence ?? 0),
    emailHandoffContext:
      row.email_handoff_context &&
      typeof row.email_handoff_context === "object" &&
      !Array.isArray(row.email_handoff_context)
        ? (row.email_handoff_context as ConversationRecord["emailHandoffContext"])
        : null,
  };
}

async function getApprovedWebchatServiceMessage(
  db: DbClient,
  organizationId: string,
  webchatId: string | null,
  key: "handoffMessage" | "queueBusyMessage" | "outOfHoursMessage",
): Promise<string | null> {
  if (!webchatId) return null;
  const rows = await db.$queryRaw<{ message: string | null }[]>`
    SELECT NULLIF(trim(config.personalisation ->> ${key}), '') AS message
    FROM accounts.setup_webchat_configs config
    INNER JOIN accounts.setup_channel_configs channel ON channel.id = config.channel_config_id
    WHERE channel.organization_id = ${organizationId}::bigint
      AND config.webchat_id = ${webchatId}
    LIMIT 1
  `;
  return rows[0]?.message ?? null;
}

function resolveNoAgentReasonCode(
  reason: string,
  failureReason?: RoutingFailureReason,
): NoAgentReasonCode {
  if (failureReason) return failureReason;
  if (reason === "agent_rejected" || reason === "all_agents_rejected") {
    return "all_agents_rejected";
  }
  if (reason === "offer_timeout") return "routing_exhausted";
  return "no_agent";
}

async function handleWebchatAgentsUnavailable(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  webchatId: string | null,
  reason: string,
  failureReason?: RoutingFailureReason,
): Promise<MessageRecord> {
  const conversation = await getConversation(db, organizationId, conversationId);
  const reasonCode = resolveNoAgentReasonCode(reason, failureReason);

  const outcome = await applyNoAgentBehavior(db, organizationId, conversationId, {
    channel: "webchat",
    channelConfigId: conversation?.channelConfigId ?? null,
    webchatId,
    reasonCode,
    currentStatus: conversation?.status,
  });

  if (conversation) {
    const missed = await recordHandoffFailureMissedContact(db, organizationId, {
      conversation,
      reasonCode,
    });
    if (missed) {
      emitMonitoringUpdated(organizationId, "missed_contact.created");
    }
  }

  await upsertConversationMemory(db, organizationId, conversationId, {
    rollingSummary: `Live agent routing unavailable (${reason}). reason_code=${reasonCode} behavior=${outcome.behavior}`,
    extractedFacts: ["live_agent_unavailable", reason, reasonCode, outcome.behavior],
    modelName: "routing-fallback",
  });

  const { message } = await appendConversationMessage(db, organizationId, conversationId, {
    senderType: "system",
    direction: "outbound",
    visibility: "customer",
    body: outcome.customerMessage || DEFAULT_BUSY_MESSAGE,
  });
  return message;
}

async function handleSocialAgentsUnavailable(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  reason: string,
  failureReason?: RoutingFailureReason,
): Promise<MessageRecord> {
  const conversation = await getConversation(db, organizationId, conversationId);
  const reasonCode = resolveNoAgentReasonCode(reason, failureReason);

  const outcome = await applyNoAgentBehavior(db, organizationId, conversationId, {
    channel: conversation?.channel ?? "whatsapp",
    channelConfigId: conversation?.channelConfigId ?? null,
    reasonCode,
    currentStatus: conversation?.status,
  });

  if (conversation) {
    const missed = await recordHandoffFailureMissedContact(db, organizationId, {
      conversation,
      reasonCode,
    });
    if (missed) {
      emitMonitoringUpdated(organizationId, "missed_contact.created");
    }
  }

  await upsertConversationMemory(db, organizationId, conversationId, {
    rollingSummary: `Live agent routing unavailable (${reason}). reason_code=${reasonCode} behavior=${outcome.behavior}`,
    extractedFacts: ["live_agent_unavailable", reason, reasonCode, outcome.behavior],
    modelName: "routing-fallback",
  });

  const { message } = await appendConversationMessage(db, organizationId, conversationId, {
    senderType: "system",
    direction: "outbound",
    visibility: "customer",
    body: outcome.customerMessage || DEFAULT_BUSY_MESSAGE,
  });
  return message;
}

function readMessageMetadata(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function metadataText(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

type MappedMessage = MessageRecord & { speakerRef?: string | null };

function mapMessage(row: MessageRow): MappedMessage {
  const attachments = Array.isArray(row.attachments)
    ? (row.attachments as AttachmentRow[]).map(mapAttachment)
    : [];
  const metadata = readMessageMetadata(row.model_metadata);
  return {
    id: rowEntityId(row.id)!,
    conversationId: rowEntityId(row.conversation_id)!,
    senderType: row.sender_type,
    direction: row.direction,
    visibility: row.visibility,
    body: row.body,
    deliveryState: row.delivery_state,
    messageType: row.message_type ?? (attachments.length > 0 ? "attachment" : "text"),
    sentAt: (row.sent_at ?? row.created_at).toISOString(),
    attachments,
    createdAt: row.created_at.toISOString(),
    senderUserId: metadataText(metadata, "speakerUserId"),
    senderName: metadataText(metadata, "speakerName"),
    transcriptPhase:
      metadata?.transcriptPhase === "bot" || metadata?.transcriptPhase === "live_agent"
        ? metadata.transcriptPhase
        : null,
    speakerRef: metadataText(metadata, "speaker"),
  };
}

type SetupSpeakerRow = {
  id: string;
  ext: string | null;
  email: string | null;
  name: string | null;
};

function speakerDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function matchSetupSpeaker(speaker: string, users: SetupSpeakerRow[]): SetupSpeakerRow | null {
  const digits = speakerDigits(speaker);
  const email = speaker.trim().toLowerCase();
  const byEmail = users.find((user) => user.email && user.email.toLowerCase() === email);
  if (byEmail) return byEmail;
  if (digits && digits.length <= 6) {
    const byExt = users.find((user) => user.ext && speakerDigits(user.ext) === digits);
    if (byExt) return byExt;
  }
  const byId = users.find((user) => user.id === speaker || (digits && user.id === digits));
  if (byId) return byId;
  if (digits) {
    return users.find((user) => user.ext && speakerDigits(user.ext) === digits) ?? null;
  }
  return null;
}

async function attachSpeakerIdentity(
  db: DbClient,
  organizationId: string,
  messages: MappedMessage[],
): Promise<MessageRecord[]> {
  const speakers = [
    ...new Set(
      messages
        .filter((message) => message.senderType === "agent" && message.speakerRef)
        .map((message) => message.speakerRef as string),
    ),
  ];
  const emails = speakers.filter((speaker) => speaker.includes("@")).map((speaker) => speaker.toLowerCase());
  const keys = speakers.map((speaker) => speakerDigits(speaker) || speaker);
  let users: SetupSpeakerRow[] = [];
  if (speakers.length > 0) {
    try {
    users = await db.$queryRaw<SetupSpeakerRow[]>`
      SELECT
        id::text AS id,
        ext::text AS ext,
        work_email AS email,
        NULLIF(btrim(concat_ws(' ', first_name, last_name)), '') AS name
      FROM accounts.setup_users
      WHERE organization_id = ${organizationId}::bigint
        AND (
          ext::text = ANY(${keys}::text[])
          OR id::text = ANY(${keys}::text[])
          OR lower(work_email) = ANY(${emails.length > 0 ? emails : [""]}::text[])
        )
    `;
    } catch {
      users = [];
    }
  }

  return messages.map(({ speakerRef, ...message }) => {
    if (message.senderType !== "agent" || !speakerRef) return message;
    const matched = matchSetupSpeaker(speakerRef, users);
    if (!matched) return message;
    return {
      ...message,
      senderUserId: matched.id,
      senderName: matched.name || message.senderName || null,
    };
  });
}

function mapAttachment(row: AttachmentRow): AttachmentRecord {
  return {
    id: rowEntityId(row.id)!,
    messageId: rowEntityId(row.message_id)!,
    externalId: row.external_id,
    storageKey: row.storage_key,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    checksumSha256: row.checksum_sha256,
    downloadUrl: row.download_url,
    status: row.status,
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  };
}

function mapReceipt(row: MessageReceiptRow): MessageReceiptRecord {
  return {
    id: rowEntityId(row.id)!,
    conversationId: rowEntityId(row.conversation_id)!,
    messageId: rowEntityId(row.message_id)!,
    recipientType: row.recipient_type,
    recipientRef: row.recipient_ref,
    status: row.status,
    sentAt: row.sent_at?.toISOString() ?? null,
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    readAt: row.read_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function startConversation(
  db: DbClient,
  organizationId: string,
  input: z.infer<typeof startConversationSchema>,
  options: { deferSideEffects?: boolean } = {},
): Promise<{ conversation: ConversationRecord; sessionId: string }> {
  const payload = startConversationSchema.parse(input);
  const providerThreadId = `${payload.webchatId}:${payload.visitorId}`;
  const sessionExternalThreadId =
    payload.externalThreadId ??
    (payload.conversationId && !/^\d+$/.test(payload.conversationId)
      ? payload.conversationId
      : randomUUID());
  const tokenHash = createHash("sha256").update(`${payload.webchatId}:${payload.visitorId}`).digest("hex");

  const openConversation = await findOpenWebchatConversation(
    db,
    organizationId,
    payload.webchatId,
    payload.visitorId,
  );

  let conversationRow: ConversationRow;
  let sessionId: string;
  let created = false;
  let previousConversationId: string | null = null;

  const channelConfigId = await resolveWebchatChannelConfigId(
    db,
    organizationId,
    payload.webchatId,
  );

  if (openConversation) {
    if (!openConversation.channel_config_id && channelConfigId) {
      await db.$executeRaw`
        UPDATE ccass.conversations
        SET channel_config_id = ${channelConfigId}::bigint,
            updated_at = NOW()
        WHERE id = ${openConversation.id}::bigint
          AND organization_id = ${organizationId}::bigint
          AND channel_config_id IS NULL
      `;
      openConversation.channel_config_id = channelConfigId;
    }
    conversationRow = openConversation;
    sessionId = await upsertWebchatSessionForConversation(db, organizationId, {
      conversationId: openConversation.id,
      webchatId: payload.webchatId,
      visitorId: payload.visitorId,
      tokenHash,
      pageOrigin: payload.pageOrigin ?? null,
      pageUrl: payload.pageUrl ?? null,
      consent: payload.consent ?? null,
      prechatAnswers: payload.prechatAnswers ?? null,
    });
  } else {
    previousConversationId = await findPreviousClosedWebchatConversation(
      db,
      organizationId,
      payload.webchatId,
      payload.visitorId,
    );

    const insertedRows = await db.$queryRaw<ConversationRow[]>`
      INSERT INTO ccass.conversations (
        organization_id, channel, external_thread_id, provider_thread_id,
        previous_conversation_id, webchat_id, visitor_id, visitor_session_token,
        queue_id, channel_config_id, status, bot_active, nlp_enabled, live_agent_enabled
      ) VALUES (
        ${organizationId}::bigint,
        'webchat',
        ${sessionExternalThreadId},
        ${providerThreadId},
        ${previousConversationId}::bigint,
        ${payload.webchatId},
        ${payload.visitorId},
        ${sessionExternalThreadId},
        ${payload.queueId ?? null}::bigint,
        ${channelConfigId}::bigint,
        'bot_active',
        TRUE,
        ${payload.nlpEnabled ?? true},
        ${payload.liveAgentEnabled ?? true}
      )
      ON CONFLICT (organization_id, channel, external_thread_id) DO UPDATE
        SET
          updated_at = NOW(),
          channel_config_id = COALESCE(
            ccass.conversations.channel_config_id,
            EXCLUDED.channel_config_id
          )
      RETURNING *
    `;
    const inserted = insertedRows[0];
    if (!inserted) {
      throw Object.assign(new Error("Failed to start webchat conversation"), { status: 500 });
    }
    conversationRow = inserted;
    created = true;

    sessionId = await upsertWebchatSessionForConversation(db, organizationId, {
      conversationId: inserted.id,
      webchatId: payload.webchatId,
      visitorId: payload.visitorId,
      tokenHash,
      pageOrigin: payload.pageOrigin ?? null,
      pageUrl: payload.pageUrl ?? null,
      consent: payload.consent ?? null,
      prechatAnswers: payload.prechatAnswers ?? null,
    });

    await db.$executeRaw`
      INSERT INTO ccass.conversation_participants (
        organization_id, conversation_id, participant_type, identity_ref
      )
      SELECT ${organizationId}::bigint, ${inserted.id}::bigint, 'visitor', ${payload.visitorId}
      WHERE NOT EXISTS (
        SELECT 1
        FROM ccass.conversation_participants existing
        WHERE existing.conversation_id = ${inserted.id}::bigint
          AND existing.participant_type = 'visitor'
          AND existing.identity_ref = ${payload.visitorId}
      )
    `;
  }

  const conversation = mapConversation(conversationRow);
  const conversationId = conversation.id;
  const prechatIdentity = extractPrechatIdentity(payload.prechatAnswers);
  await resolveInboundConversationContact(db, organizationId, conversationId, {
    channel: "webchat",
    visitorId: payload.visitorId,
    email: prechatIdentity.email,
    phone: prechatIdentity.phone,
    displayName: prechatIdentity.displayName,
  });
  const linkedConversation =
    (await getConversation(db, organizationId, conversationId)) ?? conversation;

  if (!options.deferSideEffects) {
    if (created) {
      await projectInteractionEvent(db, organizationId, {
        conversationId,
        eventType: "conversation.started",
        metadata: {
          webchatId: payload.webchatId,
          visitorId: payload.visitorId,
          channel: "webchat",
          previousConversationId,
        },
      });
    }

    if ((payload.nlpEnabled ?? true) && created) {
      await ensureNlpConversation(db, organizationId, conversationId, "webchat_bot");
    }
  }

  return { conversation: linkedConversation, sessionId: rowEntityId(sessionId)! };
}

export async function getConversation(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  options?: { channel?: string | null },
): Promise<ConversationRecord | null> {
  const channel = options?.channel?.trim() || null;
  const rows = await db.$queryRaw<ConversationRow[]>`
    SELECT
      conversation.*,
      CASE
        WHEN conversation.channel = 'email' THEN jsonb_build_object(
          'subject', conversation.subject,
          'sender', conversation.visitor_id,
          'summary', latest_turn.summary,
          'intent', latest_turn.intent,
          'sentiment', latest_turn.sentiment,
          'importantFacts', COALESCE(latest_turn.important_facts, '[]'::jsonb),
          'knowledgeReferences', COALESCE(latest_turn.knowledge_references, '[]'::jsonb),
          'waitSeconds', GREATEST(
            0,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(conversation.queued_at, conversation.created_at)))::int
          )
        )
        ELSE NULL
      END AS email_handoff_context
    FROM ccass.conversations conversation
    LEFT JOIN LATERAL (
      SELECT turn.*
      FROM ccass.nlp_turns turn
      WHERE turn.organization_id = conversation.organization_id
        AND turn.conversation_id = conversation.id
      ORDER BY turn.created_at DESC
      LIMIT 1
    ) latest_turn ON TRUE
    WHERE conversation.organization_id = ${organizationId}::bigint
      AND conversation.id = ${conversationId}::bigint
      AND (${channel}::text IS NULL OR conversation.channel = ${channel})
    LIMIT 1
  `;
  return rows[0] ? mapConversation(rows[0]) : null;
}

export async function listConversationMessages(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<MessageRecord[]> {
  const rows = await db.$queryRaw<MessageRow[]>`
    SELECT
      message.*,
      COALESCE(
        jsonb_agg(to_jsonb(attachment) ORDER BY attachment.created_at)
          FILTER (WHERE attachment.id IS NOT NULL),
        '[]'::jsonb
      ) AS attachments
    FROM ccass.conversation_messages message
    LEFT JOIN ccass.conversation_message_attachments attachment
      ON attachment.message_id = message.id
      AND attachment.organization_id = message.organization_id
    WHERE message.organization_id = ${organizationId}::bigint
      AND message.conversation_id = ${conversationId}::bigint
    GROUP BY message.id
    ORDER BY message.created_at ASC
  `;
  return attachSpeakerIdentity(db, organizationId, rows.map(mapMessage));
}

export type PaginatedMessagesResult = {
  messages: MessageRecord[];
  total: number;
  offset: number;
  hasMore: boolean;
};

export async function listConversationMessagesPaginated(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  params: z.infer<typeof messagesQuerySchema>,
): Promise<PaginatedMessagesResult> {
  const limit = params.limit ?? 30;
  const anchor = params.anchor ?? "end";
  let offset = params.offset ?? 0;

  const countRows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM ccass.conversation_messages
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
  `;
  const total = Number(countRows[0]?.count ?? 0);

  if (anchor === "end" && offset === 0) {
    offset = Math.max(0, total - limit);
  }

  const rows = await db.$queryRaw<MessageRow[]>`
    SELECT
      message.*,
      COALESCE(
        jsonb_agg(to_jsonb(attachment) ORDER BY attachment.created_at)
          FILTER (WHERE attachment.id IS NOT NULL),
        '[]'::jsonb
      ) AS attachments
    FROM ccass.conversation_messages message
    LEFT JOIN ccass.conversation_message_attachments attachment
      ON attachment.message_id = message.id
      AND attachment.organization_id = message.organization_id
    WHERE message.organization_id = ${organizationId}::bigint
      AND message.conversation_id = ${conversationId}::bigint
    GROUP BY message.id
    ORDER BY message.created_at ASC
    OFFSET ${offset} LIMIT ${limit}
  `;

  return {
    messages: await attachSpeakerIdentity(db, organizationId, rows.map(mapMessage)),
    total,
    offset,
    hasMore: offset > 0,
  };
}

export type VisitorInteractionRecord = {
  id: string;
  conversationId: string;
  messageId: string;
  channel: string;
  queueId: string | null;
  subject: string | null;
  summary: string;
  occurredAt: string;
};

type VisitorInteractionRow = {
  conversation_id: string;
  message_id: string | null;
  channel: string;
  queue_id: string | null;
  subject: string | null;
  summary: string | null;
  occurred_at: Date;
};

export async function listVisitorInteractions(
  db: DbClient,
  organizationId: string,
  visitorId: string,
  params: z.infer<typeof interactionsQuerySchema> & { handledByUserId?: string },
): Promise<{
  interactions: VisitorInteractionRecord[];
  total: number;
  offset: number;
  hasMore: boolean;
}> {
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 15;
  const handledByUserId = params.handledByUserId ?? null;

  const countRows = await db.$queryRawUnsafe<{ count: bigint }[]>(
    `
    SELECT COUNT(*)::bigint AS count
    FROM ccass.conversations c
    WHERE c.organization_id = $1::bigint
      AND c.visitor_id = $2
      AND (
        $3::bigint IS NULL
        OR c.assigned_user_id = $3::bigint
        OR EXISTS (
          SELECT 1
          FROM ccass.conversation_assignments ca
          INNER JOIN ccass.agents a
            ON a.id = ca.agent_id
           AND a.organization_id = ca.organization_id
          WHERE ca.conversation_id = c.id
            AND ca.organization_id = c.organization_id
            AND a.setup_user_id = $3::bigint
            AND ca.state IN ('accepted', 'ended')
        )
      )
    `,
    organizationId,
    visitorId,
    handledByUserId,
  );
  const total = Number(countRows[0]?.count ?? 0);

  const rows = await db.$queryRawUnsafe<VisitorInteractionRow[]>(
    `
    SELECT
      c.id AS conversation_id,
      anchor.id AS message_id,
      c.channel,
      c.queue_id,
      c.subject,
      COALESCE(
        (
          SELECT body
          FROM ccass.conversation_messages preview
          WHERE preview.conversation_id = c.id
            AND preview.organization_id = c.organization_id
          ORDER BY preview.created_at DESC
          LIMIT 1
        ),
        ''
      ) AS summary,
      c.updated_at AS occurred_at
    FROM ccass.conversations c
    LEFT JOIN LATERAL (
      SELECT m.id
      FROM ccass.conversation_messages m
      WHERE m.conversation_id = c.id
        AND m.organization_id = c.organization_id
      ORDER BY
        CASE WHEN m.sender_type = 'customer' THEN 0 ELSE 1 END,
        m.created_at ASC
      LIMIT 1
    ) anchor ON TRUE
    WHERE c.organization_id = $1::bigint
      AND c.visitor_id = $2
      AND (
        $3::bigint IS NULL
        OR c.assigned_user_id = $3::bigint
        OR EXISTS (
          SELECT 1
          FROM ccass.conversation_assignments ca
          INNER JOIN ccass.agents a
            ON a.id = ca.agent_id
           AND a.organization_id = ca.organization_id
          WHERE ca.conversation_id = c.id
            AND ca.organization_id = c.organization_id
            AND a.setup_user_id = $3::bigint
            AND ca.state IN ('accepted', 'ended')
        )
      )
    ORDER BY c.updated_at DESC
    OFFSET $4 LIMIT $5
    `,
    organizationId,
    visitorId,
    handledByUserId,
    offset,
    limit,
  );

  const interactions = rows
    .filter((row) => row.message_id)
    .map((row) => ({
      id: `hist-${serializeEntityIdOptional(row.conversation_id)}`,
      conversationId: serializeEntityIdOptional(row.conversation_id)!,
      messageId: serializeEntityIdOptional(row.message_id)!,
      channel: row.channel,
      queueId: serializeEntityIdOptional(row.queue_id),
      subject: row.subject,
      summary: row.summary ?? "",
      occurredAt: row.occurred_at.toISOString(),
    }));

  return {
    interactions,
    total,
    offset,
    hasMore: offset + rows.length < total,
  };
}

export type AppendConversationMessageResult = {
  message: MessageRecord;
  reopened: boolean;
  contactEnrichment: ContactEnrichmentResult | null;
};

async function reopenResolvedConversationForCustomer(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  const reopenedRows = await db.$queryRaw<{ id: string; channel: string }[]>`
    UPDATE ccass.conversations
    SET
      status = CASE WHEN channel = 'email' THEN 'queued' ELSE 'bot_active' END,
      lifecycle_state = CASE WHEN channel = 'email' THEN 'waiting' ELSE 'bot' END,
      bot_active = CASE WHEN channel = 'email' THEN FALSE ELSE TRUE END,
      resolved_at = NULL,
      closed_at = NULL,
      ended_at = NULL,
      end_reason = NULL,
      end_actor = NULL,
      disposition_code = NULL,
      disposition_note = NULL,
      resolution_code = NULL,
      resolution_summary = NULL,
      resolution_data = '{}'::jsonb,
      assigned_agent_id = NULL,
      assigned_user_id = NULL,
      assigned_at = NULL,
      queued_at = CASE WHEN channel = 'email' THEN NOW() ELSE NULL END,
      handoff_reason = NULL,
      updated_at = NOW()
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
      AND status IN ('resolved', 'closed')
    RETURNING id, channel
  `;
  if (reopenedRows.length === 0) return false;

  await db.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET state = 'ended', ended_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state IN ('offered', 'accepted')
  `;
  await db.$executeRaw`
    UPDATE ccass.webchat_sessions
    SET
      connection_state = 'connected',
      disconnected_at = NULL,
      ended_at = NULL,
      end_reason = NULL,
      ended_by = NULL,
      updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
  `;

  const reopenedChannel = reopenedRows[0]?.channel;
  if (reopenedChannel && reopenedChannel !== "email") {
    const runtimeType =
      reopenedChannel === "whatsapp"
        ? "whatsapp_bot"
        : reopenedChannel === "instagram"
          ? "instagram_bot"
          : reopenedChannel === "facebook"
            ? "facebook_bot"
            : "webchat_bot";
    await ensureNlpConversation(db, organizationId, conversationId, runtimeType);
  }
  return true;
}

export async function appendConversationMessage(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  input: z.infer<typeof appendMessageSchema>,
  options: {
    deferProjection?: boolean;
    deferContactEnrichment?: boolean;
    allowInactiveBot?: boolean;
    occurredAt?: Date | null;
  } = {},
): Promise<AppendConversationMessageResult> {
  const payload = appendMessageSchema.parse(input);
  const channelRows = await db.$queryRaw<{ channel: string; bot_active: boolean }[]>`
    SELECT channel, bot_active
    FROM ccass.conversations
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const conversationChannel = channelRows[0]?.channel;
  const conversationBotActive = channelRows[0]?.bot_active ?? false;
  // Social channels (WhatsApp / Instagram / Facebook) open a new session via
  // provider_thread_id ingest instead of reopening a resolved conversation row.
  const reopened =
    conversationChannel !== "email" &&
    conversationChannel !== "webchat" &&
    conversationChannel !== "whatsapp" &&
    conversationChannel !== "instagram" &&
    conversationChannel !== "facebook" &&
    !isCallChannel(conversationChannel) &&
    payload.senderType === "customer" &&
    payload.direction === "inbound"
      ? await reopenResolvedConversationForCustomer(db, organizationId, conversationId)
      : false;
  const externalId = payload.externalId ?? randomUUID();
  const needsDelivery =
    payload.direction === "outbound" &&
    (payload.senderType === "agent" || payload.senderType === "system");

  const rows = await db.$queryRaw<MessageRow[]>`
    WITH eligible_conversation AS (
      SELECT id
      FROM ccass.conversations
      WHERE id = ${conversationId}::bigint
        AND organization_id = ${organizationId}::bigint
        AND (
          ${payload.senderType !== "bot"}
          OR bot_active = TRUE
          OR ${Boolean(options.allowInactiveBot)}
        )
      FOR UPDATE
    ),
    message AS (
      INSERT INTO ccass.conversation_messages (
        organization_id, conversation_id, external_id,
        sender_type, direction, visibility, body, model_metadata, delivery_state, delivered_at,
        created_at
      )
      SELECT
        ${organizationId}::bigint,
        eligible_conversation.id,
        ${externalId},
        ${payload.senderType},
        ${payload.direction},
        ${payload.visibility},
        ${payload.body},
        ${payload.modelMetadata ? JSON.stringify(payload.modelMetadata) : null}::jsonb,
        ${needsDelivery ? "pending" : "delivered"},
        ${needsDelivery ? null : new Date()},
        COALESCE(${options.occurredAt ?? null}::timestamptz, NOW())
      FROM eligible_conversation
      ON CONFLICT (organization_id, external_id) DO UPDATE
        SET body = EXCLUDED.body
      RETURNING *
    ),
    conversation_update AS (
      UPDATE ccass.conversations
      SET
        updated_at = NOW(),
        event_sequence = COALESCE(event_sequence, 0) + 1
      WHERE id = ${conversationId}::bigint
        AND organization_id = ${organizationId}::bigint
      RETURNING id
    )
    SELECT message.*
    FROM message, conversation_update
  `;

  if (!rows[0]) {
    const isBotOutput = payload.senderType === "bot";
    throw Object.assign(
      new Error(
        isBotOutput
          ? "Bot output is disabled for this conversation"
          : "Conversation not found",
      ),
      { status: isBotOutput ? 409 : 404 },
    );
  }

  if (!options.deferProjection) {
    await projectInteractionEvent(db, organizationId, {
      conversationId,
      messageId: rows[0]!.id,
      eventType: "message.created",
      metadata: {
        senderType: payload.senderType,
        direction: payload.direction,
      },
    });
  }

  let contactEnrichment: ContactEnrichmentResult | null = null;
  if (
    !options.deferContactEnrichment &&
    payload.senderType === "customer" &&
    payload.direction === "inbound"
  ) {
    try {
      contactEnrichment = await maybeEnrichContactFromCustomerMessage(
        db,
        organizationId,
        conversationId,
        {
          messageId: rows[0]!.id,
          body: payload.body,
          botActive: conversationBotActive,
        },
      );
    } catch {
      // Message ingest must succeed even when contact enrichment/merge fails.
      contactEnrichment = null;
    }
    if (
      contactEnrichment &&
      contactEnrichment.outcome !== "no_change" &&
      contactEnrichment.outcome !== "confirmation_required" &&
      !contactEnrichment.idempotentReplay
    ) {
      emitContactEnriched(organizationId, conversationId, contactEnrichment);
    }
  }

  return { message: mapMessage(rows[0]!), reopened, contactEnrichment };
}

export async function recordMessageReceipt(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  input: z.infer<typeof messageReceiptSchema>,
): Promise<MessageReceiptRecord> {
  const payload = messageReceiptSchema.parse(input);
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : new Date();
  const rows = await db.$queryRaw<MessageReceiptRow[]>`
    INSERT INTO ccass.message_receipts (
      organization_id, conversation_id, message_id, recipient_type, recipient_ref,
      status, sent_at, delivered_at, read_at
    )
    SELECT
      ${organizationId}::bigint,
      message.conversation_id,
      message.id,
      ${payload.recipientType},
      ${payload.recipientRef},
      ${payload.status},
      ${occurredAt},
      ${payload.status === "delivered" || payload.status === "read" ? occurredAt : null},
      ${payload.status === "read" ? occurredAt : null}
    FROM ccass.conversation_messages message
    WHERE message.id = ${payload.messageId}::bigint
      AND message.conversation_id = ${conversationId}::bigint
      AND message.organization_id = ${organizationId}::bigint
    ON CONFLICT (organization_id, message_id, recipient_type, recipient_ref) DO UPDATE
    SET
      status = CASE
        WHEN CASE EXCLUDED.status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END
           > CASE ccass.message_receipts.status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END
        THEN EXCLUDED.status
        ELSE ccass.message_receipts.status
      END,
      sent_at = COALESCE(ccass.message_receipts.sent_at, EXCLUDED.sent_at),
      delivered_at = COALESCE(ccass.message_receipts.delivered_at, EXCLUDED.delivered_at),
      read_at = COALESCE(ccass.message_receipts.read_at, EXCLUDED.read_at),
      updated_at = NOW()
    RETURNING *
  `;
  const receipt = rows[0];
  if (!receipt) {
    throw Object.assign(new Error("Message not found in conversation"), { status: 404 });
  }

  await db.$executeRaw`
    UPDATE ccass.conversation_messages
    SET
      delivery_state = CASE
        WHEN ${receipt.status} = 'read' THEN 'read'
        WHEN ${receipt.status} = 'delivered' AND delivery_state NOT IN ('read') THEN 'delivered'
        ELSE delivery_state
      END,
      sent_at = COALESCE(sent_at, ${receipt.sent_at ?? occurredAt}),
      delivered_at = CASE
        WHEN ${receipt.delivered_at}::timestamptz IS NOT NULL
          THEN COALESCE(delivered_at, ${receipt.delivered_at})
        ELSE delivered_at
      END
    WHERE id = ${payload.messageId}::bigint
      AND organization_id = ${organizationId}::bigint
  `;
  return mapReceipt(receipt);
}

export async function addMessageAttachmentMetadata(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
  input: z.infer<typeof attachmentMetadataSchema>,
): Promise<AttachmentRecord> {
  const payload = attachmentMetadataSchema.parse(input);
  const rows = await db.$queryRaw<AttachmentRow[]>`
    INSERT INTO ccass.conversation_message_attachments (
      organization_id, conversation_id, message_id, external_id, storage_key,
      file_name, content_type, byte_size, checksum_sha256, download_url, status, metadata
    )
    SELECT
      ${organizationId}::bigint,
      message.conversation_id,
      message.id,
      ${payload.externalId ?? null},
      ${payload.storageKey},
      ${payload.fileName},
      ${payload.contentType},
      ${payload.byteSize}::bigint,
      ${payload.checksumSha256 ?? null},
      ${payload.downloadUrl ?? null},
      ${payload.status},
      ${JSON.stringify(payload.metadata ?? {})}::jsonb
    FROM ccass.conversation_messages message
    WHERE message.id = ${messageId}::bigint
      AND message.conversation_id = ${conversationId}::bigint
      AND message.organization_id = ${organizationId}::bigint
    ON CONFLICT (organization_id, external_id) DO UPDATE
      SET
        storage_key = EXCLUDED.storage_key,
        file_name = EXCLUDED.file_name,
        content_type = EXCLUDED.content_type,
        byte_size = EXCLUDED.byte_size,
        checksum_sha256 = EXCLUDED.checksum_sha256,
        download_url = EXCLUDED.download_url,
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata
    RETURNING *
  `;
  const attachment = rows[0];
  if (!attachment) {
    throw Object.assign(new Error("Message not found in conversation"), { status: 404 });
  }

  await db.$executeRaw`
    UPDATE ccass.conversation_messages
    SET
      message_type = CASE WHEN body = '' THEN 'attachment' ELSE 'mixed' END,
      attachment_count = (
        SELECT COUNT(*)::int
        FROM ccass.conversation_message_attachments
        WHERE organization_id = ${organizationId}::bigint
          AND message_id = ${messageId}::bigint
      )
    WHERE id = ${messageId}::bigint
      AND organization_id = ${organizationId}::bigint
  `;
  return mapAttachment(attachment);
}

export async function initiateHandoff(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  input: z.infer<typeof handoffSchema>,
  options: { deferSideEffects?: boolean } = {},
): Promise<{
  conversation: ConversationRecord;
  assignment: { agentId: string; userId: string } | null;
  queued: boolean;
  systemMessage: MessageRecord | null;
}> {
  const payload = handoffSchema.parse(input);

  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }

  if (!conversation.liveAgentEnabled) {
    throw Object.assign(new Error("Live agent handoff is disabled for this conversation"), {
      status: 409,
    });
  }

  let allowedQueueIds: string[] | undefined;
  if (conversation.channel === "email") {
    const policy = await resolveEmailMailboxPolicy(db, organizationId, {
      connectionId: conversation.mailboxConnectionId,
      accountEmail: conversation.visitorId ?? "",
    });
    allowedQueueIds = policy?.allowedQueueIds ?? [];
  }

  let queueId = await resolveHandoffQueue(
    db,
    organizationId,
    toRoutableChannel(conversation.channel),
    {
      selectedQueueKey: payload.queueId ?? payload.selectedQueueKey,
      allowedQueueIds,
    },
  );

  if (!queueId) {
    if (conversation.channel === "webchat") {
      const busyMessage = await handleWebchatAgentsUnavailable(
        db,
        organizationId,
        conversationId,
        conversation.webchatId,
        payload.reason,
      );
      const resumedConversation = await getConversation(db, organizationId, conversationId);
      if (!resumedConversation) {
        throw Object.assign(new Error("Conversation not found after routing fallback"), {
          status: 500,
        });
      }
      return {
        conversation: resumedConversation,
        assignment: null,
        queued: false,
        systemMessage: busyMessage,
      };
    }
    if (isSocialRoutableChannel(conversation.channel)) {
      const busyMessage = await handleSocialAgentsUnavailable(
        db,
        organizationId,
        conversationId,
        payload.reason,
      );
      const resumedConversation = await getConversation(db, organizationId, conversationId);
      if (!resumedConversation) {
        throw Object.assign(new Error("Conversation not found after routing fallback"), {
          status: 500,
        });
      }
      return {
        conversation: resumedConversation,
        assignment: null,
        queued: false,
        systemMessage: busyMessage,
      };
    }
    throw Object.assign(new Error("No routing queue configured"), { status: 400 });
  }

  const updatedRows = await db.$queryRaw<ConversationRow[]>`
    UPDATE ccass.conversations
    SET
      status = 'queued',
      lifecycle_state = 'waiting',
      bot_active = FALSE,
      handoff_reason = ${payload.reason},
      queue_id = ${queueId}::bigint,
      queued_at = CASE
        WHEN ${startsNewHandoffEpisode(conversation.status)} THEN NOW()
        ELSE COALESCE(queued_at, NOW())
      END,
      first_response_due_at = CASE
        WHEN channel = 'email' THEN NOW() + (
          COALESCE(
            (
              SELECT email_first_response_sla_seconds
              FROM ccass.routing_policies
              WHERE queue_id = ${queueId}::bigint
                AND organization_id = ${organizationId}::bigint
              LIMIT 1
            ),
            14400
          ) * INTERVAL '1 second'
        )
        ELSE first_response_due_at
      END,
      resolution_due_at = CASE
        WHEN channel = 'email' THEN NOW() + (
          COALESCE(
            (
              SELECT email_resolution_sla_seconds
              FROM ccass.routing_policies
              WHERE queue_id = ${queueId}::bigint
                AND organization_id = ${organizationId}::bigint
              LIMIT 1
            ),
            86400
          ) * INTERVAL '1 second'
        )
        ELSE resolution_due_at
      END,
      sla_status = CASE WHEN channel = 'email' THEN 'running' ELSE sla_status END,
      updated_at = NOW(),
      version = version + 1
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
      AND bot_active = TRUE
    RETURNING *
  `;

  if (updatedRows.length === 0) {
    const current = await getConversation(db, organizationId, conversationId);
    if (!current) {
      throw Object.assign(new Error("Conversation not found"), { status: 404 });
    }
    return {
      conversation: current,
      assignment: null,
      queued: current.status === "queued",
      systemMessage: null,
    };
  }

  await startConversationSla(db, organizationId, conversationId, queueId).catch(() => null);

  let routed = await routeConversationToAgent(db, organizationId, conversationId, queueId, {
    candidateSkills: payload.candidateSkills ?? [],
    reason: payload.reason,
    channel: toRoutableChannel(conversation.channel),
  });

  if (!routed.assigned && conversation.channel === "email") {
    const priorityRows = await db.$queryRaw<{ priority: number }[]>`
      SELECT priority
      FROM ccass.conversations
      WHERE id = ${conversationId}::bigint
        AND organization_id = ${organizationId}::bigint
      LIMIT 1
    `;
    const priority = priorityRows[0]?.priority ?? 0;
    if (priority >= 1) {
      routed = await preemptAndRouteEmail(
        db,
        organizationId,
        conversationId,
        queueId,
        priority,
      );
    }
  }

  if (!routed.assigned && conversation.channel === "webchat") {
    const busyMessage = await handleWebchatAgentsUnavailable(
      db,
      organizationId,
      conversationId,
      conversation.webchatId,
      payload.reason,
      routed.failureReason,
    );
    if (!options.deferSideEffects) {
      await deliverPersistedMessageToWebchat(db, {
        organizationId,
        conversationId,
        body: busyMessage.body,
        messageId: busyMessage.id,
        senderType: "system",
        webchatId: conversation.webchatId,
        visitorId: conversation.visitorId,
      });
    }
    const resumedConversation = await getConversation(db, organizationId, conversationId);
    if (!resumedConversation) {
      throw Object.assign(new Error("Conversation not found after routing fallback"), { status: 500 });
    }
    return {
      conversation: resumedConversation,
      assignment: null,
      queued: false,
      systemMessage: busyMessage,
    };
  }

  if (!routed.assigned && isSocialRoutableChannel(conversation.channel)) {
    const busyMessage = await handleSocialAgentsUnavailable(
      db,
      organizationId,
      conversationId,
      payload.reason,
      routed.failureReason,
    );
    const resumedConversation = await getConversation(db, organizationId, conversationId);
    if (!resumedConversation) {
      throw Object.assign(new Error("Conversation not found after routing fallback"), { status: 500 });
    }
    return {
      conversation: resumedConversation,
      assignment: null,
      queued: false,
      systemMessage: busyMessage,
    };
  }

  if (!options.deferSideEffects) {
    await endNlpConversation(db, organizationId, conversationId, payload.reason);
    const turns = await listNlpTurns(db, organizationId, conversationId);
    if (turns.length > 0) {
      const snippets = turns.slice(-8).map((turn, index) => {
        const bot = turn.botReply?.trim();
        return `${index + 1}. Customer: ${turn.customerText.trim()}${bot ? ` | Bot: ${bot}` : ""}`;
      });
      const facts = turns
        .map((turn) => turn.intent)
        .filter((intent): intent is string => Boolean(intent))
        .slice(0, 8);
      await upsertConversationMemory(db, organizationId, conversationId, {
        rollingSummary: snippets.join("\n").slice(0, 800),
        extractedFacts: facts,
        modelName: "handoff-summary",
      });
    }
  }

  const approvedHandoffMessage =
    conversation.channel === "webchat"
      ? (await getApprovedWebchatServiceMessage(
          db,
          organizationId,
          conversation.webchatId,
          "handoffMessage",
        )) || DEFAULT_HANDOFF_HOLD_MESSAGE
      : null;
  const systemMessage = approvedHandoffMessage
    ? (
        await appendConversationMessage(
          db,
          organizationId,
          conversationId,
          {
            senderType: "system",
            direction: "outbound",
            visibility: "customer",
            body: approvedHandoffMessage,
          },
          { deferProjection: options.deferSideEffects },
        )
      ).message
    : null;

  const finalConversation = await getConversation(db, organizationId, conversationId);
  if (!finalConversation) {
    throw Object.assign(new Error("Conversation not found after handoff"), { status: 500 });
  }

  if (!options.deferSideEffects) {
    await projectInteractionEvent(db, organizationId, {
      conversationId,
      eventType: routed.assigned ? "conversation.assigned" : "conversation.queued",
      metadata: {
        reason: payload.reason,
        queueId,
        agentId: routed.agentId,
      },
    });
  }

  return {
    conversation: finalConversation,
    assignment: routed.assigned
      ? { agentId: routed.agentId!, userId: routed.userId! }
      : null,
    queued: !routed.assigned,
    systemMessage,
  };
}

export async function listWorkspaceConversations(
  db: DbClient,
  organizationId: string,
  userId: string,
  query: z.infer<typeof listQuerySchema>,
): Promise<{ conversations: ConversationRecord[]; hasMore: boolean }> {
  const params = listQuerySchema.parse(query);
  const offset = params.offset;
  const fetchLimit = params.limit + 1;

  const agentRows = await db.$queryRawUnsafe<{ id: string }[]>(
    `
    SELECT id FROM ccass.agents
    WHERE organization_id = $1::bigint AND setup_user_id = $2::bigint
    LIMIT 1
    `,
    organizationId,
    userId,
  );
  const agentId = agentRows[0]?.id ?? null;
  const statusFilter = params.status ?? null;
  const inbox = params.inbox;

  let rows: ConversationRow[];

  if (params.inbox === "transferred") {
    if (!agentId) return { conversations: [], hasMore: false };
    rows = await db.$queryRawUnsafe<ConversationRow[]>(
      `
      SELECT DISTINCT c.*
      FROM ccass.conversations c
      INNER JOIN ccass.conversation_transfers transfer
        ON transfer.conversation_id = c.id
       AND transfer.organization_id = c.organization_id
       AND transfer.from_agent_id = $3::bigint
       AND transfer.state = 'completed'
      WHERE c.organization_id = $1::bigint
        AND ($2::text IS NULL OR c.status = $2)
      ORDER BY c.updated_at DESC
      LIMIT $4 OFFSET $5
      `,
      organizationId,
      statusFilter,
      agentId,
      fetchLimit,
      offset,
    );
  } else if (params.inbox === "closed") {
    if (agentId) {
      rows = await db.$queryRawUnsafe<ConversationRow[]>(
        `
        SELECT *
        FROM (
          SELECT DISTINCT c.*
          FROM ccass.conversations c
          WHERE c.organization_id = $1::bigint
            AND c.status IN ('resolved', 'closed')
            AND (
              c.assigned_user_id = $2::bigint
              OR EXISTS (
                SELECT 1
                FROM ccass.conversation_assignments ca
                WHERE ca.conversation_id = c.id
                  AND ca.organization_id = c.organization_id
                  AND ca.agent_id = $3::bigint
                  AND ca.state IN ('accepted', 'ended')
              )
            )
            AND ($4::text IS NULL OR c.status = $4)
        ) closed_rows
        ORDER BY COALESCE(ended_at, resolved_at, updated_at) DESC
        LIMIT $5 OFFSET $6
        `,
        organizationId,
        userId,
        agentId,
        statusFilter,
        fetchLimit,
        offset,
      );
    } else {
      rows = await db.$queryRawUnsafe<ConversationRow[]>(
        `
        SELECT *
        FROM (
          SELECT DISTINCT c.*
          FROM ccass.conversations c
          WHERE c.organization_id = $1::bigint
            AND c.status IN ('resolved', 'closed')
            AND c.assigned_user_id = $2::bigint
            AND ($3::text IS NULL OR c.status = $3)
        ) closed_rows
        ORDER BY COALESCE(ended_at, resolved_at, updated_at) DESC
        LIMIT $4 OFFSET $5
        `,
        organizationId,
        userId,
        statusFilter,
        fetchLimit,
        offset,
      );
    }
  } else if (params.assignedToMe && agentId) {
    rows = await db.$queryRawUnsafe<ConversationRow[]>(
      `
      SELECT * FROM ccass.conversations
      WHERE organization_id = $1::bigint
        AND (
          assigned_agent_id = $2::bigint
          OR EXISTS (
            SELECT 1 FROM ccass.conversation_transfers transfer
            WHERE transfer.conversation_id = conversations.id
              AND transfer.organization_id = conversations.organization_id
              AND (
                transfer.from_agent_id = $2::bigint
                OR transfer.requested_agent_id = $2::bigint
                OR transfer.offered_agent_id = $2::bigint
                OR transfer.accepted_agent_id = $2::bigint
              )
              AND transfer.state IN ('offered', 'accepted')
          )
          OR EXISTS (
            SELECT 1 FROM ccass.conversation_assignments offer
            WHERE offer.conversation_id = conversations.id
              AND offer.organization_id = conversations.organization_id
              AND offer.agent_id = $2::bigint
              AND offer.state = 'offered'
          )
        )
        AND ($3::text IS NULL OR status = $3)
        AND (
          $4 = 'all'
          OR ($4 = 'open' AND status NOT IN ('resolved', 'closed'))
          OR ($4 = 'closed' AND status IN ('resolved', 'closed'))
        )
      ORDER BY updated_at DESC
      LIMIT $5 OFFSET $6
      `,
      organizationId,
      agentId,
      statusFilter,
      inbox,
      fetchLimit,
      offset,
    );
  } else if (agentId) {
    rows = await db.$queryRawUnsafe<ConversationRow[]>(
      `
      SELECT DISTINCT c.* FROM ccass.conversations c
      LEFT JOIN ccass.queue_members qm
        ON qm.queue_id = c.queue_id AND qm.agent_id = $2::bigint
      WHERE c.organization_id = $1::bigint
        AND ($3::text IS NULL OR c.status = $3)
        AND (
          $4 = 'all'
          OR ($4 = 'open' AND c.status NOT IN ('resolved', 'closed'))
          OR ($4 = 'closed' AND c.status IN ('resolved', 'closed'))
        )
        AND (
          (c.assigned_agent_id = $2::bigint AND c.status IN ('assigned', 'active'))
          OR EXISTS (
            SELECT 1 FROM ccass.conversation_assignments offer
            WHERE offer.conversation_id = c.id
              AND offer.organization_id = c.organization_id
              AND offer.agent_id = $2::bigint
              AND offer.state = 'offered'
          )
          OR EXISTS (
            SELECT 1
            FROM ccass.conversation_transfers transfer
            WHERE transfer.conversation_id = c.id
              AND transfer.organization_id = c.organization_id
              AND (
                transfer.from_agent_id = $2::bigint
                OR transfer.requested_agent_id = $2::bigint
                OR transfer.offered_agent_id = $2::bigint
                OR transfer.accepted_agent_id = $2::bigint
              )
              AND transfer.state IN ('offered', 'accepted')
          )
          OR (
            c.status = 'queued'
            AND qm.agent_id IS NOT NULL
            AND c.assigned_agent_id IS NULL
            AND (
              (c.channel = 'email' AND qm.handles_email = TRUE)
              OR (c.channel = 'whatsapp' AND qm.handles_whatsapp = TRUE)
              OR (c.channel = 'instagram' AND qm.handles_instagram = TRUE)
              OR (c.channel = 'facebook' AND qm.handles_facebook = TRUE)
              OR (
                c.channel NOT IN ('email', 'whatsapp', 'instagram', 'facebook')
                AND qm.handles_chat = TRUE
              )
            )
          )
          OR (
            c.status IN ('resolved', 'closed')
            AND (
              c.assigned_user_id = $5::bigint
              OR EXISTS (
                SELECT 1
                FROM ccass.conversation_assignments ca
                WHERE ca.conversation_id = c.id
                  AND ca.organization_id = c.organization_id
                  AND ca.agent_id = $2::bigint
                  AND ca.state IN ('accepted', 'ended')
              )
            )
          )
        )
      ORDER BY c.updated_at DESC
      LIMIT $6 OFFSET $7
      `,
      organizationId,
      agentId,
      statusFilter,
      inbox,
      userId,
      fetchLimit,
      offset,
    );
  } else {
    rows = await db.$queryRawUnsafe<ConversationRow[]>(
      `
      SELECT * FROM ccass.conversations
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2)
        AND (
          $3 = 'all'
          OR ($3 = 'open' AND status NOT IN ('resolved', 'closed'))
          OR (
            $3 = 'closed'
            AND status IN ('resolved', 'closed')
            AND assigned_user_id = $4::bigint
          )
        )
      ORDER BY updated_at DESC
      LIMIT $5 OFFSET $6
      `,
      organizationId,
      statusFilter,
      inbox,
      userId,
      fetchLimit,
      offset,
    );
  }

  const hasMore = rows.length > params.limit;
  return {
    conversations: rows.slice(0, params.limit).map(mapConversation),
    hasMore,
  };
}

export async function listPendingOfferConversationIdsForAgent(
  db: DbClient,
  organizationId: string,
  agentId: string,
  conversationIds: string[],
): Promise<Set<string>> {
  if (conversationIds.length === 0) return new Set();
  const rows = await db.$queryRaw<{ conversation_id: string }[]>`
    SELECT DISTINCT conversation_id
    FROM ccass.conversation_assignments
    WHERE organization_id = ${organizationId}::bigint
      AND agent_id = ${agentId}::bigint
      AND state = 'offered'
      AND conversation_id = ANY(${conversationIds}::bigint[])
  `;
  return new Set(rows.map((row) => String(row.conversation_id)));
}

export type WorkspaceConversationPresentation = ConversationRecord & {
  queueName: string | null;
  mailboxEmail: string | null;
};

async function loadQueueNamesMap(
  db: DbClient,
  organizationId: string,
  queueIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(queueIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db.$queryRaw<{ id: string; name: string }[]>`
    SELECT id::text AS id, name
    FROM accounts.setup_ccaas_queues
    WHERE organization_id = ${organizationId}::bigint
      AND id = ANY(${unique.map((id) => BigInt(id))}::bigint[])
  `;
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function loadMailboxEmailsMap(
  db: DbClient,
  organizationId: string,
  connectionIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(connectionIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db.$queryRaw<{ id: string; account_email: string }[]>`
    SELECT
      cc.id::text AS id,
      COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email
    FROM accounts.setup_channel_configs cc
    INNER JOIN accounts.setup_email_configs ec
      ON ec.channel_config_id = cc.id
    LEFT JOIN accounts.mail_oauth_connections oauth
      ON oauth.id = ec.oauth_connection_id
    WHERE cc.organization_id = ${organizationId}::bigint
      AND cc.id = ANY(${unique.map((id) => BigInt(id))}::bigint[])
  `;
  return new Map(
    rows
      .filter((row) => row.account_email?.trim())
      .map((row) => [row.id, row.account_email.trim()]),
  );
}

export async function enrichWorkspaceConversationPresentation(
  db: DbClient,
  organizationId: string,
  conversations: ConversationRecord[],
): Promise<WorkspaceConversationPresentation[]> {
  if (conversations.length === 0) return [];
  const [queueNames, mailboxEmails] = await Promise.all([
    loadQueueNamesMap(
      db,
      organizationId,
      conversations.map((conversation) => conversation.queueId).filter((id): id is string => Boolean(id)),
    ),
    loadMailboxEmailsMap(
      db,
      organizationId,
      conversations
        .filter((conversation) => conversation.channel === "email")
        .map((conversation) => conversation.mailboxConnectionId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]);
  return conversations.map((conversation) => ({
    ...conversation,
    queueName: conversation.queueId ? queueNames.get(conversation.queueId) ?? null : null,
    mailboxEmail:
      conversation.channel === "email" && conversation.mailboxConnectionId
        ? mailboxEmails.get(conversation.mailboxConnectionId) ?? null
        : null,
  }));
}

export async function resolveQueueDisplayNames(
  db: DbClient,
  organizationId: string,
  queueIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  return loadQueueNamesMap(
    db,
    organizationId,
    queueIds.filter((id): id is string => Boolean(id)),
  );
}

export function formatQueueDisplayLabel(
  queueId: string | null | undefined,
  queueName: string | null | undefined,
): string {
  if (queueName?.trim()) return queueName.trim();
  if (!queueId) return "Unassigned";
  return "Support queue";
}

export async function enrichConversationsWithPendingOffer(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversations: ConversationRecord[],
): Promise<
  Array<
    ConversationRecord & {
      pendingOffer: boolean;
      consultParticipant: boolean;
      transfer: ConversationTransferRecord | null;
      transferHistory: ConversationTransferRecord[];
    }
  >
> {
  if (conversations.length === 0) return [];
  const agentRows = await db.$queryRawUnsafe<{ id: string }[]>(
    `
    SELECT id FROM ccass.agents
    WHERE organization_id = $1::bigint AND setup_user_id = $2::bigint
    LIMIT 1
    `,
    organizationId,
    userId,
  );
  const agentId = agentRows[0]?.id ? String(agentRows[0].id) : null;
  if (!agentId) {
    return conversations.map((conversation) => ({
      ...conversation,
      pendingOffer: false,
      consultParticipant: false,
      transfer: null,
      transferHistory: [],
    }));
  }
  const conversationIds = conversations.map((conversation) => conversation.id);
  const [pendingIds, transferRows] = await Promise.all([
    listPendingOfferConversationIdsForAgent(db, organizationId, agentId, conversationIds),
    db.$queryRaw<ConversationTransferRow[]>`
      SELECT
        transfer.*,
        source_agent.display_name AS from_agent_name,
        requested_agent.display_name AS requested_agent_name,
        offered_agent.display_name AS offered_agent_name,
        accepted_agent.display_name AS accepted_agent_name,
        source_queue.name AS from_queue_name,
        target_queue.name AS to_queue_name
      FROM ccass.conversation_transfers transfer
      LEFT JOIN ccass.agents source_agent ON source_agent.id = transfer.from_agent_id
      LEFT JOIN ccass.agents requested_agent ON requested_agent.id = transfer.requested_agent_id
      LEFT JOIN ccass.agents offered_agent ON offered_agent.id = transfer.offered_agent_id
      LEFT JOIN ccass.agents accepted_agent ON accepted_agent.id = transfer.accepted_agent_id
      LEFT JOIN ccass.queues source_queue ON source_queue.id = transfer.from_queue_id
      LEFT JOIN ccass.queues target_queue ON target_queue.id = transfer.to_queue_id
      WHERE transfer.organization_id = ${organizationId}::bigint
        AND transfer.conversation_id = ANY(${conversationIds}::bigint[])
        AND (
          transfer.from_agent_id = ${agentId}::bigint
          OR transfer.offered_agent_id = ${agentId}::bigint
          OR transfer.accepted_agent_id = ${agentId}::bigint
        )
      ORDER BY transfer.conversation_id, transfer.requested_at ASC
    `,
  ]);
  const transferHistory = new Map<string, ConversationTransferRecord[]>();
  for (const row of transferRows) {
    const conversationId = String(row.conversation_id);
    const history = transferHistory.get(conversationId) ?? [];
    history.push(mapConversationTransfer(row));
    transferHistory.set(conversationId, history);
  }
  return conversations.map((conversation) => {
    const history = transferHistory.get(conversation.id) ?? [];
    const transfer = history.at(-1) ?? null;
    const consultParticipant = Boolean(
      transfer &&
        transfer.fromAgentId !== agentId &&
        (transfer.state === "offered" || transfer.state === "accepted") &&
        [
          transfer.requestedAgentId,
          transfer.offeredAgentId,
          transfer.acceptedAgentId,
        ].includes(agentId),
    );
    return {
      ...conversation,
      pendingOffer: pendingIds.has(conversation.id),
      consultParticipant,
      transfer,
      transferHistory: history,
    };
  });
}

export async function assertWorkspaceConversationAccess(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  role: string | null | undefined = undefined,
): Promise<void> {
  // Live Monitoring / supervisor: admins may view any org conversation even if
  // they also have an agent profile linked to their setup user.
  if (role === "admin") return;

  const agentRows = await db.$queryRawUnsafe<{ id: string }[]>(
    `
    SELECT id FROM ccass.agents
    WHERE organization_id = $1::bigint AND setup_user_id = $2::bigint
    LIMIT 1
    `,
    organizationId,
    userId,
  );
  const agentId = agentRows[0]?.id;

  // Users without an agent profile (typical admin-only accounts) may access.
  if (!agentId) return;

  const accessRows = await db.$queryRawUnsafe<{ allowed: boolean }[]>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM ccass.conversations c
      LEFT JOIN ccass.queue_members qm
        ON qm.queue_id = c.queue_id AND qm.agent_id = $2::bigint
      WHERE c.id = $3::bigint
        AND c.organization_id = $1::bigint
        AND (
          c.assigned_agent_id = $2::bigint
          OR (
            c.status IN ('resolved', 'closed')
            AND EXISTS (
              SELECT 1
              FROM ccass.conversation_assignments ca
              WHERE ca.conversation_id = c.id
                AND ca.organization_id = c.organization_id
                AND ca.agent_id = $2::bigint
                AND ca.state IN ('accepted', 'ended')
            )
          )
          OR EXISTS (
            SELECT 1
            FROM ccass.conversation_transfers ct
            WHERE ct.conversation_id = c.id
              AND ct.organization_id = c.organization_id
              AND (
                (ct.from_agent_id = $2::bigint
                  AND ct.state IN ('offered', 'queued', 'accepted', 'requested', 'completed'))
                OR ((ct.offered_agent_id = $2::bigint OR ct.accepted_agent_id = $2::bigint)
                  AND ct.state IN ('offered', 'accepted', 'completed', 'cancelled'))
              )
          )
          OR (
            c.status = 'queued'
            AND c.assigned_agent_id IS NULL
            AND qm.agent_id IS NOT NULL
            AND (
              (c.channel = 'email' AND qm.handles_email = TRUE)
              OR (c.channel = 'whatsapp' AND qm.handles_whatsapp = TRUE)
              OR (c.channel = 'instagram' AND qm.handles_instagram = TRUE)
              OR (c.channel = 'facebook' AND qm.handles_facebook = TRUE)
              OR (
                c.channel NOT IN ('email', 'whatsapp', 'instagram', 'facebook')
                AND qm.handles_chat = TRUE
              )
            )
          )
        )
    ) AS allowed
    `,
    organizationId,
    agentId,
    conversationId,
  );
  if (!accessRows[0]?.allowed) {
    throw Object.assign(new Error("Conversation is not available to this agent"), { status: 403 });
  }
}

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
  return { id: rowEntityId(agent.id)! };
}

export async function acceptConversationOffer(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<{
  conversation: ConversationRecord;
  systemMessage: MessageRecord | null;
  transferFromUserId: string | null;
  transfer: ConversationTransferRecord | null;
}> {
  const agent = await getAgentForUser(db, organizationId, userId);
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  const warmTransferRows = await db.$queryRaw<ConversationTransferRow[]>`
    SELECT *
    FROM ccass.conversation_transfers
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND offered_agent_id = ${agent.id}::bigint
      AND requested_agent_id IS NOT NULL
      AND state = 'offered'
    ORDER BY requested_at DESC
    LIMIT 1
    FOR UPDATE
  `;
  const warmTransfer = warmTransferRows[0];
  if (warmTransfer) {
    const acceptedAssignment = await db.$queryRaw<{ id: string }[]>`
      UPDATE ccass.conversation_assignments
      SET state = 'accepted', accepted_at = NOW(), expires_at = NULL
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND agent_id = ${agent.id}::bigint
        AND state = 'offered'
      RETURNING id::text
    `;
    if (!acceptedAssignment[0]) {
      throw Object.assign(new Error("Offer expired or already handled"), { status: 409 });
    }
    await db.$executeRaw`
      UPDATE ccass.conversation_assignments
      SET state = 'ended', ended_at = NOW(), reason = 'warm_transfer_accepted'
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND agent_id = ${warmTransfer.from_agent_id}::bigint
        AND state = 'accepted'
    `;
    const channel = toRoutableChannel(conversation.channel);
    await db.$executeRaw`
      UPDATE ccass.agent_capacity
      SET active_count = GREATEST(active_count - 1, 0), updated_at = NOW()
      WHERE agent_id = ${warmTransfer.from_agent_id}::bigint AND channel = ${channel}
    `;
    await db.$executeRaw`
      UPDATE ccass.agent_capacity
      SET reserved_count = GREATEST(reserved_count - 1, 0),
          active_count = active_count + 1,
          updated_at = NOW()
      WHERE agent_id = ${agent.id}::bigint AND channel = ${channel}
    `;
    const acceptedRows = await db.$queryRaw<ConversationTransferRow[]>`
      UPDATE ccass.conversation_transfers
      SET state = 'accepted', accepted_agent_id = ${agent.id}::bigint,
          accepted_user_id = ${userId}::bigint, accepted_at = NOW(),
          outcome_reason = 'accepted_awaiting_sender_disposition', updated_at = NOW()
      WHERE id = ${warmTransfer.id}::bigint AND state = 'offered'
      RETURNING *
    `;
    const conversationAccepted = await db.$queryRaw<{ id: string }[]>`
      UPDATE ccass.conversations
      SET status = 'active', lifecycle_state = 'connected',
          queue_id = ${warmTransfer.to_queue_id}::bigint,
          assigned_agent_id = ${agent.id}::bigint,
          assigned_user_id = ${userId}::bigint,
          assigned_at = NOW(), transferred_at = NOW(),
          updated_at = NOW(), version = version + 1
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${conversationId}::bigint
        AND assigned_agent_id = ${warmTransfer.from_agent_id}::bigint
        AND status = 'active'
      RETURNING id::text
    `;
    if (!conversationAccepted[0]) {
      throw Object.assign(new Error("Transfer sender no longer owns the conversation"), { status: 409 });
    }
    const updated = await getConversation(db, organizationId, conversationId);
    if (!updated) throw Object.assign(new Error("Conversation not found after accept"), { status: 500 });
    const transfer = await enrichTransferDisplayMetadata(
      db,
      organizationId,
      mapConversationTransfer(acceptedRows[0]!),
    );
    await projectInteractionEvent(db, organizationId, {
      conversationId,
      eventType: "transfer.accepted",
      metadata: {
        transferId: transfer.id,
        fromAgentId: transfer.fromAgentId,
        fromUserId: transfer.fromUserId,
        fromQueueId: transfer.fromQueueId,
        toQueueId: transfer.toQueueId,
        offeredAgentId: transfer.offeredAgentId,
        acceptedAgentId: transfer.acceptedAgentId,
        acceptedUserId: transfer.acceptedUserId,
        channel: transfer.channel,
        acceptedAt: transfer.acceptedAt,
        ringingDurationMs: transferLatencyMs(transfer, transfer.acceptedAt),
      },
    });
    let systemMessage: MessageRecord | null = null;
    if (updated.channel === "webchat" || isSocialRoutableChannel(updated.channel)) {
      const nameRows = await db.$queryRaw<{ display_name: string | null }[]>`
        SELECT display_name
        FROM ccass.agents
        WHERE id = ${agent.id}::bigint
          AND organization_id = ${organizationId}::bigint
        LIMIT 1
      `;
      const agentName = nameRows[0]?.display_name?.trim() || "our agent";
      systemMessage = (
        await appendConversationMessage(db, organizationId, conversationId, {
          senderType: "system",
          direction: "outbound",
          visibility: "customer",
          body: formatConnectedToAgentMessage(agentName),
        })
      ).message;
    }
    return {
      conversation: { ...updated, transfer },
      systemMessage,
      transferFromUserId: transfer.fromUserId,
      transfer,
    };
  }
  if (conversation.assignedAgentId !== agent.id || conversation.status !== "assigned") {
    throw Object.assign(new Error("No pending offer for this conversation"), { status: 409 });
  }

  const assignmentRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM ccass.conversation_assignments
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND agent_id = ${agent.id}::bigint
      AND state = 'offered'
    ORDER BY offered_at DESC
    LIMIT 1
  `;
  if (assignmentRows.length === 0) {
    throw Object.assign(new Error("Offer expired or already handled"), { status: 409 });
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
    WHERE agent_id = ${agent.id}::bigint AND queue_id = ${conversation.queueId}::bigint
    LIMIT 1
  `;
  const channelConcurrency = capacityRows[0]?.channel_concurrency ?? 1;

  const acceptedAssignment = await db.$queryRaw<{ id: string }[]>`
    UPDATE ccass.conversation_assignments
    SET state = 'accepted', accepted_at = NOW(), expires_at = NULL
    WHERE id = ${assignmentRows[0]!.id}::bigint
      AND state = 'offered'
    RETURNING id
  `;
  if (acceptedAssignment.length === 0) {
    throw Object.assign(new Error("Offer expired or already handled"), { status: 409 });
  }
  const acceptedTransferRows = await db.$queryRaw<{ from_user_id: string | null }[]>`
    UPDATE ccass.conversation_transfers
    SET state = 'accepted', accepted_at = NOW(), completed_at = NOW(), updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM ccass.conversation_transfers
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND offered_agent_id = ${agent.id}::bigint
        AND state = 'offered'
      ORDER BY requested_at DESC
      LIMIT 1
    )
    RETURNING from_user_id::text AS from_user_id
  `;
  const transferFromUserId = acceptedTransferRows[0]?.from_user_id
    ? String(acceptedTransferRows[0].from_user_id)
    : null;

  const acceptedConversation = await db.$queryRaw<{ id: string }[]>`
    UPDATE ccass.conversations
    SET
      status = 'active',
      lifecycle_state = 'connected',
      assigned_user_id = COALESCE(assigned_user_id, ${userId}::bigint),
      assigned_agent_id = COALESCE(assigned_agent_id, ${agent.id}::bigint),
      assigned_at = COALESCE(assigned_at, NOW()),
      updated_at = NOW()
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
      AND status = 'assigned'
      AND assigned_agent_id = ${agent.id}::bigint
    RETURNING id
  `;
  if (acceptedConversation.length === 0) {
    throw Object.assign(new Error("Offer expired or already handled"), { status: 409 });
  }

  await db.$executeRaw`
    INSERT INTO ccass.agent_capacity (organization_id, agent_id, channel, max_concurrency, active_count)
    VALUES (${organizationId}::bigint, ${agent.id}::bigint, ${channel}, ${channelConcurrency}, 1)
    ON CONFLICT (agent_id, channel) DO UPDATE
      SET
        reserved_count = GREATEST(ccass.agent_capacity.reserved_count - 1, 0),
        active_count = ccass.agent_capacity.active_count + 1,
        updated_at = NOW()
  `;

  // Web chat and social chats keep the agent's current presence. Capacity still
  // limits how many of those conversations they can hold. Phone calls set Busy separately.

  const updated = await getConversation(db, organizationId, conversationId);
  if (!updated) {
    throw Object.assign(new Error("Conversation not found after accept"), { status: 500 });
  }

  let systemMessage: MessageRecord | null = null;
  if (updated.channel === "webchat" || isSocialRoutableChannel(updated.channel)) {
    const nameRows = await db.$queryRaw<{ display_name: string | null }[]>`
      SELECT display_name
      FROM ccass.agents
      WHERE id = ${agent.id}::bigint
        AND organization_id = ${organizationId}::bigint
      LIMIT 1
    `;
    const agentName = nameRows[0]?.display_name?.trim() || "our agent";
    systemMessage = (
      await appendConversationMessage(db, organizationId, conversationId, {
        senderType: "system",
        direction: "outbound",
        visibility: "customer",
        body: formatConnectedToAgentMessage(agentName),
      })
    ).message;
  }

  return { conversation: updated, systemMessage, transferFromUserId, transfer: null };
}

/** Mark an open transfer as cancelled when the offer cannot be completed. Never restores the sender. */
async function cancelOpenTransferIfNeeded(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await db.$executeRaw`
    UPDATE ccass.conversation_transfers
    SET state = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM ccass.conversation_transfers
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND state IN ('offered', 'queued', 'requested')
      ORDER BY requested_at DESC
      LIMIT 1
    )
  `;
}

export async function rejectConversationOffer(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<{
  conversation: ConversationRecord;
  rerouted: boolean;
  nextUserId: string | null;
  systemMessage?: MessageRecord | null;
  transfer?: ConversationTransferRecord | null;
}> {
  const agent = await getAgentForUser(db, organizationId, userId);
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  const warmTransferRows = await db.$queryRaw<ConversationTransferRow[]>`
    SELECT * FROM ccass.conversation_transfers
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND offered_agent_id = ${agent.id}::bigint
      AND requested_agent_id IS NOT NULL
      AND state = 'offered'
    ORDER BY requested_at DESC LIMIT 1 FOR UPDATE
  `;
  const warmTransfer = warmTransferRows[0];
  if (warmTransfer) {
    const rejected = await db.$queryRaw<{ id: string }[]>`
      UPDATE ccass.conversation_assignments
      SET state = 'rejected', rejected_at = NOW(), expires_at = NULL
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND agent_id = ${agent.id}::bigint
        AND state = 'offered'
      RETURNING id::text
    `;
    if (!rejected[0]) throw Object.assign(new Error("No pending offer for this conversation"), { status: 409 });
    await db.$executeRaw`
      UPDATE ccass.agent_capacity
      SET reserved_count = GREATEST(reserved_count - 1, 0), updated_at = NOW()
      WHERE agent_id = ${agent.id}::bigint
        AND channel = ${toRoutableChannel(conversation.channel)}
    `;
    const rows = await db.$queryRaw<ConversationTransferRow[]>`
      UPDATE ccass.conversation_transfers
      SET state = 'rejected', rejected_at = NOW(), outcome_reason = 'target_rejected',
          updated_at = NOW()
      WHERE id = ${warmTransfer.id}::bigint AND state = 'offered'
      RETURNING *
    `;
    const transfer = await enrichTransferDisplayMetadata(
      db,
      organizationId,
      mapConversationTransfer(rows[0]!),
    );
    await projectInteractionEvent(db, organizationId, {
      conversationId,
      eventType: "transfer.rejected",
      metadata: {
        transferId: transfer.id,
        fromAgentId: transfer.fromAgentId,
        fromUserId: transfer.fromUserId,
        offeredAgentId: agent.id,
        offeredUserId: userId,
        fromQueueId: transfer.fromQueueId,
        toQueueId: transfer.toQueueId,
        channel: transfer.channel,
        reason: transfer.outcomeReason,
        rejectedAt: transfer.rejectedAt,
        ringingDurationMs: transferLatencyMs(transfer, transfer.rejectedAt),
      },
    });
    return { conversation: { ...conversation, transfer }, rerouted: false, nextUserId: null, transfer };
  }
  if (conversation.assignedAgentId !== agent.id || conversation.status !== "assigned") {
    throw Object.assign(new Error("No pending offer for this conversation"), { status: 409 });
  }

  const queueId = conversation.queueId;
  if (!queueId) {
    throw Object.assign(new Error("Conversation has no queue"), { status: 400 });
  }

  const rejectedAssignment = await db.$queryRaw<{ id: string }[]>`
    UPDATE ccass.conversation_assignments
    SET state = 'rejected', rejected_at = NOW(), expires_at = NULL
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND agent_id = ${agent.id}::bigint
      AND state = 'offered'
    RETURNING id
  `;
  if (rejectedAssignment.length === 0) {
    throw Object.assign(new Error("No pending offer for this conversation"), { status: 409 });
  }
  await db.$executeRaw`
    UPDATE ccass.agent_capacity
    SET reserved_count = GREATEST(reserved_count - 1, 0), updated_at = NOW()
    WHERE agent_id = ${agent.id}::bigint
      AND channel = ${toRoutableChannel(conversation.channel)}
  `;
  await db.$executeRaw`
    UPDATE ccass.conversation_transfers
    SET state = 'queued', offered_agent_id = NULL, offered_at = NULL, updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM ccass.conversation_transfers
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND offered_agent_id = ${agent.id}::bigint
        AND state = 'offered'
      ORDER BY requested_at DESC
      LIMIT 1
    )
  `;

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      status = 'queued',
      lifecycle_state = 'waiting',
      assigned_agent_id = NULL,
      assigned_user_id = NULL,
      assigned_at = NULL,
      updated_at = NOW()
    WHERE id = ${conversationId}::bigint AND organization_id = ${organizationId}::bigint
  `;

  if (conversation.channel !== "email" && !isCallChannel(conversation.channel)) {
    await setAgentPresenceByAgentId(db, organizationId, agent.id, "not_ready", {
      userId,
      reasonCode: "offer_rejected",
      source: "agent",
    });
  }

  const triedAssignmentRows = await db.$queryRaw<TriedRoutingAssignment[]>`
    SELECT agent_id, offered_at
    FROM ccass.conversation_assignments
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state IN ('rejected', 'expired')
  `;
  const triedAgentIds = triedAgentIdsForCurrentRoutingCycle(
    triedAssignmentRows,
    conversation.queuedAt,
  );
  const excludeAgentIds = [
    ...new Set([agent.id, ...triedAgentIds]),
  ];

  const rejectPolicyRows = await db.$queryRaw<
    { max_attempts: number; overflow_queue_id: string | null }[]
  >`
    SELECT max_attempts, overflow_queue_id FROM ccass.routing_policies
    WHERE organization_id = ${organizationId}::bigint
      AND queue_id = ${queueId}::bigint
    LIMIT 1
  `;
  const rejectMaxAttempts = rejectPolicyRows[0]?.max_attempts ?? 3;
  let routed: Awaited<ReturnType<typeof routeConversationToAgent>> = {
    assigned: false,
    agentId: null,
    userId: null,
    routingAttemptId: "",
    failureReason: "routing_exhausted",
  };
  if (excludeAgentIds.length < rejectMaxAttempts) {
    routed = await routeConversationToAgent(db, organizationId, conversationId, queueId, {
      reason: "agent_rejected",
      excludeAgentIds,
      channel: toRoutableChannel(conversation.channel),
    });
  } else if (rejectPolicyRows[0]?.overflow_queue_id) {
    const overflowQueueId = rejectPolicyRows[0].overflow_queue_id;
    await db.$executeRaw`
      UPDATE ccass.conversations
      SET queue_id = ${overflowQueueId}::bigint, queued_at = NOW(), updated_at = NOW()
      WHERE id = ${conversationId}::bigint
        AND organization_id = ${organizationId}::bigint
    `;
    routed = await routeConversationToAgent(db, organizationId, conversationId, overflowQueueId, {
      reason: "reject_attempts_exhausted_overflow",
      excludeAgentIds,
      channel: toRoutableChannel(conversation.channel),
    });
  }

  if (!routed.assigned) {
    // Transfer handoff is one-way for the sender: never restore the conversation
    // back to them or surface an "agent not accepted" path.
    await cancelOpenTransferIfNeeded(db, organizationId, conversationId);
  }

  // Social channels resume the bot with a busy message when no agent is available.
  if (!routed.assigned && (conversation.channel === "webchat" || isSocialRoutableChannel(conversation.channel))) {
    const busyMessage =
      conversation.channel === "webchat"
        ? await handleWebchatAgentsUnavailable(
            db,
            organizationId,
            conversationId,
            conversation.webchatId,
            "agent_rejected",
            routed.failureReason,
          )
        : await handleSocialAgentsUnavailable(
            db,
            organizationId,
            conversationId,
            "agent_rejected",
            routed.failureReason,
          );
    return {
      conversation: (await getConversation(db, organizationId, conversationId))!,
      rerouted: false,
      nextUserId: null,
      systemMessage: busyMessage,
    };
  }

  const finalConversation = await getConversation(db, organizationId, conversationId);
  if (!finalConversation) {
    throw Object.assign(new Error("Conversation not found after reject"), { status: 500 });
  }

  return {
    conversation: finalConversation,
    rerouted: routed.assigned,
    nextUserId: routed.userId,
  };
}

export async function expireConversationOffer(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  options: { markAgentAway?: boolean } = {},
): Promise<{
  conversation: ConversationRecord;
  nextUserId: string | null;
  rerouted: boolean;
  timedOutUserId: string | null;
  timedOutPresence: AgentPresenceRecord | null;
  missedContact: AgentMissedContactRecord | null;
  systemMessage: MessageRecord | null;
  transfer?: ConversationTransferRecord | null;
} | null> {
  const expiredRows = await db.$queryRaw<{
    id: string;
    agent_id: string;
    queue_id: string;
    offered_at: Date | null;
  }[]>`
    UPDATE ccass.conversation_assignments
    SET state = 'expired', expired_at = NOW(), expires_at = NULL
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state = 'offered'
      AND id = (
        SELECT id FROM ccass.conversation_assignments
        WHERE organization_id = ${organizationId}::bigint
          AND conversation_id = ${conversationId}::bigint
          AND state = 'offered'
        ORDER BY offered_at DESC
        LIMIT 1
      )
    RETURNING id, agent_id, queue_id, offered_at
  `;
  const expired = expiredRows[0];
  if (!expired) return null;
  const offeredConversation = await getConversation(db, organizationId, conversationId);
  if (!offeredConversation) return null;
  const channel = toRoutableChannel(offeredConversation.channel);

  const warmTransferRows = await db.$queryRaw<ConversationTransferRow[]>`
    UPDATE ccass.conversation_transfers
    SET state = 'expired', expired_at = NOW(), outcome_reason = 'offer_timeout',
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM ccass.conversation_transfers
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND offered_agent_id = ${expired.agent_id}::bigint
        AND requested_agent_id IS NOT NULL
        AND state = 'offered'
      ORDER BY requested_at DESC LIMIT 1
    )
    RETURNING *
  `;
  if (warmTransferRows[0]) {
    await db.$executeRaw`
      UPDATE ccass.agent_capacity
      SET reserved_count = GREATEST(reserved_count - 1, 0), updated_at = NOW()
      WHERE agent_id = ${expired.agent_id}::bigint AND channel = ${channel}
    `;
    const userRows = await db.$queryRaw<{ setup_user_id: string | null }[]>`
      SELECT setup_user_id::text FROM ccass.agents
      WHERE id = ${expired.agent_id}::bigint
        AND organization_id = ${organizationId}::bigint
      LIMIT 1
    `;
    const transfer = await enrichTransferDisplayMetadata(
      db,
      organizationId,
      mapConversationTransfer(warmTransferRows[0]),
    );
    await projectInteractionEvent(db, organizationId, {
      conversationId,
      eventType: "transfer.expired",
      metadata: {
        transferId: transfer.id,
        fromAgentId: transfer.fromAgentId,
        fromUserId: transfer.fromUserId,
        offeredAgentId: expired.agent_id,
        fromQueueId: transfer.fromQueueId,
        toQueueId: transfer.toQueueId,
        channel: transfer.channel,
        reason: transfer.outcomeReason,
        expiredAt: transfer.expiredAt,
        ringingDurationMs: transferLatencyMs(transfer, transfer.expiredAt),
      },
    });
    return {
      conversation: { ...offeredConversation, transfer },
      nextUserId: null,
      rerouted: false,
      timedOutUserId: userRows[0]?.setup_user_id ?? null,
      timedOutPresence: null,
      missedContact: null,
      systemMessage: null,
      transfer,
    };
  }

  const agentRows = await db.$queryRaw<{ setup_user_id: string }[]>`
    SELECT setup_user_id
    FROM ccass.agents
    WHERE id = ${expired.agent_id}::bigint
      AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const timedOutUserId = agentRows[0]?.setup_user_id ?? null;
  let timedOutPresence: AgentPresenceRecord | null = null;
  let missedContact: AgentMissedContactRecord | null = null;
  if (options.markAgentAway !== false && !isCallChannel(offeredConversation.channel)) {
    timedOutPresence = await setAgentPresenceByAgentId(db, organizationId, expired.agent_id, "away", {
      source: "system",
      reasonCode: "offer_timeout",
      userId: timedOutUserId,
    });
    if (timedOutUserId) {
      missedContact = await recordAgentMissedContact(db, organizationId, {
        agentId: expired.agent_id,
        assignedUserId: timedOutUserId,
        conversation: offeredConversation,
        assignmentId: expired.id,
        queueId: expired.queue_id,
        offeredAt: expired.offered_at,
        reason: "offer_timeout",
      });
    }
  }

  await db.$executeRaw`
    UPDATE ccass.agent_capacity
    SET reserved_count = GREATEST(reserved_count - 1, 0), updated_at = NOW()
    WHERE agent_id = ${expired.agent_id}::bigint AND channel = ${channel}
  `;

  await db.$executeRaw`
    UPDATE ccass.conversation_transfers
    SET state = 'queued', offered_agent_id = NULL, offered_at = NULL, updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM ccass.conversation_transfers
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND offered_agent_id = ${expired.agent_id}::bigint
        AND state = 'offered'
      ORDER BY requested_at DESC
      LIMIT 1
    )
  `;

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      status = 'queued',
      lifecycle_state = 'waiting',
      assigned_agent_id = NULL,
      assigned_user_id = NULL,
      updated_at = NOW()
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
      AND status = 'assigned'
      AND assigned_agent_id = ${expired.agent_id}::bigint
  `;

  const policyRows = await db.$queryRaw<
    { max_attempts: number; overflow_queue_id: string | null }[]
  >`
    SELECT max_attempts, overflow_queue_id FROM ccass.routing_policies
    WHERE organization_id = ${organizationId}::bigint
      AND queue_id = ${expired.queue_id}::bigint
    LIMIT 1
  `;
  const triedAssignmentRows = await db.$queryRaw<TriedRoutingAssignment[]>`
    SELECT agent_id, offered_at FROM ccass.conversation_assignments
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state IN ('expired', 'rejected')
  `;
  const triedAgentIds = triedAgentIdsForCurrentRoutingCycle(
    triedAssignmentRows,
    offeredConversation.queuedAt,
  );
  const maxAttempts = policyRows[0]?.max_attempts ?? 3;
  let routed: {
    assigned: boolean;
    userId: string | null;
    failureReason?: RoutingFailureReason;
  } = { assigned: false, userId: null, failureReason: "routing_exhausted" };
  if (triedAgentIds.length < maxAttempts) {
    routed = await routeConversationToAgent(
      db,
      organizationId,
      conversationId,
      expired.queue_id,
      {
        reason: "offer_timeout",
        excludeAgentIds: triedAgentIds,
        channel,
      },
    );
  } else if (policyRows[0]?.overflow_queue_id) {
    const overflowQueueId = policyRows[0].overflow_queue_id;
    await db.$executeRaw`
      UPDATE ccass.conversations
      SET queue_id = ${overflowQueueId}::bigint, queued_at = NOW(), updated_at = NOW()
      WHERE id = ${conversationId}::bigint
        AND organization_id = ${organizationId}::bigint
    `;
    routed = await routeConversationToAgent(
      db,
      organizationId,
      conversationId,
      overflowQueueId,
      {
        reason: "offer_attempts_exhausted_overflow",
        excludeAgentIds: triedAgentIds,
        channel,
      },
    );
  }

  let conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) return null;

  if (!routed.assigned) {
    // Transfer handoff is one-way for the sender: never restore the conversation
    // back to them or surface an "agent not accepted" path.
    await cancelOpenTransferIfNeeded(db, organizationId, conversationId);
  }

  let systemMessage: MessageRecord | null = null;
  if (
    !routed.assigned &&
    (conversation.channel === "webchat" || isSocialRoutableChannel(conversation.channel))
  ) {
    if (conversation.channel === "webchat") {
      systemMessage = await handleWebchatAgentsUnavailable(
        db,
        organizationId,
        conversationId,
        conversation.webchatId,
        "offer_timeout",
        routed.failureReason,
      );
    } else {
      systemMessage = await handleSocialAgentsUnavailable(
        db,
        organizationId,
        conversationId,
        "offer_timeout",
        routed.failureReason,
      );
    }
    conversation = await getConversation(db, organizationId, conversationId);
    if (!conversation) return null;
  }

  return {
    conversation,
    nextUserId: routed.userId,
    rerouted: routed.assigned,
    timedOutUserId,
    timedOutPresence,
    missedContact,
    systemMessage,
  };
}

export type DrainedQueuedConversation = {
  conversation: ConversationRecord;
  userId: string;
};

/**
 * Expire ringing (non-email) offers for an agent who left Ready.
 * Releases reserved capacity and re-routes each conversation.
 */
export async function releasePendingNonEmailOffersForAgent(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<
  Array<{
    conversation: ConversationRecord;
    nextUserId: string | null;
    rerouted: boolean;
    transfer?: ConversationTransferRecord | null;
  }>
> {
  const pending = await db.$queryRaw<{ conversation_id: string }[]>`
    SELECT ca.conversation_id
    FROM ccass.conversation_assignments ca
    INNER JOIN ccass.conversations c
      ON c.id = ca.conversation_id
     AND c.organization_id = ca.organization_id
    WHERE ca.organization_id = ${organizationId}::bigint
      AND ca.agent_id = ${agentId}::bigint
      AND ca.state = 'offered'
      AND c.channel <> 'email'
      AND (
        c.status = 'assigned'
        OR EXISTS (
          SELECT 1
          FROM ccass.conversation_transfers transfer
          WHERE transfer.organization_id = ca.organization_id
            AND transfer.conversation_id = ca.conversation_id
            AND transfer.offered_agent_id = ca.agent_id
            AND transfer.requested_agent_id IS NOT NULL
            AND transfer.state = 'offered'
        )
      )
    ORDER BY ca.offered_at ASC NULLS LAST
  `;

  const results: Array<{
    conversation: ConversationRecord;
    nextUserId: string | null;
    rerouted: boolean;
    timedOutUserId: string | null;
    timedOutPresence: AgentPresenceRecord | null;
    missedContact: AgentMissedContactRecord | null;
    transfer?: ConversationTransferRecord | null;
  }> = [];

  for (const row of pending) {
    const expired = await expireConversationOffer(db, organizationId, row.conversation_id, {
      markAgentAway: false,
    });
    if (expired) results.push(expired);
  }
  return results;
}

export async function routeOldestQueuedConversationForAgent(
  db: DbClient,
  organizationId: string,
  agentId: string,
  options: { reason?: string; channels?: RoutableChannel[] } = {},
): Promise<DrainedQueuedConversation | null> {
  const routingReason = options.reason ?? "agent_ready";
  const emailOnly = options.channels?.length === 1 && options.channels[0] === "email";

  const queuedRows = emailOnly
    ? await db.$queryRaw<{ id: string; queue_id: string; channel: string }[]>`
        SELECT c.id, c.queue_id, c.channel
        FROM ccass.conversations c
        INNER JOIN ccass.queue_members qm
          ON qm.queue_id = c.queue_id AND qm.agent_id = ${agentId}::bigint
        WHERE c.organization_id = ${organizationId}::bigint
          AND c.status = 'queued'
          AND c.assigned_agent_id IS NULL
          AND c.channel = 'email'
          AND qm.handles_email = TRUE
        ORDER BY c.priority DESC, c.queued_at ASC NULLS LAST, c.updated_at ASC
        LIMIT 1
        FOR UPDATE OF c SKIP LOCKED
      `
    : await db.$queryRaw<{ id: string; queue_id: string; channel: string }[]>`
        SELECT c.id, c.queue_id, c.channel
        FROM ccass.conversations c
        INNER JOIN ccass.queue_members qm
          ON qm.queue_id = c.queue_id AND qm.agent_id = ${agentId}::bigint
        WHERE c.organization_id = ${organizationId}::bigint
          AND c.status = 'queued'
          AND c.assigned_agent_id IS NULL
          AND (
            (c.channel = 'email' AND qm.handles_email = TRUE)
            OR (c.channel = 'whatsapp' AND qm.handles_whatsapp = TRUE)
            OR (c.channel = 'instagram' AND qm.handles_instagram = TRUE)
            OR (c.channel = 'facebook' AND qm.handles_facebook = TRUE)
            OR (
              c.channel NOT IN ('email', 'whatsapp', 'instagram', 'facebook')
              AND qm.handles_chat = TRUE
            )
          )
        ORDER BY c.priority DESC, c.queued_at ASC NULLS LAST, c.updated_at ASC
        LIMIT 1
        FOR UPDATE OF c SKIP LOCKED
      `;
  const queued = queuedRows[0];
  if (!queued) return null;

  const channel = toRoutableChannel(queued.channel);
  const routeOptions = {
    reason: routingReason,
    channel,
  };

  let routed = await routeConversationToAgent(
    db,
    organizationId,
    queued.id,
    queued.queue_id,
    { ...routeOptions, preferredAgentId: agentId },
  );
  if (!routed.assigned) {
    routed = await routeConversationToAgent(db, organizationId, queued.id, queued.queue_id, routeOptions);
  }
  if (!routed.assigned || !routed.userId) return null;
  const conversation = await getConversation(db, organizationId, queued.id);
  return conversation ? { conversation, userId: routed.userId } : null;
}

async function drainQueuedConversationAfterCapacityFreed(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<DrainedQueuedConversation | null> {
  return routeOldestQueuedConversationForAgent(db, organizationId, agentId, {
    reason: "capacity_freed",
  });
}

export async function sendAgentReply(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  body: string,
): Promise<MessageRecord> {
  const agent = await getAgentForUser(db, organizationId, userId);

  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }

  if (conversation.status === "assigned") {
    throw Object.assign(new Error("Accept the conversation offer before replying"), { status: 409 });
  }

  if (conversation.assignedAgentId && conversation.assignedAgentId !== agent.id) {
    throw Object.assign(new Error("Conversation is assigned to another agent"), { status: 409 });
  }

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      status = 'active',
      lifecycle_state = 'connected',
      assigned_agent_id = COALESCE(assigned_agent_id, ${agent.id}::bigint),
      assigned_user_id = COALESCE(assigned_user_id, ${userId}::bigint),
      assigned_at = COALESCE(assigned_at, NOW()),
      first_response_at = COALESCE(first_response_at, NOW()),
      first_agent_response_at = CASE
        WHEN channel = 'email' THEN COALESCE(first_agent_response_at, NOW())
        ELSE first_agent_response_at
      END,
      sla_status = CASE
        WHEN channel = 'email' AND first_response_due_at IS NOT NULL AND NOW() > first_response_due_at
          THEN 'first_response_breached'
        WHEN channel = 'email' THEN 'responded'
        ELSE sla_status
      END,
      updated_at = NOW()
    WHERE id = ${conversationId}::bigint AND organization_id = ${organizationId}::bigint
  `;

  const senderRows = await db.$queryRaw<{ name: string | null }[]>`
    SELECT NULLIF(btrim(concat_ws(' ', first_name, last_name)), '') AS name
    FROM accounts.setup_users
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${userId}::bigint
    LIMIT 1
  `;
  const { message } = await appendConversationMessage(db, organizationId, conversationId, {
    senderType: "agent",
    direction: "outbound",
    visibility: "customer",
    body,
    modelMetadata: {
      speakerUserId: userId,
      speakerName: senderRows[0]?.name || undefined,
    },
  });
  await markFirstResponseSlaMet(db, organizationId, conversationId).catch(() => undefined);
  return message;
}

export type DispositionRecord = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  category: string;
  outcome: string | null;
  requiresNote: boolean;
  requiresResolution: boolean;
  sortOrder: number;
};

type DispositionRow = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  category: string;
  outcome: string | null;
  requires_note: boolean;
  requires_resolution: boolean;
  sort_order: number;
};

function mapDisposition(row: DispositionRow): DispositionRecord {
  return {
    id: rowEntityId(row.id)!,
    code: row.code,
    label: row.label,
    description: row.description,
    category: row.category,
    outcome: row.outcome,
    requiresNote: row.requires_note,
    requiresResolution: row.requires_resolution,
    sortOrder: row.sort_order,
  };
}

export async function listDispositions(
  db: DbClient,
  organizationId: string,
): Promise<DispositionRecord[]> {
  const rows = await db.$queryRaw<DispositionRow[]>`
    SELECT
      id, code, label, description, category, outcome,
      requires_note, requires_resolution, sort_order
    FROM ccass.dispositions
    WHERE organization_id = ${organizationId}::bigint AND is_active = TRUE
    ORDER BY sort_order ASC, label ASC
  `;
  return rows.map(mapDisposition);
}

export async function saveConversationDisposition(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  userId: string | null,
  input: z.infer<typeof saveDispositionSchema>,
): Promise<{
  id: string;
  disposition: DispositionRecord;
  note: string | null;
  isFinal: boolean;
  appliedAt: string;
  contactId: string | null;
}> {
  const payload = saveDispositionSchema.parse(input);
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }

  const dispositionRows = await db.$queryRaw<DispositionRow[]>`
    SELECT
      id, code, label, description, category, outcome,
      requires_note, requires_resolution, sort_order
    FROM ccass.dispositions
    WHERE organization_id = ${organizationId}::bigint
      AND is_active = TRUE
      AND (
        (${payload.dispositionId ?? null}::bigint IS NOT NULL AND id = ${payload.dispositionId ?? null}::bigint)
        OR (${payload.code ?? null}::text IS NOT NULL AND code = ${payload.code ?? null})
      )
    LIMIT 1
  `;
  const disposition = dispositionRows[0];
  if (!disposition) {
    throw Object.assign(new Error("Disposition not found or inactive"), { status: 404 });
  }
  if (disposition.requires_note && !payload.note?.trim()) {
    throw Object.assign(new Error("This disposition requires a note"), { status: 400 });
  }
  if (disposition.requires_resolution && !payload.resolution?.code) {
    throw Object.assign(new Error("This disposition requires a resolution code"), { status: 400 });
  }

  const agentRows = userId
    ? await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM ccass.agents
        WHERE organization_id = ${organizationId}::bigint
          AND setup_user_id = ${userId}::bigint
        LIMIT 1
      `
    : [];
  const rows = await db.$queryRaw<{ id: string; applied_at: Date }[]>`
    INSERT INTO ccass.conversation_dispositions (
      organization_id, conversation_id, disposition_id, agent_id,
      applied_by_user_id, note, source, resolution_code, resolution_data, is_final
    ) VALUES (
      ${organizationId}::bigint,
      ${conversationId}::bigint,
      ${disposition.id}::bigint,
      ${agentRows[0]?.id ?? null}::bigint,
      ${userId}::bigint,
      ${payload.note ?? null},
      ${payload.source},
      ${payload.resolution?.code ?? null},
      ${JSON.stringify(payload.resolution?.data ?? {})}::jsonb,
      ${payload.isFinal}
    )
    RETURNING id, applied_at
  `;

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      disposition_code = ${disposition.code},
      disposition_note = ${payload.note ?? null},
      resolution_code = COALESCE(${payload.resolution?.code ?? null}, resolution_code),
      resolution_summary = COALESCE(${payload.resolution?.summary ?? null}, resolution_summary),
      resolution_data = CASE
        WHEN ${payload.resolution?.data ? true : false}
          THEN ${JSON.stringify(payload.resolution?.data ?? {})}::jsonb
        ELSE resolution_data
      END,
      updated_at = NOW(),
      version = version + 1
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${conversationId}::bigint
      AND channel = ${conversation.channel}
      AND ${payload.isFinal}
  `;
  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "conversation.disposition.saved",
    metadata: {
      dispositionCode: disposition.code,
      resolutionCode: payload.resolution?.code ?? null,
      isFinal: payload.isFinal,
      source: payload.source,
    },
  });

  return {
    id: rowEntityId(rows[0]!.id)!,
    disposition: mapDisposition(disposition),
    note: payload.note ?? null,
    isFinal: payload.isFinal,
    appliedAt: rows[0]!.applied_at.toISOString(),
    contactId: conversation.contactId,
  };
}

export type ConversationTransferState =
  | "requested"
  | "queued"
  | "offered"
  | "accepted"
  | "completed"
  | "rejected"
  | "expired"
  | "cancelled";

export type ConversationTransferRecord = {
  id: string;
  conversationId: string;
  fromQueueId: string | null;
  fromAgentId: string | null;
  fromUserId: string | null;
  toQueueId: string;
  requestedAgentId: string | null;
  offeredAgentId: string | null;
  acceptedAgentId: string | null;
  acceptedUserId: string | null;
  state: ConversationTransferState;
  notes: string | null;
  outcomeReason: string | null;
  channel: string | null;
  requestedAt: string;
  offeredAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  sourceAgentName?: string | null;
  requestedAgentName?: string | null;
  offeredAgentName?: string | null;
  acceptedAgentName?: string | null;
  sourceQueueName?: string | null;
  targetQueueName?: string | null;
};

function mapConversationTransfer(row: ConversationTransferRow): ConversationTransferRecord {
  return {
    id: rowEntityId(row.id)!,
    conversationId: rowEntityId(row.conversation_id)!,
    fromQueueId: rowEntityId(row.from_queue_id),
    fromAgentId: rowEntityId(row.from_agent_id),
    fromUserId: rowEntityId(row.from_user_id),
    toQueueId: rowEntityId(row.to_queue_id)!,
    requestedAgentId: rowEntityId(row.requested_agent_id),
    offeredAgentId: rowEntityId(row.offered_agent_id),
    acceptedAgentId: rowEntityId(row.accepted_agent_id),
    acceptedUserId: rowEntityId(row.accepted_user_id),
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
    sourceAgentName: row.from_agent_name ?? null,
    requestedAgentName: row.requested_agent_name ?? null,
    offeredAgentName: row.offered_agent_name ?? null,
    acceptedAgentName: row.accepted_agent_name ?? null,
    sourceQueueName: row.from_queue_name ?? null,
    targetQueueName: row.to_queue_name ?? null,
  };
}

async function enrichTransferDisplayMetadata(
  db: DbClient,
  organizationId: string,
  transfer: ConversationTransferRecord,
): Promise<ConversationTransferRecord> {
  const rows = await db.$queryRaw<{
    from_agent_name: string | null;
    requested_agent_name: string | null;
    offered_agent_name: string | null;
    accepted_agent_name: string | null;
    from_queue_name: string | null;
    to_queue_name: string | null;
  }[]>`
    SELECT
      (SELECT display_name FROM ccass.agents
       WHERE organization_id = ${organizationId}::bigint
         AND id = ${transfer.fromAgentId}::bigint) AS from_agent_name,
      (SELECT display_name FROM ccass.agents
       WHERE organization_id = ${organizationId}::bigint
         AND id = ${transfer.requestedAgentId}::bigint) AS requested_agent_name,
      (SELECT display_name FROM ccass.agents
       WHERE organization_id = ${organizationId}::bigint
         AND id = ${transfer.offeredAgentId}::bigint) AS offered_agent_name,
      (SELECT display_name FROM ccass.agents
       WHERE organization_id = ${organizationId}::bigint
         AND id = ${transfer.acceptedAgentId}::bigint) AS accepted_agent_name,
      (SELECT name FROM ccass.queues
       WHERE organization_id = ${organizationId}::bigint
         AND id = ${transfer.fromQueueId}::bigint) AS from_queue_name,
      (SELECT name FROM ccass.queues
       WHERE organization_id = ${organizationId}::bigint
         AND id = ${transfer.toQueueId}::bigint) AS to_queue_name
  `;
  const names = rows[0];
  return {
    ...transfer,
    sourceAgentName: names?.from_agent_name ?? transfer.sourceAgentName ?? null,
    requestedAgentName: names?.requested_agent_name ?? transfer.requestedAgentName ?? null,
    offeredAgentName: names?.offered_agent_name ?? transfer.offeredAgentName ?? null,
    acceptedAgentName: names?.accepted_agent_name ?? transfer.acceptedAgentName ?? null,
    sourceQueueName: names?.from_queue_name ?? transfer.sourceQueueName ?? null,
    targetQueueName: names?.to_queue_name ?? transfer.targetQueueName ?? null,
  };
}

function transferLatencyMs(
  transfer: ConversationTransferRecord,
  terminalAt: string | null,
): number | null {
  const startedAt = transfer.offeredAt ?? transfer.requestedAt;
  if (!startedAt || !terminalAt) return null;
  return Math.max(0, Date.parse(terminalAt) - Date.parse(startedAt));
}

export async function listConversationTransferTargets(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  input: z.infer<typeof transferTargetsQuerySchema>,
) {
  const query = transferTargetsQuerySchema.parse(input);
  const sender = await getAgentForUser(db, organizationId, userId);
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) throw Object.assign(new Error("Conversation not found"), { status: 404 });
  if (conversation.assignedAgentId !== sender.id || conversation.status !== "active") {
    throw Object.assign(new Error("Only the assigned agent can list transfer targets"), {
      status: 409,
    });
  }
  return listEligibleTransferTargets(db, organizationId, {
    queueId: query.queueId,
    channel: toRoutableChannel(conversation.channel),
    excludeAgentId: sender.id,
    search: query.search,
    offset: query.offset,
    limit: query.limit,
    requireVoice: query.voice || isCallChannel(conversation.channel),
  });
}

export async function transferConversation(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  input: z.infer<typeof transferConversationSchema>,
): Promise<{
  conversation: ConversationRecord;
  transfer: ConversationTransferRecord;
  assignment: { agentId: string; userId: string } | null;
  drained: DrainedQueuedConversation | null;
}> {
  const payload = transferConversationSchema.parse(input);
  const sender = await getAgentForUser(db, organizationId, userId);
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  if (conversation.assignedAgentId !== sender.id || conversation.status !== "active") {
    throw Object.assign(new Error("Only the assigned agent can transfer an active conversation"), {
      status: 409,
    });
  }
  if (payload.agentId === sender.id) {
    throw Object.assign(new Error("A transfer cannot target the sending agent"), { status: 409 });
  }

  const queueRows = await db.$queryRaw<{ id: string; name: string }[]>`
    SELECT id::text AS id, name FROM ccass.queues
    WHERE id = ${payload.queueId}::bigint
      AND organization_id = ${organizationId}::bigint
      AND status = 'active'
    LIMIT 1
  `;
  if (!queueRows[0]) {
    throw Object.assign(new Error("Transfer queue not found or inactive"), { status: 404 });
  }
  if (payload.agentId) {
    const memberRows = await db.$queryRaw<{ id: string }[]>`
      SELECT a.id
      FROM ccass.agents a
      INNER JOIN ccass.queue_members qm
        ON qm.agent_id = a.id AND qm.queue_id = ${payload.queueId}::bigint
      WHERE a.id = ${payload.agentId}::bigint
        AND a.organization_id = ${organizationId}::bigint
        AND (
          (${conversation.channel === "email"} = TRUE AND qm.handles_email = TRUE)
          OR (${conversation.channel === "whatsapp"} = TRUE AND qm.handles_whatsapp = TRUE)
          OR (${conversation.channel === "instagram"} = TRUE AND qm.handles_instagram = TRUE)
          OR (${conversation.channel === "facebook"} = TRUE AND qm.handles_facebook = TRUE)
          OR (
            ${!["email", "whatsapp", "instagram", "facebook"].includes(conversation.channel)} = TRUE
            AND qm.handles_chat = TRUE
          )
        )
      LIMIT 1
    `;
    if (!memberRows[0]) {
      throw Object.assign(new Error("Requested agent is not eligible for the transfer queue"), {
        status: 409,
      });
    }
  }

  const explicitWarmTransfer = Boolean(payload.agentId && conversation.channel !== "email");
  if (explicitWarmTransfer) {
    const sourceAgentRows = await db.$queryRaw<{ display_name: string | null }[]>`
      SELECT display_name
      FROM ccass.agents
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${sender.id}::bigint
      LIMIT 1
    `;
    const eligibility = await listEligibleTransferTargets(db, organizationId, {
      queueId: payload.queueId,
      channel: toRoutableChannel(conversation.channel),
      excludeAgentId: sender.id,
      agentId: payload.agentId,
      limit: 1,
    });
    const target = eligibility.targets[0];
    if (!target || target.agentId !== payload.agentId) {
      throw Object.assign(
        new Error("Requested agent is not currently eligible to receive the transfer"),
        { status: 409 },
      );
    }

    const channel = toRoutableChannel(conversation.channel);
    const reserved = await db.$queryRaw<{ agent_id: string }[]>`
      INSERT INTO ccass.agent_capacity (
        organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
      ) VALUES (
        ${organizationId}::bigint, ${target.agentId}::bigint, ${channel},
        ${target.maxConcurrency}, 1, 0
      )
      ON CONFLICT (agent_id, channel) DO UPDATE
        SET reserved_count = ccass.agent_capacity.reserved_count + 1,
            max_concurrency = LEAST(ccass.agent_capacity.max_concurrency, EXCLUDED.max_concurrency),
            updated_at = NOW()
        WHERE ccass.agent_capacity.active_count + ccass.agent_capacity.reserved_count
          < LEAST(ccass.agent_capacity.max_concurrency, EXCLUDED.max_concurrency)
      RETURNING agent_id::text
    `;
    if (!reserved[0]) {
      throw Object.assign(new Error("Requested agent reached channel capacity"), { status: 409 });
    }

    await db.$executeRaw`
      INSERT INTO ccass.conversation_assignments (
        organization_id, conversation_id, queue_id, agent_id, state, reason, offered_at, expires_at
      ) VALUES (
        ${organizationId}::bigint, ${conversationId}::bigint, ${payload.queueId}::bigint,
        ${target.agentId}::bigint, 'offered', 'warm_transfer', NOW(),
        NOW() + (
          COALESCE((
            SELECT offer_timeout_seconds
            FROM ccass.routing_policies
            WHERE organization_id = ${organizationId}::bigint
              AND queue_id = ${payload.queueId}::bigint
            LIMIT 1
          ), 20) || ' seconds'
        )::interval
      )
    `;
    const transferRows = await db.$queryRaw<ConversationTransferRow[]>`
      INSERT INTO ccass.conversation_transfers (
        organization_id, conversation_id, from_queue_id, from_agent_id, from_user_id,
        to_queue_id, requested_agent_id, offered_agent_id, requested_by_user_id,
        state, notes, resolution_code, resolution_data, offered_at, channel
      ) VALUES (
        ${organizationId}::bigint, ${conversationId}::bigint, ${conversation.queueId}::bigint,
        ${sender.id}::bigint, ${userId}::bigint, ${payload.queueId}::bigint,
        ${target.agentId}::bigint, ${target.agentId}::bigint, ${userId}::bigint,
        'offered', ${payload.notes ?? null},
        ${payload.resolution?.code ?? payload.disposition?.resolution?.code ?? null},
        ${JSON.stringify(payload.resolution?.data ?? payload.disposition?.resolution?.data ?? {})}::jsonb,
        NOW(), ${channel}
      )
      RETURNING *
    `;
    const transfer: ConversationTransferRecord = {
      ...mapConversationTransfer(transferRows[0]!),
      sourceAgentName: sourceAgentRows[0]?.display_name ?? null,
      requestedAgentName: target.name,
      offeredAgentName: target.name,
      targetQueueName: queueRows[0]!.name,
    };
    await upsertConversationMemory(db, organizationId, conversationId, {
      rollingSummary: `Warm transfer offered to ${target.name}${payload.notes ? `: ${payload.notes}` : ""}`,
      extractedFacts: ["warm_transfer_offered", payload.resolution?.code ?? "transfer"],
      modelName: "transfer",
    }).catch(() => undefined);
    const transferEventMetadata = {
      transferId: transfer.id,
      fromAgentId: sender.id,
      fromUserId: userId,
      fromQueueId: conversation.queueId,
      toQueueId: payload.queueId,
      requestedAgentId: payload.agentId ?? null,
      offeredAgentId: target.agentId,
      offeredUserId: target.userId,
      channel,
      requestedAt: transfer.requestedAt,
      offeredAt: transfer.offeredAt,
    };
    await projectInteractionEvent(db, organizationId, {
      conversationId,
      eventType: "transfer.requested",
      metadata: transferEventMetadata,
    });
    await projectInteractionEvent(db, organizationId, {
      conversationId,
      eventType: "transfer.offered",
      metadata: transferEventMetadata,
    });
    return {
      conversation: { ...conversation, transfer },
      transfer,
      assignment: { agentId: target.agentId, userId: target.userId },
      drained: null,
    };
  }

  if (payload.disposition) {
    await saveConversationDisposition(db, organizationId, conversationId, userId, {
      ...payload.disposition,
      isFinal: true,
      source: "transfer",
    });
  }

  await db.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET state = 'ended', ended_at = NOW(), reason = 'transferred'
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND agent_id = ${sender.id}::bigint
      AND state = 'accepted'
  `;
  const capacityRows = await db.$queryRaw<{ active_count: number }[]>`
    UPDATE ccass.agent_capacity
    SET active_count = GREATEST(active_count - 1, 0), updated_at = NOW()
    WHERE agent_id = ${sender.id}::bigint
      AND channel = ${toRoutableChannel(conversation.channel)}
    RETURNING active_count
  `;
  await upsertConversationMemory(db, organizationId, conversationId, {
    rollingSummary: `Transfer requested to queue ${payload.queueId}${payload.notes ? `: ${payload.notes}` : ""}`,
    extractedFacts: ["transfer_requested", payload.resolution?.code ?? "transfer"],
    modelName: "transfer",
  }).catch(() => undefined);

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      status = 'queued',
      lifecycle_state = 'waiting',
      queue_id = ${payload.queueId}::bigint,
      assigned_agent_id = NULL,
      assigned_user_id = NULL,
      assigned_at = NULL,
      queued_at = NOW(),
      transferred_at = NOW(),
      resolution_code = COALESCE(${payload.resolution?.code ?? null}, resolution_code),
      resolution_summary = COALESCE(${payload.resolution?.summary ?? null}, resolution_summary),
      resolution_data = CASE
        WHEN ${payload.resolution?.data ? true : false}
          THEN ${JSON.stringify(payload.resolution?.data ?? {})}::jsonb
        ELSE resolution_data
      END,
      updated_at = NOW(),
      version = version + 1
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
  `;

  // Prefer the chosen agent when ready. For intentional agent picks, retry without
  // the shift gate so a Ready queue member still receives the ringing offer.
  const routeOptions = {
    reason: "agent_transfer" as const,
    excludeAgentIds: [sender.id],
    preferredAgentId: payload.agentId,
    channel: toRoutableChannel(conversation.channel),
  };
  let routed = await routeConversationToAgent(
    db,
    organizationId,
    conversationId,
    payload.queueId,
    routeOptions,
  );
  if (payload.agentId && !routed.assigned) {
    routed = await routeConversationToAgent(db, organizationId, conversationId, payload.queueId, {
      ...routeOptions,
      skipShiftGate: true,
    });
  }

  const transferRows = await db.$queryRaw<
    {
      id: string;
      offered_agent_id: string | null;
      state: "offered" | "queued";
      requested_at: Date;
    }[]
  >`
    INSERT INTO ccass.conversation_transfers (
      organization_id, conversation_id, from_queue_id, from_agent_id, from_user_id,
      to_queue_id, requested_agent_id, offered_agent_id, requested_by_user_id,
      state, notes, disposition_code, resolution_code, resolution_data,
      routing_attempt_id, offered_at
    ) VALUES (
      ${organizationId}::bigint,
      ${conversationId}::bigint,
      ${conversation.queueId}::bigint,
      ${sender.id}::bigint,
      ${userId}::bigint,
      ${payload.queueId}::bigint,
      ${payload.agentId ?? null}::bigint,
      ${routed.agentId}::bigint,
      ${userId}::bigint,
      ${routed.assigned ? "offered" : "queued"},
      ${payload.notes ?? null},
      ${payload.disposition?.code ?? null},
      ${payload.resolution?.code ?? payload.disposition?.resolution?.code ?? null},
      ${JSON.stringify(payload.resolution?.data ?? payload.disposition?.resolution?.data ?? {})}::jsonb,
      ${routed.routingAttemptId}::bigint,
      ${routed.assigned ? new Date() : null}
    )
    RETURNING id::text, offered_agent_id::text, state, requested_at
  `;

  if (
    conversation.channel !== "email" &&
    !isCallChannel(conversation.channel) &&
    (capacityRows[0]?.active_count ?? 0) === 0
  ) {
    await setAgentPresenceByAgentId(db, organizationId, sender.id, "ready", {
      userId,
      source: "conversation_transferred",
    });
  }

  const updated = await getConversation(db, organizationId, conversationId);
  if (!updated) {
    throw Object.assign(new Error("Conversation not found after transfer"), { status: 500 });
  }
  const transferRow = transferRows[0]!;
  const transferId = rowEntityId(transferRow.id)!;
  const offeredAgentId = rowEntityId(transferRow.offered_agent_id);
  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "conversation.transferred",
    metadata: {
      transferId,
      fromAgentId: sender.id,
      fromQueueId: conversation.queueId,
      toQueueId: payload.queueId,
      requestedAgentId: payload.agentId ?? null,
      offeredAgentId,
      state: transferRow.state,
      resolutionCode: payload.resolution?.code ?? null,
    },
  });
  const drained = await drainQueuedConversationAfterCapacityFreed(
    db,
    organizationId,
    sender.id,
  );

  return {
    conversation: updated,
    transfer: {
      id: transferId,
      conversationId,
      fromQueueId: conversation.queueId,
      fromAgentId: sender.id,
      fromUserId: userId,
      toQueueId: payload.queueId,
      requestedAgentId: payload.agentId ?? null,
      offeredAgentId,
      acceptedAgentId: null,
      acceptedUserId: null,
      state: transferRow.state,
      notes: payload.notes ?? null,
      outcomeReason: null,
      channel: conversation.channel,
      requestedAt: transferRow.requested_at.toISOString(),
      offeredAt: routed.assigned ? new Date().toISOString() : null,
      acceptedAt: null,
      completedAt: null,
      rejectedAt: null,
      expiredAt: null,
      cancelledAt: null,
    },
    assignment:
      routed.assigned && routed.agentId && routed.userId
        ? { agentId: routed.agentId, userId: routed.userId }
        : null,
    drained,
  };
}

export async function cancelWarmTransfer(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<{ conversation: ConversationRecord; transfer: ConversationTransferRecord; targetUserId: string | null }> {
  const sender = await getAgentForUser(db, organizationId, userId);
  const rows = await db.$queryRaw<ConversationTransferRow[]>`
    SELECT * FROM ccass.conversation_transfers
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND from_agent_id = ${sender.id}::bigint
      AND requested_agent_id IS NOT NULL
      AND state = 'offered'
    ORDER BY requested_at DESC LIMIT 1 FOR UPDATE
  `;
  const open = rows[0];
  if (!open) throw Object.assign(new Error("No cancellable warm transfer"), { status: 409 });
  await db.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET state = 'ended', ended_at = NOW(), expires_at = NULL, reason = 'transfer_cancelled'
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND agent_id = ${open.offered_agent_id}::bigint
      AND state = 'offered'
  `;
  await db.$executeRaw`
    UPDATE ccass.agent_capacity
    SET reserved_count = GREATEST(reserved_count - 1, 0), updated_at = NOW()
    WHERE agent_id = ${open.offered_agent_id}::bigint
      AND channel = ${open.channel ?? "chat"}
  `;
  const cancelledRows = await db.$queryRaw<ConversationTransferRow[]>`
    UPDATE ccass.conversation_transfers
    SET state = 'cancelled', cancelled_at = NOW(), outcome_reason = 'sender_cancelled',
        updated_at = NOW()
    WHERE id = ${open.id}::bigint AND state = 'offered'
    RETURNING *
  `;
  const targetRows = await db.$queryRaw<{ setup_user_id: string | null }[]>`
    SELECT setup_user_id::text FROM ccass.agents
    WHERE id = ${open.offered_agent_id}::bigint
      AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) throw Object.assign(new Error("Conversation not found"), { status: 404 });
  const transfer = await enrichTransferDisplayMetadata(
    db,
    organizationId,
    mapConversationTransfer(cancelledRows[0]!),
  );
  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "transfer.cancelled",
    metadata: {
      transferId: transfer.id,
      fromAgentId: sender.id,
      fromUserId: userId,
      offeredAgentId: transfer.offeredAgentId,
      fromQueueId: transfer.fromQueueId,
      toQueueId: transfer.toQueueId,
      channel: transfer.channel,
      reason: transfer.outcomeReason,
      cancelledAt: transfer.cancelledAt,
      ringingDurationMs: transferLatencyMs(transfer, transfer.cancelledAt),
    },
  });
  return { conversation: { ...conversation, transfer }, transfer, targetUserId: targetRows[0]?.setup_user_id ?? null };
}

export async function completeWarmTransfer(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  input: z.infer<typeof completeTransferSchema>,
): Promise<{ transfer: ConversationTransferRecord; dispositionId: string }> {
  const payload = completeTransferSchema.parse(input);
  const sender = await getAgentForUser(db, organizationId, userId);
  const acceptedRows = await db.$queryRaw<ConversationTransferRow[]>`
    SELECT * FROM ccass.conversation_transfers
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND from_agent_id = ${sender.id}::bigint
      AND requested_agent_id IS NOT NULL
      AND state = 'accepted'
    ORDER BY requested_at DESC LIMIT 1 FOR UPDATE
  `;
  const accepted = acceptedRows[0];
  if (!accepted) throw Object.assign(new Error("No accepted warm transfer awaiting completion"), { status: 409 });
  const dispositionRows = await db.$queryRaw<{ id: string; code: string }[]>`
    SELECT id::text, code FROM ccass.dispositions
    WHERE organization_id = ${organizationId}::bigint
      AND code = ${payload.dispositionCode}
      AND is_active = TRUE
    LIMIT 1
  `;
  const disposition = dispositionRows[0];
  if (!disposition) throw Object.assign(new Error("Selected disposition is not configured"), { status: 409 });
  const savedRows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO ccass.conversation_dispositions (
      organization_id, conversation_id, disposition_id, agent_id, applied_by_user_id,
      note, source, resolution_code, resolution_data, is_final, transfer_id
    ) VALUES (
      ${organizationId}::bigint, ${conversationId}::bigint, ${disposition.id}::bigint,
      ${sender.id}::bigint, ${userId}::bigint, ${payload.summary}, 'transfer',
      'transferred',
      ${JSON.stringify({
        locked: true,
        transferId: rowEntityId(accepted.id),
        conclusion: payload.conclusion ?? null,
      })}::jsonb,
      FALSE, ${accepted.id}::bigint
    )
    RETURNING id::text
  `;
  await db.$executeRaw`
    UPDATE ccass.conversations
    SET disposition_code = ${disposition.code},
        disposition_note = ${payload.summary},
        resolution_code = 'transferred',
        resolution_summary = ${payload.summary},
        resolution_data = ${JSON.stringify({
          locked: true,
          transferId: rowEntityId(accepted.id),
          conclusion: payload.conclusion ?? null,
        })}::jsonb,
        updated_at = NOW(),
        version = version + 1
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${conversationId}::bigint
  `;
  const completedRows = await db.$queryRaw<ConversationTransferRow[]>`
    UPDATE ccass.conversation_transfers
    SET state = 'completed', completed_at = NOW(), disposition_code = ${disposition.code},
        outcome_reason = 'sender_disposition_completed', updated_at = NOW()
    WHERE id = ${accepted.id}::bigint AND state = 'accepted'
    RETURNING *
  `;
  const transfer = await enrichTransferDisplayMetadata(
    db,
    organizationId,
    mapConversationTransfer(completedRows[0]!),
  );
  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "transfer.completed",
    metadata: {
      transferId: transfer.id,
      fromAgentId: transfer.fromAgentId,
      fromUserId: transfer.fromUserId,
      acceptedAgentId: transfer.acceptedAgentId,
      acceptedUserId: transfer.acceptedUserId,
      fromQueueId: transfer.fromQueueId,
      toQueueId: transfer.toQueueId,
      channel: transfer.channel,
      completedAt: transfer.completedAt,
      wrapUpDurationMs: transferLatencyMs(transfer, transfer.completedAt),
      dispositionCode: disposition.code,
      summary: payload.summary,
    },
  });
  return { transfer, dispositionId: String(savedRows[0]!.id) };
}

/** B's conference wrap-up. It does not close the call and does not replace A's disposition. */
async function saveVoiceMergeParticipantDisposition(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  userId: string,
  agentId: string,
  disposition: {
    dispositionId?: string;
    code?: string;
    note?: string;
    resolution?: { code?: string; summary?: string; data?: Record<string, unknown> };
  },
): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT transfer.id::text AS id
    FROM ccass.conversation_transfers transfer
    WHERE transfer.organization_id = ${organizationId}::bigint
      AND transfer.conversation_id = ${conversationId}::bigint
      AND transfer.outcome_reason = 'voice_consult_merged'
      AND transfer.from_agent_id IS DISTINCT FROM ${agentId}::bigint
      AND ${agentId}::bigint IN (
        transfer.requested_agent_id, transfer.offered_agent_id, transfer.accepted_agent_id
      )
    UNION
    SELECT assignment.id::text AS id
    FROM ccass.conversation_assignments assignment
    WHERE assignment.organization_id = ${organizationId}::bigint
      AND assignment.conversation_id = ${conversationId}::bigint
      AND assignment.agent_id = ${agentId}::bigint
      AND assignment.reason = 'voice_merge'
      AND assignment.state IN ('accepted', 'ended')
    LIMIT 1
  `;
  if (!rows[0]) return false;
  const existing = await db.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id
    FROM ccass.conversation_dispositions
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND applied_by_user_id = ${userId}::bigint
      AND source = 'merge'
      AND is_final = FALSE
    LIMIT 1
  `;
  if (!existing[0]) {
    await saveConversationDisposition(db, organizationId, conversationId, userId, {
      ...disposition,
      isFinal: false,
      source: "merge",
    });
  }
  return true;
}

export async function endConversation(
  db: DbClient,
  organizationId: string,
  userId: string | null,
  conversationId: string,
  input: z.infer<typeof endConversationSchema>,
): Promise<{
  conversation: ConversationRecord;
  drained: DrainedQueuedConversation | null;
  /** Users whose ringing offer was cancelled by this end (e.g. customer left while ringing). */
  releasedOfferUserIds: string[];
  cancelledTransfer: ConversationTransferRecord | null;
}> {
  const payload = endConversationSchema.parse(input);
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  if (isEndedConversationStatus(conversation.status)) {
    if (payload.actor === "agent" && payload.disposition) {
      if (!userId) {
        throw Object.assign(new Error("Agent user context is required"), { status: 403 });
      }
      const actingAgent = await getAgentForUser(db, organizationId, userId);
      if (conversation.assignedAgentId !== actingAgent.id) {
        const saved = payload.disposition
          ? await saveVoiceMergeParticipantDisposition(
              db,
              organizationId,
              conversationId,
              userId,
              actingAgent.id,
              payload.disposition,
            )
          : false;
        if (!saved) {
          throw Object.assign(
            new Error("Only the assigned agent can disposition this conversation"),
            { status: 409 },
          );
        }
        const dispositionedConversation =
          (await getConversation(db, organizationId, conversationId)) ?? conversation;
        return {
          conversation: dispositionedConversation,
          drained: null,
          releasedOfferUserIds: [],
          cancelledTransfer: null,
        };
      }
      const existingFinalRows = await db.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id
        FROM ccass.conversation_dispositions
        WHERE organization_id = ${organizationId}::bigint
          AND conversation_id = ${conversationId}::bigint
          AND applied_by_user_id = ${userId}::bigint
          AND is_final = TRUE
        LIMIT 1
      `;
      if (!existingFinalRows[0]) {
        await saveConversationDisposition(db, organizationId, conversationId, userId, {
          ...payload.disposition,
          isFinal: true,
          source: "agent",
        });
      }
    }
    const dispositionedConversation =
      (await getConversation(db, organizationId, conversationId)) ?? conversation;
    return {
      conversation: dispositionedConversation,
      drained: null,
      releasedOfferUserIds: [],
      cancelledTransfer: null,
    };
  }

  const openWarmTransferRows = await db.$queryRaw<ConversationTransferRow[]>`
    SELECT *
    FROM ccass.conversation_transfers
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND requested_agent_id IS NOT NULL
      AND state = 'offered'
    ORDER BY requested_at DESC
    LIMIT 1
    FOR UPDATE
  `;
  const openWarmTransfer = openWarmTransferRows[0] ?? null;

  let actingAgent: { id: string } | null = null;
  if (payload.actor === "agent") {
    if (!userId) {
      throw Object.assign(new Error("Agent user context is required"), { status: 403 });
    }
    if (openWarmTransfer) {
      throw Object.assign(
        new Error("Cancel the pending transfer before ending the conversation"),
        { status: 409 },
      );
    }
    actingAgent = await getAgentForUser(db, organizationId, userId);
    if (conversation.assignedAgentId !== actingAgent.id) {
      const saved = payload.disposition
        ? await saveVoiceMergeParticipantDisposition(
            db,
            organizationId,
            conversationId,
            userId,
            actingAgent.id,
            payload.disposition,
          )
        : false;
      if (!saved) {
        throw Object.assign(new Error("Only the assigned agent can end an active conversation"), {
          status: 409,
        });
      }
      return {
        conversation,
        drained: null,
        releasedOfferUserIds: [],
        cancelledTransfer: null,
      };
    }
    if (conversation.status !== "active") {
      throw Object.assign(new Error("Only the assigned agent can end an active conversation"), {
        status: 409,
      });
    }
    if (!payload.disposition && !conversation.dispositionCode) {
      throw Object.assign(new Error("Disposition is required to end the conversation"), {
        status: 400,
      });
    }
  }

  if (payload.disposition) {
    await saveConversationDisposition(db, organizationId, conversationId, userId, {
      ...payload.disposition,
      isFinal: true,
      source: payload.actor === "agent" ? "agent" : payload.actor === "customer" ? "customer" : "system",
    });
  }

  const openAssignmentRows = await db.$queryRaw<{ agent_id: string; state: string }[]>`
    SELECT agent_id::text AS agent_id, state
    FROM ccass.conversation_assignments
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state IN ('accepted', 'offered')
  `;
  await db.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET state = 'ended', ended_at = NOW(), reason = ${payload.reason}
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state IN ('accepted', 'offered')
  `;
  const channel = toRoutableChannel(conversation.channel);
  for (const assignment of openAssignmentRows) {
    if (assignment.state === "accepted") {
      await db.$executeRaw`
        UPDATE ccass.agent_capacity
        SET active_count = GREATEST(active_count - 1, 0), updated_at = NOW()
        WHERE agent_id = ${assignment.agent_id}::bigint
          AND channel = ${channel}
      `;
    } else if (assignment.state === "offered") {
      await db.$executeRaw`
        UPDATE ccass.agent_capacity
        SET reserved_count = GREATEST(reserved_count - 1, 0), updated_at = NOW()
        WHERE agent_id = ${assignment.agent_id}::bigint
          AND channel = ${channel}
      `;
    }
  }
  const assignedAgentId =
    openAssignmentRows.find((row) => row.state === "accepted")?.agent_id ??
    conversation.assignedAgentId ??
    null;

  const rows = await db.$queryRaw<ConversationRow[]>`
    UPDATE ccass.conversations
    SET
      status = ${payload.actor === "agent" ? "resolved" : "closed"},
      lifecycle_state = 'ended',
      bot_active = FALSE,
      resolved_at = CASE WHEN ${payload.actor === "agent"} THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END,
      closed_at = CASE WHEN ${payload.actor !== "agent"} THEN COALESCE(closed_at, NOW()) ELSE closed_at END,
      ended_at = NOW(),
      end_reason = ${payload.reason},
      end_actor = ${payload.actor},
      resolution_code = COALESCE(${payload.resolution?.code ?? null}, resolution_code),
      resolution_summary = COALESCE(${payload.resolution?.summary ?? null}, resolution_summary),
      resolution_data = CASE
        WHEN ${payload.resolution?.data ? true : false}
          THEN ${JSON.stringify(payload.resolution?.data ?? {})}::jsonb
        ELSE resolution_data
      END,
      updated_at = NOW(),
      version = version + 1
    WHERE id = ${conversationId}::bigint
      AND organization_id = ${organizationId}::bigint
      AND channel = ${conversation.channel}
    RETURNING *
  `;
  await db.$executeRaw`
    UPDATE ccass.conversation_transfers
    SET state = 'completed',
        completed_at = COALESCE(completed_at, NOW()),
        updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state = 'accepted'
      AND outcome_reason = 'voice_consult_merged'
  `;
  if (payload.actor === "agent" && userId) {
    await db.$executeRaw`
      UPDATE ccass.agent_tasks
      SET status = 'completed',
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND assigned_user_id = ${userId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND task_type = 'callback'
        AND status = 'open'
    `;
  }
  await db.$executeRaw`
    UPDATE ccass.webchat_sessions
    SET
      connection_state = 'ended',
      disconnected_at = COALESCE(disconnected_at, NOW()),
      ended_at = NOW(),
      end_reason = ${payload.reason},
      ended_by = ${payload.actor},
      updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
  `;
  await db.$executeRaw`
    UPDATE ccass.conversation_participants
    SET left_at = COALESCE(left_at, NOW())
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
  `;
  await endNlpConversation(db, organizationId, conversationId, payload.reason);
  await finalizeConversationSla(db, organizationId, conversationId).catch(() => undefined);

  let cancelledTransfer: ConversationTransferRecord | null = null;
  if (openWarmTransfer) {
    const cancelledRows = await db.$queryRaw<ConversationTransferRow[]>`
      UPDATE ccass.conversation_transfers
      SET state = 'cancelled',
          cancelled_at = NOW(),
          outcome_reason = ${`conversation_ended:${payload.reason}`},
          updated_at = NOW()
      WHERE id = ${openWarmTransfer.id}::bigint
        AND state = 'offered'
      RETURNING *
    `;
    if (cancelledRows[0]) {
      cancelledTransfer = await enrichTransferDisplayMetadata(
        db,
        organizationId,
        mapConversationTransfer(cancelledRows[0]),
      );
      await projectInteractionEvent(db, organizationId, {
        conversationId,
        eventType: "transfer.cancelled",
        metadata: {
          transferId: cancelledTransfer.id,
          fromAgentId: cancelledTransfer.fromAgentId,
          fromUserId: cancelledTransfer.fromUserId,
          offeredAgentId: cancelledTransfer.offeredAgentId,
          fromQueueId: cancelledTransfer.fromQueueId,
          toQueueId: cancelledTransfer.toQueueId,
          channel: cancelledTransfer.channel,
          reason: cancelledTransfer.outcomeReason,
          cancelledAt: cancelledTransfer.cancelledAt,
          ringingDurationMs: transferLatencyMs(
            cancelledTransfer,
            cancelledTransfer.cancelledAt,
          ),
        },
      });
    }
  }

  if (assignedAgentId && conversation.channel !== "email" && !isCallChannel(conversation.channel)) {
    await setAgentPresenceByAgentId(db, organizationId, assignedAgentId, "ready", {
      userId: actingAgent ? userId : null,
      source: "conversation_ended",
    });
  }
  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "conversation.ended",
    metadata: {
      actor: payload.actor,
      reason: payload.reason,
      dispositionCode: payload.disposition?.code ?? null,
      resolutionCode: payload.resolution?.code ?? null,
    },
  });
  scheduleOmniChannelSummaryRefresh(organizationId, conversation.contactId);
  const ended = mapConversation(rows[0]!);
  const drained =
    payload.actor === "agent" && assignedAgentId
      ? await drainQueuedConversationAfterCapacityFreed(db, organizationId, assignedAgentId)
      : null;

  const offeredAgentIds = openAssignmentRows
    .filter((row) => row.state === "offered")
    .map((row) => row.agent_id);
  let releasedOfferUserIds: string[] = [];
  if (offeredAgentIds.length > 0) {
    const offeredUserRows = await db.$queryRaw<{ setup_user_id: string | null }[]>`
      SELECT setup_user_id FROM ccass.agents
      WHERE organization_id = ${organizationId}::bigint
        AND id IN (SELECT unnest(${offeredAgentIds}::bigint[]))
    `;
    releasedOfferUserIds = offeredUserRows
      .map((row) => (row.setup_user_id ? String(row.setup_user_id) : null))
      .filter((value): value is string => Boolean(value));
  }

  return { conversation: ended, drained, releasedOfferUserIds, cancelledTransfer };
}

export async function resolveConversation(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<{
  conversation: ConversationRecord;
  drained: DrainedQueuedConversation | null;
}> {
  const agent = await getAgentForUser(db, organizationId, userId);
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  if (conversation.assignedAgentId !== agent.id || conversation.status !== "active") {
    throw Object.assign(new Error("Only the assigned agent can resolve an active conversation"), {
      status: 409,
    });
  }

  const openWarmTransferRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id
    FROM ccass.conversation_transfers
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND requested_agent_id IS NOT NULL
      AND state = 'offered'
    LIMIT 1
  `;
  if (openWarmTransferRows[0]) {
    throw Object.assign(
      new Error("Cancel the pending transfer before resolving the conversation"),
      { status: 409 },
    );
  }

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      status = 'resolved',
      lifecycle_state = 'ended',
      resolved_at = NOW(),
      ended_at = NOW(),
      end_reason = 'agent_resolved',
      end_actor = 'agent',
      bot_active = FALSE,
      updated_at = NOW()
    WHERE id = ${conversationId}::bigint AND organization_id = ${organizationId}::bigint
  `;
  await db.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET state = 'ended', ended_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND state = 'accepted'
  `;
  await db.$executeRaw`
    UPDATE ccass.agent_capacity
    SET active_count = GREATEST(active_count - 1, 0), updated_at = NOW()
    WHERE agent_id = ${agent.id}::bigint
      AND channel = ${toRoutableChannel(conversation.channel)}
  `;
  if (conversation.channel === "webchat") {
    await db.$executeRaw`
      UPDATE ccass.webchat_sessions
      SET
        connection_state = 'ended',
        disconnected_at = COALESCE(disconnected_at, NOW()),
        ended_at = NOW(),
        end_reason = 'agent_resolved',
        ended_by = 'agent',
        updated_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
    `;
  }
  if (conversation.channel !== "email" && !isCallChannel(conversation.channel)) {
    await setAgentPresenceByAgentId(
      db,
      organizationId,
      agent.id,
      "ready",
      { userId, source: "conversation_resolved" },
    );
  }

  const resolved = await getConversation(db, organizationId, conversationId);
  if (!resolved) {
    throw Object.assign(new Error("Conversation not found after resolve"), { status: 500 });
  }
  await projectInteractionEvent(db, organizationId, {
    conversationId,
    eventType: "conversation.resolved",
    metadata: { agentId: serializeEntityId(agent.id) },
  });
  scheduleOmniChannelSummaryRefresh(organizationId, resolved.contactId);
  const drained = await drainQueuedConversationAfterCapacityFreed(
    db,
    organizationId,
    agent.id,
  );
  return { conversation: resolved, drained };
}

export type ResumeWebchatSessionResult = {
  conversation: ConversationRecord;
  sessionId: string;
  messages: MessageRecord[];
  connectionState: string;
  resumed: true;
};

/**
 * Resume an open Website Chat session after refresh/reconnect.
 * Looks up the latest non-terminal conversation for webchatId + visitorId.
 */
export async function resumeWebchatSession(
  db: DbClient,
  organizationId: string,
  input: { webchatId: string; visitorId: string },
): Promise<ResumeWebchatSessionResult | null> {
  const rows = await db.$queryRaw<(ConversationRow & { session_id: string; connection_state: string })[]>`
    SELECT c.*, ws.id AS session_id, ws.connection_state
    FROM ccass.webchat_sessions ws
    INNER JOIN ccass.conversations c
      ON c.id = ws.conversation_id
     AND c.organization_id = ws.organization_id
    WHERE ws.organization_id = ${organizationId}::bigint
      AND ws.webchat_id = ${input.webchatId}
      AND ws.visitor_id = ${input.visitorId}
      AND c.status IN ('bot_active', 'queued', 'assigned', 'active')
      AND COALESCE(ws.ended_at, c.ended_at) IS NULL
    ORDER BY c.updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  await db.$executeRaw`
    UPDATE ccass.webchat_sessions
    SET
      connection_state = 'connected',
      disconnected_at = NULL,
      updated_at = NOW()
    WHERE id = ${row.session_id}::bigint
      AND organization_id = ${organizationId}::bigint
  `;

  const conversation = mapConversation(row);
  const messages = await listConversationMessages(db, organizationId, conversation.id);
  return {
    conversation,
    sessionId: row.session_id,
    messages,
    connectionState: "connected",
    resumed: true,
  };
}

export async function markWebchatSessionDisconnected(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  options: { graceSeconds?: number } = {},
): Promise<void> {
  const graceSeconds = options.graceSeconds ?? 45;
  await db.$executeRaw`
    UPDATE ccass.webchat_sessions
    SET
      connection_state = 'disconnected',
      disconnected_at = NOW(),
      expires_at = NOW() + (${graceSeconds} || ' seconds')::interval,
      updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND ended_at IS NULL
  `;
}

export {
  startConversationSchema,
  appendMessageSchema,
  handoffSchema,
  listQuerySchema,
};
