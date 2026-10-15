import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PrismaClient } from "@ai-contact-center/db-cc";
import type { DbClient } from "../lib/rls.js";
import { serializeEntityId, toDbId } from "../lib/id-schema.js";
import {
  conversationHandledByUserCondition,
  CONVERSATION_REACHED_AGENT_CONDITION,
  REPORTING_PERIOD_AT,
} from "./reporting-attribution.js";

export const rangeSchema = z
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
        path: ["start"],
      });
    }
  });

const RANGE_DAYS = {
  today: 1,
  "7d": 7,
  "30d": 30,
} as const;

type PerformanceRange = keyof typeof RANGE_DAYS;

export type PerformanceWindow = {
  range: PerformanceRange | "custom";
  start: Date;
  end: Date;
  days: number;
  previousStart: Date;
};

export type AggregateRow = {
  total: bigint;
  handled: bigint;
  resolved: bigint;
  transferred: bigint;
  first_response_count: bigint;
  within_sla: bigint;
  avg_first_response_seconds: number | null;
  avg_handle_seconds: number | null;
};

export type DailyRow = {
  day: Date;
  handled: bigint;
  avg_handle_seconds: number | null;
};

export type BreakdownRow = {
  label: string;
  value: bigint;
};

export type ChannelBreakdownRow = BreakdownRow & {
  channel: string;
  handler: "AI" | "Agent";
};

export type TransferMetrics = {
  attempted: number;
  accepted: number;
  completed: number;
  rejected: number;
  expired: number;
  cancelled: number;
  outboundAccepted: number;
  inboundAccepted: number;
  acceptanceRate: number;
  averageRingToAcceptSeconds: number;
};

