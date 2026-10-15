import type { FastifyInstance } from "fastify";
import type Redis from "ioredis";

import { CALL_CHANNEL, isCallChannel } from "../lib/channels.js";
import { serializeEntityId } from "../lib/id-schema.js";
import { getRedisClient } from "../lib/redis-client.js";
import {
  umnCallSessionKey,
  umnCallStreamCheckpointKey,
  umnUserCallSessionKey,
} from "../lib/redis-keys.js";
import type { DbClient } from "../lib/rls.js";
import { withOrganizationContext } from "../lib/rls.js";
import {
  automaticVoiceDispositionSummary,
  endConversation,
  getConversation,
  isEndedConversationStatus,
  type ConversationRecord,
} from "./conversations.js";
import {
  emitConversationCreated,
  emitConversationEnded,
  emitVoiceCallOpened,
} from "./realtime.js";
import { scheduleSessionSentimentOnDisposition } from "./sentiment-analysis.js";
import {
  extractCallSessionKey,
  flushPendingCallTranscripts,
} from "./umn-call-transcript.js";

const CALL_SESSION_TTL_SECONDS = 8 * 60 * 60;
const CALL_USER_SESSION_TTL_SECONDS = 5 * 60;
const SIP_BROWSER_UA = "CCAAS:BROWSER";

export type VoiceCallControlAction = "hold" | "unhold" | "mute" | "unmute";

export type UmnCallInitPayload = {
  sessionId: string;
  domainId: string;
  domainName: string;
  ext: string;
  email: string;
  ani: string;
  dnis: string;
  quId: string;
  direction: "inbound" | "outbound";
  directionProvided: boolean;
  callState: string;
  status: string;
  deviceType: string;
  acdEvent: number;
  reqType: string;
  sessionStartTime: number;
  autoAttendant: number;
  virtualAgent: number;
  pd: number;
};

function stringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function numberField(record: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isInitMessage(record: Record<string, unknown>): boolean {
  const callState = stringField(record, ["call_state", "callState"]).toLowerCase();
  if (callState) return callState === "init";
  const type = stringField(record, ["type", "event", "messageType", "msgType"]).toLowerCase();
  return type === "init" || type === "call_init" || type === "callinit";
}

export function umnCallSubscribeChannel(): string {
  return process.env.CCAAS_CALL_SUB?.trim() || "CCAAS_CALL_SUB";
}

export function umnCallPublishChannel(): string {
  return process.env.CCAAS_CALL_PUB?.trim() || "CCAAS_CALL_PUB";
}

/** @deprecated use umnCallSubscribeChannel */
export function umnCallInitSubscribeChannel(): string {
  return umnCallSubscribeChannel();
}

export function parseInboundCallEvent(raw: string): UmnCallInitPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;

  const sessionId = stringField(record, ["session_id", "sessionId", "SessionId", "sid"]);
  const domainId = stringField(record, ["domain_id", "domainId", "organizationId", "orgId"]);
  if (!sessionId || !domainId) return null;

  const deviceType = stringField(record, ["device_type", "deviceType"]);
  if (deviceType && deviceType !== SIP_BROWSER_UA) return null;

  const callType = stringField(
    record,
    ["call_type", "callType", "direction", "callDirection"],
  ).toLowerCase();
  const directionProvided = callType === "inbound" || callType === "outbound";
  const explicitExt = stringField(record, ["ext", "extension"]);
  const cli = stringField(record, ["cli"]);
  const inferredInbound = Boolean(
    !directionProvided && explicitExt && cli && explicitExt !== cli,
  );
  const direction: "inbound" | "outbound" =
    callType === "inbound" || inferredInbound ? "inbound" : "outbound";
  // Inbound INIT has no agent yet. cli is the customer. Outbound still uses cli as the agent extension.
  const agentExt = direction === "inbound" ? explicitExt : explicitExt || cli;
  const ddi = stringField(record, ["ddi", "dnis", "DNIS", "to", "called"]);
  const inboundCaller = stringField(record, ["ani", "ANI", "from", "caller", "cli"]);

  return {
    sessionId: sessionId.slice(0, 128),
    domainId,
    domainName: stringField(record, ["domain_name", "domainName"]),
    ext: agentExt,
    email: stringField(record, ["email", "workEmail"]),
    ani: direction === "outbound" ? ddi : inboundCaller || ddi,
    dnis: ddi,
    quId: stringField(record, ["quId", "qid", "queueId", "queue_id"]),
    direction,
    directionProvided,
    callState: stringField(record, ["call_state", "callState"]),
    status: stringField(record, ["status"]).toLowerCase(),
    deviceType: deviceType || SIP_BROWSER_UA,
    acdEvent: numberField(record, ["acd_event", "acdEvent"], 2),
    reqType: stringField(record, ["req_type", "reqType"]) || "UPDATE",
    sessionStartTime: numberField(record, ["sessionStartTime", "session_start_time"]),
    autoAttendant: numberField(record, ["auto_attendant", "autoAttendant"]),
    virtualAgent: numberField(record, ["virtual_agent", "virtualAgent"]),
    pd: numberField(record, ["pd"]),
  };
}

