import type { CampaignListItem } from "@/services/campaigns.service";
import type { CalendarCountry } from "@/lib/campaign-calendar-countries";

export type CalendarDayCounts = {
  running: number;
  scheduled: number;
  completed: number;
};

export type CalendarDayCell = {
  ymd: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  holiday: string | null;
  running: number;
  scheduled: number;
  completed: number;
};

export type CalendarCampaignStatus = "running" | "scheduled" | "completed";

export type CalendarCampaignRow = {
  id: string;
  name: string;
  description: string | null;
  status: CalendarCampaignStatus;
  statusLabel: string;
  ymd: string;
  timeLabel: string;
  typeLabel: string;
  audienceCount: number;
  channels: string[];
};

function emptyCounts(): CalendarDayCounts {
  return { running: 0, scheduled: 0, completed: 0 };
}

export function dayTotal(c: CalendarDayCounts): number {
  return c.running + c.scheduled + c.completed;
}

/** YYYY-MM-DD in a given IANA timezone. */
export function ymdInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayYmd(timeZone: string): string {
  return ymdInTimeZone(new Date(), timeZone);
}

export function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y: y || 1970, m: m || 1, d: d || 1 };
}

export function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addMonths(ymd: string, delta: number): string {
  const { y, m } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1);
}

export function monthLabel(ymd: string): string {
  const { y, m } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDisplayDate(ymd: string): string {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Build Sunday-start month grid for the month containing `monthAnchor` (YYYY-MM-01). */
export function buildMonthGrid(
  monthAnchor: string,
  country: CalendarCountry,
  today: string,
  counts: Map<string, CalendarDayCounts>,
): CalendarDayCell[] {
  const { y, m } = parseYmd(monthAnchor);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startPad = first.getUTCDay(); // 0=Sun
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prevMonthDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const holidayByDate = new Map(country.holidays.map((h) => [h.date, h.name]));

  const cells: CalendarDayCell[] = [];
  for (let i = 0; i < startPad; i++) {
    const day = prevMonthDays - startPad + i + 1;
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const ymd = formatYmd(py, pm, day);
    cells.push(makeCell(ymd, day, false, today, country, counts, holidayByDate));
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const ymd = formatYmd(y, m, day);
    cells.push(makeCell(ymd, day, true, today, country, counts, holidayByDate));
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const nextIndex = cells.length - (startPad + daysInMonth) + 1;
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    const ymd = formatYmd(ny, nm, nextIndex);
    cells.push(
      makeCell(ymd, nextIndex, false, today, country, counts, holidayByDate),
    );
    if (cells.length >= 42) break;
  }
  return cells;
}

function makeCell(
  ymd: string,
  day: number,
  inMonth: boolean,
  today: string,
  country: CalendarCountry,
  counts: Map<string, CalendarDayCounts>,
  holidayByDate: Map<string, string>,
): CalendarDayCell {
  const c = counts.get(ymd) || emptyCounts();
  const { y, m, d } = parseYmd(ymd);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return {
    ymd,
    day,
    inMonth,
    isToday: ymd === today,
    isWeekend: country.weekendDays.includes(dow),
    holiday: holidayByDate.get(ymd) ?? null,
    running: c.running,
    scheduled: c.scheduled,
    completed: c.completed,
  };
}

function campaignBucket(
  status: string,
): CalendarCampaignStatus | null {
  const s = status.toLowerCase();
  if (
    s === "live" ||
    s === "running" ||
    s === "active" ||
    s === "in_progress"
  ) {
    return "running";
  }
  if (s === "scheduled" || s === "ready") {
    return "scheduled";
  }
  if (s === "completed") {
    return "completed";
  }
  return null;
}

export function campaignLocalYmd(
  row: CampaignListItem,
  country: CalendarCountry,
): string | null {
  if (row.launchLocalDate?.trim()) {
    return row.launchLocalDate.trim().slice(0, 10);
  }
  if (row.startsAt) {
    return ymdInTimeZone(new Date(row.startsAt), country.timeZone);
  }
  if (row.endsAt) {
    return ymdInTimeZone(new Date(row.endsAt), country.timeZone);
  }
  if (row.createdAt) {
    return ymdInTimeZone(new Date(row.createdAt), country.timeZone);
  }
  return null;
}

export function toCalendarCampaignRows(
  items: CampaignListItem[],
  country: CalendarCountry,
): CalendarCampaignRow[] {
  const out: CalendarCampaignRow[] = [];
  for (const row of items) {
    const bucket = campaignBucket(row.status);
    if (!bucket) continue;
    const ymd = campaignLocalYmd(row, country);
    if (!ymd) continue;
    const timeLabel = row.launchLocalTime
      ? row.launchLocalTime.slice(0, 5)
      : row.startsAt
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: country.timeZone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }).format(new Date(row.startsAt))
        : row.endsAt
          ? new Intl.DateTimeFormat("en-GB", {
              timeZone: country.timeZone,
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }).format(new Date(row.endsAt))
          : "—";
    const channels = (row.channels || []).map((c) => String(c).toLowerCase());
    if (row.sourceChannel && !channels.includes(row.sourceChannel.toLowerCase())) {
      channels.push(row.sourceChannel.toLowerCase());
    }
    out.push({
      id: row.id,
      name: row.name || "Untitled",
      description: row.description,
      status: bucket,
      statusLabel:
        bucket === "running"
          ? "Running"
          : bucket === "scheduled"
            ? "Scheduled"
            : "Ran",
      ymd,
      timeLabel,
      typeLabel: row.hasPpc
        ? "PPC"
        : channels[0]
          ? channels[0].charAt(0).toUpperCase() + channels[0].slice(1)
          : "Marketing",
      audienceCount: row.audienceCount ?? 0,
      channels,
    });
  }
  return out;
}

export function countsByDay(
  rows: CalendarCampaignRow[],
): Map<string, CalendarDayCounts> {
  const map = new Map<string, CalendarDayCounts>();
  for (const row of rows) {
    const cur = map.get(row.ymd) || emptyCounts();
    if (row.status === "running") cur.running += 1;
    else if (row.status === "scheduled") cur.scheduled += 1;
    else cur.completed += 1;
    map.set(row.ymd, cur);
  }
  return map;
}
