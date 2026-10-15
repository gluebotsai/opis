import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { withOrganizationContext } from "../lib/rls.js";
import {
  enforceOrgScopedConversations,
  extractColumns,
  validateDqlQuery,
} from "../services/sql-dql.js";
import { entityIdSchema } from "../lib/id-schema.js";
import {
  loadScopedPresenceMix,
  presenceMixLabel,
} from "../services/agent-attendance.js";
import {
  buildKpiCsvSection,
  buildPerformanceKpis,
  dashboardExportFilename,
  loadAgentAggregate,
  loadAgentBreakdown,
  loadAgentDailyRows,
  loadAgentReportRows,
  loadOrgAggregate,
  loadOrgBreakdown,
  loadOrgDailyRows,
  loadOrgReportRows,
  loadSlaBreakdown,
  loadTransferMetrics,
  mapSlaBreakdown,
  mapReportRowForApi,
  type ChannelBreakdownRow,
  rangeSchema,
  requireAdminTenant,
  resolveOrganizationAgent,
  resolvePerformanceWindow,
} from "../services/reporting.js";
import {
  readDashboardAnalytics,
  refreshDashboardAnalytics,
} from "../services/dashboard-analytics.js";

const analyticsRefreshes = new Map<string, Promise<void>>();

const dashboardQuerySchema = z.object({
  agentId: entityIdSchema.optional(),
});

const dashboardAnalyticsQuerySchema = z
  .object({
    range: z.enum(["today", "7d", "30d"]).optional(),
    start: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    end: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    incidentId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const hasPartialCustom = Boolean(value.start) !== Boolean(value.end);
    if (hasPartialCustom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide both start and end dates",
      });
    }
    if (value.range && value.start && value.end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either range or custom dates",
      });
    }
    if (value.start && value.end && value.start > value.end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date must be before end date",
      });
    }
  });