export async function loadTransferMetrics(
  db: DbClient,
  organizationId: string,
  start: Date,
  end: Date,
  userId: string | null = null,
): Promise<TransferMetrics> {
  const rows = await db.$queryRaw<{
    attempted: bigint;
    accepted: bigint;
    completed: bigint;
    rejected: bigint;
    expired: bigint;
    cancelled: bigint;
    outbound_accepted: bigint;
    inbound_accepted: bigint;
    avg_ring_to_accept_seconds: number | null;
  }[]>`
    SELECT
      COUNT(*) FILTER (
        WHERE ${userId}::bigint IS NULL OR transfer.from_user_id = ${userId}::bigint
      ) AS attempted,
      COUNT(*) FILTER (
        WHERE transfer.state IN ('accepted', 'completed')
          AND (${userId}::bigint IS NULL OR transfer.from_user_id = ${userId}::bigint)
      ) AS accepted,
      COUNT(*) FILTER (
        WHERE transfer.state = 'completed'
          AND (${userId}::bigint IS NULL OR transfer.from_user_id = ${userId}::bigint)
      ) AS completed,
      COUNT(*) FILTER (
        WHERE transfer.state = 'rejected'
          AND (${userId}::bigint IS NULL OR transfer.from_user_id = ${userId}::bigint)
      ) AS rejected,
      COUNT(*) FILTER (
        WHERE transfer.state = 'expired'
          AND (${userId}::bigint IS NULL OR transfer.from_user_id = ${userId}::bigint)
      ) AS expired,
      COUNT(*) FILTER (
        WHERE transfer.state = 'cancelled'
          AND (${userId}::bigint IS NULL OR transfer.from_user_id = ${userId}::bigint)
      ) AS cancelled,
      COUNT(*) FILTER (
        WHERE transfer.state IN ('accepted', 'completed')
          AND (${userId}::bigint IS NULL OR transfer.from_user_id = ${userId}::bigint)
      ) AS outbound_accepted,
      COUNT(*) FILTER (
        WHERE transfer.state IN ('accepted', 'completed')
          AND (${userId}::bigint IS NULL OR transfer.accepted_user_id = ${userId}::bigint)
      ) AS inbound_accepted,
      AVG(
        EXTRACT(EPOCH FROM (
          transfer.accepted_at - COALESCE(transfer.offered_at, transfer.requested_at)
        ))
      ) FILTER (
        WHERE transfer.state IN ('accepted', 'completed')
          AND transfer.accepted_at IS NOT NULL
          AND (${userId}::bigint IS NULL OR transfer.from_user_id = ${userId}::bigint)
      ) AS avg_ring_to_accept_seconds
    FROM ccass.conversation_transfers transfer
    WHERE transfer.organization_id = ${organizationId}::bigint
      AND transfer.requested_agent_id IS NOT NULL
      AND transfer.requested_at >= ${start}
      AND transfer.requested_at < ${end}
  `;
  const row = rows[0];
  const attempted = Number(row?.attempted ?? 0);
  const accepted = Number(row?.accepted ?? 0);
  return {
    attempted,
    accepted,
    completed: Number(row?.completed ?? 0),
    rejected: Number(row?.rejected ?? 0),
    expired: Number(row?.expired ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
    outboundAccepted: Number(row?.outbound_accepted ?? 0),
    inboundAccepted: Number(row?.inbound_accepted ?? 0),
    acceptanceRate: percent(accepted, attempted),
    averageRingToAcceptSeconds: Math.max(
      0,
      Math.round(Number(row?.avg_ring_to_accept_seconds ?? 0)),
    ),
  };
}

const REPORTING_CHANNEL_ORDER = [
  "webchat",
  "email",
  "whatsapp",
  "instagram",
  "facebook",
  "voice",
  "call",
] as const;

function reportingChannelLabel(channel: string): string {
  const normalized = channel.trim().toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeReportingChannel(channel: string): string {
  const key = channel.trim().toLowerCase();
  if (key === "chat") return "webchat";
  if (key === "calls") return "call";
  return key;
}

function sortConfiguredReportingChannels(channels: string[]): string[] {
  const unique = [...new Set(channels.map((channel) => normalizeReportingChannel(channel)))];
  const ordered = REPORTING_CHANNEL_ORDER.filter((channel) => unique.includes(channel));
  const extras = unique
    .filter((channel) => !REPORTING_CHANNEL_ORDER.includes(channel as (typeof REPORTING_CHANNEL_ORDER)[number]))
    .sort();
  return [...ordered, ...extras];
}

export async function loadOrgConfiguredReportingChannels(
  db: DbClient,
  organizationId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<{ channel: string }[]>`
    SELECT DISTINCT channel
    FROM (
      SELECT 'webchat'::text AS channel
      FROM accounts.setup_webchat_configs wc
      JOIN accounts.setup_channel_configs cc ON cc.id = wc.channel_config_id
      WHERE cc.organization_id = ${organizationId}::bigint
        AND cc.status = 'active'
      UNION
      SELECT 'email'::text AS channel
      FROM accounts.setup_email_configs ec
      JOIN accounts.setup_channel_configs cc ON cc.id = ec.channel_config_id
      WHERE cc.organization_id = ${organizationId}::bigint
        AND cc.status = 'active'
      UNION
      SELECT sc.provider::text AS channel
      FROM accounts.setup_social_configs sc
      JOIN accounts.setup_channel_configs cc ON cc.id = sc.channel_config_id
      WHERE cc.organization_id = ${organizationId}::bigint
        AND cc.status = 'active'
    ) configured
  `;
  return sortConfiguredReportingChannels(rows.map((row) => row.channel));
}

function fillOrgChannelBreakdown(
  configured: string[],
  rows: ChannelBreakdownRow[],
): ChannelBreakdownRow[] {
  const byKey = new Map<string, ChannelBreakdownRow>();
  for (const row of rows) {
    const channelKey = normalizeReportingChannel(row.channel);
    byKey.set(`${channelKey}|${row.handler}`, row);
  }

  const filled: ChannelBreakdownRow[] = [];
  const seen = new Set<string>();

  for (const channel of configured) {
    const channelLabel = reportingChannelLabel(channel);
    for (const handler of ["AI", "Agent"] as const) {
      const key = `${channel}|${handler}`;
      seen.add(key);
      const existing = byKey.get(key);
      filled.push(
        existing ?? {
          channel: channelLabel,
          handler,
          label: `${channelLabel} · ${handler}`,
          value: 0n,
        },
      );
    }
  }

  for (const row of rows) {
    const channelKey = normalizeReportingChannel(row.channel);
    const key = `${channelKey}|${row.handler}`;
    if (!seen.has(key)) {
      seen.add(key);
      filled.push(row);
    }
  }

  return filled;
}

function fillSimpleChannelBreakdown(
  configured: string[],
  rows: BreakdownRow[],
): BreakdownRow[] {
  const byKey = new Map<string, BreakdownRow>();
  for (const row of rows) {
    byKey.set(normalizeReportingChannel(row.label), row);
  }

  const filled: BreakdownRow[] = [];
  const seen = new Set<string>();

  for (const channel of configured) {
    const label = reportingChannelLabel(channel);
    seen.add(channel);
    filled.push(byKey.get(channel) ?? { label, value: 0n });
  }

  for (const row of rows) {
    const channelKey = normalizeReportingChannel(row.label);
    if (!seen.has(channelKey)) {
      seen.add(channelKey);
      filled.push(row);
    }
  }

  return filled;
}

export type ReportRow = {
  id: string | bigint;
  channel: string;
  status: string;
  subject: string | null;
  visitor_id: string | null;
  assigned_at: Date | null;
  first_response_at: Date | null;
  ended_at: Date | null;
  resolution: string | null;
  disposition: string | null;
};

export function mapReportRowForApi(row: ReportRow) {
  return {
    id: serializeEntityId(row.id),
    channel: row.channel,
    status: row.status,
    subject: row.subject,
    visitorId: row.visitor_id,
    assignedAt: row.assigned_at?.toISOString() ?? null,
    firstResponseAt: row.first_response_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    resolution: row.resolution,
    disposition: row.disposition,
  };
}

function parseDateInput(value: string): Date {
  return startOfUtcDay(new Date(`${value}T00:00:00.000Z`));
}

export function resolvePerformanceWindow(query: z.infer<typeof rangeSchema>): PerformanceWindow {
  if (query.start && query.end) {
    const start = parseDateInput(query.start);
    const selectedEnd = parseDateInput(query.end);
    const today = startOfUtcDay(new Date());
    const end =
      selectedEnd.getTime() >= today.getTime()
        ? new Date()
        : new Date(selectedEnd.getTime() + 86_400_000);
    const effectiveEnd = selectedEnd.getTime() > today.getTime() ? today : selectedEnd;
    const days = Math.max(
      1,
      Math.round((effectiveEnd.getTime() - start.getTime()) / 86_400_000) + 1,
    );
    const periodMs = end.getTime() - start.getTime();
    return {
      range: "custom",
      start,
      end,
      days,
      previousStart: new Date(start.getTime() - periodMs),
    };
  }

  const range = query.range ?? "30d";
  const days = RANGE_DAYS[range];
  const end = new Date();
  const start = startOfUtcDay(new Date(end.getTime() - (days - 1) * 86_400_000));
  return {
    range,
    start,
    end,
    days,
    previousStart: new Date(start.getTime() - days * 86_400_000),
  };
}

export function requireTenantId(
  app: FastifyInstance,
  request: { tenantId?: string; userId?: string },
): { organizationId: string; userId: string } {
  if (!request.tenantId || !request.userId) {
    throw app.httpErrors.unauthorized("Missing tenant or user context");
  }
  return { organizationId: request.tenantId, userId: request.userId };
}

export async function requireAdminTenant(
  app: FastifyInstance,
  request: { tenantId?: string; userId?: string; userRole?: "admin" | "agent" },
  prisma?: PrismaClient,
): Promise<{ organizationId: string; userId: string }> {
  const context = requireTenantId(app, request);
  if (request.userRole === "admin") {
    return context;
  }
  if (prisma) {
    const { resolveSetupUserRole } = await import("./auth.js");
    const role = await resolveSetupUserRole(prisma, context.organizationId, context.userId);
    if (role === "admin") {
      request.userRole = "admin";
      return context;
    }
  }
  throw app.httpErrors.forbidden("Admin access required");
}

function startOfUtcDay(value: Date): Date {
  const next = new Date(value);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function roundDurationSeconds(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

export type PerformanceKpis = {
  handled: number;
  handledChangePercent: number | null;
  resolutionRate: number;
  avgFirstResponseSeconds: number | null;
  avgHandleSeconds: number | null;
  slaRate: number;
  transferred: number;
  firstResponseCount: number;
  withinSlaCount: number;
};

export type SlaBreakdownRow = {
  channel: string;
  handler: "AI" | "Agent";
  first_response_count: bigint;
  within_sla: bigint;
};

export type SlaBreakdownApiRow = {
  channel: string;
  handler: "ai" | "agent";
  firstResponseCount: number;
  withinSlaCount: number;
  missedSlaCount: number;
  slaRate: number;
};

export function slaRateDisplay(slaRate: number, firstResponseCount: number): string {
  return firstResponseCount > 0 ? `${slaRate}%` : "—";
}

export function slaRateCaption(firstResponseCount: number, withinSlaCount: number): string {
  if (firstResponseCount <= 0) return "No first replies in period";
  return `${withinSlaCount} of ${firstResponseCount} first replies`;
}

export function mapSlaBreakdown(rows: SlaBreakdownRow[]): SlaBreakdownApiRow[] {
  return rows.map((row) => {
    const firstResponseCount = Number(row.first_response_count);
    const withinSlaCount = Number(row.within_sla);
    return {
      channel: String(row.channel || "unknown").trim().toLowerCase(),
      handler: row.handler === "Agent" ? "agent" : "ai",
      firstResponseCount,
      withinSlaCount,
      missedSlaCount: Math.max(0, firstResponseCount - withinSlaCount),
      slaRate: percent(withinSlaCount, firstResponseCount),
    };
  });
}

export function buildPerformanceKpis(current: AggregateRow, previous: AggregateRow): PerformanceKpis {
  const handled = Number(current.handled);
  const previousHandled = Number(previous.handled);
  const resolved = Number(current.resolved);
  const firstResponseCount = Number(current.first_response_count);
  const withinSla = Number(current.within_sla);
  const handledChange = percentageChange(handled, previousHandled);

  return {
    handled,
    handledChangePercent: handledChange,
    resolutionRate: percent(resolved, handled),
    avgFirstResponseSeconds: roundDurationSeconds(current.avg_first_response_seconds),
    avgHandleSeconds: roundDurationSeconds(current.avg_handle_seconds),
    slaRate: percent(withinSla, firstResponseCount),
    transferred: Number(current.transferred),
    firstResponseCount,
    withinSlaCount: withinSla,
  };
}

function reportingExportStamp(exportedAt = new Date()): string {
  return exportedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function performanceExportFilename(
  rangeLabel: string,
  extension: "csv" | "png",
  exportedAt = new Date(),
): string {
  return `my-performance-${rangeLabel}-${reportingExportStamp(exportedAt)}.${extension}`;
}

export function dashboardExportFilename(
  rangeLabel: string,
  extension: "csv" | "png",
  exportedAt = new Date(),
): string {
  return `org-dashboard-${rangeLabel}-${reportingExportStamp(exportedAt)}.${extension}`;
}

export function buildKpiTableRows(
  kpis: ReturnType<typeof buildPerformanceKpis>,
  period: { start: Date; end: Date },
  exportedAt: Date,
): Array<[string, string | number]> {
  const handledChange =
    kpis.handledChangePercent === null ? "New" : `${kpis.handledChangePercent}%`;
  const firstResponseCount = kpis.firstResponseCount;

  return [
    ["Handled", kpis.handled],
    ["Handled change vs prior period", handledChange],
    ["Resolution rate (%)", kpis.resolutionRate],
    ["Avg first response (seconds)", kpis.avgFirstResponseSeconds ?? ""],
    ["First response sample (conversations)", firstResponseCount],
    ["Avg handle time (seconds)", kpis.avgHandleSeconds ?? ""],
    ["First-Reply SLA rate (%)", firstResponseCount > 0 ? kpis.slaRate : ""],
    ["First-Reply SLA within 60s (conversations)", kpis.withinSlaCount],
    ["First-Reply SLA missed (conversations)", Math.max(0, firstResponseCount - kpis.withinSlaCount)],
    ["Transferred", kpis.transferred],
    ["Period start", period.start.toISOString()],
    ["Period end", period.end.toISOString()],
    ["Exported at", exportedAt.toISOString()],
  ];
}

export function buildKpiCsvSection(
  kpis: ReturnType<typeof buildPerformanceKpis>,
  period: { start: Date; end: Date },
  exportedAt: Date,
  title = "Performance KPIs",
): string[] {
  const handledChange =
    kpis.handledChangePercent === null ? "New" : `${kpis.handledChangePercent}%`;
  const firstResponseCount = kpis.firstResponseCount;

  return [
    [title, ""].map(csvCell).join(","),
    ["Metric", "Value"].map(csvCell).join(","),
    ["Handled", kpis.handled].map(csvCell).join(","),
    ["Handled change vs prior period", handledChange].map(csvCell).join(","),
    ["Resolution rate (%)", kpis.resolutionRate].map(csvCell).join(","),
    ["Avg first response (seconds)", kpis.avgFirstResponseSeconds ?? ""].map(csvCell).join(","),
    ["First response sample (conversations)", firstResponseCount].map(csvCell).join(","),
    ["Avg handle time (seconds)", kpis.avgHandleSeconds ?? ""].map(csvCell).join(","),
    ["First-Reply SLA rate (%)", firstResponseCount > 0 ? kpis.slaRate : ""].map(csvCell).join(","),
    ["First-Reply SLA within 60s (conversations)", kpis.withinSlaCount].map(csvCell).join(","),
    ["First-Reply SLA missed (conversations)", Math.max(0, firstResponseCount - kpis.withinSlaCount)].map(
      csvCell,
    ).join(","),
    ["Transferred", kpis.transferred].map(csvCell).join(","),
    ["Period start", period.start.toISOString()].map(csvCell).join(","),
    ["Period end", period.end.toISOString()].map(csvCell).join(","),
    ["Exported at", exportedAt.toISOString()].map(csvCell).join(","),
    "",
  ];
}

export function buildAgentCsvSection(
  rows: Array<{
    name: string;
    presentDays: number;
    readyHours: number;
    readyPresenceHours: number;
    busyPresenceHours: number;
    notReadyPresenceHours: number;
    breakPresenceHours: number;
    dominantPresence: string;
    handled: number;
    resolutionRate: number;
    avgHandleMinutes: number;
    slaRate: number;
    transferred: number;
  }>,
  options: { subDay: boolean; title?: string },
): string[] {
  const presentLabel = options.subDay ? "Ready hrs" : "Present days";
  const title = options.title ?? "Agent performance & presence";
  return [
    [title, "", "", "", "", "", "", "", "", "", "", ""].map(csvCell).join(","),
    [
      "Agent",
      presentLabel,
      "Ready",
      "Busy",
      "Not ready",
      "Break",
      "Primary state",
      "Handled",
      "Resolution",
      "AHT",
      "SLA",
      "Xfer",
    ].map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.name,
        options.subDay ? row.readyHours : row.presentDays,
        row.readyPresenceHours,
        row.busyPresenceHours,
        row.notReadyPresenceHours,
        row.breakPresenceHours,
        row.dominantPresence,
        row.handled,
        `${row.resolutionRate}%`,
        `${row.avgHandleMinutes}m`,
        `${row.slaRate}%`,
        row.transferred,
      ]
        .map(csvCell)
        .join(","),
    ),
    "",
  ];
}

export function csvCell(value: unknown): string {
  const text =
    value instanceof Date
      ? value.toISOString()
      : value === null || value === undefined
        ? ""
        : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const AGGREGATE_SQL = `
  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (
      WHERE c.status IN ('resolved', 'closed') OR c.ended_at IS NOT NULL
    )::bigint AS handled,
    COUNT(*) FILTER (WHERE c.resolved_at IS NOT NULL)::bigint AS resolved,
    COUNT(*) FILTER (WHERE c.transferred_at IS NOT NULL)::bigint AS transferred,
    COUNT(*) FILTER (WHERE c.first_response_at IS NOT NULL)::bigint AS first_response_count,
    COUNT(*) FILTER (
      WHERE c.first_response_at IS NOT NULL
        AND c.assigned_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (c.first_response_at - c.assigned_at)) <= 60
    )::bigint AS within_sla,
    AVG(
      EXTRACT(EPOCH FROM (c.first_response_at - c.assigned_at))
    ) FILTER (
      WHERE c.first_response_at IS NOT NULL AND c.assigned_at IS NOT NULL
    )::float8 AS avg_first_response_seconds,
    AVG(
      EXTRACT(EPOCH FROM (COALESCE(c.resolved_at, c.ended_at) - c.assigned_at))
    ) FILTER (
      WHERE c.assigned_at IS NOT NULL
        AND COALESCE(c.resolved_at, c.ended_at) IS NOT NULL
    )::float8 AS avg_handle_seconds
  FROM ccass.conversations c
  WHERE c.organization_id = $1::bigint
    AND ${REPORTING_PERIOD_AT} >= $2
    AND ${REPORTING_PERIOD_AT} < $3
`;

const EMPTY_AGGREGATE: AggregateRow = {
  total: 0n,
  handled: 0n,
  resolved: 0n,
  transferred: 0n,
  first_response_count: 0n,
  within_sla: 0n,
  avg_first_response_seconds: null,
  avg_handle_seconds: null,
};

export async function loadAgentAggregate(
  db: DbClient,
  organizationId: string,
  userId: string,
  start: Date,
  end: Date,
): Promise<AggregateRow> {
  const rows = await db.$queryRawUnsafe<AggregateRow[]>(
    `${AGGREGATE_SQL} AND ${conversationHandledByUserCondition(userId)}`,
    organizationId,
    start,
    end,
  );
  return rows[0] ?? EMPTY_AGGREGATE;
}

export async function loadOrgAggregate(
  db: DbClient,
  organizationId: string,
  start: Date,
  end: Date,
): Promise<AggregateRow> {
  const rows = await db.$queryRawUnsafe<AggregateRow[]>(
    AGGREGATE_SQL,
    organizationId,
    start,
    end,
  );
  return rows[0] ?? EMPTY_AGGREGATE;
}

export async function loadSlaBreakdown(
  db: DbClient,
  organizationId: string,
  start: Date,
  end: Date,
  userId: string | null = null,
): Promise<SlaBreakdownRow[]> {
  const userFilter = userId ? `AND ${conversationHandledByUserCondition(userId)}` : "";
  return db.$queryRawUnsafe<SlaBreakdownRow[]>(
    `
    SELECT
      INITCAP(c.channel) AS channel,
      CASE
        WHEN ${CONVERSATION_REACHED_AGENT_CONDITION} THEN 'Agent'
        ELSE 'AI'
      END AS handler,
      COUNT(*) FILTER (WHERE c.first_response_at IS NOT NULL)::bigint AS first_response_count,
      COUNT(*) FILTER (
        WHERE c.first_response_at IS NOT NULL
          AND c.assigned_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (c.first_response_at - c.assigned_at)) <= 60
      )::bigint AS within_sla
    FROM ccass.conversations c
    WHERE c.organization_id = $1::bigint
      ${userFilter}
      AND ${REPORTING_PERIOD_AT} >= $2
      AND ${REPORTING_PERIOD_AT} < $3
    GROUP BY c.channel,
      CASE
        WHEN ${CONVERSATION_REACHED_AGENT_CONDITION} THEN 'Agent'
        ELSE 'AI'
      END
    HAVING COUNT(*) FILTER (WHERE c.first_response_at IS NOT NULL) > 0
    ORDER BY first_response_count DESC, channel ASC, handler ASC
    `,
    organizationId,
    start,
    end,
  );
}

export async function loadAgentReportRows(
  db: DbClient,
  organizationId: string,
  userId: string,
  start: Date,
  end: Date,
): Promise<ReportRow[]> {
  return db.$queryRawUnsafe<ReportRow[]>(
    `
    SELECT
      c.id,
      c.channel,
      c.status,
      c.subject,
      c.visitor_id,
      c.assigned_at,
      c.first_response_at,
      COALESCE(c.resolved_at, c.ended_at) AS ended_at,
      c.resolution_code AS resolution,
      d.label AS disposition
    FROM ccass.conversations c
    LEFT JOIN LATERAL (
      SELECT disposition_id
      FROM ccass.conversation_dispositions cd
      WHERE cd.conversation_id = c.id
        AND cd.organization_id = c.organization_id
      ORDER BY cd.applied_at DESC
      LIMIT 1
    ) cd ON TRUE
    LEFT JOIN ccass.dispositions d ON d.id = cd.disposition_id
    WHERE c.organization_id = $1::bigint
      AND ${conversationHandledByUserCondition(userId)}
      AND ${REPORTING_PERIOD_AT} >= $2
      AND ${REPORTING_PERIOD_AT} < $3
    ORDER BY ${REPORTING_PERIOD_AT} DESC
    `,
    organizationId,
    start,
    end,
  );
}

export async function loadOrgReportRows(
  db: DbClient,
  organizationId: string,
  start: Date,
  end: Date,
): Promise<ReportRow[]> {
  return db.$queryRaw<ReportRow[]>`
    SELECT
      c.id,
      c.channel,
      c.status,
      c.subject,
      c.visitor_id,
      c.assigned_at,
      c.first_response_at,
      COALESCE(c.resolved_at, c.ended_at) AS ended_at,
      c.resolution_code AS resolution,
      d.label AS disposition
    FROM ccass.conversations c
    LEFT JOIN LATERAL (
      SELECT disposition_id
      FROM ccass.conversation_dispositions cd
      WHERE cd.conversation_id = c.id
        AND cd.organization_id = c.organization_id
      ORDER BY cd.applied_at DESC
      LIMIT 1
    ) cd ON TRUE
    LEFT JOIN ccass.dispositions d ON d.id = cd.disposition_id
    WHERE c.organization_id = ${organizationId}::bigint
      AND COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at) >= ${start}
      AND COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at) < ${end}
    ORDER BY COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at) DESC
  `;
}

export async function loadAgentDailyRows(
  db: DbClient,
  organizationId: string,
  userId: string,
  start: Date,
  end: Date,
): Promise<DailyRow[]> {
  return db.$queryRawUnsafe<DailyRow[]>(
    `
    SELECT
      DATE_TRUNC('day', ${REPORTING_PERIOD_AT}) AS day,
      COUNT(*) FILTER (
        WHERE c.status IN ('resolved', 'closed') OR c.ended_at IS NOT NULL
      )::bigint AS handled,
      AVG(
        EXTRACT(EPOCH FROM (COALESCE(c.resolved_at, c.ended_at) - c.assigned_at))
      ) FILTER (
        WHERE c.assigned_at IS NOT NULL
          AND COALESCE(c.resolved_at, c.ended_at) IS NOT NULL
      )::float8 AS avg_handle_seconds
    FROM ccass.conversations c
    WHERE c.organization_id = $1::bigint
      AND ${conversationHandledByUserCondition(userId)}
      AND ${REPORTING_PERIOD_AT} >= $2
      AND ${REPORTING_PERIOD_AT} < $3
    GROUP BY DATE_TRUNC('day', ${REPORTING_PERIOD_AT})
    ORDER BY day ASC
    `,
    organizationId,
    start,
    end,
  );
}

export async function loadOrgDailyRows(
  db: DbClient,
  organizationId: string,
  start: Date,
  end: Date,
): Promise<DailyRow[]> {
  return db.$queryRaw<DailyRow[]>`
    SELECT
      DATE_TRUNC('day', COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at)) AS day,
      COUNT(*) FILTER (
        WHERE c.status IN ('resolved', 'closed') OR c.ended_at IS NOT NULL
      )::bigint AS handled,
      AVG(
        EXTRACT(EPOCH FROM (COALESCE(c.resolved_at, c.ended_at) - c.assigned_at))
      ) FILTER (
        WHERE c.assigned_at IS NOT NULL
          AND COALESCE(c.resolved_at, c.ended_at) IS NOT NULL
      )::float8 AS avg_handle_seconds
    FROM ccass.conversations c
    WHERE c.organization_id = ${organizationId}::bigint
      AND COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at) >= ${start}
      AND COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at) < ${end}
    GROUP BY DATE_TRUNC('day', COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at))
    ORDER BY day ASC
  `;
}

async function loadOrgDispositionBreakdown(
  db: DbClient,
  organizationId: string,
  start: Date,
  end: Date,
  userId?: string,
): Promise<BreakdownRow[]> {
  const scopedUserFilter = userId
    ? `AND ${conversationHandledByUserCondition(userId)}`
    : "";

  return db.$queryRawUnsafe<BreakdownRow[]>(
    `
    WITH closed_counts AS (
      SELECT COALESCE(d.label, 'Not set') AS label, COUNT(*)::bigint AS value
      FROM ccass.conversations c
      LEFT JOIN LATERAL (
        SELECT disposition_id
        FROM ccass.conversation_dispositions cd
        WHERE cd.conversation_id = c.id
          AND cd.organization_id = c.organization_id
        ORDER BY cd.applied_at DESC
        LIMIT 1
      ) cd ON TRUE
      LEFT JOIN ccass.dispositions d ON d.id = cd.disposition_id
      WHERE c.organization_id = $1::bigint
        ${scopedUserFilter}
        AND ${REPORTING_PERIOD_AT} >= $2
        AND ${REPORTING_PERIOD_AT} < $3
        AND (c.status IN ('resolved', 'closed') OR c.ended_at IS NOT NULL)
      GROUP BY COALESCE(d.label, 'Not set')
    )
    SELECT catalog.label, COALESCE(closed_counts.value, 0)::bigint AS value
    FROM ccass.dispositions catalog
    LEFT JOIN closed_counts ON closed_counts.label = catalog.label
    WHERE catalog.organization_id = $1::bigint
      AND catalog.is_active = TRUE
    ORDER BY catalog.sort_order ASC, catalog.label ASC
    `,
    organizationId,
    start,
    end,
  );
}

export async function loadAgentBreakdown(
  db: DbClient,
  organizationId: string,
  userId: string,
  start: Date,
  end: Date,
  kind: "channel" | "disposition",
): Promise<BreakdownRow[]> {
  if (kind === "channel") {
    const [configured, rows] = await Promise.all([
      loadOrgConfiguredReportingChannels(db, organizationId),
      db.$queryRawUnsafe<BreakdownRow[]>(
        `
        SELECT INITCAP(c.channel) AS label, COUNT(*)::bigint AS value
        FROM ccass.conversations c
        WHERE c.organization_id = $1::bigint
          AND ${conversationHandledByUserCondition(userId)}
          AND ${REPORTING_PERIOD_AT} >= $2
          AND ${REPORTING_PERIOD_AT} < $3
        GROUP BY c.channel
        ORDER BY value DESC
        `,
        organizationId,
        start,
        end,
      ),
    ]);
    return fillSimpleChannelBreakdown(configured, rows);
  }

  return loadOrgDispositionBreakdown(db, organizationId, start, end, userId);
}

export async function loadOrgBreakdown(
  db: DbClient,
  organizationId: string,
  start: Date,
  end: Date,
  kind: "channel",
): Promise<ChannelBreakdownRow[]>;
export async function loadOrgBreakdown(
  db: DbClient,
  organizationId: string,
  start: Date,
  end: Date,
  kind: "disposition",
): Promise<BreakdownRow[]>;
export async function loadOrgBreakdown(
  db: DbClient,
  organizationId: string,
  start: Date,
  end: Date,
  kind: "channel" | "disposition",
): Promise<BreakdownRow[] | ChannelBreakdownRow[]> {
  if (kind === "channel") {
    const [configured, rows] = await Promise.all([
      loadOrgConfiguredReportingChannels(db, organizationId),
      db.$queryRawUnsafe<ChannelBreakdownRow[]>(
        `
        SELECT
          INITCAP(c.channel) AS channel,
          CASE
            WHEN ${CONVERSATION_REACHED_AGENT_CONDITION} THEN 'Agent'
            ELSE 'AI'
          END AS handler,
          INITCAP(c.channel) || ' · ' || CASE
            WHEN ${CONVERSATION_REACHED_AGENT_CONDITION} THEN 'Agent'
            ELSE 'AI'
          END AS label,
          COUNT(*)::bigint AS value
        FROM ccass.conversations c
        WHERE c.organization_id = $1::bigint
          AND COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at) >= $2
          AND COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at) < $3
        GROUP BY c.channel,
          CASE
            WHEN ${CONVERSATION_REACHED_AGENT_CONDITION} THEN 'Agent'
            ELSE 'AI'
          END
        ORDER BY channel ASC, handler DESC
        `,
        organizationId,
        start,
        end,
      ),
    ]);
    return fillOrgChannelBreakdown(configured, rows);
  }

  return loadOrgDispositionBreakdown(db, organizationId, start, end);
}

const SENTIMENT_BANDS = [
  { key: "very_positive", label: "Very positive" },
  { key: "positive", label: "Positive" },
  { key: "neutral", label: "Neutral" },
  { key: "negative", label: "Negative" },
  { key: "very_negative", label: "Very negative" },
] as const;

function fillSentimentMix(rows: BreakdownRow[]): BreakdownRow[] {
  const byKey = new Map(rows.map((row) => [row.label, row]));
  return SENTIMENT_BANDS.map((band) => ({
    label: band.label,
    value: byKey.get(band.key)?.value ?? 0n,
  }));
}

export async function loadAgentSentimentMix(
  db: DbClient,
  organizationId: string,
  userId: string,
  start: Date,
  end: Date,
): Promise<BreakdownRow[]> {
  const rows = await db.$queryRawUnsafe<BreakdownRow[]>(
    `
    WITH scoped_conversations AS (
      SELECT c.id
      FROM ccass.conversations c
      WHERE c.organization_id = $1::bigint
        AND ${conversationHandledByUserCondition(userId)}
        AND ${REPORTING_PERIOD_AT} >= $2
        AND ${REPORTING_PERIOD_AT} < $3
    ),
    latest_sentiment AS (
      SELECT DISTINCT ON (st.conversation_id)
        st.conversation_id,
        st.agent_label
      FROM ccass.conversation_sentiment_turns st
      INNER JOIN scoped_conversations sc ON sc.id = st.conversation_id
      WHERE st.organization_id = $1::bigint
        AND st.agent_label IS NOT NULL
      ORDER BY st.conversation_id, st.created_at DESC
    )
    SELECT
      agent_label AS label,
      COUNT(*)::bigint AS value
    FROM latest_sentiment
    GROUP BY agent_label
    ORDER BY value DESC
    `,
    organizationId,
    start,
    end,
  );
  return fillSentimentMix(rows);
}

export async function resolveOrganizationAgent(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<{ id: string; name: string } | null> {
  const row = await db.setup_users.findFirst({
    where: { id: toDbId(agentId), organization_id: toDbId(organizationId) },
    select: { id: true, first_name: true, last_name: true },
  });
  if (!row) return null;
  return { id: serializeEntityId(row.id), name: `${row.first_name} ${row.last_name}`.trim() };
}
