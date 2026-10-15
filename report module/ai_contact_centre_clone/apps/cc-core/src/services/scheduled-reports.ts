import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import { serializeEntityId, toDbId } from "../lib/id-schema.js";
import {
  getAgentAttendanceRange,
  loadAgentPresenceMix,
  presenceMixLabel,
} from "./agent-attendance.js";
import {
  buildPerformanceKpis,
  loadAgentAggregate,
  loadAgentBreakdown,
  loadAgentDailyRows,
  loadOrgAggregate,
  loadOrgBreakdown,
  loadOrgDailyRows,
  type ChannelBreakdownRow,
} from "./reporting.js";
import { readScheduledReportPdf } from "./scheduled-report-storage.js";
import { listWorkforceAgents } from "./workforce.js";

export const REPORT_SCHEDULE_VALUES = [
  "every_1h",
  "every_2h",
  "every_3h",
  "every_6h",
  "daily",
  "weekly",
  "monthly",
] as const;

export const REPORT_PERIOD_VALUES = ["yesterday", "7d", "30d"] as const;
export const REPORT_WEEKDAY_VALUES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export const REPORT_SEND_MODE_VALUES = ["start_of_shift", "end_of_shift", "custom_time"] as const;

export type ReportSchedule = (typeof REPORT_SCHEDULE_VALUES)[number];
export type ReportPeriod = (typeof REPORT_PERIOD_VALUES)[number];
export type ReportWeekday = (typeof REPORT_WEEKDAY_VALUES)[number];
export type ReportSendMode = (typeof REPORT_SEND_MODE_VALUES)[number];

export type ReportIncludedSections = {
  dashboardKpis: boolean;
  agentTable: boolean;
  aiSummary: boolean;
};

export type ReportScope = "organization" | "agent";

export type AgentReportIncludedSections = {
  performanceKpis: boolean;
  aiSummary: boolean;
};

export type ScheduledReportRecord = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  reportScope: ReportScope;
  targetUserId: string | null;
  name: string;
  enabled: boolean;
  schedule: ReportSchedule;
  weekday: ReportWeekday;
  monthDay: number;
  sendMode: ReportSendMode;
  sendAt: string;
  timeZone: string;
  period: ReportPeriod;
  formats: { pdf: boolean; csv: boolean };
  includedSections: ReportIncludedSections;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportWindow = {
  start: Date;
  end: Date;
  label: string;
  subDay: boolean;
};

export type OrgAgentReportRow = {
  agentId: string;
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
};

export type ReportMailbox = {
  channelConfigId: string;
  oauthConnectionId: string | null;
  providerType: string;
  oauthProvider: string | null;
  senderEmail: string;
  senderName: string | null;
  replyTo: string | null;
};

const INTERVAL_HOURS: Record<string, number> = {
  every_1h: 1,
  every_2h: 2,
  every_3h: 3,
  every_6h: 6,
};

const SHIFT_START = "09:00";
const SHIFT_END = "18:00";

const WEEKDAY_INDEX: Record<ReportWeekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export const scheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  enabled: z.boolean().default(true),
  schedule: z.enum(REPORT_SCHEDULE_VALUES),
  weekday: z.enum(REPORT_WEEKDAY_VALUES).default("monday"),
  monthDay: z.number().int().min(1).max(31).default(1),
  sendMode: z.enum(REPORT_SEND_MODE_VALUES).default("custom_time"),
  sendAt: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  timeZone: z.string().trim().min(1).max(64).default("Asia/Kolkata"),
  period: z.enum(REPORT_PERIOD_VALUES).default("yesterday"),
  formats: z
    .object({
      pdf: z.boolean(),
      csv: z.boolean(),
    })
    .default({ pdf: true, csv: false }),
  includedSections: z
    .object({
      dashboardKpis: z.boolean(),
      agentTable: z.boolean(),
      aiSummary: z.boolean(),
    })
    .default({ dashboardKpis: true, agentTable: true, aiSummary: true })
    .refine(
      (value) => value.dashboardKpis || value.agentTable || value.aiSummary,
      "Select at least one report section",
    ),
});

export const agentScheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  enabled: z.boolean().default(true),
  schedule: z.enum(REPORT_SCHEDULE_VALUES),
  weekday: z.enum(REPORT_WEEKDAY_VALUES).default("monday"),
  monthDay: z.number().int().min(1).max(31).default(1),
  sendMode: z.enum(REPORT_SEND_MODE_VALUES).default("custom_time"),
  sendAt: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  timeZone: z.string().trim().min(1).max(64).default("Asia/Kolkata"),
  period: z.enum(REPORT_PERIOD_VALUES).default("yesterday"),
  formats: z
    .object({
      pdf: z.boolean(),
      csv: z.boolean(),
    })
    .default({ pdf: true, csv: false }),
  includedSections: z
    .object({
      performanceKpis: z.boolean(),
      aiSummary: z.boolean(),
    })
    .default({ performanceKpis: true, aiSummary: true })
    .refine(
      (value) => value.performanceKpis || value.aiSummary,
      "Select at least one report section",
    ),
});

export function mapAgentIncludedSectionsToStored(
  sections: AgentReportIncludedSections,
): ReportIncludedSections {
  return {
    dashboardKpis: sections.performanceKpis,
    agentTable: false,
    aiSummary: sections.aiSummary,
  };
}