export async function registerDashboardRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/dashboard/overview");

    scoped.get(prefix, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      const query = rangeSchema.parse(request.query);
      const { agentId = null } = dashboardQuerySchema.parse(request.query);
      const window = resolvePerformanceWindow(query);
      const { range, start, end, days, previousStart } = window;

      const result = await withOrganizationContext(app.prisma, organizationId, async (db) => {
        const agent = agentId ? await resolveOrganizationAgent(db, organizationId, agentId) : null;
        if (agentId && !agent) {
          throw app.httpErrors.notFound("Agent not found");
        }

        const scopedUserId = agent?.id ?? null;
        const [
          current,
          previous,
          dailyRows,
          channelRows,
          dispositionRows,
          recentRows,
          presenceMix,
          transferMetrics,
          slaRows,
        ] =
          await Promise.all([
            scopedUserId
              ? loadAgentAggregate(db, organizationId, scopedUserId, start, end)
              : loadOrgAggregate(db, organizationId, start, end),
            scopedUserId
              ? loadAgentAggregate(db, organizationId, scopedUserId, previousStart, start)
              : loadOrgAggregate(db, organizationId, previousStart, start),
            scopedUserId
              ? loadAgentDailyRows(db, organizationId, scopedUserId, start, end)
              : loadOrgDailyRows(db, organizationId, start, end),
            scopedUserId
              ? loadAgentBreakdown(db, organizationId, scopedUserId, start, end, "channel")
              : loadOrgBreakdown(db, organizationId, start, end, "channel"),
            scopedUserId
              ? loadAgentBreakdown(db, organizationId, scopedUserId, start, end, "disposition")
              : loadOrgBreakdown(db, organizationId, start, end, "disposition"),
            scopedUserId
              ? loadAgentReportRows(db, organizationId, scopedUserId, start, end)
              : loadOrgReportRows(db, organizationId, start, end),
            loadScopedPresenceMix(db, organizationId, scopedUserId, start, end),
            loadTransferMetrics(db, organizationId, start, end, scopedUserId),
            loadSlaBreakdown(db, organizationId, start, end, scopedUserId),
          ]);

        return {
          agent,
          current,
          previous,
          dailyRows,
          channelRows,
          dispositionRows,
          recentRows,
          presenceMix,
          transferMetrics,
          slaRows,
        };
      });

      const kpis = {
        ...buildPerformanceKpis(result.current, result.previous),
        totalAssigned: Number(result.current.total),
        resolved: Number(result.current.resolved),
      };

      const dailyByDate = new Map(
        result.dailyRows.map((row) => [
          row.day.toISOString().slice(0, 10),
          {
            handled: Number(row.handled),
            avgHandleSeconds: Math.max(0, Math.round(row.avg_handle_seconds ?? 0)),
          },
        ]),
      );
      const daily = Array.from({ length: days }, (_, index) => {
        const date = new Date(start.getTime() + index * 86_400_000);
        const key = date.toISOString().slice(0, 10);
        return { date: key, ...(dailyByDate.get(key) ?? { handled: 0, avgHandleSeconds: 0 }) };
      });

      return {
        range,
        period: { start: start.toISOString(), end: end.toISOString() },
        agent: result.agent,
        kpis,
        transferMetrics: result.transferMetrics,
        daily,
        channels: (result.channelRows as ChannelBreakdownRow[]).map((row) => ({
          label: row.label,
          value: Number(row.value),
          channel: row.channel,
          handler: row.handler === "Agent" ? ("agent" as const) : ("ai" as const),
        })),
        dispositions: result.dispositionRows.map((row) => ({
          label: row.label,
          value: Number(row.value),
        })),
        presenceMix: result.presenceMix.states.map((slice) => ({
          state: slice.state,
          label: presenceMixLabel(slice.state),
          seconds: slice.seconds,
          percent: slice.percent,
        })),
        recent: result.recentRows.slice(0, 10).map(mapReportRowForApi),
        slaBreakdown: mapSlaBreakdown(result.slaRows),
      };
    });

    scoped.get(`${prefix}/report`, async (request, reply) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      const query = rangeSchema.parse(request.query);
      const { agentId = null } = dashboardQuerySchema.parse(request.query);
      const window = resolvePerformanceWindow(query);
      const { range, start, end, previousStart } = window;
      const exportedAt = new Date();
      const rangeLabel =
        range === "custom" && query.start && query.end
          ? `${query.start}_${query.end}`
          : range;

      const { kpis, agent } = await withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) => {
          const resolvedAgent = agentId
            ? await resolveOrganizationAgent(db, organizationId, agentId)
            : null;
          if (agentId && !resolvedAgent) {
            throw app.httpErrors.notFound("Agent not found");
          }

          const scopedUserId = resolvedAgent?.id ?? null;
          const [current, previous] = await Promise.all([
            scopedUserId
              ? loadAgentAggregate(db, organizationId, scopedUserId, start, end)
              : loadOrgAggregate(db, organizationId, start, end),
            scopedUserId
              ? loadAgentAggregate(db, organizationId, scopedUserId, previousStart, start)
              : loadOrgAggregate(db, organizationId, previousStart, start),
          ]);

          return {
            kpis: buildPerformanceKpis(current, previous),
            agent: resolvedAgent,
          };
        },
      );

      const reportTitle = agent
        ? `Agent dashboard KPIs (${agent.name})`
        : "Organization dashboard KPIs";
      const csv = buildKpiCsvSection(kpis, { start, end }, exportedAt, reportTitle).join("\n");

      reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${dashboardExportFilename(rangeLabel, "csv", exportedAt)}"`,
        );
      return `\uFEFF${csv}`;
    });

    scoped.post(`${prefix}/sql`, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      const { sql, description } = z
        .object({
          sql: z.string(),
          description: z.string().optional(),
        })
        .parse(request.body);

      let validated: string;
      try {
        validated = validateDqlQuery(sql);
      } catch (error) {
        return {
          ok: false,
          success: false,
          description,
          error: error instanceof Error ? error.message : "Invalid DQL",
          rowCount: 0,
          columns: [] as string[],
          rows: [] as Record<string, unknown>[],
        };
      }

      let scopedSql: string;
      try {
        scopedSql = enforceOrgScopedConversations(validated, organizationId);
      } catch (error) {
        return {
          ok: false,
          success: false,
          description,
          error: error instanceof Error ? error.message : "Unable to scope SQL",
          rowCount: 0,
          columns: [] as string[],
          rows: [] as Record<string, unknown>[],
        };
      }

      return withOrganizationContext(app.prisma, organizationId, async (db) => {
        try {
          const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(scopedSql);
          const list = Array.isArray(rows) ? rows : [];
          return {
            ok: true,
            success: true,
            description,
            rowCount: list.length,
            columns: extractColumns(list),
            rows: list,
          };
        } catch (error) {
          throw app.httpErrors.badRequest(
            error instanceof Error ? error.message : "SQL execution failed",
          );
        }
      });
    });

    const analyticsPrefix = joinApiV1(apiV1Base, "/dashboard/analytics");
    scoped.get(analyticsPrefix, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      const query = dashboardAnalyticsQuerySchema.parse(request.query);
      return withOrganizationContext(app.prisma, organizationId, async (db) =>
        readDashboardAnalytics(db, organizationId, query),
      );
    });

    scoped.get(`${analyticsPrefix}/refresh-status`, async (request) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      return { running: analyticsRefreshes.has(organizationId) };
    });

    scoped.post(`${analyticsPrefix}/refresh`, async (request, reply) => {
      const { organizationId } = await requireAdminTenant(app, request, app.prisma);
      const query = dashboardAnalyticsQuerySchema.parse(request.query);
      const existing = analyticsRefreshes.get(organizationId);
      if (existing) {
        return reply.code(202).send({ status: "running" });
      }

      const refresh = withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) => {
          await refreshDashboardAnalytics(db, organizationId, query);
        },
        { timeoutMs: 45_000 },
      )
        .catch((error) => {
          request.log.error({ err: error, organizationId }, "dashboard analytics refresh failed");
        })
        .finally(() => {
          analyticsRefreshes.delete(organizationId);
        });
      analyticsRefreshes.set(organizationId, refresh);
      return reply.code(202).send({ status: "queued" });
    });
  });
}
