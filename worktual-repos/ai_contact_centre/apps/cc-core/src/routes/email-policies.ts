import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { withOrganizationContext } from "../lib/rls.js";
import { entityIdSchema } from "../lib/id-schema.js";
import {
  resolveEmailMailboxPolicy,
  getEmailAutomationMetrics,
  listEmailQueueProfiles,
  upsertEmailMailboxPolicy,
  upsertEmailMailboxPolicySchema,
  upsertQueueRoutingProfile,
  upsertQueueRoutingProfileSchema,
} from "../services/email-policies.js";

function requireTenantId(app: FastifyInstance, request: { tenantId?: string }): string {
  if (!request.tenantId) throw app.httpErrors.unauthorized("Missing tenant context");
  return request.tenantId;
}

export async function registerEmailPolicyRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/email/mailbox-policy");

    scoped.get(prefix, async (request) => {
      const organizationId = requireTenantId(app, request);
      const query = z
        .object({
          connectionId: entityIdSchema.optional(),
          accountEmail: z.string().email(),
        })
        .parse(request.query);
      return withOrganizationContext(app.prisma, organizationId, async (db) => {
        const resolved = await resolveEmailMailboxPolicy(db, organizationId, query);
        const policy = resolved
          ? {
              ...resolved,
              source: resolved.source,
            }
          : null;
        const queues = await listEmailQueueProfiles(
          db,
          organizationId,
          policy?.allowedQueueIds ?? [],
        );
        return { policy, queues };
      });
    });

    scoped.put(prefix, async (request) => {
      const organizationId = requireTenantId(app, request);
      const payload = upsertEmailMailboxPolicySchema.parse(request.body);
      return withOrganizationContext(app.prisma, organizationId, async (db) => {
        const policy = await upsertEmailMailboxPolicy(db, organizationId, payload);
        const queues = await listEmailQueueProfiles(db, organizationId, policy.allowedQueueIds);
        return { policy, queues };
      });
    });

    scoped.put(joinApiV1(apiV1Base, "/queues/:id/routing-profile"), async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = z.object({ id: entityIdSchema }).parse(request.params);
      const payload = upsertQueueRoutingProfileSchema.parse(request.body);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        upsertQueueRoutingProfile(db, organizationId, id, payload),
      );
    });

    scoped.get(joinApiV1(apiV1Base, "/email/metrics"), async (request) => {
      const organizationId = requireTenantId(app, request);
      const { windowHours } = z
        .object({ windowHours: z.coerce.number().int().min(1).max(720).default(24) })
        .parse(request.query);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        getEmailAutomationMetrics(db, organizationId, windowHours),
      );
    });
  });
}
