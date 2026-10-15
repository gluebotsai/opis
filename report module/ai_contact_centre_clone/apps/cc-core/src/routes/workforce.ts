import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { withOrganizationContext } from "../lib/rls.js";
import {
  businessHoursInputSchema,
  createBusinessHours,
  listPresence,
  listWorkforceAgents,
  listWorkforceShifts,
  updateAgentSkills,
  updateAgentSkillsSchema,
} from "../services/workforce.js";

function requireTenantId(
  app: FastifyInstance,
  request: { tenantId?: string },
): string {
  if (!request.tenantId) {
    throw app.httpErrors.unauthorized("Missing tenant context");
  }
  return request.tenantId;
}

export async function registerWorkforceRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/setup/workforce");

    scoped.get(`${prefix}/agents`, async (request) => {
      const organizationId = requireTenantId(app, request);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        listWorkforceAgents(db, organizationId),
      );
    });

    scoped.patch(`${prefix}/agents/:id/skills`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      const body = updateAgentSkillsSchema.parse(request.body);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        updateAgentSkills(db, organizationId, id, body.skills),
      );
    });

    scoped.get(`${prefix}/shifts`, async (request) => {
      const organizationId = requireTenantId(app, request);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        listWorkforceShifts(db, organizationId),
      );
    });

    scoped.post(`${prefix}/business-hours`, async (request, reply) => {
      const organizationId = requireTenantId(app, request);
      const input = businessHoursInputSchema.parse(request.body);
      const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
        createBusinessHours(db, organizationId, input),
      );
      return reply.status(201).send(result);
    });

    scoped.get(`${prefix}/presence`, async (request) => {
      const organizationId = requireTenantId(app, request);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        listPresence(db, organizationId, app.prisma),
      );
    });
  });
}
