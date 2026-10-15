/**
 * Accounts → CRM onboarding dashboard deep-link.
 * Password stays in Accounts. We mint a one-time URL, then the SPA exchanges it.
 */

import { timingSafeEqual } from "crypto";
import {
  sessionUserFromSetupRow,
  type AuthenticatedUser,
} from "@/service/account/auth-service";
import {
  getSetupUserByEmail,
  getSetupUserById,
  type SetupUserRow,
} from "@/service/account/setup-users";
import { normalizeRole } from "@/service/auth/rbac";
import {
  consumeOnboardingCode,
  generateOnboardingCode,
  ONBOARDING_CODE_TTL_SECONDS,
  saveOnboardingCode,
} from "@/service/auth/onboarding-code-store";

export function onboardingHomePath(role: string | null | undefined): string {
  return normalizeRole(role) === "marketing"
    ? "/marketing/dashboard"
    : "/dashboard";
}

export function publicAppUrl(): string {
  const raw =
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.FRONTEND_ORIGIN?.trim() ||
    "http://localhost:5173";
  return raw.replace(/\/$/, "");
}

export function isInternalServiceKeyAuthorized(
  header: string | string[] | undefined,
): boolean {
  const expected = process.env.INTERNAL_SERVICE_KEY?.trim() ?? "";
  if (!expected) return false;
  const provided = Array.isArray(header)
    ? (header[0]?.trim() ?? "")
    : (header?.trim() ?? "");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hasPassword(user: SetupUserRow): boolean {
  return Boolean(user.password_hash?.trim());
}

export type MintOnboardingLinkResult =
  | {
      ok: true;
      url: string;
      expiresIn: number;
      user: { id: string; email: string; organizationId: string };
    }
  | { ok: false; status: 400 | 404 | 409; error: string };

export async function mintOnboardingDashboardLink(input: {
  email?: string;
  userId?: string;
}): Promise<MintOnboardingLinkResult> {
  const email = input.email?.trim() ?? "";
  const userId = input.userId?.trim() ?? "";
  if (!email && !userId) {
    return { ok: false, status: 400, error: "Email or userId is required." };
  }

  let row: SetupUserRow | null = null;
  if (email) {
    row = await getSetupUserByEmail(email);
    if (row && userId && row.id !== userId) {
      return { ok: false, status: 404, error: "User not found or inactive in your product." };
    }
  } else {
    row = await getSetupUserById(userId);
  }

  if (!row || row.status !== "active" || !row.crm_role_name) {
    return {
      ok: false,
      status: 404,
      error: "User not found or inactive in your product.",
    };
  }

  const sessionUser = sessionUserFromSetupRow(row);
  if (!sessionUser) {
    return {
      ok: false,
      status: 404,
      error: "User not found or inactive in your product.",
    };
  }

  if (!hasPassword(row)) {
    return {
      ok: false,
      status: 409,
      error: "Password not set yet / user not ready",
    };
  }

  const code = generateOnboardingCode();
  await saveOnboardingCode(code, sessionUser.id);
  const url = `${publicAppUrl()}/auth/onboarding?code=${encodeURIComponent(code)}`;
  return {
    ok: true,
    url,
    expiresIn: ONBOARDING_CODE_TTL_SECONDS,
    user: {
      id: sessionUser.id,
      email: sessionUser.email,
      organizationId: sessionUser.organizationId,
    },
  };
}

export type ExchangeOnboardingCodeResult =
  | {
      ok: true;
      user: AuthenticatedUser;
      redirectTo: string;
    }
  | { ok: false; status: 400 | 401; error: string };

export async function exchangeOnboardingCode(
  code: string | undefined,
): Promise<ExchangeOnboardingCodeResult> {
  const trimmed = code?.trim() ?? "";
  if (!trimmed) {
    return {
      ok: false,
      status: 400,
      error: "This onboarding link is invalid or has expired.",
    };
  }

  const userId = await consumeOnboardingCode(trimmed);
  if (!userId) {
    return {
      ok: false,
      status: 400,
      error: "This onboarding link is invalid or has expired.",
    };
  }

  const row = await getSetupUserById(userId);
  const user = row ? sessionUserFromSetupRow(row) : null;
  if (!user) {
    return { ok: false, status: 401, error: "Not signed in." };
  }

  return {
    ok: true,
    user,
    redirectTo: onboardingHomePath(user.role),
  };
}