export function mapStoredIncludedSectionsForAgent(
  sections: ReportIncludedSections,
): AgentReportIncludedSections {
  return {
    performanceKpis: sections.dashboardKpis,
    aiSummary: sections.aiSummary,
  };
}

function ymdInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDisplayDate(ymd: string, timeZone: string): string {
  const date = new Date(`${ymd}T12:00:00.000Z`);
  return date.toLocaleDateString("en-IN", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d! + days));
  return utc.toISOString().slice(0, 10);
}

function resolveSendClock(input: {
  sendMode: ReportSendMode;
  sendAt: string;
}): string {
  if (input.sendMode === "start_of_shift") return SHIFT_START;
  if (input.sendMode === "end_of_shift") return SHIFT_END;
  return input.sendAt;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    weekday: weekdayMap[weekday] ?? 0,
  };
}

function dateFromZoned(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}): Date {
  const guess = new Date(
    Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0),
  );
  const parts = zonedParts(guess, input.timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offset = asUtc - guess.getTime();
  return new Date(guess.getTime() - offset);
}

export function resolveReportWindow(
  schedule: Pick<ScheduledReportRecord, "schedule" | "period" | "timeZone">,
  now: Date = new Date(),
): ReportWindow {
  const intervalHours = INTERVAL_HOURS[schedule.schedule];
  if (intervalHours) {
    const end = now;
    const start = new Date(end.getTime() - intervalHours * 3_600_000);
    const label =
      intervalHours === 1 ? "Last 1 hour" : `Last ${intervalHours} hours`;
    return { start, end, label, subDay: true };
  }

  const timeZone = schedule.timeZone;
  const todayYmd = ymdInTimeZone(now, timeZone);
  const yesterdayYmd = addDaysYmd(todayYmd, -1);

  if (schedule.schedule === "monthly") {
    const parts = zonedParts(now, timeZone);
    const prevMonth = parts.month === 1 ? 12 : parts.month - 1;
    const prevYear = parts.month === 1 ? parts.year - 1 : parts.year;
    const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
    return {
      start: dateFromZoned({
        year: prevYear,
        month: prevMonth,
        day: 1,
        hour: 0,
        minute: 0,
        timeZone,
      }),
      end: dateFromZoned({
        year: prevYear,
        month: prevMonth,
        day: lastDay,
        hour: 23,
        minute: 59,
        timeZone,
      }),
      label: new Date(Date.UTC(prevYear, prevMonth - 1, 1)).toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      subDay: false,
    };
  }

  if (schedule.schedule === "weekly") {
    const endYmd = yesterdayYmd;
    const startYmd = addDaysYmd(endYmd, -6);
    return {
      start: dateFromZoned({
        ...parseYmd(startYmd),
        hour: 0,
        minute: 0,
        timeZone,
      }),
      end: dateFromZoned({
        ...parseYmd(endYmd),
        hour: 23,
        minute: 59,
        timeZone,
      }),
      label: `Week ending ${formatDisplayDate(endYmd, timeZone)}`,
      subDay: false,
    };
  }

  const period = schedule.period;
  if (period === "7d" || period === "30d") {
    const days = period === "7d" ? 7 : 30;
    const endYmd = yesterdayYmd;
    const startYmd = addDaysYmd(endYmd, -(days - 1));
    return {
      start: dateFromZoned({ ...parseYmd(startYmd), hour: 0, minute: 0, timeZone }),
      end: dateFromZoned({ ...parseYmd(endYmd), hour: 23, minute: 59, timeZone }),
      label: `${formatDisplayDate(startYmd, timeZone)} – ${formatDisplayDate(endYmd, timeZone)}`,
      subDay: false,
    };
  }

  return {
    start: dateFromZoned({ ...parseYmd(yesterdayYmd), hour: 0, minute: 0, timeZone }),
    end: dateFromZoned({ ...parseYmd(yesterdayYmd), hour: 23, minute: 59, timeZone }),
    label: `${formatDisplayDate(yesterdayYmd, timeZone)} (${timeZone})`,
    subDay: false,
  };
}

function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const [year, month, day] = ymd.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

