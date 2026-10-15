/**
 * Google Calendar events.watch → HTTPS push → CRM Meet capture dispatch.
 *
 * Not Gmail Pub/Sub. Google POSTs empty-body notifications with
 * X-Goog-Channel-* headers to POST /api/webhooks/google-calendar/push.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/dao/db/prisma";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { findCrmContactIdByEmails } from "@/dao/inbox/contact-by-email";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import {
  findActiveCaptureByMeetCode,
  findCalendarMeetCapture,
  upsertCalendarMeetCapture,
} from "@/dao/calendar/calendar-meet-capture-store";
import {
  findGoogleCalendarWatchByChannelId,
  findGoogleCalendarWatchByUserId,
  listGoogleCalendarWatchesExpiringSoon,
  updateGoogleCalendarWatchSyncToken,
  upsertGoogleCalendarWatch,
} from "@/dao/calendar/google-calendar-watch-store";
import { getSetupUserById } from "@/service/account/setup-users";
import {
  getValidGoogleAccessToken,
  googleHasCalendarScope,
} from "@/service/google/access-token";
import {
  listGoogleCalendarEventChanges,
  stopGoogleCalendarWatch,
  watchGoogleCalendarEvents,
  type GoogleCalendarListedEvent,
} from "@/service/google/calendar";
import {
  buildMeetingActivityBody,
  meetCodeFromGoogleMeetUrl,
} from "@/lib/meeting-body";
import { ensureAssistSessionForMeeting } from "@/service/ai/meeting-assist";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import {
  captureUsesAdHocJoin,
  computeCaptureJoinAt,
  dispatchMeetingCaptureBot,
  readCaptureBotMeta,
} from "@/service/transcripts/meeting-capture";
import {
  createMeetingServiceNotetaker,
  stopMeetingServiceMeeting,
} from "@/service/meeting-service/client";
import {
  isMeetingServiceConfigured,
  meetingServiceBotDisplayName,
} from "@/service/meeting-service/config";
import {
  calendarPushWebhookUrl,
  isCalendarPushConfigured,
  shouldCaptureGoogleCalendarEvent,
} from "@/lib/google-calendar-capture";

export {
  calendarPushWebhookUrl,
  isCalendarPushConfigured,
  shouldCaptureGoogleCalendarEvent,
};

const CALENDAR_PUSH_LOG = "[google-calendar-push]";

function logCalendarPush(
  message: string,
  fields?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (fields && Object.keys(fields).length > 0) {
    console.log(CALENDAR_PUSH_LOG, message, fields);
  } else {
    console.log(CALENDAR_PUSH_LOG, message);
  }
}

/** Log webhook URL without verification token query value. */
export function redactCalendarPushWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("token")) {
      u.searchParams.set("token", "***");
    }
    return u.toString();
  } catch {
    return url.replace(/([?&]token=)[^&]+/i, "$1***");
  }
}

const userSyncChains = new Map<string, Promise<unknown>>();

function serializeUserSync<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = userSyncChains.get(userId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  userSyncChains.set(userId, next);
  return next;
}

async function dispatchHostOwnedCapture(input: {
  captureId: string;
  organizationId: string;
  userId: string;
  meetUrl: string;
  dueAt: Date | null;
}): Promise<{ ok: boolean; meetingServiceId?: string; error?: string }> {
  if (!isMeetingServiceConfigured()) {
    return { ok: false, error: "Meeting service is not configured." };
  }
  const dueAt = input.dueAt || new Date();
  const adHoc = captureUsesAdHocJoin(dueAt);
  const joinAt = adHoc ? null : computeCaptureJoinAt(dueAt);
  const expectedEndAt = new Date(dueAt.getTime() + 30 * 60_000).toISOString();
  const created = await createMeetingServiceNotetaker({
    organizationId: input.organizationId,
    userId: input.userId,
    activityId: input.captureId,
    idempotencyKey: `gcal-capture:${input.captureId}`,
    entityType: "team",
    entityId: input.userId,
    meetingUrl: input.meetUrl,
    joinAt,
    expectedEndAt,
    botName: meetingServiceBotDisplayName(),
    consentCaptured: true,
  });
  if (!created.ok) return { ok: false, error: created.error };
  return { ok: true, meetingServiceId: created.meeting.id };
}