function acdAcceptanceToken(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

const ACCEPTED_ACD_TOKENS = new Set(["accepted", "connected", "user accepted"]);

/** ACD has reported that the called user accepted. Agent-leg ringing and init do not qualify. */
export function isAcceptedAcdCallEvent(payload: Pick<UmnCallInitPayload, "status" | "callState">): boolean {
  const status = acdAcceptanceToken(payload.status);
  const callState = acdAcceptanceToken(payload.callState);
  return ACCEPTED_ACD_TOKENS.has(status) || ACCEPTED_ACD_TOKENS.has(callState);
}

const TERMINAL_ACD_STATES = new Set([
  "disconnected",
  "rejected",
  "abandoned",
  "cancel",
  "cancelled",
  "ended",
]);

/** ACD names the rung extension on `req_type: INVITE` before the agent answers. */
export function isAcdAgentRingEvent(
  payload: Pick<UmnCallInitPayload, "reqType" | "acdEvent" | "ext" | "callState" | "status">,
): boolean {
  if (!payload.ext.trim()) return false;
  if (isAcceptedAcdCallEvent(payload) || isTerminalAcdCallEvent(payload)) return false;
  if (payload.callState.trim().toLowerCase() === "init") return false;
  return payload.reqType.trim().toUpperCase() === "INVITE" || payload.acdEvent === 43;
}

export function isTerminalAcdCallEvent(payload: Pick<UmnCallInitPayload, "status" | "callState">): boolean {
  return (
    TERMINAL_ACD_STATES.has(payload.status.trim().toLowerCase()) ||
    TERMINAL_ACD_STATES.has(payload.callState.trim().toLowerCase())
  );
}

export type VoiceCallFinalizeReason =
  | "agent_declined"
  | "browser_disconnected"
  | "customer_disconnected"
  | "stale_voice_call_closed"
  | "abandoned"
  | "rejected";

export function voiceFinalizeDisposition(reason: VoiceCallFinalizeReason): {
  code: string;
  summary: string;
  resolution?: { code: string; summary: string };
} {
  const summary =
    automaticVoiceDispositionSummary(reason) ?? "Voice call ended before wrap-up was completed.";
  if (reason === "agent_declined" || reason === "rejected") {
    return { code: "agent_declined", summary };
  }
  if (reason === "browser_disconnected") {
    return { code: "browser_disconnected", summary };
  }
  return {
    code: "customer_disconnected",
    summary,
    resolution: { code: reason, summary },
  };
}

export function terminalVoiceFinalizeReason(
  payload: Pick<UmnCallInitPayload, "status" | "callState">,
): VoiceCallFinalizeReason {
  const token = `${payload.status} ${payload.callState}`.toLowerCase();
  if (token.includes("reject")) return "agent_declined";
  if (token.includes("abandon") || token.includes("cancel")) return "abandoned";
  return "customer_disconnected";
}

export function sameAcdCallSession(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left?.trim() || !right?.trim()) return false;
  return extractCallSessionKey(left) === extractCallSessionKey(right);
}

export function parseInboundCallInit(raw: string): UmnCallInitPayload | null {
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!record || typeof record !== "object" || !isInitMessage(record as Record<string, unknown>)) {
    return null;
  }
  return parseInboundCallEvent(raw);
}

function acdPublishBody(payload: UmnCallInitPayload, callState: string): Record<string, unknown> {
  return {
    session_id: payload.sessionId,
    acd_event: payload.acdEvent,
    domain_name: payload.domainName,
    domain_id: payload.domainId,
    cli: payload.ext,
    ddi: payload.dnis,
    pd: payload.pd,
    req_type: payload.reqType || "UPDATE",
    sessionStartTime: payload.sessionStartTime,
    call_type: payload.direction,
    call_state: callState,
    device_type: payload.deviceType || SIP_BROWSER_UA,
    auto_attendant: payload.autoAttendant,
    virtual_agent: payload.virtualAgent,
  };
}

async function cacheCallSession(payload: UmnCallInitPayload): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const serialized = JSON.stringify(payload);
  const canonicalSessionId = extractCallSessionKey(payload.sessionId);
  const pipeline = redis.pipeline();
  pipeline.set(
    umnCallSessionKey(payload.domainId, payload.sessionId),
    serialized,
    "EX",
    CALL_SESSION_TTL_SECONDS,
  );
  if (canonicalSessionId !== payload.sessionId) {
    pipeline.set(
      umnCallSessionKey(payload.domainId, canonicalSessionId),
      serialized,
      "EX",
      CALL_SESSION_TTL_SECONDS,
    );
  }
  await pipeline.exec();
}

async function loadCachedCallSession(
  organizationId: string,
  sessionId: string,
): Promise<UmnCallInitPayload | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  const exactKey = umnCallSessionKey(organizationId, sessionId);
  const canonicalSessionId = extractCallSessionKey(sessionId);
  const raw =
    (await redis.get(exactKey)) ??
    (canonicalSessionId !== sessionId
      ? await redis.get(umnCallSessionKey(organizationId, canonicalSessionId))
      : null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UmnCallInitPayload;
  } catch {
    return null;
  }
}

async function cacheCallSessionForUser(
  organizationId: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  await redis.set(
    umnUserCallSessionKey(organizationId, userId),
    sessionId,
    "EX",
    CALL_USER_SESSION_TTL_SECONDS,
  );
}

async function loadCachedCallSessionForUser(
  organizationId: string,
  userId: string,
): Promise<UmnCallInitPayload | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  const sessionId = await redis.get(umnUserCallSessionKey(organizationId, userId));
  if (!sessionId) return null;
  return loadCachedCallSession(organizationId, sessionId);
}

async function clearCachedCallSession(organizationId: string, sessionId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const canonicalSessionId = extractCallSessionKey(sessionId);
  const keys = [umnCallSessionKey(organizationId, sessionId)];
  if (canonicalSessionId !== sessionId) {
    keys.push(umnCallSessionKey(organizationId, canonicalSessionId));
  }
  await redis.del(...keys);
}

async function clearCachedCallSessionForUser(
  organizationId: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const key = umnUserCallSessionKey(organizationId, userId);
  await redis.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
    1,
    key,
    sessionId,
  );
}

export async function publishVoiceCallControl(
  organizationId: string,
  sessionId: string,
  action: VoiceCallControlAction,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const cached = await loadCachedCallSession(organizationId, sessionId);
  const payload: UmnCallInitPayload = cached ?? {
    sessionId,
    domainId: organizationId,
    domainName: "",
    ext: "",
    email: "",
    ani: "",
    dnis: "",
    quId: "",
    direction: "outbound",
    directionProvided: false,
    callState: action,
    status: "",
    deviceType: SIP_BROWSER_UA,
    acdEvent: 2,
    reqType: "UPDATE",
    sessionStartTime: Date.now(),
    autoAttendant: 0,
    virtualAgent: 0,
    pd: 0,
  };
  try {
    await redis.publish(umnCallPublishChannel(), JSON.stringify(acdPublishBody(payload, action)));
  } catch {
    // ACD publish is best-effort.
  }
}