export function computeNextRunAt(
  schedule: Pick<
    ScheduledReportRecord,
    "schedule" | "weekday" | "monthDay" | "sendMode" | "sendAt" | "timeZone"
  >,
  from: Date = new Date(),
): Date {
  const intervalHours = INTERVAL_HOURS[schedule.schedule];
  if (intervalHours) {
    const parts = zonedParts(from, schedule.timeZone);
    const alignedHour = Math.floor(parts.hour / intervalHours) * intervalHours + intervalHours;
    if (alignedHour >= 24) {
      return dateFromZoned({
        year: parts.year,
        month: parts.month,
        day: parts.day + 1,
        hour: 0,
        minute: 0,
        timeZone: schedule.timeZone,
      });
    }
    const candidate = dateFromZoned({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: alignedHour,
      minute: 0,
      timeZone: schedule.timeZone,
    });
    return candidate.getTime() <= from.getTime()
      ? new Date(candidate.getTime() + intervalHours * 3_600_000)
      : candidate;
  }

  const [hour, minute] = resolveSendClock({
    sendMode: schedule.sendMode,
    sendAt: schedule.sendAt,
  })
    .split(":")
    .map(Number);

  const parts = zonedParts(from, schedule.timeZone);
  let targetDay = parts.day;
  let targetMonth = parts.month;
  let targetYear = parts.year;

  if (schedule.schedule === "weekly") {
    const desired = WEEKDAY_INDEX[schedule.weekday];
    let delta = desired - parts.weekday;
    if (delta < 0) delta += 7;
    if (delta === 0) {
      const todayCandidate = dateFromZoned({
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: hour!,
        minute: minute!,
        timeZone: schedule.timeZone,
      });
      if (todayCandidate.getTime() <= from.getTime()) delta = 7;
    }
    const base = addDaysYmd(
      `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
      delta,
    );
    ({ year: targetYear, month: targetMonth, day: targetDay } = parseYmd(base));
  } else if (schedule.schedule === "monthly") {
    let month = parts.month;
    let year = parts.year;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(schedule.monthDay, lastDay);
    let candidate = dateFromZoned({
      year,
      month,
      day,
      hour: hour!,
      minute: minute!,
      timeZone: schedule.timeZone,
    });
    if (candidate.getTime() <= from.getTime()) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      const nextLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      candidate = dateFromZoned({
        year,
        month,
        day: Math.min(schedule.monthDay, nextLastDay),
        hour: hour!,
        minute: minute!,
        timeZone: schedule.timeZone,
      });
    }
    return candidate;
  } else {
    const candidate = dateFromZoned({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: hour!,
      minute: minute!,
      timeZone: schedule.timeZone,
    });
    if (candidate.getTime() > from.getTime()) return candidate;
    return dateFromZoned({
      year: parts.year,
      month: parts.month,
      day: parts.day + 1,
      hour: hour!,
      minute: minute!,
      timeZone: schedule.timeZone,
    });
  }

  let candidate = dateFromZoned({
    year: targetYear,
    month: targetMonth,
    day: targetDay,
    hour: hour!,
    minute: minute!,
    timeZone: schedule.timeZone,
  });
  if (candidate.getTime() <= from.getTime()) {
    const next = addDaysYmd(
      `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`,
      7,
    );
    ({ year: targetYear, month: targetMonth, day: targetDay } = parseYmd(next));
    candidate = dateFromZoned({
      year: targetYear,
      month: targetMonth,
      day: targetDay,
      hour: hour!,
      minute: minute!,
      timeZone: schedule.timeZone,
    });
  }
  return candidate;
}

export async function resolveReportMailbox(
  db: DbClient,
  organizationId: string,
): Promise<ReportMailbox | null> {
  const rows = await db.$queryRaw<
    {
      channel_config_id: bigint;
      oauth_connection_id: bigint | null;
      provider_type: string;
      oauth_provider: string | null;
      sender_email: string | null;
      sender_name: string | null;
      reply_to: string | null;
    }[]
  >`
    SELECT
      ec.channel_config_id,
      ec.oauth_connection_id,
      ec.provider_type,
      ec.oauth_provider,
      ec.sender_email,
      ec.sender_name,
      ec.reply_to
    FROM accounts.setup_email_configs ec
    JOIN accounts.setup_channel_configs cc ON cc.id = ec.channel_config_id
    WHERE cc.organization_id = ${organizationId}::bigint
      AND cc.status = 'active'
      AND cc.product_ids @> '["contact-center"]'::jsonb
      AND lower(trim(coalesce(ec.ccaas_handler, ''))) = 'internal'
      AND coalesce(trim(ec.sender_email), '') <> ''
    ORDER BY ec.updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    channelConfigId: serializeEntityId(row.channel_config_id),
    oauthConnectionId: row.oauth_connection_id
      ? serializeEntityId(row.oauth_connection_id)
      : null,
    providerType: row.provider_type,
    oauthProvider: row.oauth_provider,
    senderEmail: row.sender_email!.trim(),
    senderName: row.sender_name?.trim() ?? null,
    replyTo: row.reply_to?.trim() ?? null,
  };
}

export async function resolveAdminRecipientEmail(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const row = await db.setup_users.findFirst({
    where: { id: toDbId(userId), organization_id: toDbId(organizationId) },
    select: { work_email: true },
  });
  return row?.work_email?.trim().toLowerCase() ?? null;
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

export async function loadOrgAgentReportRows(
  db: DbClient,
  organizationId: string,
  window: ReportWindow,
  timeZone: string,
): Promise<OrgAgentReportRow[]> {
  const { agents } = await listWorkforceAgents(db, organizationId);
  const activeAgents = agents.filter((agent) => agent.status === "active");
  const startYmd = ymdInTimeZone(window.start, timeZone);
  const endYmd = ymdInTimeZone(window.end, timeZone);

  const rows: OrgAgentReportRow[] = [];
  for (const agent of activeAgents) {
    const [aggregate, attendance, presenceMix] = await Promise.all([
      loadAgentAggregate(db, organizationId, agent.id, window.start, window.end),
      getAgentAttendanceRange(db, organizationId, agent.id, startYmd, endYmd),
      loadAgentPresenceMix(db, organizationId, agent.id, window.start, window.end),
    ]);
    const kpis = buildPerformanceKpis(aggregate, aggregate);
    let presentDays = 0;
    let readySeconds = 0;
    for (const day of attendance.days) {
      if (day.attendance === "present") presentDays += 1;
      readySeconds += day.durationsSeconds.ready ?? 0;
    }
    if (window.subDay) {
      presentDays = readySeconds > 0 ? 1 : 0;
    }
    const presenceHours = (state: string): number => {
      const slice = presenceMix.states.find((entry) => entry.state === state);
      return slice ? Math.round((slice.seconds / 3600) * 10) / 10 : 0;
    };
    const dominantPresence = presenceMix.states[0]
      ? presenceMixLabel(presenceMix.states[0].state)
      : "Offline";

    rows.push({
      agentId: agent.id,
      name: `${agent.firstName} ${agent.lastName}`.trim() || agent.workEmail || agent.id,
      presentDays,
      readyHours: Math.round((readySeconds / 3600) * 10) / 10,
      readyPresenceHours: presenceHours("ready"),
      busyPresenceHours: presenceHours("busy"),
      notReadyPresenceHours: presenceHours("not_ready"),
      breakPresenceHours: presenceHours("break"),
      dominantPresence,
      handled: kpis.handled,
      resolutionRate: kpis.resolutionRate,
      avgHandleMinutes:
        kpis.avgHandleSeconds == null ? 0 : Math.round((kpis.avgHandleSeconds / 60) * 10) / 10,
      slaRate: kpis.slaRate,
      transferred: kpis.transferred,
    });
  }
  return rows.sort((a, b) => b.handled - a.handled || a.name.localeCompare(b.name));
}

export type NlpSummaryPayload = {
  teamRollup?: {
    agentCount: number;
    presentCount: number;
    absentCount: number;
    avgReadyHoursPerPresentAgent: number;
    totalHandled: number;
    avgResolutionRate: number;
    avgSlaRate: number;
    avgHandleMinutes: number;
  };
  topPerformers?: Array<{ name: string; handled: number; slaRate: number }>;
  needsAttention?: Array<{ name: string; handled: number; slaRate: number; reason: string }>;
  channelMixTop3?: Array<{ channel: string; sharePercent: number }>;
  dispositionMixTop3?: Array<{ disposition: string; sharePercent: number }>;
};

export function buildNlpSummaryPayload(input: {
  agentRows: OrgAgentReportRow[];
  includeAgentSection: boolean;
  channelRows: Array<{ channel: string; value: bigint | number }>;
  dispositionRows: Array<{ label: string; value: bigint | number }>;
}): NlpSummaryPayload {
  const payload: NlpSummaryPayload = {};
  const channelTotal = input.channelRows.reduce((sum, row) => sum + Number(row.value), 0);
  payload.channelMixTop3 = [...input.channelRows]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 3)
    .map((row) => ({
      channel: row.channel,
      sharePercent: percent(Number(row.value), channelTotal),
    }));

  const dispositionTotal = input.dispositionRows.reduce(
    (sum, row) => sum + Number(row.value),
    0,
  );
  payload.dispositionMixTop3 = [...input.dispositionRows]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 3)
    .map((row) => ({
      disposition: row.label,
      sharePercent: percent(Number(row.value), dispositionTotal),
    }));

  if (!input.includeAgentSection || input.agentRows.length === 0) {
    return payload;
  }

  const agentCount = input.agentRows.length;
  const presentCount = input.agentRows.filter((row) => row.presentDays > 0).length;
  const totalHandled = input.agentRows.reduce((sum, row) => sum + row.handled, 0);
  const avgResolutionRate =
    Math.round(
      (input.agentRows.reduce((sum, row) => sum + row.resolutionRate, 0) / agentCount) * 10,
    ) / 10;
  const avgSlaRate =
    Math.round((input.agentRows.reduce((sum, row) => sum + row.slaRate, 0) / agentCount) * 10) /
    10;
  const avgHandleMinutes =
    Math.round(
      (input.agentRows.reduce((sum, row) => sum + row.avgHandleMinutes, 0) / agentCount) * 10,
    ) / 10;
  const readyPresent = input.agentRows.filter((row) => row.readyHours > 0);
  const avgReadyHoursPerPresentAgent =
    readyPresent.length > 0
      ? Math.round(
          (readyPresent.reduce((sum, row) => sum + row.readyHours, 0) / readyPresent.length) *
            10,
        ) / 10
      : 0;

  payload.teamRollup = {
    agentCount,
    presentCount,
    absentCount: agentCount - presentCount,
    avgReadyHoursPerPresentAgent,
    totalHandled,
    avgResolutionRate,
    avgSlaRate,
    avgHandleMinutes,
  };

  payload.topPerformers = [...input.agentRows]
    .sort((a, b) => b.handled - a.handled || b.slaRate - a.slaRate)
    .slice(0, 3)
    .map((row) => ({ name: row.name, handled: row.handled, slaRate: row.slaRate }));

  const orgAvgSla = avgSlaRate;
  payload.needsAttention = [...input.agentRows]
    .filter((row) => row.handled === 0 || row.slaRate < orgAvgSla)
    .sort((a, b) => a.slaRate - b.slaRate || a.handled - b.handled)
    .slice(0, 3)
    .map((row) => ({
      name: row.name,
      handled: row.handled,
      slaRate: row.slaRate,
      reason: row.handled === 0 ? "zero_handled" : "low_sla",
    }));

  return payload;
}

