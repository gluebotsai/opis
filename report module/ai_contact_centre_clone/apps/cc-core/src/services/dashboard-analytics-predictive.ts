import type { DbClient } from "../lib/rls.js";
import { serializeEntityIdOptional } from "../lib/id-schema.js";
import {
  DASHBOARD_ANALYTICS_SCHEMA_VERSION,
  DEFAULT_ANALYTICS_TIMEZONE,
  FORECAST_CONFIG,
  addUtcDays,
  addUtcHours,
  clamp,
  formatShortDateLabel,
  hashInput,
  hourFromIso,
  hourInTimeZone,
  hourRangeLabel,
  median,
  peakHourOfDay,
  resolveAnalyticsTimeZone,
  startOfUtcDay,
  weekdayHourKey,
} from "./dashboard-analytics-math.js";
import { fetchForecastAdjustment } from "./dashboard-analytics-nlp.js";
import {
  getLatestForecastRun,
  listRecentForecastRuns,
  saveForecastRun,
  type StoredForecastRun,
} from "./dashboard-analytics-storage.js";
import type {
  ForecastChartPoint,
  HourlyVolumeEvidence,
  PredictiveAnalytics,
  PredictiveRiskSignal,
  PredictiveSummary,
} from "./dashboard-analytics-types.js";

type ArrivalRow = {
  created_at: Date;
  channel: string;
  queue_id: string | null;
  queue_name: string | null;
};

type MissedRateRow = {
  day: Date;
  missed_rate: number | null;
};

type HourlyForecastPoint = {
  bucketStart: string;
  channel: string;
  queueId: string | null;
  queueName: string | null;
  low: number;
  expected: number;
  high: number;
};

export type { HourlyForecastPoint };

export function emptyHourlyVolume(
  timeZone: string = DEFAULT_ANALYTICS_TIMEZONE,
): HourlyVolumeEvidence {
  return {
    points: [],
    peakHour: null,
    observedPeakHour: null,
    timeZone: resolveAnalyticsTimeZone(timeZone),
    source: "historical_actual",
    windowDays: 7,
    supportingHours: [],
  };
}

export async function loadAnalyticsTimeZone(
  db: DbClient,
  organizationId: string,
): Promise<string> {
  const rows = await db.$queryRawUnsafe<Array<{ timezone: string | null }>>(
    `
    SELECT COALESCE(
      (
        SELECT location.timezone
        FROM accounts.organization_locations location
        WHERE location.organization_id = $1::bigint
          AND location.status = 'active'
          AND location.timezone IS NOT NULL
          AND btrim(location.timezone) <> ''
        ORDER BY location.is_primary DESC, location.id
        LIMIT 1
      ),
      (
        SELECT hours.timezone
        FROM accounts.setup_business_hours hours
        WHERE hours.organization_id = $1::bigint
          AND hours.status = 'active'
          AND hours.timezone IS NOT NULL
          AND btrim(hours.timezone) <> ''
        ORDER BY hours.id
        LIMIT 1
      ),
      $2
    ) AS timezone
    `,
    organizationId,
    DEFAULT_ANALYTICS_TIMEZONE,
  );
  return resolveAnalyticsTimeZone(rows[0]?.timezone);
}

export function buildHourlyVolumeEvidence(
  arrivals: Array<{ created_at: Date }>,
  forecastPoints: Array<{ bucketStart: string; expected: number }>,
  today: Date,
  timeZone: string = DEFAULT_ANALYTICS_TIMEZONE,
): HourlyVolumeEvidence {
  const zone = resolveAnalyticsTimeZone(timeZone);
  const todayStart = startOfUtcDay(today);
  const recentStart = addUtcDays(todayStart, -7);
  const actualByHour = Array.from({ length: 24 }, () => 0);
  for (const arrival of arrivals) {
    if (arrival.created_at < recentStart) continue;
    const hour = hourInTimeZone(arrival.created_at, zone);
    actualByHour[hour] = (actualByHour[hour] ?? 0) + 1;
  }
  const expectedByHour = Array.from({ length: 24 }, () => 0);
  for (const point of forecastPoints) {
    const hour = hourFromIso(point.bucketStart, zone);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    expectedByHour[hour] = (expectedByHour[hour] ?? 0) + point.expected;
  }
  const points: ForecastChartPoint[] = actualByHour.map((actual, hour) => ({
    label: hourRangeLabel(hour),
    actual,
    forecast: Math.round(expectedByHour[hour] ?? 0),
  }));
  const forecastPeak = peakHourOfDay(expectedByHour);
  const observedPeakHour = peakHourOfDay(actualByHour);
  const peakHour = forecastPeak ?? observedPeakHour;
  const peakHourIndex = peakHour ? Number(peakHour.slice(0, 2)) : Number.NaN;
  const supportingHours = points.filter(
    (_point, hour) => Number.isInteger(peakHourIndex) && Math.abs(hour - peakHourIndex) <= 2,
  );
  return {
    points,
    peakHour,
    observedPeakHour,
    timeZone: zone,
    source: forecastPeak ? "forecast_expected" : "historical_actual",
    windowDays: 7,
    supportingHours,
  };
}

