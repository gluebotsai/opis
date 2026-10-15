import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Gauge,
  MessagesSquare,
  Target,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";

import { DashboardForecastChart } from "@/components/dashboard/dashboard-forecast-chart";
import {
  CHART_PIE_SERIES,
  DashboardBarChart,
  DashboardChannelChart,
  DashboardKpiCard,
  DashboardSparklineChart,
} from "@/components/dashboard/dashboard-charts";
import { DASHBOARD_CHART_COLORS } from "@/components/dashboard/dashboard-card-theme";
import { cn } from "@/lib/utils";

export type PlotDataPoint = {
  label?: string;
  name?: string;
  value?: number;
  count?: number;
  [key: string]: unknown;
};

export type PlotKpi = {
  label: string;
  value: string | number;
  change?: string;
  sampleSize?: number;
  note?: string;
  caption?: string;
};

export type PlotChartData = {
  type?: "plot" | "chart";
  title: string;
  chartType: "line" | "bar" | "pie" | "kpi";
  data?: PlotDataPoint[];
  description?: string;
  kpis?: PlotKpi[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  peakHour?: string;
  peakHourEvidence?: { peakHour?: string | null; observedPeakHour?: string | null };
};

type KpiTheme = {
  icon: LucideIcon;
  iconClassName: string;
  caption: string;
};

const DEFAULT_KPI_THEME: KpiTheme = {
  icon: MessagesSquare,
  iconClassName: "bg-blue-100 text-blue-600",
  caption: "Selected period",
};

const KPI_THEMES: Array<{ match: RegExp; theme: KpiTheme }> = [
  {
    match: /resolution/,
    theme: {
      icon: CheckCircle2,
      iconClassName: "bg-emerald-100 text-emerald-600",
      caption: "Resolved from handled",
    },
  },
  {
    match: /first\s*response|avg\s*first/,
    theme: {
      icon: Clock3,
      iconClassName: "bg-cyan-100 text-cyan-600",
      caption: "Average after assignment",
    },
  },
  {
    match: /handle\s*time|aht/,
    theme: {
      icon: Gauge,
      iconClassName: "bg-violet-100 text-violet-600",
      caption: "Average assigned to end",
    },
  },
  {
    match: /sla/,
    theme: {
      icon: Target,
      iconClassName: "bg-amber-100 text-amber-600",
      caption: "First reply within 60s",
    },
  },
  {
    match: /transfer|hand-?off/,
    theme: {
      icon: ArrowUpRight,
      iconClassName: "bg-rose-100 text-rose-600",
      caption: "Conversations handed off",
    },
  },
  {
    match: /missed/,
    theme: {
      icon: AlertTriangle,
      iconClassName: "bg-rose-100 text-rose-600",
      caption: "Unique missed / agent demand",
    },
  },
  {
    match: /demand|unique missed/,
    theme: {
      icon: MessagesSquare,
      iconClassName: "bg-blue-100 text-blue-600",
      caption: "Queued conversations",
    },
  },
];

function kpiThemeForLabel(label: string): KpiTheme {
  const normalized = label.trim().toLowerCase();
  for (const entry of KPI_THEMES) {
    if (entry.match.test(normalized)) return entry.theme;
  }
  return DEFAULT_KPI_THEME;
}

const KPI_ACRONYMS = new Set(["ai", "aht", "kpi", "sla", "sms", "sql"]);

export function formatKpiLabel(label: string): string {
  return label
    .trim()
    .split(/(\s+|[-/])/)
    .map((part) => {
      if (!part || /^\s+$/.test(part) || part === "-" || part === "/") return part;
      const letters = part.replace(/[^A-Za-z]/g, "");
      if (KPI_ACRONYMS.has(letters.toLowerCase())) {
        return part.replace(/[A-Za-z]+/g, (chunk) =>
          KPI_ACRONYMS.has(chunk.toLowerCase()) ? chunk.toUpperCase() : chunk,
        );
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

function trendFromChange(change?: string): { label: string; positive: boolean } | undefined {
  if (!change?.trim()) return undefined;
  const text = change.trim();
  const positive = !text.startsWith("-") && !/down|decrease|↓/i.test(text);
  return {
    label: text.replace(/^[+-]/, "").trim(),
    positive,
  };
}

const ISO_DATE_LABEL_RE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?$/;

function numericPlotValue(item: PlotDataPoint): number {
  const raw = item.value ?? item.count ?? 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const match = String(raw).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function formatChartLabel(raw: string): string {
  const text = raw.trim();
  if (!text) return "Item";

  if (ISO_DATE_LABEL_RE.test(text)) {
    const date = text.includes("T") ? new Date(text) : new Date(`${text}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
    }
  }

  return text;
}

function plotCopy(plot: PlotChartData): string {
  return `${plot.title} ${plot.description ?? ""}`.toLowerCase();
}

const HOUR_RANGE_LABEL_RE = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

function isHandleTimePlot(plot: PlotChartData): boolean {
  return /handle.?time|aht|duration/.test(plotCopy(plot));
}

function isInboundHourlyPlot(plot: PlotChartData): boolean {
  const text = plotCopy(plot);
  return /inbound volume by hour|hourly inbound|peak hour/.test(text);
}

function forecastPointsFromPlot(plot: PlotChartData): Array<{
  label: string;
  actual?: number;
  forecast?: number;
}> | null {
  const data = plot.data ?? [];
  if (data.length === 0) return null;
  if (data.some((item) => typeof item.actual === "number" || typeof item.forecast === "number")) {
    return data.map((item) => ({
      label: formatChartLabel(String(item.label ?? item.name ?? "Item")),
      actual: typeof item.actual === "number" ? item.actual : undefined,
      forecast: typeof item.forecast === "number" ? item.forecast : undefined,
    }));
  }
  const hasActual = data.some((item) => String(item.series ?? "").toLowerCase() === "actual");
  const hasForecast = data.some((item) => String(item.series ?? "").toLowerCase() === "forecast");
  if (!hasActual || !hasForecast) return null;
  const byLabel = new Map<string, { label: string; actual?: number; forecast?: number }>();
  for (const item of data) {
    const label = formatChartLabel(String(item.label ?? item.name ?? "Item"));
    const current = byLabel.get(label) ?? { label };
    const series = String(item.series ?? "").toLowerCase();
    if (series === "actual") current.actual = numericPlotValue(item);
    if (series === "forecast") current.forecast = numericPlotValue(item);
    byLabel.set(label, current);
  }
  return [...byLabel.values()];
}

function isDurationKpi(text: string): boolean {
  return /handle\s*time|\baht\b|first\s*response|duration|wait\s*time|response\s*time/i.test(
    text,
  );
}

function durationEmptyCaption(label: string): string | null {
  if (!isDurationKpi(label)) return null;
  return /first\s*response/i.test(label)
    ? "No first replies in period"
    : "No completed handles in period";
}

function slaEmptyCaption(label: string): string | null {
  return /sla/i.test(label) ? "No first replies in period" : null;
}

function isRateKpi(text: string): boolean {
  return /rate|sla|percent/i.test(text);
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder > 0 ? `${hours}h ${minuteRemainder}m` : `${hours}h`;
}

const BARE_DURATION_UNIT_RE =
  /^(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)$/i;
const HAS_DISPLAY_UNIT_RE =
  /\d\s*(?:h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b|%/;

function formatKpiDisplayValue(label: string, value: string | number): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "—") return "—";
    const unitMatch = trimmed.match(BARE_DURATION_UNIT_RE);
    if (unitMatch) {
      const amount = Number(unitMatch[1]);
      const unit = (unitMatch[2] ?? "").toLowerCase();
      const seconds = unit.startsWith("h")
        ? amount * 3600
        : unit.startsWith("m")
          ? amount * 60
          : amount;
      return formatDuration(seconds);
    }
    if (HAS_DISPLAY_UNIT_RE.test(trimmed)) return trimmed;
    const numeric = Number(trimmed.replace(/,/g, ""));
    if (!Number.isFinite(numeric)) return trimmed;
    return formatKpiDisplayValue(label, numeric);
  }
  if (isDurationKpi(label)) return formatDuration(value);
  if (isRateKpi(label)) {
    const percent = value > 0 && value <= 1 ? value * 100 : value;
    const rounded = Math.round(percent * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded}%`;
  }
  return String(value);
}

function lineAxisTitle(plot: PlotChartData): string {
  if (plot.yAxisLabel?.trim()) return plot.yAxisLabel.trim();
  const text = plotCopy(plot);
  if (isHandleTimePlot(plot)) return "Average handle time";
  if (/factor|share/.test(text)) return "Share";
  if (isInboundHourlyPlot(plot) || /inbound/.test(text)) return "Inbound conversations";
  if (/missed/.test(text)) return "Missed rate (%)";
  if (/rate|percent|%/.test(text)) return "Rate (%)";
  return "Handled conversations";
}

function lineXAxisTitle(
  plot: PlotChartData,
  points: Array<{ label: string }>,
): string {
  if (plot.xAxisLabel?.trim()) return plot.xAxisLabel.trim();
  if (points.some((point) => HOUR_RANGE_LABEL_RE.test(point.label))) return "Hour of day";
  return "Date";
}

function barXAxisTitle(plot: PlotChartData, points: Array<{ label: string }>): string {
  const text = plotCopy(plot);
  if (/disposition|resolution|outcome/.test(text)) return "Disposition";
  if (/factor|share/.test(text)) return "Factor";
  if (points.some((point) => ISO_DATE_LABEL_RE.test(point.label))) return "Date";
  return "Category";
}

export function PlotChartCard({ plot }: { plot: PlotChartData }) {
  const points = useMemo(() => {
    return (plot.data ?? []).map((item) => {
      const series =
        typeof item.series === "string"
          ? item.series
          : typeof item.channel === "string"
            ? item.channel
            : undefined;
      return {
        label: formatChartLabel(String(item.label ?? item.name ?? "Item")),
        value: numericPlotValue(item),
        series: series?.trim() ? series : undefined,
      };
    });
  }, [plot.data]);

  const forecastPoints = useMemo(() => forecastPointsFromPlot(plot), [plot]);
  const kpiItems = useMemo((): PlotKpi[] => {
    if (plot.kpis && plot.kpis.length > 0) return plot.kpis;
    if (plot.chartType !== "kpi") return [];
    return (plot.data ?? []).map((item) => ({
      label: String(item.label ?? item.name ?? plot.title),
      value: (item.value ?? item.count ?? "") as string | number,
      change: typeof item.change === "string" ? item.change : undefined,
    }));
  }, [plot]);
  const isSingleKpi = plot.chartType === "kpi" && kpiItems.length === 1;
  const kpiCount = kpiItems.length;
  const subtitle =
    plot.description ||
    (plot.chartType === "pie"
      ? "Volume by channel"
      : plot.chartType === "line"
        ? "Trend over the selected period"
        : "Performance breakdown");

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {kpiItems.length > 0 ? (
        <div
          className={cn(
            "@container/kpis grid items-stretch gap-x-4 gap-y-4",
            isSingleKpi ? "grid-cols-1 max-w-[412px]" : "grid-cols-2 @[42rem]/kpis:grid-cols-3",
          )}
        >
          {kpiItems.map((kpi, idx) => {
            const theme = kpiThemeForLabel(kpi.label);
            const trend = trendFromChange(kpi.change);
            const emptyCaption =
              kpi.sampleSize === 0 || kpi.value === "—"
                ? durationEmptyCaption(kpi.label) ?? slaEmptyCaption(kpi.label)
                : null;
            return (
              <DashboardKpiCard
                key={idx}
                label={formatKpiLabel(kpi.label)}
                value={formatKpiDisplayValue(`${plot.title} ${kpi.label}`, kpi.value)}
                caption={
                  trend
                    ? "vs prior period"
                    : kpi.caption ?? emptyCaption ?? theme.caption
                }
                icon={theme.icon}
                iconClassName={theme.iconClassName}
                trend={trend}
              />
            );
          })}
        </div>
      ) : null}

      {plot.chartType === "line" && forecastPoints && forecastPoints.length > 0 ? (
        <DashboardForecastChart
          title={plot.title}
          subtitle={subtitle}
          info={subtitle}
          points={forecastPoints}
          xAxisLabel={lineXAxisTitle(plot, forecastPoints)}
          yAxisLabel={lineAxisTitle(plot)}
          highlightLabel={plot.peakHour ?? plot.peakHourEvidence?.peakHour ?? undefined}
          highlightSeries="forecast"
        />
      ) : plot.chartType === "line" && points.length > 0 ? (
        <DashboardSparklineChart
          title={plot.title}
          subtitle={subtitle}
          info={subtitle}
          points={points}
          color={isHandleTimePlot(plot) ? DASHBOARD_CHART_COLORS.lineSecondary : DASHBOARD_CHART_COLORS.line}
          formatValue={isHandleTimePlot(plot) ? formatDuration : (value) => String(value)}
          formatAxisValue={
            isHandleTimePlot(plot) ? (seconds) => `${Math.round(seconds / 3600)}h` : undefined
          }
          xAxisLabel={lineXAxisTitle(plot, points)}
          yAxisLabel={lineAxisTitle(plot)}
        />
      ) : null}

      {plot.chartType === "pie" && points.length > 0 ? (
        <DashboardChannelChart
          title={plot.title}
          subtitle={subtitle}
          info={subtitle}
          channels={points.map((item, index) => ({
            label: item.label,
            value: item.value,
            color: CHART_PIE_SERIES[index % CHART_PIE_SERIES.length]!,
          }))}
        />
      ) : null}

      {plot.chartType === "bar" && points.length > 0 ? (
        <DashboardBarChart
          title={plot.title}
          subtitle={subtitle}
          info={subtitle}
          items={points}
          xAxisLabel={barXAxisTitle(plot, points)}
          yAxisLabel={lineAxisTitle(plot)}
          formatValue={
            isHandleTimePlot(plot)
              ? formatDuration
              : /rate|percent|%/.test(plotCopy(plot))
                ? (value) => `${value}%`
                : undefined
          }
          formatAxisValue={
            isHandleTimePlot(plot)
              ? (seconds) => `${Math.round(seconds / 3600)}h`
              : /rate|percent|%/.test(plotCopy(plot))
                ? (value) => `${value}%`
                : undefined
          }
        />
      ) : null}

      {plot.chartType === "kpi" && kpiCount === 0 ? (
        <p className="py-4 text-center text-xs text-neutral-400">No data yet</p>
      ) : null}
    </div>
  );
}
