/**
 * Meeting Assist — sessions, transcript chunks, KB-backed coaching, finalize.
 *
 * Providers (Meet / Zoom / Teams) push live chunks or post-meeting transcripts.
 * On finalize, chunks roll up to ContactActivity.transcriptText for lifecycle.
 */

import { Prisma, type MeetingAssistProvider } from "@prisma/client";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { attachActivityTranscript } from "@/service/ai/lead-lifecycle-transcripts";
import { getContact } from "@/dao/contacts/contact-service";
import { prisma } from "@/dao/db/prisma";
import {
  parseMeetingLinkFromBody,
  parseProviderFromMeetingBody,
  parseTopicFromMeetingBody,
} from "@/lib/meeting-body";
import {
  buildAssistQueryFromRecent,
  isWeakAssistFragment,
  repairAssistQueryAgainstCatalog,
} from "@/lib/meeting-assist-questions";
import {
  pickLatestNonHostHeard,
  shouldAutoAssistFromChunk,
} from "@/lib/meeting-assist-speakers";
import { loadAssistLiveContext } from "@/service/ai/meeting-assist-live-context";
import type { MeetingProvider } from "@/lib/meeting-provider";
import {
  appendLatencyMark,
  formatLatencyDetail,
  type LiveAssistLatencyTrace,
} from "@/lib/meeting-assist-latency";
import { publishMeetingAssistEvent } from "@/service/ai/meeting-assist-events";
import {
  clearLiveLatencyTrace,
  takeLiveLatencyTrace,
} from "@/service/ai/meeting-assist-live-timing-store";
import {
  clearAutoMeetingAssist,
  scheduleAutoMeetingAssist,
} from "@/service/ai/meeting-assist-auto";
import {
  clearInternalMeetingAssist,
  scheduleInternalMeetingAssist,
} from "@/service/ai/internal-meeting-assist";
import {
  clearInternalRosterCache,
  loadInternalRoster,
} from "@/service/ai/internal-meeting-roster";
import {
  hostEmailFromMeta,
  hostMeetNameFromMeta,
  lockAttendeeTurn,
} from "@/service/ai/meeting-attendee-lock";
import {
  buildAttendeePeople,
  type AttendeeLock,
  type AttendeePerson,
  type AttendeeRole,
} from "@/lib/meeting-attendee-identity";
import {
  publishHeardIfChanged,
  clearHeardPublishState,
} from "@/service/ai/meeting-assist-heard-publish";
import { clearAssistLiveContextCache } from "@/service/ai/meeting-assist-live-context";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { buildAssistContextPack } from "@/service/ai/meeting-assist-context";
import {
  buildMeetingSpeakerRoster,
  resolveSpeakerLabel,
} from "@/service/transcripts/speaker-resolve";
import { isCustomerMeetingAssistSession } from "@/service/meeting-assist/customer-session-gate";
import { assistPersonaForUserId } from "@/service/meeting-assist/persona";
import { logMeetAssistPanel } from "@/service/ai/meeting-assist-panel-log";

export type AssistSuggestion = {
  title: string;
  text: string;
  kind: string;
};

export type AssistSentiment = "positive" | "neutral" | "negative" | "confused";

export type AssistFitGap = {
  area: string;
  status: "fit" | "gap" | "unknown";
  note?: string | null;
};

export type AssistConversationContext = {
  backgroundOneLine?: string | null;
  lastDiscussionSummary?: string | null;
  theirPositionThen?: string | null;
  theirFocusNow?: string | null;
  whatChanged?: string | null;
};

export type AssistActionKind =
  | "schedule_meeting"
  | "call"
  | "send_case_study"
  | "involve_presales"
  | "send_follow_up"
  | "task";

export type AssistAction = {
  kind: AssistActionKind;
  label: string;
  detail: string;
  whenLocal?: string | null;
  durationMinutes?: number | null;
  subject?: string | null;
  body?: string | null;
};

export type AssistResult = {
  ok: boolean;
  talkTrack: string | null;
  suggestions: AssistSuggestion[];
  objections: string[];
  nextQuestions: string[];
  conversationContext?: AssistConversationContext | null;
  /** Executable next step. Absent when this turn does not need one. */
  action?: AssistAction | null;
  nextBestAction?: string | null;
  sentimentCoachHint?: string | null;
  fitGaps?: AssistFitGap[];
  persona?: "sales" | "presales" | null;
  query?: string | null;
  sentiment: AssistSentiment | null;
  kbStatus?: string | null;
  reason?: string | null;
  /** Internal meeting card. Absent on customer-call coaching. */
  internal?: boolean;
  audience?: "employee" | "manager" | null;
  answer?: string | null;
  factVerdict?: "matches" | "differs" | "unknown" | null;
  factDetail?: string | null;
  heardLine?: string | null;
  detectedObjection?: {
    kind: "price" | "timing" | "competitor" | "authority";
    customerLine: string;
    reply: string;
    proofPoint: string | null;
    question: string | null;
  } | null;
};

