import type { AnalyticsVisual } from "@/services/agent-stream";
import type { PlotPoint } from "@/components/analytics/AnalyticsPlotCard";

export function chartPointsFromVisual(visual: AnalyticsVisual): PlotPoint[] {
  const chart = visual.chart;
  if (!chart?.data?.length) return [];
  const xKey = chart.xKey;
  const valueKey = chart.series[0]?.key ?? "count";
  return chart.data.flatMap((row) => {
    const raw = row[valueKey];
    if (raw == null || raw === "") return [];
    const value = Number(raw);
    if (!Number.isFinite(value)) return [];
    return [{ label: String(row[xKey] ?? "Item"), value }];
  });
}
