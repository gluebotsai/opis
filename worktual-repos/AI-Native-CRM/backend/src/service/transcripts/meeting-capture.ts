/**
 * Production meeting capture: auto-dispatch a Recall bot for every
 * CRM-scheduled Meet / Zoom / Teams meeting so lifecycle agents always get
 * conversation text (does not depend on host enabling provider transcription).
 */

import { prisma } from "@/dao/db/prisma";
import {
  parseMeetingLinkFromBody,
  parseProviderFromMeetingBody,
} from "@/lib/meeting-body";
import {
  isMeetingBotConfigured,
  recallApiKey,
  recallBaseUrl,
  webhookPublicBase,
} from "@/service/meeting-assist/meeting-bot";
import {
  isMeetingServiceConfigured,
  notetakerProvider,
} from "@/service/meeting-service/config";
import {
  fetchMeetingServiceTranscript,
  getMeetingServiceMeeting,
  mapMeetingServiceStatus,
} from "@/service/meeting-service/client";
import {
  cancelMeetingServiceNotetaker,
  sendNotetakerForActivity,
} from "@/service/meeting-service/notetaker-commands";
import { attachActivityTranscript } from "@/service/ai/lead-lifecycle-transcripts";
import { isTerminalMeetingServiceStatus } from "@/service/meeting-service/client";
import {
  buildMeetingSpeakerRoster,
  formatSpeakerLine,
} from "@/service/transcripts/speaker-resolve";
import { getContact } from "@/dao/contacts/contact-service";

export type CaptureBotStatus =
  | "scheduled"
  | "joined"
  | "done"
  | "failed"
  | "denied"
  | "missing";

export type CaptureBotMeta = {
  status: CaptureBotStatus;
  botId?: string | null;
  provider?: "recall" | "vexa";
  joinAt?: string | null;
  error?: string | null;
  /** Raw meeting-service status (awaiting_admission, active, …). */
  meetingServiceStatus?: string | null;
  updatedAt: string;
};

