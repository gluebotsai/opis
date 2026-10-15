import { Activity, LoaderCircle, Monitor } from "lucide-react";
import { RefreshIcon } from "@/components/ui/refresh-icon";

import type { MonitoringSnapshot } from "@/features/monitoring/api";
import { cn } from "@/lib/utils";

import { MonitoringAgentGrid } from "./monitoring-agent-grid";
import { MonitoringAlertsPanel } from "./monitoring-alerts-panel";
import { MonitoringConversationsTable } from "./monitoring-conversations-table";
import { MonitoringQueueBoard } from "./monitoring-queue-board";
import { MonitoringSnapshotHeader } from "./monitoring-snapshot-header";

type MonitoringLivePanelProps = {
  snapshot: MonitoringSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  liveConnected: boolean;
  wallboard: boolean;
  onRefresh: () => void;
};

export function MonitoringLivePanel({
  snapshot,
  loading,
  refreshing,
  error,
  liveConnected,
  wallboard,
  onRefresh,
}: MonitoringLivePanelProps) {
  if (loading && !snapshot) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-neutral-600">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        Loading live monitoring…
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
        <Activity className="size-7 text-neutral-300" />
        <p className="mt-3 text-sm font-medium text-neutral-800">Live monitoring unavailable</p>
        <p className="mt-1 max-w-sm text-xs text-neutral-600">{error}</p>
      </div>
    );
  }

  if (!snapshot) return null;

  const updatedAt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(snapshot.generatedAt));

  return (
    <div className={cn("space-y-4", wallboard && "space-y-5")}>
      <MonitoringSnapshotHeader summary={snapshot.summary} compact={wallboard} />

      <div className={cn("grid gap-4", wallboard ? "xl:grid-cols-1" : "xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]")}>
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-neutral-900">Queue operations</p>
              <p className="text-[11px] text-neutral-600">Waiting, active, and bot workload by queue</p>
            </div>
          </div>
          <MonitoringQueueBoard queues={snapshot.queues} compact={wallboard} />
        </section>

        <section className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-neutral-900">Agent state</p>
            <p className="text-[11px] text-neutral-600">Presence and channel capacity utilization</p>
          </div>
          <MonitoringAgentGrid agents={snapshot.agents} compact={wallboard} />
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-neutral-900">Active conversations</p>
            <p className="text-[11px] text-neutral-600">Org-wide open workload with supervisor actions</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-neutral-600">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
                liveConnected ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600",
              )}
            >
              <Monitor className="size-3" />
              {liveConnected ? "Live" : "Polling"}
            </span>
            <span>Updated {updatedAt}</span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-md border-[0.6px] border-[#bfbfbf] px-2 py-1 font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              <RefreshIcon className={cn("size-3", refreshing && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>
        <MonitoringConversationsTable conversations={snapshot.conversations} onActionComplete={onRefresh} />
      </section>

      <MonitoringAlertsPanel alerts={snapshot.alerts} />
    </div>
  );
}