export async function ingestGoogleCalendarMeetEvent(input: {
  userId: string;
  organizationId: string;
  organizerEmail: string;
  event: GoogleCalendarListedEvent;
}): Promise<{
  imported: boolean;
  dispatched: boolean;
  skipped: boolean;
  reason?: string;
}> {
  const { userId, organizationId, event } = input;
  const organizerEmail = input.organizerEmail.trim().toLowerCase();

  if ((event.status || "").toLowerCase() === "cancelled") {
    const existing = await findCalendarMeetCapture(userId, event.id);
    if (existing?.meetingServiceId) {
      await stopMeetingServiceMeeting({
        organizationId,
        userId,
        meetingId: existing.meetingServiceId,
      }).catch(() => undefined);
    }
    if (existing) {
      await upsertCalendarMeetCapture({
        organizationId,
        userId,
        googleEventId: event.id,
        status: "cancelled",
        lastError: null,
      });
    }
    return { imported: false, dispatched: false, skipped: true, reason: "cancelled" };
  }

  if (!shouldCaptureGoogleCalendarEvent(event)) {
    return {
      imported: false,
      dispatched: false,
      skipped: true,
      reason: "not_capturable",
    };
  }

  const meetUrl = event.meetLink!.trim();
  const meetCode = meetCodeFromGoogleMeetUrl(meetUrl);
  const start = event.startAt ? new Date(event.startAt) : null;
  const end = event.endAt ? new Date(event.endAt) : null;
  const dueAt =
    start && !Number.isNaN(start.getTime()) ? start : null;
  const guestEmails = event.attendeeEmails.filter((e) => e !== organizerEmail);
  const matchEmails =
    guestEmails.length > 0 ? guestEmails : event.attendeeEmails;

  const contactId = matchEmails.length
    ? await findCrmContactIdByEmails(matchEmails, organizationId)
    : null;

  let activityId: string | null = null;
  let imported = false;
  if (contactId) {
    const providerMessageId = `gcal:${event.id}`;
    const existingActivity = await prisma.contactActivity.findUnique({
      where: { providerMessageId },
      select: { id: true, dueAt: true },
    });
    if (existingActivity) {
      activityId = existingActivity.id;
      if (
        dueAt &&
        existingActivity.dueAt?.getTime() !== dueAt.getTime()
      ) {
        await prisma.contactActivity.update({
          where: { id: existingActivity.id },
          data: { dueAt },
        });
      }
    } else {
      const whenLabel =
        dueAt && !Number.isNaN(dueAt.getTime())
          ? dueAt.toLocaleString()
          : event.startAt;
      const body = buildMeetingActivityBody({
        topic: event.summary,
        whenLabel,
        organizerName: organizerEmail.split("@")[0] || "Organizer",
        organizerEmail: organizerEmail || "unknown@calendar.local",
        guestEmails: guestEmails.length ? guestEmails : matchEmails,
        provider: "google_meet",
        meetingLink: meetUrl,
        calendarLink: event.htmlLink,
        googleEventId: event.id,
      });
      try {
        const created = await createContactActivity(contactId, {
          type: "meeting",
          subject: event.summary,
          body,
          dueAt,
          folder: "inbox",
          providerMessageId,
          mailProvider: "google",
          createdByUserId: userId,
          organizationId,
        });
        activityId = created.id;
        imported = true;
        triggerLeadLifecycle({
          contactId,
          organizationId,
          triggerReason: "calendar_meeting_synced",
        });
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: string }).code)
            : "";
        if (code === "P2002") {
          const raced = await prisma.contactActivity.findUnique({
            where: { providerMessageId },
            select: { id: true },
          });
          activityId = raced?.id ?? null;
        }
      }
    }
  }

  const capture = await upsertCalendarMeetCapture({
    organizationId,
    userId,
    googleEventId: event.id,
    meetUrl,
    meetCode,
    summary: event.summary,
    startAt: dueAt,
    endAt: end && !Number.isNaN(end.getTime()) ? end : null,
    contactId,
    activityId,
    status: "pending",
  });

  if (meetCode) {
    const other = await findActiveCaptureByMeetCode({
      organizationId,
      meetCode,
      excludeId: capture.id,
    });
    if (other?.meetingServiceId) {
      await upsertCalendarMeetCapture({
        organizationId,
        userId,
        googleEventId: event.id,
        meetingServiceId: other.meetingServiceId,
        status: "dispatched",
        lastError: null,
      });
      return {
        imported,
        dispatched: false,
        skipped: true,
        reason: "bot_already_on_meet",
      };
    }
  }

  // CRM schedule already owns dispatch for contact meetings. Calendar push
  // must not forceReschedule (that stops + re-creates → Vexa 409 / bot drop).
  if (capture.meetingServiceId) {
    await upsertCalendarMeetCapture({
      organizationId,
      userId,
      googleEventId: event.id,
      meetingServiceId: capture.meetingServiceId,
      activityId,
      contactId,
      status: "dispatched",
      lastError: null,
    });
    return {
      imported,
      dispatched: false,
      skipped: true,
      reason: "already_dispatched",
    };
  }

  if (activityId && contactId) {
    await ensureAssistSessionForMeeting({
      activityId,
      contactId,
      organizationId,
      hostUserId: userId,
      provider: "google_meet",
      joinUrl: meetUrl,
    });
    const assist = await prisma.meetingAssistSession.findUnique({
      where: { activityId },
      select: { meta: true },
    });
    const existingCap = readCaptureBotMeta(assist?.meta);
    if (
      existingCap?.botId &&
      (existingCap.provider === "vexa" || !existingCap.provider) &&
      (existingCap.status === "scheduled" ||
        existingCap.status === "joined" ||
        existingCap.status === "done")
    ) {
      await upsertCalendarMeetCapture({
        organizationId,
        userId,
        googleEventId: event.id,
        meetingServiceId: existingCap.botId,
        activityId,
        contactId,
        status: "dispatched",
        lastError: null,
      });
      return {
        imported,
        dispatched: false,
        skipped: true,
        reason: "crm_already_dispatched",
      };
    }
    const sent = await dispatchMeetingCaptureBot({
      activityId,
      forceReschedule: false,
      userId,
      organizationId,
      consentCaptured: true,
    });
    if (!sent.ok) {
      await upsertCalendarMeetCapture({
        organizationId,
        userId,
        googleEventId: event.id,
        status: sent.skipped ? "dispatched" : "failed",
        lastError: sent.error,
      });
      return {
        imported,
        dispatched: false,
        skipped: Boolean(sent.skipped),
        reason: sent.error,
      };
    }
    await upsertCalendarMeetCapture({
      organizationId,
      userId,
      googleEventId: event.id,
      meetingServiceId: sent.botId,
      activityId,
      contactId,
      status: "dispatched",
      lastError: null,
    });
    return { imported, dispatched: true, skipped: false };
  }

  const hostSent = await dispatchHostOwnedCapture({
    captureId: capture.id,
    organizationId,
    userId,
    meetUrl,
    dueAt,
  });
  await upsertCalendarMeetCapture({
    organizationId,
    userId,
    googleEventId: event.id,
    meetingServiceId: hostSent.meetingServiceId ?? capture.meetingServiceId,
    status: hostSent.ok ? "dispatched" : "failed",
    lastError: hostSent.ok ? null : hostSent.error || "dispatch failed",
  });
  return {
    imported,
    dispatched: Boolean(hostSent.ok),
    skipped: !hostSent.ok,
    reason: hostSent.ok ? undefined : hostSent.error,
  };
}