function normalizeDetectedObjection(raw: unknown): AssistResult["detectedObjection"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const kind = String(row.kind || "").trim();
  const reply = String(row.reply || "").trim();
  if (
    kind !== "price" &&
    kind !== "timing" &&
    kind !== "competitor" &&
    kind !== "authority"
  ) {
    return null;
  }
  if (!reply) return null;
  return {
    kind,
    customerLine: String(row.customerLine || "").trim().slice(0, 400),
    reply: reply.slice(0, 800),
    proofPoint: String(row.proofPoint || "").trim().slice(0, 400) || null,
    question: String(row.question || "").trim().slice(0, 300) || null,
  };
}

function normalizeSentiment(raw: unknown): AssistSentiment | null {
  if (raw === "positive" || raw === "neutral" || raw === "negative") {
    return raw;
  }
  if (raw === "confused") return "confused";
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "confused" || s === "uncertain" || s === "mixed") return "confused";
  return null;
}

function toAssistProvider(
  provider: MeetingProvider | MeetingAssistProvider | string | null | undefined,
): MeetingAssistProvider {
  if (provider === "zoom" || provider === "teams" || provider === "google_meet") {
    return provider;
  }
  return "other";
}

/** Best-effort parse of Zoom/Teams event id from activity body. */
export function parseExternalMeetingIdFromBody(
  body: string | null | undefined,
): string | null {
  if (!body) return null;
  const labeled = body.match(/^(?:Zoom|Microsoft Teams|Teams) Event:\s*(.+)$/im);
  if (labeled?.[1]?.trim()) return labeled[1].trim();
  const google = body.match(/^Google Event:\s*(.+)$/im);
  return google?.[1]?.trim() || null;
}

/** SSE-only caption for the Meet add-on — no DB write, no LLM. */
export function publishLiveHeardPreview(
  sessionId: string,
  speaker: string | null,
  text: string,
  latency?: LiveAssistLatencyTrace | null,
  extra?: {
    speakerKey?: string | null;
    attendeeRole?: string | null;
    completed?: boolean;
  },
): void {
  const line = text.trim();
  if (!sessionId.trim() || !line) return;
  const detail = latency ? formatLatencyDetail(latency) : null;
  publishMeetingAssistEvent(sessionId, {
    type: "chunk",
    seq: Date.now() % 1_000_000_000,
    speaker: speaker?.trim() || null,
    speakerKey: extra?.speakerKey?.trim() || null,
    attendeeRole: extra?.attendeeRole || null,
    text: line,
    completed: extra?.completed !== false,
    latency: latency ?? undefined,
    latencyDetail: detail || undefined,
  });
}

export async function getLatestHeardForAssistSession(
  sessionId: string,
): Promise<{ speaker: string | null; text: string } | null> {
  const rows = await prisma.meetingTranscriptChunk.findMany({
    where: { sessionId },
    orderBy: { seq: "desc" },
    take: 40,
    select: { speaker: true, text: true, source: true },
  });
  if (!rows.length) return null;

  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  const identity =
    session?.meta && typeof session.meta === "object" && !Array.isArray(session.meta)
      ? (session.meta as Record<string, unknown>).attendeeIdentity
      : null;
  const turns =
    identity && typeof identity === "object" && !Array.isArray(identity)
      ? (identity as Record<string, unknown>).turns
      : null;
  const hostNames: string[] = [];
  const hostMeetName = hostMeetNameFromMeta(session?.meta);
  if (hostMeetName) hostNames.push(hostMeetName);
  if (turns && typeof turns === "object" && !Array.isArray(turns)) {
    for (const value of Object.values(turns as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const row = value as { role?: unknown; name?: unknown };
      if (row.role === "host" && typeof row.name === "string" && row.name.trim()) {
        hostNames.push(row.name);
      }
    }
  }
  return pickLatestNonHostHeard(rows, hostNames);
}

export async function startMeetingAssistSession(input: {
  activityId: string;
  organizationId?: string | null;
  hostUserId?: string | null;
  provider?: MeetingProvider | string | null;
  externalMeetingId?: string | null;
  joinUrl?: string | null;
}): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      contactId: true,
      type: true,
      body: true,
      subject: true,
    },
  });
  if (!activity || activity.type !== "meeting") {
    return { ok: false, error: "Meeting activity not found." };
  }

  const contact = await getContact(activity.contactId);
  const organizationId = await resolveRequestOrganizationId(
    input.organizationId || contact?.person.organizationId,
  );

  const provider = toAssistProvider(
    input.provider || parseProviderFromMeetingBody(activity.body),
  );
  const externalMeetingId =
    input.externalMeetingId?.trim() ||
    parseExternalMeetingIdFromBody(activity.body) ||
    null;
  const joinUrl =
    input.joinUrl?.trim() || parseMeetingLinkFromBody(activity.body) || null;

  const existing = await prisma.meetingAssistSession.findUnique({
    where: { activityId: activity.id },
    select: { id: true, status: true },
  });
  if (existing) {
    if (existing.status !== "active") {
      await prisma.meetingAssistSession.update({
        where: { id: existing.id },
        data: {
          status: "active",
          endedAt: null,
          provider,
          externalMeetingId,
          joinUrl,
          hostUserId: input.hostUserId ?? undefined,
        },
      });
    } else if (externalMeetingId || joinUrl) {
      // Keep Zoom/Teams ids + join URLs fresh when re-ensuring an active session.
      await prisma.meetingAssistSession.update({
        where: { id: existing.id },
        data: {
          ...(provider ? { provider } : {}),
          ...(externalMeetingId ? { externalMeetingId } : {}),
          ...(joinUrl ? { joinUrl } : {}),
          ...(input.hostUserId != null ? { hostUserId: input.hostUserId } : {}),
        },
      });
    }
    return { ok: true, sessionId: existing.id };
  }

  const session = await prisma.meetingAssistSession.create({
    data: {
      organizationId,
      contactId: activity.contactId,
      activityId: activity.id,
      provider,
      externalMeetingId,
      joinUrl,
      hostUserId: input.hostUserId ?? null,
      status: "active",
    },
    select: { id: true },
  });
  return { ok: true, sessionId: session.id };
}