async function findUserForCall(
  db: DbClient,
  organizationId: string,
  ext: string,
  email: string,
): Promise<{ id: string } | null> {
  const extNumber = Number(ext);
  if (ext && Number.isInteger(extNumber)) {
    const byExt = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM accounts.setup_users
      WHERE organization_id = ${organizationId}::bigint AND ext = ${extNumber}
      LIMIT 1
    `;
    if (byExt[0]) return { id: serializeEntityId(byExt[0].id) };
  }
  const emailNorm = email.trim().toLowerCase();
  if (!emailNorm) return null;
  const byEmail = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM accounts.setup_users
    WHERE organization_id = ${organizationId}::bigint
      AND lower(work_email) = ${emailNorm}
    LIMIT 1
  `;
  return byEmail[0] ? { id: serializeEntityId(byEmail[0].id) } : null;
}

async function findAgentForUser(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint AND setup_user_id = ${userId}::bigint
    LIMIT 1
  `;
  return rows[0] ? { id: serializeEntityId(rows[0].id) } : null;
}

async function resolveQueueId(
  db: DbClient,
  organizationId: string,
  userId: string,
  quId: string,
): Promise<string | null> {
  if (/^\d+$/.test(quId)) {
    const bySetup = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM ccass.queues
      WHERE organization_id = ${organizationId}::bigint
        AND (id = ${quId}::bigint OR setup_queue_id = ${quId}::bigint)
      LIMIT 1
    `;
    if (bySetup[0]) return serializeEntityId(bySetup[0].id);
  }
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT q.id
    FROM accounts.setup_ccaas_queue_agents qa
    INNER JOIN ccass.queues q
      ON q.setup_queue_id = qa.queue_id AND q.organization_id = ${organizationId}::bigint
    WHERE qa.user_id = ${userId}::bigint
    ORDER BY qa.id ASC
    LIMIT 1
  `;
  return rows[0] ? serializeEntityId(rows[0].id) : null;
}

async function resolveVoiceChannelConfigId(
  db: DbClient,
  organizationId: string,
): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM accounts.setup_channel_configs
    WHERE organization_id = ${organizationId}::bigint
      AND channel_type IN ('voice', 'call', 'phone')
    ORDER BY id ASC
    LIMIT 1
  `;
  return rows[0] ? serializeEntityId(rows[0].id) : null;
}

async function findUnassignedVoicebotConversation(
  db: DbClient,
  organizationId: string,
  sessionId: string,
): Promise<{ id: string } | null> {
  const rows = await db.$queryRaw<
    Array<{ id: string; external_thread_id: string | null; provider_thread_id: string | null }>
  >`
    SELECT id, external_thread_id, provider_thread_id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel IN ('call', 'voice', 'phone')
      AND status = 'bot_active'
      AND assigned_user_id IS NULL
      AND created_at >= NOW() - INTERVAL '8 hours'
    ORDER BY updated_at DESC
    LIMIT 30
  `;
  const match = rows.find(
    (row) =>
      sameAcdCallSession(row.provider_thread_id, sessionId) ||
      sameAcdCallSession(row.external_thread_id, sessionId),
  );
  return match ? { id: serializeEntityId(match.id) } : null;
}

