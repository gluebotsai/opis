/**
 * Provider-agnostic calendar inbound sync (Google + Microsoft).
 * Mirrors mailbox sync — cron + optional manual poll.
 */

import { prisma } from "@/dao/db/prisma";
import { syncInboundGoogleCalendarForUser } from "@/dao/calendar/sync-google-calendar";
import { syncInboundMicrosoftCalendarForUser } from "@/dao/calendar/sync-microsoft-calendar";
import { googleHasCalendarScope } from "@/service/google/access-token";
import { microsoftHasCalendarReadScope } from "@/service/microsoft/oauth";

export type CalendarSyncBatchResult = {
  imported: number;
  skipped: number;
  anyConnected: boolean;
  errors: string[];
};

export async function syncConnectedCalendarsForUser(
  userId: string,
): Promise<CalendarSyncBatchResult> {
  let imported = 0;
  let skipped = 0;
  let anyConnected = false;
  const errors: string[] = [];

  const google = await syncInboundGoogleCalendarForUser(userId);
  if (google.ok) {
    imported += google.imported;
    skipped += google.skipped;
    if (!google.needsReconnect && (google.imported > 0 || google.skipped >= 0)) {
      // Connected when we didn't need reconnect and had a usable token path
      if (!google.error) anyConnected = true;
    }
    if (google.needsReconnect && google.error) errors.push(google.error);
  } else if (google.error) {
    errors.push(google.error);
  }

  const microsoft = await syncInboundMicrosoftCalendarForUser(userId);
  if (microsoft.ok) {
    imported += microsoft.imported;
    skipped += microsoft.skipped;
    if (!microsoft.needsReconnect && !microsoft.error) anyConnected = true;
    if (microsoft.needsReconnect && microsoft.error) errors.push(microsoft.error);
  } else if (microsoft.error) {
    errors.push(microsoft.error);
  }

  return { imported, skipped, anyConnected, errors };
}

export async function listCalendarReadableUserIds(
  limit = 50,
): Promise<string[]> {
  const rows = await prisma.userIntegrationConnection.findMany({
    where: { provider: { in: ["google", "microsoft"] } },
    select: {
      userId: true,
      provider: true,
      scope: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: limit * 4,
  });

  const userIds = new Set<string>();
  for (const row of rows) {
    const canRead =
      row.provider === "google"
        ? googleHasCalendarScope(row.scope)
        : microsoftHasCalendarReadScope(row.scope);
    if (canRead) userIds.add(row.userId);
    if (userIds.size >= limit) break;
  }
  return [...userIds];
}

export async function syncAllConnectedCalendars(limit = 25): Promise<{
  users: number;
  imported: number;
  skipped: number;
}> {
  const userIds = await listCalendarReadableUserIds(limit);
  let imported = 0;
  let skipped = 0;
  for (const userId of userIds) {
    try {
      const result = await syncConnectedCalendarsForUser(userId);
      imported += result.imported;
      skipped += result.skipped;
    } catch (err) {
      console.error("calendar sync failed", userId, err);
    }
  }
  return { users: userIds.length, imported, skipped };
}
