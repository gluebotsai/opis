import type { IntegrationProvider } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { getSetupUserById } from "@/service/account/setup-users";
import { getCurrentOrganizationId } from "@/service/auth/require-role";

export type CalendarProvider = "google" | "zoom" | "microsoft";

export type CalendarConnection = {
  id: string;
  userId: string;
  provider: CalendarProvider;
  accountEmail: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scope: string | null;
  updatedAt: Date;
};

function toProvider(provider: CalendarProvider): IntegrationProvider {
  return provider;
}

function mapRow(row: {
  id: string;
  userId: string;
  provider: IntegrationProvider;
  accountEmail: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scope: string | null;
  updatedAt: Date;
}): CalendarConnection {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider as CalendarProvider,
    accountEmail: row.accountEmail,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    tokenExpiresAt: row.tokenExpiresAt,
    scope: row.scope,
    updatedAt: row.updatedAt,
  };
}

export async function getCalendarConnection(
  userId: string,
  provider: CalendarProvider,
): Promise<CalendarConnection | null> {
  const row = await prisma.userIntegrationConnection.findUnique({
    where: {
      userId_provider: { userId, provider: toProvider(provider) },
    },
  });
  return row ? mapRow(row) : null;
}

export async function listCalendarConnections(userId: string) {
  const rows = await prisma.userIntegrationConnection.findMany({
    where: { userId },
    select: { provider: true, accountEmail: true },
  });
  return rows.map((r) => ({
    provider: r.provider as CalendarProvider,
    accountEmail: r.accountEmail,
  }));
}

async function resolveOrganizationIdForUser(userId: string): Promise<string> {
  const setupUser = await getSetupUserById(userId);
  const fromUser = setupUser?.organization_id?.trim() || null;
  if (fromUser) return fromUser;
  const fromSession = await getCurrentOrganizationId();
  if (!fromSession?.trim()) {
    throw new Error(
      "Cannot upsert calendar connection without organizationId.",
    );
  }
  return fromSession;
}

export async function upsertCalendarConnection(input: {
  userId: string;
  provider: CalendarProvider;
  accountEmail?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scope?: string | null;
}) {
  const organizationId = await resolveOrganizationIdForUser(input.userId);
  const row = await prisma.userIntegrationConnection.upsert({
    where: {
      userId_provider: {
        userId: input.userId,
        provider: toProvider(input.provider),
      },
    },
    create: {
      organizationId,
      userId: input.userId,
      provider: toProvider(input.provider),
      accountEmail: input.accountEmail ?? null,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      scope: input.scope ?? null,
    },
    update: {
      organizationId,
      accountEmail: input.accountEmail ?? null,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? undefined,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      scope: input.scope ?? null,
    },
  });
  return mapRow(row);
}

export async function deleteCalendarConnection(
  userId: string,
  provider: CalendarProvider,
) {
  await prisma.userIntegrationConnection.deleteMany({
    where: { userId, provider: toProvider(provider) },
  });
}

/** Mail inbox/send uses one of Google or Microsoft — never both. */
export async function deleteOtherMailProvider(
  userId: string,
  keep: "google" | "microsoft",
) {
  const other = keep === "google" ? "microsoft" : "google";
  await deleteCalendarConnection(userId, other);
}

/**
 * If both Google and Microsoft mail tokens exist, keep one and drop the other.
 * Prefers `preferred` when that connection exists; otherwise the newer token.
 * Returns the kept provider when a conflict was resolved (caller may set cookie).
 */
export async function ensureExclusiveMailProvider(
  userId: string,
  preferred: "google" | "microsoft" | null,
): Promise<"google" | "microsoft" | null> {
  const google = await getCalendarConnection(userId, "google");
  const microsoft = await getCalendarConnection(userId, "microsoft");
  if (!google || !microsoft) return null;

  const keep: "google" | "microsoft" =
    preferred === "google" || preferred === "microsoft"
      ? preferred
      : google.updatedAt.getTime() >= microsoft.updatedAt.getTime()
        ? "google"
        : "microsoft";

  await deleteOtherMailProvider(userId, keep);
  return keep;
}

export async function updateCalendarTokens(
  userId: string,
  provider: CalendarProvider,
  input: {
    accessToken: string;
    refreshToken?: string | null;
    tokenExpiresAt?: Date | null;
  },
) {
  await prisma.userIntegrationConnection.updateMany({
    where: { userId, provider: toProvider(provider) },
    data: {
      accessToken: input.accessToken,
      ...(input.refreshToken != null
        ? { refreshToken: input.refreshToken }
        : {}),
      tokenExpiresAt: input.tokenExpiresAt ?? null,
    },
  });
}
