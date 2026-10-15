// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * B2B send-time optimizer — peak weekday/hour from past email opens.
 */

import { prisma } from "../plugins/prisma.js";

const DEFAULT_TZ = "Asia/Kolkata";
const LOOKBACK_DAYS = 90;
const MIN_OPENS = 5;
const BUSINESS_START = 9;
const BUSINESS_END = 18; // exclusive
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
] as const;

export type SendTimeBucket = {
  weekday: number; // 0=Mon .. 4=Fri
  weekday_name: string;
  hour: number;
  opens: number;
  share_pct: number;
};

export type SendTimeInsight = {
  timezone: string;
  sample_opens: number;
  lookback_days: number;
  has_peak: boolean;
  peak_weekday: number | null;
  peak_weekday_name: string | null;
  peak_hour: number | null;
  peak_local_time: string | null;
  buckets: SendTimeBucket[];
  default_local_time: string;
  differs_from_default: boolean;
  reason: string;
};

function safeTz(raw: string | null | undefined): string {
  const t = String(raw || DEFAULT_TZ).trim() || DEFAULT_TZ;
  if (t === "UTC") return t;
  if (!/^[A-Za-z_]+\/[A-Za-z0-9_+\-]+$/.test(t)) return DEFAULT_TZ;
  try {
    Intl.DateTimeFormat("en-GB", { timeZone: t }).format(new Date());
    return t;
  } catch {
    return DEFAULT_TZ;
  }
}

/** Monday=0 … Sunday=6 from a YYYY-MM-DD calendar date. */
function calendarWeekdayMon0(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const dt = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  );
  const js = dt.getUTCDay();
  return js === 0 ? 6 : js - 1;
}

function localWeekdayHour(date: Date, tz: string): { weekday: number; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const wdRaw = parts.find((p) => p.type === "weekday")?.value || "";
    const hourRaw = parts.find((p) => p.type === "hour")?.value || "";
    const map: Record<string, number> = {
      Mon: 0,
      Tue: 1,
      Wed: 2,
      Thu: 3,
      Fri: 4,
      Sat: 5,
      Sun: 6,
    };
    const weekday = map[wdRaw];
    const hour = Number.parseInt(hourRaw, 10);
    if (weekday == null || !Number.isFinite(hour)) return null;
    return { weekday, hour };
  } catch {
    return null;
  }
}

export function getSendTimeInsightDao(
  organizationId: string,
  timezone?: string | null,
): Promise<SendTimeInsight> {
  return buildInsight(organizationId, timezone);
}

