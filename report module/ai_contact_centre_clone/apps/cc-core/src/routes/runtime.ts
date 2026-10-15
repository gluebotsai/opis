import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { withOrganizationContext } from "../lib/rls.js";
import { publishAllQueuesForOrg } from "../services/queue-publish.js";
import {
  getRuntimeQueue,
  listRuntimeQueues,
  syncSetupUserToRuntimeAgent,
} from "../services/runtime.js";

function requireTenantId(
  app: FastifyInstance,
  request: { tenantId?: string },
): string {
  if (!request.tenantId) {
    throw app.httpErrors.unauthorized("Missing tenant context");
  }
  return request.tenantId;
}

export async function registerRuntimeRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/runtime");

    scoped.get(
      `${prefix}/queues`,
      {
        schema: {
          tags: ["Runtime"],
          summary: "Routing snapshot for active queues",
        },
      },
      async (request) => {
        const organizationId = requireTenantId(app, request);
        return withOrganizationContext(app.prisma, organizationId, (db) =>
          listRuntimeQueues(db, organizationId),
        );
      },
    );

    scoped.get(
      `${prefix}/queues/:id`,
      {
        schema: {
          tags: ["Runtime"],
          summary: "Routing snapshot for a single queue",
        },
      },
      async (request) => {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        try {
          return await withOrganizationContext(app.prisma, organizationId, (db) =>
            getRuntimeQueue(db, organizationId, id),
          );
        } catch (error) {
          if (
            typeof error === "object" &&
            error &&
            "status" in error &&
            (error as { status: number }).status === 404
          ) {
            throw app.httpErrors.notFound("Queue not found");
          }
          throw error;
        }
      },
    );

    scoped.post(`${prefix}/queues/republish`, async (request) => {
      const organizationId = requireTenantId(app, request);
      await withOrganizationContext(app.prisma, organizationId, (db) =>
        publishAllQueuesForOrg(db, organizationId),
      );
      return { ok: true };
    });

    scoped.post(`${prefix}/agents/sync/:userId`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { userId } = request.params as { userId: string };
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        syncSetupUserToRuntimeAgent(db, organizationId, userId),
      );
    });
  });
}