async function upsertVoiceConversation(
  db: DbClient,
  organizationId: string,
  input: {
    sessionId: string;
    userId: string;
    agentId: string;
    queueId: string | null;
    channelConfigId: string | null;
    visitorId: string | null;
    direction: "inbound" | "outbound";
  },
): Promise<{
  conversation: ConversationRecord;
  closedConversations: ConversationRecord[];
}> {
  const subject = input.direction === "inbound" ? "Inbound call" : "Outbound call";
  const active = await db.$queryRaw<
    Array<{
      id: string;
      external_thread_id: string | null;
      provider_thread_id: string | null;
      visitor_id: string | null;
    }>
  >`
    SELECT id, external_thread_id, provider_thread_id, visitor_id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel IN ('call', 'voice', 'phone')
      AND status = 'active'
      AND assigned_user_id = ${input.userId}::bigint
    ORDER BY updated_at DESC
  `;
  const existing =
    active.find(
      (row) =>
        sameAcdCallSession(row.provider_thread_id, input.sessionId) ||
        sameAcdCallSession(row.external_thread_id, input.sessionId),
    ) ??
    active.find(
      (row) =>
        Boolean(input.visitorId && row.visitor_id === input.visitorId) &&
        ((row.external_thread_id ?? "").startsWith("sip-inbound:") ||
          (row.provider_thread_id ?? "").startsWith("sip-inbound:")),
    );
  const voicebot = existing
    ? null
    : await findUnassignedVoicebotConversation(db, organizationId, input.sessionId);
  const existingId = existing
    ? serializeEntityId(existing.id)
    : voicebot
      ? serializeEntityId(voicebot.id)
      : null;
  const staleIds = active
    .filter((row) => serializeEntityId(row.id) !== existingId)
    .map((row) => serializeEntityId(row.id));
  const closedConversations: ConversationRecord[] = [];

  for (const staleId of staleIds) {
    await db.$executeRaw`
      UPDATE ccass.conversations
      SET
        status = 'resolved',
        lifecycle_state = 'ended',
        resolved_at = COALESCE(resolved_at, NOW()),
        closed_at = COALESCE(closed_at, NOW()),
        ended_at = COALESCE(ended_at, NOW()),
        end_reason = COALESCE(end_reason, 'superseded_by_new_voice_call'),
        end_actor = COALESCE(end_actor, 'system'),
        updated_at = NOW()
      WHERE id = ${staleId}::bigint
        AND organization_id = ${organizationId}::bigint
        AND channel IN ('call', 'voice', 'phone')
        AND status = 'active'
    `;
    await db.$executeRaw`
      UPDATE ccass.conversation_assignments
      SET state = 'ended', ended_at = COALESCE(ended_at, NOW())
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${staleId}::bigint
        AND state IN ('offered', 'accepted')
    `;
    const closed = await getConversation(db, organizationId, staleId, { channel: CALL_CHANNEL });
    if (closed) closedConversations.push(closed);
  }
  const rows = existingId
    ? await db.$queryRaw<{ id: string }[]>`
        UPDATE ccass.conversations
        SET
          channel = ${CALL_CHANNEL},
          direction = ${input.direction},
          status = 'active',
          lifecycle_state = 'connected',
          assigned_agent_id = CASE
            WHEN EXISTS (
              SELECT 1
              FROM ccass.conversation_transfers open_consult
              WHERE open_consult.organization_id = ccass.conversations.organization_id
                AND open_consult.conversation_id = ccass.conversations.id
                AND open_consult.state IN ('offered', 'accepted')
                AND open_consult.requested_agent_id = ${input.agentId}::bigint
                AND open_consult.from_agent_id IS DISTINCT FROM ${input.agentId}::bigint
            ) THEN assigned_agent_id
            ELSE ${input.agentId}::bigint
          END,
          assigned_user_id = CASE
            WHEN EXISTS (
              SELECT 1
              FROM ccass.conversation_transfers open_consult
              WHERE open_consult.organization_id = ccass.conversations.organization_id
                AND open_consult.conversation_id = ccass.conversations.id
                AND open_consult.state IN ('offered', 'accepted')
                AND open_consult.requested_agent_id = ${input.agentId}::bigint
                AND open_consult.from_agent_id IS DISTINCT FROM ${input.agentId}::bigint
            ) THEN assigned_user_id
            ELSE ${input.userId}::bigint
          END,
          assigned_at = COALESCE(assigned_at, NOW()),
          queue_id = COALESCE(${input.queueId}::bigint, queue_id),
          visitor_id = COALESCE(${input.visitorId}, visitor_id),
          provider_thread_id = ${input.sessionId},
          subject = COALESCE(subject, ${subject}),
          bot_active = FALSE,
          updated_at = NOW()
        WHERE id = ${existingId}::bigint
          AND organization_id = ${organizationId}::bigint
          AND channel IN ('call', 'voice', 'phone')
        RETURNING id
      `
    : await db.$queryRaw<{ id: string }[]>`
        INSERT INTO ccass.conversations (
          organization_id, channel, direction, external_thread_id, provider_thread_id,
          visitor_id, subject, queue_id, channel_config_id, status, lifecycle_state,
          bot_active, nlp_enabled, live_agent_enabled, assigned_agent_id, assigned_user_id,
          assigned_at
        ) VALUES (
          ${organizationId}::bigint,
          ${CALL_CHANNEL},
          ${input.direction},
          ${input.sessionId},
          ${input.sessionId},
          ${input.visitorId},
          ${subject},
          ${input.queueId}::bigint,
          ${input.channelConfigId}::bigint,
          'active',
          'connected',
          FALSE,
          FALSE,
          TRUE,
          ${input.agentId}::bigint,
          ${input.userId}::bigint,
          NOW()
        )
        ON CONFLICT (organization_id, channel, external_thread_id) DO UPDATE
          SET
            status = 'active',
            lifecycle_state = 'connected',
            direction = EXCLUDED.direction,
            assigned_agent_id = EXCLUDED.assigned_agent_id,
            assigned_user_id = EXCLUDED.assigned_user_id,
            assigned_at = COALESCE(ccass.conversations.assigned_at, NOW()),
            queue_id = COALESCE(EXCLUDED.queue_id, ccass.conversations.queue_id),
            visitor_id = COALESCE(EXCLUDED.visitor_id, ccass.conversations.visitor_id),
            provider_thread_id = EXCLUDED.provider_thread_id,
            subject = COALESCE(ccass.conversations.subject, EXCLUDED.subject),
            bot_active = FALSE,
            nlp_enabled = FALSE,
            updated_at = NOW()
        RETURNING id
      `;
  const conversationId = serializeEntityId(rows[0]!.id);

  await db.$executeRaw`
    INSERT INTO ccass.conversation_assignments (
      organization_id, conversation_id, queue_id, agent_id, state, reason, offered_at, accepted_at
    )
    SELECT
      ${organizationId}::bigint,
      ${conversationId}::bigint,
      ${input.queueId}::bigint,
      ${input.agentId}::bigint,
      'accepted',
      'umn_call_connected',
      NOW(),
      NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM ccass.conversation_assignments
      WHERE conversation_id = ${conversationId}::bigint
        AND organization_id = ${organizationId}::bigint
        AND reason = 'umn_call_connected'
    )
  `;

  if (input.visitorId) {
    await db.$executeRaw`
      INSERT INTO ccass.conversation_participants (
        organization_id, conversation_id, participant_type, identity_ref
      )
      SELECT
        ${organizationId}::bigint,
        ${conversationId}::bigint,
        'customer',
        ${input.visitorId}
      WHERE NOT EXISTS (
        SELECT 1 FROM ccass.conversation_participants
        WHERE conversation_id = ${conversationId}::bigint
          AND organization_id = ${organizationId}::bigint
          AND identity_ref = ${input.visitorId}
      )
    `;
  }

  const conversation = await getConversation(db, organizationId, conversationId, {
    channel: CALL_CHANNEL,
  });
  if (!conversation) {
    throw new Error("Voice conversation missing after ACD connected upsert");
  }
  return { conversation, closedConversations };
}

async function persistCallWorkspace(
  app: FastifyInstance,
  db: DbClient,
  payload: UmnCallInitPayload,
  user: { id: string },
  agent: { id: string },
  phase: "connected" | "sip-answer",
): Promise<ConversationRecord> {
  const organizationId = payload.domainId;
  const queueId = await resolveQueueId(db, organizationId, user.id, payload.quId);
  const channelConfigId = await resolveVoiceChannelConfigId(db, organizationId);
  const visitorId = payload.ani || payload.dnis || null;
  await cacheCallSession(payload);
  const { conversation, closedConversations } = await upsertVoiceConversation(
    db,
    organizationId,
    {
      sessionId: payload.sessionId,
      userId: user.id,
      agentId: agent.id,
      queueId,
      channelConfigId,
      visitorId,
      direction: payload.direction,
    },
  );

  app.log.info(
    {
      event: "acd.workspace.link.succeeded",
      organizationId,
      userId: user.id,
      conversationId: conversation.id,
      sessionId: payload.sessionId,
      phase,
      direction: payload.direction,
      ext: payload.ext,
    },
    "CCAAS call linked to workspace; emitting voice.call.opened",
  );
  for (const closed of closedConversations) {
    app.log.info(
      {
        event: "acd.workspace.previous-call-closed",
        organizationId,
        sessionId: payload.sessionId,
        closedConversationId: closed.id,
      },
      "Previous active voice conversation closed",
    );
    emitConversationEnded(organizationId, closed);
  }
  await flushPendingCallTranscripts(app, payload.sessionId);
  emitConversationCreated(organizationId, conversation);
  emitVoiceCallOpened(organizationId, user.id, conversation, payload.sessionId);
  app.log.info(
    {
      event: "acd.workspace.voice-call-opened-emitted",
      organizationId,
      userId: user.id,
      conversationId: conversation.id,
      sessionId: payload.sessionId,
    },
    "voice.call.opened emitted to assigned agent",
  );
  await clearCachedCallSessionForUser(
    organizationId,
    user.id,
    payload.sessionId,
  );
  app.log.info(
    {
      event: "acd.workspace.pending-transcripts-flushed",
      organizationId,
      conversationId: conversation.id,
      sessionId: payload.sessionId,
    },
    "Pending call transcripts flushed",
  );
  return conversation;
}