export async function getMeetingAssistSession(sessionId: string) {
  return prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    include: {
      chunks: {
        orderBy: { seq: "asc" },
        take: 500,
      },
    },
  });
}

export async function getMeetingAssistSessionForActivity(activityId: string) {
  return prisma.meetingAssistSession.findUnique({
    where: { activityId },
    include: {
      chunks: {
        orderBy: { seq: "asc" },
        take: 200,
      },
    },
  });
}

export async function appendTranscriptChunks(input: {
  sessionId: string;
  chunks: Array<{
    text: string;
    speaker?: string | null;
    /** `ch-<channel>:<turn>` from meeting-service. */
    speakerKey?: string | null;
    speakerEmail?: string | null;
    isHost?: boolean | null;
    spokenAt?: string | Date | null;
    source?: string | null;
    seq?: number | null;
  }>;
}): Promise<{ ok: true; inserted: number; lastSeq: number } | { ok: false; error: string }> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      status: true,
      organizationId: true,
      contactId: true,
      hostUserId: true,
      activityId: true,
      meta: true,
    },
  });
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status !== "active") {
    return { ok: false, error: "Session is not active." };
  }

  const [activity, contact] = await Promise.all([
    prisma.contactActivity.findUnique({
      where: { id: session.activityId },
      select: { body: true },
    }),
    getContact(session.contactId),
  ]);
  const ownerUserId =
    contact?.person.ownerUserId || contact?.crm.ownerUserId || null;

  const roster = await buildMeetingSpeakerRoster({
    organizationId: String(session.organizationId),
    contactId: session.contactId,
    contact,
    activityBody: activity?.body,
    activityId: session.activityId,
    hostUserId: session.hostUserId ? String(session.hostUserId) : null,
    ownerUserId: ownerUserId ? String(ownerUserId) : null,
  });

  const contactName =
    contact?.displayName?.trim() ||
    [contact?.person.firstName, contact?.person.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null;
  let salesNames: string[] = [];
  for (const [, entry] of roster) {
    if (entry.role === "rep" && !salesNames.includes(entry.label)) {
      salesNames.push(entry.label);
    }
  }
  if (salesNames.length === 0 && session.hostUserId) {
    const { getUserLabelsByIds } = await import(
      "@/service/account/user-directory"
    );
    const labels = await getUserLabelsByIds([String(session.hostUserId)]);
    const name = labels.get(String(session.hostUserId));
    if (name) salesNames.push(name);
  }

  const last = await prisma.meetingTranscriptChunk.findFirst({
    where: { sessionId: session.id },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  let nextSeq = (last?.seq ?? 0) + 1;
  const rows: Prisma.MeetingTranscriptChunkCreateManyInput[] = [];
  const assistRoles: AttendeeRole[] = [];
  const assistResolutions: Array<AttendeeLock["channelResolution"]> = [];
  const assistSpeakerKeys: Array<string | null> = [];
  const hostMeetName = hostMeetNameFromMeta(session.meta);
  const hostEmail = hostEmailFromMeta(session.meta);
  const liveCtx = await loadAssistLiveContext(session.id).catch(() => null);
  const people =
    liveCtx?.people ??
    buildAttendeePeople({
      roster: [...roster.entries()].map(([email, entry]) => ({
        email,
        name: entry.label,
        role: entry.role,
        source: entry.source,
      })),
      customerEmail: contact?.person.email,
      customerName: contactName,
      hostEmail,
      hostName: hostMeetName || salesNames[0] || null,
    });

  // Classify once, before the loop, so the internal roster's people (not the
  // customer rep/customer/guest set) drive the attendee lock for this whole
  // batch — an internal call and a customer call never share one session.
  const internalRoster = await loadInternalRoster(session.id).catch((err) => {
    console.error("internal meeting roster failed", err);
    return null;
  });
  const internalMeeting = internalRoster?.kind === "internal";
  const internalAttendeePeople: AttendeePerson[] = internalMeeting
    ? (internalRoster?.people ?? []).map((person) => ({
        email: person.email,
        name: person.name,
        role: "other" as const,
      }))
    : [];

  for (const chunk of input.chunks) {
    const text = chunk.text?.trim();
    if (!text) continue;
    const seq = Number.isFinite(chunk.seq) && (chunk.seq as number) > 0
      ? Math.floor(chunk.seq as number)
      : nextSeq++;
    if (seq >= nextSeq) nextSeq = seq + 1;
    const speakerEmail = chunk.speakerEmail?.trim().toLowerCase() || null;
    const speakerLabel = resolveSpeakerLabel({
      roster,
      speakerEmail,
      speakerName: chunk.speaker?.trim() || null,
      isHost: chunk.isHost,
      customerFallback: contactName,
      repFallback: salesNames[0] ?? null,
    });
    const lock = await lockAttendeeTurn({
      sessionId: session.id,
      speakerKey: chunk.speakerKey,
      displayName: chunk.speaker,
      utteranceText: text,
      people: internalMeeting ? internalAttendeePeople : people,
      hostMeetName: internalMeeting ? null : hostMeetName,
      hostEmail: internalMeeting ? null : hostEmail,
    });
    assistRoles.push(lock.role);
    assistResolutions.push(lock.channelResolution);
    assistSpeakerKeys.push(chunk.speakerKey?.trim() || null);
    // Internal meetings: a channel that resolved a real employee/manager
    // name earlier in the call (or was left as the only unlocked person by
    // elimination) keeps that identity — so a later turn on the same
    // channel whose glow name flickers back to "Speaker" still carries the
    // email scheduleInternalMeetingAssist needs to match this speaker.
    const resolvedSpeakerEmail = internalMeeting
      ? lock.email || speakerEmail
      : speakerEmail;
    const resolvedSpeaker =
      internalMeeting &&
      lock.role !== "unknown" &&
      lock.name &&
      !/^(speaker|unknown)$/i.test(lock.name)
        ? lock.name
        : speakerLabel;
    rows.push({
      organizationId: session.organizationId,
      sessionId: session.id,
      seq,
      speaker: resolvedSpeaker,
      speakerEmail: resolvedSpeakerEmail,
      text,
      spokenAt: chunk.spokenAt ? new Date(chunk.spokenAt) : null,
      source: chunk.source?.trim() || "live_push",
    });
  }

  if (rows.length === 0) {
    return { ok: true, inserted: 0, lastSeq: last?.seq ?? 0 };
  }

  // Skip duplicates on (sessionId, seq) from webhook retries
  const result = await prisma.meetingTranscriptChunk.createMany({
    data: rows,
    skipDuplicates: true,
  });

  const lastSeq = Math.max(...rows.map((r) => r.seq));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (internalMeeting) {
      scheduleInternalMeetingAssist({
        sessionId: session.id,
        text: row.text,
        speaker: row.speaker,
        speakerEmail: row.speakerEmail,
        source: row.source,
      });
      continue;
    }
    const wordCount = row.text.split(/\s+/).filter(Boolean).length;
    // Never force-assist from Chrome mic STT — only customer-attributed lines.
    // attendeeRole is the sole identity signal: a channel/turn lock from
    // classifyAttendeeTurn, granted only by explicit tap or unambiguous
    // elimination — never by matching this row's speaker/contact strings.
    scheduleAutoMeetingAssist({
      sessionId: session.id,
      text: row.text,
      speaker: row.speaker,
      source: row.source,
      attendeeRole: assistRoles[i] ?? "unknown",
      channelResolution: assistResolutions[i],
      force:
        wordCount >= 5 &&
        !/worktual_stt/i.test(row.source || "")
          ? true
          : undefined,
    });
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (internalMeeting) break;
    const role = assistRoles[i] ?? "unknown";
    const tail = rows[i]!;
    const heardAsCustomer = liveCtx
      ? shouldAutoAssistFromChunk({
          source: tail.source,
          attendeeRole: role,
          channelResolution: assistResolutions[i],
        })
      : false;
    if (!heardAsCustomer) continue;
    publishHeardIfChanged({
      sessionId: session.id,
      speaker: tail.speaker ?? null,
      speakerKey: assistSpeakerKeys[i],
      attendeeRole: "customer",
      text: tail.text,
    });
    break;
  }

  return {
    ok: true,
    inserted: result.count,
    lastSeq,
  };
}

function formatTranscript(
  chunks: Array<{ speaker: string | null; text: string; spokenAt: Date | null }>,
): string {
  return chunks
    .map((c) => {
      const who = c.speaker?.trim() || "Speaker";
      const when = c.spokenAt
        ? `[${c.spokenAt.toISOString()}] `
        : "";
      return `${when}${who}: ${c.text.trim()}`;
    })
    .filter(Boolean)
    .join("\n");
}

export async function buildTranscriptWindow(
  sessionId: string,
  maxChars = 4000,
): Promise<string> {
  const chunks = await prisma.meetingTranscriptChunk.findMany({
    where: { sessionId },
    orderBy: { seq: "desc" },
    take: 80,
    select: { speaker: true, text: true, spokenAt: true },
  });
  const chronological = chunks.reverse();
  let text = formatTranscript(chronological);
  if (text.length > maxChars) text = text.slice(-maxChars);
  return text;
}

const ASSIST_SESSION_MEMORY_TURNS = 6;

type AssistMemoryTurn = { query: string; reply: string };

function asMetaRecord(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return { ...(meta as Record<string, unknown>) };
}

/** Last N coaching turns (customer line + reply). Older turns drop off. */
function readAssistMemory(meta: unknown): AssistMemoryTurn[] {
  const raw = asMetaRecord(meta).assistMemory;
  if (!Array.isArray(raw)) return [];
  const turns: AssistMemoryTurn[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const query = String((row as { query?: unknown }).query || "")
      .trim()
      .slice(0, 400);
    const reply = String((row as { reply?: unknown }).reply || "")
      .trim()
      .slice(0, 600);
    if (!query && !reply) continue;
    turns.push({ query, reply });
  }
  return turns.slice(-ASSIST_SESSION_MEMORY_TURNS);
}

export function isValidTimeZone(zone: string): boolean {
  const name = zone.trim();
  if (!name || name.length > 80) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function readAssistTimeZone(meta: unknown): string | null {
  const raw = asMetaRecord(meta).assistTimeZone;
  const zone = typeof raw === "string" ? raw.trim() : "";
  return isValidTimeZone(zone) ? zone : null;
}

/** Remember the rep's browser zone so "today" is their calendar, not UTC. */
export async function rememberAssistTimeZone(
  sessionId: string,
  timeZone: string | null | undefined,
): Promise<void> {
  const zone = (timeZone || "").trim();
  if (!sessionId.trim() || !isValidTimeZone(zone)) return;
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  if (!session) return;
  const meta = asMetaRecord(session.meta);
  if (meta.assistTimeZone === zone) return;
  await prisma.meetingAssistSession.update({
    where: { id: sessionId },
    data: {
      meta: { ...meta, assistTimeZone: zone } as Prisma.InputJsonValue,
    },
  });
}

export async function runMeetingAssist(input: {
  sessionId: string;
  query?: string | null;
  mode?: "sales" | "service" | string | null;
  /** Resolve persona from this viewer when persona is omitted. */
  viewerUserId?: string | null;
  persona?: "sales" | "presales" | null;
  /** Targeted SSE delivery — one publish per viewer id. */
  publishTargets?: string[] | null;
  /** Manual Ask from the panel — use a longer LLM timeout than auto-coach. */
  interactive?: boolean;
  /** IANA zone from the rep's browser. "Today" follows this calendar. */
  timeZone?: string | null;
}): Promise<AssistResult & { sessionId: string }> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      organizationId: true,
      contactId: true,
      provider: true,
      activityId: true,
      status: true,
      meta: true,
    },
  });
  if (!session) {
    return {
      sessionId: input.sessionId,
      ok: false,
      talkTrack: null,
      suggestions: [],
      objections: [],
      nextQuestions: [],
      sentiment: null,
      reason: "session_not_found",
    };
  }

  if (!(await isCustomerMeetingAssistSession(session.id))) {
    return {
      sessionId: input.sessionId,
      ok: false,
      talkTrack: null,
      suggestions: [],
      objections: [],
      nextQuestions: [],
      sentiment: null,
      reason: "not_customer_meeting",
    };
  }

  let persona = input.persona ?? null;
  if (!persona && input.viewerUserId?.trim()) {
    persona = await assistPersonaForUserId(input.viewerUserId.trim());
  }
  if (!persona && input.mode !== "service") {
    if (input.viewerUserId?.trim()) {
      return {
        sessionId: input.sessionId,
        ok: false,
        talkTrack: null,
        suggestions: [],
        objections: [],
        nextQuestions: [],
        sentiment: null,
        reason: "no_assist_persona",
      };
    }
    persona = "sales";
  }

  if (input.timeZone && isValidTimeZone(input.timeZone)) {
    await rememberAssistTimeZone(session.id, input.timeZone);
  }

  const organizationId = String(session.organizationId);

  const [contact, activity, transcriptWindow, contextPack] = await Promise.all([
    getContact(session.contactId),
    prisma.contactActivity.findUnique({
      where: { id: session.activityId },
      select: { subject: true, body: true },
    }),
    buildTranscriptWindow(session.id),
    buildAssistContextPack({
      organizationId,
      contactId: session.contactId,
      activityId: session.activityId,
    }).catch(() => null),
  ]);

  const contactName =
    contact?.displayName ||
    [contact?.person.firstName, contact?.person.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
  const topic =
    parseTopicFromMeetingBody(activity?.body) ||
    activity?.subject?.replace(/^Meeting:\s*/i, "").trim() ||
    null;

  // Prefer a strong customer question over a weak STT fragment ("extension").
  // Explicit Ask / auto-assist query always wins when it is a real question —
  // never replace it with an older higher-scoring overview from the window.
  const recentLines = transcriptWindow
    .split("\n")
    .map((line) => line.replace(/^\[.*?\]\s*/, "").replace(/^[^:]+:\s*/, "").trim())
    .filter(Boolean)
    .slice(-8);
  const productNames =
    contextPack?.products
      ?.map((p) => p.name)
      .filter((n): n is string => Boolean(n && String(n).trim())) ?? [];

  const fromTranscript = buildAssistQueryFromRecent(
    recentLines.slice(0, -1),
    recentLines[recentLines.length - 1] || "",
    productNames,
  );
  const inputQuery = repairAssistQueryAgainstCatalog(
    input.query?.trim() || "",
    productNames,
  );
  let query = inputQuery;
  if (!query || isWeakAssistFragment(query)) {
    query = fromTranscript || query;
  }
  query = repairAssistQueryAgainstCatalog(
    query || topic || "product overview",
    productNames,
  );

  const companyName =
    contextPack?.company?.name ||
    contact?.person.company?.name ||
    null;

  const llmStarted = new Date().toISOString();
  let latencyTrace = takeLiveLatencyTrace(session.id);

  const agent = await callAiServiceAgent<{
    ok?: boolean;
    talkTrack?: string | null;
    suggestions?: AssistSuggestion[];
    objections?: string[];
    nextQuestions?: string[];
    fitGaps?: AssistFitGap[];
    conversationContext?: AssistConversationContext | null;
    action?: AssistAction | null;
    nextBestAction?: string | null;
    sentimentCoachHint?: string | null;
    detectedObjection?: AssistResult["detectedObjection"];
    sentiment?: string | null;
    kbStatus?: string | null;
    reason?: string | null;
  }>(
    "assist-meeting",
    {
      query,
      transcriptWindow,
      persona: persona ?? "sales",
      liveAssist: true,
      mode:
        input.mode === "service"
          ? "service"
          : input.mode === "sales"
            ? "sales"
            : "auto",
      contactId: session.contactId,
      contactName: contactName || null,
      companyName,
      provider: session.provider,
      topic,
      organizationId,
      timeZone:
        (input.timeZone && isValidTimeZone(input.timeZone)
          ? input.timeZone.trim()
          : null) || readAssistTimeZone(session.meta),
      sessionMemory: readAssistMemory(session.meta),
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
      timeoutMs: input.interactive
        ? Number(process.env.ASK_ASSIST_AI_TIMEOUT_MS || 90_000)
        : input.publishTargets != null
          ? Number(process.env.LIVE_ASSIST_AI_TIMEOUT_MS || 45_000)
          : AI_SERVICE_JOB_TIMEOUT_MS,
    },
  );

  const llmEnded = new Date().toISOString();
  if (latencyTrace) {
    latencyTrace = appendLatencyMark(latencyTrace, {
      stage: "assist_llm",
      startedAt: llmStarted,
      endedAt: llmEnded,
    });
    clearLiveLatencyTrace(session.id);
  }

  const fitGaps = normalizeFitGaps(agent?.fitGaps);
  const conversationContext = normalizeConversationContext(
    agent?.conversationContext,
  );
  const action = normalizeAssistAction(agent?.action);
  const nextBestAction = action?.detail || null;
  const sentimentCoachHint =
    (typeof agent?.sentimentCoachHint === "string"
      ? agent.sentimentCoachHint.trim()
      : "") || null;

  const result: AssistResult = {
    ok: Boolean(agent?.ok),
    talkTrack: agent?.talkTrack ?? null,
    suggestions: Array.isArray(agent?.suggestions) ? agent!.suggestions! : [],
    objections: Array.isArray(agent?.objections) ? agent!.objections! : [],
    nextQuestions: Array.isArray(agent?.nextQuestions)
      ? agent!.nextQuestions!
      : [],
    conversationContext,
    action,
    nextBestAction,
    sentimentCoachHint,
    fitGaps: fitGaps.length ? fitGaps : undefined,
    persona: persona ?? null,
    query: query || null,
    sentiment: normalizeSentiment(agent?.sentiment) ?? (agent ? "neutral" : null),
    detectedObjection: normalizeDetectedObjection(agent?.detectedObjection),
    kbStatus: agent?.kbStatus ?? null,
    reason: agent?.reason ?? (agent ? null : "ai_service_unavailable"),
  };

  const hasInformation = Boolean(
    conversationContext &&
      Object.values(conversationContext).some((v) => (v || "").trim()),
  );
  const hasCoaching =
    Boolean((result.talkTrack || "").trim()) ||
    result.suggestions.some((s) => (s.text || "").trim()) ||
    Boolean((nextBestAction || "").trim()) ||
    hasInformation ||
    result.nextQuestions.some((q) => (q || "").trim());

  if (result.detectedObjection && session.activityId) {
    const { recordSalesObjection } = await import("@/service/contacts/sales-guide");
    await recordSalesObjection(session.activityId, result.detectedObjection).catch(
      () => undefined,
    );
  }

  const reply = (result.talkTrack || "").trim();
  let latestMeta = session.meta;
  if (result.ok && reply && (query || "").trim()) {
    const fresh = await prisma.meetingAssistSession.findUnique({
      where: { id: session.id },
      select: { meta: true },
    });
    if (fresh) latestMeta = fresh.meta;
  }
  const nextMemory =
    result.ok && reply && (query || "").trim()
      ? [
          ...readAssistMemory(latestMeta),
          {
            query: (query || "").trim().slice(0, 400),
            reply: reply.slice(0, 600),
          },
        ].slice(-ASSIST_SESSION_MEMORY_TURNS)
      : null;

  // Never blank out a good panel recommendation with a failed/empty LLM turn.
  await prisma.meetingAssistSession.update({
    where: { id: session.id },
    data: {
      lastAssistAt: new Date(),
      ...(result.ok && hasCoaching
        ? { lastSuggestions: result as unknown as Prisma.InputJsonValue }
        : {}),
      ...(nextMemory
        ? {
            meta: {
              ...asMetaRecord(latestMeta),
              assistMemory: nextMemory,
            } as Prisma.InputJsonValue,
          }
        : {}),
    },
  });

  if (result.ok && hasCoaching) {
    const targets = (
      input.publishTargets?.map((id) => id.trim()).filter(Boolean) ??
      (input.viewerUserId?.trim() ? [input.viewerUserId.trim()] : [])
    ) as string[];
    const latencyDetail = latencyTrace
      ? formatLatencyDetail(latencyTrace)
      : null;
    const assistEvent = {
      type: "assist" as const,
      result: { ...result },
      latency: latencyTrace ?? undefined,
      latencyDetail: latencyDetail || undefined,
    };
    // Heard/chunks use the broadcast channel (`*`). Auto-assist used to publish
    // only to explicit viewer ids — when the panel SSE connects late (or
    // publishTargets is []), coaching was saved to DB but never reached the UI.
    // Single broadcast — same channel as live Heard chunks (Meet add-on listens on `*`).
    publishMeetingAssistEvent(session.id, assistEvent);
    logMeetAssistPanel("assist_sse_publish", {
      sessionId: session.id,
      activeViewerCount: targets.length,
      hasTalkTrack: Boolean((result.talkTrack || "").trim()),
      suggestionCount: result.suggestions?.length ?? 0,
    });
  }

  return { sessionId: session.id, ...result };
}

