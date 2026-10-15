/**
 * Working-time math for lead reminder deadlines.
 * Windows come from accounts.setup_business_hours (open/close + working days,
 * or per-day timings). Minutes outside those windows do not count.
 */

export type FollowupBand = "hot" | "warm" | "cold";
export type FollowupStep = "remind" | "manager" | "admin";

export type MinuteSteps = {
  remindMinutes: number;
  managerMinutes: number;
  adminMinutes: number;
};

export type ColdSteps = {
  remind: "end_of_working_day";
  manager: "next_working_day";
  admin: "two_working_days";
};

export type FollowupPolicy = {
  hot: MinuteSteps;
  warm: MinuteSteps;
  cold: ColdSteps;
};

export const DEFAULT_FOLLOWUP_POLICY: FollowupPolicy = {
  hot: { remindMinutes: 5, managerMinutes: 15, adminMinutes: 30 },
  warm: { remindMinutes: 30, managerMinutes: 120, adminMinutes: 240 },
  cold: {
    remind: "end_of_working_day",
    manager: "next_working_day",
    admin: "two_working_days",
  },
};

export type DayWindow = { openMin: number; closeMin: number };

/** Weekday 0 = Sunday … 6 = Saturday. Null means that day is closed. */
export type WorkingCalendar = {
  timezone: string;
  days: Array<DayWindow | null>;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

export function fallbackWorkingCalendar(timezone = "UTC"): WorkingCalendar {
  const window = { openMin: 9 * 60, closeMin: 18 * 60 };
  return {
    timezone,
    days: [null, window, window, window, window, window, null],
  };
}

export function parseClockToMinutes(value: string | null | undefined): number | null {
  const raw = (value ?? "").trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour === 24 && minute === 0) return 24 * 60;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function weekdayIndex(name: string): number | null {
  const key = name.trim().toLowerCase();
  return WEEKDAY_INDEX[key] ?? null;
}

function windowFromClocks(
  open: string | null | undefined,
  close: string | null | undefined,
): DayWindow | null {
  const openMin = parseClockToMinutes(open);
  const closeMin = parseClockToMinutes(close);
  if (openMin == null || closeMin == null || closeMin <= openMin) return null;
  return { openMin, closeMin };
}

export function calendarFromBusinessHours(input: {
  timezone?: string | null;
  workingDays?: unknown;
  openTime?: string | null;
  closeTime?: string | null;
  dayTimings?: unknown;
}): WorkingCalendar {
  const timezone = input.timezone?.trim() || "UTC";
  const shared = windowFromClocks(input.openTime, input.closeTime);
  const days: Array<DayWindow | null> = [null, null, null, null, null, null, null];
  const named = Array.isArray(input.workingDays)
    ? input.workingDays.filter((d): d is string => typeof d === "string")
    : [];
  for (const name of named) {
    const idx = weekdayIndex(name);
    if (idx == null || !shared) continue;
    days[idx] = shared;
  }
  if (input.dayTimings && typeof input.dayTimings === "object") {
    for (const [name, raw] of Object.entries(
      input.dayTimings as Record<string, unknown>,
    )) {
      const idx = weekdayIndex(name);
      if (idx == null || !raw || typeof raw !== "object") continue;
      const row = raw as { openTime?: string; closeTime?: string };
      const window = windowFromClocks(row.openTime, row.closeTime);
      if (window) days[idx] = window;
    }
  }
  if (days.every((d) => d == null)) return fallbackWorkingCalendar(timezone);
  return { timezone, days };
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const weekday = weekdayIndex(map.weekday ?? "") ?? 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
    weekday,
  };
}