async function linkCallToWorkspace(
  app: FastifyInstance,
  payload: UmnCallInitPayload,
  phase: "connected",
): Promise<void> {
  const organizationId = payload.domainId;
  app.log.info(
    {
      event: "acd.workspace.link.started",
      organizationId,
      sessionId: payload.sessionId,
      phase,
      status: payload.status,
      callState: payload.callState,
      direction: payload.direction,
      ext: payload.ext,
      queueId: payload.quId || null,
    },
    "ACD workspace link started",
  );
  await withOrganizationContext(app.prisma, organizationId, async (db) => {
    const user = await findUserForCall(db, organizationId, payload.ext, payload.email);
    if (!user) {
      app.log.warn(
        {
          event: "acd.workspace.link.user-not-found",
          organizationId,
          sessionId: payload.sessionId,
          ext: payload.ext,
          hasEmail: Boolean(payload.email),
          phase,
        },
        "umn call ignored: user not found",
      );
      return;
    }
    const agent = await findAgentForUser(db, organizationId, user.id);
    if (!agent) {
      app.log.warn(
        {
          event: "acd.workspace.link.agent-not-found",
          organizationId,
          sessionId: payload.sessionId,
          userId: user.id,
          phase,
        },
        "umn call ignored: agent not found",
      );
      return;
    }

    await persistCallWorkspace(app, db, payload, user, agent, phase);
  });
}

/** Bind the stored session to the extension ACD is ringing. Do not open the workspace. */
export async function applyInboundCallRing(
  app: FastifyInstance,
  ringEvent: UmnCallInitPayload,
): Promise<void> {
  const cached = await loadCachedCallSession(ringEvent.domainId, ringEvent.sessionId);
  const merged = mergeCallSession(cached, ringEvent);
  const stored: UmnCallInitPayload = {
    ...merged,
    ext: cached?.ext.trim() ? cached.ext : ringEvent.ext,
  };
  await cacheCallSession(stored);
  await withOrganizationContext(app.prisma, ringEvent.domainId, async (db) => {
    const user = await findUserForCall(db, ringEvent.domainId, ringEvent.ext, ringEvent.email);
    if (!user) {
      app.log.warn(
        {
          event: "acd.call.ring-user-not-found",
          organizationId: ringEvent.domainId,
          sessionId: stored.sessionId,
          ext: ringEvent.ext,
        },
        "ACD ring cached without an agent binding",
      );
      return;
    }
    await cacheCallSessionForUser(ringEvent.domainId, user.id, stored.sessionId);
    app.log.info(
      {
        event: "acd.call.ring-bound",
        organizationId: ringEvent.domainId,
        userId: user.id,
        sessionId: stored.sessionId,
        ext: ringEvent.ext,
      },
      "ACD ring bound the stored session to the agent",
    );
  });
}

export async function applyInboundCallInit(
  app: FastifyInstance,
  payload: UmnCallInitPayload,
): Promise<void> {
  await cacheCallSession(payload);
  await withOrganizationContext(app.prisma, payload.domainId, async (db) => {
    const user = await findUserForCall(db, payload.domainId, payload.ext, payload.email);
    if (!user) {
      app.log.warn(
        {
          event: "acd.call.init-user-not-found",
          organizationId: payload.domainId,
          sessionId: payload.sessionId,
          ext: payload.ext,
          hasEmail: Boolean(payload.email),
        },
        "ACD init cached without a user-session binding",
      );
      return;
    }
    await cacheCallSessionForUser(payload.domainId, user.id, payload.sessionId);
    app.log.info(
      {
        event: "acd.call.init-user-bound",
        organizationId: payload.domainId,
        userId: user.id,
        sessionId: payload.sessionId,
        direction: payload.direction,
      },
      "ACD init session bound to agent user",
    );
  });
}

function mergeCallSession(
  cached: UmnCallInitPayload | null,
  event: UmnCallInitPayload,
): UmnCallInitPayload {
  if (!cached) return event;
  return {
    ...cached,
    ...event,
    domainName: event.domainName || cached.domainName,
    ext: event.ext || cached.ext,
    email: event.email || cached.email,
    ani: event.ani || cached.ani,
    dnis: event.dnis || cached.dnis,
    quId: event.quId || cached.quId,
    direction: event.directionProvided ? event.direction : cached.direction,
    directionProvided: event.directionProvided || cached.directionProvided,
    callState: event.callState || cached.callState,
    deviceType: event.deviceType || cached.deviceType,
    sessionStartTime: event.sessionStartTime || cached.sessionStartTime,
  };
}

export async function applyInboundCallConnected(
  app: FastifyInstance,
  connectedEvent: UmnCallInitPayload,
): Promise<void> {
  const cached = await loadCachedCallSession(
    connectedEvent.domainId,
    connectedEvent.sessionId,
  );
  const payload = mergeCallSession(cached, connectedEvent);
  app.log.info(
    {
      event: "acd.call.connected-merged",
      organizationId: payload.domainId,
      sessionId: payload.sessionId,
      hadCachedInit: Boolean(cached),
      incomingExt: connectedEvent.ext,
      mergedExt: payload.ext,
      incomingDirection: connectedEvent.direction,
      incomingDirectionProvided: connectedEvent.directionProvided,
      mergedDirection: payload.direction,
      status: payload.status,
      callState: payload.callState,
    },
    "ACD connected event merged with cached init context",
  );
  await linkCallToWorkspace(app, payload, "connected");
}

