import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { withOrganizationContext } from "../lib/rls.js";
import { jsonStringifyEntityPayload } from "../lib/id-schema.js";
import {
  agentTaskUpdateSchema,
  getAgentTask,
  isAgentTaskNotFound,
  listAgentTasks,
  updateAgentTask,
} from "../services/agent-tasks.js";
import { openAgentWorkspaceFromTask } from "../services/agent-workspace-from-task.js";
import { routeIdParams } from "../lib/route-param-schemas.js";
import { requireTenantId } from "../services/reporting.js";
import {
  emitConversationAssigned,
  emitConversationCreated,
} from "../services/realtime.js";

const taskIdParams = routeIdParams("id");

export async function registerAgentTaskRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/workspace/tasks");

    scoped.get(
      prefix,
      {
        schema: {
          tags: ["Workspace"],
          summary: "List agent tasks for the current user",
        },
      },
      async (request, reply) => {
        const { organizationId, userId } = requireTenantId(app, request);
        const payload = await withOrganizationContext(app.prisma, organizationId, (db) =>
          listAgentTasks(db, organizationId, userId),
        );
        reply.type("application/json");
        return reply.send(JSON.parse(jsonStringifyEntityPayload(payload)));
      },
    );

    scoped.get(
      `${prefix}/:id`,
      {
        schema: {
          tags: ["Workspace"],
          summary: "Get an agent task",
          ...taskIdParams,
        },
      },
      async (request, reply) => {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const task = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getAgentTask(db, organizationId, userId, id),
        );
        if (!task) {
          throw app.httpErrors.notFound("Task not found");
        }
        reply.type("application/json");
        return reply.send(JSON.parse(jsonStringifyEntityPayload({ task })));
      },
    );

    scoped.post(
      `${prefix}/:id/open-workspace`,
      {
        schema: {
          tags: ["Workspace"],
          summary: "Open agent workspace for a task (same contact and channel)",
          ...taskIdParams,
        },
      },
      async (request, reply) => {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        try {
          const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
            openAgentWorkspaceFromTask(db, organizationId, userId, id),
          );
          if (result.created) {
            emitConversationCreated(organizationId, result.conversation);
          }
          emitConversationAssigned(organizationId, result.conversation, userId);
          reply.type("application/json");
          return reply.send(
            JSON.parse(
              jsonStringifyEntityPayload({
                conversationId: result.conversation.id,
                conversation: result.conversation,
              }),
            ),
          );
        } catch (error) {
          if (error instanceof Error && "status" in error) {
            const status = (error as Error & { status: number }).status;
            if (status === 404) {
              throw app.httpErrors.notFound(error.message);
            }
            if (status === 403) {
              throw app.httpErrors.forbidden(error.message);
            }
            if (status === 400) {
              throw app.httpErrors.badRequest(error.message);
            }
          }
          throw error;
        }
      },
    );

    scoped.patch(
      `${prefix}/:id`,
      {
        schema: {
          tags: ["Workspace"],
          summary: "Update an agent task",
          ...taskIdParams,
        },
      },
      async (request, reply) => {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        try {
          const body = agentTaskUpdateSchema.parse(request.body);
          const task = await withOrganizationContext(app.prisma, organizationId, (db) =>
            updateAgentTask(db, organizationId, userId, id, body.action),
          );
          reply.type("application/json");
          return reply.send(JSON.parse(jsonStringifyEntityPayload({ task })));
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid payload");
          }
          if (isAgentTaskNotFound(error)) {
            throw app.httpErrors.notFound("Task not found");
          }
          throw error;
        }
      },
    );
  });
}