export async function resolveSetupUserDisplayName(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<string> {
  const row = await db.setup_users.findFirst({
    where: { id: toDbId(userId), organization_id: toDbId(organizationId) },
    select: { first_name: true, last_name: true, work_email: true },
  });
  if (!row) return "Agent";
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return name || row.work_email?.trim() || "Agent";
}

export async function loadAgentReportContext(
  db: DbClient,
  organizationId: string,
  userId: string,
  window: ReportWindow,
) {
  const spanMs = window.end.getTime() - window.start.getTime();
  const previousStart = new Date(window.start.getTime() - spanMs);
  const [current, previous, dailyRows, channelRows, dispositionRows] = await Promise.all([
    loadAgentAggregate(db, organizationId, userId, window.start, window.end),
    loadAgentAggregate(db, organizationId, userId, previousStart, window.start),
    loadAgentDailyRows(db, organizationId, userId, window.start, window.end),
    loadAgentBreakdown(db, organizationId, userId, window.start, window.end, "channel"),
    loadAgentBreakdown(db, organizationId, userId, window.start, window.end, "disposition"),
  ]);
  const dayFormatter = new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric" });
  return {
    agentKpis: buildPerformanceKpis(current, previous),
    resolved: Number(current.resolved),
    channelRows: channelRows as ChannelBreakdownRow[],
    dispositionRows,
    dailyRows: dailyRows.map((row) => ({
      label: dayFormatter.format(row.day),
      handled: Number(row.handled),
      avgHandleSeconds: Math.max(0, Math.round(row.avg_handle_seconds ?? 0)),
    })),
  };
}

export function buildAgentNlpSummaryPayload(input: {
  channelRows: Array<{ label?: string; channel?: string; value: bigint | number }>;
  dispositionRows: Array<{ label: string; value: bigint | number }>;
}) {
  const channelTotal = input.channelRows.reduce((sum, row) => sum + Number(row.value), 0);
  const channelMixTop3 = [...input.channelRows]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 3)
    .map((row) => ({
      channel: row.channel ?? row.label ?? "Unknown",
      sharePercent: percent(Number(row.value), channelTotal),
    }));

  const dispositionTotal = input.dispositionRows.reduce(
    (sum, row) => sum + Number(row.value),
    0,
  );
  const dispositionMixTop3 = [...input.dispositionRows]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 3)
    .map((row) => ({
      disposition: row.label,
      sharePercent: percent(Number(row.value), dispositionTotal),
    }));

  return { channelMixTop3, dispositionMixTop3 };
}

