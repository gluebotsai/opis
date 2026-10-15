/**
 * Inbound Microsoft Calendar → CRM meeting activities (known contacts only).
 * Idempotent via providerMessageId = `mscal:{eventId}`.
 */

import { prisma } from "@/dao/db/prisma";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { findCrmContactIdByEmails } from "@/dao/inbox/contact-by-email";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import { buildMeetingActivityBody } from "@/lib/meeting-body";
import { getSetupUserById } from "@/service/account/setup-users";
import { getValidMicrosoftAccessToken } from "@/service/microsoft/send-email";
import { listMicrosoftCalendarEvents } from "@/service/microsoft/calendar";
import {
  microsoftHasCalendarReadScope,
} from "@/service/microsoft/oauth";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import type { CalendarSyncResult } from "@/dao/calendar/sync-google-calendar";

function mscalProviderId(eventId: string): string {
  return `mscal:${eventId}`;
}

export async function syncInboundMicrosoftCalendarForUser(
  userId: string,
): Promise<CalendarSyncResult> {
  try {
    const setupUser = await getSetupUserById(userId);
    const organizationId = setupUser?.organization_id?.trim() || null;
    if (!organizationId) {
      return {
        ok: false,
        imported: 0,
        skipped: 0,
        needsReconnect: false,
        error: "Organization not found for this user.",
      };
    }

    const conn = await getCalendarConnection(userId, "microsoft");
    if (!conn?.accessToken) {
      return {
        ok: true,
        imported: 0,
        skipped: 0,
        needsReconnect: false,
      };
    }
    if (!microsoftHasCalendarReadScope(conn.scope)) {
      return {
        ok: true,
        imported: 0,
        skipped: 0,
        needsReconnect: true,
        error:
          "Microsoft calendar scope missing — reconnect Microsoft to grant Calendars.Read.",
      };
    }

    let accessToken: string | null;
    try {
      accessToken = await getValidMicrosoftAccessToken(userId);
    } catch (err) {
      return {
        ok: false,
        imported: 0,
        skipped: 0,
        needsReconnect: true,
        error:
          err instanceof Error
            ? err.message
            : "Failed to refresh Microsoft access token.",
      };
    }
    if (!accessToken) {
      return {
        ok: true,
        imported: 0,
        skipped: 0,
        needsReconnect: true,
        error: "Connect Microsoft calendar first.",
      };
    }

    const now = Date.now();
    const startDateTime = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
    const endDateTime = new Date(now + 30 * 24 * 60 * 60_000).toISOString();

    let events;
    try {
      events = await listMicrosoftCalendarEvents({
        accessToken,
        startDateTime,
        endDateTime,
      });
    } catch (err) {
      return {
        ok: false,
        imported: 0,
        skipped: 0,
        needsReconnect: false,
        error:
          err instanceof Error
            ? err.message
            : "Microsoft calendar list failed",
      };
    }

    let imported = 0;
    let skipped = 0;
    const mailboxEmail = (conn.accountEmail || "").trim().toLowerCase();

    for (const ev of events) {
      const providerMessageId = mscalProviderId(ev.id);
      const existing = await prisma.contactActivity.findUnique({
        where: { providerMessageId },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      const organizer =
        (ev.organizerEmail || mailboxEmail || "").toLowerCase() || null;
      const guestEmails = ev.attendeeEmails.filter(
        (e) => e !== organizer && e !== mailboxEmail,
      );
      const matchEmails =
        guestEmails.length > 0
          ? guestEmails
          : ev.attendeeEmails.filter((e) => e !== mailboxEmail);
      if (matchEmails.length === 0) {
        skipped += 1;
        continue;
      }

      const contactId = await findCrmContactIdByEmails(
        matchEmails,
        organizationId,
      );
      if (!contactId) {
        skipped += 1;
        continue;
      }

      const start = new Date(ev.startAt);
      const whenLabel = Number.isNaN(start.getTime())
        ? ev.startAt
        : start.toLocaleString();
      const body = buildMeetingActivityBody({
        topic: ev.subject,
        whenLabel,
        organizerName: (organizer || "organizer").split("@")[0],
        organizerEmail: organizer || "unknown@calendar.local",
        guestEmails: guestEmails.length ? guestEmails : matchEmails,
        provider: "teams",
        meetingLink: ev.onlineMeetingUrl,
        calendarLink: ev.webLink,
        externalMeetingId: ev.id,
      });

      try {
        await createContactActivity(contactId, {
          type: "meeting",
          subject: ev.subject,
          body,
          dueAt: Number.isNaN(start.getTime()) ? null : start,
          folder: "inbox",
          providerMessageId,
          mailProvider: "microsoft",
          createdByUserId: userId,
          organizationId,
        });
        imported += 1;
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
          skipped += 1;
          continue;
        }
        skipped += 1;
      }
    }

    return { ok: true, imported, skipped, needsReconnect: false };
  } catch (err) {
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      needsReconnect: false,
      error:
        err instanceof Error ? err.message : "Microsoft calendar sync failed",
    };
  }
}
