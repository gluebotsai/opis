import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Redis from "ioredis";

import { CALL_CHANNEL } from "../lib/channels.js";
import { serializeEntityId } from "../lib/id-schema.js";
import { umnTranscriptStreamCheckpointKey } from "../lib/redis-keys.js";
import type { DbClient } from "../lib/rls.js";
import { withOrganizationContext } from "../lib/rls.js";
import {
  linkConversationToContact,
  resolveOrCreateContact,
} from "./contact-identity.js";
import {
  appendConversationMessage,
  getConversation,
  isEndedConversationStatus,
  type ConversationRecord,
  type MessageRecord,
} from "./conversations.js";
import { scheduleOmniChannelSummaryRefresh } from "./omni-channel-summary.js";
import { emitContactEnriched, emitMessageCreated } from "./realtime.js";
import { scheduleConversationMessageSentiment } from "./sentiment-analysis.js";

const UUID_SUFFIX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CallTranscriptAgent = {
  ext: string;
  email: string;
  userId: string;
  name: string;
};

export type CallTranscriptPayload = {
  sessionId: string;
  organizationId: string;
  speaker: string;
  text: string;
  transcriptTm: string;
  emotion: string;
  isBot: boolean;
  /** bot: still with the voice bot. live_agent: customer or agent after handoff. */
  transcriptPhase: "bot" | "live_agent" | null;
  customerNumber: string;
  customerFirstName: string;
  customerLastName: string;
  ccaasNumber: string;
  virtualAgent: boolean;
  autoAttendant: boolean;
  agents: CallTranscriptAgent[];
  occurredAt?: string;
};

export function transcriptOccurredAt(entryId: string): string | null {
  const [msText, seqText] = entryId.split("-");
  const ms = Number(msText);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const seq = Number(seqText);
  const offset = Number.isFinite(seq) && seq >= 0 && seq < 1000 ? seq : 0;
  return new Date(ms + offset).toISOString();
}

type RedisStreamResponse = Array<[string, Array<[string, string[]]>]>;

function stringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function flagWasSent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** is_bot marks a bot utterance. bot_type marks a line spoken while the voice bot still owns the call. */
export function callTranscriptPhase(
  record: Record<string, unknown>,
): "bot" | "live_agent" | null {
  const isBotRaw = record.is_bot ?? record.isBot;
  const botTypeRaw = record.bot_type ?? record.botType;
  if (!flagWasSent(isBotRaw) && !flagWasSent(botTypeRaw)) return null;
  if (isTruthyFlag(isBotRaw) || isTruthyFlag(botTypeRaw)) return "bot";
  return "live_agent";
}

function isTruthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

function parseAgentEntry(entry: unknown): CallTranscriptAgent | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const ext = stringField(record, ["ext", "agent_ext", "cli", "extension"]);
  if (!ext) return null;
  return {
    ext,
    email: stringField(record, ["email"]),
    userId: stringField(record, ["userId", "user_id"]),
    name: stringField(record, ["name"]),
  };
}

function parseAgents(value: unknown): CallTranscriptAgent[] {
  let source = value;
  if (typeof source === "string" && source.trim()) {
    try {
      source = JSON.parse(source);
    } catch {
      return [];
    }
  }
  if (Array.isArray(source)) {
    return source.map(parseAgentEntry).filter((agent): agent is CallTranscriptAgent => Boolean(agent));
  }
  const single = parseAgentEntry(source);
  return single ? [single] : [];
}

export function callTranscriptStreamName(): string {
  return (
    process.env.CCAAS_AUDIO_CC_CALL_STREAM?.trim() ||
    "CCAAS_AUDIO_CC_CALL_STREAM_QA"
  );
}

export function transcriptRedisUrl(): string | null {
  const direct =
    process.env.TRANSCRIPT_REDIS_URL?.trim() ||
    process.env.CCAAS_AUDIO_REDIS_URL?.trim();
  if (direct) return direct;
  const host = process.env.TRANSCRIPT_REDIS_HOST?.trim();
  if (!host) return null;
  const port = process.env.TRANSCRIPT_REDIS_PORT?.trim() || "6379";
  const password = process.env.TRANSCRIPT_REDIS_PASSWORD ?? "";
  if (password) {
    return `redis://:${encodeURIComponent(password)}@${host}:${port}`;
  }
  return `redis://${host}:${port}`;
}

