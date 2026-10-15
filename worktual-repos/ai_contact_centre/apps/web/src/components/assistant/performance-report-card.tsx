import { useMemo } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Gauge,
  Target,
} from "lucide-react";

import { PlotChartCard } from "@/components/assistant/plot-chart-card";
import { DashboardBarChart } from "@/components/dashboard/dashboard-charts";
import { listRowDividerClassName } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";

export type PerformanceReportData = {
  type?: "performance_report";
  title: string;
  range?: string;
  period?: { start?: string; end?: string };
  kpis?: {
    handled?: number;
    handledChangePercent?: number | null;
    resolutionRate?: number;
    avgFirstResponseSeconds?: number | null;
    avgHandleSeconds?: number | null;
    slaRate?: number;
    transferred?: number;
    firstResponseCount?: number;
    withinSlaCount?: number;
  };
  daily?: Array<{ date: string; handled: number; avgHandleSeconds?: number }>;
  channels?: Array<{ label: string; value: number }>;
  dispositions?: Array<{ label: string; value: number }>;
  recent?: Array<{
    id: string;
    channel: string;
    status: string;
    subject: string | null;
    disposition: string | null;
    assignedAt: string | null;
  }>;
};

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPeriod(period?: { start?: string; end?: string }): string {
  if (!period?.start || !period?.end) return "";
  const start = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(period.start));
  const end = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(period.end));
  return `${start} – ${end}`;
}

function formatTrend(change: number | null | undefined): string | undefined {
  if (change === null || change === undefined) return undefined;
  return `${change > 0 ? "+" : ""}${change}%`;
}

export function PerformanceReportCard({ report }: { report: PerformanceReportData }) {
  const kpis = report.kpis ?? {};
  const periodLabel = formatPeriod(report.period);

  const dailyPlot = useMemo(() => {
    const daily = report.daily ?? [];
    if (!daily.length) return null;
    return {
      title: "Handled conversations",
      chartType: "line" as const,
      description: "Daily completed workload",
      data: daily.map((d) => ({
        label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
          new Date(`${d.date}T00:00:00`),
        ),
        value: d.handled,
      })),
    };
  }, [report.daily]);

  const channelPlot = useMemo(() => {
    const channels = report.channels ?? [];
    if (!channels.length) return null;
    return {
      title: "Channel mix",
      chartType: "pie" as const,
      description: "Assigned conversations by channel",
      data: channels.map((c) => ({ label: c.label, value: c.value })),
    };
  }, [report.channels]);

  const kpiMetrics = [
    {
      label: "Handled",
      value: kpis.handled ?? 0,
      caption: "Completed workload",
      icon: Activity,
      iconClassName: "bg-blue-50 text-blue-600",
      tileClassName: "border-blue-100 bg-blue-50/50",
      trend: formatTrend(kpis.handledChangePercent),
      trendPositive: (kpis.handledChangePercent ?? 0) >= 0,
    },
    {
      label: "Resolution",
      value: `${kpis.resolutionRate ?? 0}%`,
      caption: "Resolved conversations",
      icon: CheckCircle2,
      iconClassName: "bg-emerald-50 text-emerald-600",
      tileClassName: "border-emerald-100 bg-emerald-50/50",
    },
    {
      label: "Handle time",
      value: formatDuration(kpis.avgHandleSeconds),
      caption:
        kpis.avgHandleSeconds == null ? "No completed handles in period" : "Average per conversation",
      icon: Clock3,
      iconClassName: "bg-violet-50 text-violet-600",
      tileClassName: "border-violet-100 bg-violet-50/50",
    },
    {
      label: "First-Reply SLA",
      value:
        (kpis.firstResponseCount ?? 0) > 0 ? `${kpis.slaRate ?? 0}%` : "—",
      caption:
        (kpis.firstResponseCount ?? 0) > 0
          ? `${kpis.withinSlaCount ?? 0} of ${kpis.firstResponseCount} first replies`
          : "No first replies in period",
      icon: Target,
      iconClassName: "bg-amber-50 text-amber-600",
      tileClassName: "border-amber-100 bg-amber-50/50",
    },
    {
      label: "First response",
      value: formatDuration(kpis.avgFirstResponseSeconds),
      caption:
        kpis.avgFirstResponseSeconds == null
          ? "No first replies in period"
          : "Average first reply",
      icon: Gauge,
      iconClassName: "bg-cyan-50 text-cyan-600",
      tileClassName: "border-cyan-100 bg-cyan-50/50",
    },
    {
      label: "Transferred",
      value: kpis.transferred ?? 0,
      caption: "Escalated conversations",
      icon: Activity,
      iconClassName: "bg-rose-50 text-rose-600",
      tileClassName: "border-rose-100 bg-rose-50/50",
    },
  ];

  return (
    <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-2xs text-left">
      <div className="border-b-[0.6px] border-[#bfbfbf] pb-3">
        <p className="text-sm font-semibold text-neutral-900">{report.title}</p>
        {periodLabel ? (
          <p className="mt-0.5 text-[11px] text-neutral-600">{periodLabel}</p>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {kpiMetrics.map((metric) => (
          <div
            key={metric.label}
            className={`rounded-xl border p-2.5 ${metric.tileClassName}`}
          >
            <div className="flex items-start justify-between gap-1">
              <span
                className={`flex size-[38px] items-center justify-center rounded-xl ${metric.iconClassName}`}
              >
                <metric.icon className="size-6" aria-hidden />
              </span>
              {metric.trend ? (
                <span
                  className={`text-[9px] font-medium ${
                    metric.trendPositive ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {metric.trend}
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-[9px] font-medium uppercase tracking-[0.08em] text-neutral-600">
              {metric.label}
            </p>
            <p className="text-base font-semibold tabular-nums text-neutral-900">{metric.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        {dailyPlot ? <PlotChartCard plot={dailyPlot} /> : null}
        {channelPlot ? <PlotChartCard plot={channelPlot} /> : null}
      </div>

      {(report.dispositions ?? []).length > 0 ? (
        <div className="mt-3">
          <DashboardBarChart
            title="Resolution outcomes"
            subtitle="How conversations were closed"
            info="Final disposition labels applied when conversations were closed in the selected period."
            items={report.dispositions ?? []}
          />
        </div>
      ) : null}

      {(report.recent ?? []).length > 0 ? (
        <div className="mt-3 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3">
          <p className="text-sm font-semibold text-neutral-900">Recent conversations</p>
          <p className="mt-0.5 text-sm text-neutral-600">Latest handled workload</p>
          <div className="mt-2">
            {(report.recent ?? []).slice(0, 5).map((item) => (
              <div
                key={item.id}
                className={cn("flex items-center gap-2 py-2 text-sm", listRowDividerClassName())}
              >
                <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-sm font-medium uppercase text-neutral-600">
                  {item.channel}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-700">
                  {item.subject || "No subject"}
                </span>
                <span className="shrink-0 text-neutral-400">{formatDate(item.assignedAt)}</span>
                {item.disposition ? (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-sm font-medium text-emerald-700">
                    {item.disposition}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
