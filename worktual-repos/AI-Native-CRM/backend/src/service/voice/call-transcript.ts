/**
 * Live call transcript for the browser SIP call that is connected now.
 * Lines arrive on CRM_AUDIO_CC_CALL_STREAM_QA. Coaching uses assist-meeting.
 * Hangup writes one call activity and closes the popup.
 */

import Redis from "ioredis";
import { Prisma } from "@prisma/client";
import { accountQuery } from "@/dao/db/account-pool";
import { prisma } from "@/dao/db/prisma";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { getContact } from "@/dao/contacts/contact-service";
import {
  isWeakAssistFragment,
  repairAssistQueryAgainstCatalog,
} from "@/lib/meeting-assist-questions";
import { callAiServiceAgent } from "@/service/ai/ai-service-client";
import { buildAssistContextPack } from "@/service/ai/meeting-assist-context";
import {
  isValidTimeZone,
  normalizeAssistAction,
  type AssistAction,
} from "@/service/ai/meeting-assist";
import { executeAssistActionCommand } from "@/service/ai/execute-assist-action";
import { assistPersonaForUserId } from "@/service/meeting-assist/persona";
import { attachActivityTranscript } from "@/service/ai/lead-lifecycle-transcripts";
import {
  CALL_TRANSCRIPT_CHANNEL,
  isCustomerUtterance,
  isStoredCustomerUtterance,
  lineMatchesSession,
  parseGatewayLine,
  phoneTail,
  type GatewayLine,
} from "@/service/voice/call-transcript-line";
import { loadNurtureCallTranscript } from "@/service/voice/nurture-call-transcript";

export type CallAssistSuggestion = {
  title: string;
  text: string;
  kind: string;
};

export type CallAssistFitGap = {
  area: string;
  status: "fit" | "gap" | "unknown";
  note: string | null;
};

export type CallAssistConversationContext = {
  backgroundOneLine: string | null;
  lastDiscussionSummary: string | null;
  theirPositionThen: string | null;
  theirFocusNow: string | null;
  whatChanged: string | null;
};

export type CallAssistResult = {
  ok: boolean;
  talkTrack: string | null;
  suggestions: CallAssistSuggestion[];
  nextQuestions: string[];
  conversationContext: CallAssistConversationContext | null;
  fitGaps: CallAssistFitGap[];
  nextBestAction: string | null;
  action: AssistAction | null;
  sentiment: string | null;
  sentimentCoachHint: string | null;
  detectedObjection: {
    kind: string;
    customerLine?: string;
    reply?: string;
    proofPoint?: string | null;
    question?: string | null;
  } | null;
  query: string | null;
  reason: string | null;
};

export type CallTranscriptEvent =
  | {
      type: "chunk";
      seq: number;
      speaker: string | null;
      text: string;
      isBot: boolean;
    }
  | { type: "assist"; result: CallAssistResult }
  | { type: "ended"; activityId: string | null }
  | { type: "status"; status: string; message?: string };

export type StartCallTranscriptInput = {
  userId: string;
  remoteNumber: string;
  direction: "inbound" | "outbound";
  /** When this browser call connected. A later call must not reuse the previous session. */
  connectedAt?: number | null;
  /** IANA zone from the rep browser so "tomorrow 5 PM" matches meeting assist. */
  timeZone?: string | null;
};

export type StartCallTranscriptResult =
  | { open: false; reason: string }
  | {
      open: true;
      sessionId: string;
      contactId: string;
      contactName: string;
      remoteDigits: string;
    };

