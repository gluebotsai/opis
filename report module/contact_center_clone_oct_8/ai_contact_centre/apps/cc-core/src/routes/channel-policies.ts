import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { withOrganizationContext } from "../lib/rls.js";
import { entityIdSchema } from "../lib/id-schema.js";
import {
  resolveChannelPolicy,
  resolveChannelPolicyInputSchema,
  upsertChannelPolicy,
  upsertChannelPolicySchema,
} from "../services/channel-policies.js";

function requireTenantId(app: FastifyInstance, request: { tenantId?: string }): string {
  if (!request.tenantId) throw app.httpErrors.unauthorized("Missing tenant context");
  return request.tenantId;
}

export async function registerChannelPolicyRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/channel-policies");

    scoped.get(prefix, async (request) => {
      const organizationId = requireTenantId(app, request);
      const query = resolveChannelPolicyInputSchema.parse(request.query);
      return withOrganizationContext(app.prisma, organizationId, async (db) =>
        resolveChannelPolicy(db, organizationId, query),
      );
    });

    scoped.put(prefix, async (request) => {
      const organizationId = requireTenantId(app, request);
      const payload = upsertChannelPolicySchema.parse(request.body);
      return withOrganizationContext(app.prisma, organizationId, async (db) =>
        upsertChannelPolicy(db, organizationId, payload),
      );
    });

    scoped.get(`${prefix}/:channelConfigId`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { channelConfigId } = z.object({ channelConfigId: entityIdSchema }).parse(request.params);
      const query = z
        .object({
          channel: z.enum(["webchat", "email", "whatsapp", "instagram", "facebook"]),
          accountEmail: z.string().email().optional(),
        })
        .parse(request.query);
      return withOrganizationContext(app.prisma, organizationId, async (db) =>
        resolveChannelPolicy(db, organizationId, {
          channelConfigId,
          channel: query.channel,
          accountEmail: query.accountEmail,
        }),
      );
    });
  });
}
