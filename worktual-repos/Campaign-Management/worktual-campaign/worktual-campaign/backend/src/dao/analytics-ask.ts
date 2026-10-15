// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced in plugins/prisma.ts
/**
 * Allowlisted Campaign analytics QueryPlan — no free-form SQL.
 * Answers NL KPI questions from dashboard counts + campaign list metrics.
 */
import type { CampaignSessionUser } from "../types/auth.js";
import {
  resolveCampaignDataScope,
  scopeAppliedLabel,
} from "../helpers/campaign-visibility.js";
import {
  getDashboardCountsDao,
  listCampaignsByBucketDao,
  type ListCampaignsOptions,
} from "./campaign.js";
import { aggregatePortfolioFromListItems } from "./portfolio-metrics.js";

export type AnalyticsPeriod = {
  relative?: "today" | "yesterday" | "last_7_days" | "last_30_days" | "last_month" | null;
  fromDate?: string | null;
  toDate?: string | null;
};

export type SemanticMetricResult = {
  ok: true;
  metric_id: string;
  rows: Array<Record<string, unknown>>;
};

function rate(num: number, den: number): number | null {
  if (!den || den <= 0) return null;
  return num / den;
}

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftLocalDate(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

type MetricKind =
  | "status_counts"
  | "monitoring_tab_counts"
  | "status_pie"
  | "campaigns_ran"
  | "sent"
  | "failed"
  | "opens"
  | "clicks"
  | "open_rate"
  | "click_rate"
  | "delivery_rate"
  | "portfolio";

export const ALLOWED_ANALYTICS_METRICS: readonly MetricKind[] = [
  "status_counts",
  "monitoring_tab_counts",
  "status_pie",
  "campaigns_ran",
  "sent",
  "failed",
  "opens",
  "clicks",
  "open_rate",
  "click_rate",
  "delivery_rate",
  "portfolio",
];

/** LLM-supplied metric ids only — no NL regex planning. */
export function normalizeAnalyticsMetrics(raw: unknown): MetricKind[] {
  const allowed = new Set<string>(ALLOWED_ANALYTICS_METRICS);
  if (!Array.isArray(raw) || !raw.length) {
    return ["portfolio"];
  }
  const out: MetricKind[] = [];
  for (const item of raw) {
    const k = String(item || "")
      .trim()
      .toLowerCase();
    if (!allowed.has(k)) continue;
    const kind = k as MetricKind;
    if (!out.includes(kind)) out.push(kind);
  }
  return out.length ? out : ["portfolio"];
}

function portfolioFromRows(rows: Awaited<ReturnType<typeof listCampaignsByBucketDao>>) {
  const t = aggregatePortfolioFromListItems(rows, { excludePpcOnly: true });
  return {
    sent: t.sent,
    failed: t.failed,
    delivered: t.delivered,
    opens: t.opens,
    clicks: t.clicks,
    campaigns: t.campaigns_ran,
    campaigns_ran: t.campaigns_ran,
    campaigns_with_send: t.campaigns_with_send,
    campaigns_with_failure: t.campaigns_with_failure,
    open_rate: t.open_rate,
    click_rate: t.click_rate,
    live: t.live_count,
    scheduled: t.scheduled_count,
    draft: t.draft_count,
    past: t.completed_count,
  };
}

function toListOpts(
  period: AnalyticsPeriod,
  relative: AnalyticsPeriod["relative"],
): ListCampaignsOptions {
  if (relative === "last_30_days") {
    const today = istToday();
    return {
      bucket: "all",
      fromDate: shiftLocalDate(today, -29),
      toDate: today,
      lite: false,
    };
  }
  const rel =
    relative === "today" ||
    relative === "yesterday" ||
    relative === "last_7_days" ||
    relative === "last_month"
      ? relative
      : period.relative === "today" ||
          period.relative === "yesterday" ||
          period.relative === "last_7_days" ||
          period.relative === "last_month"
        ? period.relative
        : null;
  if (period.fromDate || period.toDate) {
    return {
      bucket: "all",
      fromDate: period.fromDate || undefined,
      toDate: period.toDate || undefined,
      lite: false,
    };
  }
  if (!rel) {
    return { bucket: "all", lite: false };
  }
  return {
    bucket: "all",
    relative: rel,
    lite: false,
  };
}

export async function askCampaignAnalyticsDao(
  session: CampaignSessionUser,
  input: {
    query: string;
    period?: AnalyticsPeriod | null;
    metrics?: string[] | null;
  },
): Promise<{
  ok: boolean;
  query: string;
  plan: Record<string, unknown>;
  results: SemanticMetricResult[];
  source: "campaign_sql";
  error?: string;
}> {
  const query = String(input.query || "").trim();
  if (!query) {
    return {
      ok: false,
      query,
      plan: { source: "campaign_sql" },
      results: [],
      source: "campaign_sql",
      error: "query is required",
    };
  }

  const period = input.period || {};
  const relative = period.relative || null;
  const metrics = normalizeAnalyticsMetrics(input.metrics);
  const dataScope = resolveCampaignDataScope(session);
  const plan = {
    source: "campaign_sql",
    metrics,
    relative,
    fromDate: period.fromDate || null,
    toDate: period.toDate || null,
    scope_applied: dataScope,
    scope_label: scopeAppliedLabel(dataScope),
    caller_role: String(session.role || "").trim().toLowerCase() || "user",
  };

  const results: SemanticMetricResult[] = [];

  const needsList = metrics.some((m) =>
    [
      "sent",
      "failed",
      "opens",
      "clicks",
      "open_rate",
      "click_rate",
      "delivery_rate",
      "portfolio",
      "campaigns_ran",
    ].includes(m),
  );
  const needsStatus = metrics.some((m) =>
    [
      "status_counts",
      "monitoring_tab_counts",
      "status_pie",
      "portfolio",
    ].includes(m),
  );

  let totals = {
    sent: 0,
    failed: 0,
    delivered: 0,
    opens: 0,
    clicks: 0,
    campaigns: 0,
    campaigns_ran: 0,
    campaigns_with_send: 0,
    campaigns_with_failure: 0,
    open_rate: null as number | null,
    click_rate: null as number | null,
  };
  let listRows: Awaited<ReturnType<typeof listCampaignsByBucketDao>> = [];
  if (needsList) {
    listRows = await listCampaignsByBucketDao(
      session,
      toListOpts(period, relative),
    );
    const p = portfolioFromRows(listRows);
    totals = {
      sent: p.sent,
      failed: p.failed,
      delivered: p.delivered,
      opens: p.opens,
      clicks: p.clicks,
      campaigns: p.campaigns,
      campaigns_ran: p.campaigns_ran,
      campaigns_with_send: p.campaigns_with_send,
      campaigns_with_failure: p.campaigns_with_failure,
      open_rate: p.open_rate,
      click_rate: p.click_rate,
    };
  }

  // Monitoring tab badges (Live/Scheduled/Draft/Past) — always all-time, not period-filtered.
  let counts = {
    live: 0,
    scheduled: 0,
    draft: 0,
    past: 0,
    onDemand: 0,
    personalisedCrm: 0,
  };
  if (needsStatus) {
    counts = await getDashboardCountsDao(session);
  }
  const periodLabel =
    relative ||
    (period.fromDate && period.toDate
      ? `${period.fromDate}..${period.toDate}`
      : period.fromDate || period.toDate || null);

  for (const m of metrics) {
    if (
      m === "status_counts" ||
      m === "monitoring_tab_counts" ||
      m === "portfolio"
    ) {
      results.push({
        ok: true,
        metric_id: "campaign_status_counts",
        rows: [
          {
            live: counts.live,
            scheduled: counts.scheduled,
            draft: counts.draft,
            past_all_time: counts.past,
            on_demand: counts.onDemand,
            personalised_crm: counts.personalisedCrm,
            campaigns_ran_in_period: needsList ? totals.campaigns_ran : null,
            period_filter: periodLabel,
            _note:
              "past / past_all_time = Campaign monitoring Past tab (completed+cancelled, all time). " +
              "campaigns_ran_in_period = Overview period only (when present).",
          },
        ],
      });
    }
    if (m === "campaigns_ran" || m === "portfolio") {
      const ran =
        totals.campaigns_ran ??
        (needsList
          ? listRows.filter((r) => {
              const st = String(r.status || "").toLowerCase();
              return st === "completed" || st === "cancelled" || st === "live";
            }).length
          : null);
      results.push({
        ok: true,
        metric_id: "campaigns_ran",
        rows: [
          {
            campaigns_ran: ran,
            campaigns_with_send: totals.campaigns_with_send,
            campaigns_with_failure: totals.campaigns_with_failure,
            messages_sent: totals.sent,
            period_filter: periodLabel,
            past_all_time: counts.past,
          },
        ],
      });
    }
    if (m === "status_pie") {
      results.push({
        ok: true,
        metric_id: "campaign_status_share",
        rows: [
          { status: "live", count: counts.live },
          { status: "scheduled", count: counts.scheduled },
          { status: "draft", count: counts.draft },
          { status: "past", count: counts.past },
        ].filter((r) => r.count > 0),
      });
    }
    if (m === "sent" || m === "portfolio") {
      results.push({
        ok: true,
        metric_id: "campaign_sent_count",
        rows: [
          {
            campaigns_with_send: totals.campaigns_with_send,
            messages_sent: totals.sent,
          },
        ],
      });
    }
    if (m === "failed") {
      results.push({
        ok: true,
        metric_id: "campaign_failed_count",
        rows: [
          {
            campaigns_with_failure: totals.campaigns_with_failure,
            messages_failed: totals.failed,
          },
        ],
      });
    }
    if (m === "opens") {
      results.push({
        ok: true,
        metric_id: "campaign_opens",
        rows: [{ campaign_opens: totals.opens }],
      });
    }
    if (m === "clicks") {
      results.push({
        ok: true,
        metric_id: "campaign_clicks",
        rows: [{ campaign_clicks: totals.clicks }],
      });
    }
    if (m === "open_rate" || m === "portfolio") {
      results.push({
        ok: true,
        metric_id: "open_rate",
        rows: [
          {
            open_rate: totals.open_rate ?? rate(totals.opens, totals.delivered),
            opens: totals.opens,
            delivered: totals.delivered,
          },
        ],
      });
    }
    if (m === "click_rate" || m === "portfolio") {
      results.push({
        ok: true,
        metric_id: "click_rate",
        rows: [
          {
            click_rate:
              totals.click_rate ?? rate(totals.clicks, totals.delivered),
            clicks: totals.clicks,
            delivered: totals.delivered,
          },
        ],
      });
    }
    if (m === "delivery_rate") {
      const attempted = totals.sent + totals.failed;
      results.push({
        ok: true,
        metric_id: "delivery_rate",
        rows: [
          {
            delivery_rate: rate(totals.delivered, attempted || totals.sent),
            delivered: totals.delivered,
            sent: totals.sent,
          },
        ],
      });
    }
  }

  const seen = new Set<string>();
  const deduped: SemanticMetricResult[] = [];
  for (const r of results) {
    if (seen.has(r.metric_id)) continue;
    seen.add(r.metric_id);
    if (!r.rows?.length) continue;
    deduped.push(r);
  }

  return {
    ok: deduped.length > 0,
    query,
    plan,
    results: deduped,
    source: "campaign_sql",
    error: deduped.length ? undefined : "no metrics matched",
  };
}
