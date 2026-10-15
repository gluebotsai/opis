/** Default launch timezone (IST). */
export const DEFAULT_LAUNCH_TIMEZONE = "Asia/Kolkata";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Format a Date into YYYY-MM-DD and HH:mm in the given IANA timezone. */
export function localPartsInZone(
  utc: Date,
  timeZone: string = DEFAULT_LAUNCH_TIMEZONE,
): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(utc).map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return { date, time };
}

/**
 * Build a UTC Date from local date (YYYY-MM-DD) + time (HH:mm) in IANA zone.
 * Uses a binary search on UTC ms so we don't need a heavy TZ library.
 */
export function utcFromLocalParts(
  localDate: string,
  localTime: string,
  timeZone: string = DEFAULT_LAUNCH_TIMEZONE,
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(localTime.trim());
  if (!dateMatch || !timeMatch) return null;
  const y = Number(dateMatch[1]);
  const mo = Number(dateMatch[2]);
  const d = Number(dateMatch[3]);
  const h = Number(timeMatch[1]);
  const mi = Number(timeMatch[2]);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(mo) ||
    !Number.isFinite(d) ||
    !Number.isFinite(h) ||
    !Number.isFinite(mi)
  ) {
    return null;
  }

  // Rough guess: treat local as UTC then refine.
  let guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  for (let i = 0; i < 4; i++) {
    const parts = localPartsInZone(new Date(guess), timeZone);
    const [py, pmo, pd] = parts.date.split("-").map(Number);
    const [ph, pmi] = parts.time.split(":").map(Number);
    const asUtc = Date.UTC(py, pmo - 1, pd, ph, pmi, 0);
    const wanted = Date.UTC(y, mo - 1, d, h, mi, 0);
    const delta = wanted - asUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

export function normalizeTimezone(raw: string | null | undefined): string {
  const t = String(raw || "").trim();
  if (!t) return DEFAULT_LAUNCH_TIMEZONE;
  try {
    // Throws RangeError for invalid IANA names in modern Node.
    Intl.DateTimeFormat(undefined, { timeZone: t });
    return t;
  } catch {
    return DEFAULT_LAUNCH_TIMEZONE;
  }
}

export function ensureLaunchScheduleFields(input: {
  startsAt: Date | null;
  timezone: string | null;
  launchLocalDate: string | null;
  launchLocalTime: string | null;
}): {
  timezone: string;
  launchLocalDate: string | null;
  launchLocalTime: string | null;
  needsBackfill: boolean;
} {
  const timezone = normalizeTimezone(input.timezone);
  let launchLocalDate = input.launchLocalDate?.trim() || null;
  let launchLocalTime = input.launchLocalTime?.trim() || null;
  let needsBackfill =
    !input.timezone?.trim() ||
    (!!input.startsAt && (!launchLocalDate || !launchLocalTime));

  if (input.startsAt && (!launchLocalDate || !launchLocalTime)) {
    const parts = localPartsInZone(input.startsAt, timezone);
    launchLocalDate = launchLocalDate || parts.date;
    launchLocalTime = launchLocalTime || parts.time;
  }

  return { timezone, launchLocalDate, launchLocalTime, needsBackfill };
}

export function formatLaunchLabel(opts: {
  timezone: string;
  launchLocalDate: string | null;
  launchLocalTime: string | null;
  startsAt: string | null;
}): string {
  if (opts.launchLocalDate && opts.launchLocalTime) {
    return `${opts.launchLocalDate} ${opts.launchLocalTime} (${opts.timezone})`;
  }
  if (opts.startsAt) return opts.startsAt;
  return "not set";
}

export { pad2 };