async function findVoiceConversationBySession(
  db: DbClient,
  organizationId: string,
  sessionId: string,
): Promise<ConversationRecord | null> {
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      channel: string;
      provider_thread_id: string | null;
      external_thread_id: string | null;
    }>
  >`
    SELECT id, channel, provider_thread_id, external_thread_id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel IN ('call', 'voice', 'phone')
      AND created_at >= NOW() - INTERVAL '8 hours'
    ORDER BY updated_at DESC
    LIMIT 50
  `;
  const match = rows.find(
    (row) =>
      sameAcdCallSession(row.provider_thread_id, sessionId) ||
      sameAcdCallSession(row.external_thread_id, sessionId),
  );
  if (!match) return null;
  return getConversation(db, organizationId, serializeEntityId(match.id), {
    channel: match.channel,
  });
}

async function endVoiceConversationIfOpen(
  app: FastifyInstance,
  db: DbClient,
  organizationId: string,
  conversation: ConversationRecord,
  reason: VoiceCallFinalizeReason,
  userId: string | null,
): Promise<ConversationRecord> {
  if (isEndedConversationStatus(conversation.status)) {
    return conversation;
  }
  const disposition = voiceFinalizeDisposition(reason);
  const result = await endConversation(db, organizationId, userId, conversation.id, {
    actor: "system",
    reason,
    disposition: {
      code: disposition.code,
      note: disposition.summary,
      resolution: disposition.resolution,
      isFinal: true,
    },
  });
  app.log.info(
    {
      event: "acd.workspace.voice-finalized",
      organizationId,
      conversationId: result.conversation.id,
      sessionId: result.conversation.providerThreadId || result.conversation.externalThreadId,
      reason,
      dispositionCode: disposition.code,
    },
    "Voice conversation closed with system disposition",
  );
  emitConversationEnded(organizationId, result.conversation);
  scheduleSessionSentimentOnDisposition(app.prisma, organizationId, result.conversation.id);
  return result.conversation;
}

export async function applyInboundCallEnded(
  app: FastifyInstance,
  endedEvent: UmnCallInitPayload,
): Promise<void> {
  const reason = terminalVoiceFinalizeReason(endedEvent);
  const cached = await loadCachedCallSession(endedEvent.domainId, endedEvent.sessionId);
  const payload = mergeCallSession(cached, endedEvent);
  app.log.info(
    {
      event: "acd.call.ended",
      organizationId: payload.domainId,
      sessionId: payload.sessionId,
      status: payload.status,
      callState: payload.callState,
      reason,
      ext: payload.ext,
    },
    "ACD terminal call event received",
  );
  await withOrganizationContext(app.prisma, payload.domainId, async (db) => {
    const conversation = await findVoiceConversationBySession(
      db,
      payload.domainId,
      payload.sessionId,
    );
    if (!conversation) {
      app.log.info(
        {
          event: "acd.call.ended-no-conversation",
          organizationId: payload.domainId,
          sessionId: payload.sessionId,
          reason,
        },
        "ACD terminal event had no matching voice conversation",
      );
      return;
    }
    const openConsult = await db.$queryRaw<Array<{ id: bigint }>>`
      SELECT id
      FROM ccass.conversation_transfers
      WHERE organization_id = ${payload.domainId}::bigint
        AND conversation_id = ${conversation.id}::bigint
        AND state IN ('offered', 'accepted')
      LIMIT 1
    `;
    if (openConsult.length > 0) {
      app.log.info(
        {
          event: "acd.call.ended-open-consult",
          organizationId: payload.domainId,
          sessionId: payload.sessionId,
          conversationId: conversation.id,
          reason,
        },
        "ACD terminal event left the conversation open because a consult is still active",
      );
      return;
    }
    if (conversation.status === "bot_active" && !conversation.assignedUserId) {
      const closed = await db.$queryRaw<{ id: string }[]>`
        UPDATE ccass.conversations
        SET
          status = 'closed',
          lifecycle_state = 'ended',
          bot_active = FALSE,
          closed_at = COALESCE(closed_at, NOW()),
          ended_at = COALESCE(ended_at, NOW()),
          end_reason = ${reason},
          end_actor = 'system',
          updated_at = NOW()
        WHERE id = ${conversation.id}::bigint
          AND organization_id = ${payload.domainId}::bigint
          AND status = 'bot_active'
          AND assigned_user_id IS NULL
        RETURNING id::text AS id
      `;
      if (closed[0]) {
        app.log.info(
          {
            event: "acd.call.voicebot-closed",
            organizationId: payload.domainId,
            sessionId: payload.sessionId,
            conversationId: conversation.id,
            reason,
          },
          "Voicebot conversation closed before a live agent connected",
        );
        return;
      }
    }
    const userId = conversation.assignedUserId;
    await endVoiceConversationIfOpen(app, db, payload.domainId, conversation, reason, userId);
    if (userId) {
      await clearCachedCallSessionForUser(payload.domainId, userId, payload.sessionId);
    }
  });
  await clearCachedCallSession(payload.domainId, payload.sessionId);
}

