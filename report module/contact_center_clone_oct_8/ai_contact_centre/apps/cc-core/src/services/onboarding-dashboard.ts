import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@ai-contact-center/db-cc";
import { z } from "zod";

import { serializeEntityId } from "../lib/id-schema.js";
import { withStaffContext } from "../lib/rls.js";
import { hashAuthToken } from "./auth-sessions.js";
import {
  issueSetupUserSession,
  loadContactCenterSetupUser,
  type LoginResult,
} from "./auth.js";

export const ONBOARDING_CODE_TTL_SECONDS = 900;

export const mintOnboardingLinkSchema = z
  .object({
    email: z.string().trim().email().optional(),
    userId: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.email || value.userId), {
    message: "email or userId is required",
  });

export const exchangeOnboardingCodeSchema = z.object({
  code: z.string().trim().min(1),
});

export type MintOnboardingLinkResult = {
  statusCode: 200;
  message: string;
  url: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    organizationId: string;
  };
};

export type ExchangeOnboardingResult = LoginResult & {
  redirectTo: string;
};

function publicAppUrl(): string {
  return (
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.WEB_APP_URL?.trim() ||
    "http://localhost:5173"
  ).replace(/\/$/, "");
}

function homePath(role: "admin" | "agent"): string {
  return role === "admin" ? "/admin/dashboard" : "/agent/workspace";
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

export async function mintOnboardingDashboardLink(
  prisma: PrismaClient,
  input: { email?: string; userId?: string },
): Promise<MintOnboardingLinkResult> {
  const user = await loadContactCenterSetupUser(prisma, input);
  if (!user) {
    throw httpError(404, "User not found or inactive in Contact Center.");
  }
  if (!user.password_hash) {
    throw httpError(409, "Password is not set yet.");
  }

  const code = randomBytes(32).toString("base64url");
  const codeHash = hashAuthToken(code);
  const expiresAt = new Date(Date.now() + ONBOARDING_CODE_TTL_SECONDS * 1000);

  await withStaffContext(prisma, async (db) => {
    await db.onboarding_dashboard_codes.updateMany({
      where: { setup_user_id: user.id, consumed_at: null },
      data: { consumed_at: new Date() },
    });
    await db.onboarding_dashboard_codes.create({
      data: {
        code_hash: codeHash,
        setup_user_id: user.id,
        organization_id: user.organization_id,
        email: user.work_email,
        expires_at: expiresAt,
      },
    });
  });

  const userId = serializeEntityId(user.id);
  const organizationId = serializeEntityId(user.organization_id);
  return {
    statusCode: 200,
    message: "Onboarding dashboard link created",
    url: `${publicAppUrl()}/auth/onboarding?code=${encodeURIComponent(code)}`,
    expiresIn: ONBOARDING_CODE_TTL_SECONDS,
    user: {
      id: userId,
      email: user.work_email,
      organizationId,
    },
  };
}

export async function exchangeOnboardingCode(
  prisma: PrismaClient,
  code: string,
  jwtSecret: string,
): Promise<ExchangeOnboardingResult> {
  const codeHash = hashAuthToken(code);
  const now = new Date();

  const consumed = await withStaffContext(prisma, async (db) => {
    const row = await db.onboarding_dashboard_codes.findFirst({
      where: {
        code_hash: codeHash,
        consumed_at: null,
        expires_at: { gt: now },
      },
      select: { id: true, setup_user_id: true },
    });
    if (!row) return null;
    const updated = await db.onboarding_dashboard_codes.updateMany({
      where: { id: row.id, consumed_at: null, expires_at: { gt: now } },
      data: { consumed_at: now },
    });
    if (updated.count === 0) return null;
    return row;
  });

  if (!consumed) {
    throw httpError(401, "Onboarding link is invalid or has expired.");
  }

  const user = await loadContactCenterSetupUser(prisma, {
    userId: serializeEntityId(consumed.setup_user_id),
  });
  if (!user?.password_hash) {
    throw httpError(404, "User not found or inactive in Contact Center.");
  }

  const session = await issueSetupUserSession(prisma, user, jwtSecret, {
    revokeExisting: true,
  });
  return {
    ...session,
    redirectTo: homePath(session.user.role),
  };
}
