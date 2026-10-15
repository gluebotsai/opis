/**
 * Resolve a CRM meeting activity and attach a full provider transcript.
 * Used by Zoom / Teams / Meet push webhooks (no cron).
 */

import { prisma } from "@/dao/db/prisma";
import { attachActivityTranscript } from "@/service/ai/lead-lifecycle-transcripts";
import {
  findSessionByExternalMeetingId,
  startMeetingAssistSession,
} from "@/service/ai/meeting-assist";

export async function resolveMeetingActivityId(input: {
  provider: "google_meet" | "zoom" | "teams";
  meetingId?: string | null;
  activityId?: string | null;
  meetCode?: string | null;
}): Promise<string | null> {
  if (input.activityId?.trim()) {
    const row = await prisma.contactActivity.findFirst({
      where: { id: input.activityId.trim(), type: "meeting" },
      select: { id: true },
    });
    if (row) return row.id;
  }

  const keys = [input.meetingId, input.meetCode]
    .map((k) => k?.trim())
    .filter(Boolean) as string[];

  for (const key of keys) {
    const session = await findSessionByExternalMeetingId(key);
    if (session) {
      const full = await prisma.meetingAssistSession.findUnique({
        where: { id: session.id },
        select: { activityId: true },
      });
      if (full?.activityId) return full.activityId;
    }

    const activities = await prisma.contactActivity.findMany({
      where: { type: "meeting", body: { contains: key } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true },
    });
    if (activities[0]) return activities[0].id;
  }

  return null;
}

/**
 * Save full transcript on the contact meeting activity.
 * Creates/ensures an Assist session id only for lookup continuity.
 */
export async function attachProviderTranscriptToMeeting(input: {
  provider: "google_meet" | "zoom" | "teams";
  transcript: string;
  source: string;
  meetingId?: string | null;
  activityId?: string | null;
  meetCode?: string | null;
}): Promise<
  | { ok: true; activityId: string; chars: number }
  | { ok: false; error: string }
> {
  const text = input.transcript.trim();
  if (!text) return { ok: false, error: "Empty transcript" };

  let activityId = await resolveMeetingActivityId(input);

  if (!activityId) {
    return {
      ok: false,
      error: `No CRM meeting matched for ${input.provider} id/code`,
    };
  }

  // Skip overwrite if already archived with substantial text
  const existing = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: { transcriptText: true },
  });
  if (
    existing?.transcriptText &&
    existing.transcriptText.trim().length >= text.length
  ) {
    return {
      ok: true,
      activityId,
      chars: existing.transcriptText.length,
    };
  }

  const attached = await attachActivityTranscript({
    activityId,
    transcript: text,
    source: input.source,
  });
  if (!attached.ok) return { ok: false, error: "Failed to attach transcript" };

  // Keep Assist session external id in sync when we have a meeting id
  const ext = input.meetingId || input.meetCode || null;
  if (ext) {
    await startMeetingAssistSession({
      activityId,
      provider: input.provider,
      externalMeetingId: ext,
    }).catch(() => null);
  }

  // Native backup also satisfies capture for lifecycle agents
  const session = await prisma.meetingAssistSession.findUnique({
    where: { activityId },
    select: { id: true },
  });
  if (session) {
    const { patchCaptureBotMeta } = await import(
      "@/service/transcripts/meeting-capture"
    );
    await patchCaptureBotMeta(session.id, {
      status: "done",
      error: null,
    }).catch(() => null);
  }

  return { ok: true, activityId, chars: text.length };
}
