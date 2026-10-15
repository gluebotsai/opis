import type { AppointmentSource, MeetingAssistProvider } from "@prisma/client";
import {
  cancelAppointment,
  createAppointment,
  findLiveAppointmentById,
  findLiveAppointmentForContact,
  isAppointmentExistsError,
  isAppointmentsTableReady,
  linkAppointmentActivity,
  updateAppointmentSchedule,
  type AppointmentView,
} from "@/dao/appointments/appointment-store";
import {
  createContactActivity,
  findUpcomingMeetingForContact,
  type UpcomingMeetingRow,
  updateContactMeetingSchedule,
} from "@/dao/contacts/contact-activity-service";
import { getContact, updateContact } from "@/dao/contacts/contact-service";
import { prisma } from "@/dao/db/prisma";
import { emitCrmPlatformEvent } from "@/lib/crm-platform-events";
import {
  buildSlimMeetingActivityBody,
  normalizeEmailList,
} from "@/lib/meeting-body";
import type { MeetingProvider } from "@/lib/meeting-provider";
import { formatMeetingWhenLabel } from "@/service/calendar/meeting-mail";
import {
  cancelGoogleMeetingForUser,
  rescheduleOrCreateGoogleMeetingForUser,
  scheduleGoogleMeetingForUser,
} from "@/service/calendar/schedule-google";
import {
  toLocalDateTimeString,
} from "@/service/ai/demo-booking";
import { ensureAssistSessionForMeeting } from "@/service/ai/meeting-assist";
import { dispatchMeetingCaptureBot, cancelStaleMeetingCaptureBots } from "@/service/transcripts/meeting-capture";
import { sendMeetingBriefToOwner } from "@/service/ai/meeting-brief";
import { enqueueLeadScoring } from "@/service/ai/lead-scoring-job";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import { notifyAdminsOfLeadEventAsync } from "@/dao/notifications/notify-admins";
import {
  findAvailableSlotsForDay,
  resolveHostAtSlot,
  type AvailableDaySlot,
} from "@/service/appointments/resolve-host-at-slot";

export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;

export type CheckAvailabilityResult =
  | { available: true; hostUserId: string }
  | {
      available: false;
      reason: string;
      availableSlots?: AvailableDaySlot[];
    };

export type CreateAppointmentResult =
  | { ok: true; appointment: AppointmentView; activityId: string }
  | {
      ok: false;
      code:
        | "appointment_exists"
        | "no_slots_available"
        | "contact_not_found"
        | "no_contact_email"
        | "past_time"
        | "calendar_error";
      error: string;
      needsConnect?: boolean;
    };

export type RescheduleAppointmentResult =
  | { ok: true; appointment: AppointmentView; activityId: string | null }
  | {
      ok: false;
      code: "not_found" | "past_time" | "calendar_error";
      error: string;
      needsConnect?: boolean;
    };

export type CancelAppointmentResult =
  | { ok: true; appointment: AppointmentView }
  | {
      ok: false;
      code: "not_found" | "calendar_error";
      error: string;
      needsConnect?: boolean;
    };

function endsAtFromStart(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60_000);
}

function meetingProviderToAssist(
  provider: MeetingProvider,
): MeetingAssistProvider {
  if (provider === "zoom") return "zoom";
  if (provider === "teams") return "teams";
  return "google_meet";
}

function emitAppointmentEvent(
  type:
    | "appointment.scheduled"
    | "appointment.rescheduled"
    | "appointment.canceled"
    | "appointment.completed",
  appointment: AppointmentView,
): void {
  emitCrmPlatformEvent({
    type,
    organizationId: appointment.organizationId,
    cdpId: appointment.contactId,
    entityType: "appointment",
    entityId: appointment.id,
    payload: {
      cdpId: appointment.contactId,
      appointmentId: appointment.id,
      hostUserId: appointment.hostUserId,
      startsAt: appointment.startsAt,
      status: appointment.status,
      source: appointment.source,
    },
  });
}

