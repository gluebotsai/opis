import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  authenticateAccountUser,
  sessionUserFromSetupRow,
} from "@/service/account/auth-service";
import {
  CrmSessionActiveElsewhereError,
  deleteCrmSessionByToken,
  deleteCrmSessionsForEmail,
  establishCrmLoginSession,
  findValidCrmSessionByToken,
  sessionExpiresAt,
} from "@/service/account/auth-sessions";
import {
  publishCrmSessionReplaced,
  registerCrmSessionListener,
} from "@/service/account/auth-session-events";
import {
  SESSION_COOKIE_NAME,
  isOpaqueAuthSessionToken,
  sessionCookieSecure,
  signSessionUserId,
} from "@/service/account/session-crypto";
import { getSetupUserById } from "@/service/account/setup-users";
import {
  exchangeOnboardingCode,
  isInternalServiceKeyAuthorized,
  mintOnboardingDashboardLink,
} from "@/service/auth/onboarding-dashboard";
import { RESPONSE } from "../../helpers/constants.js";
import { sendSuccess, sendError } from "../../helpers/response.js";
import {
  replyStaleCrmSession,
  resolveSessionUserId,
  withUser,
} from "../../middlewares/auth.js";
import { releaseAgentPresence } from "../../service/voice/agent-presence.js";
import {
  registerSipOnLogin,
  unregisterSipOnLogout,
} from "../../service/voice/sip-registration.js";

function isDbUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const cause = err.cause instanceof Error ? err.cause.message.toLowerCase() : "";
  const haystack = `${msg} ${cause}`;
  return (
    haystack.includes("connection terminated") ||
    haystack.includes("connection timeout") ||
    haystack.includes("timeout exceeded when trying to connect") ||
    haystack.includes("etimedout") ||
    haystack.includes("econnrefused") ||
    haystack.includes("ehostunreach") ||
    haystack.includes("enotfound") ||
    haystack.includes("could not connect") ||
    haystack.includes("remaining connection slots") ||
    haystack.includes("too many connections")
  );
}

function noStore(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
  reply.header("Pragma", "no-cache");
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  maxAgeSeconds?: number,
) {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(),
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(),
  });
}

