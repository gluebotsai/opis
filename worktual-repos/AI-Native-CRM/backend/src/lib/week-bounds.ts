/**
 * Timezone-aware calendar week bounds (Monday 00:00 → next Monday 00:00, exclusive end).
 */

export const SCORECARD_DEFAULT_TIMEZONE = "UTC";

export type WeekBounds = {
  weekKey: string;
  weekLabel: string;
  timeZone: string;
  weekStart: Date;
  /** Exclusive upper bound for range queries. */
  weekEnd: Date;
};

const WEEKDAY_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function wallClockParts(
  date: Date,
  timeZone: string,
): { weekday: number; year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";
  return {
    weekday: WEEKDAY_ISO[get("weekday")] ?? 1,
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value || "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - date.getTime();
}

export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): Date {
  if (timeZone === "UTC") {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  }
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  for (let i = 0; i < 3; i++) {
    const offset = getTimeZoneOffsetMs(timeZone, new Date(utcMs));
    utcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms) - offset;
  }
  return new Date(utcMs);
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

function isoWeekKeyFromDate(year: number, month: number, day: number): string {
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const isoYear = utc.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((utc.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function formatWeekLabel(
  monday: { year: number; month: number; day: number },
  sunday: { year: number; month: number; day: number },
  timeZone: string,
): string {
  const fmt = (y: number, m: number, d: number) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(Date.UTC(y, m - 1, d)));

  const tzShort =
    timeZone === "UTC"
      ? "UTC"
      : new Intl.DateTimeFormat("en-US", {
          timeZone,
          timeZoneName: "short",
        })
          .formatToParts(new Date())
          .find((p) => p.type === "timeZoneName")?.value || timeZone;

  return `${fmt(monday.year, monday.month, monday.day)} – ${fmt(sunday.year, sunday.month, sunday.day)} (${tzShort})`;
}

/** Resolve a valid IANA timezone or fall back to UTC. */
export function resolveTimeZone(raw: string | null | undefined): string {
  const tz = raw?.trim();
  if (!tz) return SCORECARD_DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return SCORECARD_DEFAULT_TIMEZONE;
  }
}

export function getWeekBounds(
  timeZone: string,
  now = new Date(),
  weekOffset = 0,
): WeekBounds {
  const tz = resolveTimeZone(timeZone);
  const parts = wallClockParts(now, tz);
  const monday = addCalendarDays(
    parts.year,
    parts.month,
    parts.day,
    -(parts.weekday - 1) + weekOffset * 7,
  );
  const sunday = addCalendarDays(monday.year, monday.month, monday.day, 6);
  const nextMonday = addCalendarDays(monday.year, monday.month, monday.day, 7);

  const weekStart = zonedDateTimeToUtc(
    monday.year,
    monday.month,
    monday.day,
    0,
    0,
    0,
    0,
    tz,
  );
  const weekEnd = zonedDateTimeToUtc(
    nextMonday.year,
    nextMonday.month,
    nextMonday.day,
    0,
    0,
    0,
    0,
    tz,
  );

  return {
    weekKey: isoWeekKeyFromDate(monday.year, monday.month, monday.day),
    weekLabel: formatWeekLabel(monday, sunday, tz),
    timeZone: tz,
    weekStart,
    weekEnd,
  };
}
