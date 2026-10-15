/**
 * Framework-agnostic schedule-meeting command for Fastify Wave 8.
 * Extracted from contacts/actions.ts (no next/cache).
 */

import { getServerUserId } from "@/service/account/session-cookie";
import { getContact } from "@/dao/contacts/contact-service";
import {
  createContactActivity,
  completeSupersededMeetings,
  updateContactMeetingSchedule,
} from "@/dao/contacts/contact-activity-service";
import { syncAppointmentForMeetingActivity, resolveUpcomingMeetingForContact } from "@/service/appointments/appointment-service";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import {
  googleHasCalendarScope,
  googleHasGmailSendScope,
} from "@/service/google/access-token";
import {
  rescheduleOrCreateGoogleMeetingForUser,
  scheduleGoogleMeetingForUser,
} from "@/service/calendar/schedule-google";
import {
  buildMeetingConfirmationEmail,
  formatMeetingWhenLabel,
  logCalendarInviteActivity,
  sendMeetingNotificationEmail,
} from "@/service/calendar/meeting-mail";
import { resolveOrgBrand } from "@/lib/org-brand";
import { resolveEmailSendProvider } from "@/service/email/send-connected-email";
import { createZoomMeeting, isZoomConfigured } from "@/service/zoom/zoom-api";
import { createTeamsMeeting, isTeamsConfigured } from "@/service/microsoft/teams-api";
import {
  buildMeetingActivityBody,
  normalizeEmailList,
  parseCalendarLinkFromMeetingBody,
  parseGcalProviderMessageId,
  parseGoogleEventIdFromMeetingBody,
  parseIcsSequenceFromMeetingBody,
  parseIcsUidFromMeetingBody,
  parseMeetingLinkFromBody,
  parseParticipantEmails,
  parseWhenLabelFromMeetingBody,
} from "@/lib/meeting-body";
import {
  isMeetingProvider,
  meetingProviderLabel,
  type MeetingProvider,
} from "@/lib/meeting-provider";
import { notifyAdminsOfLeadEventAsync } from "@/dao/notifications/notify-admins";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { prisma } from "@/dao/db/prisma";
import { ensureAssistSessionForMeeting } from "@/service/ai/meeting-assist";
import { dispatchMeetingCaptureBot, cancelStaleMeetingCaptureBots } from "@/service/transcripts/meeting-capture";
import { sendMeetingBriefToOwner } from "@/service/ai/meeting-brief";
import { enqueueLeadScoring } from "@/service/ai/lead-scoring-job";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import { buildMeetingIcs } from "@/lib/meeting-ics";
import { isInternalEmail, resolveInternalDomains } from "@/service/account/internal-domains";

async function markMeetingReminderWindows(
  activityId: string,
  start: Date,
): Promise<void> {
  const msUntilStart = start.getTime() - Date.now();
  const nowTs = new Date();
  if (msUntilStart < 55 * 60_000) {
    await prisma.contactActivity.update({
      where: { id: activityId },
      data: {
        reminder24hSentAt: nowTs,
        reminder1hSentAt: nowTs,
        reminderSentAt: nowTs,
      },
    });
  } else if (msUntilStart < 23 * 60 * 60_000) {
    await prisma.contactActivity.update({
      where: { id: activityId },
      data: { reminder24hSentAt: nowTs },
    });
  }
}

export type ScheduleMeetingResult =
  | {
      ok: true;
      id: string;
      confirmationSent: boolean;
      emailError?: string;
      needsConnect?: boolean;
      /** Soft, non-blocking heads-up — e.g. Sales Assist can't tell this
       * contact apart from the org side. Never fails scheduling. */
      warning?: string;
    }
  | { ok: false; error: string; needsConnect?: boolean };

