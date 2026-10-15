import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { getSession } from "../auth/session-auth.js";
import {
  addProviderInventoryNumber,
  confirmProviderNumberImport,
  createAvailableNumber,
  createNumberMapping,
  createNumberProvider,
  getFinanceUsageForm,
  getNumberManagementCustomer,
  getNumberManagementDashboard,
  getNumberProvider,
  getTenantMappingCapacity,
  listAvailableNumbers,
  listCustomerUsage,
  listFinanceUsageCustomers,
  listNumberMappings,
  listNumberProviders,
  listProviderInventory,
  patchNumberMapping,
  patchNumberProvider,
  previewProviderNumberImport,
  removeAvailableNumber,
  removeNumberMapping,
  removeNumberProvider,
  removeProviderInventoryNumber,
  saveFinanceUsage,
} from "./number-store.js";

type StaffSession = {
  email: string;
  role: string;
  userId?: string | null;
};

type AuthedRequest = FastifyRequest & {
  authUser?: StaffSession;
  financeUser?: StaffSession;
  numberManagementUser?: StaffSession;
};

type IdParams = { id: string };
type OrganizationParams = { organizationId: string };
type AnyBody = Record<string, any>;
type AnyQuery = Record<string, any>;

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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

async function requireNumberManagementAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const session = await getSession(bearerToken(request));
    if (!session || session.role !== "number_management") {
      return reply.code(401).send({ error: "Authentication required." });
    }
    const authedRequest = request as AuthedRequest;
    authedRequest.numberManagementUser = session;
    authedRequest.authUser = session;
  } catch (error) {
    return reply.code(500).send({
      error: errorMessage(error, "Authentication failed."),
    });
  }
}

function actorEmail(
  request: FastifyRequest,
  role: "finance" | "number_management",
): string {
  const authedRequest = request as AuthedRequest;
  const roleUser =
    role === "finance"
      ? authedRequest.financeUser
      : authedRequest.numberManagementUser;
  return roleUser?.email || authedRequest.authUser?.email || "";
}

