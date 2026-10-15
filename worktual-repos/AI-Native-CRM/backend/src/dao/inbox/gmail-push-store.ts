import type { GmailPushWatchKind } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";

export type GmailPushWatchRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  accountEmail: string;
  watchKind: GmailPushWatchKind;
  historyId: string | null;
  expiration: Date | null;
};

function mapRow(row: {
  id: string;
  organizationId: bigint | null;
  userId: bigint | null;
  accountEmail: string;
  watchKind: GmailPushWatchKind;
  historyId: string | null;
  expiration: Date | null;
}): GmailPushWatchRow {
  return {
    id: row.id,
    organizationId: row.organizationId?.toString() ?? null,
    userId: row.userId?.toString() ?? null,
    accountEmail: row.accountEmail,
    watchKind: row.watchKind,
    historyId: row.historyId,
    expiration: row.expiration,
  };
}

export async function findGmailPushWatchByEmail(
  accountEmail: string,
): Promise<GmailPushWatchRow | null> {
  const email = accountEmail.trim().toLowerCase();
  if (!email) return null;
  const row = await prisma.gmailPushWatch.findFirst({
    where: { accountEmail: { equals: email, mode: "insensitive" } },
  });
  return row ? mapRow(row) : null;
}

export async function upsertGmailPushWatch(input: {
  organizationId?: string | null;
  userId?: string | null;
  accountEmail: string;
  watchKind: GmailPushWatchKind;
  historyId: string;
  expiration: Date;
}): Promise<GmailPushWatchRow> {
  const email = input.accountEmail.trim().toLowerCase();
  const orgId =
    input.organizationId?.trim() != null && input.organizationId.trim() !== ""
      ? BigInt(input.organizationId.trim())
      : null;
  const userId =
    input.userId?.trim() != null && input.userId.trim() !== ""
      ? BigInt(input.userId.trim())
      : null;
  const historyId =
    input.historyId != null && String(input.historyId).trim() !== ""
      ? String(input.historyId)
      : null;

  const updateData = {
    organizationId: orgId ?? undefined,
    userId: userId ?? undefined,
    watchKind: input.watchKind,
    historyId,
    expiration: input.expiration,
    accountEmail: email,
  };

  // DB unique index is on lower(account_email), not account_email — Prisma upsert ON CONFLICT fails (42P10).
  const existing = await findGmailPushWatchByEmail(email);
  if (existing) {
    const row = await prisma.gmailPushWatch.update({
      where: { id: existing.id },
      data: updateData,
    });
    return mapRow(row);
  }

  try {
    const row = await prisma.gmailPushWatch.create({
      data: {
        organizationId: orgId,
        userId,
        accountEmail: email,
        watchKind: input.watchKind,
        historyId,
        expiration: input.expiration,
      },
    });
    return mapRow(row);
  } catch {
    const raced = await findGmailPushWatchByEmail(email);
    if (!raced) throw new Error(`gmail push watch create failed for ${email}`);
    const row = await prisma.gmailPushWatch.update({
      where: { id: raced.id },
      data: updateData,
    });
    return mapRow(row);
  }
}

export async function updateGmailPushWatchHistoryId(
  id: string,
  historyId: string,
): Promise<void> {
  await prisma.gmailPushWatch.update({
    where: { id },
    data: { historyId },
  });
}

/** Watches expiring within the next `withinMs` (default 48h). Gmail max ~7 days. */
export async function listGmailPushWatchesExpiringSoon(
  withinMs = 48 * 60 * 60_000,
  limit = 50,
): Promise<GmailPushWatchRow[]> {
  const cutoff = new Date(Date.now() + withinMs);
  const rows = await prisma.gmailPushWatch.findMany({
    where: {
      OR: [{ expiration: null }, { expiration: { lte: cutoff } }],
    },
    orderBy: { expiration: "asc" },
    take: limit,
  });
  return rows.map(mapRow);
}

export async function listAllGmailPushWatches(
  limit = 100,
): Promise<GmailPushWatchRow[]> {
  const rows = await prisma.gmailPushWatch.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows.map(mapRow);
}
