import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { writeAuditLog } from "../lib/audit-log.js";
import { withOrganizationContext, withOrganizationReadContext } from "../lib/rls.js";
import {
  ContactConflictError,
  contactCreatedCountQuerySchema,
  contactCreateSchema,
  contactListQuerySchema,
  contactUpdateSchema,
  formatContactSchemaError,
  countContactsCreated,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  updateContact,
} from "../services/contacts.js";
import {
  listContactInteractions,
  resolveContactByIdentifiers,
} from "../services/contact-interactions.js";
import {
  formatQueueDisplayLabel,
  resolveQueueDisplayNames,
} from "../services/conversations.js";
import { routeCdpIdParams } from "../lib/route-param-schemas.js";

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
    throw app.httpErrors.badRequest(formatContactSchemaError(error));
  }
  if (error instanceof ContactConflictError) {
    throw app.httpErrors.conflict(error.message);
  }
  throw error;
}

const contactIdParams = routeCdpIdParams("id");

export async function registerContactRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/cdp");

    scoped.get(
      `${prefix}/contacts`,
      {
        schema: {
          tags: ["Contacts"],
          summary: "List CDP contacts",
        },
      },
      async (request) => {
        const organizationId = requireTenantId(app, request);
        try {
          const query = contactListQuerySchema.parse(request.query);
          return withOrganizationReadContext(app.prisma, organizationId, (db) =>
            listContacts(db, organizationId, query),
          );
        } catch (error) {
          handleRouteError(app, error);
        }
      },
    );

    scoped.get(
      `${prefix}/contacts/stats/created`,
      {
        schema: {
          tags: ["Contacts"],
          summary: "Count contacts created in a date range",
        },
      },
      async (request) => {
        const organizationId = requireTenantId(app, request);
        try {
          const query = contactCreatedCountQuerySchema.parse(request.query);
          return withOrganizationReadContext(app.prisma, organizationId, (db) =>
            countContactsCreated(db, organizationId, query),
          );
        } catch (error) {
          handleRouteError(app, error);
        }
      },
    );

    scoped.get(
      `${prefix}/contacts/resolve`,
      {
        schema: {
          tags: ["Contacts"],
          summary: "Resolve a CDP contact by email or phone",
        },
      },
      async (request) => {
        const organizationId = requireTenantId(app, request);
        const query = request.query as { email?: string; phone?: string };
        const resolved = await withOrganizationContext(app.prisma, organizationId, (db) =>
          resolveContactByIdentifiers(db, organizationId, {
            email: query.email,
            phone: query.phone,
          }),
        );
        if (!resolved) {
          throw app.httpErrors.notFound("Contact not found");
        }
        const contact = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getContact(db, organizationId, resolved.contactId),
        );
        return { contactId: resolved.contactId, contact };
      },
    );

    scoped.get(
      `${prefix}/contacts/:id/interactions`,
      {
        schema: {
          tags: ["Contacts"],
          summary: "List cross-channel interactions for a contact",
          ...contactIdParams,
        },
      },
      async (request) => {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const query = request.query as { offset?: string; limit?: string };
        const offset = query.offset ? Number.parseInt(query.offset, 10) : 0;
        const limit = query.limit ? Number.parseInt(query.limit, 10) : 15;
        const contact = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getContact(db, organizationId, id),
        );
        if (!contact) {
          throw app.httpErrors.notFound("Contact not found");
        }
        const page = await withOrganizationContext(app.prisma, organizationId, (db) =>
          listContactInteractions(db, organizationId, id, { offset, limit }),
        );
        const queueNames = await withOrganizationContext(app.prisma, organizationId, (db) =>
          resolveQueueDisplayNames(
            db,
            organizationId,
            page.interactions.map((interaction) => interaction.queueId),
          ),
        );
        return {
          interactions: page.interactions.map((interaction) => ({
            id: interaction.id,
            conversationId: interaction.conversationId,
            messageId: interaction.messageId ?? "",
            channel: interaction.channel === "webchat" ? "chat" : interaction.channel,
            queue: formatQueueDisplayLabel(
              interaction.queueId,
              interaction.queueId ? queueNames.get(interaction.queueId) : null,
            ),
            subject: interaction.subject ?? "Conversation",
            summary: interaction.summary,
            occurredAt: interaction.occurredAt,
            createdAt: interaction.createdAt,
            endedAt: interaction.endedAt,
            resolvedAt: interaction.resolvedAt,
            endReason: interaction.endReason,
            dispositionCode: interaction.dispositionCode,
            resolutionCode: interaction.resolutionCode,
            handoffReason: interaction.handoffReason,
            status: interaction.status,
            agentConnected: interaction.agentConnected,
            direction: interaction.direction,
            botMemory: interaction.botMemory,
          })),
          total: page.total,
          offset: page.offset,
          hasMore: page.hasMore,
        };
      },
    );

    scoped.get(
      `${prefix}/contacts/:id`,
      {
        schema: {
          tags: ["Contacts"],
          summary: "Get CDP contact",
          ...contactIdParams,
        },
      },
      async (request) => {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const contact = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getContact(db, organizationId, id),
        );
        if (!contact) {
          throw app.httpErrors.notFound("Contact not found");
        }
        return { contact };
      },
    );

    scoped.post(
      `${prefix}/contacts`,
      {
        schema: {
          tags: ["Contacts"],
          summary: "Create a CDP contact",
        },
      },
      async (request, reply) => {
        const organizationId = requireTenantId(app, request);
        try {
          const input = contactCreateSchema.parse(request.body);
          const contact = await withOrganizationContext(app.prisma, organizationId, (db) =>
            createContact(db, organizationId, input),
          );
          await writeAuditLog({
            organizationId,
            userId: request.userId,
            action: "contact.create",
            resourceType: "contact",
            resourceId: contact.id,
            metadata: { primaryEmail: contact.primaryEmail },
          });
          return reply.code(201).send({ contact });
        } catch (error) {
          handleRouteError(app, error);
        }
      },
    );

    scoped.patch(
      `${prefix}/contacts/:id`,
      {
        schema: {
          tags: ["Contacts"],
          summary: "Update a CDP contact",
          ...contactIdParams,
        },
      },
      async (request) => {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        try {
          const input = contactUpdateSchema.parse(request.body);
          const contact = await withOrganizationContext(app.prisma, organizationId, (db) =>
            updateContact(db, organizationId, id, input),
          );
          if (!contact) throw app.httpErrors.notFound("Contact not found");
          await writeAuditLog({
            organizationId,
            userId: request.userId,
            action: "contact.update",
            resourceType: "contact",
            resourceId: contact.id,
            metadata: { changedFields: Object.keys(input) },
          });
          return { contact };
        } catch (error) {
          handleRouteError(app, error);
        }
      },
    );

    scoped.delete(
      `${prefix}/contacts/:id`,
      {
        schema: {
          tags: ["Contacts"],
          summary: "Deactivate a CDP contact",
          ...contactIdParams,
        },
      },
      async (request) => {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const contact = await withOrganizationContext(app.prisma, organizationId, (db) =>
          deleteContact(db, organizationId, id),
        );
        if (!contact) {
          throw app.httpErrors.notFound("Contact not found");
        }
        await writeAuditLog({
          organizationId,
          userId: request.userId,
          action: "contact.delete",
          resourceType: "contact",
          resourceId: contact.id,
          metadata: { primaryEmail: contact.primaryEmail },
        });
        return { contact };
      },
    );
  });
}
