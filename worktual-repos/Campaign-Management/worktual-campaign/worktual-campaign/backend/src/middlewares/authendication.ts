import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import {
  getSessionUserById,
  getSessionUserFromCrmAccess,
} from "../dao/auth.js";
import {
  isCrmJwtConfigured,
  verifyCrmAccessToken,
} from "../services/crm-jwt.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError, UnauthorizedError } from "../helpers/response-builders.js";
import { cacheGet, cacheSet } from "../plugins/redis.js";

declare module "fastify" {
  interface FastifyRequest {
    userSession?: CampaignSessionUser;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      email: string;
      role: string;
      organizationId: string;
      branchId: string;
      mode?: "b2b" | "b2c";
      industry?: "generic-b2b" | "generic-b2c";
      industryType?: string | null;
    };
    user: {
      sub: string;
      email: string;
      role: string;
      organizationId: string;
      branchId: string;
      mode?: "b2b" | "b2c";
      industry?: "generic-b2b" | "generic-b2c";
      industryType?: string | null;
    };
  }
}

const SESSION_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

function sessionCacheKey(userId: string): string {
  return `session:${userId}`;
}

function parseCachedSession(raw: string | null): CampaignSessionUser | null {
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as CampaignSessionUser;
    if (
      user &&
      typeof user.id === "string" &&
      user.id &&
      typeof user.email === "string" &&
      typeof user.organizationId === "string"
    ) {
      return user;
    }
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

/** Account Postgres / pool failures must not look like "logged out". */
export function isTransientAccountDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: unknown }).code || "");
  const message = err instanceof Error ? err.message : String(err);
  return (
    code === "53300" ||
    code === "57P01" ||
    code === "57P03" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    /too many clients/i.test(message) ||
    /Connection terminated/i.test(message) ||
    /timeout expired/i.test(message) ||
    /remaining connection slots/i.test(message)
  );
}

