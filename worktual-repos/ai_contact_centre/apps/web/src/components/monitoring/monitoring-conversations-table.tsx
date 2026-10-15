import { useMemo, useState } from "react";
import { LoaderCircle, MoreHorizontal } from "lucide-react";

import type { MonitoringSnapshot } from "@/features/monitoring/api";
import { monitoringApi } from "@/features/monitoring/api";
import { cn } from "@/lib/utils";
import { nativeSelectSmClassName } from "@/components/ui/native-select";

import { MonitoringChannelIcon } from "@/components/monitoring/monitoring-channel-icon";
import { normalizeMonitoringChannel } from "@/features/monitoring/channel-utils";
import {
  channelLabel,
  formatMonitoringDuration,
  slaBadgeClass,
} from "./monitoring-utils";

export function MonitoringConversationsTable({
  conversations,
  onActionComplete,
}: {
  conversations: MonitoringSnapshot["conversations"];
  onActionComplete: () => void;
}) {
  const [queueFilter, setQueueFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const queueOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const row of conversations) {
      if (row.queueId && row.queueName) names.set(row.queueId, row.queueName);
    }
    return [...names.entries()].map(([id, name]) => ({ id, name }));
  }, [conversations]);

  const filtered = useMemo(
    () =>
      conversations.filter((row) => {
        if (queueFilter !== "all" && row.queueId !== queueFilter) return false;
        if (statusFilter !== "all" && row.status !== statusFilter) return false;
        return true;
      }),
    [conversations, queueFilter, statusFilter],
  );

  async function runAction(
    conversationId: string,
    action: "takeover" | "force-close",
  ) {
    const reason =
      action === "takeover"
        ? "Supervisor takeover from live monitoring"
        : "Supervisor force close from live monitoring";
    setBusyId(conversationId);
    setActionError(null);
    try {
      if (action === "takeover") {
        await monitoringApi.supervisorTakeover(conversationId, reason);
      } else {
        await monitoringApi.supervisorForceClose(conversationId, reason);
      }
      onActionComplete();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Supervisor action failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b-[0.6px] border-[#bfbfbf] px-3 py-2.5">
        <select
          value={queueFilter}
          onChange={(event) => setQueueFilter(event.target.value)}
          className={nativeSelectSmClassName("py-1.5 text-neutral-700")}
        >
          <option value="all">All queues</option>
          {queueOptions.map((queue) => (
            <option key={queue.id} value={queue.id}>
              {queue.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className={nativeSelectSmClassName("py-1.5 text-neutral-700")}
        >
          <option value="all">All statuses</option>
          <option value="queued">Queued</option>
          <option value="assigned">Assigned</option>
          <option value="active">Active</option>
          <option value="bot_active">Bot active</option>
        </select>
        <span className="ml-auto text-[11px] text-neutral-600">{filtered.length} open</span>
      </div>

      {actionError ? (
        <div className="border-b border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {actionError}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b-[0.6px] border-[#bfbfbf] bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-600">
            <tr>
              <th className="px-3 py-2.5 font-medium">Customer</th>
              <th className="px-3 py-2.5 font-medium">Channel</th>
              <th className="px-3 py-2.5 font-medium">Queue</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Wait</th>
              <th className="px-3 py-2.5 font-medium">Agent</th>
              <th className="px-3 py-2.5 font-medium">SLA</th>
              <th className="px-3 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#bfbfbf]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-neutral-600">
                  No open conversations match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.id} className="hover:bg-neutral-50/80">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-neutral-900">
                      {row.subject ?? row.visitorId ?? `Conversation ${row.id}`}
                    </p>
                    <p className="text-[11px] text-neutral-600">#{row.id}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-neutral-700">
                    <span className="inline-flex items-center gap-1.5">
                      <MonitoringChannelIcon
                        channel={normalizeMonitoringChannel(row.channel)}
                        className="size-4"
                      />
                      {channelLabel(row.channel)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-neutral-700">
                    {row.queueName ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                      {row.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-neutral-700">
                    {formatMonitoringDuration(row.waitSeconds)}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-neutral-700">
                    {row.assignedAgentName ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.slaStatus ? (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                          slaBadgeClass(row.slaStatus),
                        )}
                      >
                        {row.slaStatus}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void runAction(row.id, "takeover")}
                        className="rounded-md border-[0.6px] border-[#bfbfbf] px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        Takeover
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void runAction(row.id, "force-close")}
                        className="rounded-md border border-rose-200 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        Close
                      </button>
                      {busyId === row.id ? (
                        <LoaderCircle className="size-3.5 animate-spin text-neutral-400" />
                      ) : (
                        <MoreHorizontal className="size-3.5 text-neutral-300" aria-hidden />
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