function setLegacySessionCookie(
  reply: FastifyReply,
  userId: string,
  maxAgeSeconds?: number,
) {
  setSessionCookie(reply, signSessionUserId(userId), maxAgeSeconds);
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: { email?: string; password?: string; remember?: boolean; force?: boolean };
  }>("/login", async (request, reply) => {
    const email = request.body?.email?.trim() ?? "";
    const password = request.body?.password ?? "";
    const remember = Boolean(request.body?.remember);
    const force = Boolean(request.body?.force);

    if (!email || !password) {
      return sendError(reply, "Email and password are required.", 400);
    }

    let result;
    try {
      result = await authenticateAccountUser({ email, password });
    } catch (err) {
      if (isDbUnavailableError(err)) {
        return sendError(
          reply,
          "Cannot reach the Worktual database. Connect VPN or check network to 10.180.0.126, then retry.",
          503,
        );
      }
      throw err;
    }
    if (!result.ok) {
      return sendError(reply, result.error, 401);
    }

    try {
      const established = await establishCrmLoginSession({
        email: result.user.email,
        role: result.user.role,
        displayName: result.user.name,
        userId: result.user.id,
        expiresAt: sessionExpiresAt(remember),
        force,
        currentCookieToken: request.cookies?.[SESSION_COOKIE_NAME],
      });

      const maxAgeSeconds = remember
        ? 60 * 60 * 24 * 30
        : Math.max(
            60,
            Math.floor((sessionExpiresAt(remember).getTime() - Date.now()) / 1000),
          );
      noStore(reply);
      setSessionCookie(reply, established.token, maxAgeSeconds);
      if (established.replaced || force) {
        publishCrmSessionReplaced({
          userId: result.user.id,
          email: result.user.email,
          activeToken: established.token,
        });
      }
      try {
        await registerSipOnLogin(result.user.id);
      } catch (error) {
        request.log.warn({ err: error, userId: result.user.id }, "sip registration on login failed");
      }
    } catch (err) {
      if (err instanceof CrmSessionActiveElsewhereError) {
        return reply.code(409).send({
          statusCode: 409,
          message:
            "You are already signed in to CRM in another browser. Sign in here to end that session.",
          code: "session_active_elsewhere",
        });
      }
      if (isDbUnavailableError(err)) {
        return sendError(
          reply,
          "Cannot reach the Worktual database. Connect VPN or check network to 10.180.0.126, then retry.",
          503,
        );
      }
      throw err;
    }

    return sendSuccess(
      reply,
      { user: result.user },
      RESPONSE.loginSuccess,
    );
  });

  app.post<{
    Body: { email?: string; userId?: string };
  }>("/onboarding-dashboard-link", async (request, reply) => {
    if (
      !isInternalServiceKeyAuthorized(
        request.headers["x-internal-service-key"],
      )
    ) {
      return sendError(reply, "Unauthorized", 401);
    }

    let result;
    try {
      result = await mintOnboardingDashboardLink({
        email: request.body?.email,
        userId: request.body?.userId,
      });
    } catch (err) {
      if (isDbUnavailableError(err)) {
        return sendError(
          reply,
          "Cannot reach the Worktual database. Connect VPN or check network to 10.180.0.126, then retry.",
          503,
        );
      }
      throw err;
    }

    if (!result.ok) {
      return sendError(reply, result.error, result.status);
    }

    return sendSuccess(
      reply,
      {
        url: result.url,
        expiresIn: result.expiresIn,
        user: result.user,
      },
      RESPONSE.onboardingLinkCreated,
    );
  });

  app.post<{
    Body: { code?: string };
  }>("/onboarding-exchange", async (request, reply) => {
    let result;
    try {
      result = await exchangeOnboardingCode(request.body?.code);
    } catch (err) {
      if (isDbUnavailableError(err)) {
        return sendError(
          reply,
          "Cannot reach the Worktual database. Connect VPN or check network to 10.180.0.126, then retry.",
          503,
        );
      }
      throw err;
    }

    if (!result.ok) {
      return sendError(reply, result.error, result.status);
    }

    setLegacySessionCookie(reply, result.user.id, 60 * 60 * 24 * 30);
    try {
      await registerSipOnLogin(result.user.id);
    } catch (error) {
      request.log.warn(
        { err: error, userId: result.user.id },
        "sip registration on onboarding failed",
      );
    }
    return sendSuccess(
      reply,
      {
        token: "",
        user: result.user,
        redirectTo: result.redirectTo,
      },
      RESPONSE.loginSuccess,
    );
  });

  app.post("/logout", async (request, reply) => {
    const raw = request.cookies?.[SESSION_COOKIE_NAME];
    try {
      const userId = await resolveSessionUserId(request);
      if (userId) await unregisterSipOnLogout(userId);
    } catch (error) {
      request.log.warn({ err: error }, "sip registration on logout failed");
    }
    try {
      const userId = await resolveSessionUserId(request);
      if (userId) await releaseAgentPresence(userId);
    } catch (error) {
      request.log.warn({ err: error }, "presence on logout failed");
    }
    try {
      if (isOpaqueAuthSessionToken(raw)) {
        await deleteCrmSessionByToken(raw!);
      } else if (raw) {
        const userId = await resolveSessionUserId(request);
        if (userId) {
          const user = await getSetupUserById(userId);
          if (user?.email) {
            await deleteCrmSessionsForEmail(user.email);
          }
        }
      }
    } catch {
      /* best effort — still clear the cookie */
    }
    noStore(reply);
    clearSessionCookie(reply);
    return sendSuccess(reply, null, RESPONSE.logoutSuccess);
  });

  app.get("/session-events", async (request, reply) => {
    const raw = request.cookies?.[SESSION_COOKIE_NAME]?.trim();
    if (!isOpaqueAuthSessionToken(raw)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
    const userId = await resolveSessionUserId(request);
    if (!userId || !raw) {
      if (request.crmStaleAuthSession) {
        return replyStaleCrmSession(reply);
      }
      return sendError(reply, RESPONSE.unauthorized, 401);
    }

    const CHECK_MS = 4_000;
    const HEARTBEAT_MS = 25_000;
    const MAX_WAIT_MS = 10 * 60_000;
    const token = raw;

    const row = await findValidCrmSessionByToken(token);
    const sessionEmail = row?.email?.trim() || "";
    if (!sessionEmail) {
      return replyStaleCrmSession(reply);
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    reply.hijack();

    let closed = false;
    const send = (event: string, data: unknown) => {
      if (closed) return;
      try {
        reply.raw.write(
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
        );
      } catch {
        closed = true;
      }
    };

    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearInterval(watch);
      clearTimeout(deadline);
      unsub();
      try {
        reply.raw.end();
      } catch {
        /* already closed */
      }
    };

    send("ready", { userId });
    const unsub = registerCrmSessionListener({
      userId,
      email: sessionEmail,
      token,
      send,
    });
    const heartbeat = setInterval(() => send("ping", Date.now()), HEARTBEAT_MS);
    const watch = setInterval(() => {
      void findValidCrmSessionByToken(token)
        .then((still) => {
          if (!still || still.token !== token) {
            send("revoked", {
              code: "session_revoked_elsewhere",
              at: Date.now(),
            });
            close();
          }
        })
        .catch(() => undefined);
    }, CHECK_MS);
    const deadline = setTimeout(close, MAX_WAIT_MS);
    request.raw.on("close", close);
  });

  app.get("/me", async (request, reply) => {
    noStore(reply);
    const userId = await resolveSessionUserId(request);
    if (!userId) {
      if (request.crmStaleAuthSession) {
        return replyStaleCrmSession(reply);
      }
      return sendError(reply, RESPONSE.unauthorized, 401);
    }

    return withUser(userId, async () => {
      const user = await getSetupUserById(userId);
      if (!user || user.status !== "active" || !user.crm_role_name) {
        return sendError(reply, RESPONSE.unauthorized, 401);
      }
      const sessionUser = sessionUserFromSetupRow(user);
      if (!sessionUser) {
        return sendError(reply, "Your account has no organization.", 403);
      }
      return sendSuccess(reply, { user: sessionUser }, RESPONSE.fetched);
    });
  });
};
