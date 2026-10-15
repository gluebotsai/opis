import type {
  AnalyticsChartSpec,
  AnalyticsVisual,
  StructuredAnalytics,
} from "@/services/agent-stream";

function humanize(value: unknown): string {
  return String(value).replace(/_/g, " ");
}

/** Build visual payload from legacy chart + rows when backend omits `visual`. */
export function deriveAnalyticsVisual(analytics: StructuredAnalytics): AnalyticsVisual | null {
  if (analytics.visual?.version === "1.0" && analytics.visual.kind) {
    return analytics.visual;
  }

  const chart = analytics.chart;
  const rows = analytics.findings.rows ?? [];
  if (!chart) return null;

  const title = chart?.title ?? "Analytics";
  const kind = chart?.type ?? (rows.length > 0 ? "table" : "kpi");

  if (kind === "kpi") {
    const xKey = chart?.x ?? "label";
    const yKey =
      typeof chart?.y === "string"
        ? chart.y
        : Array.isArray(chart?.y)
          ? chart.y[0]
          : "value";

    if (rows.length > 0 && rows.every((row) => row.label != null && row.value != null)) {
      return {
        version: "1.0",
        kind: "kpi",
        title,
        kpis: rows.slice(0, 6).map((row, i) => ({
          label: String(row.label ?? `Metric ${i + 1}`),
          value: String(row.value ?? "—"),
        })),
      };
    }

    if (title.toLowerCase().includes("win rate")) {
      let won = 0;
      let lost = 0;
      for (const row of rows) {
        const stage = String(row.stage ?? "").toLowerCase();
        const count = Number(row.count ?? 0);
        if (stage === "closed_won") won = count;
        if (stage === "closed_lost") lost = count;
      }
      const decided = won + lost;
      if (decided > 0) {
        return {
          version: "1.0",
          kind: "kpi",
          title,
          kpis: [{ label: "Win rate", value: `${((won / decided) * 100).toFixed(1)}%` }],
        };
      }
    }

    if (rows.length === 1 && rows[0]?.count != null) {
      return {
        version: "1.0",
        kind: "kpi",
        title,
        kpis: [{ label: title, value: String(rows[0].count) }],
      };
    }

    if (yKey && rows.length > 0) {
      return {
        version: "1.0",
        kind: "kpi",
        title,
        kpis: rows.slice(0, 6).map((row, i) => ({
          label: String(row[xKey] ?? `Metric ${i + 1}`),
          value: String(row[yKey] ?? row.count ?? "—"),
        })),
      };
    }

    return null;
  }

  if (kind === "bar" || kind === "line" || kind === "pie") {
    const xKey = chart?.x ?? "label";
    const yKeys = Array.isArray(chart?.y) ? chart.y : chart?.y ? [chart.y] : ["count"];
    if (rows.length === 0) return null;
    return {
      version: "1.0",
      kind: kind === "pie" ? "pie" : kind,
      title,
      description: undefined,
      chart: {
        xKey,
        data: rows.slice(0, 50).map((row) => {
          const item = { ...row } as Record<string, string | number>;
          if (typeof item[xKey] === "string") {
            item[xKey] = humanize(item[xKey]);
          }
          return item;
        }),
        series: yKeys.map((key) => ({
          key,
          label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        })),
      },
    };
  }

  const columns =
    rows.length > 0
      ? Object.keys(rows[0] ?? {}).map((key) => ({
          key,
          label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        }))
      : [];

  return {
    version: "1.0",
    kind: "table",
    title,
    table: { columns, rows: rows.slice(0, 50) },
  };
}

export function resolveAnalyticsVisual(analytics: StructuredAnalytics): AnalyticsVisual | null {
  return deriveAnalyticsVisual(analytics);
}

export type { AnalyticsChartSpec };