export async function scheduleMeetingCommand(input: {
  contactId: string;
  /** datetime-local value, e.g. 2026-07-16T10:13 */
  when: string;
  /** Absolute instant from the browser (for CRM dueAt) */
  whenIso?: string;
  /** IANA timezone from the browser */
  timeZone?: string;
  topic?: string;
  durationMinutes?: number;
  /** Comma-separated additional participant emails */
  participants?: string;
  /** Additional participant emails */
  participantEmails?: string[];
  meetingProvider?: MeetingProvider;
}): Promise<ScheduleMeetingResult> {
  const scheduleStarted = Date.now();
  try {
    const contact = await getContact(input.contactId);
    if (!contact) return { ok: false, error: "Contact not found." };
    if (!input.when) return { ok: false, error: "Pick a date and time." };
    if (!contact.person.email?.trim()) {
      return { ok: false, error: "Contact needs an email to send the invite." };
    }

    const start = new Date(input.whenIso || input.when);
    if (Number.isNaN(start.getTime())) {
      return { ok: false, error: "Invalid date and time." };
    }
    if (start.getTime() < Date.now() - 60_000) {
      return { ok: false, error: "Pick a time in the future." };
    }

    const userId = await getServerUserId();
    if (!userId) {
      return {
        ok: false,
        error: "Sign in again to schedule a meeting.",
      };
    }

    const meetingProvider: MeetingProvider = isMeetingProvider(
      input.meetingProvider ?? "",
    )
      ? input.meetingProvider!
      : "google_meet";

    if (meetingProvider === "zoom" && !isZoomConfigured()) {
      return {
        ok: false,
        error:
          "Zoom is not configured on the server. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET.",
      };
    }
    if (meetingProvider === "teams" && !isTeamsConfigured()) {
      return {
        ok: false,
        error:
          "Microsoft Teams is not configured on the server. Add MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_ORGANIZER_USER_ID.",
      };
    }

    const google = await getCalendarConnection(userId, "google");
    const microsoft = await getCalendarConnection(userId, "microsoft");
    const emailProvider = await resolveEmailSendProvider(userId);

    if (meetingProvider === "google_meet") {
      if (!google || !googleHasGmailSendScope(google.scope)) {
        return {
          ok: false,
          error:
            "Connect Google in Configuration → Email to schedule Google Meet.",
          needsConnect: true,
        };
      }
      if (!googleHasCalendarScope(google.scope)) {
        return {
          ok: false,
          error:
            "Reconnect Google in Configuration → Email to grant Calendar access for Google Meet.",
          needsConnect: true,
        };
      }
    } else if (!emailProvider) {
      return {
        ok: false,
        error:
          "Connect an email account (Google or Microsoft) in Configuration → Email to send the invite.",
        needsConnect: true,
      };
    }

    const timeZone =
      input.timeZone?.trim() ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC";
    const durationMinutes = input.durationMinutes ?? 30;
    const whenLabel = formatMeetingWhenLabel(start, timeZone, durationMinutes);
    const topic = input.topic?.trim() || `Meeting with ${contact.displayName}`;
    const subject = input.topic?.trim()
      ? `Meeting: ${input.topic.trim()}`
      : `Meeting with ${contact.displayName}`;

    const organizerEmail =
      (meetingProvider === "google_meet"
        ? google?.accountEmail
        : emailProvider === "google"
          ? google?.accountEmail
          : microsoft?.accountEmail) ||
      google?.accountEmail ||
      microsoft?.accountEmail ||
      "Worktual";
    const organizerName = organizerEmail.split("@")[0] || "Worktual";

    const contactEmail = contact.person.email.trim().toLowerCase();
    const extraGuests = normalizeEmailList([
      ...parseParticipantEmails(input.participants),
      ...(input.participantEmails ?? []),
    ]).filter(
      (email) =>
        email !== contactEmail && email !== organizerEmail.toLowerCase(),
    );
    const allGuests = [contactEmail, ...extraGuests];

    const organizationId = await resolveRequestOrganizationId(
      contact.person.organizationId,
    );

    // Soft, non-blocking check: Sales Assist splits attendees into the
    // customer pool vs internal pool by email domain. If this contact's
    // own email resolves as "internal" (shared/whitelabel domain, alias,
    // etc.) live coaching cannot identify them as the customer on the call.
    // A domain check alone misses the sharpest version of this collision —
    // the contact's stored email being *literally* the same mailbox the
    // organizer connected for their own calendar/Meet — which is exactly
    // what silently zeroes out the customer pool for this meeting (see the
    // "ravi r" regression: a personal-Gmail contact address that happened
    // to be the rep's own connected account left no customer identity for
    // classifyAttendeeTurn to ever elect, on either side).
    let assistWarning: string | undefined;
    try {
      const domains = await resolveInternalDomains(organizationId);
      if (contactEmail === organizerEmail.toLowerCase()) {
        assistWarning =
          "This contact's email is the same mailbox you connected for your own calendar — Sales Assist live coaching cannot tell them apart from you on this call. Use the contact's real email address.";
      } else if (isInternalEmail(contactEmail, domains)) {
        assistWarning =
          "This contact's email looks internal to your organization — Sales Assist live coaching may not be able to tell them apart from your team on this call.";
      }
    } catch {
      /* best-effort — never blocks scheduling */
    }

    const existingMeeting = await resolveUpcomingMeetingForContact(
      organizationId,
      input.contactId,
    );
    const existingDue = existingMeeting?.dueAt
      ? new Date(existingMeeting.dueAt)
      : null;
    // Any new time on the contact's open upcoming meeting is a reschedule
    // (not same-day only — cross-day updates the live slot + capture bot).
    const isReschedule = Boolean(
      existingMeeting &&
        existingDue &&
        !Number.isNaN(existingDue.getTime()) &&
        Math.abs(existingDue.getTime() - start.getTime()) > 60_000,
    );
    const previousWhenLabel = isReschedule
      ? parseWhenLabelFromMeetingBody(existingMeeting?.body) ||
        formatMeetingWhenLabel(existingDue!, timeZone, durationMinutes)
      : null;

    let meetingLink: string | null = isReschedule
      ? parseMeetingLinkFromBody(existingMeeting?.body)
      : null;
    let externalMeetingId: string | null = null;
    let calendarLink: string | null = isReschedule
      ? parseCalendarLinkFromMeetingBody(existingMeeting?.body)
      : null;
    let googleEventId: string | null = isReschedule
      ? parseGoogleEventIdFromMeetingBody(existingMeeting?.body) ||
        parseGcalProviderMessageId(existingMeeting?.providerMessageId)
      : null;
    let inviteViaGoogleCalendar = false;

    if (!isReschedule && meetingProvider === "zoom") {
      const zoom = await createZoomMeeting({
        topic,
        startDateTime: input.when,
        timeZone,
        durationMinutes,
      });
      meetingLink = zoom.joinUrl;
      externalMeetingId = zoom.id;
    } else if (!isReschedule && meetingProvider === "teams") {
      const teams = await createTeamsMeeting({
        topic,
        startDateTime: input.when,
        timeZone,
        durationMinutes,
      });
      meetingLink = teams.joinUrl;
      externalMeetingId = teams.id;
    }

    if (meetingProvider === "google_meet") {
      const calendarResult =
        isReschedule && googleEventId
          ? await rescheduleOrCreateGoogleMeetingForUser({
              userId,
              eventId: googleEventId,
              summary: topic,
              description: `Worktual CRM meeting with ${contact.displayName} (${contactEmail})`,
              startDateTime: input.when,
              timeZone,
              durationMinutes,
              attendeeEmails: allGuests,
              includeGoogleMeet: true,
            })
          : await scheduleGoogleMeetingForUser({
              userId,
              summary: topic,
              description: `Worktual CRM meeting with ${contact.displayName} (${contactEmail})`,
              startDateTime: input.when,
              timeZone,
              durationMinutes,
              attendeeEmails: allGuests,
              includeGoogleMeet: true,
            });
      if (!calendarResult.ok) {
        return {
          ok: false,
          error: calendarResult.error,
          needsConnect: calendarResult.needsConnect,
        };
      }
      meetingLink = calendarResult.meeting.meetLink ?? meetingLink;
      calendarLink = calendarResult.meeting.htmlLink ?? calendarLink;
      googleEventId = calendarResult.meeting.eventId || googleEventId;
      inviteViaGoogleCalendar = true;
    } else if (
      google &&
      googleHasCalendarScope(google.scope) &&
      googleHasGmailSendScope(google.scope)
    ) {
      const calendarResult =
        isReschedule && googleEventId
          ? await rescheduleOrCreateGoogleMeetingForUser({
              userId,
              eventId: googleEventId,
              summary: topic,
              description: `Worktual CRM meeting with ${contact.displayName} (${contactEmail})\n\nJoin ${meetingProviderLabel(meetingProvider)}: ${meetingLink ?? ""}`,
              startDateTime: input.when,
              timeZone,
              durationMinutes,
              attendeeEmails: allGuests,
              includeGoogleMeet: false,
              externalMeetingLink: meetingLink,
            })
          : await scheduleGoogleMeetingForUser({
              userId,
              summary: topic,
              description: `Worktual CRM meeting with ${contact.displayName} (${contactEmail})\n\nJoin ${meetingProviderLabel(meetingProvider)}: ${meetingLink ?? ""}`,
              startDateTime: input.when,
              timeZone,
              durationMinutes,
              attendeeEmails: allGuests,
              includeGoogleMeet: false,
              externalMeetingLink: meetingLink,
            });
      if (calendarResult.ok) {
        calendarLink = calendarResult.meeting.htmlLink ?? calendarLink;
        googleEventId = calendarResult.meeting.eventId || googleEventId;
        meetingLink = calendarResult.meeting.meetLink ?? meetingLink;
        inviteViaGoogleCalendar = true;
      }
    }

    const icsUid =
      (isReschedule
        ? parseIcsUidFromMeetingBody(existingMeeting?.body)
        : null) ||
      (isReschedule && existingMeeting
        ? `${existingMeeting.id}@worktual.crm`
        : null);
    const icsSequence = isReschedule
      ? parseIcsSequenceFromMeetingBody(existingMeeting?.body) + 1
      : 0;

    const body = buildMeetingActivityBody({
      topic,
      whenLabel,
      organizerName,
      organizerEmail,
      guestEmails: allGuests,
      provider: meetingProvider,
      meetingLink,
      calendarLink,
      googleEventId,
      externalMeetingId,
      previousWhenLabel,
      previousDueAt: isReschedule ? existingDue : null,
      rescheduled: isReschedule,
      icsUid,
      icsSequence,
    });

    // Reschedule = new live activity + strike off the previous open meeting
    // (any future day/time). Google event is patched in place when possible.
    const activity = await createContactActivity(input.contactId, {
      type: "meeting",
      subject,
      body,
      dueAt: start,
      folder: "inbox",
      createdByUserId: userId,
      organizationId,
      providerMessageId: googleEventId ? `gcal:${googleEventId}` : undefined,
    });
    const persistedIcsUid = icsUid || `${activity.id}@worktual.crm`;
    if (!icsUid || isReschedule) {
      await updateContactMeetingSchedule(activity.id, {
        dueAt: start,
        body: buildMeetingActivityBody({
          topic,
          whenLabel,
          organizerName,
          organizerEmail,
          guestEmails: allGuests,
          provider: meetingProvider,
          meetingLink,
          calendarLink,
          googleEventId,
          externalMeetingId,
          previousWhenLabel,
          previousDueAt: isReschedule ? existingDue : null,
          rescheduled: isReschedule,
          icsUid: persistedIcsUid,
          icsSequence,
        }),
        providerMessageId: googleEventId ? `gcal:${googleEventId}` : undefined,
      });
    }

    const endsAt = new Date(start.getTime() + durationMinutes * 60_000);
    void syncAppointmentForMeetingActivity({
      organizationId,
      contactId: input.contactId,
      hostUserId: userId,
      activityId: activity.id,
      source: "crm_ui",
      title: topic,
      startsAt: start,
      endsAt,
      timezone: timeZone,
      provider:
        meetingProvider === "zoom"
          ? "zoom"
          : meetingProvider === "teams"
            ? "teams"
            : "google_meet",
      joinUrl: meetingLink,
      calendarEventId: googleEventId,
      guestEmails: allGuests,
      isReschedule,
    }).catch((err) => {
      console.error("schedule-meeting: appointment sync failed", err);
    });

    if (isReschedule) {
      void (async () => {
        await cancelStaleMeetingCaptureBots(input.contactId, activity.id);
        await completeSupersededMeetings({
          contactId: input.contactId,
          keepActivityId: activity.id,
          supersedeActivityIds: existingMeeting ? [existingMeeting.id] : [],
        });
      })().catch((err) => {
        console.error("schedule-meeting: supersede/capture cleanup failed", err);
      });
    }
    if (!isReschedule) {
      notifyAdminsOfLeadEventAsync({
        kind: "lead_activity",
        contactId: input.contactId,
        contactName: contact.displayName,
        companyName: contact.person.company?.name ?? null,
        ownerUserId: contact.crm.ownerUserId ?? contact.person.ownerUserId,
        actorUserId: userId,
        activityType: "meeting",
        activitySubject: subject,
        href: `/contact/${input.contactId}`,
      });
    }
    // Do not block the schedule API on meeting-service / Vexa (up to 30s+).
    // Calendar + activity + invite must return quickly; capture runs in background.
    void (async () => {
      try {
        await cancelStaleMeetingCaptureBots(input.contactId, activity.id);
        await ensureAssistSessionForMeeting({
          activityId: activity.id,
          contactId: input.contactId,
          organizationId,
          hostUserId: userId,
          provider: meetingProvider,
          externalMeetingId: externalMeetingId || googleEventId || null,
          joinUrl: meetingLink,
        });
        const capture = await dispatchMeetingCaptureBot({
          activityId: activity.id,
          forceReschedule: isReschedule,
          userId,
          organizationId,
          consentCaptured: true,
        });
        if (!capture.ok && !capture.skipped) {
          console.error("meeting capture bot dispatch failed", capture.error);
        }
      } catch (err) {
        console.error("meeting capture bot setup failed", err);
      }
    })();
    if (!isReschedule) {
      void sendMeetingBriefToOwner({
        activityId: activity.id,
        contactId: input.contactId,
        organizationId,
        senderUserId: userId,
      }).catch((err) => {
        console.error("meeting brief to owner failed", err);
      });
      void enqueueLeadScoring({
        contactId: input.contactId,
        organizationId,
        triggerReason: "activity:meeting",
        processImmediately: true,
      }).catch((err) => {
        console.error("scoring enqueue after meeting failed", err);
      });
      triggerLeadLifecycle({
        contactId: input.contactId,
        organizationId,
        triggerReason: "activity:meeting",
      });
    }

    if (inviteViaGoogleCalendar) {
      void (async () => {
        try {
          const orgBrand = await resolveOrgBrand(organizationId);
          const mail = buildMeetingConfirmationEmail({
            contactFirstName:
              contact.person.firstName ||
              contact.displayName.split(" ")[0] ||
              "there",
            organizerName,
            organizerEmail,
            topic,
            whenLabel,
            meetLink: meetingLink,
            guestEmails: allGuests,
            provider: meetingProvider,
            includeIcsNote: false,
            rescheduled: isReschedule,
            previousWhenLabel,
            logoUrl: orgBrand.logoUrl,
            sellerName: orgBrand.sellerName,
          });
          await logCalendarInviteActivity({
            userId,
            contactId: input.contactId,
            subject: mail.subject,
            body: mail.body,
            note: isReschedule
              ? `Calendar update sent via Google Calendar (${meetingProviderLabel(meetingProvider)}).`
              : `Calendar invite sent via Google Calendar (${meetingProviderLabel(meetingProvider)}).`,
          });
          await markMeetingReminderWindows(activity.id, start);
        } catch (err) {
          console.error("schedule-meeting: google calendar finalize failed", err);
        }
      })();

      console.info("schedule-meeting: ok", {
        contactId: input.contactId,
        activityId: activity.id,
        provider: meetingProvider,
        ms: Date.now() - scheduleStarted,
      });

      return {
        ok: true,
        id: activity.id,
        confirmationSent: true,
        warning: assistWarning,
      };
    }

    const orgBrand = await resolveOrgBrand(organizationId);

    const mail = buildMeetingConfirmationEmail({
      contactFirstName:
        contact.person.firstName ||
        contact.displayName.split(" ")[0] ||
        "there",
      organizerName,
      organizerEmail,
      topic,
      whenLabel,
      meetLink: meetingLink,
      guestEmails: allGuests,
      provider: meetingProvider,
      includeIcsNote: true,
      rescheduled: isReschedule,
      previousWhenLabel,
      logoUrl: orgBrand.logoUrl,
      sellerName: orgBrand.sellerName,
    });

    {
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      const ics = buildMeetingIcs({
        uid: persistedIcsUid,
        topic,
        description: mail.body,
        start,
        end,
        organizerEmail:
          organizerEmail.includes("@") ? organizerEmail : "noreply@worktual.local",
        organizerName,
        attendeeEmails: allGuests,
        meetingUrl: meetingLink,
        method: "REQUEST",
        sequence: icsSequence,
      });
      const emailResult = await sendMeetingNotificationEmail({
        userId,
        contactId: input.contactId,
        to: contactEmail,
        subject: mail.subject,
        body: mail.body,
        cc: extraGuests.length > 0 ? extraGuests.join(", ") : undefined,
        ics,
      });
      if (!emailResult.ok) {
        return {
          ok: true,
          id: activity.id,
          confirmationSent: false,
          emailError: emailResult.error,
          needsConnect: emailResult.needsConnect,
          warning: assistWarning,
        };
      }
    }

    await markMeetingReminderWindows(activity.id, start);

    console.info("schedule-meeting: ok", {
      contactId: input.contactId,
      activityId: activity.id,
      provider: meetingProvider,
      ms: Date.now() - scheduleStarted,
    });

    return {
      ok: true,
      id: activity.id,
      confirmationSent: true,
      warning: assistWarning,
    };
  } catch (err) {
    console.error("schedule-meeting: failed", {
      contactId: input.contactId,
      ms: Date.now() - scheduleStarted,
      error: err instanceof Error ? err.message : err,
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to schedule meeting.",
    };
  }
}