function captureEnabled(): boolean {
  const raw = (process.env.MEETING_CAPTURE_BOT_ENABLED || "true")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function joinSkewMinutes(): number {
  const n = Number(process.env.MEETING_CAPTURE_BOT_JOIN_SKEW_MINUTES || "5");
  return Number.isFinite(n) ? n : 5;
}

export function missingGraceHours(): number {
  const n = Number(process.env.MEETING_CAPTURE_MISSING_GRACE_HOURS || "2");
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

export function readCaptureBotMeta(meta: unknown): CaptureBotMeta | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const raw = (meta as Record<string, unknown>).captureBot;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const status = c.status;
  if (
    status !== "scheduled" &&
    status !== "joined" &&
    status !== "done" &&
    status !== "failed" &&
    status !== "denied" &&
    status !== "missing"
  ) {
    return null;
  }
  return {
    status,
    botId: typeof c.botId === "string" ? c.botId : null,
    provider:
      c.provider === "recall" || c.provider === "vexa"
        ? c.provider
        : undefined,
    meetingServiceStatus:
      typeof c.meetingServiceStatus === "string"
        ? c.meetingServiceStatus
        : null,
    joinAt: typeof c.joinAt === "string" ? c.joinAt : null,
    error: typeof c.error === "string" ? c.error : null,
    updatedAt:
      typeof c.updatedAt === "string"
        ? c.updatedAt
        : new Date().toISOString(),
  };
}

export async function patchCaptureBotMeta(
  sessionId: string,
  patch: Partial<CaptureBotMeta> & { status: CaptureBotStatus },
): Promise<void> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  const prev =
    session?.meta &&
    typeof session.meta === "object" &&
    !Array.isArray(session.meta)
      ? (session.meta as Record<string, unknown>)
      : {};
  const prevCapture =
    prev.captureBot &&
    typeof prev.captureBot === "object" &&
    !Array.isArray(prev.captureBot)
      ? (prev.captureBot as Record<string, unknown>)
      : {};
  await prisma.meetingAssistSession.update({
    where: { id: sessionId },
    data: {
      meta: {
        ...prev,
        captureBot: {
          ...prevCapture,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  });
}

function meetCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/meet\.google\.com\/([a-z0-9-]+)/i);
  return m?.[1]?.toLowerCase() || null;
}

/** Recall needs ≥10 min lead for reliable scheduled bots; closer meetings use ad-hoc join. */
export const CAPTURE_SCHEDULED_MIN_LEAD_MS = 10 * 60_000;

/** Recall join_at from CRM meeting due time (1 min early by default). */
export function computeCaptureJoinAt(
  dueAt: Date,
  nowMs: number = Date.now(),
): string {
  if (captureUsesAdHocJoin(dueAt, nowMs)) {
    return new Date(nowMs + 15_000).toISOString();
  }
  const joinAtDate = new Date(dueAt.getTime() - joinSkewMinutes() * 60_000);
  return joinAtDate.getTime() > nowMs - 60_000
    ? joinAtDate.toISOString()
    : new Date(nowMs + 15_000).toISOString();
}

/** Join immediately (omit Recall join_at) when the meeting is soon or already underway. */
export function captureUsesAdHocJoin(
  dueAt: Date,
  nowMs: number = Date.now(),
): boolean {
  return dueAt.getTime() - nowMs < CAPTURE_SCHEDULED_MIN_LEAD_MS;
}

/** Skip creating a new Recall bot when one is already scheduled for this activity. */
export function shouldReuseExistingCaptureBot(input: {
  forceReschedule?: boolean;
  existing: CaptureBotMeta | null;
}): boolean {
  if (input.forceReschedule) return false;
  const status = input.existing?.status;
  // Failed / denied / missing must be retried (e.g. after webhook URL fix or reschedule).
  if (
    status === "failed" ||
    status === "denied" ||
    status === "missing"
  ) {
    return false;
  }
  return Boolean(
    input.existing?.botId &&
      (status === "scheduled" || status === "joined" || status === "done"),
  );
}

function captureBotNeedsReplace(existing: CaptureBotMeta | null): boolean {
  if (!existing?.botId) return false;
  return (
    existing.status === "scheduled" ||
    existing.status === "joined" ||
    existing.status === "failed" ||
    existing.status === "denied" ||
    existing.status === "missing"
  );
}

function recallAuthHeaders(): Record<string, string> {
  return {
    Authorization: `Token ${recallApiKey()}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/** Recall provider for capture bots — defaults to audio STT, not Meet native captions. */
function captureTranscriptProviderConfig(): Record<string, unknown> {
  const raw = (
    process.env.MEETING_CAPTURE_TRANSCRIPT_PROVIDER || "recallai_streaming"
  )
    .trim()
    .toLowerCase();
  if (raw === "meeting_captions") {
    return { meeting_captions: {} };
  }
  return {
    recallai_streaming: {
      mode:
        process.env.MEETING_CAPTURE_TRANSCRIPT_MODE?.trim() ||
        "prioritize_accuracy",
      language_code:
        process.env.MEETING_CAPTURE_TRANSCRIPT_LANGUAGE?.trim() || "auto",
    },
  };
}

type RecallBotMetadata = {
  activityId?: string | null;
  sessionId?: string | null;
  meetCode?: string | null;
  product?: string | null;
};

async function fetchRecallBotMetadata(
  botId: string,
): Promise<RecallBotMetadata | null> {
  try {
    const res = await fetch(
      `${recallBaseUrl()}/bot/${encodeURIComponent(botId)}/`,
      {
        headers: recallAuthHeaders(),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return null;
    const bot = (await res.json()) as { metadata?: Record<string, unknown> };
    const meta = bot.metadata;
    if (!meta || typeof meta !== "object") return null;
    return {
      activityId:
        typeof meta.activityId === "string" ? meta.activityId : null,
      sessionId:
        typeof meta.sessionId === "string" ? meta.sessionId : null,
      meetCode: typeof meta.meetCode === "string" ? meta.meetCode : null,
      product: typeof meta.product === "string" ? meta.product : null,
    };
  } catch {
    return null;
  }
}

/** Find CRM session when webhook bot id differs from last stored capture bot id. */
export async function findSessionIdByCaptureBotId(
  botId: string,
): Promise<string | null> {
  const id = botId.trim();
  if (!id) return null;

  const meta = await fetchRecallBotMetadata(id);
  if (meta?.sessionId) {
    const bySession = await prisma.meetingAssistSession.findUnique({
      where: { id: meta.sessionId },
      select: { id: true },
    });
    if (bySession) return bySession.id;
  }
  if (meta?.activityId) {
    const byActivity = await prisma.meetingAssistSession.findUnique({
      where: { activityId: meta.activityId },
      select: { id: true },
    });
    if (byActivity) return byActivity.id;
  }

  const recent = await prisma.meetingAssistSession.findMany({
    orderBy: { startedAt: "desc" },
    take: 80,
    select: { id: true, meta: true },
  });
  for (const session of recent) {
    const cap = readCaptureBotMeta(session.meta);
    if (cap?.botId === id) return session.id;
  }
  return null;
}

type RecallBotListItem = {
  id?: string;
  metadata?: Record<string, unknown>;
};

/** All Recall capture bots tagged with this CRM activity (includes orphan duplicates). */
async function listRecallBotIdsForActivity(activityId: string): Promise<string[]> {
  const target = activityId.trim();
  if (!target) return [];
  const ids = new Set<string>();
  let url: string | null = `${recallBaseUrl()}/bot/?limit=50`;
  let pages = 0;
  while (url && pages < 6) {
    pages += 1;
    const res = await fetch(url, {
      headers: recallAuthHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) break;
    const data = (await res.json()) as {
      results?: RecallBotListItem[];
      next?: string | null;
    };
    for (const bot of data.results || []) {
      const meta = bot.metadata;
      if (
        meta &&
        typeof meta === "object" &&
        meta.activityId === target &&
        meta.product === "worktual_capture" &&
        typeof bot.id === "string"
      ) {
        ids.add(bot.id);
      }
    }
    const next = data.next;
    url = typeof next === "string" && next.trim() ? next : null;
  }
  return [...ids];
}

async function updateRecallCaptureBot(
  botId: string,
  patch: { join_at: string; meeting_url: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${recallBaseUrl()}/bot/${encodeURIComponent(botId)}/`,
      {
        method: "PATCH",
        headers: recallAuthHeaders(),
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const text = await res.text();
    if (res.ok) return { ok: true };
    let detail = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as { detail?: string; message?: string };
      detail = parsed.detail || parsed.message || detail;
    } catch {
      /* keep */
    }
    return { ok: false, error: detail };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Capture bot update failed",
    };
  }
}

