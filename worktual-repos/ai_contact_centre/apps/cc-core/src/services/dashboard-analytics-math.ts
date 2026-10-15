import { createHash } from "node:crypto";

export const DASHBOARD_ANALYTICS_SCHEMA_VERSION = 1;
export const DASHBOARD_ANALYTICS_PROMPT_VERSION = "dashboard-analytics-v1";

export const DIAGNOSTIC_THRESHOLDS = {
  minUniqueMissed: 5,
  minRateDeltaPoints: 5,
  minRelativeMultiplier: 1.5,
  minRobustZScore: 3,
  persistenceBuckets: 2,
  lookbackDays: 56,
  bucketMinutes: 15,
} as const;

export const WEEKLY_DIAGNOSTIC_THRESHOLDS = {
  windowDays: 7,
  minThisWeekEvents: 10,
  minCountIncrease: 5,
  minCountMultiplier: 1.5,
  minRateDeltaPoints: 5,
} as const;

export const FORECAST_CONFIG = {
  historyDays: 56,
  horizonDays: 7,
  horizonHours: 168,
  multiplierMin: 0.75,
  multiplierMax: 1.25,
} as const;

export function hashInput(value: unknown): string {
  const normalized = JSON.stringify(value, (_key, current) => {
    if (Array.isArray(current)) {
      return [...current].sort((left, right) => {
        const leftKey = JSON.stringify(left);
        const rightKey = JSON.stringify(right);
        return leftKey.localeCompare(rightKey);
      });
    }
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return current;
  });
  return createHash("sha256").update(normalized).digest("hex");
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

export function mad(values: number[], center?: number): number {
  if (values.length === 0) return 0;
  const med = center ?? median(values);
  const deviations = values.map((value) => Math.abs(value - med));
  return median(deviations);
}

export function robustZScore(value: number, center: number, dispersion: number): number {
  if (dispersion <= 0) return value === center ? 0 : Number.POSITIVE_INFINITY;
  return (0.6745 * (value - center)) / dispersion;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) {
    return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder > 0 ? `${hours}h ${minuteRemainder}m` : `${hours}h`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatSignedDelta(value: number, unit = "percentage points"): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} ${unit} versus baseline`;
}

export function bucketStartIso(date: Date): string {
  const bucket = new Date(date);
  bucket.setUTCSeconds(0, 0);
  const minutes = bucket.getUTCMinutes();
  bucket.setUTCMinutes(Math.floor(minutes / DIAGNOSTIC_THRESHOLDS.bucketMinutes) * DIAGNOSTIC_THRESHOLDS.bucketMinutes);
  return bucket.toISOString();
}

export const DEFAULT_ANALYTICS_TIMEZONE = "Asia/Kolkata";

export function hourRangeLabel(hour: number): string {
  const start = String(Math.max(0, Math.min(23, hour))).padStart(2, "0");
  const end = String(Math.max(0, Math.min(24, hour + 1))).padStart(2, "0");
  return `${start}:00-${end}:00`;
}

export function resolveAnalyticsTimeZone(timeZone: string | null | undefined): string {
  const candidate = timeZone?.trim() || DEFAULT_ANALYTICS_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_ANALYTICS_TIMEZONE;
  }
}

export function hourInTimeZone(date: Date, timeZone: string = DEFAULT_ANALYTICS_TIMEZONE): number {
  const zone = resolveAnalyticsTimeZone(timeZone);
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "numeric",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .find((part) => part.type === "hour")?.value,
    );
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return hour;
  } catch {
    // Invalid timestamps fall back to UTC hour below.
  }
  return date.getUTCHours();
}

export function hourFromIso(iso: string, timeZone: string = DEFAULT_ANALYTICS_TIMEZONE): number {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return Number.NaN;
  return hourInTimeZone(parsed, timeZone);
}

export function peakHourOfDay(valuesByHour: number[]): string | null {
  const best = valuesByHour
    .map((value, hour) => ({ hour, value }))
    .sort((left, right) => right.value - left.value || left.hour - right.hour)[0];
  return best && best.value > 0 ? hourRangeLabel(best.hour) : null;
}

export function weekdayHourKey(date: Date): string {
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  return `${weekdays[date.getUTCDay()]}-${date.getUTCHours()}`;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addUtcHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function formatShortDateLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
