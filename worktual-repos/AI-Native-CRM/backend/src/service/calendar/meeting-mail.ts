import { sendConnectedEmailForUser } from "@/service/email/send-connected-email";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { notifyAdminsOfLeadEventAsync } from "@/dao/notifications/notify-admins";
import type { MeetingProvider } from "@/lib/meeting-provider";
import { meetingProviderLabel } from "@/lib/meeting-provider";
import {
  buildMeetingConfirmationEmailHtml,
  buildMeetingReminderEmailHtml,
} from "@/service/calendar/meeting-mail-html";

import {
  buildMeetingActivityBody,
  parseMeetingLinkFromBody,
  parseParticipantEmails,
} from "@/lib/meeting-body";

export {
  buildMeetingActivityBody,
  parseMeetingLinkFromBody,
  parseParticipantEmails,
} from "@/lib/meeting-body";

export function formatMeetingWhenLabel(
  start: Date,
  timeZone: string,
  durationMinutes = 30,
): string {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const date = start.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
  const startT = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const endT = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  return `${date} · ${startT} – ${endT} (${timeZone})`;
}

export function formatMeetingInviteSubject(args: {
  topic: string;
  whenLabel: string;
  rescheduled?: boolean;
}): string {
  const shortWhen = args.whenLabel
    .replace(/\s*\([^)]+\)\s*$/, "")
    .replace(" · ", " — ");
  const prefix = args.rescheduled ? "Updated: " : "";
  return `${prefix}${args.topic} — ${shortWhen}`;
}

export function buildMeetingConfirmationEmail(args: {
  contactFirstName: string;
  organizerName: string;
  organizerEmail: string;
  topic: string;
  whenLabel: string;
  meetLink?: string | null;
  guestEmails?: string[];
  provider?: MeetingProvider;
  /** When true, body mentions the attached .ics (CRM-sent invites). */
  includeIcsNote?: boolean;
  rescheduled?: boolean;
  previousWhenLabel?: string | null;
  logoUrl?: string | null;
  sellerName?: string;
}): { subject: string; body: string } {
  const guests = args.guestEmails ?? [];
  const joinLabel = args.provider
    ? `Join ${meetingProviderLabel(args.provider)}`
    : "Join meeting";
  const subject = formatMeetingInviteSubject({
    topic: args.topic,
    whenLabel: args.whenLabel,
    rescheduled: args.rescheduled,
  });
  const intro = args.rescheduled
    ? `${args.organizerName} rescheduled your meeting.`
    : `${args.organizerName} invited you to a meeting.`;
  const plainBody = [
    `Hi ${args.contactFirstName},`,
    "",
    intro,
    args.rescheduled && args.previousWhenLabel
      ? `Previous time: ${args.previousWhenLabel}`
      : null,
    "",
    `When: ${args.whenLabel}`,
    `Topic: ${args.topic}`,
    `Organizer: ${args.organizerName} (${args.organizerEmail})`,
    args.meetLink ? "" : null,
    args.meetLink ? `${joinLabel}:` : null,
    args.meetLink ? args.meetLink : null,
    guests.length > 0 ? "" : null,
    guests.length > 0 ? `Guests: ${guests.join(", ")}` : null,
    args.includeIcsNote ? "" : null,
    args.includeIcsNote
      ? "A calendar invite (.ics) is attached — open it to add this to your calendar."
      : null,
    "",
    "Thanks,",
    args.organizerName,
  ]
    .filter((line) => line !== null)
    .join("\n");
  const body = buildMeetingConfirmationEmailHtml({
    contactFirstName: args.contactFirstName,
    organizerName: args.organizerName,
    organizerEmail: args.organizerEmail,
    topic: args.topic,
    whenLabel: args.whenLabel,
    meetLink: args.meetLink,
    guestEmails: guests,
    rescheduled: args.rescheduled,
    previousWhenLabel: args.previousWhenLabel,
    joinLabel,
    logoUrl: args.logoUrl,
    sellerName: args.sellerName,
  });
  return { subject, body: body || plainBody };
}

export function buildMeetingParticipantAddedEmail(args: {
  organizerName: string;
  organizerEmail: string;
  topic: string;
  whenLabel: string;
  meetLink?: string | null;
  guestEmails?: string[];
}): { subject: string; body: string } {
  const subject = `Updated: ${args.topic}`;
  const guests = args.guestEmails ?? [];
  const body = [
    `${args.organizerName} added you to a meeting.`,
    "",
    `When: ${args.whenLabel}`,
    `Topic: ${args.topic}`,
    `Organizer: ${args.organizerName} (${args.organizerEmail})`,
    args.meetLink ? "" : null,
    args.meetLink ? "Join:" : null,
    args.meetLink ? args.meetLink : null,
    guests.length > 0 ? "" : null,
    guests.length > 0 ? `Guests: ${guests.join(", ")}` : null,
    "",
    "Thanks,",
    args.organizerName,
  ]
    .filter((line) => line !== null)
    .join("\n");
  return { subject, body };
}