async function assignContactOwnerIfUnowned(
  contactId: string,
  hostUserId: string,
): Promise<void> {
  const contact = await getContact(contactId);
  if (!contact) return;
  const ownerId =
    contact.crm.ownerUserId ?? contact.person.ownerUserId ?? null;
  if (ownerId) return;
  try {
    await updateContact(contactId, { ownerUserId: hostUserId });
  } catch (err) {
    console.error("appointment: set owner failed", contactId, err);
  }
}

async function runNewBookingSideEffects(args: {
  appointment: AppointmentView;
  activityId: string;
  contactDisplayName: string;
  companyName: string | null;
  ownerUserId: string | null;
  actorUserId: string | null;
  hostUserId: string;
  organizationId: string;
  contactId: string;
  meetingProvider: MeetingProvider;
  meetingLink: string | null;
  externalMeetingId: string | null;
  source: AppointmentSource;
  skipAdminNotify?: boolean;
}): Promise<void> {
  if (!args.skipAdminNotify) {
    notifyAdminsOfLeadEventAsync({
      kind: "lead_activity",
      contactId: args.contactId,
      contactName: args.contactDisplayName,
      companyName: args.companyName,
      ownerUserId: args.ownerUserId,
      actorUserId: args.actorUserId,
      activityType: "meeting",
      activitySubject: args.appointment.title,
      href: `/contact/${args.contactId}`,
    });
  }

  void (async () => {
    await cancelStaleMeetingCaptureBots(args.contactId, args.activityId);
    await ensureAssistSessionForMeeting({
      activityId: args.activityId,
      contactId: args.contactId,
      organizationId: args.organizationId,
      hostUserId: args.hostUserId,
      provider: meetingProviderToAssist(args.meetingProvider),
      externalMeetingId: args.externalMeetingId,
      joinUrl: args.meetingLink,
    });
    const capture = await dispatchMeetingCaptureBot({
      activityId: args.activityId,
      forceReschedule: false,
      userId: args.hostUserId,
      organizationId: args.organizationId,
      consentCaptured: true,
    });
    if (!capture.ok && !capture.skipped) {
      console.error("appointment capture bot dispatch failed", capture.error);
    }
  })();

  void sendMeetingBriefToOwner({
    activityId: args.activityId,
    contactId: args.contactId,
    organizationId: args.organizationId,
    senderUserId: args.hostUserId,
  }).catch((err) => {
    console.error("appointment brief to owner failed", err);
  });

  void enqueueLeadScoring({
    contactId: args.contactId,
    organizationId: args.organizationId,
    triggerReason: "activity:meeting",
    processImmediately: true,
  }).catch((err) => {
    console.error("appointment scoring enqueue failed", err);
  });

  triggerLeadLifecycle({
    contactId: args.contactId,
    organizationId: args.organizationId,
    triggerReason: "activity:meeting",
  });

  if (args.source !== "crm_ui") {
    void assignContactOwnerIfUnowned(args.contactId, args.hostUserId);
  }
}

async function mirrorMeetingActivity(args: {
  contactId: string;
  organizationId: string;
  hostUserId: string;
  title: string;
  whenLabel: string;
  startsAt: Date;
  meetingLink: string | null;
  meetingProvider: MeetingProvider;
  calendarEventId: string | null;
  createdByUserId?: string | null;
  existingActivityId?: string | null;
}): Promise<{ id: string }> {
  const body = buildSlimMeetingActivityBody({
    whenLabel: args.whenLabel,
    meetingLink: args.meetingLink,
    provider: args.meetingProvider,
  });
  const providerMessageId = args.calendarEventId
    ? `gcal:${args.calendarEventId}`
    : undefined;

  if (args.existingActivityId) {
    const updated = await updateContactMeetingSchedule(args.existingActivityId, {
      dueAt: args.startsAt,
      body,
      subject: args.title,
      providerMessageId,
    });
    return { id: updated.id };
  }

  const created = await createContactActivity(args.contactId, {
    type: "meeting",
    subject: args.title,
    body,
    dueAt: args.startsAt,
    folder: "inbox",
    createdByUserId: args.createdByUserId ?? args.hostUserId,
    organizationId: args.organizationId,
    providerMessageId,
  });
  return { id: created.id };
}

