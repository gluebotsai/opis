import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { withOrganizationContext } from "../lib/rls.js";
import {
  buildKpiCsvSection,
  buildPerformanceKpis,
  csvCell,
  loadAgentAggregate,
  loadAgentBreakdown,
  loadAgentDailyRows,
  loadAgentReportRows,
  loadAgentSentimentMix,
  loadSlaBreakdown,
  loadTransferMetrics,
  mapSlaBreakdown,
  mapReportRowForApi,
  performanceExportFilename,
  rangeSchema,
  requireTenantId,
  resolvePerformanceWindow,
} from "../services/reporting.js";
import {
  enforceAgentScopedConversations,
  extractColumns,
  validateDqlQuery,
} from "../services/sql-dql.js";

const RECENT_CONVERSATIONS_LIMIT = 5;

export async function registerPerformanceRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/performance/me");

    scoped.get(prefix, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const query = rangeSchema.parse(request.query);
      const window = resolvePerformanceWindow(query);
      const { range, start, end, days, previousStart } = window;

      const result = await withOrganizationContext(app.prisma, organizationId, async (db) => {
        const [
          current,
          previous,
          dailyRows,
          channelRows,
          dispositionRows,
          sentimentRows,
          recentRows,
          transferMetrics,
          slaRows,
        ] =
          await Promise.all([
            loadAgentAggregate(db, organizationId, userId, start, end),
            loadAgentAggregate(db, organizationId, userId, previousStart, start),
            loadAgentDailyRows(db, organizationId, userId, start, end),
            loadAgentBreakdown(db, organizationId, userId, start, end, "channel"),
            loadAgentBreakdown(db, organizationId, userId, start, end, "disposition"),
            loadAgentSentimentMix(db, organizationId, userId, start, end),
            loadAgentReportRows(db, organizationId, userId, start, end),
            loadTransferMetrics(db, organizationId, start, end, userId),
            loadSlaBreakdown(db, organizationId, start, end, userId),
          ]);

        return {
          current,
          previous,
          dailyRows,
          channelRows,
          dispositionRows,
          sentimentRows,
          recentRows,
          transferMetrics,
          slaRows,
        };
      });

      const kpis = buildPerformanceKpis(result.current, result.previous);

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
        kpis,
        transferMetrics: result.transferMetrics,
        daily,
        channels: result.channelRows.map((row) => ({
          label: row.label,
          value: Number(row.value),
        })),
        dispositions: result.dispositionRows.map((row) => ({
          label: row.label,
          value: Number(row.value),
        })),
        agentSentiment: result.sentimentRows.map((row) => ({
          label: row.label,
          value: Number(row.value),
        })),
        recent: result.recentRows
          .slice(0, RECENT_CONVERSATIONS_LIMIT)
          .map(mapReportRowForApi),
        slaBreakdown: mapSlaBreakdown(result.slaRows),
      };
    });

    scoped.post(`${prefix}/sql`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
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
        scopedSql = enforceAgentScopedConversations(validated, organizationId, userId);
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

    scoped.get(`${prefix}/report`, async (request, reply) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const query = rangeSchema.parse(request.query);
      const window = resolvePerformanceWindow(query);
      const { range, start, end, previousStart } = window;
      const exportedAt = new Date();
      const rangeLabel =
        range === "custom" && query.start && query.end
          ? `${query.start}_${query.end}`
          : range;

      const { rows, kpis } = await withOrganizationContext(app.prisma, organizationId, async (db) => {
        const [current, previous, reportRows] = await Promise.all([
          loadAgentAggregate(db, organizationId, userId, start, end),
          loadAgentAggregate(db, organizationId, userId, previousStart, start),
          loadAgentReportRows(db, organizationId, userId, start, end),
        ]);

        return {
          rows: reportRows,
          kpis: buildPerformanceKpis(current, previous),
        };
      });

      const header = [
        "Conversation ID",
        "Channel",
        "Status",
        "Customer",
        "Subject",
        "Assigned at",
        "First response at",
        "Ended at",
        "First response seconds",
        "Handle seconds",
        "Resolution",
        "Disposition",
      ];
      const lines = rows.map((row) => {
        const responseSeconds =
          row.assigned_at && row.first_response_at
            ? Math.max(
                0,
                Math.round((row.first_response_at.getTime() - row.assigned_at.getTime()) / 1000),
              )
            : "";
        const handleSeconds =
          row.assigned_at && row.ended_at
            ? Math.max(0, Math.round((row.ended_at.getTime() - row.assigned_at.getTime()) / 1000))
            : "";
        return [
          row.id,
          row.channel,
          row.status,
          row.visitor_id,
          row.subject,
          row.assigned_at,
          row.first_response_at,
          row.ended_at,
          responseSeconds,
          handleSeconds,
          row.resolution,
          row.disposition,
        ]
          .map(csvCell)
          .join(",");
      });
      const csv = [
        ...buildKpiCsvSection(kpis, { start, end }, exportedAt),
        ["Conversations", ""].map(csvCell).join(","),
        header.map(csvCell).join(","),
        ...lines,
      ].join("\n");

      reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${performanceExportFilename(rangeLabel, "csv", exportedAt)}"`,
        );
      return `\uFEFF${csv}`;
    });
  });
}
