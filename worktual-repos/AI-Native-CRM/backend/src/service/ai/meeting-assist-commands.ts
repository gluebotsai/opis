/**
 * Framework-agnostic Meeting Assist commands (no "use server" / next/cache).
 *
 * Mirrors legacy Next meeting-assist-actions.ts plus the auth/shape logic
 * that lived directly in the Next API routes under
 * src/app/api/meeting-assist/sessions/**, so the Fastify strangler API can
 * expose the same live-assist flow without NextResponse / revalidatePath.
 * Session-vs-internal-secret auth is resolved by the Fastify route (it needs
 * raw headers/cookies); these commands assume the caller already decided
 * whether the request is authorized.
 */

import { getContact } from "@/dao/contacts/contact-service";
import { prisma } from "@/dao/db/prisma";
import { getServerUserId } from "@/service/account/session-cookie";
import {
  maybeMarkCaptureMissingAfterMeetingEnd,
  reconcileMeetingCapture,
} from "@/service/transcripts/meeting-capture";
import {
  appendTranscriptChunks,
  finalizeMeetingAssistSession,
  getMeetingAssistSession,
  getMeetingAssistSessionForActivity,
  runMeetingAssist,
  startMeetingAssistSession,
  type AssistResult,
  type AssistSuggestion,
} from "@/service/ai/meeting-assist";

export type { AssistResult, AssistSuggestion };

export async function startMeetingAssistCommand(input: {
  activityId: string;
  provider?: string | null;
  externalMeetingId?: string | null;
  joinUrl?: string | null;
}): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, error: "Sign in again." };
  return startMeetingAssistSession({
    activityId: input.activityId,
    hostUserId: userId,
    provider: input.provider,
    externalMeetingId: input.externalMeetingId,
    joinUrl: input.joinUrl,
  });
}

export type MeetingAssistSessionView = NonNullable<
  Awaited<ReturnType<typeof getMeetingAssistSession>>
> & {
  activity: {
    id: string;
    subject: string;
    body: string | null;
    transcriptText?: string | null;
    transcriptSource?: string | null;
    missEscalatedAt?: string | null;
    momSentAt?: string | null;
  } | null;
  contactName: string | null;
};

/**
 * Loads the session (with chunks) plus the small amount of activity/contact
 * context the live-assist screen needs (topic, contact name) — Next fetches
 * those separately on the server component; the SPA has one round trip.
 */
export async function getMeetingAssistSessionCommand(
  sessionId: string,
): Promise<MeetingAssistSessionView | null> {
  const userId = await getServerUserId();
  if (!userId) return null;

  const session = await getMeetingAssistSession(sessionId);
  if (!session) return null;

  const [activity, contact] = await Promise.all([
    prisma.contactActivity.findUnique({
      where: { id: session.activityId },
      select: {
        id: true,
        subject: true,
        body: true,
        transcriptText: true,
        transcriptSource: true,
        missEscalatedAt: true,
        momSentAt: true,
      },
    }),
    getContact(session.contactId),
  ]);

  return {
    ...session,
    activity: activity
      ? {
          ...activity,
          missEscalatedAt: activity.missEscalatedAt?.toISOString() ?? null,
          momSentAt: activity.momSentAt?.toISOString() ?? null,
        }
      : null,
    contactName: contact?.displayName ?? null,
  };
}

export async function getMeetingAssistForActivityCommand(
  activityId: string,
): Promise<MeetingAssistSessionView | null> {
  const userId = await getServerUserId();
  if (!userId) return null;
  await reconcileMeetingCapture(activityId).catch(() => false);
  await maybeMarkCaptureMissingAfterMeetingEnd(activityId).catch(() => false);
  const session = await getMeetingAssistSessionForActivity(activityId);
  if (!session) return null;

  const [activity, contact] = await Promise.all([
    prisma.contactActivity.findUnique({
      where: { id: session.activityId },
      select: {
        id: true,
        subject: true,
        body: true,
        transcriptText: true,
        transcriptSource: true,
        missEscalatedAt: true,
        momSentAt: true,
      },
    }),
    getContact(session.contactId),
  ]);

  return {
    ...session,
    activity: activity
      ? {
          ...activity,
          missEscalatedAt: activity.missEscalatedAt?.toISOString() ?? null,
          momSentAt: activity.momSentAt?.toISOString() ?? null,
        }
      : null,
    contactName: contact?.displayName ?? null,
  };
}

/** Single manual chunk append (contact-activity panel "Add chunk"). */
export async function appendMeetingTranscriptCommand(input: {
  sessionId: string;
  text: string;
  speaker?: string | null;
  source?: string | null;
}): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, error: "Sign in again." };
  const result = await appendTranscriptChunks({
    sessionId: input.sessionId,
    chunks: [
      {
        text: input.text,
        speaker: input.speaker,
        source: input.source || "manual",
        spokenAt: new Date(),
      },
    ],
  });
  if (!result.ok) return result;
  return { ok: true, inserted: result.inserted };
}

/**
 * Bulk chunk intake for the live client (speech-to-text pushes) and provider
 * webhooks. The Fastify route decides whether the caller is authorized
 * (signed-in user or internal secret) before calling this.
 */
export async function appendMeetingAssistChunksCommand(input: {
  sessionId: string;
  chunks: Array<{
    text: string;
    speaker?: string | null;
    spokenAt?: string | Date | null;
    source?: string | null;
    seq?: number | null;
  }>;
  defaultSource?: string;
}): Promise<
  { ok: true; inserted: number; lastSeq: number } | { ok: false; error: string }
> {
  return appendTranscriptChunks({
    sessionId: input.sessionId,
    chunks: input.chunks.map((c) => ({
      ...c,
      source: c.source || input.defaultSource || "live_push",
    })),
  });
}

export async function runMeetingAssistCommand(input: {
  sessionId: string;
  query?: string | null;
  mode?: "sales" | "service" | string | null;
  timeZone?: string | null;
}): Promise<AssistResult & { sessionId: string }> {
  const userId = await getServerUserId();
  if (!userId) {
    return {
      sessionId: input.sessionId,
      ok: false,
      talkTrack: null,
      suggestions: [],
      objections: [],
      nextQuestions: [],
      sentiment: null,
      reason: "unauthorized",
    };
  }
  return runMeetingAssist({ ...input, viewerUserId: userId });
}

/**
 * Rolls chunks up to ContactActivity.transcriptText and ends the session.
 * Auth (signed-in user or internal secret) is resolved by the Fastify route.
 */
export async function finalizeMeetingAssistCommand(input: {
  sessionId: string;
  source?: string | null;
}): Promise<
  | { ok: true; transcriptChars: number; contactId: string }
  | { ok: false; error: string }
> {
  return finalizeMeetingAssistSession(input);
}