const COLLIDING_STREAM_FIELDS = new Set(["message", "data", "payload", "value"]);

function isJsonObject(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

export function redisStreamTranscriptPayload(fields: string[]): string | null {
  for (let index = 0; index < fields.length - 1; index += 2) {
    const value = fields[index + 1]?.trim() ?? "";
    if (fields[index] === "transcript_data" && value && isJsonObject(value)) {
      return value;
    }
  }

  const flat: Record<string, unknown> = {};
  for (let index = 0; index < fields.length - 1; index += 2) {
    const key = fields[index]?.trim();
    if (!key || COLLIDING_STREAM_FIELDS.has(key)) continue;
    flat[key] = fields[index + 1] ?? "";
  }
  const sessionId = String(flat.session_id ?? flat.sessionId ?? "").trim();
  const text = String(flat.text ?? flat.transcript ?? flat.utterance ?? "").trim();
  if (!sessionId || !text) return null;
  return JSON.stringify(flat);
}

export function extractCallSessionKey(sessionId: string): string {
  const trimmed = sessionId.trim();
  const uuid = trimmed.match(UUID_SUFFIX)?.[0];
  return uuid?.toLowerCase() ?? trimmed.toLowerCase();
}

export function isRealAcdTranscriptSession(sessionId: string): boolean {
  const trimmed = sessionId.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith("sip-inbound:")) return false;
  return UUID_SUFFIX.test(trimmed);
}

export function matchCallSessionIds(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const uuidA = a.match(UUID_SUFFIX)?.[0]?.toLowerCase();
  const uuidB = b.match(UUID_SUFFIX)?.[0]?.toLowerCase();
  return Boolean(uuidA && uuidB && uuidA === uuidB);
}

export function phoneDigitsMatch(left: string, right: string): boolean {
  const a = digitsOnly(left);
  const b = digitsOnly(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 7) return false;
  return a.endsWith(b.slice(-10)) || b.endsWith(a.slice(-10));
}

export function isSyntheticSipInboundThread(threadId: string): boolean {
  return threadId.trim().toLowerCase().startsWith("sip-inbound:");
}

export function matchesLiveVoiceConversation(
  row: {
    ext: string | null;
    external_thread_id: string | null;
    provider_thread_id: string | null;
    visitor_id?: string | null;
  },
  payload: { sessionId: string; customerNumber: string; agents: Array<{ ext: string }> },
): boolean {
  if (
    !row.ext ||
    !payload.agents.some(
      (agent) => String(row.ext) === agent.ext || Number(row.ext) === Number(agent.ext),
    )
  ) {
    return false;
  }
  const threadId = row.provider_thread_id || row.external_thread_id || "";
  const externalId = row.external_thread_id || "";
  return (
    matchCallSessionIds(payload.sessionId, threadId) ||
    matchCallSessionIds(payload.sessionId, externalId)
  );
}

const CUSTOMER_SPEAKER_LABELS = new Set([
  "customer",
  "user",
  "caller",
  "callee",
  "remote",
  "inbound",
]);

function speakerMatchesPhone(speakerDigits: string, candidate: string): boolean {
  if (!speakerDigits || !candidate) return false;
  if (phoneDigitsMatch(speakerDigits, candidate)) return true;
  const candidateDigits = digitsOnly(candidate);
  if (!candidateDigits) return false;
  if (speakerDigits === candidateDigits) return true;
  if (candidateDigits.length >= 7 && speakerDigits.endsWith(candidateDigits.slice(-10))) return true;
  if (speakerDigits.length >= 7 && candidateDigits.endsWith(speakerDigits.slice(-10))) return true;
  return false;
}

export function matchTranscriptAgent(payload: CallTranscriptPayload): CallTranscriptAgent | null {
  const speaker = payload.speaker.trim();
  if (!speaker) return null;
  const speakerKey = speaker.toLowerCase();
  const speakerDigits = digitsOnly(speaker);

  for (const agent of payload.agents) {
    if (speaker === agent.ext || (speakerDigits && speakerDigits === digitsOnly(agent.ext))) {
      return agent;
    }
    if (agent.email && speakerKey === agent.email.toLowerCase()) return agent;
    if (agent.userId && speaker === agent.userId) return agent;
  }
  return null;
}

