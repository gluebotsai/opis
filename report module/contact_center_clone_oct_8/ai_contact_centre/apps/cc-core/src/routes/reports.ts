import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { withOrganizationContext } from "../lib/rls.js";
import { entityIdSchema } from "../lib/id-schema.js";
import { requireAdminTenant, requireTenantId } from "../services/reporting.js";
import { executeScheduledReportRun } from "../services/report-runner.js";
import {
  agentScheduleInputSchema,
  createAgentScheduledReport,
  createScheduledReport,
  deleteAgentScheduledReport,
  deleteScheduledReport,
  getScheduledReportForAdmin,
  getScheduledReportForAgent,
  getScheduledReportRunPdf,
  getScheduledReportRunPdfById,
  listScheduledReportRuns,
  listScheduledReportsForAdmin,
  listScheduledReportsForAgent,
  mapStoredIncludedSectionsForAgent,
  resolveAdminRecipientEmail,
  resolveReportMailbox,
  scheduleInputSchema,
  updateAgentScheduledReport,
  updateScheduledReport,
} from "../services/scheduled-reports.js";
import { reportPdfTokenSecret, verifyReportPdfToken } from "../services/report-whatsapp.js";

const scheduleIdParamsSchema = z.object({
  id: entityIdSchema,
});

const runsQuerySchema = z.object({
  scheduleId: entityIdSchema.optional(),
});

const runPdfQuerySchema = z.object({
  disposition: z.enum(["inline", "attachment"]).optional(),
});

const runNowBodySchema = z.object({
  dashboardImageBase64: z.string().min(32).optional(),
});

/** Dashboard capture is posted as base64 and can exceed Fastify's 1 MiB default. */
const RUN_NOW_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

const publicPdfQuerySchema = z.object({
  token: z.string().min(8),
});

