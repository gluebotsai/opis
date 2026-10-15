/**
 * Stream Vexa transcript segments (meeting-service) into CRM assist chunks
 * so scheduleAutoMeetingAssist can coach the rep during the call.
 */

import { prisma } from "@/dao/db/prisma";
import {
  appendLatencyMark,
  buildVexaSyncLatencyTrace,
  formatLatencyDetail,
  normalizeLatencyTrace,
  type LiveAssistLatencyTrace,
} from "@/lib/meeting-assist-latency";
import { appendTranscriptChunks } from "@/service/ai/meeting-assist";
import {
  publishHeardIfChanged,
  stableHeardAtForSegment,
} from "@/service/ai/meeting-assist-heard-publish";
import { stashLiveLatencyTrace } from "@/service/ai/meeting-assist-live-timing-store";
import { loadAssistLiveContext } from "@/service/ai/meeting-assist-live-context";
import { lockAttendeeTurn } from "@/service/ai/meeting-attendee-lock";
import { scheduleAutoMeetingAssist } from "@/service/ai/meeting-assist-auto";
import {
  shouldAutoAssistFromChunk,
  shouldPublishLiveHeard,
} from "@/lib/meeting-assist-speakers";
import {
  isWeakAssistFragment,
  looksLikeCustomerQuery,
  scoreQueryCandidate,
} from "@/lib/meeting-assist-questions";
import {
  liveUtteranceSyncKey,
  normalizeLiveCaptionText,
} from "@/lib/meeting-assist-transcript-dedupe";
import {
  fetchMeetingServiceTranscript,
  getMeetingServiceMeeting,
  isBotAlreadyActiveError,
  mapMeetingServiceStatus,
  type MeetingServiceSegment,
} from "@/service/meeting-service/client";
import { latestSegmentForHeard } from "@/service/meeting-service/vexa-live-heard";
import { isMeetingServiceConfigured } from "@/service/meeting-service/config";
import { logMeetAssistPanel } from "@/service/ai/meeting-assist-panel-log";
import {
  appendMeetAssistTranscriptLine,
  writeMeetAssistTranscriptSnapshot,
} from "@/service/ai/meet-assist-transcript-log";
import {
  patchCaptureBotMeta,
  readCaptureBotMeta,
} from "@/service/transcripts/meeting-capture";

const MAX_TRACKED_SEGMENT_IDS = 400;

/** meeting-service may POST the same segment_id again when Whisper revises text. */
function liveSegmentSyncKey(segmentId: string, text: string): string {
  const sid = segmentId.trim() || text.trim().slice(0, 32);
  return `${sid}::${normalizeLiveCaptionText(text)}`;
}

function liveCaptionDedupeKeys(input: {
  segmentId: string;
  speaker?: string | null;
  text: string;
}): string[] {
  return [
    liveSegmentSyncKey(input.segmentId, input.text),
    liveUtteranceSyncKey(input.speaker, input.text),
  ];
}

/** Serialize live-caption dedupe claims per session (concurrent POSTs). */
const liveCaptionClaimTail = new Map<string, Promise<void>>();

async function claimLiveCaptionDedupe(
  sessionId: string,
  keys: string[],
): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const session = await prisma.meetingAssistSession.findUnique({
      where: { id: sessionId },
      select: { meta: true },
    });
    if (!session) return false;
    const synced = new Set(readVexaLiveSync(session.meta).segmentIds);
    if (keys.some((k) => synced.has(k))) return false;
    for (const k of keys) synced.add(k);
    await patchVexaLiveSync(sessionId, { segmentIds: [...synced] });
    return true;
  };

  const prev = liveCaptionClaimTail.get(sessionId) ?? Promise.resolve();
  const work = prev.then(run, run);
  liveCaptionClaimTail.set(
    sessionId,
    work.then(
      () => undefined,
      () => undefined,
    ),
  );
  return work;
}
// Lowered from 38 to trigger the fast/live-assist path a bit more readily on
// still-forming draft transcripts, cutting time-to-first-recommendation.
const DRAFT_ASSIST_SCORE = Number(process.env.LIVE_ASSIST_DRAFT_SCORE || 30);