export async function finalizeVoiceCallForUser(
  app: FastifyInstance,
  db: DbClient,
  organizationId: string,
  userId: string,
  input: {
    conversationId?: string | null;
    sessionId?: string | null;
    reason: VoiceCallFinalizeReason;
  },
): Promise<{ conversation: ConversationRecord | null }> {
  const conversationId = input.conversationId?.trim() || null;
  const sessionId = input.sessionId?.trim() || null;
  let conversation = conversationId
    ? await getConversation(db, organizationId, conversationId, { channel: CALL_CHANNEL })
    : null;
  if (!conversation && conversationId) {
    const byId = await getConversation(db, organizationId, conversationId);
    conversation = byId && isCallChannel(byId.channel) ? byId : null;
  }
  if (!conversation && sessionId) {
    conversation = await findVoiceConversationBySession(db, organizationId, sessionId);
  }
  if (!conversation) {
    app.log.info(
      {
        event: "voice.finalize.not-found",
        organizationId,
        userId,
        conversationId,
        sessionId,
        reason: input.reason,
      },
      "Voice finalize found no matching conversation",
    );
    if (sessionId) {
      await clearCachedCallSession(organizationId, sessionId);
      await clearCachedCallSessionForUser(organizationId, userId, sessionId);
    }
    return { conversation: null };
  }
  if (conversation.assignedUserId && conversation.assignedUserId !== userId) {
    throw Object.assign(new Error("Voice conversation is assigned to another user"), {
      status: 403,
    });
  }
  if (input.reason === "stale_voice_call_closed") {
    app.log.info(
      {
        event: "voice.finalize.stale-ignored",
        organizationId,
        userId,
        conversationId: conversation.id,
      },
      "Ignored stale voice close; only a server-owned terminal transition may end the call",
    );
    return { conversation };
  }
  const ended = await endVoiceConversationIfOpen(
    app,
    db,
    organizationId,
    conversation,
    input.reason,
    userId,
  );
  const linkedSessionId = ended.providerThreadId || ended.externalThreadId || sessionId;
  if (linkedSessionId) {
    await clearCachedCallSession(organizationId, linkedSessionId);
    await clearCachedCallSessionForUser(organizationId, userId, linkedSessionId);
  }
  return { conversation: ended };
}

export async function publishVoiceCallControlForConversation(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  action: VoiceCallControlAction,
): Promise<void> {
  const conversation = await getConversation(db, organizationId, conversationId, {
    channel: CALL_CHANNEL,
  });
  if (!conversation || !isCallChannel(conversation.channel)) {
    throw Object.assign(new Error("Voice conversation not found"), { status: 404 });
  }
  const sessionId = conversation.providerThreadId || conversation.externalThreadId;
  if (!sessionId) {
    throw Object.assign(new Error("Call session id is missing"), { status: 409 });
  }
  await publishVoiceCallControl(organizationId, sessionId, action);
}

/** An inbound session stored with no agent belongs to the agent who accepts that session id. */
export function inboundAnswerOwnsCachedSession(input: {
  direction: "inbound" | "outbound";
  cachedUserId: string | null;
  requestedSessionId: string | null;
  userId: string;
}): boolean {
  if (input.cachedUserId) return input.cachedUserId === input.userId;
  return input.direction === "inbound" && Boolean(input.requestedSessionId);
}

export async function ensureVoiceCallForUser(
  app: FastifyInstance,
  db: DbClient,
  organizationId: string,
  userId: string,
  input: { sessionId?: string | null; destination?: string | null },
): Promise<{ conversation: ConversationRecord; sessionId: string }> {
  const existing = await getActiveVoiceCallForUser(db, organizationId, userId);
  const requestedSessionId = input.sessionId?.trim();
  if (requestedSessionId?.startsWith("sip-inbound:")) {
    throw Object.assign(new Error("A real ACD session id is required"), { status: 400 });
  }
  if (
    existing &&
    requestedSessionId &&
    sameAcdCallSession(requestedSessionId, existing.sessionId)
  ) {
    return existing;
  }
  if (requestedSessionId) {
    const consult = await getOpenVoiceConsultForUser(
      db,
      organizationId,
      userId,
      requestedSessionId,
    );
    if (consult) return consult;
  }

  const cached = requestedSessionId
    ? await loadCachedCallSession(organizationId, requestedSessionId)
    : await loadCachedCallSessionForUser(organizationId, userId);
  if (!cached) {
    if (existing && !requestedSessionId) return existing;
    throw Object.assign(new Error("ACD call session is not available yet"), { status: 404 });
  }
  if (existing && sameAcdCallSession(cached.sessionId, existing.sessionId)) {
    return existing;
  }
  if (
    requestedSessionId &&
    !sameAcdCallSession(requestedSessionId, cached.sessionId)
  ) {
    throw Object.assign(new Error("Cached ACD call session does not match the SIP session"), {
      status: 409,
    });
  }
  const requestedDestination = input.destination?.replace(/\D/g, "") ?? "";
  const cachedDestination = cached.dnis.replace(/\D/g, "");
  if (
    !requestedSessionId &&
    cached.direction === "outbound" &&
    requestedDestination &&
    cachedDestination &&
    requestedDestination !== cachedDestination
  ) {
    throw Object.assign(new Error("ACD call destination does not match the active SIP call"), {
      status: 409,
    });
  }
  if (cached.direction === "outbound" && !isAcceptedAcdCallEvent(cached)) {
    throw Object.assign(new Error("ACD user has not accepted the outbound call"), {
      status: 409,
    });
  }

  const cachedUser = await findUserForCall(db, organizationId, cached.ext, cached.email);
  if (
    !inboundAnswerOwnsCachedSession({
      direction: cached.direction,
      cachedUserId: cachedUser?.id ?? null,
      requestedSessionId: requestedSessionId ?? null,
      userId,
    })
  ) {
    throw Object.assign(new Error("ACD call session is assigned to another user"), {
      status: 403,
    });
  }
  const user = cachedUser ?? { id: userId };
  const agent = await findAgentForUser(db, organizationId, userId);
  if (!agent) {
    throw Object.assign(new Error("Voice agent is not available"), { status: 404 });
  }
  const conversation = await persistCallWorkspace(
    app,
    db,
    cached,
    user,
    agent,
    "sip-answer",
  );
  return { conversation, sessionId: cached.sessionId };
}

async function getOpenVoiceConsultForUser(
  db: DbClient,
  organizationId: string,
  userId: string,
  requestedSessionId: string,
): Promise<{ conversation: ConversationRecord; sessionId: string } | null> {
  const rows = await db.$queryRaw<
    { id: string; session_id: string; channel: string }[]
  >`
    SELECT
      conversation.id::text AS id,
      COALESCE(conversation.provider_thread_id, conversation.external_thread_id) AS session_id,
      conversation.channel,
      conversation.updated_at
    FROM ccass.conversations AS conversation
    INNER JOIN ccass.conversation_transfers AS transfer
      ON transfer.organization_id = conversation.organization_id
     AND transfer.conversation_id = conversation.id
     AND transfer.state IN ('offered', 'accepted')
    INNER JOIN ccass.agents AS target
      ON target.organization_id = conversation.organization_id
     AND target.id IN (transfer.requested_agent_id, transfer.offered_agent_id)
    WHERE conversation.organization_id = ${organizationId}::bigint
      AND target.setup_user_id = ${userId}::bigint
      AND conversation.status NOT IN ('resolved', 'closed')
    ORDER BY conversation.updated_at DESC
    LIMIT 5
  `;
  const row = rows.find(
    (candidate) =>
      candidate.session_id &&
      sameAcdCallSession(requestedSessionId, candidate.session_id),
  );
  if (!row) return null;
  const conversation = await getConversation(
    db,
    organizationId,
    row.id,
    { channel: row.channel },
  );
  return conversation
    ? { conversation, sessionId: row.session_id }
    : null;
}