function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 2; i += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
    );
    utc += Date.UTC(year, month - 1, day, hour, minute, 0) - asUtc;
  }
  return new Date(utc);
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function weekdayOfYmd(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function windowOn(calendar: WorkingCalendar, weekday: number): DayWindow | null {
  return calendar.days[weekday] ?? null;
}

/** First open instant at or after `from`. */
export function nextOpenInstant(from: Date, calendar: WorkingCalendar): Date {
  const parts = zonedParts(from, calendar.timezone);
  let cursor = { year: parts.year, month: parts.month, day: parts.day };
  const nowMin = parts.hour * 60 + parts.minute;
  for (let i = 0; i < 14; i += 1) {
    const weekday = weekdayOfYmd(cursor.year, cursor.month, cursor.day);
    const window = windowOn(calendar, weekday);
    if (window) {
      const startMin = i === 0 ? Math.max(window.openMin, nowMin) : window.openMin;
      if (startMin < window.closeMin) {
        return zonedWallToUtc(
          cursor.year,
          cursor.month,
          cursor.day,
          Math.floor(startMin / 60),
          startMin % 60,
          calendar.timezone,
        );
      }
    }
    cursor = addCalendarDays(cursor.year, cursor.month, cursor.day, 1);
  }
  return new Date(from.getTime() + 24 * 60 * 60_000);
}

export function addWorkingMinutes(
  from: Date,
  minutes: number,
  calendar: WorkingCalendar,
): Date {
  const amount = Math.max(0, Math.floor(minutes));
  if (amount === 0) return nextOpenInstant(from, calendar);
  let remaining = amount;
  let cursor = from;
  for (let guard = 0; guard < 21 && remaining > 0; guard += 1) {
    const open = nextOpenInstant(cursor, calendar);
    const parts = zonedParts(open, calendar.timezone);
    const window = windowOn(calendar, parts.weekday);
    if (!window) break;
    const nowMin = parts.hour * 60 + parts.minute;
    const available = window.closeMin - nowMin;
    if (available <= 0) {
      cursor = new Date(open.getTime() + 60_000);
      continue;
    }
    if (remaining <= available) {
      return new Date(open.getTime() + remaining * 60_000);
    }
    remaining -= available;
    const close = zonedWallToUtc(
      parts.year,
      parts.month,
      parts.day,
      Math.floor(window.closeMin / 60),
      window.closeMin % 60,
      calendar.timezone,
    );
    cursor = close;
  }
  return new Date(from.getTime() + amount * 60_000);
}

function endOfWorkingDayContaining(from: Date, calendar: WorkingCalendar): Date {
  const open = nextOpenInstant(from, calendar);
  const parts = zonedParts(open, calendar.timezone);
  const window = windowOn(calendar, parts.weekday);
  if (!window) return open;
  return zonedWallToUtc(
    parts.year,
    parts.month,
    parts.day,
    Math.floor(window.closeMin / 60),
    window.closeMin % 60,
    calendar.timezone,
  );
}

function endOfNthWorkingDay(from: Date, calendar: WorkingCalendar, n: number): Date {
  let cursor = from;
  let end = endOfWorkingDayContaining(cursor, calendar);
  for (let i = 0; i < n; i += 1) {
    cursor = new Date(end.getTime() + 60_000);
    end = endOfWorkingDayContaining(cursor, calendar);
  }
  return end;
}

export function followupDeadline(input: {
  from: Date;
  band: FollowupBand;
  step: FollowupStep;
  calendar: WorkingCalendar;
  policy?: FollowupPolicy;
}): Date {
  const policy = input.policy ?? DEFAULT_FOLLOWUP_POLICY;
  if (input.band === "cold") {
    if (input.step === "remind") {
      return endOfWorkingDayContaining(input.from, input.calendar);
    }
    if (input.step === "manager") {
      return endOfNthWorkingDay(input.from, input.calendar, 1);
    }
    return endOfNthWorkingDay(input.from, input.calendar, 2);
  }
  const steps = policy[input.band];
  const minutes =
    input.step === "remind"
      ? steps.remindMinutes
      : input.step === "manager"
        ? steps.managerMinutes
        : steps.adminMinutes;
  return addWorkingMinutes(input.from, minutes, input.calendar);
}

function positiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function parseFollowupPolicy(raw: unknown): FollowupPolicy {
  const base = DEFAULT_FOLLOWUP_POLICY;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const minutes = (key: "hot" | "warm"): MinuteSteps => {
    const row =
      o[key] && typeof o[key] === "object"
        ? (o[key] as Record<string, unknown>)
        : {};
    const seed = base[key];
    return {
      remindMinutes: positiveInt(row.remindMinutes, seed.remindMinutes),
      managerMinutes: positiveInt(row.managerMinutes, seed.managerMinutes),
      adminMinutes: positiveInt(row.adminMinutes, seed.adminMinutes),
    };
  };
  return {
    hot: minutes("hot"),
    warm: minutes("warm"),
    cold: base.cold,
  };
}

export function describeCalendar(calendar: WorkingCalendar): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const parts: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const window = calendar.days[i];
    if (!window) continue;
    const openH = String(Math.floor(window.openMin / 60)).padStart(2, "0");
    const openM = String(window.openMin % 60).padStart(2, "0");
    const closeH = String(Math.floor(window.closeMin / 60)).padStart(2, "0");
    const closeM = String(window.closeMin % 60).padStart(2, "0");
    parts.push(`${names[i]} ${openH}:${openM}-${closeH}:${closeM}`);
  }
  return `${parts.join(", ")} ${calendar.timezone}`.trim();
}
