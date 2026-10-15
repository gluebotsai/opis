import { AlertTriangle, BellRing } from "lucide-react";

import type { MonitoringSnapshot } from "@/features/monitoring/api";
import { cn } from "@/lib/utils";

export function MonitoringAlertsPanel({
  alerts,
}: {
  alerts: MonitoringSnapshot["alerts"];
}) {
  const visible = alerts.filter((alert) => alert.type !== "sentiment_very_negative");
  if (visible.length === 0) {
    return (
      <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4">
        <div className="flex items-center gap-2">
          <BellRing className="size-4 text-emerald-600" />
          <p className="text-sm font-semibold text-neutral-900">Alerts</p>
        </div>
        <p className="mt-3 text-sm text-neutral-600">No active SLA, wait, or offer alerts.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="size-4 text-amber-600" />
        <p className="text-sm font-semibold text-neutral-900">Alerts</p>
        <span className="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          {visible.length}
        </span>
      </div>
      <div className="space-y-2">
        {visible.map((alert) => (
          <div
            key={alert.id}
            className={cn(
              "rounded-lg border px-3 py-2.5",
              alert.severity === "critical"
                ? "border-rose-200 bg-rose-50/70"
                : "border-amber-200 bg-amber-50/70",
            )}
          >
            <p className="text-xs font-semibold text-neutral-900">{alert.title}</p>
            <p className="mt-0.5 text-[11px] text-neutral-600">{alert.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