const ASSIST_ACTION_KINDS = new Set<AssistActionKind>([
  "schedule_meeting",
  "call",
  "send_case_study",
  "involve_presales",
  "send_follow_up",
  "task",
]);

export function normalizeAssistAction(raw: unknown): AssistAction | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const kind = typeof row.kind === "string" ? row.kind.trim() : "";
  if (!ASSIST_ACTION_KINDS.has(kind as AssistActionKind)) return null;
  const detail = typeof row.detail === "string" ? row.detail.trim().slice(0, 400) : "";
  if (!detail) return null;
  const label =
    (typeof row.label === "string" ? row.label.trim().slice(0, 80) : "") ||
    "Do this";
  const subject =
    typeof row.subject === "string" ? row.subject.trim().slice(0, 160) : "";
  const body = typeof row.body === "string" ? row.body.trim().slice(0, 2000) : "";
  const whenLocal =
    typeof row.whenLocal === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(row.whenLocal.trim())
      ? row.whenLocal.trim()
      : "";
  const duration = Number(row.durationMinutes);
  if (kind === "schedule_meeting" && !whenLocal) return null;
  if ((kind === "send_case_study" || kind === "send_follow_up") && (!subject || !body)) {
    return null;
  }
  return {
    kind: kind as AssistActionKind,
    label,
    detail,
    whenLocal: whenLocal || null,
    durationMinutes:
      kind === "schedule_meeting"
        ? Math.max(15, Math.min(180, Number.isFinite(duration) ? Math.trunc(duration) : 30))
        : null,
    subject: subject || null,
    body: body || null,
  };
}

