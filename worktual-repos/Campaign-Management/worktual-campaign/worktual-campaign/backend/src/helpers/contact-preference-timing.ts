/**
 * Inferred send windows from engagement timestamps.
 * Matches agents/app/contacts/preference_timing.py
 */

export const LOOKBACK_DAYS = 90;
export const MIN_EVENTS = 5;
export const WINDOW_HOURS = 2;
export const DEFAULT_TZ = "Asia/Kolkata";

export const DAY_KEYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export type DayKey = (typeof DAY_KEYS)[number];

export type SendWindow = {
  days: DayKey[];
  start: string;
  end: string;
};

const TIMING_CHANNELS = ["email", "push", "web"] as const;
const CHANNEL_TIMING_KEYS = [
  "email",
  "whatsapp",
  "push",
  "web",
  "sms",
] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TZ_OK = /^[A-Za-z_]+\/[A-Za-z0-9_+\-]+$/;

export function safeTimezone(
  raw: unknown,
  defaultTz: string = DEFAULT_TZ,
): string {
  const text = String(raw || "").trim() || defaultTz;
  if (text === "UTC") return text;
  if (!TZ_OK.test(text)) return defaultTz;
  try {
    Intl.DateTimeFormat("en-GB", { timeZone: text }).format(new Date());
    return text;
  } catch {
    return defaultTz;
  }
}

export function parseSendWindow(raw: unknown): SendWindow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const start = String(obj.start || "").trim();
  const end = String(obj.end || "").trim();
  if (!HHMM.test(start) || !HHMM.test(end)) return null;
  if (!Array.isArray(obj.days) || !obj.days.length) return null;
  const days: DayKey[] = [];
  const seen = new Set<string>();
  for (const item of obj.days) {
    const key = String(item || "")
      .trim()
      .toLowerCase()
      .slice(0, 3);
    if (!(DAY_KEYS as readonly string[]).includes(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    days.push(key as DayKey);
  }
  if (!days.length) return null;
  return { days, start, end };
}

export function parseChannelTiming(
  raw: unknown,
): Record<string, SendWindow> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: Record<string, SendWindow> = {};
  for (const channel of CHANNEL_TIMING_KEYS) {
    const window = parseSendWindow(obj[channel]);
    if (window) out[channel] = window;
  }
  return out;
}

export function localWeekdayHour(
  when: Date,
  tzName: string,
): { weekday: number; hour: number } | null {
  try {
    const tz = safeTimezone(tzName);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(when);
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

function fmtHour(hour: number): string {
  return `${String(((hour % 24) + 24) % 24).padStart(2, "0")}:00`;
}

export function windowFromDatetimes(
  stamps: Date[],
  tzName: string,
  minEvents: number = MIN_EVENTS,
): SendWindow | null {
  const points: { weekday: number; hour: number }[] = [];
  for (const stamp of stamps) {
    const pair = localWeekdayHour(stamp, tzName);
    if (pair) points.push(pair);
  }
  if (points.length < minEvents) return null;
  const hourCounts = new Map<number, number>();
  for (const p of points) {
    hourCounts.set(p.hour, (hourCounts.get(p.hour) || 0) + 1);
  }
  let peakHour = 0;
  let peakN = -1;
  for (const [hour, n] of hourCounts) {
    if (n > peakN || (n === peakN && hour < peakHour)) {
      peakHour = hour;
      peakN = n;
    }
  }
  const days: DayKey[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    if (p.hour !== peakHour) continue;
    const key = DAY_KEYS[p.weekday];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    days.push(key);
  }
  if (!days.length) return null;
  return {
    days,
    start: fmtHour(peakHour),
    end: fmtHour(peakHour + WINDOW_HOURS),
  };
}

export function eventStampForChannel(
  channel: string,
  openedAt: Date | null | undefined,
  clickedAt: Date | null | undefined,
): Date | null {
  let ch = String(channel || "")
    .trim()
    .toLowerCase();
  if (ch === "app_push" || ch === "apppush") ch = "push";
  if (ch === "web_push" || ch === "webpush") ch = "web";
  if (ch === "email") return openedAt ?? null;
  if (ch === "push" || ch === "web") return clickedAt ?? null;
  return null;
}

export type PreferenceEventRow = {
  channel?: string | null;
  opened_at?: Date | null;
  clicked_at?: Date | null;
};

export function computePreferenceWindows(
  rows: PreferenceEventRow[],
  opts?: {
    timezoneName?: string;
    now?: Date;
    lookbackDays?: number;
    minEvents?: number;
  },
): Record<string, unknown> {
  const tz = safeTimezone(opts?.timezoneName);
  const moment = opts?.now ?? new Date();
  const lookback = opts?.lookbackDays ?? LOOKBACK_DAYS;
  const minEvents = opts?.minEvents ?? MIN_EVENTS;
  const since = new Date(moment.getTime() - lookback * 24 * 60 * 60 * 1000);

  const byChannel: Record<string, Date[]> = {
    email: [],
    push: [],
    web: [],
  };
  const allStamps: Date[] = [];

  for (const row of rows) {
    let ch = String(row.channel || "")
      .trim()
      .toLowerCase();
    if (ch === "app_push" || ch === "apppush") ch = "push";
    if (ch === "web_push" || ch === "webpush") ch = "web";
    const stamp = eventStampForChannel(ch, row.opened_at, row.clicked_at);
    if (!stamp || stamp < since) continue;
    if (ch === "email" || ch === "push" || ch === "web") {
      byChannel[ch].push(stamp);
    }
    allStamps.push(stamp);
  }

  const out: Record<string, unknown> = {};
  const overall = windowFromDatetimes(allStamps, tz, minEvents);
  if (overall) {
    out.timezone = tz;
    out.timing = overall;
  }
  const channelTiming: Record<string, SendWindow> = {};
  for (const ch of TIMING_CHANNELS) {
    const window = windowFromDatetimes(byChannel[ch] || [], tz, minEvents);
    if (window) channelTiming[ch] = window;
  }
  if (Object.keys(channelTiming).length) {
    if (!out.timezone) out.timezone = tz;
    out.channel_timing = channelTiming;
  }
  return out;
}

export function fillMissingWindows(
  existing: Record<string, unknown>,
  computed: Record<string, unknown>,
): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (existing.timezone) extras.timezone = safeTimezone(existing.timezone);
  else if (computed.timezone) extras.timezone = safeTimezone(computed.timezone);

  const existingTiming = parseSendWindow(existing.timing);
  const computedTiming = parseSendWindow(computed.timing);
  if (existingTiming) extras.timing = existingTiming;
  else if (computedTiming) extras.timing = computedTiming;

  const storedCt = parseChannelTiming(existing.channel_timing);
  const computedCt = parseChannelTiming(computed.channel_timing);
  const mergedCt = { ...storedCt };
  for (const [channel, window] of Object.entries(computedCt)) {
    if (!mergedCt[channel]) mergedCt[channel] = window;
  }
  if (Object.keys(mergedCt).length) extras.channel_timing = mergedCt;
  return extras;
}
