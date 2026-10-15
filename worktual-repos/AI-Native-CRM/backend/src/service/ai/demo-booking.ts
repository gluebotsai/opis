/**
 * Demo booking helpers for the email auto-reply agent.
 *
 * Availability and Meet creation always use the mailbox recipient who received
 * the inbound mail — each CRM user keeps a separate Google Calendar connection.
 */

import { prisma } from "@/dao/db/prisma";
import { getContact, updateContact } from "@/dao/contacts/contact-service";
import {
  completeSupersededMeetings,
  createContactActivity,
} from "@/dao/contacts/contact-activity-service";
import {
  resolveUpcomingMeetingForContact,
  syncAppointmentForMeetingActivity,
} from "@/service/appointments/appointment-service";
import {
  rescheduleOrCreateGoogleMeetingForUser,
  scheduleGoogleMeetingForUser,
} from "@/service/calendar/schedule-google";
import {
  buildMeetingActivityBody,
  buildMeetingConfirmationEmail,
  formatMeetingWhenLabel,
} from "@/service/calendar/meeting-mail";
import {
  parseCalendarLinkFromMeetingBody,
  parseGcalProviderMessageId,
  parseGoogleEventIdFromMeetingBody,
  parseIcsSequenceFromMeetingBody,
  parseIcsUidFromMeetingBody,
  parseMeetingLinkFromBody,
  parseWhenLabelFromMeetingBody,
} from "@/lib/meeting-body";
import {
  getCalendarConnection,
} from "@/dao/calendar/token-repository";
import {
  getValidGoogleAccessToken,
  googleHasCalendarScope,
} from "@/service/google/access-token";
import { queryGoogleBusyPeriods } from "@/service/google/calendar";
import { notifyUsers } from "@/dao/notifications/notify-users";
import { resolveOrgBrand } from "@/lib/org-brand";
import { ensureAssistSessionForMeeting } from "@/service/ai/meeting-assist";
import { sendMeetingBriefToOwner } from "@/service/ai/meeting-brief";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import { enqueueLeadScoring } from "@/service/ai/lead-scoring-job";
import { dispatchMeetingCaptureBot, cancelStaleMeetingCaptureBots } from "@/service/transcripts/meeting-capture";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";

export const DEMO_TIMEZONE = "Asia/Kolkata";
export const DEMO_DURATION_MINUTES = 30;
/** Business hours in DEMO_TIMEZONE (inclusive start hour, exclusive end). */
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 18;

export type DemoPhase = "ask_slot" | "propose_alts" | "booked";

export type DemoState = {
  phase: DemoPhase;
  mailboxUserId: string;
  timezone: string;
  /** Inbox thread id — demo booking must not bleed across threads. */
  threadId?: string | null;
  requestedStartIso?: string | null;
  proposedSlots?: string[];
  meetingActivityId?: string | null;
  meetLink?: string | null;
  /** Set when this booking was an auto-approved reschedule (loyalty layer). */
  autoReschedule?: boolean;
};

export function isDemoCategory(category: string | null | undefined): boolean {
  const c = (category ?? "").trim().toLowerCase();
  return (
    c === "demo_ask_slot" ||
    c === "demo_check_slot" ||
    c === "demo_confirm_slot" ||
    c === "demo_reschedule"
  );
}

/**
 * LLM often invents categories like "demo_request". Map any demo-ish label
 * onto the three categories the CRM apply path understands.
 */
export function normalizeDemoCategory(
  category: string | null | undefined,
  opts: { hasDatetime: boolean },
): "demo_ask_slot" | "demo_check_slot" | "demo_confirm_slot" | null {
  const c = (category ?? "").trim().toLowerCase();
  if (!c) return null;
  if (c === "demo_confirm_slot") return "demo_confirm_slot";
  if (c === "demo_check_slot") return "demo_check_slot";
  if (c === "demo_ask_slot") return "demo_ask_slot";
  if (
    c.includes("demo") ||
    c.includes("walkthrough") ||
    c.includes("product_tour") ||
    c === "schedule_call" ||
    c === "schedule_meeting"
  ) {
    return opts.hasDatetime ? "demo_check_slot" : "demo_ask_slot";
  }
  return null;
}

