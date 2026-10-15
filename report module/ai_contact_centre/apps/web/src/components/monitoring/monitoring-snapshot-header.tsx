import type { MonitoringSnapshot } from "@/features/monitoring/api";

import { MetricTile } from "./monitoring-utils";

export function MonitoringSnapshotHeader({
  summary,
  compact = false,
}: {
  summary: MonitoringSnapshot["summary"];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "grid grid-cols-2 gap-2 xl:grid-cols-4" : "grid grid-cols-2 gap-3 xl:grid-cols-4 2xl:grid-cols-8"}>
      <MetricTile
        compact={compact}
        label="Waiting"
        value={summary.waiting}
        caption="Queued for agent"
        tone={summary.waiting > 0 ? "warning" : "neutral"}
      />
      <MetricTile
        compact={compact}
        label="Active"
        value={summary.active}
        caption="With agents now"
        tone="success"
      />
      <MetricTile
        compact={compact}
        label="Bot active"
        value={summary.botActive}
        caption="AI handling"
      />
      <MetricTile
        compact={compact}
        label="Ready agents"
        value={summary.readyAgents}
        caption={`${summary.loggedInAgents} logged in`}
        tone={summary.readyAgents > 0 ? "success" : "warning"}
      />
      <MetricTile
        compact={compact}
        label="SLA at risk"
        value={summary.slaAtRisk}
        tone={summary.slaAtRisk > 0 ? "warning" : "neutral"}
      />
      <MetricTile
        compact={compact}
        label="SLA breached"
        value={summary.slaBreached}
        tone={summary.slaBreached > 0 ? "critical" : "neutral"}
      />
      <MetricTile
        compact={compact}
        label="Offers ringing"
        value={summary.offersRinging}
        tone={summary.offersRinging > 0 ? "warning" : "neutral"}
      />
      <MetricTile
        compact={compact}
        label="Live load"
        value={summary.waiting + summary.active + summary.botActive}
        caption="Open conversations"
      />
    </div>
  );
}
