import { prisma } from "@/dao/db/prisma";

export type GoogleCalendarWatchRow = {
  id: string;
  organizationId: string;
  userId: string;
  channelId: string;
  resourceId: string | null;
  channelToken: string;
  syncToken: string | null;
  expiration: Date | null;
};

function mapRow(row: {
  id: string;
  organizationId: bigint;
  userId: bigint;
  channelId: string;
  resourceId: string | null;
  channelToken: string;
  syncToken: string | null;
  expiration: Date | null;
}): GoogleCalendarWatchRow {
  return {
    id: row.id,
    organizationId: row.organizationId.toString(),
    userId: row.userId.toString(),
    channelId: row.channelId,
    resourceId: row.resourceId,
    channelToken: row.channelToken,
    syncToken: row.syncToken,
    expiration: row.expiration,
  };
}

export async function findGoogleCalendarWatchByUserId(
  userId: string,
): Promise<GoogleCalendarWatchRow | null> {
  const id = userId.trim();
  if (!id) return null;
  const row = await prisma.googleCalendarWatch.findUnique({
    where: { userId: BigInt(id) },
  });
  return row ? mapRow(row) : null;
}

export async function findGoogleCalendarWatchByChannelId(
  channelId: string,
): Promise<GoogleCalendarWatchRow | null> {
  const id = channelId.trim();
  if (!id) return null;
  const row = await prisma.googleCalendarWatch.findUnique({
    where: { channelId: id },
  });
  return row ? mapRow(row) : null;
}

export async function upsertGoogleCalendarWatch(input: {
  organizationId: string;
  userId: string;
  channelId: string;
  resourceId?: string | null;
  channelToken: string;
  syncToken?: string | null;
  expiration?: Date | null;
}): Promise<GoogleCalendarWatchRow> {
  const userId = BigInt(input.userId);
  const organizationId = BigInt(input.organizationId);
  const row = await prisma.googleCalendarWatch.upsert({
    where: { userId },
    create: {
      organizationId,
      userId,
      channelId: input.channelId,
      resourceId: input.resourceId ?? null,
      channelToken: input.channelToken,
      syncToken: input.syncToken ?? null,
      expiration: input.expiration ?? null,
    },
    update: {
      organizationId,
      channelId: input.channelId,
      resourceId: input.resourceId ?? undefined,
      channelToken: input.channelToken,
      syncToken: input.syncToken ?? undefined,
      expiration: input.expiration ?? undefined,
    },
  });
  return mapRow(row);
}

export async function updateGoogleCalendarWatchSyncToken(
  userId: string,
  syncToken: string | null,
): Promise<void> {
  await prisma.googleCalendarWatch.update({
    where: { userId: BigInt(userId) },
    data: { syncToken },
  });
}

export async function listGoogleCalendarWatchesExpiringSoon(
  withinMs = 48 * 60 * 60_000,
  limit = 80,
): Promise<GoogleCalendarWatchRow[]> {
  const cutoff = new Date(Date.now() + withinMs);
  const rows = await prisma.googleCalendarWatch.findMany({
    where: {
      OR: [{ expiration: null }, { expiration: { lte: cutoff } }],
    },
    orderBy: { expiration: "asc" },
    take: limit,
  });
  return rows.map(mapRow);
}

export async function listAllGoogleCalendarWatches(
  limit = 200,
): Promise<GoogleCalendarWatchRow[]> {
  const rows = await prisma.googleCalendarWatch.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows.map(mapRow);
}
