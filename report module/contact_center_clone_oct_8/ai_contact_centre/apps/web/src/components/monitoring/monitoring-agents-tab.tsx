import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { PanelRefreshButton } from "@/components/assistant/copilot-workspace";

import type {
  LiveAgent,
  LiveAgentConversation,
} from "@/features/monitoring/types";
import { monitoringApi } from "@/features/monitoring/api";
import {
  agentPresenceLabel,
  agentPresenceTone,
  matchesAgentPresenceFilter,
  resolveMonitoringAgentPresence,
  type AgentPresenceFilter,
} from "@/components/monitoring/monitoring-utils";
import { NativeSelectSm } from "@/components/ui/native-select";

import {
  MonitoringEmptyState,
  MonitoringFilterPills,
  MonitoringList,
  MonitoringListRow,
  MonitoringTabShell,
  StatusBadge,
} from "./monitoring-shared";
import { MonitoringAgentDetailPanel } from "./monitoring-agent-detail-panel";

const STATUS_FILTERS: Array<{ id: AgentPresenceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "busy", label: "Busy" },
  { id: "away", label: "Away" },
  { id: "not_ready", label: "Not Ready" },
  { id: "break", label: "Break" },
  { id: "offline", label: "Offline" },
];

function collectQueueOptions(agents: LiveAgent[]): string[] {
  const names = new Set<string>();
  for (const agent of agents) {
    for (const queue of agent.queues) {
      names.add(queue);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function MonitoringAgentsTab({
  agents,
  pulse,
  selectedAgentId,
  onSelectedAgentIdChange,
  focusAgentId,
  onFocusAgentHandled,
  onSelectConversation,
  onRefresh,
  refreshing = false,
}: {
  agents: LiveAgent[];
  pulse: number;
  selectedAgentId: string | null;
  onSelectedAgentIdChange: (id: string | null) => void;
  focusAgentId?: string | null;
  onFocusAgentHandled?: () => void;
  onSelectConversation: (agent: LiveAgent, conversation: LiveAgentConversation) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<AgentPresenceFilter>("all");
  const [queueFilter, setQueueFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const roster = useMemo(
    () => agents.filter((agent) => agent.canReceiveCallback !== false),
    [agents],
  );

  const queueOptions = useMemo(
    () => [
      { id: "all", label: "All queues" },
      ...collectQueueOptions(roster).map((queue) => ({ id: queue, label: queue })),
    ],
    [roster],
  );

  const statusFilterOptions = useMemo(
    () =>
      STATUS_FILTERS.map((item) => ({
        id: item.id,
        label: item.label,
        count:
          item.id === "all"
            ? roster.length
            : roster.filter((agent) =>
                matchesAgentPresenceFilter(resolveMonitoringAgentPresence(agent), item.id),
              ).length,
      })),
    [roster],
  );

  useEffect(() => {
    if (!selectedAgentId) setLogoutError(null);
  }, [selectedAgentId]);

  useEffect(() => {
    if (!focusAgentId) return;
    const matched = roster.find(
      (agent) => agent.id === focusAgentId || agent.agentId === focusAgentId,
    );
    if (matched) {
      onSelectedAgentIdChange(matched.id);
      onFocusAgentHandled?.();
    }
  }, [focusAgentId, roster, onFocusAgentHandled, onSelectedAgentIdChange]);

  const filtered = useMemo(
    () =>
      roster.filter((agent) => {
        const presence = resolveMonitoringAgentPresence(agent);
        if (statusFilter !== "all" && !matchesAgentPresenceFilter(presence, statusFilter)) {
          return false;
        }
        if (queueFilter !== "all" && !agent.queues.includes(queueFilter)) return false;
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          if (!agent.name.toLowerCase().includes(q) && !agent.initials.toLowerCase().includes(q)) {
            return false;
          }
        }
        return true;
      }),
    [roster, statusFilter, queueFilter, search],
  );

  const selectedAgent = roster.find((agent) => agent.id === selectedAgentId) ?? null;

  async function handleLogoutAgent(agent: LiveAgent) {
    if (!window.confirm(`Log out ${agent.name}? They will be signed out and marked offline.`)) {
      return;
    }
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await monitoringApi.logoutAgent(agent.agentId);
      onSelectedAgentIdChange(null);
      onRefresh?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to log out agent.";
      setLogoutError(message);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <>
      {selectedAgent ? (
        <MonitoringAgentDetailPanel
          agent={selectedAgent}
          loggingOut={loggingOut}
          logoutError={logoutError}
          onLogout={() => void handleLogoutAgent(selectedAgent)}
          onSelectConversation={(conversation) => onSelectConversation(selectedAgent, conversation)}
          onBack={() => onSelectedAgentIdChange(null)}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      ) : (
      <MonitoringTabShell
        toolbar={
          <div className="space-y-4">
            <div className="flex min-w-0 w-full items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-neutral-900" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search agent…"
                  className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 pr-3 pl-9 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200"
                />
              </div>
              <NativeSelectSm
                value={queueFilter}
                onChange={(event) => setQueueFilter(event.target.value)}
                aria-label="Filter by queue"
                wrapperClassName="w-36 shrink-0 sm:w-40"
                className="h-[38px] w-36 bg-neutral-50 text-sm text-neutral-700 focus:bg-white sm:w-40"
              >
                {queueOptions.map((queue) => (
                  <option key={queue.id} value={queue.id}>
                    {queue.label}
                  </option>
                ))}
              </NativeSelectSm>
              {onRefresh ? (
                <PanelRefreshButton
                  className="xl:hidden"
                  onClick={onRefresh}
                  refreshing={refreshing}
                />
              ) : null}
            </div>
            <MonitoringFilterPills
              value={statusFilter}
              options={statusFilterOptions}
              onChange={setStatusFilter}
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <MonitoringEmptyState
            title="No agents match"
            description="Try another search, queue, or status filter."
          />
        ) : (
          <MonitoringList key={pulse} layout="list">
            {filtered.map((agent) => {
              const presence = resolveMonitoringAgentPresence(agent);
              const employeeId = agent.employeeId?.trim();
              const queues = agent.queues.join(" · ");
              const subtitle = [employeeId, queues].filter(Boolean).join(" · ");

              return (
                <MonitoringListRow
                  key={agent.id}
                  seed={agent.id}
                  initials={agent.initials}
                  title={agent.name}
                  subtitle={subtitle || undefined}
                  badges={
                    <StatusBadge
                      label={agent.attendanceToday === "present" ? "Present" : "Absent"}
                      tone={agent.attendanceToday === "present" ? "success" : "neutral"}
                    />
                  }
                  trailing={
                    <StatusBadge
                      label={agentPresenceLabel(presence)}
                      tone={agentPresenceTone(presence)}
                    />
                  }
                  selected={selectedAgentId === agent.id}
                  layout="list"
                  onClick={() => onSelectedAgentIdChange(agent.id)}
                />
              );
            })}
          </MonitoringList>
        )}
      </MonitoringTabShell>
      )}
    </>
  );
}
