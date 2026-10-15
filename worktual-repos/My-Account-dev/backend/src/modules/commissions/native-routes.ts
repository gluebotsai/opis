import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { getSession } from "../auth/session-auth.js";
import {
  createCommissionSlab,
  deleteCommissionSlab,
  getFinancePartnerCommissionOverview,
  getPartnerBankAccount,
  getPartnerCountry,
  listCommissionSlabs,
  listFinanceCommissionPartners,
  listFinanceCommissions,
  listPartnerCommissions,
  markPartnerCommissionPaid,
  updateCommissionSlab,
  upsertPartnerBankAccount,
} from "./commission-store.js";
import { getPartnerSession } from "../partners/partner-auth.js";

type StaffSession = {
  email: string;
  role: string;
  userId?: string | null;
  displayName?: string;
};

type PartnerSession = {
  email: string;
  partnerUserId: string;
  partnerId: string;
  displayName?: string;
};

type AuthedRequest = FastifyRequest & {
  authUser?: StaffSession & { partnerId?: string };
  adminUser?: StaffSession;
  financeUser?: StaffSession;
  partnerUser?: PartnerSession;
};

type IdParams = { id: string };
type AnyBody = Record<string, any>;
type AnyQuery = Record<string, any>;

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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

async function requireFinanceAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const session = await getSession(bearerToken(request));
    if (!session || session.role !== "finance") {
      return reply.code(401).send({ error: "Authentication required." });
    }
    const authedRequest = request as AuthedRequest;
    authedRequest.financeUser = session;
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
      partnerId: session.partnerId,
      displayName: session.displayName || "",
    } as any);
  } catch (error) {
    return reply.code(500).send({
      error: errorMessage(error, "Authentication failed."),
    });
  }
}

async function requireCommissionSlabsReadAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = bearerToken(request);
    const session = await getSession(token);
    if (session && (session.role === "admin" || session.role === "finance")) {
      const authedRequest = request as AuthedRequest;
      authedRequest.authUser = session;
      if (session.role === "admin") {
        authedRequest.adminUser = session;
      } else {
        authedRequest.financeUser = session;
      }
      return;
    }

    if (token) {
      const partnerSession = await getPartnerSession(token);
      if (partnerSession) {
        const authedRequest = request as AuthedRequest;
        authedRequest.partnerUser = partnerSession as any;
        authedRequest.authUser = ({
          email: partnerSession.email,
          role: "partner",
          userId: partnerSession.partnerUserId,
          partnerId: partnerSession.partnerId,
          displayName: partnerSession.displayName || "",
        } as any);
        return;
      }
    }

    return reply.code(401).send({ error: "Authentication required." });
  } catch (error) {
    return reply.code(500).send({
      error: errorMessage(error, "Authentication failed."),
    });
  }
}

function partnerUser(request: FastifyRequest): PartnerSession {
  return (request as AuthedRequest).partnerUser as PartnerSession;
}

function financeEmail(request: FastifyRequest): string {
  const authedRequest = request as AuthedRequest;
  return authedRequest.financeUser?.email || authedRequest.authUser?.email || "";
}

export const nativeCommissionsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });

  app.get<{ Querystring: AnyQuery }>(
    "/api/commission-slabs",
    { preHandler: requireCommissionSlabsReadAuth },
    async (request, reply) => {
      try {
        const country = request.query.country
          ? String(request.query.country)
          : null;
        const slabs = await listCommissionSlabs({
          activeOnly: false,
          country,
        });
        return reply.send({ slabs });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load commission slabs."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/admin/commission-slabs",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const country = request.query.country
          ? String(request.query.country)
          : null;
        const slabs = await listCommissionSlabs({
          activeOnly: false,
          country,
        });
        return reply.send({ slabs });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load commission slabs."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/admin/commission-slabs",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const slab = await createCommissionSlab(request.body || {});
        return reply.code(201).send({ slab });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not create commission slab."),
        });
      }
    },
  );

  app.put<{ Params: IdParams; Body: AnyBody }>(
    "/api/admin/commission-slabs/:id",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const slab = await updateCommissionSlab(
          request.params.id,
          request.body || {},
        );
        return reply.send({ slab });
      } catch (error) {
        const message = errorMessage(
          error,
          "Could not update commission slab.",
        );
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/api/admin/commission-slabs/:id",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        await deleteCommissionSlab(request.params.id);
        return reply.send({ ok: true });
      } catch (error) {
        const message = errorMessage(
          error,
          "Could not delete commission slab.",
        );
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.get(
    "/api/partner/bank-account",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const partnerId = partnerUser(request).partnerId;
        const [bankAccount, country] = await Promise.all([
          getPartnerBankAccount(partnerId),
          getPartnerCountry(partnerId),
        ]);
        return reply.send({ bankAccount, country });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load bank account."),
        });
      }
    },
  );

  app.put<{ Body: AnyBody }>(
    "/api/partner/bank-account",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const partnerId = partnerUser(request).partnerId;
        const bankAccount = await upsertPartnerBankAccount(
          partnerId,
          request.body || {},
        );
        const country = await getPartnerCountry(partnerId);
        return reply.send({ bankAccount, country });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not save bank account."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/admin/partners/:id/bank-account",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const [bankAccount, country] = await Promise.all([
          getPartnerBankAccount(request.params.id),
          getPartnerCountry(request.params.id),
        ]);
        return reply.send({ bankAccount, country });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load bank account."),
        });
      }
    },
  );

  app.put<{ Params: IdParams; Body: AnyBody }>(
    "/api/admin/partners/:id/bank-account",
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const bankAccount = await upsertPartnerBankAccount(
          request.params.id,
          request.body || {},
        );
        const country = await getPartnerCountry(request.params.id);
        return reply.send({ bankAccount, country });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not save bank account."),
        });
      }
    },
  );

  app.get(
    "/api/partner/commissions",
    { preHandler: requirePartnerAuth },
    async (request, reply) => {
      try {
        const result = await listPartnerCommissions(
          partnerUser(request).partnerId,
        );
        return reply.send(result);
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load commissions."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/finance/commissions",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const status = request.query.status
          ? String(request.query.status)
          : null;
        const commissions = await listFinanceCommissions({ status });
        return reply.send({ commissions });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load commissions."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/finance/commissions/partners",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const status = request.query.status
          ? String(request.query.status)
          : null;
        const partners = await listFinanceCommissionPartners({ status });
        return reply.send({ partners });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load partner commissions."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/finance/commissions/partners/:id",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const overview = await getFinancePartnerCommissionOverview(
          request.params.id,
        );
        return reply.send(overview);
      } catch (error) {
        const message = errorMessage(
          error,
          "Could not load partner commission overview.",
        );
        return reply
          .code((error as any)?.status === 404 || message.includes("not found") ? 404 : 500)
          .send({ error: message });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/api/finance/commissions/:id/mark-paid",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const commission = await markPartnerCommissionPaid(
          request.params.id,
          {
            paidBy: financeEmail(request),
            payoutReference: request.body?.payoutReference || "",
            notes: request.body?.notes || "",
          },
        );
        return reply.send({ commission });
      } catch (error) {
        const message = errorMessage(
          error,
          "Could not mark commission as paid.",
        );
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );
};
