/**
 * Send / stop Vexa notetaker via meeting-service (replaces Recall capture dispatch).
 */

import { prisma } from "@/dao/db/prisma";
import { parseMeetingLinkFromBody } from "@/lib/meeting-body";
import { ensureAssistSessionForMeeting } from "@/service/ai/meeting-assist";
import {
  computeCaptureJoinAt,
  captureUsesAdHocJoin,
  patchCaptureBotMeta,
  readCaptureBotMeta,
  reconcileMeetingCapture,
  type CaptureBotMeta,
} from "@/service/transcripts/meeting-capture";
import {
  createMeetingServiceNotetaker,
  getMeetingServiceMeeting,
  isBotAlreadyActiveError,
  mapMeetingServiceStatus,
  stopMeetingServiceMeeting,
} from "@/service/meeting-service/client";
import {
  isMeetingServiceConfigured,
  meetingServiceBotDisplayName,
} from "@/service/meeting-service/config";
export async function syncCaptureBotFromMeetingService(input: {
  sessionId: string;
  meetingServiceId: string;
  organizationId: string;
  userId: string;
}): Promise<CaptureBotMeta | null> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: input.sessionId },
    select: { activityId: true, meta: true },
  });
  if (!session) return null;

  const remote = await getMeetingServiceMeeting({
    organizationId: input.organizationId,
    userId: input.userId,
    meetingId: input.meetingServiceId,
  });
  if (!remote.ok) return readCaptureBotMeta(session.meta);

  const mapped = mapMeetingServiceStatus(
    remote.meeting.status,
    remote.meeting.error_message || remote.meeting.error_code,
  );
  const alreadyActiveFailed =
    remote.meeting.status === "failed" &&
    isBotAlreadyActiveError(
      remote.meeting.error_message || remote.meeting.error_code,
    );
  let meta: CaptureBotMeta = {
    status: mapped,
    botId: remote.meeting.id,
    provider: "vexa",
    joinAt: remote.meeting.join_at,
    error: alreadyActiveFailed
      ? null
      : remote.meeting.error_message ||
        remote.meeting.error_code ||
        null,
    updatedAt: new Date().toISOString(),
    meetingServiceStatus: alreadyActiveFailed
      ? "joining"
      : remote.meeting.status,
  };
  await patchCaptureBotMeta(input.sessionId, meta);

  // Webhook may never reach local CRM (wrong CRM_COMPLETED_WEBHOOK_URL).
  const activity = await prisma.contactActivity.findUnique({
    where: { id: session.activityId },
    select: { dueAt: true, transcriptText: true },
  });
  const meetingStarted =
    !activity?.dueAt || activity.dueAt.getTime() <= Date.now();
  const postCallRemote =
    remote.meeting.status === "processing" ||
    remote.meeting.status === "stopping" ||
    remote.meeting.status === "completed" ||
    remote.meeting.status === "completed_partial" ||
    remote.meeting.status === "failed";
  if (remote.meeting.status === "active") {
    const { syncVexaLiveSegmentsForActivity } = await import(
      "@/service/meeting-service/vexa-live-assist-sync"
    );
    await syncVexaLiveSegmentsForActivity(session.activityId).catch(() => ({
      inserted: 0,
    }));
  }

  if (
    meetingStarted &&
    (postCallRemote ||
      remote.meeting.status === "active" ||
      !activity?.transcriptText?.trim())
  ) {
    await reconcileMeetingCapture(session.activityId).catch(() => false);
    const refreshed = await prisma.meetingAssistSession.findUnique({
      where: { id: input.sessionId },
      select: { meta: true },
    });
    meta = readCaptureBotMeta(refreshed?.meta) ?? meta;
  }

  return meta;
}

export async function sendNotetakerForActivity(input: {
  activityId: string;
  userId: string;
  organizationId: string;
  consentCaptured?: boolean;
  forceReschedule?: boolean;
}): Promise<
  | { ok: true; meetingServiceId: string; sessionId: string; status: string }
  | { ok: false; error: string; skipped?: boolean }