async function scheduleGoogleCalendar(args: {
  hostUserId: string;
  title: string;
  description: string;
  startsAt: Date;
  timezone: string;
  durationMinutes: number;
  guestEmails: string[];
  existingEventId?: string | null;
  includeGoogleMeet?: boolean;
  externalMeetingLink?: string | null;
}): Promise<
  | {
      ok: true;
      meetLink: string | null;
      calendarEventId: string | null;
    }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  const startLocal = toLocalDateTimeString(args.startsAt, args.timezone);
  const calendarResult =
    args.existingEventId
      ? await rescheduleOrCreateGoogleMeetingForUser({
          userId: args.hostUserId,
          eventId: args.existingEventId,
          summary: args.title,
          description: args.description,
          startDateTime: startLocal,
          timeZone: args.timezone,
          durationMinutes: args.durationMinutes,
          attendeeEmails: args.guestEmails,
          includeGoogleMeet: args.includeGoogleMeet ?? true,
          externalMeetingLink: args.externalMeetingLink,
        })
      : await scheduleGoogleMeetingForUser({
          userId: args.hostUserId,
          summary: args.title,
          description: args.description,
          startDateTime: startLocal,
          timeZone: args.timezone,
          durationMinutes: args.durationMinutes,
          attendeeEmails: args.guestEmails,
          includeGoogleMeet: args.includeGoogleMeet ?? true,
          externalMeetingLink: args.externalMeetingLink,
        });

  if (!calendarResult.ok) {
    return calendarResult;
  }

  return {
    ok: true,
    meetLink: calendarResult.meeting.meetLink ?? args.externalMeetingLink ?? null,
    calendarEventId: calendarResult.meeting.eventId || args.existingEventId || null,
  };
}

export async function checkAppointmentAvailability(input: {
  organizationId: string;
  contactId: string;
  startsAt: Date;
  timezone: string;
  durationMinutes?: number;
}): Promise<CheckAvailabilityResult> {
  const duration = input.durationMinutes ?? DEFAULT_APPOINTMENT_DURATION_MINUTES;
  const endsAt = endsAtFromStart(input.startsAt, duration);
  const resolved = await resolveHostAtSlot({
    organizationId: input.organizationId,
    contactId: input.contactId,
    startsAt: input.startsAt,
    endsAt,
  });
  if (!resolved.available) {
    const result: CheckAvailabilityResult = {
      available: false,
      reason: resolved.reason,
    };
    if (resolved.reason === "no_slots_available") {
      const availableSlots = await findAvailableSlotsForDay({
        organizationId: input.organizationId,
        contactId: input.contactId,
        day: input.startsAt,
        timezone: input.timezone,
        durationMinutes: duration,
      });
      if (availableSlots.length > 0) {
        return { ...result, availableSlots };
      }
    }
    return result;
  }
  return { available: true, hostUserId: resolved.hostUserId };
}

