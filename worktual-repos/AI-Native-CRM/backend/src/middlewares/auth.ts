import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  findActiveCrmSessionByEmail,
  findValidCrmSessionByToken,
} from "@/service/account/auth-sessions";
import { getSetupUserById } from "@/service/account/setup-users";
import {
  isOpaqueAuthSessionToken,
  SESSION_COOKIE_NAME,
  verifySessionCookieValue,
  sessionCookieSecure,
} from "@/service/account/session-crypto";
import {
  runWithRequestContext,
  type ApiKeyAuthContext,
} from "@/service/account/request-context";
import {
  resolveApiKeyBySecret,
  touchApiKeyLastUsed,
} from "@/dao/configuration/api-key-store";
import type { ApiKeyScope } from "@/lib/api-key-scopes";
import {
  EMAIL_SEND_PROVIDER_COOKIE,
  parsePreferredEmailProvider,
} from "@/service/email/preferred-provider";
import { RESPONSE } from "../helpers/constants.js";
import { sendError } from "../helpers/response.js";

declare module "fastify" {
  interface FastifyRequest {
    crmApiKeyAuth?: ApiKeyAuthContext | null;
    /** Set by resolveSessionUserId after DB lookup for auth_sessions cookies. */
    crmSessionUserId?: string | null;
    /** Opaque session cookie present but no matching CRM auth_sessions row. */
    crmStaleAuthSession?: boolean;
  }
}

export function readSessionUserId(request: FastifyRequest): string | null {
  if (request.crmSessionUserId !== undefined) {
    return request.crmSessionUserId;
  }
  const raw = request.cookies?.[SESSION_COOKIE_NAME];
  return verifySessionCookieValue(raw);
}

/** Resolve CRM user id from legacy signed cookie or accounts.auth_sessions token. */
export async function resolveSessionUserId(
  request: FastifyRequest,
): Promise<string | null> {
  if (request.crmSessionUserId !== undefined) {
    return request.crmSessionUserId;
  }

  const raw = request.cookies?.[SESSION_COOKIE_NAME];
  const legacy = verifySessionCookieValue(raw);
  if (legacy) {
    try {
      const setupUser = await getSetupUserById(legacy);
      const email = setupUser?.email?.trim();
      if (email) {
        const active = await findActiveCrmSessionByEmail(email);
        if (active) {
          request.crmSessionUserId = null;
          request.crmStaleAuthSession = true;
          return null;
        }
      }
    } catch {
      request.crmSessionUserId = null;
      request.crmStaleAuthSession = true;
      return null;
    }
    request.crmStaleAuthSession = false;
    request.crmSessionUserId = legacy;
    return legacy;
  }

  if (!isOpaqueAuthSessionToken(raw)) {
    request.crmSessionUserId = null;
    request.crmStaleAuthSession = false;
    return null;
  }

  const row = await findValidCrmSessionByToken(raw!);
  if (!row) {
    request.crmSessionUserId = null;
    request.crmStaleAuthSession = true;
    return null;
  }

  const active = await findActiveCrmSessionByEmail(row.email);
  if (!active || active.token !== row.token) {
    request.crmSessionUserId = null;
    request.crmStaleAuthSession = true;
    return null;
  }

  request.crmStaleAuthSession = false;
  const userId = row.user_id?.trim() || null;
  request.crmSessionUserId = userId;
  return userId;
}

function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export function replyStaleCrmSession(
  reply: FastifyReply,
): FastifyReply {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(),
  });
  return reply.code(401).send({
    statusCode: 401,
    message:
      "Your CRM session was ended because you signed in elsewhere.",
    code: "session_revoked_elsewhere",
  });
}

export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const userId = await resolveSessionUserId(request);
  if (!userId) {
    if (request.crmStaleAuthSession) {
      replyStaleCrmSession(reply);
      return null;
    }
    await sendError(reply, RESPONSE.unauthorized, 401);
    return null;
  }
  request.crmApiKeyAuth = null;
  return userId;
}

/**
 * Cookie session or tenant API key (Authorization: Bearer crm_…).
 * When `scope` is set, API keys must include that scope (sessions ignore it).
 */
export async function requireSessionOrApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
  scope?: ApiKeyScope,
): Promise<string | null> {
  const sessionUserId = await resolveSessionUserId(request);
  if (sessionUserId) {
    request.crmApiKeyAuth = null;
    return sessionUserId;
  }

  const token = readBearerToken(request);
  if (!token) {
    await sendError(reply, RESPONSE.unauthorized, 401);
    return null;
  }

  const resolved = await resolveApiKeyBySecret(token);
  if (!resolved) {
    await sendError(reply, "Invalid or revoked API key.", 401);
    return null;
  }

  if (scope && !resolved.scopes.includes(scope)) {
    await sendError(
      reply,
      `This API key is missing the "${scope}" scope.`,
      403,
    );
    return null;
  }

  const apiKeyAuth: ApiKeyAuthContext = {
    keyId: resolved.id,
    organizationId: resolved.organizationId,
    scopes: resolved.scopes,
  };
  request.crmApiKeyAuth = apiKeyAuth;
  void touchApiKeyLastUsed(resolved.id);
  return resolved.createdByUserId;
}

/** Run domain code with ALS user id so getServerUserId() resolves. */
export function withUser<T>(
  userId: string | null,
  fn: () => Promise<T>,
  request?: FastifyRequest,
) {
  const preferredEmailProvider = request
    ? parsePreferredEmailProvider(
        request.cookies?.[EMAIL_SEND_PROVIDER_COOKIE],
      )
    : undefined;
  const apiKeyAuth = request?.crmApiKeyAuth ?? null;
  return runWithRequestContext(
    {
      userId,
      apiKeyAuth,
      ...(preferredEmailProvider !== undefined
        ? { preferredEmailProvider }
        : {}),
    },
    fn,
  );
}

export const authMiddlewarePlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (request) => {
    await resolveSessionUserId(request);
  });
};