export async function buildHourlyVolumeChart(
  db: DbClient,
  organizationId: string,
  forecastPoints: HourlyForecastPoint[],
  timeZone?: string,
): Promise<HourlyVolumeEvidence> {
  const zone = timeZone ?? (await loadAnalyticsTimeZone(db, organizationId));
  const today = startOfUtcDay(new Date());
  const arrivals = await loadArrivals(db, organizationId, addUtcDays(today, -7));
  return buildHourlyVolumeEvidence(arrivals, forecastPoints, today, zone);
}

function emptyPredictive(timeZone: string = DEFAULT_ANALYTICS_TIMEZONE): PredictiveAnalytics {
  return {
    forecastVersion: "none",
    generatedAt: new Date().toISOString(),
    historyDays: FORECAST_CONFIG.historyDays,
    horizon: "7d",
    method: "seasonal_baseline_plus_llm_adjustment",
    summary: {
      expectedContacts: 0,
      peakDay: null,
      peakHour: null,
      busiestChannel: null,
      busiestQueue: null,
    },
    volumeForecast: [],
    missedRateForecast: [],
    hourlyVolume: emptyHourlyVolume(timeZone),
    risks: [],
    source: "baseline",
  };
}

async function loadArrivals(
  db: DbClient,
  organizationId: string,
  since: Date,
): Promise<ArrivalRow[]> {
  return db.$queryRawUnsafe<ArrivalRow[]>(
    `
    SELECT
      c.created_at,
      c.channel,
      c.queue_id::text AS queue_id,
      q.name AS queue_name
    FROM ccass.conversations c
    LEFT JOIN ccass.queues q
      ON q.id = c.queue_id
     AND q.organization_id = c.organization_id
    WHERE c.organization_id = $1::bigint
      AND c.created_at >= $2::timestamptz
    `,
    organizationId,
    since.toISOString(),
  );
}

