import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";
import { writeAuditLog } from "../lib/audit-log.js";
import { withOrganizationContext } from "../lib/rls.js";
import {
  createQueue,
  deleteQueue,
  getQueue,
  listBusinessHours,
  listEligibleAgents,
  listQueues,
  listQueuesQuerySchema,
  listTeams,
  queueAgentSchema,
  queueInputSchema,
  replaceQueueAgents,
  updateQueue,
} from "../services/queues.js";
import { entityIdJsonSchema, routeIdParams } from "../lib/route-param-schemas.js";

function requireTenantId(
  app: FastifyInstance,
  request: { tenantId?: string },
): string {
  if (!request.tenantId) {
    throw app.httpErrors.unauthorized("Missing tenant context");
  }
  return request.tenantId;
}

function handleRouteError(app: FastifyInstance, error: unknown): never {
  if (error instanceof z.ZodError) {
    throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid payload");
  }
  if (
    typeof error === "object" &&
    error &&
    "code" in error &&
    (error as { code: string }).code === "P2003"
  ) {
    throw app.httpErrors.badRequest(
      "This queue is still linked to a channel or phone number. Remove those links first.",
    );
  }
  if (
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    const message = error instanceof Error ? error.message : "Request failed";
    if (status === 404) throw app.httpErrors.notFound(message);
    if (status === 400) throw app.httpErrors.badRequest(message);
    if (status === 403) throw app.httpErrors.forbidden(message);
  }
  throw error;
}

const queueIdParams = routeIdParams("id");

export async function registerQueueRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/setup/ccaas");

  scoped.get(
    `${prefix}/teams`,
    {
      schema: {
        tags: ["Queues"],
        summary: "List teams for queue setup",
      },
    },
    async (request) => {
      const organizationId = requireTenantId(app, request);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        listTeams(db, organizationId),
      );
    },
  );

  scoped.get(
    `${prefix}/business-hours`,
    {
      schema: {
        tags: ["Queues"],
        summary: "List business hours schedules",
      },
    },
    async (request) => {
      const organizationId = requireTenantId(app, request);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        listBusinessHours(db, organizationId),
      );
    },
  );

  scoped.get(
    `${prefix}/eligible-agents`,
    {
      schema: {
        tags: ["Queues"],
        summary: "List Contact Center Agent and Admin users eligible for queue assignment",
        querystring: {
          type: "object",
          properties: {
            queueId: entityIdJsonSchema,
          },
        },
      },
    },
    async (request) => {
      const organizationId = requireTenantId(app, request);
      const { queueId } = request.query as { queueId?: string };
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        listEligibleAgents(db, organizationId, queueId),
      );
    },
  );

  scoped.get(
    `${prefix}/queues`,
    {
      schema: {
        tags: ["Queues"],
        summary: "List queues with pagination and filters",
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100 },
            teamId: entityIdJsonSchema,
            status: { type: "string", enum: ["active", "inactive"] },
            sort: { type: "string", enum: ["name", "updatedAt", "status"] },
            order: { type: "string", enum: ["asc", "desc"] },
          },
        },
      },
    },
    async (request) => {
      const organizationId = requireTenantId(app, request);
      const query = listQueuesQuerySchema.parse(request.query);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        listQueues(db, organizationId, query),
      );
    },
  );

  scoped.get(
    `${prefix}/queues/:id`,
    {
      schema: {
        tags: ["Queues"],
        summary: "Get a queue by id",
        ...queueIdParams,
      },
    },
    async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      try {
        return await withOrganizationContext(app.prisma, organizationId, (db) =>
          getQueue(db, organizationId, id),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  scoped.post(
    `${prefix}/queues`,
    {
      schema: {
        tags: ["Queues"],
        summary: "Create a queue",
      },
    },
    async (request, reply) => {
      const organizationId = requireTenantId(app, request);
      try {
        const input = queueInputSchema.parse(request.body);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          createQueue(db, organizationId, input),
        );
        await writeAuditLog({
          organizationId,
          userId: request.userId,
          action: "queue.create",
          resourceType: "queue",
          resourceId: result.queue.id,
          metadata: { name: result.queue.name },
        });
        return reply.status(201).send(result);
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  scoped.patch(
    `${prefix}/queues/:id`,
    {
      schema: {
        tags: ["Queues"],
        summary: "Update a queue",
        ...queueIdParams,
      },
    },
    async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      try {
        const input = queueInputSchema.partial().parse(request.body);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          updateQueue(db, organizationId, id, input),
        );
        await writeAuditLog({
          organizationId,
          userId: request.userId,
          action: "queue.update",
          resourceType: "queue",
          resourceId: id,
        });
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  scoped.delete(
    `${prefix}/queues/:id`,
    {
      schema: {
        tags: ["Queues"],
        summary: "Delete a queue",
        ...queueIdParams,
      },
    },
    async (request, reply) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      try {
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          deleteQueue(db, organizationId, id),
        );
        await writeAuditLog({
          organizationId,
          userId: request.userId,
          action: "queue.delete",
          resourceType: "queue",
          resourceId: id,
        });
        return reply.status(204).send();
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  scoped.put(
    `${prefix}/queues/:id/agents`,
    {
      schema: {
        tags: ["Queues"],
        summary: "Replace queue agent assignments",
        ...queueIdParams,
      },
    },
    async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      try {
        const body = z.object({ agents: z.array(queueAgentSchema) }).parse(request.body);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          replaceQueueAgents(db, organizationId, id, body.agents),
        );
        await writeAuditLog({
          organizationId,
          userId: request.userId,
          action: "queue.agents.replace",
          resourceType: "queue",
          resourceId: id,
          metadata: { agentCount: body.agents.length },
        });
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );
  });
}
