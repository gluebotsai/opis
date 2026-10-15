import type { MonitoringSnapshot } from "@/features/monitoring/api";

import { channelLabel, agentPresenceLabel, presenceBadgeClass } from "./monitoring-utils";

function capacitySummary(agent: MonitoringSnapshot["agents"][number]): string {
  if (agent.capacity.length === 0) return "—";
  return agent.capacity
    .map((row) => {
      const used = row.active + row.reserved;
      return `${channelLabel(row.channel)} ${used}/${row.max}`;
    })
    .join(" · ");
}

export function MonitoringAgentGrid({
  agents,
  compact = false,
}: {
  agents: MonitoringSnapshot["agents"];
  compact?: boolean;
}) {
  if (agents.length === 0) {
    return (
      <div className="rounded-xl border-[0.6px] border-dashed border-[#bfbfbf] bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-600">
        No agents found for this organization.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b-[0.6px] border-[#bfbfbf] bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-600">
            <tr>
              <th className="px-3 py-2.5 font-medium">Agent</th>
              <th className="px-3 py-2.5 font-medium">Presence</th>
              <th className="px-3 py-2.5 font-medium">Queues</th>
              <th className="px-3 py-2.5 font-medium">Capacity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#bfbfbf]">
            {agents.map((agent) => (
              <tr key={agent.agentId} className="hover:bg-neutral-50/80">
                <td className="px-3 py-2.5">
                  <p className={compact ? "text-xs font-medium text-neutral-900" : "font-medium text-neutral-900"}>
                    {agent.name}
                  </p>
                  {!compact ? (
                    <p className="text-[11px] text-neutral-600">{agent.email}</p>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${presenceBadgeClass(agent.presence)}`}
                  >
                    {agentPresenceLabel(agent.presence)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-neutral-600">
                  {agent.queueNames.length ? agent.queueNames.join(", ") : "—"}
                </td>
                <td className="px-3 py-2.5 text-xs text-neutral-600">{capacitySummary(agent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
