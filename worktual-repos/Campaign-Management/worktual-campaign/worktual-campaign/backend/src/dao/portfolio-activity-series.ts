// @ts-nocheck
/**
 * Event-time daily activity (send / fail / open / click) — IST buckets.
 */
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import {
  campaignTenantWhere,
  resolveCampaignDataScope,
  scopeAppliedLabel,
} from "../helpers/campaign-visibility.js";
import { utcFromLocalParts } from "../helpers/campaign-timezone.js";
import { fetchActivitySeriesSql } from "./portfolio-activity-series-sql.js";
import { cacheGet, cacheSet } from "../plugins/redis.js";
import {
  dashboardMetricsCacheVersion,
  portfolioActivitySeriesCacheKey,
  PORTFOLIO_ACTIVITY_SERIES_CACHE_TTL,
} from "../helpers/dashboard-metrics-cache.js";

const SERIES_TZ = "Asia/Kolkata";

function istTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SERIES_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftYmd(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function resolveActivitySeriesYmdBounds(input: {
  relative?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}): { fromYmd: string; toYmd: string } {
  const today = istTodayYmd();
  let fromYmd = input.fromDate?.trim() || "";
  let toYmd = input.toDate?.trim() || "";
  const rel = String(input.relative || "").trim().toLowerCase();
  if (rel === "today") {
    fromYmd = today;
    toYmd = today;
  } else if (rel === "yesterday") {
    fromYmd = shiftYmd(today, -1);
    toYmd = fromYmd;
  } else if (rel === "last_7_days") {
    fromYmd = shiftYmd(today, -6);
    toYmd = today;
  } else if (rel === "last_30_days") {
    fromYmd = shiftYmd(today, -29);
    toYmd = today;
  } else if (rel === "last_month") {
    const [y, m] = today.split("-").map(Number);
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
    fromYmd = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
    toYmd = `${prevY}-${String(prevM).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }
  if (!fromYmd) fromYmd = shiftYmd(today, -6);
  if (!toYmd) toYmd = today;
  if (fromYmd > toYmd) {
    const t = fromYmd;
    fromYmd = toYmd;
    toYmd = t;
  }
  return { fromYmd, toYmd };
}

function ymdToIstWindow(fromYmd: string, toYmd: string) {
  const start =
    utcFromLocalParts(fromYmd, "00:00", SERIES_TZ) ?? new Date(0);
  const endDay =
    utcFromLocalLocalEnd(toYmd, SERIES_TZ) ?? new Date();
  return { start, end: endDay };
}

function utcFromLocalLocalEnd(ymd: string, tz: string): Date | null {
  const next = shiftYmd(ymd, 1);
  const nextStart = utcFromLocalParts(next, "00:00", tz);
  if (!nextStart) return null;
  return new Date(nextStart.getTime() - 1);
}

function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${ymd}T12:00:00`));
}

function emptyDay(ymd: string) {
  return {
    date: ymd,
    label: dayLabel(ymd),
    sent: 0,
    failed: 0,
    opens: 0,
    clicks: 0,
  };
}

function enumerateDays(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  let cur = fromYmd;
  while (cur <= toYmd) {
    out.push(cur);
    cur = shiftYmd(cur, 1);
    if (out.length > 366) break;
  }
  return out;
}

export async function getPortfolioActivitySeriesDao(
  session: CampaignSessionUser,
  input: {
    relative?: string | null;
    fromDate?: string | null;
    toDate?: string | null;
    allowedChannels?: Set<string> | null;
  },
): Promise<Record<string, unknown>> {
  const { fromYmd, toYmd } = resolveActivitySeriesYmdBounds(input);
  const { start, end } = ymdToIstWindow(fromYmd, toYmd);
  const tenant = campaignTenantWhere(session);

  const campaigns = await prisma.campaign.findMany({
    where: tenant,
    select: { id: true },
  });
  const campaignIds = campaigns.map((c) => c.id);
  const byDate = new Map(
    enumerateDays(fromYmd, toYmd).map((d) => [d, emptyDay(d)]),
  );

  if (!campaignIds.length) {
    return {
      as_of: new Date().toISOString(),
      timezone: SERIES_TZ,
      from_date: fromYmd,
      to_date: toYmd,
      series: [...byDate.values()],
      scope_applied: resolveCampaignDataScope(session),
      scope_label: scopeAppliedLabel(resolveCampaignDataScope(session)),
    };
  }

  const allowed = input.allowedChannels;
  const channelsKey = allowed?.size
    ? [...allowed].sort().join(",")
    : "all";
  const ver = await dashboardMetricsCacheVersion(session.organizationId);
  const cacheKey = portfolioActivitySeriesCacheKey({
    orgId: session.organizationId,
    fromYmd,
    toYmd,
    channelsKey,
    version: ver,
  });
  const cached = await cacheGet(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as Record<string, unknown>;
    } catch {
      /* recompute */
    }
  }

  const sqlAgg = await fetchActivitySeriesSql({
    session,
    start,
    end,
    allowedChannels: allowed,
  });
  for (const [day, row] of byDate) {
    const sf = sqlAgg.sentFailedByDay.get(day);
    row.sent = sf?.sent ?? 0;
    row.failed = sf?.failed ?? 0;
    row.opens = sqlAgg.opensByDay.get(day) ?? 0;
    row.clicks = sqlAgg.clicksByDay.get(day) ?? 0;
  }

  const payload = {
    as_of: new Date().toISOString(),
    timezone: SERIES_TZ,
    from_date: fromYmd,
    to_date: toYmd,
    series: [...byDate.values()],
    scope_applied: resolveCampaignDataScope(session),
    scope_label: scopeAppliedLabel(resolveCampaignDataScope(session)),
  };
  try {
    await cacheSet(
      cacheKey,
      JSON.stringify(payload),
      PORTFOLIO_ACTIVITY_SERIES_CACHE_TTL,
    );
  } catch {
    /* cache best-effort */
  }
  return payload;
}
