import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { getSession } from "../auth/session-auth.js";
import { notifyStaffUserCreated } from "../notifications/service.js";
import {
  importBulkUserCsv,
  previewBulkUserCsv,
} from "./bulk-upload.js";
import {
  createUser,
  deleteUserByAdmin,
  forceLogoutUserByAdmin,
  listUsers,
  updateUserByAdmin,
} from "./user-store.js";

type AdminPrincipal = {
  email: string;
  role: string;
  userId?: string | null;
};

type AdminRequest = FastifyRequest & { adminUser?: AdminPrincipal };

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const session = await getSession(token);

  if (!session) {
    await reply.code(401).send({ error: "Unauthorized." });
    return;
  }
  if (session.role !== "admin") {
    await reply.code(403).send({ error: "Admin access required." });
    return;
  }

  (request as AdminRequest).adminUser = {
    email: session.email,
    role: session.role,
    userId: session.userId,
  };
}

function errorStatus(error: unknown, fallback = 400): number {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : fallback;
}

export const adminUserRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAdmin);

  app.get("/", async (_request, reply) => {
    const users = await listUsers();
    return reply.send({ users, host: "fastify" });
  });

  app.post<{ Body: Record<string, unknown> }>("/", async (request, reply) => {
    try {
      const payload = request.body || {};
      const actorEmail = (request as AdminRequest).adminUser?.email || "";
      const user = await createUser(payload, actorEmail);
      let emailSent = false;
      let emailError: string | null = null;

      try {
        await notifyStaffUserCreated({
          user,
          plainPassword: payload.password,
        });
        emailSent = true;
      } catch (error) {
        emailError =
          error instanceof Error
            ? error.message
            : "Could not send login email.";
        request.log.error({ err: error }, "Staff user invite email failed");
      }

      return reply
        .code(201)
        .send({ user, emailSent, emailError, host: "fastify" });
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error ? error.message : "Could not create user.",
      });
    }
  });

  app.post<{ Body: { csv?: string } }>(
    "/bulk/preview",
    async (request, reply) => {
      try {
        const csv = String(request.body?.csv || "");
        if (!csv.trim()) {
          return reply.code(400).send({ error: "CSV content is required." });
        }
        const result = await previewBulkUserCsv(csv);
        return reply.send({ ...result, host: "fastify" });
      } catch (error) {
        return reply.code(400).send({
          error:
            error instanceof Error
              ? error.message
              : "Could not preview bulk upload.",
        });
      }
    },
  );

  app.post<{ Body: { csv?: string } }>(
    "/bulk/import",
    async (request, reply) => {
      try {
        const csv = String(request.body?.csv || "");
        if (!csv.trim()) {
          return reply.code(400).send({ error: "CSV content is required." });
        }
        const result = await importBulkUserCsv(csv, {
          actorEmail: (request as AdminRequest).adminUser?.email || "",
        });
        return reply.send({ ...result, host: "fastify" });
      } catch (error) {
        return reply.code(400).send({
          error:
            error instanceof Error
              ? error.message
              : "Could not import bulk users.",
        });
      }
    },
  );

  app.put<{
    Params: { id: string };
    Body: Record<string, unknown>;
  }>("/:id", async (request, reply) => {
    try {
      const user = await updateUserByAdmin(
        request.params.id,
        request.body || {},
        (request as AdminRequest).adminUser?.email || "",
      );
      return reply.send({ user, host: "fastify" });
    } catch (error) {
      return reply.code(errorStatus(error)).send({
        error:
          error instanceof Error ? error.message : "Could not update user.",
      });
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) => {
      try {
        const result = await deleteUserByAdmin(request.params.id);
        return reply.send({ ...result, host: "fastify" });
      } catch (error) {
        return reply.code(errorStatus(error)).send({
          error:
            error instanceof Error ? error.message : "Could not delete user.",
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/force-logout",
    async (request, reply) => {
      try {
        const result = await forceLogoutUserByAdmin(request.params.id);
        return reply.send({ ...result, host: "fastify" });
      } catch (error) {
        return reply.code(errorStatus(error)).send({
          error:
            error instanceof Error
              ? error.message
              : "Could not force logout user.",
        });
      }
    },
  );
};
