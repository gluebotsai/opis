import { type ClickHouseClient, chQuery, chQueryOne, type Row } from "../../plugins/clickhouse.js";
import {
  bounceRateGroupedQuery,
  bounceRateScalarQuery,
} from "../../utils/bounceRate.js";
import { buildForecasts } from "../../services/forecast.js";
import type {
  ComparisonMetric,
  InsightsSnapshot,
  RollupPoint,
  TopMover,
} from "../../types/insights.js";

function pctChange(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

function mapDaily(rows: Row[]): RollupPoint[] {
  return rows.map((r) => ({
    label: String(r.label ?? ""),
    date_key: String(r.date_key ?? ""),
    visitors: Number(r.visitors ?? 0),
    sessions: Number(r.sessions ?? 0),
    pageviews: Number(r.pageviews ?? 0),
    bounce_rate: Number(r.bounce_rate ?? 0),
  }));
}

export class InsightsRepository {
  async getDailyRollups(client: ClickHouseClient, websiteId: number, days = 30): Promise<RollupPoint[]> {
    const rows = await chQuery(
      client,
      `
      SELECT
        formatDateTime(d.day, '%b %d') AS label,
        toString(d.day) AS date_key,
        coalesce(v.visitors, 0) AS visitors,
        coalesce(s.sessions, 0) AS sessions,
        coalesce(p.pageviews, 0) AS pageviews,
        coalesce(s.bounce_rate, 0) AS bounce_rate
      FROM (
        SELECT toDate(today() - number) AS day
        FROM numbers({days:UInt32})
        ORDER BY day
      ) d
      LEFT JOIN (
        SELECT toDate(created_at) AS day,
               uniqExact(visitor_id) AS visitors,
               count() AS pageviews
        FROM fact_page_views
        WHERE website_id = {websiteId:UInt32}
          AND created_at >= today() - {days:UInt32}
        GROUP BY day
      ) p ON p.day = d.day
      LEFT JOIN (
        ${bounceRateGroupedQuery(
          "toDate(session_started_at)",
          " AND created_at >= today() - {days:UInt32}",
          " AND created_at >= today() - {days:UInt32}",
        )}
      ) s ON s.period_key = d.day
      LEFT JOIN (
        SELECT toDate(started_at) AS day,
               uniqExact(visitor_id) AS visitors
        FROM dim_sessions FINAL
        WHERE website_id = {websiteId:UInt32}
          AND started_at >= today() - {days:UInt32}
        GROUP BY day
      ) v ON v.day = d.day
      ORDER BY d.day
      `,
      { websiteId, days },
    );
    return mapDaily(rows);
  }

  async getWeeklyRollups(client: ClickHouseClient, websiteId: number, weeks = 12): Promise<RollupPoint[]> {
    const rows = await chQuery(
      client,
      `
      SELECT
        formatDateTime(w.week, '%b %d') AS label,
        toString(w.week) AS date_key,
        coalesce(v.visitors, 0) AS visitors,
        coalesce(s.sessions, 0) AS sessions,
        coalesce(p.pageviews, 0) AS pageviews,
        coalesce(s.bounce_rate, 0) AS bounce_rate
      FROM (
        SELECT toStartOfWeek(today() - (number * 7)) AS week
        FROM numbers({weeks:UInt32})
        ORDER BY week
      ) w
      LEFT JOIN (
        SELECT toStartOfWeek(created_at) AS week,
               count() AS pageviews
        FROM fact_page_views
        WHERE website_id = {websiteId:UInt32}
          AND created_at >= today() - ({weeks:UInt32} * 7)
        GROUP BY week
      ) p ON p.week = w.week
      LEFT JOIN (
        ${bounceRateGroupedQuery(
          "toStartOfWeek(session_started_at)",
          " AND created_at >= today() - ({weeks:UInt32} * 7)",
          " AND created_at >= today() - ({weeks:UInt32} * 7)",
        )}
      ) s ON s.period_key = w.week
      LEFT JOIN (
        SELECT toStartOfWeek(started_at) AS week,
               uniqExact(visitor_id) AS visitors
        FROM dim_sessions FINAL
        WHERE website_id = {websiteId:UInt32}
          AND started_at >= today() - ({weeks:UInt32} * 7)
        GROUP BY week
      ) v ON v.week = w.week
      ORDER BY w.week
      `,
      { websiteId, weeks },
    );
    return mapDaily(rows);
  }

  async getMonthlyRollups(client: ClickHouseClient, websiteId: number, months = 6): Promise<RollupPoint[]> {
    const rows = await chQuery(
      client,
      `
      SELECT
        formatDateTime(m.month, '%b %Y') AS label,
        toString(m.month) AS date_key,
        coalesce(v.visitors, 0) AS visitors,
        coalesce(s.sessions, 0) AS sessions,
        coalesce(p.pageviews, 0) AS pageviews,
        coalesce(s.bounce_rate, 0) AS bounce_rate
      FROM (
        SELECT toStartOfMonth(today() - (number * 31)) AS month
        FROM numbers({months:UInt32})
        ORDER BY month
      ) m
      LEFT JOIN (
        SELECT toStartOfMonth(created_at) AS month,
               count() AS pageviews
        FROM fact_page_views
        WHERE website_id = {websiteId:UInt32}
          AND created_at >= toStartOfMonth(today() - ({months:UInt32} * 31))
        GROUP BY month
      ) p ON p.month = m.month
      LEFT JOIN (
        ${bounceRateGroupedQuery(
          "toStartOfMonth(session_started_at)",
          " AND created_at >= toStartOfMonth(today() - ({months:UInt32} * 31))",
          " AND created_at >= toStartOfMonth(today() - ({months:UInt32} * 31))",
        )}
      ) s ON s.period_key = m.month
      LEFT JOIN (
        SELECT toStartOfMonth(started_at) AS month,
               uniqExact(visitor_id) AS visitors
        FROM dim_sessions FINAL
        WHERE website_id = {websiteId:UInt32}
          AND started_at >= toStartOfMonth(today() - ({months:UInt32} * 31))
        GROUP BY month
      ) v ON v.month = m.month
      ORDER BY m.month
      `,
      { websiteId, months },
    );
    return mapDaily(rows);
  }

  private async windowMetrics(
    client: ClickHouseClient,
    websiteId: number,
    startDaysAgo: number,
    endDaysAgo: number,
  ): Promise<{ visitors: number; sessions: number; pageviews: number; bounce_rate: number }> {
    const pageviewFilter =
      " AND created_at >= today() - {startDays:UInt32} AND created_at < today() - {endDays:UInt32}";
    const params = { websiteId, startDays: startDaysAgo, endDays: endDaysAgo };
    const [row, bounceRow] = await Promise.all([
      chQueryOne(
        client,
        `
      SELECT
        (SELECT uniqExact(visitor_id) FROM dim_sessions FINAL
         WHERE website_id = {websiteId:UInt32}
           AND started_at >= today() - {startDays:UInt32}
           AND started_at < today() - {endDays:UInt32}) AS visitors,
        (SELECT uniqExact(session_id) FROM dim_sessions FINAL
         WHERE website_id = {websiteId:UInt32}
           AND started_at >= today() - {startDays:UInt32}
           AND started_at < today() - {endDays:UInt32}) AS sessions,
        (SELECT count() FROM fact_page_views
         WHERE website_id = {websiteId:UInt32}
           AND created_at >= today() - {startDays:UInt32}
           AND created_at < today() - {endDays:UInt32}) AS pageviews
      `,
        params,
      ),
      chQueryOne(client, bounceRateScalarQuery(pageviewFilter, pageviewFilter), params),
    ]);
    return {
      visitors: Number(row?.visitors ?? 0),
      sessions: Number(row?.sessions ?? 0),
      pageviews: Number(row?.pageviews ?? 0),
      bounce_rate: Number(bounceRow?.bounce_rate ?? 0),
    };
  }

  private windowDays(period: string): [number, number] {
    if (period === "today") return [1, 0];
    if (period === "week") return [7, 0];
    if (period === "month") return [30, 0];
    return [30, 0];
  }

  async getComparison(
    client: ClickHouseClient,
    websiteId: number,
    period: string,
  ): Promise<ComparisonMetric[]> {
    const [currentDays] = this.windowDays(period);
    const current = await this.windowMetrics(client, websiteId, currentDays, 0);
    const prior = await this.windowMetrics(client, websiteId, currentDays * 2, currentDays);

    return [
      { metric: "visitors", ...this.comparePair(current.visitors, prior.visitors) },
      { metric: "sessions", ...this.comparePair(current.sessions, prior.sessions) },
      { metric: "pageviews", ...this.comparePair(current.pageviews, prior.pageviews) },
      { metric: "bounce_rate", ...this.comparePair(current.bounce_rate, prior.bounce_rate) },
    ];
  }

  private comparePair(current: number, prior: number): { current: number; prior: number; change_pct: number } {
    return { current, prior, change_pct: pctChange(current, prior) };
  }

  async getTopMovers(client: ClickHouseClient, websiteId: number, period: string): Promise<TopMover[]> {
    const [currentDays] = this.windowDays(period);
    const pages = await chQuery(
      client,
      `
      SELECT page_path AS name,
             countIf(created_at >= today() - {currentDays:UInt32}) AS current,
             countIf(created_at >= today() - {doubleDays:UInt32}
                     AND created_at < today() - {currentDays:UInt32}) AS prior
      FROM fact_page_views
      WHERE website_id = {websiteId:UInt32}
        AND created_at >= today() - {doubleDays:UInt32}
      GROUP BY page_path
      HAVING current > 0 OR prior > 0
      ORDER BY abs(current - prior) DESC
      LIMIT 5
      `,
      { websiteId, currentDays, doubleDays: currentDays * 2 },
    );

    const sources = await chQuery(
      client,
      `
      SELECT coalesce(nullIf(utm_source, ''), nullIf(referrer_domain, ''), 'direct') AS name,
             uniqExactIf(session_id, started_at >= today() - {currentDays:UInt32}) AS current,
             uniqExactIf(session_id, started_at >= today() - {doubleDays:UInt32}
                                   AND started_at < today() - {currentDays:UInt32}) AS prior
      FROM dim_sessions FINAL
      WHERE website_id = {websiteId:UInt32}
        AND started_at >= today() - {doubleDays:UInt32}
      GROUP BY name
      HAVING current > 0 OR prior > 0
      ORDER BY abs(current - prior) DESC
      LIMIT 5
      `,
      { websiteId, currentDays, doubleDays: currentDays * 2 },
    );

    const mapMover = (type: "page" | "source", rows: Row[]): TopMover[] =>
      rows.map((r) => {
        const current = Number(r.current ?? 0);
        const prior = Number(r.prior ?? 0);
        return {
          type,
          name: String(r.name ?? "unknown"),
          current,
          prior,
          change_pct: pctChange(current, prior),
        };
      });

    return [...mapMover("page", pages), ...mapMover("source", sources)].slice(0, 8);
  }

  detectPrimaryAnomaly(
    comparison: ComparisonMetric[],
    topMovers: TopMover[],
  ): InsightsSnapshot["primary_anomaly"] {
    const sorted = [...comparison].sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
    const top = sorted.find((m) => Math.abs(m.change_pct) >= 5);
    if (!top) return null;

    const topMover = topMovers[0];
    const driverHint = topMover
      ? `${topMover.type} "${topMover.name}" changed ${topMover.change_pct}%`
      : "Traffic pattern shift";

    return {
      metric: top.metric,
      change_pct: top.change_pct,
      driver_hint: driverHint,
    };
  }

  async buildSnapshot(
    client: ClickHouseClient,
    websiteId: number,
    period: string,
  ): Promise<InsightsSnapshot> {
    const [daily_rollups, weekly_rollups, monthly_rollups, comparison, top_movers] = await Promise.all([
      this.getDailyRollups(client, websiteId, 30),
      this.getWeeklyRollups(client, websiteId, 12),
      this.getMonthlyRollups(client, websiteId, 6),
      this.getComparison(client, websiteId, period),
      this.getTopMovers(client, websiteId, period),
    ]);

    const primary_anomaly = this.detectPrimaryAnomaly(comparison, top_movers);
    const forecasts = buildForecasts(period, daily_rollups, weekly_rollups, monthly_rollups);

    return {
      period,
      website_id: websiteId,
      generated_at: new Date().toISOString(),
      comparison,
      primary_anomaly,
      daily_rollups,
      weekly_rollups,
      monthly_rollups,
      top_movers,
      forecasts,
    };
  }
}

export const insightsRepository = new InsightsRepository();