function throwIfTransientDb(err: unknown): void {
  if (isTransientAccountDbError(err)) {
    throw new AppError(
      "Account service is temporarily unavailable. Please try again in a moment.",
      503,
      "ACCOUNT_UNAVAILABLE",
    );
  }
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

/** EventSource cannot set Authorization — allow `access_token` query param. */
export function attachBearerFromQueryToken(request: FastifyRequest): void {
  if (extractBearerToken(request)) return;
  const q =
    typeof request.query === "object" && request.query
      ? (request.query as Record<string, unknown>)
      : {};
  const raw = q.access_token;
  const token = raw != null ? String(raw).trim() : "";
  if (token) {
    request.headers.authorization = `Bearer ${token}`;
  }
}

/** Campaign SPA JWT (JWT_SECRET) — Redis session first, then account DB. */
async function tryCampaignSpaSession(
  request: FastifyRequest,
): Promise<CampaignSessionUser> {
  const payload = await request.jwtVerify<{
    sub: string;
    email: string;
    role: string;
    organizationId: string;
    branchId: string;
    mode?: "b2b" | "b2c";
    industry?: "generic-b2b" | "generic-b2c";
    industryType?: string | null;
  }>();

  const cached = parseCachedSession(
    await cacheGet(sessionCacheKey(payload.sub)),
  );
  if (cached) {
    return cached;
  }

  let session: CampaignSessionUser | null;
  try {
    session = await getSessionUserById(payload.sub);
  } catch (err) {
    // Prefer staying authenticated from JWT claims when account DB is down.
    // Login already validated the user; Redis miss + DB outage must not 401.
    const fallback = sessionFromJwtPayload(payload);
    if (fallback && isTransientAccountDbError(err)) {
      return fallback;
    }
    throwIfTransientDb(err);
    throw err;
  }
  if (!session) {
    throw new UnauthorizedError();
  }

  try {
    await cacheSet(
      sessionCacheKey(session.id),
      JSON.stringify(session),
      SESSION_CACHE_TTL_SECONDS,
    );
  } catch {
    /* cache write is best-effort */
  }
  return session;
}

function sessionFromJwtPayload(payload: {
  sub: string;
  email: string;
  role: string;
  organizationId: string;
  branchId: string;
  mode?: "b2b" | "b2c";
  industry?: "generic-b2b" | "generic-b2c";
  industryType?: string | null;
}): CampaignSessionUser | null {
  if (!payload.sub || !payload.email || !payload.organizationId) return null;
  const name = payload.email.split("@")[0] || "User";
  const mode = payload.mode === "b2c" ? "b2c" : "b2b";
  const industry =
    payload.industry === "generic-b2c" ? "generic-b2c" : "generic-b2b";
  const industryType = String(payload.industryType || "").trim() || null;
  return {
    id: payload.sub,
    email: payload.email,
    name,
    role: payload.role || "user",
    initials: name.slice(0, 2).toUpperCase(),
    organizationId: payload.organizationId,
    branchId: payload.branchId || payload.organizationId,
    orgName: "Worktual",
    mode,
    industry,
    businessType: mode === "b2c" ? "B2C" : "B2B",
    industryType,
  };
}

/** Worktual CRM access JWT — same verifier as /api/campaigns Path A. */
async function tryCrmAccessSession(
  request: FastifyRequest,
): Promise<CampaignSessionUser> {
  if (!isCrmJwtConfigured()) {
    throw new UnauthorizedError();
  }
  const token = extractBearerToken(request);
  if (!token) {
    throw new UnauthorizedError();
  }
  try {
    const userId = await verifyCrmAccessToken(token);
    return await getSessionUserFromCrmAccess(userId);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throwIfTransientDb(err);
    throw err;
  }
}

/**
 * SPA + CRM embed auth — Campaign JWT first (existing behaviour), CRM JWT fallback.
 * Used by all authenticated API routes except public endpoints.
 */
export async function resolveAccessSession(
  request: FastifyRequest,
): Promise<CampaignSessionUser> {
  try {
    return await tryCampaignSpaSession(request);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throwIfTransientDb(err);
    /* JWT invalid / missing — fall through to CRM token */
  }
  return tryCrmAccessSession(request);
}

function hasValidInternalServiceKey(request: FastifyRequest): boolean {
  const expected =
    env.social.internalServiceKey?.trim() ||
    env.accounts.internalServiceKey?.trim() ||
    "";
  if (!expected) return false;
  const provided = String(
    request.headers["x-internal-service-key"] || "",
  ).trim();
  return provided === expected;
}

/** Service-to-service (agents, media forward) — same key as social/accounts internal APIs. */
export async function validateSessionOrInternalServiceKey(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (hasValidInternalServiceKey(request)) {
    return;
  }
  return validateSession(request, reply);
}

/** Downloads-style name: validateSession — used as preValidation hook */
export async function validateSession(
  request: FastifyRequest,
  _reply: FastifyReply,
) {
  attachBearerFromQueryToken(request);
  try {
    request.userSession = await resolveAccessSession(request);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throwIfTransientDb(err);
    throw new UnauthorizedError();
  }
}

export function requireSession(request: FastifyRequest): CampaignSessionUser {
  if (!request.userSession) {
    throw new UnauthorizedError();
  }
  return request.userSession;
}

export function requireAdmin(session: CampaignSessionUser): CampaignSessionUser {
  if (
    String(session.role || "")
      .trim()
      .toLowerCase() !== "admin"
  ) {
    throw new AppError(
      "Only administrators can manage sending configuration.",
      403,
    );
  }
  return session;
}

/**
 * Campaign routes — same as validateSession (kept for explicit campaign hook + docs).
 * CRM JWT fallback; tracking pixels skip auth in campaign/routes.ts.
 */
export async function validateCampaignAccess(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  return validateSession(request, reply);
}
