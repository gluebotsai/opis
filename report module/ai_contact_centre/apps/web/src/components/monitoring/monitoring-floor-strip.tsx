import type { MonitoringSnapshot } from "@/features/monitoring/api";
import { cn } from "@/lib/utils";

import { MetricTile } from "./monitoring-utils";

export function MonitoringFloorStrip({
  summary,
}: {
  summary: MonitoringSnapshot["summary"];
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      <MetricTile compact label="Waiting" value={summary.waiting} tone={summary.waiting > 0 ? "warning" : "neutral"} />
      <MetricTile compact label="Active" value={summary.active} tone="success" />
      <MetricTile compact label="Ready" value={summary.readyAgents} tone={summary.readyAgents > 0 ? "success" : "warning"} />
      <MetricTile compact label="SLA risk" value={summary.slaAtRisk} tone={summary.slaAtRisk > 0 ? "warning" : "neutral"} />
      <MetricTile compact label="Breached" value={summary.slaBreached} tone={summary.slaBreached > 0 ? "critical" : "neutral"} />
      <MetricTile compact label="Ringing" value={summary.offersRinging} tone={summary.offersRinging > 0 ? "warning" : "neutral"} />
    </div>
  );
}

export function MonitoringAlertsStrip({
  alerts,
  onSelectAlert,
}: {
  alerts: MonitoringSnapshot["alerts"];
  onSelectAlert?: (alert: MonitoringSnapshot["alerts"][number]) => void;
}) {
  if (alerts.length === 0) return null;

  const visible = alerts.slice(0, 4);

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">
        Alerts ({alerts.length})
      </p>
      <ul className="space-y-1">
        {visible.map((alert) => (
          <li key={alert.id}>
            <button
              type="button"
              onClick={() => onSelectAlert?.(alert)}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors hover:opacity-90",
                alert.severity === "critical"
                  ? "border-rose-200 bg-rose-50/80"
                  : "border-amber-200 bg-amber-50/80",
              )}
            >
              <span
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  alert.severity === "critical" ? "bg-rose-500" : "bg-amber-500",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold text-neutral-900">
                  {alert.title}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-neutral-600">
                  {alert.detail}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {alerts.length > visible.length ? (
        <p className="text-[10px] text-neutral-400">+{alerts.length - visible.length} more</p>
      ) : null}
    </div>
  );
}
