import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { getSession } from "../auth/session-auth.js";
import {
  getInvoiceSettings,
  getPublicInvoiceSettings,
  updateInvoiceSettings,
} from "./store.js";

type StaffSession = {
  email: string;
  role: string;
  userId?: string | null;
  displayName?: string;
};

type AuthedRequest = FastifyRequest & {
  authUser?: StaffSession;
  adminUser?: StaffSession;
};

type AnyBody = Record<string, any>;

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const session = await getSession(bearerToken(request));
    if (!session || session.role !== "admin") {
      return reply.code(401).send({ error: "Authentication required." });
    }
    const authedRequest = request as AuthedRequest;
    authedRequest.adminUser = session;
    authedRequest.authUser = session;
  } catch (error) {
    return reply.code(500).send({
      error: errorMessage(error, "Authentication failed."),
    });
  }
}

async function requireSalesWorkspaceAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const session = await getSession(bearerToken(request));
    if (
      !session ||
      !["sales", "sales_admin", "admin", "finance"].includes(session.role || "")
    ) {
      return reply.code(401).send({ error: "Authentication required." });
    }
    const authedRequest = request as AuthedRequest;
    authedRequest.authUser = session;
    if (session.role === "admin") {
      authedRequest.adminUser = session;
    }
  } catch (error) {
    return reply.code(500).send({
      error: errorMessage(error, "Authentication failed."),
    });
  }
}

export const nativeInvoiceSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });

  app.get(
    "/api/admin/invoice-settings",
    { preHandler: requireAdminAuth },
    async (_request, reply) => {
      try {
        const settings = await getInvoiceSettings();
        return reply.send({ settings });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load invoice settings."),
        });
      }
    },
  );

  app.put<{ Body: AnyBody }>(
    "/api/admin/invoice-settings",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const settings = await updateInvoiceSettings(request.body || {});
        return reply.send({ settings });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not update invoice settings."),
        });
      }
    },
  );

  app.get(
    "/api/invoice-settings",
    { preHandler: requireSalesWorkspaceAuth },
    async (_request, reply) => {
      try {
        const settings = await getPublicInvoiceSettings();
        return reply.send(settings);
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load invoice settings."),
        });
      }
    },
  );

  app.get(
    "/api/invoice-settings/public",
    { preHandler: requireSalesWorkspaceAuth },
    async (_request, reply) => {
      try {
        const settings = await getPublicInvoiceSettings();
        return reply.send(settings);
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load invoice settings."),
        });
      }
    },
  );
};