export async function registerReportRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  const publicPrefix = joinApiV1(apiV1Base, "/public/reports");
  app.get(`${publicPrefix}/runs/:id/pdf`, async (request, reply) => {
    const { id } = scheduleIdParamsSchema.parse(request.params);
    const { token } = publicPdfQuerySchema.parse(request.query);
    const secret = reportPdfTokenSecret();
    const verified = secret ? verifyReportPdfToken(token, { runId: id }, secret) : null;
    if (!verified) {
      throw app.httpErrors.notFound("Report PDF not found");
    }
    const pdf = await withOrganizationContext(app.prisma, verified.organizationId, async (db) =>
      getScheduledReportRunPdfById(db, verified.organizationId, id),
    );
    if (!pdf) {
      throw app.httpErrors.notFound("Report PDF not found");
    }
    return reply
      .header("Content-Type", "application/pdf")
      .header(
        "Content-Disposition",
        `attachment; filename="${pdf.fileName.replaceAll('"', "")}"`,
      )
      .send(pdf.buffer);
  });

  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/reports");

    scoped.get(`${prefix}/mailbox-status`, async (request) => {
      const { organizationId, userId } = await requireAdminTenant(app, request, app.prisma);
      const [mailbox, recipientEmail] = await withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) =>
          Promise.all([
            resolveReportMailbox(db, organizationId),
            resolveAdminRecipientEmail(db, organizationId, userId),
          ]),
      );
      return {
        ready: Boolean(mailbox),
        fromEmail: mailbox?.senderEmail ?? null,
        recipientEmail,
      };
    });

    scoped.get(`${prefix}/schedules`, async (request) => {
      const { organizationId, userId } = await requireAdminTenant(app, request, app.prisma);
      const schedules = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        listScheduledReportsForAdmin(db, organizationId, userId),
      );
      const recipientEmail = await withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) => resolveAdminRecipientEmail(db, organizationId, userId),
      );
      return { schedules, recipientEmail };
    });

    scoped.post(`${prefix}/schedules`, async (request) => {
      const { organizationId, userId } = await requireAdminTenant(app, request, app.prisma);
      const body = scheduleInputSchema.parse(request.body);
      const schedule = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        createScheduledReport(db, organizationId, userId, body),
      );
      const mailbox = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        resolveReportMailbox(db, organizationId),
      );
      const recipientEmail = await withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) => resolveAdminRecipientEmail(db, organizationId, userId),
      );
      return { schedule, mailReady: Boolean(mailbox), recipientEmail };
    });

    scoped.patch(`${prefix}/schedules/:id`, async (request) => {
      const { organizationId, userId } = await requireAdminTenant(app, request, app.prisma);
      const { id } = scheduleIdParamsSchema.parse(request.params);
      const body = scheduleInputSchema.partial().parse(request.body);
      const schedule = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        updateScheduledReport(db, organizationId, userId, id, body),
      );
      if (!schedule) {
        throw app.httpErrors.notFound("Schedule not found");
      }
      const mailbox = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        resolveReportMailbox(db, organizationId),
      );
      const recipientEmail = await withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) => resolveAdminRecipientEmail(db, organizationId, userId),
      );
      return { schedule, mailReady: Boolean(mailbox), recipientEmail };
    });

    scoped.delete(`${prefix}/schedules/:id`, async (request, reply) => {
      const { organizationId, userId } = await requireAdminTenant(app, request, app.prisma);
      const { id } = scheduleIdParamsSchema.parse(request.params);
      const deleted = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        deleteScheduledReport(db, organizationId, userId, id),
      );
      if (!deleted) {
        throw app.httpErrors.notFound("Schedule not found");
      }
      return reply.status(204).send();
    });

    scoped.post(`${prefix}/schedules/:id/run-now`, { bodyLimit: RUN_NOW_BODY_LIMIT_BYTES }, async (request) => {
      const { organizationId, userId } = await requireAdminTenant(app, request, app.prisma);
      const { id } = scheduleIdParamsSchema.parse(request.params);
      const schedule = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        getScheduledReportForAdmin(db, organizationId, userId, id),
      );
      if (!schedule) {
        throw app.httpErrors.notFound("Schedule not found");
      }
      const body = runNowBodySchema.parse(request.body ?? {});
      const dashboardImagePng = body.dashboardImageBase64
        ? Buffer.from(body.dashboardImageBase64, "base64")
        : null;
      return executeScheduledReportRun(app, schedule, "manual", {
        dashboardImagePng,
      });
    });

    scoped.get(`${prefix}/runs`, async (request) => {
      const { organizationId, userId } = await requireAdminTenant(app, request, app.prisma);
      const { scheduleId } = runsQuerySchema.parse(request.query);
      const runs = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        listScheduledReportRuns(db, organizationId, userId, scheduleId),
      );
      return { runs };
    });

    scoped.get(`${prefix}/runs/:id/pdf`, async (request, reply) => {
      const { organizationId, userId } = await requireAdminTenant(app, request, app.prisma);
      const { id } = scheduleIdParamsSchema.parse(request.params);
      const { disposition = "attachment" } = runPdfQuerySchema.parse(request.query);
      const pdf = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        getScheduledReportRunPdf(db, organizationId, userId, id),
      );
      if (!pdf) {
        throw app.httpErrors.notFound("Report PDF not found");
      }
      return reply
        .header("Content-Type", "application/pdf")
        .header(
          "Content-Disposition",
          `${disposition}; filename="${pdf.fileName.replaceAll('"', "")}"`,
        )
        .send(pdf.buffer);
    });

    const agentPrefix = joinApiV1(apiV1Base, "/reports/agent");

    scoped.get(`${agentPrefix}/mailbox-status`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const [mailbox, recipientEmail] = await withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) =>
          Promise.all([
            resolveReportMailbox(db, organizationId),
            resolveAdminRecipientEmail(db, organizationId, userId),
          ]),
      );
      return {
        ready: Boolean(mailbox),
        fromEmail: mailbox?.senderEmail ?? null,
        recipientEmail,
      };
    });

    scoped.get(`${agentPrefix}/schedules`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const schedules = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        listScheduledReportsForAgent(db, organizationId, userId),
      );
      const recipientEmail = await withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) => resolveAdminRecipientEmail(db, organizationId, userId),
      );
      return {
        schedules: schedules.map((schedule) => ({
          ...schedule,
          includedSections: mapStoredIncludedSectionsForAgent(schedule.includedSections),
        })),
        recipientEmail,
      };
    });

    scoped.post(`${agentPrefix}/schedules`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const body = agentScheduleInputSchema.parse(request.body);
      const schedule = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        createAgentScheduledReport(db, organizationId, userId, body),
      );
      const mailbox = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        resolveReportMailbox(db, organizationId),
      );
      const recipientEmail = await withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) => resolveAdminRecipientEmail(db, organizationId, userId),
      );
      return {
        schedule: {
          ...schedule,
          includedSections: mapStoredIncludedSectionsForAgent(schedule.includedSections),
        },
        mailReady: Boolean(mailbox),
        recipientEmail,
      };
    });

    scoped.patch(`${agentPrefix}/schedules/:id`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const { id } = scheduleIdParamsSchema.parse(request.params);
      const body = agentScheduleInputSchema.partial().parse(request.body);
      const schedule = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        updateAgentScheduledReport(db, organizationId, userId, id, body),
      );
      if (!schedule) {
        throw app.httpErrors.notFound("Schedule not found");
      }
      const mailbox = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        resolveReportMailbox(db, organizationId),
      );
      const recipientEmail = await withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) => resolveAdminRecipientEmail(db, organizationId, userId),
      );
      return {
        schedule: {
          ...schedule,
          includedSections: mapStoredIncludedSectionsForAgent(schedule.includedSections),
        },
        mailReady: Boolean(mailbox),
        recipientEmail,
      };
    });

    scoped.delete(`${agentPrefix}/schedules/:id`, async (request, reply) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const { id } = scheduleIdParamsSchema.parse(request.params);
      const deleted = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        deleteAgentScheduledReport(db, organizationId, userId, id),
      );
      if (!deleted) {
        throw app.httpErrors.notFound("Schedule not found");
      }
      return reply.status(204).send();
    });

    scoped.post(`${agentPrefix}/schedules/:id/run-now`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const { id } = scheduleIdParamsSchema.parse(request.params);
      const schedule = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        getScheduledReportForAgent(db, organizationId, userId, id),
      );
      if (!schedule) {
        throw app.httpErrors.notFound("Schedule not found");
      }
      return executeScheduledReportRun(app, schedule, "manual");
    });

    scoped.get(`${agentPrefix}/runs`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const { scheduleId } = runsQuerySchema.parse(request.query);
      const runs = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        listScheduledReportRuns(db, organizationId, userId, scheduleId, "agent"),
      );
      return { runs };
    });

    scoped.get(`${agentPrefix}/runs/:id/pdf`, async (request, reply) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const { id } = scheduleIdParamsSchema.parse(request.params);
      const { disposition = "attachment" } = runPdfQuerySchema.parse(request.query);
      const pdf = await withOrganizationContext(app.prisma, organizationId, async (db) =>
        getScheduledReportRunPdf(db, organizationId, userId, id, "agent"),
      );
      if (!pdf) {
        throw app.httpErrors.notFound("Report PDF not found");
      }
      return reply
        .header("Content-Type", "application/pdf")
        .header(
          "Content-Disposition",
          `${disposition}; filename="${pdf.fileName.replaceAll('"', "")}"`,
        )
        .send(pdf.buffer);
    });
  });
}
