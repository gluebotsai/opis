import { createHash } from "node:crypto";

import type { DbClient } from "../lib/rls.js";
import type { PrismaClient } from "@ai-contact-center/db-cc";

import { withStaffContext } from "../lib/rls.js";

export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Session product written by Contact Center. Other products must use their own id. */
export const CONTACT_CENTER_SESSION_PRODUCT = "contact-center";

export function isSingleSessionEnforced(): boolean {
  return process.env.AUTH_SINGLE_SESSION !== "false";
}

async function purgeExpiredAuthSessionsForEmail(
  db: DbClient,
  email: string,
): Promise<void> {
  await db.auth_sessions.deleteMany({
    where: {
      email: { equals: email, mode: "insensitive" },
      expires_at: { lte: new Date() },
      product_id: CONTACT_CENTER_SESSION_PRODUCT,
    },
  });
}

export async function hasActiveAuthSession(
  prisma: PrismaClient,
  email: string,
): Promise<boolean> {
  const active = await fetchActiveAuthSessionEmails(prisma, [email]);
  return active.size > 0;
}

export async function fetchActiveAuthSessionEmails(
  prisma: PrismaClient,
  emails: string[],
): Promise<Set<string>> {
  const normalized = [
    ...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean)),
  ];
  if (normalized.length === 0) {
    return new Set();
  }

  return withStaffContext(prisma, async (db) => {
    await db.auth_sessions.deleteMany({
      where: {
        expires_at: { lte: new Date() },
        product_id: CONTACT_CENTER_SESSION_PRODUCT,
      },
    });
    const rows = await db.auth_sessions.findMany({
      where: {
        email: { in: normalized },
        expires_at: { gt: new Date() },
        product_id: CONTACT_CENTER_SESSION_PRODUCT,
      },
      select: { email: true },
      distinct: ["email"],
    });
    return new Set(rows.map((row) => row.email.toLowerCase()));
  });
}

export async function createAuthSession(
  prisma: PrismaClient,
  input: {
    token: string;
    email: string;
    role: string;
    displayName: string;
    expiresAt: Date;
  },
): Promise<void> {
  await withStaffContext(prisma, async (db) => {
    await purgeExpiredAuthSessionsForEmail(db, input.email);
    await db.auth_sessions.create({
      data: {
        token: hashAuthToken(input.token),
        email: input.email.trim().toLowerCase(),
        role: input.role,
        display_name: input.displayName,
        expires_at: input.expiresAt,
        product_id: CONTACT_CENTER_SESSION_PRODUCT,
      },
    });
  });
}

export async function isAuthSessionActive(
  prisma: PrismaClient,
  token: string,
): Promise<boolean> {
  return withStaffContext(prisma, async (db) => {
    const row = await db.auth_sessions.findUnique({
      where: { token: hashAuthToken(token) },
      select: { expires_at: true, product_id: true },
    });
    if (row == null || row.expires_at <= new Date()) return false;
    return row.product_id == null || row.product_id === CONTACT_CENTER_SESSION_PRODUCT;
  });
}

export async function claimPresenceInitialization(
  prisma: PrismaClient,
  token: string,
): Promise<boolean> {
  return withStaffContext(prisma, async (db) => {
    const rows = await db.$queryRaw<{ token: string }[]>`
      UPDATE accounts.auth_sessions
      SET presence_initialized_at = NOW()
      WHERE token = ${hashAuthToken(token)}
        AND expires_at > NOW()
        AND presence_initialized_at IS NULL
        AND (product_id IS NULL OR product_id = ${CONTACT_CENTER_SESSION_PRODUCT})
      RETURNING token
    `;
    return rows.length > 0;
  });
}

export async function revokeAuthSession(prisma: PrismaClient, token: string): Promise<void> {
  await withStaffContext(prisma, async (db) => {
    await db.auth_sessions.deleteMany({
      where: { token: hashAuthToken(token) },
    });
  });
}

export async function revokeAuthSessionsForEmail(
  prisma: PrismaClient,
  email: string,
): Promise<number> {
  const normalized = email.trim().toLowerCase();
  const result = await withStaffContext(prisma, async (db) =>
    db.auth_sessions.deleteMany({
      where: {
        email: { equals: normalized, mode: "insensitive" },
        product_id: CONTACT_CENTER_SESSION_PRODUCT,
      },
    }),
  );
  return result.count;
}

export async function purgeExpiredAuthSessions(prisma: PrismaClient): Promise<number> {
  const result = await withStaffContext(prisma, async (db) =>
    db.auth_sessions.deleteMany({
      where: {
        expires_at: { lte: new Date() },
        product_id: CONTACT_CENTER_SESSION_PRODUCT,
      },
    }),
  );
  return result.count;
}