export type TranscriptSpeakerRole = "customer" | "agent" | "bot";

export function classifyTranscriptSpeaker(
  payload: CallTranscriptPayload,
  hints?: { visitorId?: string | null },
): TranscriptSpeakerRole | null {
  const speaker = payload.speaker.trim();
  if (!speaker) return null;
  const speakerKey = speaker.toLowerCase();
  const speakerDigits = digitsOnly(speaker);

  if (speakerKey === "bot") return "bot";
  if (matchTranscriptAgent(payload)) return "agent";

  if (CUSTOMER_SPEAKER_LABELS.has(speakerKey)) {
    return "customer";
  }
  if (
    speakerMatchesPhone(speakerDigits, payload.customerNumber) ||
    speakerMatchesPhone(speakerDigits, hints?.visitorId ?? "")
  ) {
    return "customer";
  }
  if (speakerMatchesPhone(speakerDigits, payload.ccaasNumber)) {
    return "agent";
  }
  if (speakerDigits) return "customer";
  return null;
}

export function transcriptMessageExternalId(payload: CallTranscriptPayload): string {
  const digest = createHash("sha256")
    .update(payload.text)
    .digest("hex")
    .slice(0, 16);
  return `call-transcript:${payload.sessionId}:${payload.transcriptTm}:${payload.speaker}:${digest}`;
}

export function parseInboundCallTranscript(raw: string): CallTranscriptPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const eventId = Number(record.event_id ?? record.eventId);
  if (eventId === 1 || eventId === 2 || eventId === 5 || eventId === 6) return null;
  const sessionId = stringField(record, ["session_id", "sessionId"]);
  const organizationId = stringField(record, ["domain_id", "domainId", "organization_id"]);
  const text = stringField(record, ["text", "transcript", "utterance"]);
  if (!sessionId || !organizationId || !text) return null;
  if (!isRealAcdTranscriptSession(sessionId)) return null;
  const agents = parseAgents(record.agent ?? record.agents);
  const speaker =
    stringField(record, ["speaker"]) ||
    stringField(record, ["speaker_type", "spk", "role", "party"]);
  if (!speaker && agents.length === 0 && !stringField(record, ["customer_number", "customerNumber"])) {
    return null;
  }
  return {
    sessionId,
    organizationId,
    speaker,
    text,
    transcriptTm: stringField(record, ["transcriptTm", "transcript_tm"]),
    emotion: stringField(record, ["emotion"]),
    isBot:
      isTruthyFlag(record.is_bot ?? record.isBot) ||
      isTruthyFlag(record.bot_type ?? record.botType),
    transcriptPhase: callTranscriptPhase(record),
    customerNumber: stringField(record, ["customer_number", "customerNumber"]),
    customerFirstName: stringField(record, ["customer_first_name", "customerFirstName"]),
    customerLastName: stringField(record, ["customer_last_name", "customerLastName"]),
    ccaasNumber: stringField(record, ["ccaas_number", "ccaasNumber"]),
    virtualAgent: isTruthyFlag(record.virtual_agent ?? record.virtualAgent),
    autoAttendant: isTruthyFlag(record.auto_attendant ?? record.autoAttendant),
    agents,
  };
}

export function shouldApplyCallTranscript(payload: CallTranscriptPayload): boolean {
  if (!payload.text.trim()) return false;
  // Auto-attendant prompts are not the customer conversation. Voicebot lines are.
  if (payload.autoAttendant) return false;
  return isRealAcdTranscriptSession(payload.sessionId);
}

/** A voicebot row is not an agent workspace conversation. Notify only after it is assigned. */
export function shouldNotifyWorkspaceOfCallTranscript(status: string): boolean {
  return status !== "bot_active";
}