function normalizeConversationContext(
  raw: unknown,
): AssistConversationContext | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pick = (camel: string, snake: string) => {
    const v = o[camel] ?? o[snake];
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? t.slice(0, 500) : null;
  };
  const ctx: AssistConversationContext = {
    backgroundOneLine: pick("backgroundOneLine", "background_one_line"),
    lastDiscussionSummary: pick(
      "lastDiscussionSummary",
      "last_discussion_summary",
    ),
    theirPositionThen: pick("theirPositionThen", "their_position_then"),
    theirFocusNow: pick("theirFocusNow", "their_focus_now"),
    whatChanged: pick("whatChanged", "what_changed"),
  };
  return Object.values(ctx).some(Boolean) ? ctx : null;
}

function normalizeFitGaps(raw: unknown): AssistFitGap[] {
  if (!Array.isArray(raw)) return [];
  const out: AssistFitGap[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const area = String((item as AssistFitGap).area || "").trim();
    if (!area) continue;
    const statusRaw = String((item as AssistFitGap).status || "unknown")
      .trim()
      .toLowerCase();
    const status =
      statusRaw === "fit" || statusRaw === "gap" ? statusRaw : "unknown";
    const note = (item as AssistFitGap).note;
    out.push({
      area: area.slice(0, 120),
      status,
      note: note != null ? String(note).slice(0, 280) : null,
    });
    if (out.length >= 6) break;
  }
  return out;
}

