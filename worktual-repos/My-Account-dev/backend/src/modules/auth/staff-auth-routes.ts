import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
  getSession,
  isSessionAlreadyActiveError,
  loginUser,
  logoutUser,
  signInAccount,
} from "./session-auth.js";
import { isDatabaseConnectivityError } from "../../db/pool.js";
import {
  getUserById,
  sanitizeUser,
  updateAdminProfile,
  updateUserProfile,
} from "../users/user-store.js";

type LoginBody = {
  email?: string;
  password?: string;
  replaceSession?: boolean;
};

type AuthedRequest = FastifyRequest & {
  authUser?: {
    email?: string;
    role?: string;
    userId?: string;
    displayName?: string;
  };
};

function allowSessionReplace(body: LoginBody | undefined): boolean {
  if (!body?.replaceSession) return false;
  return process.env.ALLOW_LOGIN_SESSION_REPLACE === "1";
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  if (isSessionAlreadyActiveError(error)) {
    const err = error as Error & { code?: string };
    return reply.code(409).send({ error: err.message, code: err.code });
  }
  if (isDatabaseConnectivityError(error)) {
    return reply.code(503).send({
      error: "Database unavailable. Try again in a moment.",
      code: "DATABASE_UNAVAILABLE",
    });
  }
  return reply.code(401).send({
    error: error instanceof Error ? error.message : "Login failed.",
  });
}

async function requireStaffAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const session = await getSession(token);
  if (!session) {
    return reply.code(401).send({ error: "Unauthorized." });
  }
  (request as AuthedRequest).authUser = session;
}

/** Native staff authentication routes. */
export const staffAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: LoginBody }>("/login", async (request, reply) => {
    try {
      const { email, password } = request.body || {};
      const result = await loginUser(String(email || ""), String(password || ""), {
        replaceSession: allowSessionReplace(request.body),
      });
      return reply.send(result);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post<{ Body: LoginBody }>("/sign-in", async (request, reply) => {
    try {
      const { email, password } = request.body || {};
      const result = await signInAccount(String(email || ""), String(password || ""), {
        replaceSession: allowSessionReplace(request.body),
      });
      return reply.send(result);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/password-reset/request", async (request, reply) => {
    try {
      const { requestPasswordResetOtp } = await import("./password-reset.js");
      const body = (request.body || {}) as { email?: string };
      const result = await requestPasswordResetOtp(String(body.email || ""));
      return reply.send(result);
    } catch (error) {
      const err = error as Error & { code?: string };
      const status =
        err?.code === "admin_mailbox_unavailable" || err?.code === "admin_email_missing"
          ? 503
          : 400;
      return reply.code(status).send({
        error:
          error instanceof Error
            ? error.message
            : "Could not send reset code. Try again later.",
      });
    }
  });

  app.post("/password-reset/verify", async (request, reply) => {
    try {
      const { verifyPasswordResetOtp } = await import("./password-reset.js");
      const body = (request.body || {}) as { email?: string; otp?: string };
      const result = await verifyPasswordResetOtp(
        String(body.email || ""),
        String(body.otp || ""),
      );
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Could not verify code.",
      });
    }
  });

  app.post("/password-reset/confirm", async (request, reply) => {
    try {
      const { confirmPasswordReset } = await import("./password-reset.js");
      const body = (request.body || {}) as {
        email?: string;
        resetToken?: string;
        password?: string;
      };
      const result = await confirmPasswordReset({
        email: String(body.email || ""),
        resetToken: String(body.resetToken || ""),
        password: String(body.password || ""),
      });
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Could not update password.",
      });
    }
  });

  app.post("/logout", { preHandler: requireStaffAuth }, async (request, reply) => {
    try {
      const header = request.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      await logoutUser(token);
      return reply.send({ ok: true });
    } catch (error) {
      return reply.code(500).send({
        error: error instanceof Error ? error.message : "Logout failed.",
      });
    }
  });

  app.get("/me", { preHandler: requireStaffAuth }, async (request, reply) => {
    const session = (request as AuthedRequest).authUser;
    if (!session?.userId) {
      return reply.send({
        user: {
          email: session?.email,
          role: session?.role,
          displayName: session?.displayName || "",
        },
      });
    }

    const user = await getUserById(session.userId);
    if (!user) {
      return reply.code(404).send({ error: "User profile not found." });
    }
    return reply.send({ user: sanitizeUser(user) });
  });

  app.put("/profile", { preHandler: requireStaffAuth }, async (request, reply) => {
    try {
      const session = (request as AuthedRequest).authUser;
      if (!session) {
        return reply.code(401).send({ error: "Unauthorized." });
      }

      if (session.role === "admin") {
        if (!session.userId) {
          return reply.code(400).send({
            error: "This account is not linked to a managed user profile yet.",
          });
        }
        const user = await updateAdminProfile(session.userId, request.body || {});
        return reply.send({ user });
      }

      if (
        session.role !== "sales" &&
        session.role !== "finance" &&
        session.role !== "sales_admin"
      ) {
        return reply
          .code(403)
          .send({ error: "Only sales, finance, and sales admin users can update their profile." });
      }

      if (!session.userId) {
        return reply.code(400).send({
          error:
            "This account is not linked to a managed user profile yet. Ask admin to create credentials.",
        });
      }

      const user = await updateUserProfile(session.userId, request.body || {});
      return reply.send({ user });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Could not update profile.",
      });
    }
  });
};
