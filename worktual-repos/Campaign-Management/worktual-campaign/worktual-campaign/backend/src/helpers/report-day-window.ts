import {
  DEFAULT_LAUNCH_TIMEZONE,
  localPartsInZone,
  normalizeTimezone,
  utcFromLocalParts,
} from "./campaign-timezone.js";

/** UTC range [start, end) for one local calendar day in IANA timezone. */
export function dayWindowUtc(
  localDate: string,
  timeZone: string = DEFAULT_LAUNCH_TIMEZONE,
): { start: Date; end: Date } | null {
  const start = utcFromLocalParts(localDate, "00:00", timeZone);
  const end = utcFromLocalParts(addCalendarDays(localDate, 1), "00:00", timeZone);
  if (!start || !end) return null;
  return { start, end };
}

export function addCalendarDays(localDate: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate.trim());
  if (!match) return localDate;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Local YYYY-MM-DD for `now` in timezone. */
export function todayLocalDate(timeZone: string): string {
  return localPartsInZone(new Date(), normalizeTimezone(timeZone)).date;
}

/** Previous calendar day in timezone. */
export function yesterdayLocalDate(timeZone: string): string {
  return addCalendarDays(todayLocalDate(timeZone), -1);
}

/** Mon–Fri 17:00–18:00 local — daily report auto-send window (business hours 9–18). */
export function isDailyReportSendWindow(
  timeZone: string,
  at: Date = new Date(),
): boolean {
  const tz = normalizeTimezone(timeZone);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(at).map((p) => [p.type, p.value]),
  );
  const weekday = String(parts.weekday || "");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(parts.hour ?? -1);
  const minute = Number(parts.minute ?? 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const minutes = hour * 60 + minute;
  const windowStart = 17 * 60;
  const windowEnd = 18 * 60;
  return minutes >= windowStart && minutes < windowEnd;
}

export function formatReportDateLabel(localDate: string, timeZone: string): string {
  const start = utcFromLocalParts(localDate, "12:00", normalizeTimezone(timeZone));
  if (!start) return localDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTimezone(timeZone),
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(start);
}
