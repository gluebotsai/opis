import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { getSession } from "../auth/session-auth.js";
import {
  getOversightAgentDetail,
  getOversightDashboard,
  getOversightLeadDetail,
  listOversightAgents,
  listUnassignedLeads,
  logExportAudit,
  reassignAllLeadsFromUser,
  reassignLead,
} from "./oversight-store.js";

type AuthUser = {
  email: string;
  role: string;
  userId?: string | null;
};

type AuthedRequest = FastifyRequest & {
  authUser?: AuthUser;
  oversightUser?: AuthUser;
  reassignUser?: AuthUser;
  salesAdminUser?: AuthUser;
};

type UserParams = { userId: string };
type LeadParams = { leadId: string };
type AnyBody = Record<string, any>;
type AnyQuery = Record<string, any>;

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function requireSalesOversightAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const session = await getSession(bearerToken(request));
    if (
      !session ||
      (session.role !== "sales_admin" && session.role !== "admin")
    ) {
      return reply.code(401).send({ error: "Authentication required." });
    }

    const authedRequest = request as AuthedRequest;
    authedRequest.oversightUser = session;
    authedRequest.authUser = session;
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

async function requireLeadReassignAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const session = await getSession(bearerToken(request));
    if (
      !session ||
      (session.role !== "sales_admin" && session.role !== "admin")
    ) {
      return reply
        .code(403)
        .send({ error: "Admin or sales admin access required." });
    }

    const authedRequest = request as AuthedRequest;
    authedRequest.reassignUser = session;
    authedRequest.salesAdminUser = session;
    authedRequest.authUser = session;
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

function oversightUser(request: FastifyRequest): AuthUser {
  const authedRequest = request as AuthedRequest;
  return (authedRequest.oversightUser || authedRequest.authUser) as AuthUser;
}

function reassignUser(request: FastifyRequest): AuthUser {
  return (request as AuthedRequest).reassignUser as AuthUser;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const nativeSalesOversightRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });

  app.get<{ Querystring: AnyQuery }>(
    "/dashboard",
    { preHandler: requireSalesOversightAuth },
    async (request, reply) => {
      try {
        const dashboard = await getOversightDashboard({
          days: request.query.days,
        });
        return reply.send(dashboard);
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load sales dashboard."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/agents",
    { preHandler: requireSalesOversightAuth },
    async (request, reply) => {
      try {
        const agents = await listOversightAgents({
          days: request.query.days,
        });
        return reply.send({ agents });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load sales agents."),
        });
      }
    },
  );

  app.get<{ Params: UserParams; Querystring: AnyQuery }>(
    "/agents/:userId",
    { preHandler: requireSalesOversightAuth },
    async (request, reply) => {
      try {
        const detail = await getOversightAgentDetail(request.params.userId, {
          days: request.query.days,
        });
        if (!detail) {
          return reply.code(404).send({ error: "Sales agent not found." });
        }
        return reply.send(detail);
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load agent detail."),
        });
      }
    },
  );

  app.get<{ Params: LeadParams }>(
    "/leads/:leadId",
    { preHandler: requireSalesOversightAuth },
    async (request, reply) => {
      try {
        const detail = await getOversightLeadDetail(request.params.leadId);
        if (!detail) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        return reply.send(detail);
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load lead detail."),
        });
      }
    },
  );

  app.get(
    "/unassigned-leads",
    { preHandler: requireSalesOversightAuth },
    async (_request, reply) => {
      try {
        const leads = await listUnassignedLeads();
        return reply.send({ leads });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load unassigned leads."),
        });
      }
    },
  );

  app.put<{ Params: LeadParams; Body: AnyBody }>(
    "/leads/:leadId/assign",
    { preHandler: requireLeadReassignAuth },
    async (request, reply) => {
      try {
        const { toUserId, reason = "" } = request.body || {};
        if (!toUserId) {
          return reply.code(400).send({ error: "toUserId is required." });
        }

        const lead = await reassignLead(request.params.leadId, toUserId, {
          assignedByUserId: reassignUser(request).userId,
          reason: String(reason || "").trim(),
        });
        return reply.send({ lead });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not reassign lead."),
        });
      }
    },
  );

  app.put<{ Params: UserParams; Body: AnyBody }>(
    "/agents/:userId/reassign-all",
    { preHandler: requireLeadReassignAuth },
    async (request, reply) => {
      try {
        const { toUserId, reason = "" } = request.body || {};
        if (!toUserId) {
          return reply.code(400).send({ error: "toUserId is required." });
        }

        const result = await reassignAllLeadsFromUser(
          request.params.userId,
          toUserId,
          {
            assignedByUserId: reassignUser(request).userId,
            reason: String(reason || "").trim() || "Bulk reassignment",
          },
        );
        return reply.send(result);
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not reassign leads."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/export-audit",
    { preHandler: requireSalesOversightAuth },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const format = String(body.format || "").trim();
        const scope = String(body.scope || "").trim();
        if (!format || !scope) {
          return reply
            .code(400)
            .send({ error: "format and scope are required." });
        }

        const actor = oversightUser(request);
        const entry = await logExportAudit({
          exportedByUserId: actor.userId || null,
          exportedByEmail: actor.email,
          exportedByRole: actor.role,
          agentUserId: body.agentUserId || null,
          agentEmail: body.agentEmail || "",
          agentName: body.agentName || "",
          format,
          scope,
          rowCount: body.rowCount,
          fileName: body.fileName || "",
        });
        return reply.code(201).send({ entry });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not log export audit."),
        });
      }
    },
  );
};
