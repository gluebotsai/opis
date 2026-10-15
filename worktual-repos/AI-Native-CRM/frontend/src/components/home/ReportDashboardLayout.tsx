import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, TrendingUp, type LucideIcon } from "lucide-react";
import {
  WORKTUAL_CHART_CARD,
  WORKTUAL_HEADER_CONTROL,
  WORKTUAL_HAIRLINE,
  WORKTUAL_KPI_ICON_TONES,
  WORKTUAL_REPORT_SURFACE,
  WorktualChartCard,
  WorktualKpiCard,
  WorktualSegmentControl,
} from "@/components/home/worktual-dashboard-shell";

export const REPORT_SURFACE_CLASS = WORKTUAL_REPORT_SURFACE;
export const REPORT_GRID_CLASS =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 @[42rem]/kpis:grid-cols-3";

const PERIOD_PILLS = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
  { value: "quarter", label: "Quarter" },
] as const;

export const REPORT_HEADER_CONTROL_SHELL = WORKTUAL_HEADER_CONTROL;

export { WORKTUAL_KPI_ICON_TONES as KPI_ICON_TONES };

export function ReportsHeader({
  period,
  busy,
  onPeriodChange,
  onViewAnalytics,
  analyticsRefreshing,
}: {
  period?: string;
  periodLabel?: string;
  busy?: boolean;
  onPeriodChange?: (value: string) => void;
  onViewAnalytics?: () => void;
  analyticsRefreshing?: boolean;
}) {
  const showPeriodControls = period != null && onPeriodChange != null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {onViewAnalytics ? (
        <button
          type="button"
          disabled={busy || analyticsRefreshing}
          onClick={onViewAnalytics}
          aria-label={analyticsRefreshing ? "Refreshing analytics" : "Refresh analytics"}
          title={analyticsRefreshing ? "Refreshing…" : "Refresh"}
          className={`${REPORT_HEADER_CONTROL_SHELL} w-[38px] justify-center text-neutral-600 transition-colors hover:border-neutral-300 hover:text-neutral-900 disabled:opacity-50`}
        >
          <RefreshCw
            size={18}
            className={`shrink-0 ${analyticsRefreshing ? "animate-spin" : ""}`}
            strokeWidth={2.25}
          />
        </button>
      ) : null}
      {showPeriodControls ? (
        <WorktualSegmentControl
          value={period}
          options={[...PERIOD_PILLS]}
          disabled={busy}
          ariaLabel="Report period"
          onChange={onPeriodChange}
        />
      ) : null}
    </div>
  );
}

export function ReportKpiCard({
  label,
  value,
  hint,
  infoTooltip,
  href,
  icon,
  iconClassName,
  changePct,
  compareLabel,
}: {
  label: string;
  value: string;
  hint?: string;
  infoTooltip?: string;
  href?: string;
  icon: LucideIcon;
  iconClassName?: string;
  changePct?: number | null;
  compareLabel?: string;
}) {
  if (href) {
    return (
      <Link to={href} className="block h-full">
        <WorktualKpiCard
          label={label}
          value={value}
          hint={hint}
          infoTooltip={infoTooltip}
          icon={icon}
          iconClassName={iconClassName}
          changePct={changePct}
          compareLabel={compareLabel}
        />
      </Link>
    );
  }
  return (
    <WorktualKpiCard
      label={label}
      value={value}
      hint={hint}
      infoTooltip={infoTooltip}
      icon={icon}
      iconClassName={iconClassName}
      changePct={changePct}
      compareLabel={compareLabel}
    />
  );
}

export function ReportChartCard({
  title,
  headline,
  subtitle,
  children,
}: {
  title: string;
  headline?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <WorktualChartCard title={title} headline={headline} subtitle={subtitle}>
      {children}
    </WorktualChartCard>
  );
}

export function ReportTrendChip({
  label,
  positive,
}: {
  label: string;
  positive?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
        positive
          ? "bg-emerald-50 text-emerald-600"
          : "bg-neutral-100 text-neutral-600"
      }`}
    >
      {positive ? (
        <TrendingUp className="size-2.5" strokeWidth={2.25} />
      ) : null}
      {label}
    </span>
  );
}

export { WORKTUAL_HAIRLINE, WORKTUAL_CHART_CARD };