type Listener = (event: CallTranscriptEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const lastAssist = new Map<string, CallAssistResult>();
const coachTimers = new Map<string, ReturnType<typeof setTimeout>>();
const coachRunning = new Set<string>();
const coachQueued = new Map<string, string | null>();
const ending = new Map<string, Promise<{ activityId: string | null }>>();
const sessionTimeZone = new Map<string, string>();

function rememberTimeZone(sessionId: string, zone?: string | null): void {
  const name = (zone || "").trim();
  if (name && isValidTimeZone(name)) sessionTimeZone.set(sessionId, name);
}

function zoneForSession(sessionId: string): string | null {
  return sessionTimeZone.get(sessionId) || null;
}

let subscriber: Redis | null = null;
let subscriberStarted = false;

function fail(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

function tenantId(value: string): bigint {
  return BigInt(value);
}

function transcriptRedisUrl(): string {
  return (
    process.env.TRANSCRIPT_REDIS_URL?.trim() ||
    process.env.REDIS_URL?.trim() ||
    ""
  );
}

function redisHostLabel(url: string): string {
  try {
    return new URL(url).host || "redis";
  } catch {
    return "redis";
  }
}

function unknownContactId(remoteTail: string): string {
  return `phone:${remoteTail}`;
}

function isKnownContactId(contactId: string): boolean {
  return Boolean(contactId) && !contactId.startsWith("phone:");
}

function publish(sessionId: string, event: CallTranscriptEvent): void {
  const group = listeners.get(sessionId);
  if (!group) return;
  for (const listener of group) {
    try {
      listener(event);
    } catch {
      /* listener closed */
    }
  }
}

export function subscribeCallTranscript(
  sessionId: string,
  listener: Listener,
): () => void {
  const group = listeners.get(sessionId) ?? new Set<Listener>();
  group.add(listener);
  listeners.set(sessionId, group);
  return () => {
    group.delete(listener);
    if (group.size === 0) listeners.delete(sessionId);
  };
}

async function loadUserVoice(
  userId: string,
): Promise<{ organizationId: string; ext: string; agentName: string } | null> {
  const { rows } = await accountQuery<{
    organization_id: string;
    ext: string | null;
    first_name: string | null;
    last_name: string | null;
  }>(
    `SELECT organization_id::text AS organization_id,
            ext::text AS ext,
            first_name,
            last_name
     FROM accounts.setup_users
     WHERE id = $1::bigint
     LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  const ext = row?.ext?.trim() ?? "";
  const organizationId = row?.organization_id?.trim() ?? "";
  if (!organizationId || !ext) return null;
  const agentName =
    `${row?.first_name?.trim() ?? ""} ${row?.last_name?.trim() ?? ""}`.trim() ||
    "Agent";
  return { organizationId, ext, agentName };
}

async function loadAgentName(userId: string): Promise<string> {
  const voice = await loadUserVoice(userId).catch(() => null);
  return voice?.agentName || "Agent";
}

/** Real employee names only. The "Agent" fallback must not hide a customer line. */
function coachAgentNames(agentName: string): string[] {
  const name = agentName.trim();
  if (!name || /^agent$/i.test(name)) return [];
  return [name];
}

async function findContactByPhone(
  organizationId: string,
  remoteTail: string,
): Promise<{ contactId: string; contactName: string } | null> {
  const { rows } = await accountQuery<{ contact_id: string }>(
    `SELECT p.cdp_id::text AS contact_id
     FROM cdp.customer_profile p
     WHERE p.organization_id = $1::bigint
       AND EXISTS (
         SELECT 1
         FROM cdp.identity_keys k
         WHERE k.cdp_id = p.cdp_id
           AND k.key_type IN ('phone', 'phone_secondary')
           AND (
             CASE
               WHEN length(regexp_replace(k.key_value, '\\D', '', 'g')) > 10
               THEN right(regexp_replace(k.key_value, '\\D', '', 'g'), 10)
               ELSE regexp_replace(k.key_value, '\\D', '', 'g')
             END
           ) = $2
       )
     ORDER BY p.updated_at DESC NULLS LAST
     LIMIT 5`,
    [organizationId, remoteTail],
  );

  for (const row of rows) {
    const contact = await getContact(row.contact_id).catch(() => null);
    if (!contact) continue;
    const name = contact.displayName.trim() || "Contact";
    return { contactId: contact.id, contactName: name };
  }
  return null;
}

export async function startCallTranscriptSession(
  input: StartCallTranscriptInput,
): Promise<StartCallTranscriptResult> {
  const userId = input.userId.trim();
  const remoteTail = phoneTail(input.remoteNumber);
  if (!userId || remoteTail.length < 7) {
    return { open: false, reason: "The connected number is missing or too short." };
  }
  const direction = input.direction === "inbound" ? "inbound" : "outbound";

  const voice = await loadUserVoice(userId);
  if (!voice) {
    return {
      open: false,
      reason: "This user has no agent extension — call captions cannot start.",
    };
  }

  const connectedMs =
    typeof input.connectedAt === "number" && Number.isFinite(input.connectedAt)
      ? input.connectedAt
      : Date.now();
  const existing = await prisma.callTranscriptSession.findFirst({
    where: {
      userId: tenantId(userId),
      status: "active",
      remoteDigits: remoteTail,
      organizationId: tenantId(voice.organizationId),
    },
    orderBy: { startedAt: "desc" },
  });
  const sameCall =
    existing != null &&
    Math.abs(new Date(existing.startedAt).getTime() - connectedMs) < 60_000;
  if (existing && sameCall) {
    rememberTimeZone(existing.id, input.timeZone);
    return {
      open: true,
      sessionId: existing.id,
      contactId: existing.contactId,
      contactName: existing.contactName?.trim() || "Contact",
      remoteDigits: existing.remoteDigits,
    };
  }

  const contact = await findContactByPhone(voice.organizationId, remoteTail);

  const previous = await prisma.callTranscriptSession.findMany({
    where: { userId: tenantId(userId), status: "active" },
    select: { id: true },
  });
  for (const row of previous) {
    await endCallTranscriptSession(row.id, userId, "hangup").catch((error) => {
      console.warn(
        "[call-transcript] previous session end failed",
        error instanceof Error ? error.message : error,
      );
    });
  }

  const session = await prisma.callTranscriptSession.create({
    data: {
      organizationId: tenantId(voice.organizationId),
      userId: tenantId(userId),
      ext: voice.ext,
      contactId: contact?.contactId || unknownContactId(remoteTail),
      contactName: contact?.contactName || input.remoteNumber.trim() || "Customer",
      remoteDigits: remoteTail,
      direction,
      status: "active",
    },
  });

  await replayCallTranscriptsSince(new Date(session.startedAt).getTime() - 20_000);
  rememberTimeZone(session.id, input.timeZone);

  return {
    open: true,
    sessionId: session.id,
    contactId: session.contactId,
    contactName: session.contactName?.trim() || "Customer",
    remoteDigits: session.remoteDigits,
  };
}

function speakerLabel(
  chunk: { speaker: string | null; isBot: boolean },
  contactName: string,
  remoteDigits: string,
  agentName = "Agent",
): string {
  if (chunk.isBot) return "Bot";
  const speakerTail = phoneTail(chunk.speaker);
  const remote = phoneTail(remoteDigits);
  if (speakerTail && remote && speakerTail === remote) {
    return contactName.trim() || "Customer";
  }
  const raw = chunk.speaker?.trim() || "";
  // Already a human label from hangup roll-up ("Agent", contact name, etc.)
  if (raw && !/^\+?\d[\d\s\-().]*$/.test(raw)) {
    if (/^agent$/i.test(raw)) return agentName.trim() || "Agent";
    if (/^(customer|contact)$/i.test(raw)) return contactName.trim() || "Customer";
    return raw;
  }
  return agentName.trim() || "Agent";
}

function mapTranscriptChunks(
  chunks: Array<{ seq: number; speaker: string | null; text: string; isBot: boolean }>,
  contactName: string,
  remoteDigits: string,
  agentName: string,
) {
  return chunks.map((chunk) => ({
    ...chunk,
    speaker: speakerLabel(chunk, contactName, remoteDigits, agentName),
  }));
}

function rollupTranscriptText(
  chunks: Array<{ speaker: string | null; text: string; isBot: boolean }>,
  contactName: string,
  remoteDigits: string,
  agentName: string,
): string {
  return chunks
    .map((chunk) => {
      const who = speakerLabel(chunk, contactName, remoteDigits, agentName);
      return `${who}: ${chunk.text}`;
    })
    .join("\n")
    .trim();
}

function clampText(value: unknown, max = 800): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function clampContext(raw: unknown): CallAssistConversationContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const ctx: CallAssistConversationContext = {
    backgroundOneLine: clampText(row.backgroundOneLine, 500),
    lastDiscussionSummary: clampText(row.lastDiscussionSummary, 500),
    theirPositionThen: clampText(row.theirPositionThen, 500),
    theirFocusNow: clampText(row.theirFocusNow, 500),
    whatChanged: clampText(row.whatChanged, 500),
  };
  return Object.values(ctx).some(Boolean) ? ctx : null;
}

function clampFitGaps(raw: unknown): CallAssistFitGap[] {
  if (!Array.isArray(raw)) return [];
  const gaps: CallAssistFitGap[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const area = clampText(row.area, 120);
    if (!area) continue;
    const statusRaw = clampText(row.status, 16)?.toLowerCase();
    const status = statusRaw === "fit" || statusRaw === "gap" ? statusRaw : "unknown";
    gaps.push({ area, status, note: clampText(row.note, 280) });
    if (gaps.length >= 6) break;
  }
  return gaps;
}

function clampAssist(agent: Record<string, unknown> | null, query: string): CallAssistResult {
  const suggestions = Array.isArray(agent?.suggestions)
    ? agent.suggestions
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const text = clampText(row.text, 500);
          if (!text) return null;
          return {
            title: clampText(row.title, 120) || "Suggestion",
            text,
            kind: clampText(row.kind, 40) || "say",
          };
        })
        .filter((item): item is CallAssistSuggestion => Boolean(item))
        .slice(0, 6)
    : [];

  const nextQuestions = Array.isArray(agent?.nextQuestions)
    ? agent.nextQuestions
        .map((item) => clampText(item, 240))
        .filter((item): item is string => Boolean(item))
        .slice(0, 4)
    : [];

  const objectionRaw =
    agent?.detectedObjection && typeof agent.detectedObjection === "object"
      ? (agent.detectedObjection as Record<string, unknown>)
      : null;
  const objectionReply = clampText(objectionRaw?.reply, 500);
  const detectedObjection =
    objectionRaw && objectionReply
      ? {
          kind: clampText(objectionRaw.kind, 80) || "objection",
          customerLine: clampText(objectionRaw.customerLine, 300) || undefined,
          reply: objectionReply,
          proofPoint: clampText(objectionRaw.proofPoint, 300),
          question: clampText(objectionRaw.question, 240),
        }
      : null;

  const sentiment = clampText(agent?.sentiment, 32);
  const action = normalizeAssistAction(agent?.action) || normalizeAssistAction(agent?.nextBestAction);

  return {
    ok: Boolean(agent?.ok),
    talkTrack: clampText(agent?.talkTrack, 800),
    suggestions,
    nextQuestions,
    conversationContext: clampContext(agent?.conversationContext),
    fitGaps: clampFitGaps(agent?.fitGaps),
    nextBestAction: action?.detail || clampText(agent?.nextBestAction, 400),
    action,
    sentiment,
    sentimentCoachHint: clampText(agent?.sentimentCoachHint, 400),
    detectedObjection,
    query: query || null,
    reason: clampText(agent?.reason, 200),
  };
}

function hasCoaching(result: CallAssistResult): boolean {
  const info = result.conversationContext
    ? Object.values(result.conversationContext).some((value) => (value || "").trim())
    : false;
  return Boolean(
    result.talkTrack ||
      result.suggestions.length ||
      result.action ||
      result.nextBestAction ||
      result.nextQuestions.length ||
      result.detectedObjection ||
      result.fitGaps.length ||
      info ||
      (result.sentimentCoachHint &&
        result.sentiment &&
        result.sentiment !== "neutral"),
  );
}

function optionalWithin<T>(work: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    void work.then((value) => finish(value)).catch(() => finish(null));
  });
}

const askWaiters = new Map<string, (result: CallAssistResult | null) => void>();

async function runCallAssist(
  sessionId: string,
  explicitQuery: string | null,
): Promise<CallAssistResult | null> {
  if (coachRunning.has(sessionId)) {
    coachQueued.set(sessionId, explicitQuery);
    if (!explicitQuery) return null;
    return new Promise((resolve) => {
      askWaiters.set(sessionId, resolve);
    });
  }
  coachRunning.add(sessionId);
  let outcome: CallAssistResult | null = null;
  try {
    const session = await prisma.callTranscriptSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.status !== "active") return null;

    const newest = await prisma.callTranscriptChunk.findMany({
      where: { sessionId },
      orderBy: { seq: "desc" },
      take: 24,
    });
    const recent = newest.reverse();
    const contactName = session.contactName?.trim() || "Customer";
    const agentName = await loadAgentName(String(session.userId));
    const agentNames = coachAgentNames(agentName);
    const customerChunks = recent.filter((chunk) =>
      isStoredCustomerUtterance({
        isBot: chunk.isBot,
        speaker: chunk.speaker,
        customerTail: session.remoteDigits,
        agentExt: session.ext,
        agentNames,
      }),
    );
    const window = customerChunks
      .map((chunk) => `${contactName}: ${chunk.text}`)
      .join("\n");
    const customerLines = customerChunks.map((chunk) => chunk.text);
    const latest = customerLines.at(-1) || "";
    const organizationId = String(session.organizationId);
    const [contextPack, contact, resolvedPersona] = await Promise.all([
      optionalWithin(
        buildAssistContextPack({
          organizationId,
          contactId: session.contactId,
          activityId: session.activityId || session.id,
        }),
        3_000,
      ),
      optionalWithin(getContact(session.contactId), 3_000),
      optionalWithin(assistPersonaForUserId(String(session.userId)), 3_000),
    ]);
    const productNames =
      contextPack?.products
        ?.map((product) => product.name)
        .filter((name): name is string => Boolean(name && name.trim())) ?? [];
    const fromTranscript = (latest || "").trim();
    const typed = repairAssistQueryAgainstCatalog(explicitQuery?.trim() || "", productNames);
    let query = typed;
    if (!query) query = fromTranscript;
    const words = (query || "").split(/\s+/).filter(Boolean);
    const liveCustomerLine = words.length >= 2 || (query || "").length >= 8;
    if (!explicitQuery && (!query || (isWeakAssistFragment(query) && !liveCustomerLine))) {
      return null;
    }
    if (!query) return null;
    const topic = `Call with ${contactName}`;
    query = repairAssistQueryAgainstCatalog(query || topic, productNames);

    const persona = resolvedPersona || "sales";
    const companyName =
      contextPack?.company?.name || contact?.person.company?.name || null;
    const agent = await callAiServiceAgent<Record<string, unknown>>(
      "assist-meeting",
      {
        query,
        transcriptWindow: window,
        persona,
        liveAssist: true,
        mode: "auto",
        contactId: session.contactId,
        contactName,
        companyName,
        provider: "phone",
        topic,
        organizationId,
        timeZone: zoneForSession(sessionId),
        contextPack: contextPack
          ? {
              packText: contextPack.packText,
              contact: contextPack.contact,
              company: contextPack.company,
              score: contextPack.score,
              primaryDeal: contextPack.primaryDeal,
              recentActivity: contextPack.recentActivity,
              leadSummary: contextPack.leadSummary,
              enrichmentHints: contextPack.enrichmentHints,
              products: contextPack.products,
            }
          : null,
      },
      {
        timeoutMs: explicitQuery ? 90_000 : 45_000,
      },
    );

    const result = clampAssist(agent, query);
    if (!agent) result.reason = "ai_service_unavailable";
    if (!hasCoaching(result)) {
      if (explicitQuery) {
        publish(sessionId, {
          type: "status",
          status: "assist_unavailable",
          message: "Assist could not answer — try again.",
        });
        outcome = result;
      }
      return outcome;
    }
    lastAssist.set(sessionId, result);
    publish(sessionId, { type: "assist", result });
    outcome = result;
    return result;
  } catch (error) {
    console.warn(
      "[call-transcript] assist failed",
      error instanceof Error ? error.message : error,
    );
    if (explicitQuery) {
      publish(sessionId, {
        type: "status",
        status: "assist_unavailable",
        message: "Assist could not answer — try again.",
      });
    }
    return null;
  } finally {
    coachRunning.delete(sessionId);
    if (coachQueued.has(sessionId)) {
      const next = coachQueued.get(sessionId) ?? null;
      coachQueued.delete(sessionId);
      const waiter = askWaiters.get(sessionId);
      if (waiter) askWaiters.delete(sessionId);
      const queued = runCallAssist(sessionId, next);
      if (waiter) void queued.then(waiter);
    }
  }
}

function scheduleAutoAssist(sessionId: string): void {
  const existing = coachTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  coachTimers.set(
    sessionId,
    setTimeout(() => {
      coachTimers.delete(sessionId);
      void runCallAssist(sessionId, null);
    }, 400),
  );
}

async function storeLine(line: GatewayLine): Promise<void> {
  const sessions = await prisma.callTranscriptSession.findMany({
    where: {
      status: "active",
      remoteDigits: line.customerTail,
    },
    orderBy: { startedAt: "desc" },
    take: 8,
  });
  const session = sessions.find((row) =>
    lineMatchesSession(line, {
      organizationId: String(row.organizationId),
      ext: row.ext,
      remoteDigits: row.remoteDigits,
    }),
  );
  if (!session) {
    logDrop("no session", {
      domainId: line.domainId,
      ext: line.agentExts.join(","),
      customerTail: line.customerTail,
    });
    return;
  }

  let stored: Awaited<ReturnType<typeof prisma.callTranscriptChunk.create>> | null = null;
  try {
    stored = await prisma.$transaction(async (tx) => {
    const duplicate = await tx.callTranscriptChunk.findFirst({
      where: {
        sessionId: session.id,
        speaker: line.speaker || null,
        text: line.text,
        transcriptTm: line.transcriptTm || null,
      },
      select: { id: true },
    });
    if (duplicate) return null;

    const last = await tx.callTranscriptChunk.aggregate({
      where: { sessionId: session.id },
      _max: { seq: true },
    });
    const seq = (last._max.seq ?? 0) + 1;
    const chunk = await tx.callTranscriptChunk.create({
      data: {
        sessionId: session.id,
        seq,
        speaker: line.speaker || null,
        isBot: line.isBot,
        text: line.text,
        emotion: line.emotion || null,
        transcriptTm: line.transcriptTm || null,
        raw: line.raw as Prisma.InputJsonValue,
      },
    });
    if (!session.gatewaySession && line.sessionId) {
      await tx.callTranscriptSession.update({
        where: { id: session.id },
        data: { gatewaySession: line.sessionId },
      });
    }
    return chunk;
  });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }

  if (!stored) return;
  const agentNames = coachAgentNames(await loadAgentName(String(session.userId)));
  if (!isCustomerUtterance(line, session.ext, agentNames)) return;
  publish(session.id, {
    type: "chunk",
    seq: stored.seq,
    speaker: stored.speaker,
    text: stored.text,
    isBot: stored.isBot,
  });
  scheduleAutoAssist(session.id);
}

let lastDropLog = 0;

function logDrop(reason: string, extra: Record<string, unknown>): void {
  const now = Date.now();
  if (now - lastDropLog < 5_000) return;
  lastDropLog = now;
  console.info("[call-transcript] dropped line", { reason, ...extra });
}

function transcriptStreams(): string[] {
  const configured = (process.env.CALL_TRANSCRIPT_STREAM || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const names = configured.length
    ? configured
    : ["CCAAS_AUDIO_CC_CALL_STREAM_QA", CALL_TRANSCRIPT_CHANNEL];
  return [...new Set(names)];
}

function transcriptPubsubChannels(): string[] {
  const extra = (process.env.CALL_TRANSCRIPT_CHANNEL || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set([CALL_TRANSCRIPT_CHANNEL, "CCAAS_AUDIO_CC_CALL_STREAM_QA", ...extra])];
}

function streamField(fields: string[], name: string): string {
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i] === name && fields[i + 1]) return fields[i + 1];
  }
  return "";
}

function payloadFromStreamFields(fields: string[]): string {
  const named =
    streamField(fields, "transcript_data") ||
    streamField(fields, "message") ||
    streamField(fields, "data") ||
    streamField(fields, "payload") ||
    streamField(fields, "body");
  if (named) return named;
  for (let i = 1; i < fields.length; i += 2) {
    const value = (fields[i] || "").trim();
    if (value.startsWith("{") || value.startsWith("[")) return value;
  }
  const row: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key && value) row[key] = value;
  }
  if (row.text || row.customer_number || row.customerNumber) {
    return JSON.stringify(row);
  }
  return "";
}

async function applyGatewayMessage(message: string): Promise<void> {
  const line = parseGatewayLine(message);
  if (!line) {
    let keys: string[] = [];
    try {
      const parsed = JSON.parse(message) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        keys = Object.keys(parsed as Record<string, unknown>);
      }
    } catch {
      keys = [];
    }
    logDrop("unparsed", { bytes: message.length, keys });
    return;
  }
  await storeLine(line);
}

function redisClient(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    retryStrategy: (times: number) => Math.min(times * 500, 10_000),
  });
}

/** Pull lines already written for this connected call, then keep reading new ones. */
export async function replayCallTranscriptsSince(fromMs: number): Promise<void> {
  const url = transcriptRedisUrl();
  if (!url) return;
  const redis = redisClient(url);
  try {
    const from = `${Math.max(0, fromMs)}-0`;
    for (const stream of transcriptStreams()) {
      if ((await redis.type(stream)) !== "stream") continue;
      const rows = await redis.xrange(stream, from, "+", "COUNT", 400);
      for (const [, fields] of rows) {
        const body = payloadFromStreamFields(fields);
        if (!body) continue;
        await applyGatewayMessage(body);
      }
    }
  } catch (error) {
    console.warn(
      "[call-transcript] replay failed",
      error instanceof Error ? error.message : error,
    );
  } finally {
    redis.disconnect();
  }
}

async function readTranscriptStreams(url: string): Promise<void> {
  const streams = transcriptStreams();
  const cursor = new Map<string, string>(streams.map((stream) => [stream, "$"]));
  const reader = redisClient(url);
  reader.on("error", (err) => {
    console.warn("[call-transcript] stream read error", err.message);
  });
  console.info("[call-transcript] reading streams", { streams });
  for (;;) {
    try {
      const result = await reader.xread(
        "BLOCK",
        5000,
        "STREAMS",
        ...streams,
        ...streams.map((stream) => cursor.get(stream) || "$"),
      );
      if (!result) continue;
      for (const [stream, entries] of result) {
        for (const [id, fields] of entries) {
          cursor.set(stream, id);
          const body = payloadFromStreamFields(fields);
          if (!body) continue;
          await applyGatewayMessage(body);
        }
      }
    } catch (error) {
      console.warn(
        "[call-transcript] stream read failed",
        error instanceof Error ? error.message : error,
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

export function startCallTranscriptSubscriber(): void {
  if (subscriberStarted) return;
  const url = transcriptRedisUrl();
  if (!url) {
    console.warn(
      "[call-transcript] TRANSCRIPT_REDIS_URL is not set — live call captions will not arrive",
    );
    return;
  }
  subscriberStarted = true;
  subscriber = redisClient(url);
  subscriber.on("error", (err) => {
    console.warn("[call-transcript] Redis subscribe error", err.message);
  });
  const channels = transcriptPubsubChannels();
  void subscriber.subscribe(...channels).then(() => {
    console.info("[call-transcript] subscribed", { channels, redis: redisHostLabel(url) });
  });
  subscriber.on("message", (received, message) => {
    const body = typeof message === "string" ? message : String(message ?? "");
    if (!body.trim()) return;
    void applyGatewayMessage(body).catch((error) => {
      console.warn(
        "[call-transcript] line apply failed",
        received,
        error instanceof Error ? error.message : error,
      );
    });
  });
  void readTranscriptStreams(url);
}

export async function getCallTranscriptSnapshot(sessionId: string, userId: string) {
  const session = await prisma.callTranscriptSession.findFirst({
    where: { id: sessionId, userId: tenantId(userId) },
  });
  if (!session) return null;
  const chunks = await prisma.callTranscriptChunk.findMany({
    where: { sessionId },
    orderBy: { seq: "asc" },
    select: { seq: true, speaker: true, text: true, isBot: true },
  });
  const agentNames = coachAgentNames(await loadAgentName(String(session.userId)));
  const customerChunks = chunks.filter((chunk) =>
    isStoredCustomerUtterance({
      isBot: chunk.isBot,
      speaker: chunk.speaker,
      customerTail: session.remoteDigits,
      agentExt: session.ext,
      agentNames,
    }),
  );
  return {
    sessionId: session.id,
    status: session.status,
    contactId: session.contactId,
    contactName: session.contactName,
    activityId: session.activityId,
    remoteDigits: session.remoteDigits,
    chunks: customerChunks,
    assist: lastAssist.get(sessionId) ?? null,
  };
}

export async function askCallTranscript(
  sessionId: string,
  userId: string,
  query: string,
  timeZone?: string | null,
): Promise<CallAssistResult | null> {
  const session = await prisma.callTranscriptSession.findFirst({
    where: { id: sessionId, userId: tenantId(userId), status: "active" },
    select: { id: true },
  });
  if (!session) throw fail("Call assist session not found", 404);
  rememberTimeZone(sessionId, timeZone);
  const text = query.trim();
  if (!text) throw fail("Ask needs a question", 400);
  return runCallAssist(sessionId, text.slice(0, 2000));
}

export async function executeCallAssistAction(
  sessionId: string,
  userId: string,
  action: unknown,
  timeZone?: string | null,
) {
  const session = await prisma.callTranscriptSession.findFirst({
    where: { id: sessionId, userId: tenantId(userId), status: "active" },
  });
  if (!session) throw fail("Call assist session not found", 404);
  rememberTimeZone(sessionId, timeZone);
  if (!isKnownContactId(session.contactId)) {
    return {
      ok: false as const,
      error: "Save this number as a contact first.",
      status: 400,
    };
  }
  return executeAssistActionCommand({
    organizationId: String(session.organizationId),
    userId,
    contactId: session.contactId,
    timeZone: timeZone || zoneForSession(sessionId),
    action,
  });
}

async function endInner(
  sessionId: string,
  userId: string,
  reason: "hangup" | "remote_bye" | "failed",
): Promise<{ activityId: string | null }> {
  const session = await prisma.callTranscriptSession.findFirst({
    where: { id: sessionId, userId: tenantId(userId) },
  });
  if (!session) throw fail("Call assist session not found", 404);
  if (session.status === "ended") {
    return { activityId: session.activityId };
  }

  const timer = coachTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  coachTimers.delete(sessionId);
  coachQueued.delete(sessionId);

  const chunks = await prisma.callTranscriptChunk.findMany({
    where: { sessionId },
    orderBy: { seq: "asc" },
  });
  const contactName = session.contactName?.trim() || "Contact";
  const agentName = await loadAgentName(String(session.userId));
  const transcript = rollupTranscriptText(
    chunks,
    contactName,
    session.remoteDigits,
    agentName,
  );
  const assist = lastAssist.get(sessionId) ?? null;

  let activityId: string | null = null;
  if (isKnownContactId(session.contactId)) {
    const activity = await createContactActivity(session.contactId, {
      type: "call",
      subject: `Call with ${contactName}`,
      body: session.direction === "inbound" ? "Inbound call" : "Outbound call",
      organizationId: String(session.organizationId),
      createdByUserId: userId,
    });
    activityId = activity.id;

    const priorInsights = await prisma.contactActivity.findUnique({
      where: { id: activity.id },
      select: { transcriptInsights: true },
    });
    const prior =
      priorInsights?.transcriptInsights &&
      typeof priorInsights.transcriptInsights === "object" &&
      !Array.isArray(priorInsights.transcriptInsights)
        ? (priorInsights.transcriptInsights as Record<string, unknown>)
        : {};
    const callAssistInsight = {
      kind: "call_assist",
      capturedAt: new Date().toISOString(),
      chunkCount: chunks.length,
      captureStatus: transcript ? "ok" : "no_lines",
      direction: session.direction,
      remoteDigits: session.remoteDigits,
      assist: assist
        ? {
            talkTrack: assist.talkTrack,
            suggestions: assist.suggestions,
            nextQuestions: assist.nextQuestions,
            nextBestAction: assist.nextBestAction,
            sentiment: assist.sentiment,
            sentimentCoachHint: assist.sentimentCoachHint,
            detectedObjection: assist.detectedObjection,
            conversationContext: assist.conversationContext ?? null,
            fitGaps: assist.fitGaps ?? [],
            query: assist.query,
          }
        : null,
    };

    if (transcript) {
      const attached = await attachActivityTranscript({
        activityId: activity.id,
        transcript,
        source: "audio_cc",
        runPostMeetingAgents: false,
      }).catch((error) => {
        console.warn(
          "[call-transcript] transcript attach failed",
          error instanceof Error ? error.message : error,
        );
        return { ok: false as const };
      });
      if (!attached.ok) {
        await prisma.contactActivity.update({
          where: { id: activity.id },
          data: {
            transcriptText: transcript,
            transcriptSource: "audio_cc",
            transcriptInsights: { ...prior, callAssist: callAssistInsight },
          },
        });
      } else {
        const after = await prisma.contactActivity.findUnique({
          where: { id: activity.id },
          select: { transcriptInsights: true },
        });
        const mergedPrior =
          after?.transcriptInsights &&
          typeof after.transcriptInsights === "object" &&
          !Array.isArray(after.transcriptInsights)
            ? (after.transcriptInsights as Record<string, unknown>)
            : prior;
        await prisma.contactActivity.update({
          where: { id: activity.id },
          data: {
            transcriptInsights: { ...mergedPrior, callAssist: callAssistInsight },
          },
        });
      }
    } else {
      await prisma.contactActivity.update({
        where: { id: activity.id },
        data: {
          transcriptText: "",
          transcriptSource: "audio_cc",
          transcriptInsights: { ...prior, callAssist: callAssistInsight },
        },
      });
    }
  }

  await prisma.callTranscriptSession.update({
    where: { id: session.id },
    data: {
      status: "ended",
      endedAt: new Date(),
      endReason: reason,
      activityId,
    },
  });

  lastAssist.delete(sessionId);
  sessionTimeZone.delete(sessionId);
  publish(sessionId, { type: "ended", activityId });
  return { activityId };
}

export function endCallTranscriptSession(
  sessionId: string,
  userId: string,
  reason: "hangup" | "remote_bye" | "failed",
): Promise<{ activityId: string | null }> {
  const key = `${userId}:${sessionId}`;
  const pending = ending.get(key);
  if (pending) return pending;
  const promise = endInner(sessionId, userId, reason).finally(() => {
    ending.delete(key);
  });
  ending.set(key, promise);
  return promise;
}

/** Durable transcript for a finished call activity (rolled-up text + chunks). */
export async function getCallActivityTranscript(activityId: string) {
  const id = activityId.trim();
  if (!id) return null;

  const activity = await prisma.contactActivity.findFirst({
    where: { id, type: "call" },
    select: {
      id: true,
      contactId: true,
      subject: true,
      body: true,
      transcriptText: true,
      transcriptSource: true,
      transcriptInsights: true,
      createdAt: true,
      organizationId: true,
    },
  });
  if (!activity) return null;

  const session = await prisma.callTranscriptSession.findFirst({
    where: { activityId: id },
    select: {
      id: true,
      userId: true,
      ext: true,
      direction: true,
      remoteDigits: true,
      contactName: true,
      contactId: true,
      status: true,
      endedAt: true,
      gatewaySession: true,
    },
  });

  const rawChunks = session
    ? await prisma.callTranscriptChunk.findMany({
        where: { sessionId: session.id },
        orderBy: { seq: "asc" },
        select: { seq: true, speaker: true, text: true, isBot: true },
      })
    : [];

  let contactName = session?.contactName?.trim() || "";
  if (isKnownContactId(activity.contactId)) {
    const live = await getContact(activity.contactId).catch(() => null);
    const liveName = live?.displayName?.trim();
    if (liveName) contactName = liveName;
  }
  if (!contactName) contactName = "Customer";
  const agentName = session
    ? await loadAgentName(String(session.userId))
    : "Agent";
  const remoteDigits = session?.remoteDigits || "";
  const chunks = mapTranscriptChunks(
    rawChunks,
    contactName,
    remoteDigits,
    agentName,
  );

  const insights =
    activity.transcriptInsights &&
    typeof activity.transcriptInsights === "object" &&
    !Array.isArray(activity.transcriptInsights)
      ? (activity.transcriptInsights as Record<string, unknown>)
      : null;
  const callAssist =
    insights?.callAssist && typeof insights.callAssist === "object"
      ? insights.callAssist
      : null;

  const nurture =
    chunks.length === 0
      ? await loadNurtureCallTranscript({
          activityId: activity.id,
          organizationId: String(activity.organizationId),
          contactId: activity.contactId,
          contactName,
        }).catch((error) => {
          console.warn(
            "[call-transcript] nurture ccass read failed",
            error instanceof Error ? error.message : error,
          );
          return null;
        })
      : null;
  if (nurture) {
    return {
      activityId: activity.id,
      contactId: activity.contactId,
      subject: activity.subject,
      body: activity.body,
      transcriptText: nurture.transcriptText,
      transcriptSource: "ccass",
      createdAt: activity.createdAt.toISOString(),
      contactName: nurture.contactName,
      agentName: "Bot",
      session: {
        sessionId: nurture.sessionId,
        direction: nurture.direction,
        remoteDigits: "",
        contactName: nurture.contactName,
        agentName: "Bot",
        status: nurture.status,
        endedAt: null,
        gatewaySession: nurture.sessionId,
        chunkCount: nurture.chunks.length,
      },
      callAssist,
      chunks: nurture.chunks,
      recordingUrl: nurture.recordingUrl,
    };
  }

  // Prefer a name-labeled roll-up for UI (chunks may still hold raw gateway speakers).
  let transcriptText =
    chunks.length > 0
      ? rollupTranscriptText(rawChunks, contactName, remoteDigits, agentName)
      : activity.transcriptText?.trim() || null;
  if (transcriptText && rawChunks.length === 0) {
    // Remap legacy "Agent:" / phone labels in stored text when we know names.
    transcriptText = transcriptText
      .split("\n")
      .map((line) => {
        const colon = line.indexOf(": ");
        if (colon <= 0 || colon > 80) return line;
        const who = speakerLabel(
          { speaker: line.slice(0, colon).trim(), isBot: false },
          contactName,
          remoteDigits,
          agentName,
        );
        return `${who}: ${line.slice(colon + 2)}`;
      })
      .join("\n");
  }

  return {
    activityId: activity.id,
    contactId: activity.contactId,
    subject: activity.subject,
    body: activity.body,
    transcriptText,
    transcriptSource: activity.transcriptSource?.trim() || null,
    createdAt: activity.createdAt.toISOString(),
    contactName,
    agentName,
    session: session
      ? {
          sessionId: session.id,
          direction: session.direction,
          remoteDigits: session.remoteDigits,
          contactName,
          agentName,
          status: session.status,
          endedAt: session.endedAt?.toISOString() ?? null,
          gatewaySession: session.gatewaySession,
          chunkCount: chunks.length,
        }
      : null,
    callAssist,
    chunks,
    // Agent SIP calls are not recorded by the gateway against this session.
    recordingUrl: null,
  };
}