export async function getActiveVoiceCallForUser(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<{ conversation: ConversationRecord; sessionId: string } | null> {
  const rows = await db.$queryRaw<{ id: string; session_id: string; channel: string }[]>`
    SELECT id, COALESCE(provider_thread_id, external_thread_id) AS session_id, channel
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND assigned_user_id = ${userId}::bigint
      AND channel IN ('call', 'voice', 'phone')
      AND status = 'active'
      AND created_at >= NOW() - INTERVAL '30 minutes'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.session_id) return null;
  const conversation = await getConversation(db, organizationId, serializeEntityId(row.id), {
    channel: row.channel,
  });
  if (!conversation) return null;
  return { conversation, sessionId: row.session_id };
}

type RedisStreamResponse = Array<[string, Array<[string, string[]]>]>;

export function redisStreamMessage(fields: string[]): string | null {
  for (let index = 0; index < fields.length - 1; index += 2) {
    if (fields[index] === "message") return fields[index + 1] ?? null;
  }
  return null;
}

export function startUmnCallStreamConsumer(
  app: FastifyInstance,
  streamClient: Redis,
): () => void {
  const stream = umnCallSubscribeChannel();
  const checkpointKey = umnCallStreamCheckpointKey(stream);
  let stopped = false;

  app.log.info({ stream }, "CCAAS call Redis Stream consumer connected");

  void (async () => {
    let lastId = "$";
    try {
      lastId = (await streamClient.get(checkpointKey)) || "$";
    } catch (error) {
      app.log.warn({ err: error, stream }, "CCAAS call Stream checkpoint read failed");
    }
    while (!stopped) {
      try {
        const response = (await streamClient.xread(
          "COUNT",
          20,
          "BLOCK",
          5_000,
          "STREAMS",
          stream,
          lastId,
        )) as RedisStreamResponse | null;

        if (!response) continue;
        for (const [, entries] of response) {
          for (const [entryId, fields] of entries) {
            const message = redisStreamMessage(fields);
            const payload = message ? parseInboundCallEvent(message) : null;
            if (payload) {
              app.log.info(
                {
                  event: "acd.call.event-received",
                  stream,
                  entryId,
                  organizationId: payload.domainId,
                  sessionId: payload.sessionId,
                  status: payload.status,
                  callState: payload.callState,
                  direction: payload.direction,
                  directionProvided: payload.directionProvided,
                  ext: payload.ext,
                  acdEvent: payload.acdEvent,
                  requestType: payload.reqType,
                },
                "ACD call event received",
              );
              try {
                if (isAcceptedAcdCallEvent(payload)) {
                  app.log.info(
                    {
                      event: "acd.call.accepted",
                      stream,
                      entryId,
                      organizationId: payload.domainId,
                      ext: payload.ext,
                      sessionId: payload.sessionId,
                      status: payload.status,
                      callState: payload.callState,
                    },
                    "CCAAS accepted call received",
                  );
                  await applyInboundCallConnected(app, payload);
                } else if (isTerminalAcdCallEvent(payload)) {
                  app.log.info(
                    {
                      event: "acd.call.terminal",
                      stream,
                      entryId,
                      organizationId: payload.domainId,
                      sessionId: payload.sessionId,
                      status: payload.status,
                      callState: payload.callState,
                    },
                    "CCAAS terminal call received",
                  );
                  await applyInboundCallEnded(app, payload);
                } else if (payload.callState.toLowerCase() === "init") {
                  app.log.info(
                    {
                      event: "acd.call.init",
                      stream,
                      entryId,
                      organizationId: payload.domainId,
                      sessionId: payload.sessionId,
                      direction: payload.direction,
                      ext: payload.ext,
                    },
                    "CCAAS call init received and cached",
                  );
                  await applyInboundCallInit(app, payload);
                } else if (isAcdAgentRingEvent(payload)) {
                  app.log.info(
                    {
                      event: "acd.call.ring",
                      stream,
                      entryId,
                      organizationId: payload.domainId,
                      sessionId: payload.sessionId,
                      ext: payload.ext,
                      acdEvent: payload.acdEvent,
                    },
                    "CCAAS ring names the agent for the stored session",
                  );
                  await applyInboundCallRing(app, payload);
                } else {
                  app.log.info(
                    {
                      event: "acd.call.ignored-state",
                      stream,
                      entryId,
                      organizationId: payload.domainId,
                      sessionId: payload.sessionId,
                      status: payload.status,
                      callState: payload.callState,
                    },
                    "ACD call event ignored: state does not open workspace",
                  );
                }
              } catch (error) {
                throw Object.assign(new Error("CCAAS call event apply failed"), {
                  cause: error,
                  entryId,
                  payload,
                });
              }
            } else {
              app.log.warn(
                {
                  event: "acd.call.unparseable",
                  stream,
                  entryId,
                  hasMessageField: Boolean(message),
                  fieldNames: fields.filter((_, index) => index % 2 === 0),
                },
                "ACD call stream entry could not be parsed",
              );
            }
            await streamClient.set(checkpointKey, entryId);
            app.log.debug(
              {
                event: "acd.call.checkpoint-advanced",
                stream,
                entryId,
                checkpointKey,
              },
              "ACD call stream checkpoint advanced",
            );
            lastId = entryId;
          }
        }
      } catch (error) {
        if (stopped) return;
        app.log.warn(
          {
            event: "acd.call.consumer-error",
            err: error,
            stream,
            lastId,
          },
          "CCAAS call Redis Stream read failed",
        );
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  })();

  return () => {
    stopped = true;
  };
}