> {
  if (!isMeetingServiceConfigured()) {
    return {
      ok: false,
      error:
        "Meeting service is not configured. Set MEETING_SERVICE_URL and CRM_SERVICE_JWT_SECRET.",
    };
  }

  const activity = await prisma.contactActivity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      type: true,
      body: true,
      dueAt: true,
      contactId: true,
      transcriptText: true,
      organizationId: true,
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
    select: { id: true, joinUrl: true, meta: true, provider: true },
  });
  if (!session) {
    await ensureAssistSessionForMeeting({
      activityId: activity.id,
      contactId: activity.contactId,
      organizationId: input.organizationId,
      hostUserId: input.userId,
      provider: "google_meet",
      joinUrl: parseMeetingLinkFromBody(activity.body),
    });
    session = await prisma.meetingAssistSession.findUnique({
      where: { activityId: activity.id },
      select: { id: true, joinUrl: true, meta: true, provider: true },
    });
  }
  if (!session) {
    return { ok: false, error: "Assist session missing for meeting." };
  }

  const joinUrl =
    session.joinUrl || parseMeetingLinkFromBody(activity.body) || null;
  if (!joinUrl) {
    await patchCaptureBotMeta(session.id, {
      status: "failed",
      error: "Missing meeting join URL.",
    });
    return { ok: false, error: "Missing meeting join URL." };
  }

  const existing = readCaptureBotMeta(session.meta);
  if (
    !input.forceReschedule &&
    existing?.botId &&
    existing.provider === "vexa" &&
    (existing.status === "scheduled" ||
      existing.status === "joined" ||
      existing.status === "done")
  ) {
    const synced = await syncCaptureBotFromMeetingService({
      sessionId: session.id,
      meetingServiceId: existing.botId,
      organizationId: input.organizationId,
      userId: input.userId,
    });
    return {
      ok: true,
      meetingServiceId: existing.botId,
      sessionId: session.id,
      status: synced?.meetingServiceStatus || existing.status,
    };
  }

  if (input.forceReschedule && existing?.botId && existing.provider === "vexa") {
    await stopMeetingServiceMeeting({
      organizationId: input.organizationId,
      userId: input.userId,
      meetingId: existing.botId,
    });
  }

  const dueAt = activity.dueAt || new Date();
  const adHoc = captureUsesAdHocJoin(dueAt);
  const joinAt = adHoc ? null : computeCaptureJoinAt(dueAt);
  const expectedEndAt = new Date(
    dueAt.getTime() + 30 * 60_000,
  ).toISOString();

  const entityType = "contact" as const;
  const entityId = activity.contactId;

  const created = await createMeetingServiceNotetaker({
    organizationId: input.organizationId,
    userId: input.userId,
    activityId: activity.id,
    // POST /v1/meetings keys on activityId by default; after a completed run that
    // returns the stale row and never spawns a new bot unless the key changes.
    idempotencyKey: input.forceReschedule
      ? `${activity.id}:redispatch:${Date.now()}`
      : undefined,
    entityType,
    entityId,
    meetingUrl: joinUrl,
    joinAt,
    expectedEndAt,
    botName: meetingServiceBotDisplayName(),
    consentCaptured: input.consentCaptured !== false,
  });

  if (!created.ok) {
    await patchCaptureBotMeta(session.id, {
      status: "failed",
      error: created.error,
    });
    return { ok: false, error: created.error };
  }

  await patchCaptureBotMeta(session.id, {
    status: mapMeetingServiceStatus(created.meeting.status),
    botId: created.meeting.id,
    provider: "vexa",
    joinAt: created.meeting.join_at,
    error: created.meeting.error_message || created.meeting.error_code,
    meetingServiceStatus: created.meeting.status,
  });

  return {
    ok: true,
    meetingServiceId: created.meeting.id,
    sessionId: session.id,
    status: created.meeting.status,
  };
}

export async function cancelMeetingServiceNotetaker(input: {
  activityId: string;
  organizationId: string;
  userId: string;
  reason?: string;
}): Promise<void> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { activityId: input.activityId },
    select: { id: true, meta: true },
  });
  if (!session) return;
  const existing = readCaptureBotMeta(session.meta);
  if (existing?.botId && existing.provider === "vexa") {
    await stopMeetingServiceMeeting({
      organizationId: input.organizationId,
      userId: input.userId,
      meetingId: existing.botId,
    });
  }
  await patchCaptureBotMeta(session.id, {
    status: "failed",
    botId: null,
    error: input.reason || "cancelled",
  });
}