export function parseDemoState(raw: unknown): DemoState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const phase = o.phase;
  const mailboxUserId =
    typeof o.mailboxUserId === "string" ? o.mailboxUserId : null;
  if (
    (phase !== "ask_slot" &&
      phase !== "propose_alts" &&
      phase !== "booked") ||
    !mailboxUserId
  ) {
    return null;
  }
  return {
    phase,
    mailboxUserId,
    timezone:
      typeof o.timezone === "string" && o.timezone.trim()
        ? o.timezone.trim()
        : DEMO_TIMEZONE,
    requestedStartIso:
      typeof o.requestedStartIso === "string" ? o.requestedStartIso : null,
    proposedSlots: Array.isArray(o.proposedSlots)
      ? o.proposedSlots.filter((s): s is string => typeof s === "string")
      : [],
    meetingActivityId:
      typeof o.meetingActivityId === "string" ? o.meetingActivityId : null,
    meetLink: typeof o.meetLink === "string" ? o.meetLink : null,
  };
}

/** Always the mailbox recipient — never another user's calendar. */
export function resolveDemoCalendarUser(
  mailboxUserId: string | null | undefined,
): string | null {
  const id = mailboxUserId?.trim();
  return id || null;
}

export async function mailboxHasGoogleCalendar(
  mailboxUserId: string,
): Promise<boolean> {
  const conn = await getCalendarConnection(mailboxUserId, "google");
  return Boolean(conn && googleHasCalendarScope(conn.scope));
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function wallClockParts(
  instant: Date,
  timeZone: string,
): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    h: get("hour"),
    mi: get("minute"),
  };
}

