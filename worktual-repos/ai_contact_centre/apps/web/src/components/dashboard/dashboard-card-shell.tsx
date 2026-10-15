import type { ReactNode } from "react";

import {
  dashboardCardClassName,
  dashboardChartMetricClassName,
  dashboardChartMetricHintClassName,
  dashboardChartSubtitleClassName,
  dashboardChartTitleClassName,
} from "@/components/dashboard/dashboard-card-theme";
import { cn } from "@/lib/utils";

type DashboardCardShellProps = {
  children: ReactNode;
  className?: string;
};

export function DashboardCardShell({ children, className }: DashboardCardShellProps) {
  return <div className={cn(dashboardCardClassName, className)}>{children}</div>;
}

type DashboardCardHeaderProps = {
  title: string;
  subtitle?: string;
  metric?: ReactNode;
  metricHint?: string;
  className?: string;
};

export function DashboardCardHeader({
  title,
  subtitle,
  metric,
  metricHint,
  className,
}: DashboardCardHeaderProps) {
  return (
    <div className={cn("mb-3 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <p className={dashboardChartTitleClassName}>{title}</p>
        {subtitle ? <p className={dashboardChartSubtitleClassName}>{subtitle}</p> : null}
      </div>
      {metric != null ? (
        <div className="shrink-0 text-right">
          <p className={dashboardChartMetricClassName}>{metric}</p>
          {metricHint ? (
            <p className={dashboardChartMetricHintClassName}>{metricHint}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
