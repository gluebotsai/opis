import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  authenticateCampaignUser,
  getSessionUserForOnboarding,
} from "../../dao/auth.js";
import {
  loginBodySchema,
  onboardingDashboardLinkBodySchema,
  onboardingExchangeBodySchema,
} from "./schema.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { requireInternalServiceKey } from "../../helpers/internal-service-auth.js";
import { requireSession } from "../../middlewares/authendication.js";
import { cacheSet, cacheDel, cacheGet } from "../../plugins/redis.js";
import { RESPONSE } from "../../helpers/constants.js";
import { env } from "../../config/env.js";
import type { CampaignSessionUser } from "../../types/auth.js";
import {
  assertCampaignAuthSessionAvailable,
  campaignAuthExpiresAt,
  deleteCampaignAuthSessions,
  insertCampaignAuthSession,
} from "../../dao/accounts-auth-sessions.js";

const ONBOARDING_CODE_TTL_SECONDS = 15 * 60;
const ONBOARDING_CODE_PREFIX = "onboarding:code:";

async function mintCampaignJwt(
  reply: FastifyReply,
  user: CampaignSessionUser,
  expiresIn = "7d",
): Promise<string> {
  return reply.jwtSign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      branchId: user.branchId,
      mode: user.mode,
      industry: user.industry,
      industryType: user.industryType,
    },
    { expiresIn },
  );
}

async function persistSession(user: CampaignSessionUser): Promise<void> {
  await cacheSet(
    `session:${user.id}`,
    JSON.stringify(user),
    60 * 60 * 24 * 7,
  );
}

export async function loginHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const parsed = loginBodySchema.safeParse(request.body);
  if (!parsed.success) {
    throw new AppError("Email and password are required.");
  }

  let user: CampaignSessionUser;
  try {
    user = await authenticateCampaignUser(parsed.data);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const code = String((err as { code?: unknown })?.code || "");
    const message = err instanceof Error ? err.message : String(err);
    if (
      code === "53300" ||
      /too many clients/i.test(message) ||
      /remaining connection slots/i.test(message)
    ) {
      throw new AppError(
        "Account service is temporarily unavailable. Please try again in a moment.",
        503,
        "ACCOUNT_UNAVAILABLE",
      );
    }
    throw err;
  }
  await assertCampaignAuthSessionAvailable(user.email);
  const token = await mintCampaignJwt(
    reply,
    user,
    parsed.data.remember ? "30d" : "7d",
  );
  await persistSession(user);
  try {
    await insertCampaignAuthSession({
      email: user.email,
      userId: user.id,
      token,
      expiresAt: campaignAuthExpiresAt(parsed.data.remember),
    });
  } catch (err) {
    console.warn(
      "[auth] accounts.auth_sessions insert failed:",
      err instanceof Error ? err.message : err,
    );
  }

  return sendSuccess(reply, RESPONSE.login_success, { token, user });
}

/** Onboarding team: one-time dashboard URL after Accounts set-password. */
export async function onboardingDashboardLinkHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  requireInternalServiceKey(request);

  const parsed = onboardingDashboardLinkBodySchema.safeParse(request.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? RESPONSE.bad_request);
  }

  const user = await getSessionUserForOnboarding(parsed.data);
  const code = randomBytes(24).toString("base64url");
  await cacheSet(
    `${ONBOARDING_CODE_PREFIX}${code}`,
    JSON.stringify({ userId: user.id }),
    ONBOARDING_CODE_TTL_SECONDS,
  );

  const base = env.appUrl.replace(/\/$/, "");
  const url = `${base}/auth/onboarding?code=${encodeURIComponent(code)}`;

  return sendSuccess(reply, RESPONSE.onboarding_link_created, {
    url,
    expiresIn: ONBOARDING_CODE_TTL_SECONDS,
    user: { id: user.id, email: user.email, organizationId: user.organizationId },
  });
}

/** Browser: exchange one-time onboarding code for Campaign SPA JWT. */
export async function onboardingExchangeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const parsed = onboardingExchangeBodySchema.safeParse(request.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? RESPONSE.bad_request);
  }

  const code = parsed.data.code.trim();
  const cacheKey = `${ONBOARDING_CODE_PREFIX}${code}`;
  const raw = await cacheGet(cacheKey);
  if (!raw) {
    throw new AppError(RESPONSE.onboarding_code_invalid, 401);
  }

  let payload: { userId?: string };
  try {
    payload = JSON.parse(raw) as { userId?: string };
  } catch {
    throw new AppError(RESPONSE.onboarding_code_invalid, 401);
  }

  const userId = String(payload.userId || "").trim();
  if (!userId) {
    throw new AppError(RESPONSE.onboarding_code_invalid, 401);
  }

  const user = await getSessionUserForOnboarding({ userId });
  await assertCampaignAuthSessionAvailable(user.email);
  await cacheDel(cacheKey);

  const token = await mintCampaignJwt(reply, user);
  await persistSession(user);
  try {
    await insertCampaignAuthSession({
      email: user.email,
      userId: user.id,
      token,
      expiresAt: campaignAuthExpiresAt(false),
    });
  } catch (err) {
    console.warn(
      "[auth] accounts.auth_sessions onboarding insert failed:",
      err instanceof Error ? err.message : err,
    );
  }

  return sendSuccess(reply, RESPONSE.onboarding_exchange_success, {
    token,
    user,
    redirectTo: "/dashboard",
  });
}

export async function meHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = requireSession(request);
  return sendSuccess(reply, RESPONSE.session_success, { user });
}

export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const user = requireSession(request);
  await cacheDel(`session:${user.id}`);
  try {
    await deleteCampaignAuthSessions(user.email);
  } catch (err) {
    console.warn(
      "[auth] accounts.auth_sessions delete failed:",
      err instanceof Error ? err.message : err,
    );
  }
  return sendSuccess(reply, RESPONSE.logout_success);
}