export type MeetingReminderWindow = "24h" | "1h";

/** Customer-facing “don’t miss” reminder for T−24h or T−1h. */
export function buildMeetingReminderEmail(args: {
  contactFirstName: string;
  organizerName: string;
  topic: string;
  whenLabel: string;
  meetLink?: string | null;
  window?: MeetingReminderWindow;
  logoUrl?: string | null;
  sellerName?: string;
}): { subject: string; body: string } {
  const window = args.window ?? "1h";
  const subject =
    window === "24h"
      ? `Reminder: ${args.topic} in 24 hours`
      : `Starting soon: ${args.topic}`;
  const lead =
    window === "24h"
      ? "Friendly reminder — don’t miss your meeting tomorrow."
      : "Friendly reminder that your meeting starts in about one hour.";
  const plainBody = [
    `Hi ${args.contactFirstName},`,
    "",
    lead,
    "",
    `When: ${args.whenLabel}`,
    `Topic: ${args.topic}`,
    args.meetLink ? "" : null,
    args.meetLink ? "Join:" : null,
    args.meetLink ? args.meetLink : null,
    "",
    "Thanks,",
    args.organizerName,
  ]
    .filter((line) => line !== null)
    .join("\n");
  const body =
    buildMeetingReminderEmailHtml({
      contactFirstName: args.contactFirstName,
      organizerName: args.organizerName,
      topic: args.topic,
      whenLabel: args.whenLabel,
      meetLink: args.meetLink,
      window,
      logoUrl: args.logoUrl,
      sellerName: args.sellerName,
    }) || plainBody;
  return { subject, body };
}

/** Record a calendar invite in CRM without sending a duplicate Gmail message. */
export async function logCalendarInviteActivity(args: {
  userId: string;
  contactId: string;
  subject: string;
  body: string;
  note?: string;
}): Promise<void> {
  await createContactActivity(args.contactId, {
    type: "email",
    subject: args.subject,
    body: [args.note ?? "Invite sent via Google Calendar.", "", args.body]
      .filter(Boolean)
      .join("\n"),
    folder: "sent",
    createdByUserId: args.userId,
  });
  notifyAdminsOfLeadEventAsync({
    kind: "lead_activity",
    contactId: args.contactId,
    actorUserId: args.userId,
    activityType: "email",
    activitySubject: args.subject,
  });
}

/** Send meeting mail via connected email and log a sent email activity. */
export async function sendMeetingNotificationEmail(args: {
  userId: string;
  contactId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
  ics?: string | null;
  /** Pass null for cron/background (skip cookie preference). */
  preferredProvider?: "google" | "microsoft" | null;
}): Promise<
  | { ok: true; gmailMessageId: string; gmailThreadId: string }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  const attachments = args.ics?.trim()
    ? [
        {
          filename: "invite.ics",
          contentType: "text/calendar; method=REQUEST; charset=UTF-8",
          content: args.ics,
        },
      ]
    : undefined;

  const result = await sendConnectedEmailForUser({
    userId: args.userId,
    to: args.to,
    subject: args.subject,
    body: args.body,
    cc: args.cc,
    attachments,
    preferredProvider:
      args.preferredProvider !== undefined
        ? args.preferredProvider
        : undefined,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      needsConnect: result.needsConnect,
    };
  }

  await createContactActivity(args.contactId, {
    type: "email",
    subject: args.subject,
    body: args.body,
    folder: "sent",
    gmailMessageId: result.messageId ?? null,
    gmailThreadId: result.threadId ?? null,
    rfcMessageId: result.rfcMessageId ?? null,
    emailDirection: "outbound",
    createdByUserId: args.userId,
  });
  notifyAdminsOfLeadEventAsync({
    kind: "lead_activity",
    contactId: args.contactId,
    actorUserId: args.userId,
    activityType: "email",
    activitySubject: args.subject,
  });

  return {
    ok: true,
    gmailMessageId: result.messageId ?? "",
    gmailThreadId: result.threadId ?? "",
  };
}

export const extractMeetLinkFromText = parseMeetingLinkFromBody;