/** Local wall-clock `YYYY-MM-DDTHH:mm:ss` in `timeZone` for Google Calendar. */
export function toLocalDateTimeString(instant: Date, timeZone: string): string {
  const p = wallClockParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:00`;
}

/**
 * Build a Date for a wall-clock local time in `timeZone` (approx via offset probe).
 */
export function fromLocalDateTimeString(
  local: string,
  timeZone: string,
): Date {
  const m = local
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/,
    );
  if (!m) {
    const d = new Date(local);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid local datetime.");
    return d;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] ?? "0");
  // Probe UTC guess then correct for TZ offset at that instant.
  let utc = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 3; i++) {
    const parts = wallClockParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, 0);
    const wanted = Date.UTC(y, mo - 1, d, h, mi, s);
    utc += wanted - asUtc;
  }
  return new Date(utc);
}

export async function isSlotFree(args: {
  mailboxUserId: string;
  start: Date;
  end: Date;
}): Promise<boolean> {
  const accessToken = await getValidGoogleAccessToken(args.mailboxUserId);
  if (!accessToken) return false;
  const padStart = new Date(args.start.getTime() - 60_000);
  const padEnd = new Date(args.end.getTime() + 60_000);
  try {
    const busy = await queryGoogleBusyPeriods({
      accessToken,
      timeMin: padStart,
      timeMax: padEnd,
    });
    const s = args.start.getTime();
    const e = args.end.getTime();
    return !busy.some((b) => overlaps(s, e, b.start.getTime(), b.end.getTime()));
  } catch (err) {
    console.error("isSlotFree failed", args.mailboxUserId, err);
    // Fail open to booking attempt — Google create will still reject conflicts
    // when sendUpdates runs; better than stranding the lead with a vague reply.
    return true;
  }
}

/** Free booking starts on the same local calendar day as `day` (business hours). */
export async function findFreeSlotsOnDay(args: {
  mailboxUserId: string;
  day: Date;
  durationMinutes?: number;
  timeZone: string;
  limit?: number;
}): Promise<Date[]> {
  const duration = args.durationMinutes ?? DEMO_DURATION_MINUTES;
  const limit = args.limit ?? 8;
  const timeZone = args.timeZone;
  const accessToken = await getValidGoogleAccessToken(args.mailboxUserId);
  if (!accessToken) return [];

  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(args.day);
  if (weekdayName === "Sat" || weekdayName === "Sun") return [];

  const parts = wallClockParts(args.day, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dayStartLocal = `${parts.y}-${pad(parts.mo)}-${pad(parts.d)}T${String(BUSINESS_START_HOUR).padStart(2, "0")}:00:00`;
  const dayEndLocal = `${parts.y}-${pad(parts.mo)}-${pad(parts.d)}T${String(BUSINESS_END_HOUR).padStart(2, "0")}:00:00`;
  const windowStart = fromLocalDateTimeString(dayStartLocal, timeZone);
  const windowEnd = fromLocalDateTimeString(dayEndLocal, timeZone);

  const minStart = new Date(
    Math.max(Date.now() + 30 * 60_000, windowStart.getTime()),
  );
  if (minStart >= windowEnd) return [];

  let cursor = new Date(
    Math.ceil(minStart.getTime() / (30 * 60_000)) * (30 * 60_000),
  );
  if (cursor < windowStart) cursor = windowStart;

  let busy: Array<{ start: Date; end: Date }> = [];
  try {
    busy = await queryGoogleBusyPeriods({
      accessToken,
      timeMin: windowStart,
      timeMax: windowEnd,
    });
  } catch (err) {
    console.error("findFreeSlotsOnDay failed", args.mailboxUserId, err);
    return [];
  }

  const slots: Date[] = [];
  while (slots.length < limit && cursor < windowEnd) {
    const slotParts = wallClockParts(cursor, timeZone);
    const inHours =
      slotParts.h >= BUSINESS_START_HOUR &&
      slotParts.h < BUSINESS_END_HOUR &&
      !(slotParts.h === BUSINESS_END_HOUR - 1 && slotParts.mi > 30);

    if (inHours) {
      const end = new Date(cursor.getTime() + duration * 60_000);
      const endParts = wallClockParts(end, timeZone);
      const endsSameDay =
        endParts.y === slotParts.y &&
        endParts.mo === slotParts.mo &&
        endParts.d === slotParts.d &&
        endParts.h < BUSINESS_END_HOUR;
      const free =
        endsSameDay &&
        !busy.some((b) =>
          overlaps(
            cursor.getTime(),
            end.getTime(),
            b.start.getTime(),
            b.end.getTime(),
          ),
        );
      if (free) slots.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + 30 * 60_000);
  }
  return slots;
}

export async function findFreeSlots(args: {
  mailboxUserId: string;
  around: Date;
  durationMinutes?: number;
  limit?: number;
  timeZone?: string;
}): Promise<Date[]> {
  const duration = args.durationMinutes ?? DEMO_DURATION_MINUTES;
  const limit = args.limit ?? 3;
  const timeZone = args.timeZone ?? DEMO_TIMEZONE;
  const accessToken = await getValidGoogleAccessToken(args.mailboxUserId);
  if (!accessToken) return [];

  const windowStart = new Date(
    Math.max(Date.now() + 30 * 60_000, args.around.getTime() - 2 * 60 * 60_000),
  );
  const windowEnd = new Date(windowStart.getTime() + 5 * 24 * 60 * 60_000);
  const busy = await queryGoogleBusyPeriods({
    accessToken,
    timeMin: windowStart,
    timeMax: windowEnd,
  });

  const slots: Date[] = [];
  // Walk in 30-min steps through business hours.
  let cursor = new Date(windowStart);
  // Snap to next half hour.
  cursor = new Date(Math.ceil(cursor.getTime() / (30 * 60_000)) * (30 * 60_000));

  while (slots.length < limit && cursor < windowEnd) {
    const parts = wallClockParts(cursor, timeZone);
    const dow = new Date(
      Date.UTC(parts.y, parts.mo - 1, parts.d, 12, 0, 0),
    ).getUTCDay(); // rough; weekday check via locale
    const weekdayName = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(cursor);
    const isWeekend = weekdayName === "Sat" || weekdayName === "Sun";
    const inHours =
      parts.h >= BUSINESS_START_HOUR &&
      parts.h < BUSINESS_END_HOUR &&
      !(parts.h === BUSINESS_END_HOUR - 1 && parts.mi > 30);

    if (!isWeekend && inHours) {
      const end = new Date(cursor.getTime() + duration * 60_000);
      const endParts = wallClockParts(end, timeZone);
      const endsSameDay =
        endParts.y === parts.y &&
        endParts.mo === parts.mo &&
        endParts.d === parts.d &&
        endParts.h < BUSINESS_END_HOUR;
      const free =
        endsSameDay &&
        !busy.some((b) =>
          overlaps(
            cursor.getTime(),
            end.getTime(),
            b.start.getTime(),
            b.end.getTime(),
          ),
        );
      // Prefer not to suggest the exact busy requested time.
      const sameAsAround =
        Math.abs(cursor.getTime() - args.around.getTime()) < 5 * 60_000;
      if (free && !sameAsAround) {
        slots.push(new Date(cursor));
      }
    }
    cursor = new Date(cursor.getTime() + 30 * 60_000);
    void dow;
  }
  return slots;
}

export type BookDemoResult =
  | {
      ok: true;
      meetingActivityId: string;
      meetLink: string | null;
      calendarLink: string | null;
      whenLabel: string;
      confirmationSubject: string;
      confirmationBody: string;
    }
  | { ok: false; error: string; needsConnect?: boolean };

export async function bookDemoMeeting(args: {
  mailboxUserId: string;
  contactId: string;
  start: Date;
  timeZone?: string;
  organizationId?: string | null;
}): Promise<BookDemoResult> {
  const timeZone = args.timeZone?.trim() || DEMO_TIMEZONE;
  const contact = await getContact(args.contactId);
  if (!contact) return { ok: false, error: "Contact not found." };
  const contactEmail = contact.person.email?.trim();
  if (!contactEmail) {
    return { ok: false, error: "Contact needs an email to send the invite." };
  }
  if (args.start.getTime() < Date.now() - 60_000) {
    return { ok: false, error: "Pick a time in the future." };
  }

  const hasCal = await mailboxHasGoogleCalendar(args.mailboxUserId);
  if (!hasCal) {
    return {
      ok: false,
      error:
        "Connect Google Calendar in Configuration → Email to schedule demos.",
      needsConnect: true,
    };
  }

  const conn = await getCalendarConnection(args.mailboxUserId, "google");
  const organizerEmail = conn?.accountEmail?.trim() || "Worktual";
  const organizerName = organizerEmail.split("@")[0] || "Worktual";
  const topic = `Product demo with ${contact.displayName}`;
  const startLocal = toLocalDateTimeString(args.start, timeZone);
  const whenLabel = formatMeetingWhenLabel(
    args.start,
    timeZone,
    DEMO_DURATION_MINUTES,
  );

  const organizationId = await resolveRequestOrganizationId(
    args.organizationId ?? contact.person.organizationId,
  );

  const existingMeeting = await resolveUpcomingMeetingForContact(
    organizationId,
    args.contactId,
  );
  const existingDue = existingMeeting?.dueAt
    ? new Date(existingMeeting.dueAt)
    : null;
  const isReschedule = Boolean(
    existingMeeting &&
      existingDue &&
      !Number.isNaN(existingDue.getTime()) &&
      Math.abs(existingDue.getTime() - args.start.getTime()) > 60_000,
  );
  const previousWhenLabel = isReschedule
    ? parseWhenLabelFromMeetingBody(existingMeeting?.body) ||
      formatMeetingWhenLabel(existingDue!, timeZone, DEMO_DURATION_MINUTES)
    : null;
  const existingGoogleEventId = isReschedule
    ? parseGoogleEventIdFromMeetingBody(existingMeeting?.body) ||
      parseGcalProviderMessageId(existingMeeting?.providerMessageId)
    : null;

  const calendarResult =
    isReschedule && existingGoogleEventId
      ? await rescheduleOrCreateGoogleMeetingForUser({
          userId: args.mailboxUserId,
          eventId: existingGoogleEventId,
          summary: topic,
          description: `Worktual CRM demo with ${contact.displayName} (${contactEmail})`,
          startDateTime: startLocal,
          timeZone,
          durationMinutes: DEMO_DURATION_MINUTES,
          attendeeEmails: [contactEmail],
          includeGoogleMeet: true,
        })
      : await scheduleGoogleMeetingForUser({
          userId: args.mailboxUserId,
          summary: topic,
          description: `Worktual CRM demo with ${contact.displayName} (${contactEmail})`,
          startDateTime: startLocal,
          timeZone,
          durationMinutes: DEMO_DURATION_MINUTES,
          attendeeEmails: [contactEmail],
          includeGoogleMeet: true,
        });
  if (!calendarResult.ok) {
    return {
      ok: false,
      error: calendarResult.error,
      needsConnect: calendarResult.needsConnect,
    };
  }

  const meetLink =
    calendarResult.meeting.meetLink ??
    (isReschedule ? parseMeetingLinkFromBody(existingMeeting?.body) : null);
  const calendarLink =
    calendarResult.meeting.htmlLink ??
    (isReschedule ? parseCalendarLinkFromMeetingBody(existingMeeting?.body) : null);
  const googleEventId =
    calendarResult.meeting.eventId || existingGoogleEventId;
  const subject = `Demo: ${topic}`;
  const body = buildMeetingActivityBody({
    topic,
    whenLabel,
    organizerName,
    organizerEmail,
    guestEmails: [contactEmail.toLowerCase()],
    provider: "google_meet",
    meetingLink: meetLink,
    calendarLink,
    googleEventId,
    previousWhenLabel,
    previousDueAt: isReschedule ? existingDue : null,
    rescheduled: isReschedule,
    icsUid:
      (isReschedule
        ? parseIcsUidFromMeetingBody(existingMeeting?.body)
        : null) ||
      (existingMeeting ? `${existingMeeting.id}@worktual.crm` : null),
    icsSequence: isReschedule
      ? parseIcsSequenceFromMeetingBody(existingMeeting?.body) + 1
      : 0,
  });

  const activity = await createContactActivity(args.contactId, {
    type: "meeting",
    subject,
    body,
    dueAt: args.start,
    folder: "inbox",
    createdByUserId: args.mailboxUserId,
    organizationId,
    providerMessageId: googleEventId ? `gcal:${googleEventId}` : undefined,
  });

  const endsAt = new Date(
    args.start.getTime() + DEMO_DURATION_MINUTES * 60_000,
  );
  try {
    await syncAppointmentForMeetingActivity({
    organizationId,
    contactId: args.contactId,
    hostUserId: args.mailboxUserId,
    activityId: activity.id,
    source: "demo_agent",
    title: topic,
    startsAt: args.start,
    endsAt,
    timezone: timeZone,
    provider: "google_meet",
    joinUrl: meetLink,
    calendarEventId: googleEventId,
    guestEmails: [contactEmail.toLowerCase()],
    isReschedule,
    });
  } catch (err) {
    console.error("demo book: appointment sync failed", err);
  }

  if (isReschedule) {
    await cancelStaleMeetingCaptureBots(args.contactId, activity.id);
    await completeSupersededMeetings({
      contactId: args.contactId,
      keepActivityId: activity.id,
      supersedeActivityIds: existingMeeting ? [existingMeeting.id] : [],
    });
  }

  // Same capture path as calendar schedule-meeting: Assist session + Recall bot
  // so demos get transcripts and lifecycle can advance after the call.
  void (async () => {
    await cancelStaleMeetingCaptureBots(args.contactId, activity.id);
    await ensureAssistSessionForMeeting({
      activityId: activity.id,
      contactId: args.contactId,
      organizationId,
      hostUserId: args.mailboxUserId,
      provider: "google_meet",
      externalMeetingId: googleEventId || null,
      joinUrl: meetLink,
    });
    const capture = await dispatchMeetingCaptureBot({
      activityId: activity.id,
      forceReschedule: isReschedule,
      userId: args.mailboxUserId,
      organizationId,
      consentCaptured: true,
    });
    if (!capture.ok && !capture.skipped) {
      console.error("demo book: meeting capture bot failed", capture.error);
    }
  })();

  if (!isReschedule) {
    void sendMeetingBriefToOwner({
      activityId: activity.id,
      contactId: args.contactId,
      organizationId,
      senderUserId: args.mailboxUserId,
    }).catch((err) => {
      console.error("demo book: meeting brief failed", err);
    });
  }

  if (!isReschedule) {
    void enqueueLeadScoring({
      contactId: args.contactId,
      organizationId,
      triggerReason: "activity:meeting",
      processImmediately: true,
    }).catch((err) => {
      console.error("demo book: scoring enqueue failed", err);
    });

    triggerLeadLifecycle({
      contactId: args.contactId,
      organizationId,
      triggerReason: "activity:meeting",
    });
  }

  // Persist owner as the mailbox recipient when the contact is unowned.
  const ownerId =
    contact.crm.ownerUserId ?? contact.person.ownerUserId ?? null;
  if (!ownerId) {
    try {
      await updateContact(args.contactId, { ownerUserId: args.mailboxUserId });
    } catch (err) {
      console.error("demo book: set owner failed", args.contactId, err);
    }
  }

  const firstName = contact.displayName.split(/\s+/)[0] || "there";
  const orgBrand = await resolveOrgBrand(organizationId);
  const confirm = buildMeetingConfirmationEmail({
    contactFirstName: firstName,
    organizerName,
    organizerEmail,
    topic,
    whenLabel,
    meetLink,
    guestEmails: [contactEmail.toLowerCase()],
    provider: "google_meet",
    rescheduled: isReschedule,
    previousWhenLabel,
    logoUrl: orgBrand.logoUrl,
    sellerName: orgBrand.sellerName,
  });

  if (!isReschedule) {
    await notifyUsers({
      organizationId,
      recipientUserIds: [args.mailboxUserId],
      kind: "demo_meeting_scheduled",
      title: `Demo booked: ${contact.displayName}`,
      body: `A product demo is scheduled for ${whenLabel}.`,
      href: `/contact/${args.contactId}`,
      entityType: "contact_activity",
      entityId: activity.id,
      contactId: args.contactId,
      metadata: {
        agent: "email_auto_reply",
        meetLink,
        whenLabel,
        googleEventId,
      },
    });
  }

  return {
    ok: true,
    meetingActivityId: activity.id,
    meetLink,
    calendarLink,
    whenLabel,
    confirmationSubject: confirm.subject,
    confirmationBody: confirm.body,
  };
}

/** Latest open demo conversation on this thread (status awaiting_demo). */
export async function findOpenDemoStateForThread(args: {
  threadId: string | null;
  contactId: string;
  activityIds: string[];
}): Promise<{ jobId: string; state: DemoState } | null> {
  const ids = args.activityIds.filter(Boolean);

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; result_summary: unknown }>
  >(
    `
    SELECT j.id, j.result_summary
    FROM email_auto_reply_jobs j
    JOIN contact_activities ca ON ca.id = j.inbound_activity_id
    WHERE j.status = 'awaiting_demo'
      AND j.contact_id = $1::text
      AND (
        ca.id = ANY($2::text[])
        OR ($3::text IS NOT NULL AND (ca.thread_id = $3 OR ca.id = $3))
      )
    ORDER BY j.updated_at DESC
    LIMIT 1
    `,
    args.contactId,
    ids.length ? ids : ["__none__"],
    args.threadId,
  );

  const row = rows[0];
  if (!row) return null;
  const state = parseDemoState(row.result_summary);
  if (!state || state.phase === "booked") return null;
  return { jobId: row.id, state };
}

/** Close stale awaiting_demo jobs on other threads (or all after a booking). */
export async function closeAwaitingDemoJobs(args: {
  contactId: string;
  threadId?: string | null;
  keepJobId?: string | null;
  /** When true, close every awaiting_demo job for the contact. */
  allThreads?: boolean;
}): Promise<void> {
  if (args.allThreads) {
    await prisma.$executeRawUnsafe(
      `
      UPDATE email_auto_reply_jobs
      SET status = 'skipped',
          reason = COALESCE(NULLIF(reason, ''), 'demo_booked_or_superseded'),
          completed_at = NOW(),
          updated_at = NOW()
      WHERE contact_id = $1::text
        AND status = 'awaiting_demo'
        AND ($2::text IS NULL OR id <> $2)
      `,
      args.contactId,
      args.keepJobId ?? null,
    );
    return;
  }
  const threadId = args.threadId?.trim();
  if (!threadId) return;
  await prisma.$executeRawUnsafe(
    `
    UPDATE email_auto_reply_jobs j
    SET status = 'skipped',
        reason = COALESCE(NULLIF(j.reason, ''), 'superseded_demo_thread'),
        completed_at = NOW(),
        updated_at = NOW()
    WHERE j.contact_id = $1::text
      AND j.status = 'awaiting_demo'
      AND ($2::text IS NULL OR j.id <> $2)
      AND NOT EXISTS (
        SELECT 1 FROM contact_activities ca
        WHERE ca.id = j.inbound_activity_id
          AND (ca.thread_id = $3 OR ca.id = $3)
      )
    `,
    args.contactId,
    args.keepJobId ?? null,
    threadId,
  );
}

/**
 * Best-effort parse of a preferred datetime from free text (IST / Asia/Kolkata).
 * Returns an absolute Date, or null when nothing usable is found.
 */
export function parsePreferredDateTime(
  text: string,
  now = new Date(),
  timeZone = DEMO_TIMEZONE,
  opts?: { allowPast?: boolean },
): Date | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return null;

  // ISO-ish: 2026-07-28T15:00 or 2026-07-28 15:00
  const iso = raw.match(
    /\b(20\d{2})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\b/,
  );
  if (iso) {
    try {
      return fromLocalDateTimeString(
        `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]!.padStart(2, "0")}:${iso[5]}:00`,
        timeZone,
      );
    } catch {
      /* fall through */
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY with optional time
  const dmy = raw.match(
    /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i,
  );
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    let hour = dmy[4] ? Number(dmy[4]) : 10;
    const minute = dmy[5] ? Number(dmy[5]) : 0;
    const ampm = (dmy[6] || "").toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    try {
      const pad = (n: number) => String(n).padStart(2, "0");
      return fromLocalDateTimeString(
        `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`,
        timeZone,
      );
    } catch {
      /* fall through */
    }
  }

  const nowParts = wallClockParts(now, timeZone);
  let dayOffset = 0;
  if (/\btomorrow\b/i.test(raw)) dayOffset = 1;
  else if (/\btoday\b/i.test(raw)) dayOffset = 0;
  else if (/\bday after tomorrow\b/i.test(raw)) dayOffset = 2;

  const timeMatch = raw.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i,
  );
  const time24 = raw.match(/\bat\s+(\d{1,2}):(\d{2})\b/i);
  // Indian dotted times: 4.45, 6.18, 6.30, 6.5 (= 6:30)
  const dotted = raw.match(
    /(?<!\d)(\d{1,2})\.(\d{1,2})(?!\d)(?:\s*(am|pm|a\.m\.|p\.m\.))?/i,
  );
  // "4.45 pm" must not match the trailing "45 pm" from the am/pm regex.
  const dottedDecimalTime =
    dotted &&
    timeMatch &&
    timeMatch.index != null &&
    timeMatch.index > 0 &&
    raw[timeMatch.index - 1] === ".";

  let hour: number | null = null;
  let minute = 0;
  let ampm = "";
  if (dotted && (dottedDecimalTime || !timeMatch?.[2])) {
    hour = Number(dotted[1]);
    const frac = Number(dotted[2]);
    minute = dotted[2]!.length === 1 ? (frac === 5 ? 30 : frac * 10) : frac;
    if (minute >= 60) return null;
    ampm = (dotted[3] || "").replace(/\./g, "").toLowerCase();
  } else if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
    ampm = timeMatch[3].replace(/\./g, "").toLowerCase();
  } else if (time24) {
    hour = Number(time24[1]);
    minute = Number(time24[2]);
  } else if (dotted) {
    hour = Number(dotted[1]);
    const frac = Number(dotted[2]);
    minute = dotted[2]!.length === 1 ? (frac === 5 ? 30 : frac * 10) : frac;
    if (minute >= 60) return null;
    ampm = (dotted[3] || "").replace(/\./g, "").toLowerCase();
  }
  if (hour != null) {
    if (ampm.startsWith("p") && hour < 12) hour += 12;
    else if (ampm.startsWith("a") && hour === 12) hour = 0;
    else if (!ampm && hour >= 1 && hour <= 7) hour += 12;
  }

  if (hour == null && dayOffset === 0 && !/\btoday\b|\btomorrow\b/i.test(raw)) {
    return null;
  }
  if (hour == null) hour = 10;

  // Advance calendar day in timezone by building local string.
  const baseUtc = Date.UTC(
    nowParts.y,
    nowParts.mo - 1,
    nowParts.d + dayOffset,
    12,
    0,
    0,
  );
  // Re-read y/m/d after offset via wall clock of noon UTC-ish local
  const base = new Date(baseUtc);
  // Correct: use local parts of "today" then add days in local space
  const localToday = fromLocalDateTimeString(
    `${nowParts.y}-${String(nowParts.mo).padStart(2, "0")}-${String(nowParts.d).padStart(2, "0")}T12:00:00`,
    timeZone,
  );
  const targetNoon = new Date(
    localToday.getTime() + dayOffset * 24 * 60 * 60_000,
  );
  const tp = wallClockParts(targetNoon, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  try {
    const result = fromLocalDateTimeString(
      `${tp.y}-${pad(tp.mo)}-${pad(tp.d)}T${pad(hour)}:${pad(minute)}:00`,
      timeZone,
    );
    if (result.getTime() < now.getTime() - 60_000) {
      return opts?.allowPast ? result : null;
    }
    return result;
  } catch {
    return null;
  }
}

export function formatSlotOption(instant: Date, timeZone = DEMO_TIMEZONE): string {
  return formatMeetingWhenLabel(instant, timeZone, DEMO_DURATION_MINUTES);
}

export function demoSignoff(senderOrganizationName = "Worktual"): string {
  const org = senderOrganizationName.trim() || "Worktual";
  return `Best regards,\n${org}`;
}

export function demoAskSlotBody(
  contactName: string,
  senderOrganizationName = "Worktual",
): string {
  const first = contactName.split(/\s+/)[0] || "there";
  return [
    `Hi ${first},`,
    "",
    "Thanks for your interest — we'd be happy to schedule a product demo.",
    "",
    "Could you share your preferred date and time (with timezone if you're not on IST)? We'll check availability and confirm a slot.",
    "",
    demoSignoff(senderOrganizationName),
  ].join("\n");
}

export function demoProposeAltsBody(
  contactName: string,
  requestedLabel: string,
  alternatives: Date[],
  timeZone = DEMO_TIMEZONE,
  senderOrganizationName = "Worktual",
): string {
  const first = contactName.split(/\s+/)[0] || "there";
  const lines = alternatives.map(
    (s, i) => `${i + 1}. ${formatSlotOption(s, timeZone)}`,
  );
  return [
    `Hi ${first},`,
    "",
    `Thanks — ${requestedLabel} isn't free on our side. Here are a few alternatives that work:`,
    "",
    ...lines,
    "",
    "Reply with the number or the time that suits you and we'll lock it in.",
    "",
    demoSignoff(senderOrganizationName),
  ].join("\n");
}

