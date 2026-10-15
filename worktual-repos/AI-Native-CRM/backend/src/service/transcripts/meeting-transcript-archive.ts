/**
 * Post-meeting transcript archive — pull full text from Meet / Zoom / Teams
 * after the call ends (transcription must have been enabled on the provider).
 *
 * Independent of live Sales Assist. Saves via attachActivityTranscript.
 */

import { prisma } from "@/dao/db/prisma";
import {
  parseMeetingLinkFromBody,
  parseProviderFromMeetingBody,
} from "@/lib/meeting-body";
import type { MeetingProvider } from "@/lib/meeting-provider";
import { attachActivityTranscript } from "@/service/ai/lead-lifecycle-transcripts";
import { parseExternalMeetingIdFromBody } from "@/service/ai/meeting-assist";
import { fetchGoogleMeetTranscript } from "@/service/transcripts/google-meet-transcript";
import { fetchTeamsMeetingTranscript } from "@/service/transcripts/teams-transcript";
import { fetchZoomMeetingTranscript } from "@/service/transcripts/zoom-transcript";

export type TranscriptArchiveResult =
  | { ok: true; activityId: string; source: string; chars: number }
  | {
      ok: false;
      activityId: string;
      reason: string;
      /** True when we should try again later (processing delay). */
      retryable: boolean;
    };

type ArchiveMeta = {
  attempts: number;
  lastAttemptAt: string;
  lastError?: string | null;
  status: "pending" | "saved" | "exhausted" | "unavailable";
};

function graceMinutes(): number {
  const n = Number(process.env.MEETING_TRANSCRIPT_ARCHIVE_GRACE_MINUTES || "30");
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

function maxAttempts(): number {
  const n = Number(process.env.MEETING_TRANSCRIPT_ARCHIVE_MAX_ATTEMPTS || "8");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8;
}

function archiveEnabled(): boolean {
  const raw = (process.env.MEETING_TRANSCRIPT_ARCHIVE_ENABLED || "true")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function meetCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/meet\.google\.com\/([a-z0-9-]+)/i);
  return m?.[1]?.toLowerCase() || null;
}

function zoomMeetingIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/zoom\.us\/j\/(\d+)/i);
  return m?.[1] || null;
}

async function patchSessionArchiveMeta(
  sessionId: string | null,
  patch: Partial<ArchiveMeta>,
) {
  if (!sessionId) return;
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
  const prevArchive =
    prev.transcriptArchive &&
    typeof prev.transcriptArchive === "object" &&
    !Array.isArray(prev.transcriptArchive)
      ? (prev.transcriptArchive as Record<string, unknown>)
      : {};
  await prisma.meetingAssistSession.update({
    where: { id: sessionId },
    data: {
      meta: {
        ...prev,
        transcriptArchive: {
          ...prevArchive,
          ...patch,
        },
      },
    },
  });
}

function readArchiveMeta(meta: unknown): ArchiveMeta | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const archive = (meta as Record<string, unknown>).transcriptArchive;
  if (!archive || typeof archive !== "object" || Array.isArray(archive)) {
    return null;
  }
  const a = archive as Record<string, unknown>;
  return {
    attempts: typeof a.attempts === "number" ? a.attempts : 0,
    lastAttemptAt:
      typeof a.lastAttemptAt === "string" ? a.lastAttemptAt : "",
    lastError: typeof a.lastError === "string" ? a.lastError : null,
    status:
      a.status === "saved" ||
      a.status === "exhausted" ||
      a.status === "unavailable" ||
      a.status === "pending"
        ? a.status
        : "pending",
  };
}

/**
 * Fetch full post-meeting transcript for one CRM meeting activity and attach it.
 */
