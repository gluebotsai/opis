/**
 * Dashboard KPI windows, aligned with reports B2B `time.py`.
 * Half-open UTC ranges: [start, end).
 * There is no overall window on the dashboard.
 */

export type DashboardKpiPeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "quarter";

export type DashboardKpiBounds = {
  currentStart: Date;
  currentEnd: Date;
  prevStart: Date;
  prevEnd: Date;
  title: string;
  compareLabel: string;
  shortLabel: string;
};

export type DatedDashboardDeal = {
  stage: string;
  createdAt: Date;
  closedAt: Date | null;
};

const OPEN_STAGES = new Set([
  "qualification",
  "discover",
  "propose",
  "negotiate",
]);

function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function addUtcDays(day: Date, days: number): Date {
  const next = new Date(day.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function timestampInWindow(ts: Date, start: Date, end: Date): boolean {
  const time = ts.getTime();
  return time >= start.getTime() && time < end.getTime();
}

/** Reports `close_ts`: closed_at, or created_at when close is missing. */
export function closeTimestamp(
  closedAt: Date | null | undefined,
  createdAt: Date,
): Date {
  return closedAt ?? createdAt;
}

export function dashboardKpiBounds(
  period: DashboardKpiPeriod,
  now = new Date(),
): DashboardKpiBounds {
  const today = utcDayStart(now);

  if (period === "today") {
    const currentStart = today;
    const currentEnd = addUtcDays(today, 1);
    return {
      currentStart,
      currentEnd,
      prevStart: addUtcDays(today, -1),
      prevEnd: currentStart,
      title: "Today's metrics",
      compareLabel: "vs yesterday",
      shortLabel: "Today",
    };
  }

  if (period === "yesterday") {
    const currentStart = addUtcDays(today, -1);
    return {
      currentStart,
      currentEnd: today,
      prevStart: addUtcDays(today, -2),
      prevEnd: currentStart,
      title: "Yesterday's metrics",
      compareLabel: "vs prior day",
      shortLabel: "Yesterday",
    };
  }

  if (period === "week") {
    const currentStart = addUtcDays(today, -7);
    const currentEnd = addUtcDays(today, 1);
    return {
      currentStart,
      currentEnd,
      prevStart: addUtcDays(today, -14),
      prevEnd: currentStart,
      title: "Last 7 days",
      compareLabel: "vs prior 7 days",
      shortLabel: "Last 7 days",
    };
  }

  if (period === "quarter") {
    const quarter = Math.floor(now.getUTCMonth() / 3);
    const year = now.getUTCFullYear();
    const currentStart = new Date(Date.UTC(year, quarter * 3, 1));
    const currentEnd = new Date(Date.UTC(year, quarter * 3 + 3, 1));
    const prevStart = new Date(Date.UTC(year, quarter * 3 - 3, 1));
    return {
      currentStart,
      currentEnd,
      prevStart,
      prevEnd: currentStart,
      title: "This quarter",
      compareLabel: "vs last quarter",
      shortLabel: "This quarter",
    };
  }

  const currentStart = addUtcDays(today, -30);
  const currentEnd = addUtcDays(today, 1);
  return {
    currentStart,
    currentEnd,
    prevStart: addUtcDays(today, -60),
    prevEnd: currentStart,
    title: "Last 30 days",
    compareLabel: "vs prior 30 days",
    shortLabel: "Last 30 days",
  };
}

export function dashboardDealSets<T extends DatedDashboardDeal>(
  deals: T[],
  bounds: Pick<DashboardKpiBounds, "currentStart" | "currentEnd">,
): {
  created: T[];
  openCreated: T[];
  wonClosed: T[];
  lostClosed: T[];
  openByCloseTs: T[];
} {
  const created = deals.filter((deal) =>
    timestampInWindow(deal.createdAt, bounds.currentStart, bounds.currentEnd),
  );
  const closed = deals.filter((deal) =>
    timestampInWindow(
      closeTimestamp(deal.closedAt, deal.createdAt),
      bounds.currentStart,
      bounds.currentEnd,
    ),
  );
  return {
    created,
    openCreated: created.filter((deal) => OPEN_STAGES.has(deal.stage)),
    wonClosed: closed.filter((deal) => deal.stage === "closed_won"),
    lostClosed: closed.filter((deal) => deal.stage === "closed_lost"),
    openByCloseTs: deals.filter(
      (deal) =>
        OPEN_STAGES.has(deal.stage) &&
        timestampInWindow(
          closeTimestamp(deal.closedAt, deal.createdAt),
          bounds.currentStart,
          bounds.currentEnd,
        ),
    ),
  };
}