const OUTBOUND_DEMO_OFFER_RE =
  /\b(demo|meeting|call|schedule|slot|calendar|invite|walkthrough)\b/i;

/** Short yes/ok after we proposed a time — confirm that slot. */
export const SLOT_CONFIRM_RE =
  /^\s*(?:yes[,.]?\s*)?(?:(?:it['’]?s|that(?:['’]?s)?|this)\s+)?(?:fine|ok|okay|good|works?|perfect|great|sure|confirmed|alright|all right|book it|let['’]?s do (?:it|that))\b/i;

export function latestOutboundDemoOfferIso(
  thread: Array<{ direction: string | null; body: string }>,
  now = new Date(),
  timeZone = DEMO_TIMEZONE,
): string | null {
  const outbounds = thread.filter((m) => m.direction === "outbound").slice(-6);
  for (let i = outbounds.length - 1; i >= 0; i--) {
    const body = outbounds[i]?.body || "";
    if (!OUTBOUND_DEMO_OFFER_RE.test(body)) continue;
    const parsed = parsePreferredDateTime(body, now, timeZone);
    if (parsed) return parsed.toISOString();
  }
  return null;
}

export function threadOfferedDemo(
  thread: Array<{ direction: string | null; body: string }>,
): boolean {
  return thread.some(
    (m) =>
      m.direction === "outbound" && OUTBOUND_DEMO_OFFER_RE.test(m.body || ""),
  );
}
