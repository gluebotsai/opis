import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { getSession } from "../auth/session-auth.js";
import { createLead } from "../leads/lead-store.js";
import {
  changePartnerPassword,
  deletePartnerByAdmin,
  deletePartnerLead,
  forceLogoutPartnerByAdmin,
  getPartnerLeadDetail,
  getPartnerProfile,
  getPartnerQuotationInvoice,
  getPartnerSession,
  listPartnerLeads,
  logoutPartnerUser,
  updatePartnerLead,
} from "./partner-auth.js";
import { notifyPartnerOrResellerPortalCreated } from "../notifications/service.js";
import {
  assertPartnerContactsAvailable,
  createPartner,
  listPartners,
  updatePartner,
} from "./partner-store.js";

type AnyBody = Record<string, any>;
type IdParams = { id: string };
type InvoiceParams = { leadId: string; quotationId: string };
type StaffSession = {
  email?: string;
  role?: string;
  userId?: string | null;
};
type PartnerSession = {
  email: string;
  displayName?: string;
  partnerId: string;
  partnerUserId: string;
};
type AuthedRequest = FastifyRequest & {
  adminUser?: StaffSession;
  authUser?: StaffSession;
  partnerUser?: PartnerSession;
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

function partnerUser(request: FastifyRequest): PartnerSession {
  return (request as AuthedRequest).partnerUser as PartnerSession;
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

async function requirePartnerAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = bearerToken(request);
    if (!token) {
      return reply.code(401).send({ error: "Authentication required." });
    }
    const session = await getPartnerSession(token);
    if (!session) {
      return reply.code(401).send({ error: "Authentication required." });
    }
    const authedRequest = request as AuthedRequest;
    authedRequest.partnerUser = session as any;
    authedRequest.authUser = ({
      email: session.email,
      role: "partner",
      userId: session.partnerUserId,
    } as any);
  } catch (error) {
    return reply.code(500).send({
      error: errorMessage(error, "Authentication failed."),
    });
  }
}

export const nativePartnersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });

  app.post<{ Params: IdParams }>(
    "/api/admin/partners/:id/force-logout",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const result = await forceLogoutPartnerByAdmin(request.params.id);
        return reply.send(result);
      } catch (error) {
        const status = (error as StatusError | null)?.status === 404 ? 404 : 400;
        return reply.code(status).send({
          error: errorMessage(error, "Could not force logout partner."),
        });
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/api/admin/partners/:id",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const result = await deletePartnerByAdmin(request.params.id);
        return reply.send(result);
      } catch (error) {
        const status = (error as StatusError | null)?.status === 404 ? 404 : 400;
        return reply.code(status).send({
          error: errorMessage(error, "Could not delete partner."),
        });
      }
    },
  );

  app.get(
    "/api/admin/partners",
    { preHandler: requireAdminAuth },
    async (_request, reply) => {
      try {
        const partners = await listPartners();
        return reply.send({ partners });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load partners."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/admin/partners/validate-contacts",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const workEmail = String(body.workEmail || "").trim();
        const loginEmail = String(body.loginEmail || body.workEmail || "").trim();
        const mobileCountryCode = String(body.mobileCountryCode || "+91").trim();
        const mobileNumber = String(body.mobileNumber || "").replace(/\D/g, "").trim();
        const ignorePartnerId = body.partnerId || body.id || null;

        await assertPartnerContactsAvailable(
          {
            workEmail,
            loginEmail,
            mobileCountryCode,
            mobileNumber,
          },
          { ignorePartnerId },
        );
        return reply.send({ valid: true });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Contact validation failed."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/admin/partners",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const partner = await createPartner(body, {
          createdByUserId:
            (request as AuthedRequest).adminUser?.userId || null,
        });
        let emailSent = false;
        let emailError: string | null = null;
        try {
          const primaryUser = partner?.users?.[0];
          await notifyPartnerOrResellerPortalCreated({
            kind: "partner",
            companyName: String(partner?.companyName || ""),
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
          request.log.error({ err: error }, "Partner welcome email failed");
        }
        return reply.code(201).send({ partner, emailSent, emailError });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not create partner."),
        });
      }
    },
  );

  app.put<{ Params: IdParams; Body: AnyBody }>(
    "/api/admin/partners/:id",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const partner = await updatePartner(
          request.params.id,
          request.body || {},
        );
        if (!partner) {
          return reply.code(404).send({ error: "Partner not found." });
        }
        return reply.send({ partner });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not update partner."),
        });
      }
    },
  );

  app.post(
    "/api/partner/logout",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        await logoutPartnerUser(bearerToken(request));
        return reply.send({ ok: true });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Logout failed."),
        });
      }
    },
  );

  app.get(
    "/api/partner/me",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const user = partnerUser(request);
        const profile = await getPartnerProfile(user.partnerId);
        return reply.send({ profile, user });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load partner profile."),
        });
      }
    },
  );

  app.put<{ Body: AnyBody }>(
    "/api/partner/me/password",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const { currentPassword, newPassword } = request.body || {};
        await changePartnerPassword(
          partnerUser(request).partnerUserId,
          currentPassword,
          newPassword,
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
    "/api/partner/leads",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const leads = await listPartnerLeads(partnerUser(request).partnerId);
        return reply.send({ leads });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load leads."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/partner/leads/:id",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const lead = await getPartnerLeadDetail(
          partnerUser(request).partnerId,
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

  app.get<{ Params: InvoiceParams }>(
    "/api/partner/leads/:leadId/quotations/:quotationId/invoice",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const invoice = await getPartnerQuotationInvoice(
          partnerUser(request).partnerId,
          request.params.leadId,
          request.params.quotationId,
        );
        return reply.send({ invoice });
      } catch (error) {
        const statusValue = (error as StatusError | null)?.status;
        const status =
          statusValue === 403 || statusValue === 404 ? statusValue : 500;
        return reply.code(status).send({
          error: errorMessage(error, "Could not load invoice."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/partner/leads",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const lead = await createLead(request.body || {}, {
          partnerId: partnerUser(request).partnerId,
          assignedUserId: null,
          assignmentReason: null,
        });
        const { queuePortalLeadCreatedEmail } = await import("../../infra/notify.js");
        void queuePortalLeadCreatedEmail(lead.id, { event: "created" });
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
    "/api/partner/leads/:id",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const lead = await updatePartnerLead(
          partnerUser(request).partnerId,
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
    "/api/partner/leads/:id",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const result = await deletePartnerLead(
          partnerUser(request).partnerId,
          request.params.id,
        );
        if (!result) {
          return reply.code(404).send({ error: "Lead not found." });
        }
        return reply.send({ ok: true, ...result });
      } catch (error) {
        return reply.code(statusOf(error)).send({
          error: errorMessage(error, "Could not delete referral."),
        });
      }
    },
  );
};