async function buildInsight(
  organizationId: string,
  timezone?: string | null,
): Promise<SendTimeInsight> {
  const tz = safeTz(timezone);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.campaignSendRecipient.findMany({
    where: { organizationId,
      openedAt: { not: null, gte: since },
    },
    select: { openedAt: true },
    take: 5000,
  });

  const counts = new Map<string, number>();
  let sample = 0;
  for (const row of rows) {
    if (!row.openedAt) continue;
    const local = localWeekdayHour(row.openedAt, tz);
    if (!local) continue;
    if (local.weekday > 4) continue;
    if (local.hour < BUSINESS_START || local.hour >= BUSINESS_END) continue;
    sample += 1;
    const key = `${local.weekday}:${local.hour}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const buckets: SendTimeBucket[] = [...counts.entries()]
    .map(([key, opens]) => {
      const [wd, hr] = key.split(":").map((n) => Number(n));
      return {
        weekday: wd,
        weekday_name: WEEKDAY_NAMES[wd] || String(wd),
        hour: hr,
        opens,
        share_pct: sample ? Math.round((opens / sample) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.opens - a.opens || a.weekday - b.weekday || a.hour - b.hour)
    .slice(0, 8);

  const peak = sample >= MIN_OPENS ? buckets[0] || null : null;
  const differs =
    Boolean(peak) && !(peak!.weekday === 0 && peak!.hour === BUSINESS_START);

  const reason = peak
    ? `Past ${sample} B2B email opens (last ${LOOKBACK_DAYS}d, ${tz}) peak on ${peak.weekday_name} ${String(peak.hour).padStart(2, "0")}:00 (${peak.share_pct}% of in-hours opens).`
    : `Not enough in-hours opens yet (need ${MIN_OPENS}+ in last ${LOOKBACK_DAYS}d). Default Mon–Fri ${String(BUSINESS_START).padStart(2, "0")}:00–${BUSINESS_END}:00 ${tz}.`;

  return {
    timezone: tz,
    sample_opens: sample,
    lookback_days: LOOKBACK_DAYS,
    has_peak: Boolean(peak),
    peak_weekday: peak ? peak.weekday : null,
    peak_weekday_name: peak ? peak.weekday_name : null,
    peak_hour: peak ? peak.hour : null,
    peak_local_time: peak
      ? `${String(peak.hour).padStart(2, "0")}:00`
      : null,
    buckets,
    default_local_time: `${String(BUSINESS_START).padStart(2, "0")}:00`,
    differs_from_default: differs,
    reason,
  };
}

export type ScheduledSendMismatch = {
  campaignId: string;
  campaignName: string;
  organizationId: string;
  userId: string;
  launchLocalDate: string | null;
  launchLocalTime: string | null;
  peakWeekdayName: string;
  peakLocalTime: string;
};

export async function listScheduledSendMismatchesDao(
  insightByTenant?: Map<string, SendTimeInsight>,
): Promise<ScheduledSendMismatch[]> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      status: { in: ["scheduled", "draft"] },
      OR: [
        { startsAt: { gt: new Date() } },
        { launchLocalDate: { not: null } },
      ],
    },
    select: {
      id: true,
      name: true,
      organizationId: true,
      createdByUserId: true,
      timezone: true,
      launchLocalDate: true,
      launchLocalTime: true,
      startsAt: true,
    },
    take: 200,
  });

  const out: ScheduledSendMismatch[] = [];
  const cache = insightByTenant || new Map<string, SendTimeInsight>();

  for (const c of campaigns) {
    const time = (c.launchLocalTime || "").trim();
    const date = (c.launchLocalDate || "").trim();
    if (!time && !c.startsAt) continue;

    let insight = cache.get(c.organizationId);
    if (!insight) {
      insight = await buildInsight(c.organizationId, c.timezone);
      cache.set(c.organizationId, insight);
    }
    if (!insight.has_peak || insight.peak_hour == null || insight.peak_weekday == null) {
      continue;
    }

    let hour = Number.NaN;
    let weekday: number | null = null;
    if (time && /^\d{1,2}:\d{2}/.test(time)) {
      hour = Number.parseInt(time.split(":")[0] || "", 10);
    }
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      weekday = calendarWeekdayMon0(date);
      if (weekday != null && weekday > 4) weekday = null;
    } else if (c.startsAt) {
      const local = localWeekdayHour(c.startsAt, insight.timezone);
      if (local) {
        weekday = local.weekday <= 4 ? local.weekday : null;
        if (!Number.isFinite(hour)) hour = local.hour;
      }
    }

    if (!Number.isFinite(hour)) continue;
    const hourDelta = Math.abs(hour - insight.peak_hour);
    const weekdayDiff = weekday != null && weekday !== insight.peak_weekday;
    if (hourDelta < 2 && !weekdayDiff) continue;

    out.push({
      campaignId: c.id,
      campaignName: c.name?.trim() || "Campaign",
      organizationId: c.organizationId,
      userId: c.createdByUserId,
      launchLocalDate: date || null,
      launchLocalTime: time || null,
      peakWeekdayName: insight.peak_weekday_name || "",
      peakLocalTime: insight.peak_local_time || "",
    });
  }

  return out;
}

export async function listTenantsWithEmailOpensDao(): Promise<
  Array<{ organizationId: string; timezone: string | null }>
> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.campaignSendRecipient.findMany({
    where: { openedAt: { not: null, gte: since } },
    select: { organizationId: true },
    distinct: ["organizationId"],
    take: 200,
  });
  const organizationIds = rows.map((r) => r.organizationId);
  if (!organizationIds.length) return [];

  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: { in: organizationIds } },
    select: { organizationId: true, timezone: true },
    distinct: ["organizationId"],
  });
  const tzByTenant = new Map(
    campaigns.map((c) => [c.organizationId, c.timezone || DEFAULT_TZ]),
  );
  return organizationIds.map((organizationId) => ({
    organizationId,
    timezone: tzByTenant.get(organizationId) || DEFAULT_TZ,
  }));
}