export const nativeNumberManagementRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-route-host", "fastify");
    return payload;
  });

  app.get(
    "/api/finance/agent-did-usage/customers",
    { preHandler: requireFinanceAuth },
    async (_request, reply) => {
      try {
        const customers = await listFinanceUsageCustomers();
        return reply.send({ customers });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load customers."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/finance/agent-did-usage",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const form = await getFinanceUsageForm(
          request.query.tenantId ? String(request.query.tenantId) : "",
          request.query.yearMonth ? String(request.query.yearMonth) : "",
        );
        return reply.send(form);
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not load usage form."),
        });
      }
    },
  );

  app.put<{ Body: AnyBody }>(
    "/api/finance/agent-did-usage",
    { preHandler: requireFinanceAuth },
    async (request, reply) => {
      try {
        const result = await saveFinanceUsage(
          request.body || {},
          actorEmail(request, "finance"),
        );
        return reply.send(result);
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not save usage."),
        });
      }
    },
  );

  app.get(
    "/api/number-management/dashboard",
    { preHandler: requireNumberManagementAuth },
    async (_request, reply) => {
      try {
        const dashboard = await getNumberManagementDashboard();
        return reply.send(dashboard);
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load dashboard."),
        });
      }
    },
  );

  app.get<{ Params: OrganizationParams }>(
    "/api/number-management/customers/:organizationId",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const detail = await getNumberManagementCustomer(
          request.params.organizationId,
        );
        return reply.send(detail);
      } catch (error) {
        const message = errorMessage(error, "Could not load customer.");
        return reply
          .code(message.includes("not found") ? 404 : 500)
          .send({ error: message });
      }
    },
  );

  app.get<{ Params: OrganizationParams; Querystring: AnyQuery }>(
    "/api/number-management/customers/:organizationId/usage",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const usage = await listCustomerUsage(
          request.params.organizationId,
          request.query.yearMonth ? String(request.query.yearMonth) : "",
        );
        return reply.send({ usage });
      } catch (error) {
        const message = errorMessage(error, "Could not load usage.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/number-management/mappings",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const mappings = await listNumberMappings({
          search: request.query.search ? String(request.query.search) : "",
          tenantId: request.query.tenantId
            ? String(request.query.tenantId)
            : "",
          status: request.query.status ? String(request.query.status) : "",
        });
        return reply.send({ mappings });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load mappings."),
        });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/number-management/mapping-capacity",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const capacity = await getTenantMappingCapacity(
          request.query.tenantId ? String(request.query.tenantId) : "",
          request.query.excludeMappingId
            ? String(request.query.excludeMappingId)
            : null,
        );
        return reply.send(capacity);
      } catch (error) {
        const message = errorMessage(error, "Could not load mapping capacity.");
        const notFound =
          message.includes("not found") || message.includes("entitlement");
        return reply.code(notFound ? 404 : 400).send({ error: message });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/number-management/available-numbers",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const numbers = await listAvailableNumbers({
          search: request.query.search ? String(request.query.search) : "",
        });
        return reply.send({ numbers });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load available numbers."),
        });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/number-management/available-numbers",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const number = await createAvailableNumber(
          request.body || {},
          actorEmail(request, "number_management"),
        );
        return reply.code(201).send({ number });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not add available number."),
        });
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/api/number-management/available-numbers/:id",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        await removeAvailableNumber(request.params.id);
        return reply.send({ ok: true });
      } catch (error) {
        const message = errorMessage(error, "Could not delete available number.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.get<{ Querystring: AnyQuery }>(
    "/api/number-management/providers",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const providers = await listNumberProviders({
          search: request.query.search ? String(request.query.search) : "",
        });
        return reply.send({ providers });
      } catch (error) {
        return reply.code(500).send({
          error: errorMessage(error, "Could not load providers."),
        });
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/api/number-management/providers/:id",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const provider = await getNumberProvider(request.params.id);
        return reply.send({ provider });
      } catch (error) {
        const message = errorMessage(error, "Could not load provider.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/number-management/providers",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const provider = await createNumberProvider(
          request.body || {},
          actorEmail(request, "number_management"),
        );
        return reply.code(201).send({ provider });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not create provider."),
        });
      }
    },
  );

  app.put<{ Params: IdParams; Body: AnyBody }>(
    "/api/number-management/providers/:id",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const provider = await patchNumberProvider(
          request.params.id,
          request.body || {},
          actorEmail(request, "number_management"),
        );
        return reply.send({ provider });
      } catch (error) {
        const message = errorMessage(error, "Could not update provider.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/api/number-management/providers/:id",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        await removeNumberProvider(request.params.id);
        return reply.send({ ok: true });
      } catch (error) {
        const message = errorMessage(error, "Could not delete provider.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.get<{ Params: IdParams; Querystring: AnyQuery }>(
    "/api/number-management/providers/:id/numbers",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const numbers = await listProviderInventory(request.params.id, {
          search: request.query.search ? String(request.query.search) : "",
        });
        return reply.send({ numbers });
      } catch (error) {
        const message = errorMessage(error, "Could not load provider numbers.");
        return reply
          .code(message.includes("not found") ? 404 : 500)
          .send({ error: message });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/api/number-management/providers/:id/numbers",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const number = await addProviderInventoryNumber(
          request.params.id,
          request.body || {},
          actorEmail(request, "number_management"),
        );
        return reply.code(201).send({ number });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not add number."),
        });
      }
    },
  );

  app.delete<{ Params: IdParams & { numberId: string } }>(
    "/api/number-management/providers/:id/numbers/:numberId",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        await removeProviderInventoryNumber(
          request.params.id,
          request.params.numberId,
        );
        return reply.send({ ok: true });
      } catch (error) {
        const message = errorMessage(error, "Could not delete number.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/api/number-management/providers/:id/numbers/import-preview",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const preview = await previewProviderNumberImport(
          request.params.id,
          request.body || {},
        );
        return reply.send(preview);
      } catch (error) {
        const message = errorMessage(error, "Could not preview import.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.post<{ Params: IdParams; Body: AnyBody }>(
    "/api/number-management/providers/:id/numbers/import",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const result = await confirmProviderNumberImport(
          request.params.id,
          request.body || {},
          actorEmail(request, "number_management"),
        );
        return reply.send(result);
      } catch (error) {
        const message = errorMessage(error, "Could not import numbers.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.post<{ Body: AnyBody }>(
    "/api/number-management/mappings",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const mapping = await createNumberMapping(
          request.body || {},
          actorEmail(request, "number_management"),
        );
        return reply.code(201).send({ mapping });
      } catch (error) {
        return reply.code(400).send({
          error: errorMessage(error, "Could not create mapping."),
        });
      }
    },
  );

  app.put<{ Params: IdParams; Body: AnyBody }>(
    "/api/number-management/mappings/:id",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        const mapping = await patchNumberMapping(
          request.params.id,
          request.body || {},
          actorEmail(request, "number_management"),
        );
        return reply.send({ mapping });
      } catch (error) {
        const message = errorMessage(error, "Could not update mapping.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/api/number-management/mappings/:id",
    { preHandler: requireNumberManagementAuth },
    async (request, reply) => {
      try {
        await removeNumberMapping(request.params.id);
        return reply.send({ ok: true });
      } catch (error) {
        const message = errorMessage(error, "Could not delete mapping.");
        return reply
          .code(message.includes("not found") ? 404 : 400)
          .send({ error: message });
      }
    },
  );
};