export async function createAppointmentBooking(input: {
  organizationId: string;
  contactId: string;
  title: string;
  startsAt: Date;
  timezone: string;
  durationMinutes?: number;
  source: AppointmentSource;
  guestEmails?: string[];
  hostUserId?: string;
  assignmentReason?: string | null;
  createdByUserId?: string | null;
  meetingProvider?: MeetingProvider;
  /** Pre-scheduled calendar fields (CRM UI path with zoom/teams). */
  calendarSnapshot?: {
    joinUrl?: string | null;
    calendarEventId?: string | null;
    skipGoogleSchedule?: boolean;
  };
  skipSideEffects?: boolean;
}): Promise<CreateAppointmentResult> {
  const duration = input.durationMinutes ?? DEFAULT_APPOINTMENT_DURATION_MINUTES;
  const endsAt = endsAtFromStart(input.startsAt, duration);
  const timeZone = input.timezone.trim() || "UTC";
  const meetingProvider = input.meetingProvider ?? "google_meet";

  if (input.startsAt.getTime() < Date.now() - 60_000) {
    return { ok: false, code: "past_time", error: "Pick a time in the future." };
  }

  const contact = await getContact(input.contactId);
  if (!contact) {
    return { ok: false, code: "contact_not_found", error: "Contact not found." };
  }
  const contactOrg = contact.person.organizationId?.trim();
  if (contactOrg && contactOrg !== input.organizationId.trim()) {
    return { ok: false, code: "contact_not_found", error: "Contact not found." };
  }

  const contactEmail = contact.person.email?.trim();
  if (!contactEmail) {
    return {
      ok: false,
      code: "no_contact_email",
      error: "Contact needs an email to send the invite.",
    };
  }

  const live = await findLiveAppointmentForContact(
    input.organizationId,
    input.contactId,
  );
  if (live) {
    return {
      ok: false,
      code: "appointment_exists",
      error: "Contact already has a live appointment.",
    };
  }

  let hostUserId = input.hostUserId?.trim() || null;
  let assignmentReason = input.assignmentReason ?? null;
  if (!hostUserId) {
    const resolved = await resolveHostAtSlot({
      organizationId: input.organizationId,
      contactId: input.contactId,
      startsAt: input.startsAt,
      endsAt,
    });
    if (!resolved.available) {
      return {
        ok: false,
        code: "no_slots_available",
        error: "No available sales rep for that time.",
      };
    }
    hostUserId = resolved.hostUserId;
    assignmentReason = resolved.assignmentReason;
  }

  const guestEmails = normalizeEmailList([
    contactEmail,
    ...(input.guestEmails ?? []),
  ]);

  let meetLink = input.calendarSnapshot?.joinUrl ?? null;
  let calendarEventId = input.calendarSnapshot?.calendarEventId ?? null;

  const shouldScheduleGoogle =
    !input.calendarSnapshot?.skipGoogleSchedule &&
    (meetingProvider === "google_meet" || !input.calendarSnapshot);

  if (shouldScheduleGoogle) {
    const calendar = await scheduleGoogleCalendar({
      hostUserId,
      title: input.title.trim(),
      description: `Worktual CRM meeting with ${contact.displayName} (${contactEmail})`,
      startsAt: input.startsAt,
      timezone: timeZone,
      durationMinutes: duration,
      guestEmails,
      includeGoogleMeet: meetingProvider === "google_meet",
      externalMeetingLink: meetLink,
    });
    if (!calendar.ok) {
      return {
        ok: false,
        code: "calendar_error",
        error: calendar.error,
        needsConnect: calendar.needsConnect,
      };
    }
    meetLink = calendar.meetLink;
    calendarEventId = calendar.calendarEventId;
  }

  const whenLabel = formatMeetingWhenLabel(input.startsAt, timeZone, duration);

  let appointment: AppointmentView;
  try {
    appointment = await createAppointment({
      organizationId: input.organizationId,
      contactId: input.contactId,
      hostUserId,
      source: input.source,
      title: input.title.trim(),
      startsAt: input.startsAt,
      endsAt,
      timezone: timeZone,
      provider: meetingProviderToAssist(meetingProvider),
      joinUrl: meetLink,
      calendarEventId,
      guestEmails,
      assignmentReason,
    });
  } catch (err) {
    if (isAppointmentExistsError(err)) {
      return {
        ok: false,
        code: "appointment_exists",
        error: "Contact already has a live appointment.",
      };
    }
    throw err;
  }

  const activity = await mirrorMeetingActivity({
    contactId: input.contactId,
    organizationId: input.organizationId,
    hostUserId,
    title: input.title.trim(),
    whenLabel,
    startsAt: input.startsAt,
    meetingLink: meetLink,
    meetingProvider,
    calendarEventId,
    createdByUserId: input.createdByUserId,
  });

  appointment = await linkAppointmentActivity(appointment.id, activity.id);
  emitAppointmentEvent("appointment.scheduled", appointment);

  if (!input.skipSideEffects) {
    await runNewBookingSideEffects({
      appointment,
      activityId: activity.id,
      contactDisplayName: contact.displayName,
      companyName: contact.person.company?.name ?? null,
      ownerUserId: contact.crm.ownerUserId ?? contact.person.ownerUserId ?? null,
      actorUserId: input.createdByUserId ?? hostUserId,
      hostUserId,
      organizationId: input.organizationId,
      contactId: input.contactId,
      meetingProvider,
      meetingLink: meetLink,
      externalMeetingId: calendarEventId,
      source: input.source,
      skipAdminNotify: input.source === "demo_agent",
    });
  }

  return { ok: true, appointment, activityId: activity.id };
}