/** Spoken order for lines that arrived before the live agent workspace existed. */
export function orderCallTranscripts(
  payloads: CallTranscriptPayload[],
): CallTranscriptPayload[] {
  return payloads
    .map((payload, index) => ({ payload, index }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.payload.occurredAt ?? "");
      const rightTime = Date.parse(right.payload.occurredAt ?? "");
      const leftRank = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
      const rightRank = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.index - right.index;
    })
    .map((item) => item.payload);
}

async function findLiveVoiceConversation(
  db: DbClient,
  organizationId: string,
  payload: CallTranscriptPayload,
): Promise<ConversationRecord | null> {
  const agentExts = new Set(payload.agents.map((agent) => agent.ext).filter(Boolean));

  const rows = await db.$queryRaw<
    Array<{
      id: string;
      external_thread_id: string | null;
      provider_thread_id: string | null;
      visitor_id: string | null;
      ext: string | null;
    }>
  >`
    SELECT
      c.id,
      c.external_thread_id,
      c.provider_thread_id,
      c.visitor_id,
      u.ext::text AS ext
    FROM ccass.conversations c
    INNER JOIN accounts.setup_users u
      ON u.id = c.assigned_user_id
     AND u.organization_id = c.organization_id
    WHERE c.organization_id = ${organizationId}::bigint
      AND c.channel IN ('call', 'voice', 'phone')
      AND c.status = 'active'
      AND c.created_at >= NOW() - INTERVAL '8 hours'
    ORDER BY c.updated_at DESC
    LIMIT 50
  `;

  const match = rows.find((row) => {
    if (
      agentExts.size > 0 &&
      (!row.ext ||
        ![...agentExts].some((ext) => String(row.ext) === ext || Number(row.ext) === Number(ext)))
    ) {
      return false;
    }
    const threadId = row.provider_thread_id || row.external_thread_id || "";
    const externalId = row.external_thread_id || "";
    return (
      matchCallSessionIds(payload.sessionId, threadId) ||
      matchCallSessionIds(payload.sessionId, externalId)
    );
  });
  if (!match) return null;
  return getConversation(db, organizationId, serializeEntityId(match.id), {
    channel: CALL_CHANNEL,
  });
}

