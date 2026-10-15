export const BROWSER_ORDER = ["Chrome", "Edge", "Firefox", "Safari", "Opera", "Other"] as const;

export function parseBrowser(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "Other";

  // Order matters: Edge/Opera before Chrome; Chrome before Safari.
  if (ua.includes("edg/") || ua.includes("edge/")) return "Edge";
  if (ua.includes("opr/") || ua.includes("opera")) return "Opera";
  if (ua.includes("firefox/") || ua.includes("fxios")) return "Firefox";
  if (ua.includes("chrome/") || ua.includes("crios")) return "Chrome";
  if (ua.includes("safari/")) return "Safari";
  return "Other";
}

export interface BrowserSessionRow {
  session_id: string;
  visitor_id: string;
  user_agent?: string | null;
}

function sharePercent(part: number, total: number): number {
  return total ? Math.round((part / total) * 10000) / 100 : 0;
}

export function aggregateBrowsers(rows: BrowserSessionRow[]) {
  const stats: Record<string, { browser: string; visitors: Set<string>; sessions: number }> = {};

  for (const row of rows) {
    const browser = parseBrowser(row.user_agent);
    if (!stats[browser]) {
      stats[browser] = { browser, visitors: new Set(), sessions: 0 };
    }
    stats[browser].visitors.add(row.visitor_id);
    stats[browser].sessions += 1;
  }

  const totalSessions = rows.length;
  const chart = BROWSER_ORDER.map((browser) => {
    const item = stats[browser];
    const visitors = item ? item.visitors.size : 0;
    const sessions = item ? item.sessions : 0;
    return {
      browser,
      visitors,
      sessions,
      percentage: 0,
    };
  });

  const table = chart.filter((item) => item.sessions > 0);
  const totalTableVisitors = table.reduce((sum, item) => sum + item.visitors, 0);
  const withPercentages = (item: (typeof chart)[number]) => ({
    ...item,
    percentage: item.sessions > 0 ? sharePercent(item.visitors, totalTableVisitors) : 0,
  });

  return {
    total_sessions: totalSessions,
    total_visitors: new Set(rows.map((r) => r.visitor_id)).size,
    chart: chart.map(withPercentages),
    browsers: table.map(withPercentages),
  };
}