function activityAtMsFromSpeech(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function stampLiveCaptionLatency(
  sessionId: string,
  latencyRaw: unknown,
): LiveAssistLatencyTrace | null {
  const ingestStarted = new Date().toISOString();
  let trace = normalizeLatencyTrace(latencyRaw);
  if (!trace) return null;
  trace = appendLatencyMark(trace, {
    stage: "crm_ingest",
    startedAt: ingestStarted,
    endedAt: new Date().toISOString(),
  });
  trace = appendLatencyMark(trace, {
    stage: "heard_sse",
    startedAt: new Date().toISOString(),
  });
  stashLiveLatencyTrace(sessionId, trace);
  trace.source = "pcm";
  return trace;
}

async function maybeScheduleDraftAssist(
  sessionId: string,
  text: string,
  speaker?: string | null,
  speakerKey?: string | null,
): Promise<void> {
  const score = scoreQueryCandidate(text);
  const isQuery = looksLikeCustomerQuery(text);
  if (!isQuery && score < DRAFT_ASSIST_SCORE) return;
  const ctx = await loadAssistLiveContext(sessionId);
  if (!ctx) return;
  const { lockAttendeeTurn } = await import("@/service/ai/meeting-attendee-lock");
  const lock = await lockAttendeeTurn({
    sessionId,
    speakerKey,
    displayName: speaker,
    utteranceText: text,
    people: ctx.people,
    hostMeetName: ctx.hostMeetName,
    hostEmail: ctx.hostEmail,
  });
  scheduleAutoMeetingAssist({
    sessionId,
    text,
    speaker,
    source: "live_pcm_draft",
    attendeeRole: lock.role,
    channelResolution: lock.channelResolution,
    force: isQuery || score >= DRAFT_ASSIST_SCORE,
  });
}

type VexaLiveSyncMeta = {
  segmentIds: string[];
  updatedAt?: string;
};

async function publishLatestHeard(
  sessionId: string,
  segments: MeetingServiceSegment[],
): Promise<void> {
  const latest = latestSegmentForHeard(segments);
  if (!latest) return;
  const ctx = await loadAssistLiveContext(sessionId);
  if (!ctx) return;
  const lock = await lockAttendeeTurn({
    sessionId,
    speakerKey: latest.speakerKey || latest.speaker_key,
    displayName: latest.speaker,
    utteranceText: latest.text,
    people: ctx.people,
    hostMeetName: ctx.hostMeetName,
    hostEmail: ctx.hostEmail,
  });
  if (
    !shouldPublishLiveHeard({
      speaker: latest.speaker,
      attendeeRole: lock.role,
    })
  ) {
    return;
  }
  const heardAt = stableHeardAtForSegment(sessionId, latest.segmentId);
  const trace =
    buildVexaSyncLatencyTrace({
      segmentId: latest.segmentId,
      speechStartSec: latest.start,
      speechEndSec: latest.end,
      heardAt,
    }) ?? undefined;
  publishHeardIfChanged({
    sessionId,
    speaker: latest.speaker,
    speakerKey: latest.speakerKey || latest.speaker_key,
    attendeeRole: lock.role,
    text: latest.text,
    segmentId: latest.segmentId,
    latency: trace,
    latencyDetail: trace ? formatLatencyDetail(trace) : null,
  });
}

function readVexaLiveSync(meta: unknown): VexaLiveSyncMeta {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return { segmentIds: [] };
  }
  const raw = (meta as Record<string, unknown>).vexaLiveSync;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { segmentIds: [] };
  }
  const ids = (raw as VexaLiveSyncMeta).segmentIds;
  return {
    segmentIds: Array.isArray(ids)
      ? ids.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
      : [],
    updatedAt:
      typeof (raw as VexaLiveSyncMeta).updatedAt === "string"
        ? (raw as VexaLiveSyncMeta).updatedAt
        : undefined,
  };
}