export async function syncGoogleCalendarPushForUser(
  userId: string,
): Promise<{ imported: number; dispatched: number; skipped: number; error?: string }> {
  return serializeUserSync(userId, async () => {
    const setupUser = await getSetupUserById(userId);
    const organizationId = setupUser?.organization_id?.trim() || null;
    if (!organizationId) {
      return { imported: 0, dispatched: 0, skipped: 0, error: "no_org" };
    }
    const conn = await getCalendarConnection(userId, "google");
    if (!conn?.accessToken || !googleHasCalendarScope(conn.scope || "")) {
      return { imported: 0, dispatched: 0, skipped: 0, error: "no_calendar" };
    }
    let accessToken: string | null;
    try {
      accessToken = await getValidGoogleAccessToken(userId);
    } catch (err) {
      return {
        imported: 0,
        dispatched: 0,
        skipped: 0,
        error: err instanceof Error ? err.message : "token_failed",
      };
    }
    if (!accessToken) {
      return { imported: 0, dispatched: 0, skipped: 0, error: "no_token" };
    }

    const watch = await findGoogleCalendarWatchByUserId(userId);
    const now = Date.now();
    const timeMin = new Date(now - 2 * 60 * 60_000).toISOString();
    const timeMax = new Date(now + 30 * 24 * 60 * 60_000).toISOString();

    let page = await listGoogleCalendarEventChanges({
      accessToken,
      syncToken: watch?.syncToken,
      timeMin,
      timeMax,
    });
    if (page.resetRequired) {
      await updateGoogleCalendarWatchSyncToken(userId, null);
      page = await listGoogleCalendarEventChanges({
        accessToken,
        timeMin,
        timeMax,
      });
    }

    let imported = 0;
    let dispatched = 0;
    let skipped = 0;
    const organizerEmail = (conn.accountEmail || "").trim().toLowerCase();
    for (const event of page.events) {
      const result = await ingestGoogleCalendarMeetEvent({
        userId,
        organizationId,
        organizerEmail,
        event,
      });
      if (result.imported) imported += 1;
      if (result.dispatched) dispatched += 1;
      if (result.skipped) skipped += 1;
    }
    if (page.nextSyncToken && watch) {
      await updateGoogleCalendarWatchSyncToken(userId, page.nextSyncToken);
    }
    return { imported, dispatched, skipped };
  });
}