export async function finalizeMeetingAssistSession(input: {
  sessionId: string;
  source?: string | null;
}): Promise<
  | { ok: true; transcriptChars: number; contactId: string }
  | { ok: false; error: string }
> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      activityId: true,
      contactId: true,
      provider: true,
    },
  });
  if (!session) return { ok: false, error: "Session not found." };

  const chunks = await prisma.meetingTranscriptChunk.findMany({
    where: { sessionId: session.id },
    orderBy: { seq: "asc" },
    select: { speaker: true, text: true, spokenAt: true },
  });
  const transcript = formatTranscript(chunks);
  if (!transcript.trim()) {
    await prisma.meetingAssistSession.update({
      where: { id: session.id },
      data: { status: "ended", endedAt: new Date() },
    });
    return { ok: false, error: "No transcript chunks to finalize." };
  }

  const source =
    input.source?.trim() ||
    `meeting_assist:${session.provider}`;

  await attachActivityTranscript({
    activityId: session.activityId,
    transcript,
    source,
  });

  await prisma.meetingAssistSession.update({
    where: { id: session.id },
    data: { status: "ended", endedAt: new Date() },
  });

  publishMeetingAssistEvent(session.id, {
    type: "status",
    status: "ended",
    message: "Transcript saved to contact activity.",
  });
  clearAutoMeetingAssist(session.id);
  clearInternalMeetingAssist(session.id);
  clearInternalRosterCache(session.id);
  clearAssistLiveContextCache(session.id);
  clearHeardPublishState(session.id);

  return {
    ok: true,
    transcriptChars: transcript.length,
    contactId: session.contactId,
  };
}

/** Ensure a session exists when a meeting is scheduled (lazy-ready for assist). */
export async function ensureAssistSessionForMeeting(input: {
  activityId: string;
  contactId: string;
  organizationId?: string | null;
  hostUserId?: string | null;
  provider: MeetingProvider;
  externalMeetingId?: string | null;
  joinUrl?: string | null;
}): Promise<void> {
  try {
    await startMeetingAssistSession({
      activityId: input.activityId,
      organizationId: input.organizationId,
      hostUserId: input.hostUserId,
      provider: input.provider,
      externalMeetingId: input.externalMeetingId,
      joinUrl: input.joinUrl,
    });
  } catch (err) {
    console.error("ensureAssistSessionForMeeting failed", err);
  }
}

export async function findSessionByExternalMeetingId(
  externalMeetingId: string,
): Promise<{ id: string; status: string } | null> {
  const id = externalMeetingId.trim();
  if (!id) return null;
  return prisma.meetingAssistSession.findFirst({
    where: { externalMeetingId: id },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true },
  });
}
