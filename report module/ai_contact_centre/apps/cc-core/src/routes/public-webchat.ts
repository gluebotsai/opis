import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { withStaffContext } from "../lib/rls.js";
import { resolveWebchatContext } from "../services/organization-context.js";
import { triggerWebchatBot } from "../services/chat-delivery.js";

const triggerBodySchema = z.object({
  text: z.string().min(1).max(4_000).optional(),
  openPanel: z.boolean().optional(),
  openMode: z.enum(["bubble", "panel"]).optional(),
  autoSessionStart: z.boolean().optional(),
  reason: z.string().min(1).max(128).optional(),
  pageUrl: z.string().url().max(4_096).optional(),
});

const webchatIdParamSchema = z
  .string()
  .regex(/^wc_[a-f0-9]{32}$/i, "webchatId must be wc_ followed by 32 hex characters");

function isTriggerAuthorized(request: { headers: Record<string, unknown> }): boolean {
  const configuredKey = process.env.WEBCHAT_TRIGGER_API_KEY?.trim();
  const headerKey = (request.headers["x-api-key"] as string | undefined)?.trim();
  if (configuredKey) {
    return headerKey === configuredKey;
  }

  const internalKey = process.env.INTERNAL_SERVICE_KEY?.trim();
  const internalHeader = (request.headers["x-internal-service-key"] as string | undefined)?.trim();
  if (internalKey && internalHeader === internalKey) {
    return true;
  }

  return process.env.NODE_ENV !== "production";
}

export async function registerPublicWebchatRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  const prefix = joinApiV1(apiV1Base, "/public/webchat");

  app.post(
    `${prefix}/:webchatId/visitors/:visitorId/trigger-bot`,
    async (request, reply) => {
      if (!isTriggerAuthorized(request)) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Missing or invalid x-api-key",
        });
      }

      const params = z
        .object({
          webchatId: webchatIdParamSchema,
          visitorId: z.string().min(1),
        })
        .parse(request.params);
      const body = triggerBodySchema.parse(request.body ?? {});

      const webchatContext = await withStaffContext(app.prisma, async (db) =>
        resolveWebchatContext(db, params.webchatId),
      );
      if (!webchatContext) {
        return reply.status(404).send({ error: "Webchat not found" });
      }

      // A2A / Hub callers must match the resolved widget organization.
      const a2aOrganizationId = (
        (request.headers["x-a2a-organization-id"] as string | undefined) ||
        (request.headers["x-tenant-id"] as string | undefined) ||
        ""
      ).trim();
      if (
        a2aOrganizationId &&
        String(webchatContext.organizationId) !== a2aOrganizationId
      ) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "Authenticated tenant does not own this webchat widget",
        });
      }

      const result = await triggerWebchatBot({
        webchatId: params.webchatId,
        visitorId: params.visitorId,
        ...body,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error });
      }

      return {
        ok: true,
        organizationId: webchatContext.organizationId,
        conversationId: result.conversationId,
        sessionStarted: result.sessionStarted,
      };
    },
  );
}