export async function handleGoogleCalendarPushHeaders(input: {
  channelId: string | undefined;
  channelToken: string | undefined;
  resourceState: string | undefined;
  messageNumber?: string | undefined;
  resourceId?: string | undefined;
}): Promise<{ ok: boolean; detail: string }> {
  const channelId = input.channelId?.trim();
  if (!channelId) {
    logCalendarPush("reject", { reason: "missing_channel_id" });
    return { ok: false, detail: "missing channel id" };
  }
  const watch = await findGoogleCalendarWatchByChannelId(channelId);
  if (!watch) {
    logCalendarPush("reject", {
      reason: "unknown_channel",
      channelId,
      resourceState: input.resourceState || null,
    });
    return { ok: false, detail: "unknown channel" };
  }
  if (
    input.channelToken &&
    watch.channelToken &&
    input.channelToken !== watch.channelToken
  ) {
    logCalendarPush("reject", {
      reason: "token_mismatch",
      channelId,
      userId: watch.userId,
    });
    return { ok: false, detail: "token mismatch" };
  }
  const state = (input.resourceState || "").toLowerCase();
  if (state === "sync") {
    logCalendarPush("sync_ack", {
      channelId,
      userId: watch.userId,
      messageNumber: input.messageNumber || null,
    });
    return { ok: true, detail: "sync ack" };
  }
  logCalendarPush("incremental_sync_start", {
    channelId,
    userId: watch.userId,
    resourceState: state || null,
    messageNumber: input.messageNumber || null,
    resourceId: input.resourceId || null,
  });
  const result = await syncGoogleCalendarPushForUser(watch.userId);
  const detail = result.error
    ? result.error
    : `imported=${result.imported} dispatched=${result.dispatched} skipped=${result.skipped}`;
  logCalendarPush(result.error ? "incremental_sync_failed" : "incremental_sync_done", {
    channelId,
    userId: watch.userId,
    imported: result.imported,
    dispatched: result.dispatched,
    skipped: result.skipped,
    error: result.error || null,
    detail,
  });
  return {
    ok: !result.error,
    detail,
  };
}