async function patchVexaLiveSync(
  sessionId: string,
  sync: VexaLiveSyncMeta,
): Promise<void> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  if (!session) return;
  const base =
    session.meta && typeof session.meta === "object" && !Array.isArray(session.meta)
      ? { ...(session.meta as Record<string, unknown>) }
      : {};
  const segmentIds = sync.segmentIds.slice(-MAX_TRACKED_SEGMENT_IDS);
  base.vexaLiveSync = {
    segmentIds,
    updatedAt: sync.updatedAt || new Date().toISOString(),
  };
  await prisma.meetingAssistSession.update({
    where: { id: sessionId },
    data: { meta: base as object },
  });
}

function logSyncSkip(input: {
  activityId: string;
  sessionId?: string | null;
  reason: string;
  detail?: Record<string, unknown>;
}): void {
  logMeetAssistPanel("transcript_sync_skip", {
    activityId: input.activityId,
    sessionId: input.sessionId ?? null,
    reason: input.reason,
    ...input.detail,
  });
}

/** Pull new completed segments from meeting-service → CRM live assist chunks. */
export async function syncVexaLiveSegmentsForActivity(
  activityId: string,
): Promise<{ inserted: number; skipped?: string }> {
  if (!isMeetingServiceConfigured()) {
    logSyncSkip({ activityId, reason: "meeting_service_not_configured" });
    return { inserted: 0, skipped: "meeting_service_not_configured" };
  }

  const session = await prisma.meetingAssistSession.findUnique({
    where: { activityId },
    select: {
      id: true,
      status: true,
      meta: true,
      hostUserId: true,
      organizationId: true,
    },
  });
  if (!session?.hostUserId) {
    logSyncSkip({
      activityId,
      sessionId: session?.id ?? null,
      reason: "no_session",
      detail: { hasSession: Boolean(session) },
    });
    return { inserted: 0, skipped: "no_session" };
  }

  const cap = readCaptureBotMeta(session.meta);
  if (!cap?.botId || cap.provider !== "vexa") {
    logSyncSkip({
      activityId,
      sessionId: session.id,
      reason: "no_vexa_bot",
      detail: { botId: cap?.botId ?? null, provider: cap?.provider ?? null },
    });
    return { inserted: 0, skipped: "no_vexa_bot" };
  }

  const organizationId = String(session.organizationId);
  const userId = String(session.hostUserId);

  const remote = await getMeetingServiceMeeting({
    organizationId,
    userId,
    meetingId: cap.botId,
  });
  if (!remote.ok) {
    logSyncSkip({
      activityId,
      sessionId: session.id,
      reason: "remote_unavailable",
      detail: { meetingId: cap.botId, error: remote.error },
    });
    return { inserted: 0, skipped: "remote_unavailable" };
  }

  const liveStatuses = new Set([
    "active",
    "awaiting_admission",
    "joining",
    "requested",
  ]);
  if (!liveStatuses.has(remote.meeting.status)) {
    logSyncSkip({
      activityId,
      sessionId: session.id,
      reason: "not_live",
      detail: { meetingId: cap.botId, status: remote.meeting.status },
    });
    return { inserted: 0, skipped: "not_live" };
  }

  const mapped = mapMeetingServiceStatus(
    remote.meeting.status,
    remote.meeting.error_message || remote.meeting.error_code,
  );
  if (mapped !== "joined" && mapped !== "scheduled") {
    logSyncSkip({
      activityId,
      sessionId: session.id,
      reason: "capture_not_active",
      detail: {
        meetingId: cap.botId,
        status: remote.meeting.status,
        mapped,
      },
    });
    return { inserted: 0, skipped: "capture_not_active" };
  }

  const transcript = await fetchMeetingServiceTranscript({
    organizationId,
    userId,
    meetingId: cap.botId,
    includePartial: true,
  });
  if (!transcript.ok) {
    logSyncSkip({
      activityId,
      sessionId: session.id,
      reason: "transcript_unavailable",
      detail: {
        meetingId: cap.botId,
        error: transcript.error,
        httpStatus: "status" in transcript ? transcript.status : null,
      },
    });
    return { inserted: 0, skipped: "transcript_unavailable" };
  }

  const partialCount = transcript.segments.filter((s) => s.completed === false).length;
  writeMeetAssistTranscriptSnapshot({
    sessionId: session.id,
    activityId,
    meetingId: cap.botId,
    text: transcript.text,
    segmentCount: transcript.segments.length,
    partialCount,
  });

  const synced = new Set(readVexaLiveSync(session.meta).segmentIds);
  const freshCompleted: MeetingServiceSegment[] = [];
  for (const seg of transcript.segments) {
    const text = (seg.text || "").trim();
    if (!text) continue;
    const segId =
      (seg.segment_id || "").trim() ||
      `${seg.start ?? ""}:${seg.end ?? ""}:${text.slice(0, 32)}`;
    if (seg.completed === false) {
      continue;
    }
    const keys = liveCaptionDedupeKeys({
      segmentId: segId,
      speaker: seg.speaker,
      text,
    });
    if (keys.some((k) => synced.has(k))) continue;
    for (const k of keys) synced.add(k);
    freshCompleted.push(seg);
  }

  await publishLatestHeard(session.id, transcript.segments);

  for (const seg of transcript.segments) {
    if (seg.completed !== false) continue;
    const partial = (seg.text || "").trim();
    if (!partial) continue;
    void maybeScheduleDraftAssist(
      session.id,
      partial,
      seg.speaker?.trim() || null,
      seg.speakerKey?.trim() || seg.speaker_key?.trim() || null,
    );
  }

  if (freshCompleted.length === 0) {
    return { inserted: 0 };
  }

  if (session.status !== "active") {
    await prisma.meetingAssistSession.update({
      where: { id: session.id },
      data: { status: "active" },
    });
  }

  const appended = await appendTranscriptChunks({
    sessionId: session.id,
    chunks: freshCompleted.map((seg) => ({
      text: (seg.text || "").trim(),
      speaker: seg.speaker?.trim() || null,
      speakerKey:
        seg.speakerKey?.trim() || seg.speaker_key?.trim() || null,
      source: "vexa_live",
    })),
  });

  if (!appended.ok) {
    logSyncSkip({
      activityId,
      sessionId: session.id,
      reason: "append_failed",
      detail: { error: appended.error },
    });
    return { inserted: 0, skipped: appended.error };
  }

  await patchVexaLiveSync(session.id, {
    segmentIds: [...synced],
  });

  const errMsg = remote.meeting.error_message || remote.meeting.error_code;
  if (
    remote.meeting.status === "failed" &&
    isBotAlreadyActiveError(errMsg || "")
  ) {
    await patchCaptureBotMeta(session.id, {
      status: "joined",
      error: null,
      meetingServiceStatus: "active",
    });
  }

  return { inserted: appended.inserted };
}