export async function rescheduleAppointmentBooking(input: {
  organizationId: string;
  appointmentId: string;
  startsAt: Date;
  timezone: string;
  title?: string;
  durationMinutes?: number;
  forceRescheduleSideEffects?: boolean;
}): Promise<RescheduleAppointmentResult> {
  const live = await findLiveAppointmentById(
    input.organizationId,
    input.appointmentId,
  );
  if (!live) {
    return { ok: false, code: "not_found", error: "No live appointment found." };
  }

  if (input.startsAt.getTime() < Date.now() - 60_000) {
    return { ok: false, code: "past_time", error: "Pick a time in the future." };
  }

  const duration =
    input.durationMinutes ??
    Math.max(
      1,
      Math.round(
        (new Date(live.endsAt).getTime() - new Date(live.startsAt).getTime()) /
          60_000,
      ),
    );
  const endsAt = endsAtFromStart(input.startsAt, duration);
  const timeZone = input.timezone.trim() || live.timezone;
  const title = input.title?.trim() || live.title;

  const contact = await getContact(live.contactId);
  if (!contact) {
    return { ok: false, code: "not_found", error: "Contact not found." };
  }
  const contactEmail = contact.person.email?.trim();
  const guestEmails =
    live.guestEmails.length > 0
      ? live.guestEmails
      : contactEmail
        ? [contactEmail]
        : [];

  let meetLink = live.joinUrl;
  let calendarEventId = live.calendarEventId;

  if (live.provider === "google_meet" || live.calendarEventId) {
    const calendar = await scheduleGoogleCalendar({
      hostUserId: live.hostUserId,
      title,
      description: contactEmail
        ? `Worktual CRM meeting with ${contact.displayName} (${contactEmail})`
        : `Worktual CRM meeting with ${contact.displayName}`,
      startsAt: input.startsAt,
      timezone: timeZone,
      durationMinutes: duration,
      guestEmails,
      existingEventId: live.calendarEventId,
      includeGoogleMeet: live.provider === "google_meet",
      externalMeetingLink: live.provider !== "google_meet" ? live.joinUrl : null,
    });
    if (!calendar.ok) {
      return {
        ok: false,
        code: "calendar_error",
        error: calendar.error,
        needsConnect: calendar.needsConnect,
      };
    }
    meetLink = calendar.meetLink;
    calendarEventId = calendar.calendarEventId;
  }

  const whenLabel = formatMeetingWhenLabel(input.startsAt, timeZone, duration);
  const meetingProvider: MeetingProvider =
    live.provider === "zoom"
      ? "zoom"
      : live.provider === "teams"
        ? "teams"
        : "google_meet";

  const appointment = await updateAppointmentSchedule(live.id, {
    title,
    startsAt: input.startsAt,
    endsAt,
    timezone: timeZone,
    joinUrl: meetLink,
    calendarEventId,
    guestEmails,
  });

  let activityId = live.activityId;
  if (live.activityId) {
    const activity = await mirrorMeetingActivity({
      contactId: live.contactId,
      organizationId: input.organizationId,
      hostUserId: live.hostUserId,
      title,
      whenLabel,
      startsAt: input.startsAt,
      meetingLink: meetLink,
      meetingProvider,
      calendarEventId,
      existingActivityId: live.activityId,
    });
    activityId = activity.id;
  }

  emitAppointmentEvent("appointment.rescheduled", appointment);

  if (input.forceRescheduleSideEffects && activityId) {
    void (async () => {
      await cancelStaleMeetingCaptureBots(live.contactId, activityId!);
      await ensureAssistSessionForMeeting({
        activityId: activityId!,
        contactId: live.contactId,
        organizationId: input.organizationId,
        hostUserId: live.hostUserId,
        provider: live.provider,
        externalMeetingId: calendarEventId,
        joinUrl: meetLink,
      });
      await dispatchMeetingCaptureBot({
        activityId: activityId!,
        forceReschedule: true,
        userId: live.hostUserId,
        organizationId: input.organizationId,
        consentCaptured: true,
      });
    })();
  }

  return { ok: true, appointment, activityId };
}