export async function registerGoogleCalendarWatchForUser(
  userId: string,
): Promise<{ ok: boolean; detail: string }> {
  const address = calendarPushWebhookUrl();
  if (!address) {
    return {
      ok: false,
      detail:
        "Set CALENDAR_PUSH_WEBHOOK_URL or a public HTTPS CRM_API_PUBLIC_URL (ngrok).",
    };
  }
  const verify = process.env.CALENDAR_PUSH_VERIFICATION_TOKEN?.trim();
  const watchAddress = verify
    ? `${address}${address.includes("?") ? "&" : "?"}token=${encodeURIComponent(verify)}`
    : address;
  const setupUser = await getSetupUserById(userId);
  const organizationId = setupUser?.organization_id?.trim();
  if (!organizationId) return { ok: false, detail: "Organization not found" };

  const conn = await getCalendarConnection(userId, "google");
  if (!conn || !googleHasCalendarScope(conn.scope || "")) {
    return { ok: false, detail: "Google calendar scope missing" };
  }
  let accessToken: string | null;
  try {
    accessToken = await getValidGoogleAccessToken(userId);
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "token failed",
    };
  }
  if (!accessToken) return { ok: false, detail: "No Google access token" };

  const existing = await findGoogleCalendarWatchByUserId(userId);
  if (existing?.channelId && existing.resourceId) {
    await stopGoogleCalendarWatch({
      accessToken,
      channelId: existing.channelId,
      resourceId: existing.resourceId,
    }).catch(() => undefined);
  }

  const channelId = randomUUID();
  const channelToken = randomUUID();
  const expirationMs = Date.now() + 6 * 24 * 60 * 60_000;
  const watched = await watchGoogleCalendarEvents({
    accessToken,
    channelId,
    address: watchAddress,
    token: channelToken,
    expirationMs,
  });
  await upsertGoogleCalendarWatch({
    organizationId,
    userId,
    channelId: watched.channelId,
    resourceId: watched.resourceId,
    channelToken,
    syncToken: existing?.syncToken ?? null,
    expiration: watched.expiration,
  });
  await syncGoogleCalendarPushForUser(userId).catch((err) =>
    console.error(CALENDAR_PUSH_LOG, "initial_sync_failed", { userId, err }),
  );
  logCalendarPush("watch_registered", {
    userId,
    organizationId,
    channelId: watched.channelId,
    webhook: redactCalendarPushWebhookUrl(watchAddress),
    expires: watched.expiration?.toISOString() || null,
  });
  return {
    ok: true,
    detail: `watch until ${watched.expiration?.toISOString() || "unknown"}`,
  };
}

export async function bootstrapGoogleCalendarWatches(): Promise<{
  registered: number;
  skipped: number;
  errors: string[];
}> {
  if (!isCalendarPushConfigured()) {
    return {
      registered: 0,
      skipped: 0,
      errors: ["CALENDAR_PUSH_WEBHOOK_URL / public API URL not set"],
    };
  }
  let registered = 0;
  let skipped = 0;
  const errors: string[] = [];
  const userIds: string[] = [];
  const rows = await prisma.userIntegrationConnection.findMany({
    where: { provider: "google" },
    select: { userId: true, scope: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 400,
  });
  const seen = new Set<string>();
  for (const row of rows) {
    if (!googleHasCalendarScope(row.scope)) continue;
    const id = row.userId.toString();
    if (seen.has(id)) continue;
    seen.add(id);
    userIds.push(id);
    if (userIds.length >= 100) break;
  }
  for (const userId of userIds) {
    try {
      const res = await registerGoogleCalendarWatchForUser(userId);
      if (res.ok) registered += 1;
      else {
        skipped += 1;
        errors.push(`user ${userId}: ${res.detail}`);
      }
    } catch (err) {
      skipped += 1;
      errors.push(
        `user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { registered, skipped, errors };
}

export async function renewExpiringGoogleCalendarWatches(): Promise<{
  renewed: number;
  errors: string[];
}> {
  if (!isCalendarPushConfigured()) return { renewed: 0, errors: [] };
  const expiring = await listGoogleCalendarWatchesExpiringSoon();
  let renewed = 0;
  const errors: string[] = [];
  for (const row of expiring) {
    try {
      const res = await registerGoogleCalendarWatchForUser(row.userId);
      if (res.ok) renewed += 1;
      else errors.push(`user ${row.userId}: ${res.detail}`);
    } catch (err) {
      errors.push(
        `user ${row.userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { renewed, errors };
}