async function findLiveSessionByMeetingServiceId(input: {
  meetingId: string;
  organizationId?: string | null;
}): Promise<{ id: string; activityId: string; meta: unknown } | null> {
  const meetingId = input.meetingId.trim();
  if (!meetingId) return null;
  let orgFilter: { organizationId: bigint } | Record<string, never> = {};
  if (input.organizationId) {
    try {
      orgFilter = { organizationId: BigInt(input.organizationId) };
    } catch {
      orgFilter = {};
    }
  }
  const sessions = await prisma.meetingAssistSession.findMany({
    where: {
      status: "active",
      ...orgFilter,
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
    select: { id: true, activityId: true, meta: true },
  });
  for (const session of sessions) {
    if (readCaptureBotMeta(session.meta)?.botId === meetingId) {
      return session;
    }
  }
  return null;
}

/**
 * Immediate caption from meeting-service (draft or final). Drafts only update
 * the Heard bubble; completed lines persist and trigger auto-assist.
 */
export async function ingestMeetingServiceLiveCaption(input: {
  meetingId: string;
  organizationId?: string | null;
  segmentId?: string | null;
  speaker?: string | null;
  speakerKey?: string | null;
  text: string;
  completed: boolean;
  latency?: unknown;
  speechStartedAt?: string | null;
}): Promise<{ ok: true; heard: boolean; inserted: number } | { ok: false; error: string }> {
  const text = input.text.trim();
  if (!text) return { ok: true, heard: false, inserted: 0 };
  if (
    isWeakAssistFragment(text) &&
    !looksLikeCustomerQuery(text) &&
    text.split(/\s+/).length <= 3
  ) {
    return { ok: true, heard: false, inserted: 0 };
  }

  const session = await findLiveSessionByMeetingServiceId({
    meetingId: input.meetingId,
    organizationId: input.organizationId,
  });
  if (!session) {
    logMeetAssistPanel("live_caption_no_session", {
      meetingId: input.meetingId,
      organizationId: input.organizationId ?? null,
      textPreview: text.slice(0, 80),
    });
    return { ok: false, error: "No assist session for this meeting" };
  }

  const latencyTrace = stampLiveCaptionLatency(session.id, input.latency);
  const ctx = await loadAssistLiveContext(session.id);
  const lock = ctx
    ? await lockAttendeeTurn({
        sessionId: session.id,
        speakerKey: input.speakerKey,
        displayName: input.speaker,
        utteranceText: text,
        people: ctx.people,
        hostMeetName: ctx.hostMeetName,
        hostEmail: ctx.hostEmail,
        activityAtMs: activityAtMsFromSpeech(input.speechStartedAt),
      })
    : null;
  if (
    shouldPublishLiveHeard({
      speaker: input.speaker,
      attendeeRole: lock?.role ?? "unknown",
    })
  ) {
    publishHeardIfChanged({
      sessionId: session.id,
      speaker: input.speaker ?? null,
      speakerKey: input.speakerKey,
      attendeeRole: lock?.role ?? "unknown",
      text,
      segmentId: input.segmentId,
      completed: input.completed,
      latency: latencyTrace,
      latencyDetail: latencyTrace ? formatLatencyDetail(latencyTrace) : null,
    });
  }

  logMeetAssistPanel("live_caption_ingest", {
    sessionId: session.id,
    activityId: session.activityId,
    meetingId: input.meetingId,
    completed: input.completed,
    textPreview: text.slice(0, 120),
    speaker: input.speaker ?? null,
    speakerKey: input.speakerKey ?? null,
    attendeeRole: lock?.role ?? "unknown",
  });
  if (!input.completed) {
    setImmediate(() => {
      void maybeScheduleDraftAssist(
        session.id,
        text,
        input.speaker ?? null,
        input.speakerKey ?? null,
      );
    });
    return { ok: true, heard: true, inserted: 0 };
  }

  const segmentId = (input.segmentId || "").trim() || text.slice(0, 32);
  const dedupeKeys = liveCaptionDedupeKeys({
    segmentId,
    speaker: input.speaker,
    text,
  });
  const claimed = await claimLiveCaptionDedupe(session.id, dedupeKeys);
  if (!claimed) {
    return { ok: true, heard: true, inserted: 0 };
  }

  appendMeetAssistTranscriptLine({
    sessionId: session.id,
    speaker: input.speaker,
    text,
    completed: true,
  });

  // Return Heard immediately. Persist + auto-coach after the HTTP response so
  // meeting-service's 1.5s live-caption POST cannot time out on LLM/CDP work.
  setImmediate(() => {
    void (async () => {
      await appendTranscriptChunks({
        sessionId: session.id,
        chunks: [
          {
            text,
            speaker: input.speaker?.trim() || null,
            speakerKey: input.speakerKey?.trim() || null,
            source: "live_pcm",
          },
        ],
      });
    })();
  });
  return { ok: true, heard: true, inserted: 1 };
}