async function loadMissedRates(
  db: DbClient,
  organizationId: string,
  since: Date,
): Promise<MissedRateRow[]> {
  return db.$queryRawUnsafe<MissedRateRow[]>(
    `
    SELECT
      date_trunc('day', amc.missed_at) AS day,
      CASE
        WHEN COUNT(DISTINCT c.id) > 0
        THEN (COUNT(DISTINCT amc.conversation_id)::float / COUNT(DISTINCT c.id)::float) * 100
        ELSE NULL
      END AS missed_rate
    FROM ccass.agent_missed_contacts amc
    LEFT JOIN ccass.conversations c
      ON c.organization_id = amc.organization_id
     AND c.queued_at IS NOT NULL
     AND date_trunc('day', c.queued_at) = date_trunc('day', amc.missed_at)
    WHERE amc.organization_id = $1::bigint
      AND amc.missed_at >= $2::timestamptz
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    organizationId,
    since.toISOString(),
  );
}

function buildWeekdayHourProfile(arrivals: ArrivalRow[]): Map<string, number[]> {
  const profile = new Map<string, number[]>();
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (const weekday of weekdays) {
    profile.set(weekday, Array.from({ length: 24 }, () => 0));
  }
  for (const arrival of arrivals) {
    const weekday = weekdays[arrival.created_at.getUTCDay()]!;
    const hour = arrival.created_at.getUTCHours();
    const values = profile.get(weekday)!;
    values[hour] = (values[hour] ?? 0) + 1;
  }
  for (const [weekday, values] of profile.entries()) {
    const counts = arrivals.filter(
      (arrival) => weekdays[arrival.created_at.getUTCDay()] === weekday,
    );
    const weeks = new Set(
      counts.map(
        (arrival) =>
          `${arrival.created_at.getUTCFullYear()}-${arrival.created_at.getUTCMonth()}-${Math.floor(arrival.created_at.getUTCDate() / 7)}`,
      ),
    ).size;
    const divisor = Math.max(weeks, 1);
    profile.set(
      weekday,
      values.map((value) => Math.round((value / divisor) * 10) / 10),
    );
  }
  return profile;
}

function buildBaselineHourlyForecast(
  arrivals: ArrivalRow[],
  forecastStart: Date,
): HourlyForecastPoint[] {
  const profile = buildWeekdayHourProfile(arrivals);
  const channelShares = new Map<string, number>();
  const queueShares = new Map<string, { channel: string; queueName: string | null; share: number }>();
  const total = arrivals.length || 1;
  for (const arrival of arrivals) {
    channelShares.set(arrival.channel, (channelShares.get(arrival.channel) ?? 0) + 1);
    const queueKey = arrival.queue_id ?? `channel:${arrival.channel}`;
    const existing = queueShares.get(queueKey);
    queueShares.set(queueKey, {
      channel: arrival.channel,
      queueName: arrival.queue_name,
      share: (existing?.share ?? 0) + 1,
    });
  }

  const points: HourlyForecastPoint[] = [];
  for (let hourOffset = 0; hourOffset < FORECAST_CONFIG.horizonHours; hourOffset += 1) {
    const bucket = addUtcHours(forecastStart, hourOffset);
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const weekday = weekdays[bucket.getUTCDay()]!;
    const hour = bucket.getUTCHours();
    const expectedOrg = profile.get(weekday)?.[hour] ?? 0;
    const topQueues = [...queueShares.entries()]
      .sort((left, right) => right[1].share - left[1].share)
      .slice(0, 5);
    if (topQueues.length === 0) {
      points.push({
        bucketStart: bucket.toISOString(),
        channel: "all",
        queueId: null,
        queueName: null,
        low: Math.max(0, Math.round(expectedOrg * 0.85)),
        expected: Math.round(expectedOrg),
        high: Math.round(expectedOrg * 1.15),
      });
      continue;
    }
    for (const [queueKey, meta] of topQueues) {
      const queueId = queueKey.startsWith("channel:") ? null : queueKey;
      const share = meta.share / total;
      const expected = expectedOrg * share;
      points.push({
        bucketStart: bucket.toISOString(),
        channel: meta.channel,
        queueId,
        queueName: meta.queueName,
        low: Math.max(0, Math.round(expected * 0.85)),
        expected: Math.round(expected),
        high: Math.round(expected * 1.15),
      });
    }
  }
  return points;
}

function buildDailyTotals(points: HourlyForecastPoint[]): Array<{ date: string; value: number }> {
  const totals = new Map<string, number>();
  for (const point of points) {
    const date = point.bucketStart.slice(0, 10);
    totals.set(date, (totals.get(date) ?? 0) + point.expected);
  }
  return [...totals.entries()].map(([date, value]) => ({ date, value }));
}

function buildSummary(
  points: HourlyForecastPoint[],
  timeZone: string = DEFAULT_ANALYTICS_TIMEZONE,
): PredictiveSummary {
  const zone = resolveAnalyticsTimeZone(timeZone);
  const dailyTotals = buildDailyTotals(points);
  const peakDay = dailyTotals.sort((left, right) => right.value - left.value)[0]?.date ?? null;
  const expectedByHour = Array.from({ length: 24 }, () => 0);
  const channelTotals = new Map<string, number>();
  const queueTotals = new Map<string, { id: string; name: string; value: number }>();
  for (const point of points) {
    const hour = hourFromIso(point.bucketStart, zone);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      expectedByHour[hour] = (expectedByHour[hour] ?? 0) + point.expected;
    }
    channelTotals.set(point.channel, (channelTotals.get(point.channel) ?? 0) + point.expected);
    if (point.queueId) {
      const existing = queueTotals.get(point.queueId);
      queueTotals.set(point.queueId, {
        id: point.queueId,
        name: point.queueName ?? `Queue ${point.queueId}`,
        value: (existing?.value ?? 0) + point.expected,
      });
    }
  }
  const busiestChannel =
    [...channelTotals.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const busiestQueueEntry = [...queueTotals.values()].sort((left, right) => right.value - left.value)[0];
  return {
    expectedContacts: dailyTotals.reduce((sum, row) => sum + row.value, 0),
    peakDay,
    peakHour: peakHourOfDay(expectedByHour),
    busiestChannel,
    busiestQueue: busiestQueueEntry
      ? { id: busiestQueueEntry.id, name: busiestQueueEntry.name }
      : null,
  };
}

function buildStoredPredictionsByDay(
  historicalRuns: StoredForecastRun[],
  todayKey: string,
): Map<string, number> {
  const predictedByDay = new Map<string, number>();
  for (const run of historicalRuns) {
    const points = (run.forecastJson.points as HourlyForecastPoint[] | undefined) ?? [];
    for (const row of buildDailyTotals(points)) {
      const priorDay = addUtcDays(new Date(`${row.date}T00:00:00.000Z`), -1)
        .toISOString()
        .slice(0, 10);
      if (priorDay === run.forecastDate && row.date <= todayKey) {
        predictedByDay.set(row.date, row.value);
      }
    }
  }
  return predictedByDay;
}

function buildRetrospectivePrediction(
  arrivals: ArrivalRow[],
  targetDay: string,
): number | undefined {
  const targetDate = startOfUtcDay(new Date(`${targetDay}T00:00:00.000Z`));
  const historical = arrivals.filter((arrival) => arrival.created_at < targetDate);
  if (historical.length === 0) return undefined;
  const points = buildBaselineHourlyForecast(historical, targetDate);
  return buildDailyTotals(points).find((row) => row.date === targetDay)?.value;
}

function enumerateUtcDateKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  for (let cursor = startOfUtcDay(start); cursor <= end; cursor = addUtcDays(cursor, 1)) {
    keys.push(cursor.toISOString().slice(0, 10));
  }
  return keys;
}

function toVolumeChart(
  arrivals: ArrivalRow[],
  forecastPoints: HourlyForecastPoint[],
  historicalRuns: StoredForecastRun[],
  today: Date,
): ForecastChartPoint[] {
  const todayStart = startOfUtcDay(today);
  const todayKey = todayStart.toISOString().slice(0, 10);
  const actualByDay = new Map<string, number>();
  for (const arrival of arrivals) {
    const day = startOfUtcDay(arrival.created_at).toISOString().slice(0, 10);
    actualByDay.set(day, (actualByDay.get(day) ?? 0) + 1);
  }
  const futureForecastByDay = new Map(
    buildDailyTotals(forecastPoints).map((row) => [row.date, row.value]),
  );
  const storedPredictions = buildStoredPredictionsByDay(historicalRuns, todayKey);
  const futureKeys = [...futureForecastByDay.keys()].sort();
  const rangeEnd = futureKeys.at(-1)
    ? new Date(`${futureKeys.at(-1)}T00:00:00.000Z`)
    : addUtcDays(todayStart, FORECAST_CONFIG.horizonDays);
  return enumerateUtcDateKeys(addUtcDays(todayStart, -6), rangeEnd).map((date) => {
    const isPastOrToday = date <= todayKey;
    const actual = isPastOrToday ? (actualByDay.get(date) ?? 0) : undefined;
    let forecast: number | undefined;
    if (isPastOrToday) {
      forecast =
        storedPredictions.get(date) ??
        buildRetrospectivePrediction(arrivals, date);
    } else {
      forecast = futureForecastByDay.get(date);
    }
    return {
      label: formatShortDateLabel(new Date(`${date}T00:00:00.000Z`)),
      actual,
      forecast,
    };
  });
}

export async function buildVolumeForecastChart(
  db: DbClient,
  organizationId: string,
  forecastPoints: HourlyForecastPoint[],
): Promise<ForecastChartPoint[]> {
  const today = startOfUtcDay(new Date());
  const sinceDate = addUtcDays(today, -14).toISOString().slice(0, 10);
  const [arrivals, historicalRuns] = await Promise.all([
    loadArrivals(db, organizationId, addUtcDays(today, -FORECAST_CONFIG.historyDays)),
    listRecentForecastRuns(db, organizationId, sinceDate),
  ]);
  return toVolumeChart(arrivals, forecastPoints, historicalRuns, today);
}

function buildStoredMissedRatePredictions(
  historicalRuns: StoredForecastRun[],
  missedRates: MissedRateRow[],
  todayKey: string,
): Map<string, number> {
  const predictedByDay = new Map<string, number>();
  for (const run of historicalRuns) {
    const ratesUpToRun = missedRates
      .filter((row) => startOfUtcDay(row.day).toISOString().slice(0, 10) <= run.forecastDate)
      .map((row) => row.missed_rate ?? 0)
      .filter((value) => value > 0);
    if (ratesUpToRun.length === 0) continue;
    const predictedRate = Math.round(median(ratesUpToRun) * 10) / 10;
    const points = (run.forecastJson.points as HourlyForecastPoint[] | undefined) ?? [];
    for (const row of buildDailyTotals(points)) {
      const priorDay = addUtcDays(new Date(`${row.date}T00:00:00.000Z`), -1)
        .toISOString()
        .slice(0, 10);
      if (priorDay === run.forecastDate && row.date <= todayKey) {
        predictedByDay.set(row.date, predictedRate);
      }
    }
  }
  return predictedByDay;
}

function buildRetrospectiveMissedRatePrediction(
  missedRates: MissedRateRow[],
  targetDay: string,
): number | undefined {
  const priorRates = missedRates
    .filter((row) => startOfUtcDay(row.day).toISOString().slice(0, 10) < targetDay)
    .map((row) => row.missed_rate ?? 0)
    .filter((value) => value > 0);
  if (priorRates.length === 0) return undefined;
  return Math.round(median(priorRates) * 10) / 10;
}

function toMissedRateChart(
  missedRates: MissedRateRow[],
  forecastPoints: HourlyForecastPoint[],
  historicalRuns: StoredForecastRun[],
  today: Date,
): ForecastChartPoint[] {
  const todayKey = startOfUtcDay(today).toISOString().slice(0, 10);
  const actualByDay = new Map<string, number>();
  for (const row of missedRates) {
    if (row.missed_rate == null) continue;
    const day = startOfUtcDay(row.day).toISOString().slice(0, 10);
    actualByDay.set(day, Math.round(row.missed_rate * 10) / 10);
  }
  const recentMedian = median(
    missedRates.map((row) => row.missed_rate ?? 0).filter((value) => value > 0),
  );
  const roundedMedian = recentMedian > 0 ? Math.round(recentMedian * 10) / 10 : undefined;
  const futureForecastByDay = new Map<string, number>();
  for (const row of buildDailyTotals(forecastPoints)) {
    if (row.date > todayKey && roundedMedian != null) {
      futureForecastByDay.set(row.date, roundedMedian);
    }
  }
  const storedPredictions = buildStoredMissedRatePredictions(
    historicalRuns,
    missedRates,
    todayKey,
  );
  const labels = new Set<string>([
    ...actualByDay.keys(),
    ...futureForecastByDay.keys(),
    ...storedPredictions.keys(),
  ]);
  return [...labels]
    .sort()
    .slice(-9)
    .map((date) => {
      const actual = actualByDay.get(date);
      const isPastOrToday = date <= todayKey;
      let forecast: number | undefined;
      if (isPastOrToday) {
        forecast =
          storedPredictions.get(date) ??
          (actual != null ? buildRetrospectiveMissedRatePrediction(missedRates, date) : undefined);
      } else {
        forecast = futureForecastByDay.get(date);
      }
      return {
        label: formatShortDateLabel(new Date(`${date}T00:00:00.000Z`)),
        actual,
        forecast,
      };
    });
}

export async function buildMissedRateForecastChart(
  db: DbClient,
  organizationId: string,
  forecastPoints: HourlyForecastPoint[],
): Promise<ForecastChartPoint[]> {
  const today = startOfUtcDay(new Date());
  const sinceDate = addUtcDays(today, -14).toISOString().slice(0, 10);
  const [missedRates, historicalRuns] = await Promise.all([
    loadMissedRates(db, organizationId, addUtcDays(today, -14)),
    listRecentForecastRuns(db, organizationId, sinceDate),
  ]);
  return toMissedRateChart(missedRates, forecastPoints, historicalRuns, today);
}

function buildRiskSignals(
  points: HourlyForecastPoint[],
  adjustment: Awaited<ReturnType<typeof fetchForecastAdjustment>>,
): PredictiveRiskSignal[] {
  const risks: PredictiveRiskSignal[] = [];
  const peakWindows = adjustment?.peakWindows ?? [];
  for (const window of peakWindows.slice(0, 3)) {
    const risk = adjustment?.riskLabels?.find((label) => label.scopeId === window.scopeId);
    risks.push({
      tone: risk?.risk === "high" ? "high" : "medium",
      title: `Peak demand expected ${window.date}`,
      detail: `Forecast workload is concentrated between ${String(window.startHour).padStart(2, "0")}:00 and ${String(window.endHour).padStart(2, "0")}:00.`,
      queueId: window.scopeId ?? null,
      bucketStart: `${window.date}T${String(window.startHour).padStart(2, "0")}:00:00.000Z`,
    });
  }
  if (risks.length === 0) {
    const busiest = [...points].sort((left, right) => right.expected - left.expected)[0];
    if (busiest && busiest.expected >= 10) {
      risks.push({
        tone: busiest.expected >= 20 ? "high" : "medium",
        title: `${busiest.queueName ?? busiest.channel} workload likely`,
        detail: `Expected ${busiest.expected} contacts around ${busiest.bucketStart.slice(11, 16)} UTC.`,
        queueId: busiest.queueId,
        bucketStart: busiest.bucketStart,
      });
    }
  }
  return risks;
}

function applyAdjustment(
  points: HourlyForecastPoint[],
  adjustment: Awaited<ReturnType<typeof fetchForecastAdjustment>>,
): HourlyForecastPoint[] {
  if (!adjustment || adjustment.decision !== "adjust") return points;
  const multiplierByDate = new Map(
    (adjustment.organizationDailyMultipliers ?? []).map((row) => [row.date, row.multiplier]),
  );
  return points.map((point) => {
    const date = point.bucketStart.slice(0, 10);
    const hour = Number(point.bucketStart.slice(11, 13));
    const orgMultiplier = clamp(
      multiplierByDate.get(date) ?? 1,
      FORECAST_CONFIG.multiplierMin,
      FORECAST_CONFIG.multiplierMax,
    );
    const scopeAdjustment = (adjustment.scopeAdjustments ?? []).find(
      (row) =>
        row.date === date &&
        hour >= row.startHour &&
        hour < row.endHour &&
        (row.scopeId === point.queueId || row.scopeId === point.channel),
    );
    const multiplier = clamp(
      orgMultiplier * (scopeAdjustment?.multiplier ?? 1),
      FORECAST_CONFIG.multiplierMin,
      FORECAST_CONFIG.multiplierMax,
    );
    const expected = Math.round(point.expected * multiplier);
    return {
      ...point,
      low: Math.max(0, Math.round(expected * 0.85)),
      expected,
      high: Math.round(expected * 1.15),
    };
  });
}

function storedRunToPredictive(
  run: StoredForecastRun,
  arrivals: ArrivalRow[],
  missedRates: MissedRateRow[],
  historicalRuns: StoredForecastRun[],
  today: Date,
  timeZone: string,
): PredictiveAnalytics {
  const forecastPoints = (run.forecastJson.points as HourlyForecastPoint[] | undefined) ?? [];
  const hourlyVolume = buildHourlyVolumeEvidence(arrivals, forecastPoints, today, timeZone);
  const summary = {
    ...((run.summaryJson as PredictiveSummary | undefined) ?? buildSummary(forecastPoints, timeZone)),
    peakHour: hourlyVolume.peakHour,
  };
  return {
    forecastVersion: `volume-${run.forecastDate}`,
    generatedAt: run.generatedAt,
    historyDays: run.historyDays,
    horizon: "7d",
    method: run.method,
    summary,
    volumeForecast: toVolumeChart(arrivals, forecastPoints, historicalRuns, today),
    missedRateForecast: toMissedRateChart(
      missedRates,
      forecastPoints,
      historicalRuns,
      today,
    ),
    hourlyVolume,
    risks: (run.summaryJson.risks as PredictiveRiskSignal[] | undefined) ?? [],
    source: run.llmAdjustmentJson ? "nlp" : "baseline",
  };
}

export async function buildPredictiveAnalytics(
  db: DbClient,
  organizationId: string,
): Promise<{ analytics: PredictiveAnalytics; forecastRun: StoredForecastRun | null }> {
  const today = startOfUtcDay(new Date());
  const forecastDate = today.toISOString().slice(0, 10);
  const historyStart = addUtcDays(today, -FORECAST_CONFIG.historyDays);
  const forecastStart = addUtcDays(today, 1);
  const sinceDate = addUtcDays(today, -14).toISOString().slice(0, 10);
  const [arrivals, missedRates, cached, historicalRuns, timeZone] = await Promise.all([
    loadArrivals(db, organizationId, historyStart),
    loadMissedRates(db, organizationId, addUtcDays(today, -14)),
    getLatestForecastRun(db, organizationId, forecastDate),
    listRecentForecastRuns(db, organizationId, sinceDate),
    loadAnalyticsTimeZone(db, organizationId),
  ]);

  if (arrivals.length === 0) {
    return { analytics: emptyPredictive(timeZone), forecastRun: null };
  }

  if (cached) {
    return {
      analytics: storedRunToPredictive(cached, arrivals, missedRates, historicalRuns, today, timeZone),
      forecastRun: cached,
    };
  }

  const baselinePoints = buildBaselineHourlyForecast(arrivals, forecastStart);
  const profile = buildWeekdayHourProfile(arrivals);
  const dailyTotalsLast14 = Array.from({ length: 14 }, (_, index) => {
    const day = addUtcDays(today, -(13 - index));
    const key = day.toISOString().slice(0, 10);
    return arrivals.filter((arrival) => arrival.created_at.toISOString().slice(0, 10) === key).length;
  });
  const inputPayload = {
    history: {
      lookbackDays: FORECAST_CONFIG.historyDays,
      recentDays: 7,
      dailyTotalsLast14Days: dailyTotalsLast14,
      weekdayHourlyProfile: Object.fromEntries(profile.entries()),
    },
    baselineForecast: {
      dailyTotals: buildDailyTotals(baselinePoints),
    },
  };
  const inputHash = hashInput(inputPayload);
  const adjustment = await fetchForecastAdjustment(organizationId, inputPayload);
  const adjustedPoints = applyAdjustment(baselinePoints, adjustment);
  const summary = buildSummary(adjustedPoints, timeZone);
  const hourlyVolume = buildHourlyVolumeEvidence(arrivals, adjustedPoints, today, timeZone);
  summary.peakHour = hourlyVolume.peakHour;
  const risks = buildRiskSignals(adjustedPoints, adjustment);
  const generatedAt = new Date().toISOString();
  const volumeForecast = toVolumeChart(arrivals, adjustedPoints, historicalRuns, today);
  const missedRateForecast = toMissedRateChart(
    missedRates,
    adjustedPoints,
    historicalRuns,
    today,
  );
  const saved = await saveForecastRun(db, organizationId, {
    forecastDate,
    historyDays: FORECAST_CONFIG.historyDays,
    horizonHours: FORECAST_CONFIG.horizonHours,
    method: "seasonal_baseline_plus_llm_adjustment",
    status: "completed",
    inputHash,
    baselineJson: { points: baselinePoints, dailyTotals: buildDailyTotals(baselinePoints) },
    llmAdjustmentJson: adjustment ?? null,
    forecastJson: { points: adjustedPoints },
    summaryJson: {
      ...summary,
      risks,
      volumeForecast,
      missedRateForecast,
    },
    schemaVersion: DASHBOARD_ANALYTICS_SCHEMA_VERSION,
    validationStatus: adjustment ? "valid" : "baseline_only",
    generatedAt,
    modelName: adjustment?.modelName ?? null,
  });

  return {
    analytics: {
      forecastVersion: `volume-${forecastDate}`,
      generatedAt,
      historyDays: FORECAST_CONFIG.historyDays,
      horizon: "7d",
      method: saved.method,
      summary,
      volumeForecast,
      missedRateForecast,
      hourlyVolume,
      risks,
      source: adjustment?.decision === "adjust" ? "nlp" : "baseline",
    },
    forecastRun: saved,
  };
}

export function buildWeekdayHourKey(date: Date): string {
  return weekdayHourKey(date);
}

export function serializeForecastQueueId(queueId: string | null): string | null {
  return serializeEntityIdOptional(queueId);
}