export async function archiveMeetingTranscript(
  activityId: string,
): Promise<TranscriptArchiveResult> {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      type: true,
      body: true,
      dueAt: true,
      transcriptText: true,
      createdByUserId: true,
    },
  });

  if (!activity || activity.type !== "meeting") {
    return {
      ok: false,
      activityId,
      reason: "Meeting activity not found.",
      retryable: false,
    };
  }

  if (activity.transcriptText?.trim()) {
    return {
      ok: true,
      activityId,
      source: "already_present",
      chars: activity.transcriptText.length,
    };
  }

  const session = await prisma.meetingAssistSession.findUnique({
    where: { activityId },
    select: {
      id: true,
      provider: true,
      externalMeetingId: true,
      joinUrl: true,
      hostUserId: true,
      meta: true,
    },
  });

  const archiveMeta = readArchiveMeta(session?.meta);
  if (archiveMeta?.status === "saved") {
    return {
      ok: false,
      activityId,
      reason: "Archive already marked saved but transcriptText empty.",
      retryable: false,
    };
  }
  if (
    archiveMeta?.status === "exhausted" ||
    archiveMeta?.status === "unavailable"
  ) {
    return {
      ok: false,
      activityId,
      reason: archiveMeta.lastError || `Archive ${archiveMeta.status}.`,
      retryable: false,
    };
  }
  if ((archiveMeta?.attempts || 0) >= maxAttempts()) {
    await patchSessionArchiveMeta(session?.id || null, {
      status: "exhausted",
      lastError: "Max archive attempts reached.",
      attempts: archiveMeta?.attempts || maxAttempts(),
      lastAttemptAt: new Date().toISOString(),
    });
    return {
      ok: false,
      activityId,
      reason: "Max archive attempts reached.",
      retryable: false,
    };
  }

  const provider: MeetingProvider =
    session?.provider === "zoom" ||
    session?.provider === "teams" ||
    session?.provider === "google_meet"
      ? session.provider
      : parseProviderFromMeetingBody(activity.body);

  const joinUrl =
    session?.joinUrl || parseMeetingLinkFromBody(activity.body) || null;
  const externalId =
    session?.externalMeetingId ||
    parseExternalMeetingIdFromBody(activity.body) ||
    null;

  const attempt = (archiveMeta?.attempts || 0) + 1;
  await patchSessionArchiveMeta(session?.id || null, {
    attempts: attempt,
    lastAttemptAt: new Date().toISOString(),
    status: "pending",
    lastError: null,
  });

  let fetched:
    | { ok: true; text: string; source: string }
    | { ok: false; reason: string; retryable: boolean };

  if (provider === "zoom") {
    const meetingId = externalId || zoomMeetingIdFromUrl(joinUrl);
    fetched = await fetchZoomMeetingTranscript(meetingId);
  } else if (provider === "teams") {
    fetched = await fetchTeamsMeetingTranscript(externalId);
  } else {
    const meetCode =
      meetCodeFromUrl(joinUrl) ||
      (externalId && /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i.test(externalId)
        ? externalId.toLowerCase()
        : null);
    const hostUserId = session?.hostUserId || activity.createdByUserId || null;
    const calendarEventId =
      parseExternalMeetingIdFromBody(activity.body) ||
      (externalId &&
      !/^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i.test(externalId)
        ? externalId
        : null);
    fetched = await fetchGoogleMeetTranscript({
      meetCode,
      calendarEventId,
      hostUserId,
    });
  }

  if (!fetched.ok) {
    await patchSessionArchiveMeta(session?.id || null, {
      attempts: attempt,
      lastAttemptAt: new Date().toISOString(),
      lastError: fetched.reason,
      status: fetched.retryable ? "pending" : "unavailable",
    });
    return {
      ok: false,
      activityId,
      reason: fetched.reason,
      retryable: fetched.retryable,
    };
  }

  const attached = await attachActivityTranscript({
    activityId,
    transcript: fetched.text,
    source: fetched.source,
  });

  if (!attached.ok) {
    await patchSessionArchiveMeta(session?.id || null, {
      attempts: attempt,
      lastAttemptAt: new Date().toISOString(),
      lastError: "Failed to attach transcript to activity.",
      status: "pending",
    });
    return {
      ok: false,
      activityId,
      reason: "Failed to attach transcript to activity.",
      retryable: true,
    };
  }

  await patchSessionArchiveMeta(session?.id || null, {
    attempts: attempt,
    lastAttemptAt: new Date().toISOString(),
    lastError: null,
    status: "saved",
  });

  return {
    ok: true,
    activityId,
    source: fetched.source,
    chars: fetched.text.length,
  };
}

/**
 * Sweep recently ended meetings that still lack transcriptText.
 * Intended for cron: every 10–15 minutes.
 */
export async function processMeetingTranscriptArchive(limit = 20): Promise<{
  scanned: number;
  saved: number;
  pending: number;
  failed: number;
  skipped: number;
}> {
  if (!archiveEnabled()) {
    return { scanned: 0, saved: 0, pending: 0, failed: 0, skipped: 0 };
  }

  const graceMs = graceMinutes() * 60_000;
  const cutoff = new Date(Date.now() - graceMs);
  const lookbackDays = Number(
    process.env.MEETING_TRANSCRIPT_ARCHIVE_LOOKBACK_DAYS || "7",
  );
  const lookbackMs =
    (Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : 7) *
    24 *
    60 *
    60 *
    1000;
  const oldest = new Date(Date.now() - lookbackMs);

  const candidates = await prisma.contactActivity.findMany({
    where: {
      type: "meeting",
      transcriptText: null,
      dueAt: {
        lte: cutoff,
        gte: oldest,
      },
    },
    orderBy: { dueAt: "asc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true },
  });

  let saved = 0;
  let pending = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of candidates) {
    const result = await archiveMeetingTranscript(row.id);
    if (result.ok) {
      if (result.source === "already_present") skipped += 1;
      else saved += 1;
    } else if (result.retryable) {
      pending += 1;
    } else {
      failed += 1;
    }
  }

  return {
    scanned: candidates.length,
    saved,
    pending,
    failed,
    skipped,
  };
}
