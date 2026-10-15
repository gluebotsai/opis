import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { withOrganizationContext } from "../lib/rls.js";
import {
  acknowledgeAgentMissedContact,
  acknowledgeAllAgentMissedContacts,
  listAgentMissedContacts,
} from "../services/agent-missed-contacts.js";
import { routeIdParams } from "../lib/route-param-schemas.js";
import { requireTenantId } from "../services/reporting.js";

const missedContactIdParams = routeIdParams("id");

export async function registerAgentMissedContactRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/workspace/missed-contacts");

    scoped.get(
      prefix,
      {
        schema: {
          tags: ["Workspace"],
          summary: "List missed contact notifications for the current agent",
        },
      },
      async (request) => {
        const { organizationId, userId } = requireTenantId(app, request);
        const query = z
          .object({
            limit: z.coerce.number().int().min(1).max(100).optional(),
            unreadOnly: z.coerce.boolean().optional(),
          })
          .parse(request.query);

        return withOrganizationContext(app.prisma, organizationId, (db) =>
          listAgentMissedContacts(db, organizationId, userId, query),
        );
      },
    );

    scoped.post(
      `${prefix}/acknowledge-all`,
      {
        schema: {
          tags: ["Workspace"],
          summary: "Mark all missed contact notifications as read",
        },
      },
      async (request) => {
        const { organizationId, userId } = requireTenantId(app, request);
        const acknowledgedCount = await withOrganizationContext(
          app.prisma,
          organizationId,
          (db) => acknowledgeAllAgentMissedContacts(db, organizationId, userId),
        );
        return { acknowledgedCount, unreadCount: 0 };
      },
    );

    scoped.post(
      `${prefix}/:id/acknowledge`,
      {
        schema: {
          tags: ["Workspace"],
          summary: "Mark one missed contact notification as read",
          ...missedContactIdParams,
        },
      },
      async (request) => {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const result = await withOrganizationContext(app.prisma, organizationId, async (db) => {
          const item = await acknowledgeAgentMissedContact(db, organizationId, userId, id);
          if (!item) return null;
          const listed = await listAgentMissedContacts(db, organizationId, userId, { limit: 1 });
          return { item, unreadCount: listed.unreadCount };
        });
        if (!result) {
          throw app.httpErrors.notFound("Missed contact notification not found");
        }
        return result;
      },
    );
  });
}
