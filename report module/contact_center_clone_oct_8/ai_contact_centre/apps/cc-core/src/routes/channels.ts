import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { writeAuditLog } from "../lib/audit-log.js";
import { withOrganizationContext } from "../lib/rls.js";
import {
  channelQueueBindingSchema,
  listChannelQueueBindings,
  updateVoiceQueueBinding,
  updateWebchatQueueBinding,
} from "../services/channels.js";

function requireTenantId(
  app: FastifyInstance,
  request: { tenantId?: string },
): string {
  if (!request.tenantId) {
    throw app.httpErrors.unauthorized("Missing tenant context");
  }
  return request.tenantId;
}

export async function registerChannelRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/setup/channels");

    scoped.get(`${prefix}/queue-bindings`, async (request) => {
      const organizationId = requireTenantId(app, request);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        listChannelQueueBindings(db, organizationId),
      );
    });

    scoped.patch(`${prefix}/webchat/:channelConfigId/queue`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { channelConfigId } = request.params as { channelConfigId: string };
      const body = channelQueueBindingSchema.parse(request.body);
      const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
        updateWebchatQueueBinding(db, organizationId, channelConfigId, body.routingQueueId),
      );
      await writeAuditLog({
        organizationId,
        userId: request.userId,
        action: "channel.queue.bind",
        resourceType: "webchat",
        resourceId: channelConfigId,
        metadata: { routingQueueId: body.routingQueueId },
      });
      return result;
    });

    scoped.patch(`${prefix}/voice/:didId/queue`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { didId } = request.params as { didId: string };
      const body = channelQueueBindingSchema.parse(request.body);
      const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
        updateVoiceQueueBinding(db, organizationId, didId, body.routingQueueId),
      );
      await writeAuditLog({
        organizationId,
        userId: request.userId,
        action: "channel.queue.bind",
        resourceType: "voice",
        resourceId: didId,
        metadata: { routingQueueId: body.routingQueueId },
      });
      return result;
    });
  });
}
