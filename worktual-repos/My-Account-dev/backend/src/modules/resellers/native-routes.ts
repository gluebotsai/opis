import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { getSession } from "../auth/session-auth.js";
import { createLead } from "../leads/lead-store.js";
import {
  changeResellerPassword,
  deleteResellerLead,
  forceLogoutResellerByAdmin,
  getResellerLeadDetail,
  getResellerProfile,
  getResellerSession,
  listResellerInvoices,
  listResellerLeads,
  listResellerRenewals,
  logoutResellerUser,
  updateResellerLead,
} from "./reseller-auth.js";
import { notifyPartnerOrResellerPortalCreated } from "../notifications/service.js";
import {
  createReseller,
  listActiveResellers,
  listResellers,
  updateReseller,
} from "./reseller-store.js";
import { getActiveSalesAdminUser } from "../users/user-store.js";

type AnyBody = Record<string, any>;
type AnyQuery = Record<string, any>;
type IdParams = { id: string };
type StaffSession = {
  email?: string;
  role?: string;
  userId?: string | null;
};
type ResellerSession = {
  email: string;
  displayName?: string;
  resellerId: string;
  resellerUserId: string;
};
type AuthedRequest = FastifyRequest & {
  adminUser?: StaffSession;
  authUser?: StaffSession;
  resellerUser?: ResellerSession;
};
type StatusError = Error & {
  status?: number;
  contactConflict?: unknown;
};

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function statusOf(error: unknown, fallback = 400): number {
  return (error as StatusError | null)?.status || fallback;
}

function resellerUser(request: FastifyRequest): ResellerSession {
  return (request as AuthedRequest).resellerUser as ResellerSession;
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const session = await getSession(bearerToken(request));
    if (!session) {
      return reply.code(401).send({ error: "Authentication required." });
    }
    (request as AuthedRequest).authUser = session;
  } catch (error) {
    return reply.code(500).send({
      error: errorMessage(error, "Authentication failed."),
    });
  }
}

async function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
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

async function requireResellerAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = bearerToken(request);
    if (!token) {
      return reply.code(401).send({ error: "Authentication required." });
    }
    const session = await getResellerSession(token);
    if (!session) {
      return reply.code(401).send({ error: "Authentication required." });
    }
    const authedRequest = request as AuthedRequest;
    authedRequest.resellerUser = session as any;
    authedRequest.authUser = ({
      email: session.email,
      role: "reseller",
      userId: session.resellerUserId,
    } as any);
  } catch (error) {
    return reply.code(500).send({
      error: errorMessage(error, "Authentication failed."),
    });
  }
}