export async function loadOrgReportContext(
  db: DbClient,
  organizationId: string,
  window: ReportWindow,
) {
  const [current, previous, channelRows, dispositionRows, dailyRows] = await Promise.all([
    loadOrgAggregate(db, organizationId, window.start, window.end),
    loadOrgAggregate(
      db,
      organizationId,
      new Date(window.start.getTime() - (window.end.getTime() - window.start.getTime())),
      window.start,
    ),
    loadOrgBreakdown(db, organizationId, window.start, window.end, "channel"),
    loadOrgBreakdown(db, organizationId, window.start, window.end, "disposition"),
    loadOrgDailyRows(db, organizationId, window.start, window.end),
  ]);
  const dayFormatter = new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric" });
  return {
    orgKpis: buildPerformanceKpis(current, previous),
    resolved: Number(current.resolved),
    channelRows: channelRows as ChannelBreakdownRow[],
    dispositionRows,
    dailyRows: dailyRows.map((row) => ({
      label: dayFormatter.format(row.day),
      handled: Number(row.handled),
      avgHandleSeconds: Math.max(0, Math.round(row.avg_handle_seconds ?? 0)),
    })),
  };
}

function parseIncludedSections(value: unknown): ReportIncludedSections {
  const fallback = { dashboardKpis: true, agentTable: true, aiSummary: true };
  if (!value || typeof value !== "object") return fallback;
  const row = value as Record<string, unknown>;
  return {
    dashboardKpis: row.dashboardKpis !== false,
    agentTable: row.agentTable !== false,
    aiSummary: row.aiSummary !== false,
  };
}

