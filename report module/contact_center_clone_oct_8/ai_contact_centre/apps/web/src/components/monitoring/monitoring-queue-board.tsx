import type { MonitoringSnapshot } from "@/features/monitoring/api";

import { formatMonitoringDuration } from "./monitoring-utils";

export function MonitoringQueueBoard({
  queues,
  compact = false,
}: {
  queues: MonitoringSnapshot["queues"];
  compact?: boolean;
}) {
  if (queues.length === 0) {
    return (
      <div className="rounded-xl border-[0.6px] border-dashed border-[#bfbfbf] bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-600">
        No active queues configured.
      </div>
    );
  }

  return (
    <div className={compact ? "grid gap-2 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"}>
      {queues.map((queue) => (
        <div
          key={queue.id}
          className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-neutral-900">{queue.name}</p>
              <p className="mt-0.5 text-[11px] text-neutral-600">Queue operations</p>
            </div>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
              {queue.readyAgents} ready
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-neutral-600">Waiting</p>
              <p className="mt-1 text-lg font-semibold text-amber-700">{queue.waiting}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-neutral-600">Active</p>
              <p className="mt-1 text-lg font-semibold text-emerald-700">{queue.active}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-neutral-600">Bot</p>
              <p className="mt-1 text-lg font-semibold text-indigo-700">{queue.botActive}</p>
            </div>
          </div>

          <div className="mt-3 border-t-[0.6px] border-[#bfbfbf] pt-3">
            <p className="text-[10px] uppercase tracking-wide text-neutral-600">Longest wait</p>
            <p className="mt-1 text-sm font-medium text-neutral-800">
              {formatMonitoringDuration(queue.oldestWaitSeconds)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