export async function cancelAppointmentBooking(input: {
  organizationId: string;
  appointmentId: string;
}): Promise<CancelAppointmentResult> {
  const live = await findLiveAppointmentById(
    input.organizationId,
    input.appointmentId,
  );
  if (!live) {
    return { ok: false, code: "not_found", error: "No live appointment found." };
  }

  if (live.calendarEventId) {
    const canceled = await cancelGoogleMeetingForUser({
      userId: live.hostUserId,
      eventId: live.calendarEventId,
    });
    if (!canceled.ok) {
      return {
        ok: false,
        code: "calendar_error",
        error: canceled.error,
        needsConnect: canceled.needsConnect,
      };
    }
  }

  const appointment = await cancelAppointment(live.id);

  if (live.activityId) {
    await prisma.contactActivity.update({
      where: { id: live.activityId },
      data: { completedAt: new Date() },
    });
  }

  emitAppointmentEvent("appointment.canceled", appointment);
  return { ok: true, appointment };
}

/** CRM UI / demo path: upsert appointment row linked to a meeting activity. */
export async function syncAppointmentForMeetingActivity(input: {
  organizationId: string;
  contactId: string;
  hostUserId: string;
  activityId: string;
  source: AppointmentSource;
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  provider: MeetingAssistProvider;
  joinUrl?: string | null;
  calendarEventId?: string | null;
  guestEmails?: string[];
  assignmentReason?: string | null;
  isReschedule?: boolean;
}): Promise<AppointmentView | null> {
  if (!(await isAppointmentsTableReady())) {
    console.warn(
      "crm.appointments not migrated — skipping appointment sync for activity",
      input.activityId,
    );
    return null;
  }

  const live = await findLiveAppointmentForContact(
    input.organizationId,
    input.contactId,
  );

  if (live && input.isReschedule) {
    const updated = await updateAppointmentSchedule(live.id, {
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      joinUrl: input.joinUrl ?? null,
      calendarEventId: input.calendarEventId ?? null,
      guestEmails: input.guestEmails ?? [],
    });
    if (updated.activityId !== input.activityId) {
      return linkAppointmentActivity(live.id, input.activityId);
    }
    emitAppointmentEvent("appointment.rescheduled", updated);
    return updated;
  }

  if (live) return live;

  try {
    const created = await createAppointment({
      organizationId: input.organizationId,
      contactId: input.contactId,
      hostUserId: input.hostUserId,
      activityId: input.activityId,
      source: input.source,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      provider: input.provider,
      joinUrl: input.joinUrl ?? null,
      calendarEventId: input.calendarEventId ?? null,
      guestEmails: input.guestEmails ?? [],
      assignmentReason: input.assignmentReason ?? null,
    });
    emitAppointmentEvent("appointment.scheduled", created);
    return created;
  } catch (err) {
    if (isAppointmentExistsError(err)) {
      const existing = await findLiveAppointmentForContact(
        input.organizationId,
        input.contactId,
      );
      if (existing) return existing;
    }
    throw err;
  }
}

export async function findLiveAppointmentForContactApi(
  organizationId: string,
  contactId: string,
): Promise<AppointmentView | null> {
  return findLiveAppointmentForContact(organizationId, contactId);
}

/** Prefer appointments SoR; fall back to legacy meeting activities until backfill. */
export async function resolveUpcomingMeetingForContact(
  organizationId: string,
  contactId: string,
): Promise<UpcomingMeetingRow | null> {
  const live = await findLiveAppointmentForContact(organizationId, contactId);
  if (live?.activityId) {
    const row = await prisma.contactActivity.findFirst({
      where: {
        id: live.activityId,
        contactId,
        type: "meeting",
        completedAt: null,
      },
      select: {
        id: true,
        contactId: true,
        subject: true,
        body: true,
        dueAt: true,
        createdByUserId: true,
        providerMessageId: true,
      },
    });
    if (row) {
      return {
        ...row,
        createdByUserId:
          row.createdByUserId != null ? String(row.createdByUserId) : null,
        providerMessageId:
          row.providerMessageId ??
          (live.calendarEventId ? `gcal:${live.calendarEventId}` : null),
      };
    }
  }
  return findUpcomingMeetingForContact(contactId);
}
