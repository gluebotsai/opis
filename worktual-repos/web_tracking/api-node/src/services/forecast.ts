import type { ForecastSeries, RollupPoint } from "../types/insights.js";

function movingAverage(values: number[], window: number): number {
  if (!values.length) return 0;
  const slice = values.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function linearTrend(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function projectValues(history: number[], horizon: number): number[] {
  if (history.length < 2) return Array(horizon).fill(history[0] ?? 0);
  const base = movingAverage(history, Math.min(7, history.length));
  const slope = linearTrend(history);
  const startIdx = history.length;
  return Array.from({ length: horizon }, (_, i) => {
    const projected = base + slope * (startIdx + i - (history.length - 1));
    return Math.max(0, Math.round(projected * 100) / 100);
  });
}

function formatFutureLabel(grain: ForecastSeries["grain"], index: number, lastKey: string): string {
  const d = new Date(lastKey);
  if (Number.isNaN(d.getTime())) return `+${index + 1}`;
  if (grain === "daily") {
    d.setDate(d.getDate() + index + 1);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (grain === "weekly") {
    d.setDate(d.getDate() + (index + 1) * 7);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  d.setMonth(d.getMonth() + index + 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function buildForecastSeries(
  rollups: RollupPoint[],
  grain: ForecastSeries["grain"],
  horizon: number,
  horizonLabel: string,
  valueKey: "visitors" | "bounce_rate",
): ForecastSeries {
  if (rollups.length < 7) {
    return {
      grain,
      labels: rollups.map((r) => r.label),
      actual: rollups.map((r) => r[valueKey]),
      forecast: rollups.map(() => null),
      horizon_label: "Not enough history",
    };
  }

  const history = rollups.map((r) => Number(r[valueKey] ?? 0));
  const projected = projectValues(history, horizon);
  const lastKey = rollups[rollups.length - 1]?.date_key ?? new Date().toISOString().slice(0, 10);
  const futureLabels = Array.from({ length: horizon }, (_, i) =>
    formatFutureLabel(grain, i, lastKey),
  );

  return {
    grain,
    labels: [...rollups.map((r) => r.label), ...futureLabels],
    actual: [...history, ...Array(horizon).fill(null)],
    forecast: [...Array(history.length).fill(null), ...projected],
    horizon_label: horizonLabel,
  };
}

export function buildForecasts(
  period: string,
  daily: RollupPoint[],
  weekly: RollupPoint[],
  monthly: RollupPoint[],
): { volume: ForecastSeries; bounce: ForecastSeries } {
  if (period === "overall") {
    if (monthly.length >= 4) {
      return {
        volume: buildForecastSeries(monthly.slice(-6), "monthly", 3, "Next 3 months", "visitors"),
        bounce: buildForecastSeries(monthly.slice(-6), "monthly", 3, "Next 3 months", "bounce_rate"),
      };
    }
    return {
      volume: buildForecastSeries(weekly.slice(-12), "weekly", 4, "Next 4 weeks", "visitors"),
      bounce: buildForecastSeries(weekly.slice(-12), "weekly", 4, "Next 4 weeks", "bounce_rate"),
    };
  }

  if (period === "today") {
    return {
      volume: buildForecastSeries(daily.slice(-14), "daily", 3, "Next 3 days", "visitors"),
      bounce: buildForecastSeries(daily.slice(-14), "daily", 3, "Next 3 days", "bounce_rate"),
    };
  }

  const historyDays = period === "month" ? 30 : 21;
  return {
    volume: buildForecastSeries(daily.slice(-historyDays), "daily", 7, "Next 7 days", "visitors"),
    bounce: buildForecastSeries(daily.slice(-historyDays), "daily", 7, "Next 7 days", "bounce_rate"),
  };
}
