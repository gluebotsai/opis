/** Shared dashboard tile styling — cards only; page shell/back panel unchanged. */

export const dashboardCardClassName =
  "rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.09)]";

export const DASHBOARD_CHART_COLORS = {
  line: "#3b82f6",
  lineFill: "#bfdbfe",
  lineSecondary: "#fdba74",
  bar: "#11878a",
  barActive: "#0d7477",
  grid: "#e7e5e4",
  axis: "#a8a29e",
  purple: "#7c3aed",
  pink: "#db2777",
  yellow: "#f4c430",
  teal: "#11878a",
  blue: "#4f6bdc",
} as const;

export const DASHBOARD_SERIES_COLORS = [
  DASHBOARD_CHART_COLORS.teal,
  DASHBOARD_CHART_COLORS.pink,
  DASHBOARD_CHART_COLORS.purple,
  DASHBOARD_CHART_COLORS.yellow,
  DASHBOARD_CHART_COLORS.blue,
] as const;

export const dashboardChartTitleClassName =
  "text-[13px] font-semibold tracking-tight text-neutral-900";

export const dashboardChartSubtitleClassName = "mt-0.5 text-xs leading-snug text-neutral-600";

export const dashboardChartMetricClassName =
  "text-xl font-semibold tabular-nums tracking-tight text-neutral-900";

export const dashboardChartMetricHintClassName =
  "text-[10px] font-medium text-neutral-600";

export const dashboardKpiIconClassName =
  "flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-100";
