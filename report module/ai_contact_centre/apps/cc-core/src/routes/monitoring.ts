import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { entityIdSchema, jsonStringifyEntityPayload } from "../lib/id-schema.js";
import { cdpContactIdSchema } from "../services/cdp-id.js";
import { withOrganizationContext, withOrganizationReadContext } from "../lib/rls.js";
import { createAdminCallbackTask, createCallbackTaskSchema } from "../services/agent-tasks.js";
import {
  adminLogoutAgent,
  adminSetAgentPresence,
  listAgentPreviousConversations,
  loadMonitoringSnapshot,
} from "../services/monitoring.js";
import {
  getAgentAttendanceDay,
  getAgentAttendanceRange,
  todayYmd,
  weekAgoYmd,
} from "../services/agent-attendance.js";
import {
  acknowledgeNotReadyEscalation,
} from "../services/agent-not-ready-escalations.js";
import { getAgentAttentionInsight } from "../services/agent-attention-insight.js";
import { acknowledgeProactiveAttempt } from "../services/proactive-callback-attempts.js";
import { getContactCallbackChannelOptions } from "../services/preferred-channel.js";
import { requireAdminTenant } from "../services/reporting.js";

export async function registerMonitoringRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/monitoring");

    scoped.get(`${prefix}/snapshot`, async (request, reply) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      const snapshot = await withOrganizationContext(app.prisma, organizationId, (db) =>
        loadMonitoringSnapshot(db, organizationId, app.prisma),
      );
      reply.type("application/json");
      return reply.send(JSON.parse(jsonStringifyEntityPayload(snapshot)));
    });

    scoped.get(`${prefix}/contacts/:contactId/callback-channels`, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      try {
        const params = z
          .object({
            contactId: cdpContactIdSchema,
          })
          .parse(request.params);
        const query = z
          .object({
            hintChannel: z.enum(["whatsapp", "instagram", "facebook", "email"]).optional(),
          })
          .parse(request.query ?? {});

        const options = await withOrganizationReadContext(app.prisma, organizationId, (db) =>
          getContactCallbackChannelOptions(
            db,
            organizationId,
            params.contactId,
            query.hintChannel ?? null,
          ),
        );
        return JSON.parse(jsonStringifyEntityPayload(options));
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid contact id");
        }
        throw error;
      }
    });

    scoped.post(`${prefix}/callback-tasks`, async (request) => {
      const { organizationId, userId } = await requireAdminTenant(app, request, app.prisma);
      try {
        const body = createCallbackTaskSchema.parse(request.body);
        const task = await withOrganizationContext(app.prisma, organizationId, (db) =>
          createAdminCallbackTask(db, organizationId, userId, body),
        );
        return JSON.parse(jsonStringifyEntityPayload({ task }));
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid payload");
        }
        if (error instanceof Error && "status" in error) {
          const status = (error as Error & { status: number }).status;
          if (status === 404) throw app.httpErrors.notFound(error.message);
          if (status === 400) throw app.httpErrors.badRequest(error.message);
        }
        throw error;
      }
    });

    scoped.post(`${prefix}/agents/:agentId/logout`, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      try {
        const params = z
          .object({
            agentId: entityIdSchema,
          })
          .parse(request.params);
        return await withOrganizationContext(app.prisma, organizationId, (db) =>
          adminLogoutAgent(db, app.prisma, organizationId, params.agentId),
        );
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid agent id");
        }
        if (error instanceof Error && "status" in error) {
          const status = (error as Error & { status: number }).status;
          if (status === 404) throw app.httpErrors.notFound(error.message);
          if (status === 400) throw app.httpErrors.badRequest(error.message);
        }
        throw error;
      }
    });

    scoped.post(`${prefix}/agents/:agentId/presence`, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      try {
        const params = z
          .object({
            agentId: entityIdSchema,
          })
          .parse(request.params);
        const body = z
          .object({
            presence: z.enum(["ready", "not_ready"]),
          })
          .parse(request.body ?? {});
        return await withOrganizationContext(app.prisma, organizationId, (db) =>
          adminSetAgentPresence(db, organizationId, params.agentId, body.presence),
        );
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid payload");
        }
        if (error instanceof Error && "status" in error) {
          const status = (error as Error & { status: number }).status;
          if (status === 404) throw app.httpErrors.notFound(error.message);
          if (status === 400) throw app.httpErrors.badRequest(error.message);
        }
        throw error;
      }
    });

    scoped.get(`${prefix}/agents/:agentId/previous-conversations`, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      try {
        const params = z
          .object({
            agentId: entityIdSchema,
          })
          .parse(request.params);
        const conversations = await withOrganizationReadContext(app.prisma, organizationId, (db) =>
          listAgentPreviousConversations(db, organizationId, params.agentId),
        );
        return JSON.parse(jsonStringifyEntityPayload({ conversations }));
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid agent id");
        }
        throw error;
      }
    });

    scoped.get(`${prefix}/agents/:agentId/attendance`, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      try {
        const params = z
          .object({
            agentId: entityIdSchema,
          })
          .parse(request.params);
        const query = z
          .object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          })
          .parse(request.query ?? {});

        if (query.date) {
          const result = await withOrganizationReadContext(app.prisma, organizationId, (db) =>
            getAgentAttendanceDay(db, organizationId, params.agentId, query.date!),
          );
          return JSON.parse(jsonStringifyEntityPayload(result));
        }

        const to = query.to ?? todayYmd();
        const from = query.from ?? weekAgoYmd();
        if (from > to) {
          throw app.httpErrors.badRequest("`from` must be on or before `to`");
        }

        const result = await withOrganizationReadContext(app.prisma, organizationId, (db) =>
          getAgentAttendanceRange(db, organizationId, params.agentId, from, to),
        );
        return JSON.parse(jsonStringifyEntityPayload(result));
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid attendance query");
        }
        throw error;
      }
    });

    scoped.get(`${prefix}/not-ready-escalations/:escalationId/insight`, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      try {
        const params = z
          .object({
            escalationId: entityIdSchema,
          })
          .parse(request.params);
        const insight = await withOrganizationReadContext(app.prisma, organizationId, (db) =>
          getAgentAttentionInsight(db, organizationId, params.escalationId, {
            generateIfMissing: true,
          }),
        );
        if (!insight) {
          throw app.httpErrors.notFound("Escalation insight not found");
        }
        return JSON.parse(jsonStringifyEntityPayload({ insight }));
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid escalation id");
        }
        throw error;
      }
    });

    scoped.post(`${prefix}/not-ready-escalations/:escalationId/acknowledge`, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      try {
        const params = z
          .object({
            escalationId: entityIdSchema,
          })
          .parse(request.params);
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          acknowledgeNotReadyEscalation(db, organizationId, params.escalationId),
        );
        return { ok: true as const };
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid escalation id");
        }
        throw error;
      }
    });

    scoped.post(`${prefix}/proactive-callbacks/:attemptId/acknowledge`, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      try {
        const params = z
          .object({
            attemptId: entityIdSchema,
          })
          .parse(request.params);
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          acknowledgeProactiveAttempt(db, organizationId, params.attemptId),
        );
        return { ok: true as const };
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid attempt id");
        }
        throw error;
      }
    });
  });
}
