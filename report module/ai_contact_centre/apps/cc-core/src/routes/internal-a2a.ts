import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { withStaffContext } from "../lib/rls.js";
import {
  cancelA2ATask,
  createA2ATaskSchema,
  createOrGetA2ATask,
  getA2ATask,
  listA2ATasks,
  updateA2ATask,
  updateA2ATaskSchema,
} from "../services/a2a-spoke-tasks.js";
import {
  getHubOutboundToken,
  upsertHubOutboundToken,
  upsertHubOutboundTokenSchema,
} from "../services/a2a-hub-tokens.js";

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
    "status" in error &&
    typeof (error as { status: number }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    const message = error instanceof Error ? error.message : "Request failed";
    if (status === 404) throw app.httpErrors.notFound(message);
    if (status === 409) throw app.httpErrors.conflict(message);
    if (status === 400) throw app.httpErrors.badRequest(message);
  }
  throw error;
}

export async function registerInternalA2ARoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/v1/a2a/tasks",
    { preHandler: app.requireInternalService },
    async (request) => {
      try {
        const body = createA2ATaskSchema.parse(request.body ?? {});
        request.tenantId = body.organizationId;
        const organizationId = requireTenantId(app, request);
        return await withStaffContext(app.prisma, async (db) =>
          createOrGetA2ATask(db, { ...body, organizationId }),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  app.get(
    "/internal/v1/a2a/tasks",
    { preHandler: app.requireInternalService },
    async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const query = z
          .object({
            callerSubject: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(200).optional(),
          })
          .parse(request.query ?? {});
        return await withStaffContext(app.prisma, async (db) =>
          listA2ATasks(db, organizationId, query),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  app.get(
    "/internal/v1/a2a/tasks/:taskId",
    { preHandler: app.requireInternalService },
    async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const params = z.object({ taskId: z.string().min(1) }).parse(request.params);
        return await withStaffContext(app.prisma, async (db) =>
          getA2ATask(db, organizationId, params.taskId),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  app.patch(
    "/internal/v1/a2a/tasks/:taskId",
    { preHandler: app.requireInternalService },
    async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const params = z.object({ taskId: z.string().min(1) }).parse(request.params);
        const body = updateA2ATaskSchema.parse(request.body ?? {});
        return await withStaffContext(app.prisma, async (db) =>
          updateA2ATask(db, organizationId, params.taskId, body),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  app.post(
    "/internal/v1/a2a/tasks/:taskId/cancel",
    { preHandler: app.requireInternalService },
    async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const params = z.object({ taskId: z.string().min(1) }).parse(request.params);
        const body = z
          .object({ reason: z.string().max(512).optional() })
          .parse(request.body ?? {});
        return await withStaffContext(app.prisma, async (db) =>
          cancelA2ATask(db, organizationId, params.taskId, body.reason),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  app.post(
    "/internal/v1/a2a/oauth/tokens",
    { preHandler: app.requireInternalService },
    async (request) => {
      try {
        const { upsertA2AOauthToken, upsertA2AOauthTokenSchema } = await import(
          "../services/a2a-oauth-tokens.js"
        );
        const body = upsertA2AOauthTokenSchema.parse(request.body ?? {});
        request.tenantId = body.organizationId;
        const organizationId = requireTenantId(app, request);
        return await withStaffContext(app.prisma, async (db) =>
          upsertA2AOauthToken(db, { ...body, organizationId }),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  app.get(
    "/internal/v1/a2a/oauth/tokens/:clientId",
    { preHandler: app.requireInternalService },
    async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const params = z.object({ clientId: z.string().min(1) }).parse(request.params);
        const { getActiveA2AOauthToken } = await import("../services/a2a-oauth-tokens.js");
        const token = await withStaffContext(app.prisma, async (db) =>
          getActiveA2AOauthToken(db, organizationId, params.clientId),
        );
        if (!token) {
          throw app.httpErrors.notFound("Active token not found");
        }
        return token;
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  app.get(
    "/internal/v1/a2a/hub/token",
    { preHandler: app.requireInternalService },
    async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const token = await withStaffContext(app.prisma, async (db) =>
          getHubOutboundToken(db, organizationId),
        );
        if (!token) {
          throw app.httpErrors.notFound("Hub outbound token not found");
        }
        return token;
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );

  app.post(
    "/internal/v1/a2a/hub/token",
    { preHandler: app.requireInternalService },
    async (request) => {
      try {
        const body = upsertHubOutboundTokenSchema.parse(request.body ?? {});
        request.tenantId = body.organizationId;
        const organizationId = requireTenantId(app, request);
        return await withStaffContext(app.prisma, async (db) =>
          upsertHubOutboundToken(db, { ...body, organizationId }),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    },
  );
}
