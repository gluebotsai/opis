import {
  createGoogleCalendarMeeting,
  updateGoogleCalendarMeetingTime,
  type CreatedGoogleMeeting,
} from "@/service/google/calendar";
import {
  getValidGoogleAccessToken,
  isGoogleConfigured,
} from "@/service/google/access-token";

export async function scheduleGoogleMeetingForUser(args: {
  userId: string;
  summary: string;
  description?: string;
  /** datetime-local style start, e.g. 2026-07-16T10:13 */
  startDateTime: string;
  timeZone: string;
  durationMinutes?: number;
  attendeeEmails?: string[];
  includeGoogleMeet?: boolean;
  externalMeetingLink?: string | null;
}): Promise<
  | { ok: true; meeting: CreatedGoogleMeeting }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  if (!isGoogleConfigured()) {
    return {
      ok: false,
      error:
        "Google Calendar is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    };
  }

  let accessToken: string | null;
  try {
    accessToken = await getValidGoogleAccessToken(args.userId);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to refresh Google access token.",
      needsConnect: true,
    };
  }

  if (!accessToken) {
    return {
      ok: false,
      error: "Connect Google Calendar to create a Meet invite.",
      needsConnect: true,
    };
  }

  try {
    const meeting = await createGoogleCalendarMeeting({
      accessToken,
      summary: args.summary,
      description: args.description,
      startDateTime: args.startDateTime,
      timeZone: args.timeZone,
      durationMinutes: args.durationMinutes,
      attendeeEmails: args.attendeeEmails,
      includeGoogleMeet: args.includeGoogleMeet,
      externalMeetingLink: args.externalMeetingLink,
    });
    return { ok: true, meeting };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to create Google Calendar event.",
    };
  }
}

/** True when Google Calendar PATCH returned 404 / notFound for a stale event id. */
export function isGoogleCalendarEventNotFound(error: string): boolean {
  if (!error.includes("Google Calendar reschedule failed")) return false;
  return (
    /\bnotFound\b/i.test(error) ||
    /"code"\s*:\s*404\b/.test(error) ||
    /"reason"\s*:\s*"notFound"/i.test(error)
  );
}

type GoogleMeetingScheduleArgs = {
  userId: string;
  summary: string;
  description?: string;
  startDateTime: string;
  timeZone: string;
  durationMinutes?: number;
  attendeeEmails?: string[];
  includeGoogleMeet?: boolean;
  externalMeetingLink?: string | null;
};

/**
 * PATCH an existing Google event when possible; create a fresh invite if the
 * stored event id was deleted or belongs to another calendar/account (404).
 */
export async function rescheduleOrCreateGoogleMeetingForUser(
  args: GoogleMeetingScheduleArgs & { eventId: string },
): Promise<
  | { ok: true; meeting: CreatedGoogleMeeting; recreated: boolean }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  const rescheduled = await rescheduleGoogleMeetingForUser({
    userId: args.userId,
    eventId: args.eventId,
    summary: args.summary,
    description: args.description,
    startDateTime: args.startDateTime,
    timeZone: args.timeZone,
    durationMinutes: args.durationMinutes,
    attendeeEmails: args.attendeeEmails,
  });
  if (rescheduled.ok) {
    return { ...rescheduled, recreated: false };
  }
  if (!isGoogleCalendarEventNotFound(rescheduled.error)) {
    return rescheduled;
  }

  const created = await scheduleGoogleMeetingForUser({
    userId: args.userId,
    summary: args.summary,
    description: args.description,
    startDateTime: args.startDateTime,
    timeZone: args.timeZone,
    durationMinutes: args.durationMinutes,
    attendeeEmails: args.attendeeEmails,
    includeGoogleMeet: args.includeGoogleMeet,
    externalMeetingLink: args.externalMeetingLink,
  });
  if (!created.ok) return created;
  return { ok: true, meeting: created.meeting, recreated: true };
}

export async function rescheduleGoogleMeetingForUser(args: {
  userId: string;
  eventId: string;
  summary: string;
  description?: string;
  startDateTime: string;
  timeZone: string;
  durationMinutes?: number;
  attendeeEmails?: string[];
}): Promise<
  | { ok: true; meeting: CreatedGoogleMeeting }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  if (!isGoogleConfigured()) {
    return {
      ok: false,
      error:
        "Google Calendar is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    };
  }

  let accessToken: string | null;
  try {
    accessToken = await getValidGoogleAccessToken(args.userId);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to refresh Google access token.",
      needsConnect: true,
    };
  }

  if (!accessToken) {
    return {
      ok: false,
      error: "Connect Google Calendar to update a Meet invite.",
      needsConnect: true,
    };
  }

  try {
    const meeting = await updateGoogleCalendarMeetingTime({
      accessToken,
      eventId: args.eventId,
      summary: args.summary,
      description: args.description,
      startDateTime: args.startDateTime,
      timeZone: args.timeZone,
      durationMinutes: args.durationMinutes,
      attendeeEmails: args.attendeeEmails,
    });
    return { ok: true, meeting };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to reschedule Google Calendar event.",
    };
  }
}

export async function cancelGoogleMeetingForUser(args: {
  userId: string;
  eventId: string;
}): Promise<{ ok: true } | { ok: false; error: string; needsConnect?: boolean }> {
  if (!isGoogleConfigured()) {
    return {
      ok: false,
      error:
        "Google Calendar is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    };
  }

  let accessToken: string | null;
  try {
    accessToken = await getValidGoogleAccessToken(args.userId);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to refresh Google access token.",
      needsConnect: true,
    };
  }

  if (!accessToken) {
    return {
      ok: false,
      error: "Connect Google Calendar to cancel a calendar invite.",
      needsConnect: true,
    };
  }

  try {
    const { cancelGoogleCalendarEvent } = await import(
      "@/service/google/calendar"
    );
    await cancelGoogleCalendarEvent({
      accessToken,
      eventId: args.eventId,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to cancel Google Calendar event.",
    };
  }
}

export { isGoogleConfigured, isGoogleConfigured as isGoogleCalendarConfigured };