async function messageExists(
  db: DbClient,
  organizationId: string,
  externalId: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ccass.conversation_messages
    WHERE organization_id = ${organizationId}::bigint
      AND external_id = ${externalId}
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

async function ensureVoiceCustomerIdentity(
  db: DbClient,
  organizationId: string,
  conversation: ConversationRecord,
  payload: CallTranscriptPayload,
): Promise<ConversationRecord> {
  const phone = payload.customerNumber || conversation.visitorId || "";
  if (!phone) return conversation;

  if (!conversation.visitorId && phone) {
    await db.$executeRaw`
      UPDATE ccass.conversations
      SET visitor_id = ${phone}, updated_at = NOW()
      WHERE id = ${conversation.id}::bigint
        AND organization_id = ${organizationId}::bigint
        AND channel IN ('call', 'voice', 'phone')
        AND visitor_id IS NULL
    `;
  }

  if (conversation.contactId) return conversation;

  const displayName = [payload.customerFirstName, payload.customerLastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  const resolved = await resolveOrCreateContact(db, organizationId, {
    channel: CALL_CHANNEL,
    phone,
    visitorId: phone,
    displayName: displayName || undefined,
  });
  await linkConversationToContact(db, organizationId, conversation.id, resolved.contactId);
  if (resolved.contact) {
    emitContactEnriched(organizationId, conversation.id, {
      outcome: resolved.created ? "created" : "linked_existing",
      canonicalContactId: resolved.contactId,
      previousContactId: conversation.contactId,
      appliedFields: [],
      skippedFields: [],
      requiresConfirmation: [],
      contact: resolved.contact,
      idempotentReplay: false,
    });
    scheduleOmniChannelSummaryRefresh(organizationId, resolved.contactId);
  }
  return (
    (await getConversation(db, organizationId, conversation.id, { channel: conversation.channel })) ??
    conversation
  );
}

async function resolveSetupSpeaker(
  db: DbClient,
  organizationId: string,
  speaker: string,
): Promise<{ id: string; name: string } | null> {
  const trimmed = speaker.trim();
  if (!trimmed) return null;
  const digits = digitsOnly(trimmed);
  const email = trimmed.includes("@") ? trimmed.toLowerCase() : "";
  const rows = await db.$queryRaw<Array<{ id: string; ext: string | null; email: string | null; name: string | null }>>`
    SELECT
      id::text AS id,
      ext::text AS ext,
      lower(work_email) AS email,
      NULLIF(btrim(concat_ws(' ', first_name, last_name)), '') AS name
    FROM accounts.setup_users
    WHERE organization_id = ${organizationId}::bigint
      AND (
        ext::text = ${digits}
        OR id::text = ${trimmed}
        OR (${email}::text <> '' AND lower(work_email) = ${email})
      )
    LIMIT 5
  `;
  const byEmail = email ? rows.find((row) => row.email === email) : undefined;
  if (byEmail) return { id: byEmail.id, name: byEmail.name ?? "" };
  if (digits && digits.length <= 6) {
    const byExt = rows.find((row) => row.ext && digitsOnly(row.ext) === digits);
    if (byExt) return { id: byExt.id, name: byExt.name ?? "" };
  }
  const byId = rows.find((row) => row.id === trimmed || (digits && row.id === digits));
  if (byId) return { id: byId.id, name: byId.name ?? "" };
  return null;
}

async function persistTranscriptMessage(
  db: DbClient,
  organizationId: string,
  conversation: ConversationRecord,
  payload: CallTranscriptPayload,
  speakerRole: TranscriptSpeakerRole,
): Promise<MessageRecord | null> {
  const externalId = transcriptMessageExternalId(payload);
  if (await messageExists(db, organizationId, externalId)) {
    return null;
  }
  const speakingAgent = speakerRole === "agent" ? matchTranscriptAgent(payload) : null;
  const setupSpeaker =
    speakerRole === "agent"
      ? await resolveSetupSpeaker(db, organizationId, payload.speaker)
      : null;
  const { message } = await appendConversationMessage(
    db,
    organizationId,
    conversation.id,
    {
      externalId,
      senderType: speakerRole,
      direction: speakerRole === "customer" ? "inbound" : "outbound",
      visibility: "customer",
      body: payload.text,
      modelMetadata: {
        source: "call_transcript",
        sessionId: payload.sessionId,
        speaker: payload.speaker,
        speakerUserId: setupSpeaker?.id || speakingAgent?.userId || undefined,
        speakerName: setupSpeaker?.name || speakingAgent?.name || undefined,
        speakerExt: speakingAgent?.ext || undefined,
        transcriptTm: payload.transcriptTm || undefined,
        emotion: payload.emotion || undefined,
        ...(payload.transcriptPhase ? { transcriptPhase: payload.transcriptPhase } : {}),
      },
    },
    {
      deferContactEnrichment: true,
      allowInactiveBot: speakerRole === "bot",
      occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : null,
    },
  );
  if (speakerRole === "agent" && message.deliveryState === "pending") {
    await db.$executeRaw`
      UPDATE ccass.conversation_messages
      SET delivery_state = 'delivered',
          delivered_at = COALESCE(delivered_at, NOW())
      WHERE id = ${message.id}::bigint
        AND organization_id = ${organizationId}::bigint
    `;
    return { ...message, deliveryState: "delivered" };
  }
  return message;
}

async function findVoiceConversationBySession(
  db: DbClient,
  organizationId: string,
  sessionId: string,
): Promise<ConversationRecord | null> {
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      status: string;
      external_thread_id: string | null;
      provider_thread_id: string | null;
    }>
  >`
    SELECT id, status, external_thread_id, provider_thread_id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel IN ('call', 'voice', 'phone')
      AND created_at >= NOW() - INTERVAL '8 hours'
    ORDER BY updated_at DESC
    LIMIT 30
  `;
  const match = rows.find(
    (row) =>
      matchCallSessionIds(sessionId, row.provider_thread_id || "") ||
      matchCallSessionIds(sessionId, row.external_thread_id || ""),
  );
  if (!match || isEndedConversationStatus(match.status)) return null;
  return getConversation(db, organizationId, serializeEntityId(match.id), {
    channel: CALL_CHANNEL,
  });
}

/** Unassigned bot-phase row. The live-agent connect path updates this same row. */
async function ensureVoicebotConversation(
  db: DbClient,
  payload: CallTranscriptPayload,
): Promise<ConversationRecord | null> {
  const existing = await findVoiceConversationBySession(
    db,
    payload.organizationId,
    payload.sessionId,
  );
  if (existing) return existing;

  const sessionId = payload.sessionId.slice(0, 128);
  const visitorId = payload.customerNumber.trim() || null;
  const inserted = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO ccass.conversations (
      organization_id, channel, direction, external_thread_id, provider_thread_id,
      visitor_id, status, lifecycle_state, bot_active, nlp_enabled, live_agent_enabled
    ) VALUES (
      ${payload.organizationId}::bigint,
      ${CALL_CHANNEL},
      'inbound',
      ${sessionId},
      ${sessionId},
      ${visitorId},
      'bot_active',
      'bot',
      TRUE,
      FALSE,
      TRUE
    )
    ON CONFLICT (organization_id, channel, external_thread_id) DO UPDATE
      SET updated_at = NOW()
      WHERE ccass.conversations.status = 'bot_active'
        AND ccass.conversations.assigned_user_id IS NULL
    RETURNING id::text AS id
  `;
  const conversationId = inserted[0]?.id
    ? serializeEntityId(inserted[0].id)
    : null;
  if (!conversationId) {
    return findVoiceConversationBySession(db, payload.organizationId, payload.sessionId);
  }
  return getConversation(db, payload.organizationId, conversationId, {
    channel: CALL_CHANNEL,
  });
}

export async function applyInboundCallTranscript(
  app: FastifyInstance,
  payload: CallTranscriptPayload,
): Promise<"applied" | "skipped" | "duplicate"> {
  if (!shouldApplyCallTranscript(payload)) return "skipped";

  return withOrganizationContext(app.prisma, payload.organizationId, async (db) => {
    let live = await findLiveVoiceConversation(db, payload.organizationId, payload);
    if (!live) {
      if (!classifyTranscriptSpeaker(payload)) {
        rememberPendingCallTranscript(payload);
        app.log.info(
          {
            organizationId: payload.organizationId,
            sessionId: payload.sessionId,
            speaker: payload.speaker,
          },
          "call transcript skipped: unknown speaker",
        );
        return "skipped";
      }
      try {
        live = await ensureVoicebotConversation(db, payload);
      } catch (error) {
        rememberPendingCallTranscript(payload);
        app.log.warn(
          {
            err: error,
            organizationId: payload.organizationId,
            sessionId: payload.sessionId,
          },
          "call transcript kept pending: voicebot conversation was not created",
        );
        return "skipped";
      }
    }
    if (!live) {
      rememberPendingCallTranscript(payload);
      app.log.info(
        {
          organizationId: payload.organizationId,
          sessionId: payload.sessionId,
          agentExt: payload.agents.map((agent) => agent.ext),
        },
        "call transcript skipped: no live voice conversation",
      );
      return "skipped";
    }

    const speakerRole = classifyTranscriptSpeaker(payload, { visitorId: live.visitorId });
    if (!speakerRole) {
      app.log.info(
        {
          organizationId: payload.organizationId,
          sessionId: payload.sessionId,
          speaker: payload.speaker,
        },
        "call transcript skipped: unknown speaker",
      );
      return "skipped";
    }

    let conversation = live;
    try {
      conversation = await ensureVoiceCustomerIdentity(
        db,
        payload.organizationId,
        live,
        payload,
      );
    } catch (error) {
      app.log.warn(
        { err: error, organizationId: payload.organizationId, sessionId: payload.sessionId },
        "call transcript contact resolve failed",
      );
    }
    const message = await persistTranscriptMessage(
      db,
      payload.organizationId,
      conversation,
      payload,
      speakerRole,
    );
    if (!message) return "duplicate";

    if (shouldNotifyWorkspaceOfCallTranscript(conversation.status)) {
      emitMessageCreated(payload.organizationId, conversation.id, message);
    }
    scheduleConversationMessageSentiment(
      app.prisma,
      payload.organizationId,
      conversation.id,
      message.id,
      speakerRole,
      payload.text,
    );
    if (conversation.contactId) {
      scheduleOmniChannelSummaryRefresh(payload.organizationId, conversation.contactId);
    }
    return "applied";
  });
}

const PENDING_TRANSCRIPT_MAX = 50;
const pendingCallTranscripts = new Map<string, CallTranscriptPayload[]>();

export function rememberPendingCallTranscript(payload: CallTranscriptPayload): void {
  const key = extractCallSessionKey(payload.sessionId);
  const current = pendingCallTranscripts.get(key) ?? [];
  current.push(payload);
  pendingCallTranscripts.set(key, current.slice(-PENDING_TRANSCRIPT_MAX));
}

export function takePendingCallTranscripts(sessionId: string): CallTranscriptPayload[] {
  const key = extractCallSessionKey(sessionId);
  const pending = pendingCallTranscripts.get(key) ?? [];
  pendingCallTranscripts.delete(key);
  return pending.filter((payload) => matchCallSessionIds(payload.sessionId, sessionId));
}

export async function flushPendingCallTranscripts(
  app: FastifyInstance,
  sessionId: string,
): Promise<void> {
  const pending = orderCallTranscripts(takePendingCallTranscripts(sessionId));
  for (const payload of pending) {
    try {
      await applyInboundCallTranscript(app, payload);
    } catch (error) {
      app.log.warn(
        { err: error, sessionId: payload.sessionId, organizationId: payload.organizationId },
        "CCAAS pending transcript apply failed",
      );
    }
  }
}

export function transcriptStreamResumeId(checkpoint: string | null | undefined): string {
  const trimmed = checkpoint?.trim();
  return trimmed || "$";
}

export function startUmnCallTranscriptConsumer(
  app: FastifyInstance,
  streamClient: Redis,
): () => void {
  const stream = callTranscriptStreamName();
  const checkpointKey = umnTranscriptStreamCheckpointKey(stream);
  let stopped = false;

  app.log.info({ stream }, "CCAAS call transcript Redis Stream consumer connected");

  void (async () => {
    let lastId = "$";
    try {
      lastId = transcriptStreamResumeId(await streamClient.get(checkpointKey));
    } catch (error) {
      app.log.warn({ err: error, stream }, "CCAAS transcript Stream checkpoint read failed");
    }
    while (!stopped) {
      try {
        const response = (await streamClient.xread(
          "COUNT",
          100,
          "BLOCK",
          5_000,
          "STREAMS",
          stream,
          lastId,
        )) as RedisStreamResponse | null;

        if (!response) continue;
        for (const [, entries] of response) {
          for (const [entryId, fields] of entries) {
            const message = redisStreamTranscriptPayload(fields);
            const payload = message ? parseInboundCallTranscript(message) : null;
            if (payload) {
              const occurredAt = transcriptOccurredAt(entryId);
              if (occurredAt) payload.occurredAt = occurredAt;
              try {
                const result = await applyInboundCallTranscript(app, payload);
                app.log.info(
                  {
                    event: `voice.transcript.${result}`,
                    entryId,
                    organizationId: payload.organizationId,
                    sessionId: payload.sessionId,
                    speaker: payload.speaker,
                  },
                  `Call transcript ${result}`,
                );
              } catch (error) {
                app.log.warn(
                  {
                    event: "voice.transcript.apply-failed",
                    err: error,
                    entryId,
                    sessionId: payload.sessionId,
                    organizationId: payload.organizationId,
                  },
                  "CCAAS transcript apply failed",
                );
              }
            } else {
              app.log.debug(
                {
                  event: "voice.transcript.entry-ignored",
                  entryId,
                  stream,
                  fieldNames: fields.filter((_, index) => index % 2 === 0),
                },
                "CCAAS transcript stream entry ignored",
              );
            }
            await streamClient.set(checkpointKey, entryId);
            lastId = entryId;
          }
        }
      } catch (error) {
        if (stopped) return;
        app.log.warn({ err: error, stream, lastId }, "CCAAS transcript Redis Stream read failed");
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  })();

  return () => {
    stopped = true;
  };
}