async function deleteRecallCaptureBot(botId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${recallBaseUrl()}/bot/${encodeURIComponent(botId)}/`,
      {
        method: "DELETE",
        headers: recallAuthHeaders(),
        signal: AbortSignal.timeout(30_000),
      },
    );
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

async function retireCaptureBot(botId: string | null | undefined): Promise<void> {
  const id = botId?.trim();
  if (!id) return;
  await deleteRecallCaptureBot(id);
}

/** Minimum gap between cron-driven bot replacements for the same meeting. */
const CAPTURE_BOT_REFRESH_COOLDOWN_MS = 3 * 60_000;

/** Cancel a scheduled Recall capture bot for a superseded / replaced meeting. */
export async function cancelMeetingCaptureBot(
  activityId: string,
  reason = "superseded",
): Promise<void> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { activityId },
    select: {
      id: true,
      meta: true,
      hostUserId: true,
      organizationId: true,
    },
  });
  if (!session) return;
  const existing = readCaptureBotMeta(session.meta);
  if (existing?.botId) {
    if (existing.provider === "vexa" && session.hostUserId) {
      await cancelMeetingServiceNotetaker({
        activityId,
        organizationId: String(session.organizationId),
        userId: String(session.hostUserId),
        reason,
      });
      return;
    }
    await deleteRecallCaptureBot(existing.botId);
  }
  if (existing?.status === "scheduled" || existing?.status === "joined") {
    await patchCaptureBotMeta(session.id, {
      status: "denied",
      botId: null,
      error: reason,
    });
  }
}

/** Stop capture bots tied to other meetings on the same contact (after reschedule / rebook). */
export async function cancelStaleMeetingCaptureBots(
  contactId: string,
  keepActivityId: string,
): Promise<void> {
  const others = await prisma.contactActivity.findMany({
    where: {
      contactId,
      type: "meeting",
      id: { not: keepActivityId },
    },
    select: { id: true },
  });
  for (const row of others) {
    await cancelMeetingCaptureBot(row.id, "superseded");
  }
}

async function createRecallCaptureBot(input: {
  activityId: string;
  sessionId: string;
  joinUrl: string;
  joinAt: string;
  activityBody: string | null;
  adHoc?: boolean;
}): Promise<
  | { ok: true; botId: string; joinAt: string }
  | { ok: false; error: string }
> {
  const botName =
    process.env.MEETING_CAPTURE_BOT_DISPLAY_NAME?.trim() ||
    process.env.MEETING_BOT_DISPLAY_NAME?.trim() ||
    "Worktual Notetaker";
  const webhookUrl = `${webhookPublicBase()}/api/webhooks/meeting-bot/recall`;
  const meetCode = meetCodeFromUrl(input.joinUrl);

  const body: Record<string, unknown> = {
    meeting_url: input.joinUrl,
    bot_name: botName,
    ...(input.adHoc ? {} : { join_at: input.joinAt }),
    metadata: {
      activityId: input.activityId,
      sessionId: input.sessionId,
      ...(meetCode ? { meetCode } : {}),
      product: "worktual_capture",
      provider: parseProviderFromMeetingBody(input.activityBody),
    },
    recording_config: {
      transcript: {
        provider: captureTranscriptProviderConfig(),
      },
      realtime_endpoints: [
        {
          type: "webhook",
          url: webhookUrl,
          events: ["transcript.data", "transcript.partial_data"],
        },
      ],
    },
  };

  try {
    const res = await fetch(`${recallBaseUrl()}/bot/`, {
      method: "POST",
      headers: recallAuthHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 400);
      try {
        const parsed = JSON.parse(text) as {
          detail?: string;
          message?: string;
        };
        detail = parsed.detail || parsed.message || detail;
      } catch {
        /* keep */
      }
      return { ok: false, error: `Capture bot create failed: ${detail}` };
    }

    const data = JSON.parse(text) as { id?: string };
    if (!data.id) {
      return { ok: false, error: "Capture bot create returned no id." };
    }
    return { ok: true, botId: data.id, joinAt: input.joinAt };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Capture bot request failed",
    };
  }
}

/**
 * Schedule a capture bot for a CRM meeting activity (Recall join_at).
 * Call after the Assist session exists (ensureAssistSessionForMeeting).
 */
/** True when Recall join_at no longer matches the CRM meeting due time. */
export function captureJoinAtMismatch(
  existing: CaptureBotMeta | null,
  dueAt: Date,
  nowMs: number = Date.now(),
): boolean {
  if (!existing?.botId || !existing.joinAt) return false;
  if (
    existing.status !== "scheduled" &&
    existing.status !== "joined"
  ) {
    return false;
  }
  // Ad-hoc bots join immediately; stored joinAt is a snapshot and drifts every tick.
  if (captureUsesAdHocJoin(dueAt, nowMs)) return false;
  const expected = computeCaptureJoinAt(dueAt, nowMs);
  const delta = Math.abs(
    new Date(existing.joinAt).getTime() - new Date(expected).getTime(),
  );
  return delta > 90_000;
}

export async function dispatchMeetingCaptureBot(input: {
  activityId: string;
  /** When the meeting was rescheduled, PATCH or replace the Recall bot. */
  forceReschedule?: boolean;
  userId?: string;
  organizationId?: string;
  consentCaptured?: boolean;
}): Promise<
  | { ok: true; botId: string; joinAt: string; sessionId: string }
  | { ok: false; error: string; skipped?: boolean }
> {
  if (notetakerProvider() === "vexa" && isMeetingServiceConfigured()) {
    let userId = input.userId;
    let organizationId = input.organizationId;
    if (!userId || !organizationId) {
      const authSession = await prisma.meetingAssistSession.findUnique({
        where: { activityId: input.activityId },
        select: { hostUserId: true, organizationId: true },
      });
      userId = userId || authSession?.hostUserId || undefined;
      organizationId =
        organizationId ||
        (authSession?.organizationId != null
          ? String(authSession.organizationId)
          : undefined);
    }
    if (!userId || !organizationId) {
      return {
        ok: false,
        error: "Notetaker dispatch requires a host user on the assist session.",
        skipped: true,
      };
    }
    const sent = await sendNotetakerForActivity({
      activityId: input.activityId,
      userId,
      organizationId,
      consentCaptured: input.consentCaptured,
      forceReschedule: input.forceReschedule,
    });
    if (!sent.ok) {
      return {
        ok: false,
        error: sent.error,
        skipped: sent.skipped,
      };
    }
    return {
      ok: true,
      botId: sent.meetingServiceId,
      joinAt: new Date().toISOString(),
      sessionId: sent.sessionId,
    };
  }

  const activity = await prisma.contactActivity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      type: true,
      body: true,
      dueAt: true,
      transcriptText: true,
    },
  });
  if (!activity || activity.type !== "meeting") {
    return { ok: false, error: "Meeting activity not found." };
  }
  if (activity.transcriptText?.trim()) {
    return { ok: false, error: "Transcript already present.", skipped: true };
  }

  let session = await prisma.meetingAssistSession.findUnique({
    where: { activityId: activity.id },
    select: {
      id: true,
      joinUrl: true,
      externalMeetingId: true,
      meta: true,
      provider: true,
    },
  });
  if (!session) {
    return { ok: false, error: "Assist session missing for meeting." };
  }

  if (!captureEnabled()) {
    const error = "Meeting capture bot disabled (MEETING_CAPTURE_BOT_ENABLED=false).";
    await patchCaptureBotMeta(session.id, { status: "failed", error });
    return { ok: false, error, skipped: true };
  }
  if (!isMeetingBotConfigured()) {
    const error =
      "MEETING_BOT_API_KEY not configured — set Recall token and MEETING_BOT_WEBHOOK_BASE_URL on the API server.";
    await patchCaptureBotMeta(session.id, { status: "failed", error });
    return { ok: false, error, skipped: true };
  }

  const existing = readCaptureBotMeta(session.meta);
  const joinUrl =
    session.joinUrl || parseMeetingLinkFromBody(activity.body) || null;
  if (!joinUrl) {
    await patchCaptureBotMeta(session.id, {
      status: "failed",
      error: "Missing meeting join URL.",
    });
    return { ok: false, error: "Missing meeting join URL." };
  }

  const dueAt = activity.dueAt || new Date();
  const joinAt = computeCaptureJoinAt(dueAt);
  const adHoc = captureUsesAdHocJoin(dueAt);
  const needsRefresh =
    Boolean(input.forceReschedule) || captureJoinAtMismatch(existing, dueAt);

  // Reuse an already-dispatched bot when the meeting is imminently starting.
  // Cron + ad-hoc refresh used to spawn a new Recall bot every ~2 min here.
  if (
    existing?.botId &&
    (existing.status === "scheduled" || existing.status === "joined") &&
    !captureJoinAtMismatch(existing, dueAt) &&
    (!needsRefresh || adHoc)
  ) {
    return {
      ok: true,
      botId: existing.botId,
      joinAt: existing.joinAt || joinAt,
      sessionId: session.id,
    };
  }

  if (
    shouldReuseExistingCaptureBot({
      forceReschedule: needsRefresh,
      existing,
    })
  ) {
    return {
      ok: true,
      botId: existing!.botId!,
      joinAt: existing!.joinAt || joinAt,
      sessionId: session.id,
    };
  }

  if (
    captureBotNeedsReplace(existing) &&
    (needsRefresh ||
      existing?.status === "failed" ||
      existing?.status === "denied" ||
      existing?.status === "missing")
  ) {
    if (
      needsRefresh &&
      !adHoc &&
      existing?.botId &&
      (existing.status === "scheduled" || existing.status === "joined")
    ) {
      const updated = await updateRecallCaptureBot(existing.botId, {
        join_at: joinAt,
        meeting_url: joinUrl,
      });
      if (updated.ok) {
        await patchCaptureBotMeta(session.id, {
          status: "scheduled",
          botId: existing.botId,
          provider: "recall",
          joinAt,
          error: null,
        });
        return {
          ok: true,
          botId: existing.botId,
          joinAt,
          sessionId: session.id,
        };
      }
    }
    await retireCaptureBot(existing?.botId);
  }

  const created = await createRecallCaptureBot({
    activityId: activity.id,
    sessionId: session.id,
    joinUrl,
    joinAt,
    activityBody: activity.body,
    adHoc,
  });
  if (!created.ok) {
    await patchCaptureBotMeta(session.id, {
      status: "failed",
      error: created.error,
    });
    return { ok: false, error: created.error };
  }

  await patchCaptureBotMeta(session.id, {
    status: "scheduled",
    botId: created.botId,
    provider: "recall",
    joinAt: created.joinAt,
    error: null,
  });

  return {
    ok: true,
    botId: created.botId,
    joinAt: created.joinAt,
    sessionId: session.id,
  };
}

type RecallTranscriptShortcut = {
  data?: { download_url?: string };
  status?: { code?: string };
};

type RecallBotDetail = {
  status_changes?: Array<{ code?: string | null }>;
  recordings?: Array<{
    status?: { code?: string };
    media_shortcuts?: { transcript?: RecallTranscriptShortcut };
  }>;
  media_shortcuts?: { transcript?: RecallTranscriptShortcut };
};

function recallTranscriptDownloadUrl(bot: RecallBotDetail): string | null {
  const top = bot.media_shortcuts?.transcript?.data?.download_url?.trim();
  if (top) return top;
  for (const rec of bot.recordings || []) {
    const url = rec.media_shortcuts?.transcript?.data?.download_url?.trim();
    if (url) return url;
  }
  return null;
}

async function downloadRecallTranscriptFile(
  url: string,
  options?: {
    roster?: import("@/service/transcripts/speaker-resolve").SpeakerRoster;
    customerFallback?: string | null;
    repFallback?: string | null;
  },
): Promise<string | null> {
  // Pre-signed S3 URLs reject an extra Authorization header.
  const fileRes = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!fileRes.ok) return null;
  const raw = await fileRes.text();
  try {
    return formatRecallTranscriptPayload(JSON.parse(raw), options) || raw.trim() || null;
  } catch {
    return raw.trim() || null;
  }
}

/** Fetch full transcript text from Recall by bot id. */
export async function fetchRecallBotTranscript(
  botId: string,
  options?: {
    roster?: import("@/service/transcripts/speaker-resolve").SpeakerRoster;
    customerFallback?: string | null;
    repFallback?: string | null;
  },
): Promise<string | null> {
  const apiKey = recallApiKey();
  if (!apiKey || !botId) return null;

  try {
    const botRes = await fetch(
      `${recallBaseUrl()}/bot/${encodeURIComponent(botId)}/`,
      {
        headers: {
          Authorization: `Token ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!botRes.ok) return null;
    const bot = (await botRes.json()) as RecallBotDetail;
    const downloadUrl = recallTranscriptDownloadUrl(bot);
    if (downloadUrl) {
      const fromFile = await downloadRecallTranscriptFile(downloadUrl, options);
      if (fromFile) return fromFile;
    }

    // Legacy fallback — newer Recall regions return 400 here.
    const transcriptRes = await fetch(
      `${recallBaseUrl()}/bot/${encodeURIComponent(botId)}/transcript/`,
      {
        headers: {
          Authorization: `Token ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (transcriptRes.ok) {
      const data = (await transcriptRes.json()) as unknown;
      const formatted = formatRecallTranscriptPayload(data, options);
      if (formatted) return formatted;
    }
    return null;
  } catch {
    return null;
  }
}

/** Default slot length when meeting body has no explicit end time. */
const DEFAULT_MEETING_DURATION_MINUTES = 30;

/** After expected meeting end, how long before we mark a never-admitted bot missing. */
const POST_MEETING_SCHEDULED_MISSING_GRACE_MS = 10 * 60_000;

/**
 * When the meeting slot has passed and capture is still "scheduled", the Recall
 * bot never entered the call (usually not admitted in Google Meet).
 */
export async function maybeMarkCaptureMissingAfterMeetingEnd(
  activityId: string,
): Promise<boolean> {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: { type: true, dueAt: true, transcriptText: true },
  });
  if (!activity || activity.type !== "meeting" || !activity.dueAt) return false;
  if (activity.transcriptText?.trim()) return false;

  const expectedEndMs =
    activity.dueAt.getTime() + DEFAULT_MEETING_DURATION_MINUTES * 60_000;
  if (Date.now() < expectedEndMs + POST_MEETING_SCHEDULED_MISSING_GRACE_MS) {
    return false;
  }

  const pulled = await reconcileMeetingCapture(activityId).catch(() => false);
  if (pulled) return false;

  const session = await prisma.meetingAssistSession.findUnique({
    where: { activityId },
    select: { id: true, meta: true },
  });
  if (!session) return false;

  const cap = readCaptureBotMeta(session.meta);
  if (
    !cap ||
    cap.status === "done" ||
    cap.status === "missing" ||
    cap.status === "denied" ||
    cap.status === "failed"
  ) {
    return false;
  }

  if (cap.status !== "scheduled" && cap.status !== "joined") return false;

  const joinedStuck =
    cap.status === "joined"
      ? "The meeting ended but no transcript was saved yet. Refresh this page in a minute — if it still empty, admit Worktual Notetaker next time or check meeting-service/Vexa."
      : "Worktual Notetaker was not admitted to the call — no conversation was recorded. Admit the bot when Google Meet prompts you.";

  await patchCaptureBotMeta(session.id, {
    status: "missing",
    botId: cap.botId,
    error: joinedStuck,
  });
  await prisma.contactActivity.update({
    where: { id: activityId },
    data: { transcriptSource: "missing_capture" },
  });
  return true;
}

/** Pull transcript into CRM when live webhooks were missed. */
export async function reconcileMeetingCapture(activityId: string): Promise<boolean> {
  const id = activityId.trim();
  if (!id) return false;
  const activity = await prisma.contactActivity.findUnique({
    where: { id },
    select: { id: true, type: true, transcriptText: true, transcriptSource: true },
  });
  if (!activity || activity.type !== "meeting") return false;

  const session = await prisma.meetingAssistSession.findUnique({
    where: { activityId: id },
    select: {
      id: true,
      meta: true,
      hostUserId: true,
      organizationId: true,
    },
  });
  if (!session) return Boolean(activity.transcriptText?.trim());
  const cap = readCaptureBotMeta(session.meta);
  if (cap?.status === "denied") return false;
  const captureSettled =
    cap?.status === "done" ||
    cap?.status === "missing" ||
    cap?.status === "failed";
  const hasFinalTranscript =
    Boolean(activity.transcriptText?.trim()) &&
    activity.transcriptSource === "meeting_service";
  // Live STT may already be on the activity while Vexa is still "active",
  // or capture may be done with only a partial live pull. Keep going until
  // the post-call transcript is attached.
  if (hasFinalTranscript && captureSettled) return true;

  if (
    cap?.provider === "vexa" &&
    cap.botId &&
    isMeetingServiceConfigured() &&
    session.hostUserId
  ) {
    const organizationId = String(session.organizationId);
    const userId = String(session.hostUserId);
    const remote = await getMeetingServiceMeeting({
      organizationId,
      userId,
      meetingId: cap.botId,
    });
    if (remote.ok) {
      const mapped = mapMeetingServiceStatus(remote.meeting.status);
      await patchCaptureBotMeta(session.id, {
        status: mapped,
        botId: cap.botId,
        provider: "vexa",
        meetingServiceStatus: remote.meeting.status,
        error:
          remote.meeting.error_message ||
          remote.meeting.error_code ||
          cap.error ||
          null,
      });
      const pullTranscript = async () =>
        fetchMeetingServiceTranscript({
          organizationId,
          userId,
          meetingId: cap.botId,
        });

      if (remote.meeting.status === "active") {
        const { syncVexaLiveSegmentsForActivity } = await import(
          "@/service/meeting-service/vexa-live-assist-sync"
        );
        await syncVexaLiveSegmentsForActivity(id).catch(() => ({
          inserted: 0,
        }));
        const transcript = await pullTranscript();
        if (transcript.ok && transcript.text.trim()) {
          const current = await prisma.contactActivity.findUnique({
            where: { id },
            select: { contactId: true, organizationId: true, transcriptText: true },
          });
          const nextText = transcript.text.trim();
          if (current && (current.transcriptText?.trim() || "") !== nextText) {
            await prisma.contactActivity.update({
              where: { id },
              data: {
                transcriptText: transcript.text,
                transcriptSource: "meeting_service_live",
              },
            });
            const { scheduleLeadSummaryRefresh } = await import(
              "@/service/ai/lead-summary-refresh"
            );
            await scheduleLeadSummaryRefresh({
              organizationId: String(current.organizationId),
              contactId: current.contactId,
            }).catch((err) => {
              console.error("schedule lead summary refresh failed", err);
            });
          }
          return true;
        }
        return false;
      }

      const postCallStatuses = new Set([
        "processing",
        "stopping",
        "completed",
        "completed_partial",
        "failed",
      ]);
      if (postCallStatuses.has(remote.meeting.status)) {
        const transcript = await pullTranscript();
        if (transcript.ok && transcript.text.trim()) {
          const terminal = isTerminalMeetingServiceStatus(
            remote.meeting.status,
          );
          await attachActivityTranscript({
            activityId: id,
            transcript: transcript.text,
            source: "meeting_service",
            runPostMeetingAgents: terminal,
          });
          await patchCaptureBotMeta(session.id, {
            status: terminal ? "done" : "joined",
            botId: cap.botId,
            provider: "vexa",
            meetingServiceStatus: remote.meeting.status,
            error: terminal ? null : cap.error || null,
          });
          return true;
        }
        if (
          remote.meeting.status === "completed" ||
          remote.meeting.status === "completed_partial" ||
          remote.meeting.status === "failed"
        ) {
          const emptyMsg =
            remote.meeting.error_message ||
            remote.meeting.error_code ||
            "Meeting ended with no conversation text.";
          const terminalStatus =
            remote.meeting.status === "completed_partial" ||
            remote.meeting.error_code === "no_audio" ||
            remote.meeting.status === "failed"
              ? "missing"
              : "done";
          await patchCaptureBotMeta(session.id, {
            status: terminalStatus,
            botId: cap.botId,
            provider: "vexa",
            meetingServiceStatus: remote.meeting.status,
            error: emptyMsg,
          });
          if (terminalStatus === "missing") {
            await prisma.contactActivity.update({
              where: { id },
              data: { transcriptSource: "missing_capture" },
            });
          }
        }
      }
    }
    return false;
  }

  const botIds = new Set<string>();
  if (cap?.botId) botIds.add(cap.botId);
  for (const botId of await listRecallBotIdsForActivity(id)) {
    botIds.add(botId);
  }
  if (botIds.size === 0) return false;

  for (const botId of botIds) {
    const result = await completeMeetingCaptureFromBot({
      botId,
      activityId: id,
      sessionId: session.id,
    });
    if (result.ok) {
      if (botId !== cap?.botId) {
        await patchCaptureBotMeta(session.id, {
          status: "done",
          botId,
          error: null,
        });
      }
      return true;
    }
  }
  return false;
}

/** Sweep recent capture bots whose meetings have started and still lack text. */
export async function reconcileDueMeetingCaptures(
  limit = 20,
): Promise<{ checked: number; pulled: number }> {
  const sessions = await prisma.meetingAssistSession.findMany({
    orderBy: { startedAt: "desc" },
    take: 80,
    select: { id: true, activityId: true, meta: true },
  });
  let checked = 0;
  let pulled = 0;
  for (const session of sessions) {
    if (checked >= limit) break;
    const cap = readCaptureBotMeta(session.meta);
    if (!cap || cap.status === "done" || cap.status === "denied") {
      continue;
    }
    const activity = await prisma.contactActivity.findUnique({
      where: { id: session.activityId },
      select: { type: true, dueAt: true, transcriptText: true },
    });
    if (!activity || activity.type !== "meeting") continue;
    if (activity.transcriptText?.trim()) continue;
    if (activity.dueAt && activity.dueAt.getTime() > Date.now()) continue;
    checked += 1;
    const ok = await reconcileMeetingCapture(session.activityId);
    if (ok) {
      pulled += 1;
      continue;
    }
    await maybeMarkCaptureMissingAfterMeetingEnd(session.activityId).catch(
      () => false,
    );
  }
  return { checked, pulled };
}

/** Re-point scheduled Recall bots when CRM meeting time moved (reschedule / demo book). */
export async function refreshStaleScheduledCaptureBots(
  limit = 40,
): Promise<{ checked: number; refreshed: number }> {
  const sessions = await prisma.meetingAssistSession.findMany({
    orderBy: { startedAt: "desc" },
    take: 120,
    select: { id: true, activityId: true, meta: true },
  });
  let checked = 0;
  let refreshed = 0;
  for (const session of sessions) {
    if (checked >= limit) break;
    const cap = readCaptureBotMeta(session.meta);
    if (!cap?.botId || cap.status !== "scheduled") continue;
    const activity = await prisma.contactActivity.findUnique({
      where: { id: session.activityId },
      select: { type: true, dueAt: true, transcriptText: true, updatedAt: true },
    });
    if (!activity || activity.type !== "meeting" || !activity.dueAt) continue;
    if (activity.transcriptText?.trim()) continue;
    if (activity.dueAt.getTime() < Date.now() - 60_000) continue;
    // Ad-hoc join window: bot is already trying to enter — do not spawn duplicates.
    if (captureUsesAdHocJoin(activity.dueAt)) continue;
    if (!captureJoinAtMismatch(cap, activity.dueAt)) continue;
    // Only refresh after the CRM meeting row actually changed.
    if (activity.updatedAt.getTime() <= new Date(cap.updatedAt).getTime()) continue;
    // Cooldown so a lingering joinAt mismatch cannot churn bots every cron tick.
    if (
      Date.now() - new Date(cap.updatedAt).getTime() <
      CAPTURE_BOT_REFRESH_COOLDOWN_MS
    ) {
      continue;
    }
    const authSession = await prisma.meetingAssistSession.findUnique({
      where: { activityId: session.activityId },
      select: { hostUserId: true, organizationId: true },
    });
    if (!authSession?.hostUserId) continue;
    checked += 1;
    const result = await dispatchMeetingCaptureBot({
      activityId: session.activityId,
      forceReschedule: true,
      userId: String(authSession.hostUserId),
      organizationId: String(authSession.organizationId),
      consentCaptured: true,
    });
    if (result.ok) refreshed += 1;
  }
  return { checked, refreshed };
}

export function formatRecallTranscriptPayload(
  data: unknown,
  options?: {
    roster?: import("@/service/transcripts/speaker-resolve").SpeakerRoster;
    customerFallback?: string | null;
    repFallback?: string | null;
  },
): string | null {
  if (!data) return null;
  if (typeof data === "string") return data.trim() || null;
  if (!Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.words) || Array.isArray(obj.segments)) {
      return formatRecallTranscriptPayload(obj.words || obj.segments, options);
    }
    if (typeof obj.transcript === "string") return obj.transcript.trim() || null;
    if (Array.isArray(obj.transcript)) {
      return formatRecallTranscriptPayload(obj.transcript, options);
    }
    return null;
  }

  const lines: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const participant = row.participant as
      | { name?: string; email?: string; is_host?: boolean }
      | undefined;
    const speaker =
      (row.speaker as string | undefined) ||
      participant?.name ||
      null;
    const speakerEmail =
      (participant?.email as string | undefined) ||
      (row.email as string | undefined) ||
      null;
    const isHost =
      typeof participant?.is_host === "boolean" ? participant.is_host : null;
    let text = "";
    if (typeof row.text === "string") text = row.text.trim();
    else if (Array.isArray(row.words)) {
      text = (row.words as Array<{ text?: string }>)
        .map((w) => (w?.text || "").trim())
        .filter(Boolean)
        .join(" ");
    }
    if (!text) continue;
    if (options?.roster) {
      const line = formatSpeakerLine({
        roster: options.roster,
        speaker,
        speakerEmail,
        isHost,
        customerFallback: options.customerFallback,
        repFallback: options.repFallback,
        text,
      });
      if (line) lines.push(line);
    } else {
      lines.push(
        speakerEmail && typeof speakerEmail === "string" && speakerEmail.includes("@")
          ? `${speaker || speakerEmail}: ${text}`
          : speaker
            ? `${speaker}: ${text}`
            : text,
      );
    }
  }
  return lines.join("\n").trim() || null;
}

/**
 * Persist full bot transcript on the meeting activity and mark capture done.
 */
export async function completeMeetingCaptureFromBot(input: {
  botId?: string | null;
  activityId?: string | null;
  sessionId?: string | null;
  transcriptText?: string | null;
}): Promise<
  | { ok: true; activityId: string; chars: number }
  | { ok: false; error: string }
> {
  let activityId = input.activityId?.trim() || null;
  let sessionId = input.sessionId?.trim() || null;

  if (!sessionId && input.botId) {
    sessionId = await findSessionIdByCaptureBotId(input.botId);
    if (sessionId && !activityId) {
      const s = await prisma.meetingAssistSession.findUnique({
        where: { id: sessionId },
        select: { activityId: true },
      });
      activityId = s?.activityId || null;
    }
  }

  if (!activityId && input.botId) {
    const meta = await fetchRecallBotMetadata(input.botId);
    activityId = meta?.activityId || null;
    if (!sessionId && meta?.sessionId) {
      sessionId = meta.sessionId;
    }
  }

  if (!sessionId && input.botId) {
    const sessions = await prisma.meetingAssistSession.findMany({
      where: {
        meta: {
          path: ["captureBot", "botId"],
          equals: input.botId,
        },
      },
      take: 5,
      select: { id: true, activityId: true, meta: true },
    });
    // Prisma JSON path filter may not work on all DBs — also scan recent
    if (sessions[0]) {
      sessionId = sessions[0].id;
      activityId = activityId || sessions[0].activityId;
    } else {
      const recent = await prisma.meetingAssistSession.findMany({
        orderBy: { startedAt: "desc" },
        take: 40,
        select: { id: true, activityId: true, meta: true },
      });
      for (const s of recent) {
        const cap = readCaptureBotMeta(s.meta);
        if (cap?.botId && input.botId && cap.botId === input.botId) {
          sessionId = s.id;
          activityId = activityId || s.activityId;
          break;
        }
      }
    }
  }

  if (!activityId && sessionId) {
    const s = await prisma.meetingAssistSession.findUnique({
      where: { id: sessionId },
      select: { activityId: true },
    });
    activityId = s?.activityId || null;
  }

  if (!activityId) {
    return { ok: false, error: "No activity for capture bot transcript." };
  }

  const activityRow = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      contactId: true,
      organizationId: true,
      body: true,
      createdByUserId: true,
    },
  });

  const contact = activityRow
    ? await getContact(activityRow.contactId)
    : null;
  const contactName =
    contact?.displayName?.trim() ||
    [contact?.person.firstName, contact?.person.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null;
  const roster = activityRow
    ? await buildMeetingSpeakerRoster({
        organizationId: String(activityRow.organizationId),
        contactId: activityRow.contactId,
        activityBody: activityRow.body,
        activityId: activityRow.id,
        hostUserId: activityRow.createdByUserId
          ? String(activityRow.createdByUserId)
          : null,
        ownerUserId: contact?.person.ownerUserId
          ? String(contact.person.ownerUserId)
          : contact?.crm.ownerUserId
            ? String(contact.crm.ownerUserId)
            : null,
      })
    : new Map();

  let repFallback: string | null = null;
  for (const [, entry] of roster) {
    if (entry.role === "rep") {
      repFallback = entry.label;
      break;
    }
  }

  const formatOpts = {
    roster,
    customerFallback: contactName,
    repFallback,
  };

  let text = input.transcriptText?.trim() || "";
  if (!text && input.botId) {
    text = (await fetchRecallBotTranscript(input.botId, formatOpts)) || "";
  }

  if (!text && sessionId) {
    const chunks = await prisma.meetingTranscriptChunk.findMany({
      where: { sessionId },
      orderBy: { seq: "asc" },
      select: { speaker: true, speakerEmail: true, text: true, source: true },
    });
    text = chunks
      .map((c) => {
        const src = (c.source || "").trim();
        const isHost =
          src === "meeting_bot_capture"
            ? true
            : src === "meeting_bot"
              ? false
              : null;
        return formatSpeakerLine({
          roster,
          speaker: c.speaker,
          speakerEmail: c.speakerEmail,
          isHost,
          customerFallback: contactName,
          repFallback,
          text: c.text,
        });
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  } else if (text && roster.size > 0) {
    text = text
      .split("\n")
      .map((line) => {
        const m = line.match(/^([^:]{1,120}):\s*(.+)$/);
        if (!m) return line;
        return formatSpeakerLine({
          roster,
          speaker: m[1],
          speakerEmail: m[1].includes("@") ? m[1] : null,
          customerFallback: contactName,
          repFallback,
          text: m[2],
        });
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (!text) {
    return { ok: false, error: "Capture transcript empty or not ready." };
  }

  const attached = await attachActivityTranscript({
    activityId,
    transcript: text,
    source: "meeting_bot_capture",
  });
  if (!attached.ok) {
    return { ok: false, error: "Failed to attach capture transcript." };
  }

  if (sessionId) {
    await patchCaptureBotMeta(sessionId, {
      status: "done",
      botId: input.botId || undefined,
      error: null,
    });
  }

  return { ok: true, activityId, chars: text.length };
}

/**
 * Mark CRM meetings past grace with no transcript as capture missing.
 * Safe to call from lifecycle context build (bounded).
 */
export async function markMissingMeetingCapturesForContact(
  contactId: string,
): Promise<number> {
  const graceMs = missingGraceHours() * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - graceMs);

  const meetings = await prisma.contactActivity.findMany({
    where: {
      contactId,
      type: "meeting",
      transcriptText: null,
      dueAt: { lte: cutoff },
    },
    take: 10,
    select: { id: true, dueAt: true },
  });

  let marked = 0;
  for (const m of meetings) {
    const session = await prisma.meetingAssistSession.findUnique({
      where: { activityId: m.id },
      select: { id: true, meta: true },
    });
    if (!session) continue;
    const pulled = await reconcileMeetingCapture(m.id).catch(() => false);
    if (pulled) continue;
    const cap = readCaptureBotMeta(
      (
        await prisma.meetingAssistSession.findUnique({
          where: { id: session.id },
          select: { meta: true },
        })
      )?.meta ?? session.meta,
    );
    if (cap?.status === "done" || cap?.status === "missing") continue;
    await patchCaptureBotMeta(session.id, {
      status: "missing",
      botId: cap?.botId,
      error:
        cap?.status === "failed"
          ? cap.error || "Capture failed."
          : "No transcript after meeting ended — bot may not have been admitted, or capture failed.",
    });
    // Sentinel so UI / agents can see missing without schema migration
    await prisma.contactActivity.update({
      where: { id: m.id },
      data: {
        transcriptSource: "missing_capture",
      },
    });
    marked += 1;
  }
  return marked;
}

/**
 * True when this contact has a past CRM meeting that should have produced
 * conversation evidence but still has no transcript.
 */
export async function contactHasMissingMeetingCapture(
  contactId: string,
): Promise<boolean> {
  const graceMs = missingGraceHours() * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - graceMs);
  const row = await prisma.contactActivity.findFirst({
    where: {
      contactId,
      type: "meeting",
      dueAt: { lte: cutoff },
      transcriptText: null,
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Meeting-held engagement for lifecycle auto-advance requires a real transcript
 * (bot capture or native). Calendar due time alone is not enough.
 */
export function meetingHeldWithTranscriptEvidence(
  activities: Array<{
    type: string;
    dueAt?: Date | string | null;
    createdAt: Date | string;
    transcriptText?: string | null;
  }>,
): boolean {
  const now = Date.now();
  for (const a of activities) {
    if (a.type !== "meeting" && a.type !== "call") continue;
    if (!a.transcriptText?.trim()) continue;
    const when = a.dueAt ? new Date(a.dueAt).getTime() : new Date(a.createdAt).getTime();
    if (when <= now) return true;
  }
  return false;
}
