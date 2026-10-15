/**
 * Inbound Google Calendar → CRM meeting activities + notetaker dispatch.
 * Prefer Google Calendar HTTPS push (`google-calendar-push.ts`). This poll
 * remains a fallback when CALENDAR_PUSH_WEBHOOK_URL is unset.
 */

import { getCalendarConnection } from "@/dao/calendar/token-repository";
import { getSetupUserById } from "@/service/account/setup-users";
import {
  getValidGoogleAccessToken,
  googleHasCalendarScope,
} from "@/service/google/access-token";
import { listGoogleCalendarEvents } from "@/service/google/calendar";
import { ingestGoogleCalendarMeetEvent } from "@/service/calendar/google-calendar-push";

export type CalendarSyncResult = {
  ok: boolean;
  imported: number;
  skipped: number;
  needsReconnect: boolean;
  error?: string;
};

export async function syncInboundGoogleCalendarForUser(
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

    const conn = await getCalendarConnection(userId, "google");
    if (!conn?.accessToken) {
      return {
        ok: true,
        imported: 0,
        skipped: 0,
        needsReconnect: false,
      };
    }
    if (!googleHasCalendarScope(conn.scope || "")) {
      return {
        ok: true,
        imported: 0,
        skipped: 0,
        needsReconnect: true,
        error: "Google calendar scope missing — reconnect Google.",
      };
    }

    let accessToken: string | null;
    try {
      accessToken = await getValidGoogleAccessToken(userId);
    } catch (err) {
      return {
        ok: false,
        imported: 0,
        skipped: 0,
        needsReconnect: true,
        error:
          err instanceof Error
            ? err.message
            : "Failed to refresh Google access token.",
      };
    }
    if (!accessToken) {
      return {
        ok: true,
        imported: 0,
        skipped: 0,
        needsReconnect: true,
        error: "Connect Google calendar first.",
      };
    }

    const now = Date.now();
    const timeMin = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
    const timeMax = new Date(now + 30 * 24 * 60 * 60_000).toISOString();

    let events;
    try {
      events = await listGoogleCalendarEvents({
        accessToken,
        timeMin,
        timeMax,
      });
    } catch (err) {
      return {
        ok: false,
        imported: 0,
        skipped: 0,
        needsReconnect: false,
        error:
          err instanceof Error ? err.message : "Google calendar list failed",
      };
    }

    let imported = 0;
    let skipped = 0;
    const organizerEmail = (conn.accountEmail || "").trim().toLowerCase();

    for (const ev of events) {
      const result = await ingestGoogleCalendarMeetEvent({
        userId,
        organizationId,
        organizerEmail,
        event: ev,
      });
      if (result.imported) imported += 1;
      else skipped += 1;
    }

    return { ok: true, imported, skipped, needsReconnect: false };
  } catch (err) {
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      needsReconnect: false,
      error: err instanceof Error ? err.message : "Google calendar sync failed",
    };
  }
}