export const nativeResellersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });

  app.post<{ Params: IdParams }>(
    "/api/admin/resellers/:id/force-logout",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const result = await forceLogoutResellerByAdmin(request.params.id);
        return reply.send(result);
      } catch (error) {
        const status = (error as StatusError | null)?.status === 404 ? 404 : 400;
        return reply.code(status).send({
          error: errorMessage(error, "Could not force logout reseller."),
        });
      }
    },
  );

  app.get(
    "/api/admin/resellers",
    { preHandler: requireAdminAuth },
    async (_request, reply) => {
      try {
        const resellers = await listResellers();
        return reply.send({ resellers });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load resellers."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/admin/resellers",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const reseller = await createReseller(body, {
          createdByUserId:
            (request as AuthedRequest).adminUser?.userId || null,
        });
        let emailSent = false;
        let emailError: string | null = null;
        try {
          const primaryUser = reseller?.users?.[0];
          await notifyPartnerOrResellerPortalCreated({
            kind: "reseller",
            companyName: String(reseller?.companyName || ""),
            displayName: String(
              primaryUser?.displayName || body.displayName || "",
            ),
            email: String(
              primaryUser?.email || body.loginEmail || body.workEmail || "",
            ),
            plainPassword: String(body.password || ""),
          });
          emailSent = true;
        } catch (error) {
          emailError =
            error instanceof Error ? error.message : "Could not send welcome email.";
          request.log.error({ err: error }, "Reseller welcome email failed");
        }
        return reply.code(201).send({ reseller, emailSent, emailError });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not create reseller."),
        });
      }
    },
  );

  app.put<{ Params: IdParams; Body: AnyBody }>(
    "/api/admin/resellers/:id",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const reseller = await updateReseller(
          request.params.id,
          request.body || {},
        );
        if (!reseller) {
          return reply.code(404).send({ error: "Reseller not found." });
        }
        return reply.send({ reseller });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not update reseller."),
        });
      }
    },
  );

  app.get(
    "/api/resellers/active",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const role = (request as AuthedRequest).authUser?.role;
        if (!["sales", "sales_admin", "admin", "finance"].includes(role || "")) {
          return reply.code(403).send({ error: "Access denied." });
        }
        const resellers = await listActiveResellers();
        return reply.send({ resellers });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load resellers."),
        });
      }
    },
  );

  app.post(
    "/api/reseller/logout",
    { preHandler: requireResellerAuth },
    async (request, reply) => {
      try {
        await logoutResellerUser(bearerToken(request));
        return reply.send({ ok: true });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Logout failed."),
        });
      }
    },
  );

  app.get(
    "/api/reseller/me",
    { preHandler: requireResellerAuth },
    async (request, reply) => {
      try {
        const user = resellerUser(request);
        const profile = await getResellerProfile(user.resellerId);
        return reply.send({ profile, user });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load profile."),
        });
      }
    },
  );

  app.put<{ Body: AnyBody }>(
    "/api/reseller/me/password",
    { preHandler: requireResellerAuth },
    async (request, reply) => {
      try {
        const { currentPassword, newPassword } = request.body || {};
        await changeResellerPassword(
          resellerUser(request).resellerUserId,
          String(currentPassword || ""),
          String(newPassword || ""),
        );
        return reply.send({ ok: true });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not update password."),
        });
      }
    },
  );

  app.get(
    "/api/reseller/leads",
    { preHandler: requireResellerAuth },
    async (request, reply) => {
      try {
        const leads = await listResellerLeads(
          resellerUser(request).resellerId,
        );
        return reply.send({ leads });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load leads."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/reseller/leads/:id",
    { preHandler: requireResellerAuth },
    async (request, reply) => {
      try {
        const lead = await getResellerLeadDetail(
          resellerUser(request).resellerId,
          request.params.id,
        );
        if (!lead) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        return reply.send({ lead });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load lead."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/reseller/renewals",
    { preHandler: requireResellerAuth },
    async (request, reply) => {
      try {
        const withinDays = Number(request.query.withinDays || 90);
        const renewals = await listResellerRenewals(
          resellerUser(request).resellerId,
          { withinDays },
        );
        return reply.send({ renewals });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load renewals."),
        });
      }
    },
  );

  app.get(
    "/api/reseller/invoices",
    { preHandler: requireResellerAuth },
    async (request, reply) => {
      try {
        const invoices = await listResellerInvoices(
          resellerUser(request).resellerId,
        );
        return reply.send({ invoices });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load invoices."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/reseller/leads",
    { preHandler: requireResellerAuth },
    async (request, reply) => {
      try {
        const salesAdmin = await getActiveSalesAdminUser();
        if (!salesAdmin?.id) {
          return reply.code(503).send({
            error:
              "No active sales admin is available to assign reseller leads.",
          });
        }
        const lead = await createLead(request.body || {}, {
          resellerId: resellerUser(request).resellerId,
          assignedUserId: salesAdmin.id,
          assignmentReason: "Auto-assigned to sales admin for reseller lead",
        });
        const { queuePortalLeadCreatedEmail } = await import("../../infra/notify.js");
        void queuePortalLeadCreatedEmail(lead.id, { event: "assigned" });
        return reply.code(201).send({ lead });
      } catch (error) {
        const conflict = (error as StatusError | null)?.contactConflict;
        return reply.code(400).send({
          error: errorMessage(error, "Could not create lead."),
          ...(conflict ? { contactConflict: conflict } : {}),
        });
      }
    },
  );

  app.put<{ Params: IdParams; Body: AnyBody }>(
    "/api/reseller/leads/:id",
    { preHandler: requireResellerAuth },
    async (request, reply) => {
      try {
        const lead = await updateResellerLead(
          resellerUser(request).resellerId,
          request.params.id,
          request.body || {},
        );
        if (!lead) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        return reply.send({ lead });
      } catch (error) {
        const statusValue = (error as StatusError | null)?.status;
        const status =
          statusValue === 403 ? 403 : statusValue === 404 ? 404 : 400;
        const conflict = (error as StatusError | null)?.contactConflict;
        return reply.code(status).send({
          error: errorMessage(error, "Could not update lead."),
          ...(conflict ? { contactConflict: conflict } : {}),
        });
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/api/reseller/leads/:id",
    { preHandler: requireResellerAuth },
    async (request, reply) => {
      try {
        const result = await deleteResellerLead(
          resellerUser(request).resellerId,
          request.params.id,
        );
        if (!result) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        return reply.send({ ok: true, ...result });
      } catch (error) {
        return reply.code(statusOf(error)).send({
          error: errorMessage(error, "Could not delete lead."),
        });
      }
    },
  );
};
