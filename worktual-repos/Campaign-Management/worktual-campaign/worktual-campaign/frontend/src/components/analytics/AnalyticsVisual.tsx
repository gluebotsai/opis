import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** CRM handoff StructuredAnalytics.visual v1.0 (Campaign subset). */
export type AnalyticsVisualV1 = {
  version?: string;
  kind: "kpi" | "bar" | "line" | "pie" | "table";
  title?: string;
  description?: string;
  kpis?: Array<{ label: string; value: string; hint?: string; change?: string }>;
  chart?: {
    xKey?: string;
    data?: Array<Record<string, unknown>>;
    series?: Array<{ key: string; label?: string }>;
  };
  table?: {
    columns?: Array<{ key: string; label?: string }>;
    rows?: Array<Record<string, unknown>>;
  };
};

export type StructuredAnalytics = {
  include_visual?: boolean;
  findings?: {
    summary?: string;
    rows?: Array<Record<string, unknown>>;
    comparison?: string;
  };
  visual?: AnalyticsVisualV1 | null;
  audit?: {
    source?: string;
    organizationId?: string;
    metricIds?: string[];
    rowCount?: number;
  };
  plan?: Record<string, unknown>;
};

const BAR_COLORS = ["#0f766e", "#0369a1", "#7c3aed", "#c2410c", "#15803d"];

function KpiStrip({
  kpis,
}: {
  kpis: NonNullable<AnalyticsVisualV1["kpis"]>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {kpis.map((k) => (
        <div
          key={`${k.label}-${k.value}`}
          className="rounded-lg border border-border-default bg-white px-2.5 py-2"
        >
          <p className="text-[10px] font-medium uppercase tracking-wide text-text-caption">
            {k.label}
          </p>
          <p className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900">
            {k.value}
          </p>
          {k.hint ? (
            <p className="mt-0.5 text-[10px] text-text-caption">{k.hint}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AnalyticsVisual({
  analytics,
}: {
  analytics: StructuredAnalytics;
}) {
  const normalized = deriveVisualFromFindings(analytics);
  const visual = normalized.visual;
  if (!visual || !visual.kind) return null;

  const source = normalized.audit?.source;
  const title = visual.title?.trim();

  return (
    <div className="mt-2 w-full min-w-[220px] max-w-md overflow-hidden rounded-xl border border-border-default bg-white/90 p-3 shadow-sm">
      {title ? (
        <p className="mb-2 text-xs font-semibold text-neutral-800">{title}</p>
      ) : null}

      {visual.kind === "kpi" && visual.kpis?.length ? (
        <KpiStrip kpis={visual.kpis} />
      ) : null}

      {visual.kind === "bar" && visual.chart?.data?.length ? (
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={visual.chart.data}
              margin={{ top: 4, right: 4, left: -12, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey={visual.chart.xKey || "label"}
                tick={{ fontSize: 10 }}
                interval={0}
              />
              <YAxis tick={{ fontSize: 10 }} width={36} />
              <Tooltip />
              <Bar
                dataKey={visual.chart.series?.[0]?.key || "value"}
                radius={[4, 4, 0, 0]}
              >
                {visual.chart.data.map((_, i) => (
                  <Cell
                    key={`cell-${i}`}
                    fill={BAR_COLORS[i % BAR_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {visual.kind === "pie" && visual.chart?.data?.length ? (
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={visual.chart.data}
                dataKey={visual.chart.series?.[0]?.key || "value"}
                nameKey={visual.chart.xKey || "label"}
                innerRadius={36}
                outerRadius={58}
                paddingAngle={2}
              >
                {visual.chart.data.map((_, i) => (
                  <Cell
                    key={`pie-${i}`}
                    fill={BAR_COLORS[i % BAR_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {visual.kind === "table" && visual.table?.rows?.length ? (
        <div className="max-h-44 overflow-auto">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-border-default text-text-caption">
                {(visual.table.columns || []).map((c) => (
                  <th key={c.key} className="px-1.5 py-1 font-medium">
                    {c.label || c.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visual.table.rows.map((row, i) => (
                <tr key={i} className="border-b border-border-default/60">
                  {(visual.table?.columns || []).map((c) => (
                    <td key={c.key} className="px-1.5 py-1 tabular-nums">
                      {String(row[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {visual.kind === "line" && visual.chart?.data?.length ? (
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visual.chart.data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey={visual.chart.xKey || "label"}
                tick={{ fontSize: 10 }}
              />
              <YAxis tick={{ fontSize: 10 }} width={36} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey={visual.chart.series?.[0]?.key || "value"}
                stroke={BAR_COLORS[0]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {source ? (
        <p className="mt-2 text-[10px] text-text-caption">
          Source:{" "}
          {source === "semantic_layer"
            ? "semantic layer"
            : source === "campaign_sql"
              ? "campaign metrics"
              : "campaign data"}
        </p>
      ) : null}
    </div>
  );
}

/** CRM handoff: if visual missing, derive a simple KPI strip from findings.rows. */
export function deriveVisualFromFindings(
  analytics: StructuredAnalytics,
): StructuredAnalytics {
  if (analytics.visual?.kind) return analytics;
  const rows = analytics.findings?.rows;
  if (!rows?.length) return analytics;
  const kpis = rows.slice(0, 8).map((r) => ({
    label: String(r.label ?? r.name ?? "Value"),
    value: String(r.value ?? r.count ?? "—"),
  }));
  return {
    ...analytics,
    plan: analytics.plan || { source: analytics.audit?.source || "derived" },
    visual: {
      version: "1.0",
      kind: "kpi",
      title: analytics.findings?.summary?.slice(0, 48) || "Metrics",
      kpis,
    },
  };
}