function mapScheduleRow(row: {
  id: bigint;
  organization_id: bigint;
  created_by_user_id: bigint;
  report_scope?: string | null;
  target_user_id?: bigint | null;
  name: string;
  enabled: boolean;
  schedule: string;
  weekday: string;
  month_day: number;
  send_mode: string;
  send_at: string;
  time_zone: string;
  period: string;
  formats: unknown;
  included_sections: unknown;
  next_run_at: Date | null;
  last_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): ScheduledReportRecord {
  const formats =
    row.formats && typeof row.formats === "object"
      ? (row.formats as { pdf?: boolean; csv?: boolean })
      : { pdf: true, csv: false };
  return {
    id: serializeEntityId(row.id),
    organizationId: serializeEntityId(row.organization_id),
    createdByUserId: serializeEntityId(row.created_by_user_id),
    reportScope: row.report_scope === "agent" ? "agent" : "organization",
    targetUserId:
      row.target_user_id == null ? null : serializeEntityId(row.target_user_id),
    name: row.name,
    enabled: row.enabled,
    schedule: row.schedule as ReportSchedule,
    weekday: row.weekday as ReportWeekday,
    monthDay: row.month_day,
    sendMode: row.send_mode as ReportSendMode,
    sendAt: row.send_at,
    timeZone: row.time_zone,
    period: row.period as ReportPeriod,
    formats: { pdf: formats.pdf !== false, csv: formats.csv === true },
    includedSections: parseIncludedSections(row.included_sections),
    nextRunAt: row.next_run_at?.toISOString() ?? null,
    lastRunAt: row.last_run_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listScheduledReportsForAdmin(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<ScheduledReportRecord[]> {
  const rows = await db.scheduled_reports.findMany({
    where: {
      organization_id: toDbId(organizationId),
      created_by_user_id: toDbId(userId),
      report_scope: "organization",
    },
    orderBy: [{ enabled: "desc" }, { updated_at: "desc" }],
  });
  return rows.map((row) => mapScheduleRow(row as never));
}

export async function createScheduledReport(
  db: DbClient,
  organizationId: string,
  userId: string,
  input: z.infer<typeof scheduleInputSchema>,
): Promise<ScheduledReportRecord> {
  const parsed = scheduleInputSchema.parse(input);
  const nextRunAt = parsed.enabled
    ? computeNextRunAt({
        schedule: parsed.schedule,
        weekday: parsed.weekday,
        monthDay: parsed.monthDay,
        sendMode: parsed.sendMode,
        sendAt: parsed.sendAt,
        timeZone: parsed.timeZone,
      })
    : null;
  const row = await db.scheduled_reports.create({
    data: {
      organization_id: toDbId(organizationId),
      created_by_user_id: toDbId(userId),
      report_scope: "organization",
      target_user_id: null,
      name: parsed.name,
      enabled: parsed.enabled,
      schedule: parsed.schedule,
      weekday: parsed.weekday,
      month_day: parsed.monthDay,
      send_mode: parsed.sendMode,
      send_at: parsed.sendAt,
      time_zone: parsed.timeZone,
      period: parsed.period,
      formats: parsed.formats,
      included_sections: parsed.includedSections,
      next_run_at: nextRunAt,
    },
  });
  return mapScheduleRow(row as never);
}

export async function updateScheduledReport(
  db: DbClient,
  organizationId: string,
  userId: string,
  scheduleId: string,
  input: Partial<z.infer<typeof scheduleInputSchema>>,
): Promise<ScheduledReportRecord | null> {
  const existing = await db.scheduled_reports.findFirst({
    where: {
      id: toDbId(scheduleId),
      organization_id: toDbId(organizationId),
      created_by_user_id: toDbId(userId),
      report_scope: "organization",
    },
  });
  if (!existing) return null;

  const merged = scheduleInputSchema.parse({
    name: input.name ?? existing.name,
    enabled: input.enabled ?? existing.enabled,
    schedule: input.schedule ?? existing.schedule,
    weekday: input.weekday ?? existing.weekday,
    monthDay: input.monthDay ?? existing.month_day,
    sendMode: input.sendMode ?? existing.send_mode,
    sendAt: input.sendAt ?? existing.send_at,
    timeZone: input.timeZone ?? existing.time_zone,
    period: input.period ?? existing.period,
    formats: input.formats ?? existing.formats,
    includedSections: input.includedSections ?? existing.included_sections,
  });

  const nextRunAt = merged.enabled
    ? computeNextRunAt({
        schedule: merged.schedule,
        weekday: merged.weekday,
        monthDay: merged.monthDay,
        sendMode: merged.sendMode,
        sendAt: merged.sendAt,
        timeZone: merged.timeZone,
      })
    : null;

  const row = await db.scheduled_reports.update({
    where: { id: existing.id },
    data: {
      name: merged.name,
      enabled: merged.enabled,
      schedule: merged.schedule,
      weekday: merged.weekday,
      month_day: merged.monthDay,
      send_mode: merged.sendMode,
      send_at: merged.sendAt,
      time_zone: merged.timeZone,
      period: merged.period,
      formats: merged.formats,
      included_sections: merged.includedSections,
      next_run_at: nextRunAt,
      updated_at: new Date(),
    },
  });
  return mapScheduleRow(row as never);
}

export async function deleteScheduledReport(
  db: DbClient,
  organizationId: string,
  userId: string,
  scheduleId: string,
): Promise<boolean> {
  const existing = await db.scheduled_reports.findFirst({
    where: {
      id: toDbId(scheduleId),
      organization_id: toDbId(organizationId),
      created_by_user_id: toDbId(userId),
      report_scope: "organization",
    },
    select: { id: true },
  });
  if (!existing) return false;
  await db.scheduled_reports.delete({ where: { id: existing.id } });
  return true;
}

export async function getScheduledReportForAdmin(
  db: DbClient,
  organizationId: string,
  userId: string,
  scheduleId: string,
): Promise<ScheduledReportRecord | null> {
  const row = await db.scheduled_reports.findFirst({
    where: {
      id: toDbId(scheduleId),
      organization_id: toDbId(organizationId),
      created_by_user_id: toDbId(userId),
      report_scope: "organization",
    },
  });
  return row ? mapScheduleRow(row as never) : null;
}

export async function listScheduledReportsForAgent(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<ScheduledReportRecord[]> {
  const rows = await db.scheduled_reports.findMany({
    where: {
      organization_id: toDbId(organizationId),
      created_by_user_id: toDbId(userId),
      report_scope: "agent",
      target_user_id: toDbId(userId),
    },
    orderBy: [{ enabled: "desc" }, { updated_at: "desc" }],
  });
  return rows.map((row) => mapScheduleRow(row as never));
}

export async function createAgentScheduledReport(
  db: DbClient,
  organizationId: string,
  userId: string,
  input: z.infer<typeof agentScheduleInputSchema>,
): Promise<ScheduledReportRecord> {
  const parsed = agentScheduleInputSchema.parse(input);
  const includedSections = mapAgentIncludedSectionsToStored(parsed.includedSections);
  const nextRunAt = parsed.enabled
    ? computeNextRunAt({
        schedule: parsed.schedule,
        weekday: parsed.weekday,
        monthDay: parsed.monthDay,
        sendMode: parsed.sendMode,
        sendAt: parsed.sendAt,
        timeZone: parsed.timeZone,
      })
    : null;
  const row = await db.scheduled_reports.create({
    data: {
      organization_id: toDbId(organizationId),
      created_by_user_id: toDbId(userId),
      report_scope: "agent",
      target_user_id: toDbId(userId),
      name: parsed.name,
      enabled: parsed.enabled,
      schedule: parsed.schedule,
      weekday: parsed.weekday,
      month_day: parsed.monthDay,
      send_mode: parsed.sendMode,
      send_at: parsed.sendAt,
      time_zone: parsed.timeZone,
      period: parsed.period,
      formats: parsed.formats,
      included_sections: includedSections,
      next_run_at: nextRunAt,
    },
  });
  return mapScheduleRow(row as never);
}

export async function updateAgentScheduledReport(
  db: DbClient,
  organizationId: string,
  userId: string,
  scheduleId: string,
  input: Partial<z.infer<typeof agentScheduleInputSchema>>,
): Promise<ScheduledReportRecord | null> {
  const existing = await db.scheduled_reports.findFirst({
    where: {
      id: toDbId(scheduleId),
      organization_id: toDbId(organizationId),
      created_by_user_id: toDbId(userId),
      report_scope: "agent",
      target_user_id: toDbId(userId),
    },
  });
  if (!existing) return null;

  const currentSections = mapStoredIncludedSectionsForAgent(
    parseIncludedSections(existing.included_sections),
  );
  const merged = agentScheduleInputSchema.parse({
    name: input.name ?? existing.name,
    enabled: input.enabled ?? existing.enabled,
    schedule: input.schedule ?? existing.schedule,
    weekday: input.weekday ?? existing.weekday,
    monthDay: input.monthDay ?? existing.month_day,
    sendMode: input.sendMode ?? existing.send_mode,
    sendAt: input.sendAt ?? existing.send_at,
    timeZone: input.timeZone ?? existing.time_zone,
    period: input.period ?? existing.period,
    formats: input.formats ?? existing.formats,
    includedSections: input.includedSections ?? currentSections,
  });
  const includedSections = mapAgentIncludedSectionsToStored(merged.includedSections);
  const nextRunAt = merged.enabled
    ? computeNextRunAt({
        schedule: merged.schedule,
        weekday: merged.weekday,
        monthDay: merged.monthDay,
        sendMode: merged.sendMode,
        sendAt: merged.sendAt,
        timeZone: merged.timeZone,
      })
    : null;

  const row = await db.scheduled_reports.update({
    where: { id: existing.id },
    data: {
      name: merged.name,
      enabled: merged.enabled,
      schedule: merged.schedule,
      weekday: merged.weekday,
      month_day: merged.monthDay,
      send_mode: merged.sendMode,
      send_at: merged.sendAt,
      time_zone: merged.timeZone,
      period: merged.period,
      formats: merged.formats,
      included_sections: includedSections,
      next_run_at: nextRunAt,
      updated_at: new Date(),
    },
  });
  return mapScheduleRow(row as never);
}

export async function deleteAgentScheduledReport(
  db: DbClient,
  organizationId: string,
  userId: string,
  scheduleId: string,
): Promise<boolean> {
  const existing = await db.scheduled_reports.findFirst({
    where: {
      id: toDbId(scheduleId),
      organization_id: toDbId(organizationId),
      created_by_user_id: toDbId(userId),
      report_scope: "agent",
      target_user_id: toDbId(userId),
    },
    select: { id: true },
  });
  if (!existing) return false;
  await db.scheduled_reports.delete({ where: { id: existing.id } });
  return true;
}

export async function getScheduledReportForAgent(
  db: DbClient,
  organizationId: string,
  userId: string,
  scheduleId: string,
): Promise<ScheduledReportRecord | null> {
  const row = await db.scheduled_reports.findFirst({
    where: {
      id: toDbId(scheduleId),
      organization_id: toDbId(organizationId),
      created_by_user_id: toDbId(userId),
      report_scope: "agent",
      target_user_id: toDbId(userId),
    },
  });
  return row ? mapScheduleRow(row as never) : null;
}

export type ScheduledReportRunRecord = {
  id: string;
  scheduledReportId: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  summaryText: string | null;
  sentToEmail: string | null;
  sentFromEmail: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

function mapRunRow(row: {
  id: bigint;
  scheduled_report_id: bigint;
  status: string;
  period_start: Date;
  period_end: Date;
  period_label: string;
  summary_text: string | null;
  sent_to_email: string | null;
  sent_from_email: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}): ScheduledReportRunRecord {
  return {
    id: serializeEntityId(row.id),
    scheduledReportId: serializeEntityId(row.scheduled_report_id),
    status: row.status,
    periodStart: row.period_start.toISOString(),
    periodEnd: row.period_end.toISOString(),
    periodLabel: row.period_label,
    summaryText: row.summary_text,
    sentToEmail: row.sent_to_email,
    sentFromEmail: row.sent_from_email,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listScheduledReportRuns(
  db: DbClient,
  organizationId: string,
  userId: string,
  scheduleId?: string,
  reportScope: ReportScope = "organization",
): Promise<ScheduledReportRunRecord[]> {
  const rows = await db.scheduled_report_runs.findMany({
    where: {
      organization_id: toDbId(organizationId),
      scheduled_reports: {
        created_by_user_id: toDbId(userId),
        report_scope: reportScope,
        ...(scheduleId ? { id: toDbId(scheduleId) } : {}),
      },
    },
    orderBy: { created_at: "desc" },
    take: 50,
  });
  return rows.map((row) => mapRunRow(row as never));
}

function formatReportSendAtLabel(sendAt: string): string {
  const [hh = "08", mm = "00"] = (sendAt || "08:00").split(":");
  const hour = Number(hh);
  const minute = Number(mm);
  const normalizedHour = Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 8;
  const normalizedMinute = Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0;
  const suffix = normalizedHour >= 12 ? "PM" : "AM";
  const hour12 = normalizedHour % 12 === 0 ? 12 : normalizedHour % 12;
  return `${String(hour12).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")} ${suffix}`;
}

export function buildScheduledReportFileName(
  scheduleName: string,
  periodLabel: string,
  sendAt: string,
): string {
  const datePart = periodLabel.replace(/\s*\([^)]+\)\s*$/, "").trim();
  const timePart = formatReportSendAtLabel(sendAt).replace(":", "-");
  const base = `${scheduleName.trim()} ${datePart} ${timePart}`;
  const safe = base
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `${safe || "scheduled-report"}.pdf`;
}

export async function getScheduledReportRunPdf(
  db: DbClient,
  organizationId: string,
  userId: string,
  runId: string,
  reportScope: ReportScope = "organization",
): Promise<{ buffer: Buffer; fileName: string; periodLabel: string } | null> {
  const row = await db.scheduled_report_runs.findFirst({
    where: {
      id: toDbId(runId),
      organization_id: toDbId(organizationId),
      status: { in: ["succeeded", "manual_succeeded"] },
      scheduled_reports: {
        created_by_user_id: toDbId(userId),
        report_scope: reportScope,
      },
    },
    select: {
      pdf_path: true,
      pdf_bytes: true,
      period_label: true,
      scheduled_reports: {
        select: { name: true, send_at: true },
      },
    },
  });
  if (!row) return null;

  let buffer: Buffer | null = null;
  if (row.pdf_path) {
    try {
      buffer = await readScheduledReportPdf(row.pdf_path);
    } catch {
      buffer = null;
    }
  }
  if (!buffer && row.pdf_bytes) {
    buffer = Buffer.from(row.pdf_bytes);
  }
  if (!buffer) return null;

  return {
    buffer,
    fileName: buildScheduledReportFileName(
      row.scheduled_reports.name,
      row.period_label,
      row.scheduled_reports.send_at,
    ),
    periodLabel: row.period_label,
  };
}

export async function getScheduledReportRunPdfById(
  db: DbClient,
  organizationId: string,
  runId: string,
): Promise<{ buffer: Buffer; fileName: string; periodLabel: string } | null> {
  const row = await db.scheduled_report_runs.findFirst({
    where: {
      id: toDbId(runId),
      organization_id: toDbId(organizationId),
      status: { in: ["succeeded", "manual_succeeded"] },
    },
    select: {
      pdf_path: true,
      pdf_bytes: true,
      period_label: true,
      scheduled_reports: {
        select: { name: true, send_at: true },
      },
    },
  });
  if (!row) return null;

  let buffer: Buffer | null = null;
  if (row.pdf_path) {
    try {
      buffer = await readScheduledReportPdf(row.pdf_path);
    } catch {
      buffer = null;
    }
  }
  if (!buffer && row.pdf_bytes) {
    buffer = Buffer.from(row.pdf_bytes);
  }
  if (!buffer) return null;

  return {
    buffer,
    fileName: buildScheduledReportFileName(
      row.scheduled_reports.name,
      row.period_label,
      row.scheduled_reports.send_at,
    ),
    periodLabel: row.period_label,
  };
}

export async function logExportAudit(
  db: DbClient,
  input: {
    exportedByUserId: string;
    exportedByEmail: string;
    format: string;
    rowCount: number;
    fileName: string;
  },
): Promise<void> {
  await db.export_audit_logs.create({
    data: {
      exported_by_email: input.exportedByEmail,
      exported_by_role: "admin",
      format: input.format,
      scope: "scheduled_report",
      row_count: input.rowCount,
      file_name: input.fileName,
      exported_by_user_id: toDbId(input.exportedByUserId),
    },
  });
}
