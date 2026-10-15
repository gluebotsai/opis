import { Search, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import { PanelExpandButton, PanelRefreshButton, useCopilotWorkspacePanels } from "@/components/assistant/copilot-workspace";
import { QueuesListSkeleton } from "@/components/workforce/queue-summary-skeleton";
import { Button } from "@/components/ui/button";
import { NativeSelectSm } from "@/components/ui/native-select";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { StatusBanner } from "@/components/ui/status-banner";
import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import { StatusToggle } from "@/features/workforce/queues/status-toggle";
import type { Queue, QueueAgent, QueueStatus } from "@/features/workforce/queues/types";
import type { WorkspaceChannel } from "@/features/workspace/types";
import { cn } from "@/lib/utils";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";

const CHANNEL_TO_WORKSPACE: Record<string, WorkspaceChannel> = {
  Voice: "voice",
  Chat: "chat",
  Email: "email",
  WhatsApp: "whatsapp",
  Instagram: "instagram",
  Facebook: "facebook",
};

const skillTagClassName = "text-sm font-semibold capitalize text-neutral-900";

const CHANNEL_LABEL_ORDER = [
  "Chat",
  "Email",
  "Voice",
  "WhatsApp",
  "Instagram",
  "Facebook",
] as const;

function queueChannelLabels(agents: QueueAgent[]): string[] {
  const enabled = new Set<string>();
  if (agents.some((agent) => agent.handlesFacebook)) enabled.add("Facebook");
  if (agents.some((agent) => agent.handlesCalls)) enabled.add("Voice");
  if (agents.some((agent) => agent.handlesChat)) enabled.add("Chat");
  if (agents.some((agent) => agent.handlesEmail)) enabled.add("Email");
  if (agents.some((agent) => agent.handlesWhatsapp)) enabled.add("WhatsApp");
  if (agents.some((agent) => agent.handlesInstagram)) enabled.add("Instagram");
  return CHANNEL_LABEL_ORDER.filter((label) => enabled.has(label));
}

function formatUpdatedAtLong(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function QueueSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm font-medium capitalize text-neutral-600">
      {children}
    </p>
  );
}

function queueInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "Q";
}

const queueStatTileClassName =
  "min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] bg-transparent px-3 py-2.5";

function QueueStatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className={queueStatTileClassName}>
      <QueueSectionLabel>{label}</QueueSectionLabel>
      <p className="mt-1 truncate text-sm font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function QueueChannelBar({ channels }: { channels: string[] }) {
  return (
    <div className={queueStatTileClassName}>
      <div className="flex items-center justify-between gap-2">
        <QueueSectionLabel>Channels</QueueSectionLabel>
        <span className="text-sm font-medium tabular-nums text-neutral-400">
          {channels.length > 0 ? channels.length : "—"}
        </span>
      </div>
      {channels.length > 0 ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-1.5"
          role="list"
          aria-label="Enabled channels"
        >
          {channels.map((channel) => {
            const workspaceChannel = CHANNEL_TO_WORKSPACE[channel];
            return (
              <span key={channel} role="listitem" title={channel} className="inline-flex">
                {workspaceChannel ? (
                  <WorkspaceChannelIcon
                    channel={workspaceChannel}
                    className="size-6 rounded-lg shadow-none"
                  />
                ) : (
                  <span className="text-xs font-medium text-neutral-700">{channel}</span>
                )}
                <span className="sr-only">{channel}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="mt-1 text-sm text-neutral-600">None enabled</p>
      )}
    </div>
  );
}

function useQueueListGridClass(): string {
  const ctx = useCopilotWorkspacePanels();
  if (!ctx) return "grid-cols-1";
  if (ctx.copilotMinimized) return "grid-cols-1 lg:grid-cols-3";
  if (ctx.expandedSide === "right") return "grid-cols-1 lg:grid-cols-2";
  return "grid-cols-1";
}

type QueueSummaryPanelProps = {
  queues: Queue[];
  teamNameById: Record<string, string>;
  hoursNameById: Record<string, string>;
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  error: string | null;
  statusUpdatingId: string | null;
  onStatusChange: (queue: Queue, status: QueueStatus) => void;
  onSelectQueue: (queueId: string) => void;
  onCreateQueue: () => void;
  onRefresh: () => void;
  moduleTabs?: ReactNode;
};

export function QueueSummaryPanel({
  queues,
  teamNameById,
  hoursNameById,
  search,
  onSearchChange,
  loading,
  error,
  statusUpdatingId,
  onStatusChange,
  onSelectQueue,
  onCreateQueue,
  onRefresh,
  moduleTabs,
}: QueueSummaryPanelProps) {
  const [statusFilter, setStatusFilter] = useState<"all" | QueueStatus>("all");
  const query = search.trim().toLowerCase();
  const copilotMinimized = Boolean(useCopilotWorkspacePanels()?.copilotMinimized);
  const queueListGridClass = useQueueListGridClass();
  const filtered = queues.filter((queue) => {
    if (statusFilter !== "all" && queue.status !== statusFilter) return false;
    if (!query) return true;
    const teamName = teamNameById[queue.teamId] ?? "";
    return (
      queue.name.toLowerCase().includes(query) ||
      teamName.toLowerCase().includes(query) ||
      queue.status.toLowerCase().includes(query) ||
      (queue.description ?? "").toLowerCase().includes(query) ||
      queue.skills.some((skill) => skill.toLowerCase().includes(query))
    );
  });

  const toolbar = (
    <>
      <PanelRefreshButton onClick={onRefresh} refreshing={loading} />
      <Button onClick={onCreateQueue}>Create</Button>
      <PanelExpandButton side="right" />
    </>
  );

  return (
    <div className={contentPanelClassName}>
      {copilotMinimized ? null : (
        <div className={`shrink-0 px-4 py-3.5 ${contentPanelHeaderBorderClassName}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[18px] font-semibold text-neutral-900">Your queues</h2>
              <p className="mt-0.5 text-sm text-neutral-600">
                Create queues, assign agents to shifts, and configure channels
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">{toolbar}</div>
          </div>
        </div>
      )}

      {moduleTabs ? <div className="shrink-0 px-4 pt-3">{moduleTabs}</div> : null}

      <div className="shrink-0 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-neutral-900" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search queues..."
              className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 pr-3 pl-9 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200"
            />
          </div>
          <NativeSelectSm
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | QueueStatus)}
            aria-label="Filter queues"
            wrapperClassName="w-36 shrink-0 sm:w-40"
            className="h-[38px] w-36 bg-neutral-50 text-sm text-neutral-700 focus:bg-white sm:w-40"
          >
            <option value="all">All queues</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </NativeSelectSm>
          {copilotMinimized ? <div className="flex shrink-0 items-center gap-2">{toolbar}</div> : null}
        </div>
      </div>

      {error ? (
        <div className="mx-4 shrink-0">
          <StatusBanner tone="error">{error}</StatusBanner>
        </div>
      ) : null}

      <PanelScrollArea className="min-h-0 flex-1 px-4 pb-4">
        {loading ? (
          <QueuesListSkeleton gridClassName={queueListGridClass} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-2 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100">
              <Users className="size-4 text-neutral-600" />
            </div>
            <p className="mt-3 text-sm font-medium text-neutral-800">No queues found</p>
            <p className="mt-1 text-xs text-neutral-600">
              {queues.length === 0 ? "Create your first queue with Create." : "Try another search."}
            </p>
          </div>
        ) : (
          <ul className={cn("grid gap-4", queueListGridClass)}>
            {filtered.map((queue) => {
              const teamName = teamNameById[queue.teamId] ?? "No team";
              const hoursName = queue.businessHoursId
                ? hoursNameById[queue.businessHoursId] ?? "Scheduled"
                : "Always open";
              const shiftLabel = queue.shiftTypes.length > 0
                ? queue.shiftTypes.join(", ")
                : "None";
              const agentCount = queue.agents.length;
              const isActive = queue.status === "active";
              const isBusy = statusUpdatingId === queue.id;
              const channels = queueChannelLabels(queue.agents);
              const skillsPreview = queue.skills.slice(0, 6);
              const extraSkills = Math.max(0, queue.skills.length - skillsPreview.length);

              return (
                <li key={queue.id} className="min-w-0">
                  <div className="h-full rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 transition hover:bg-neutral-50/70">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => onSelectQueue(queue.id)}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-xs font-semibold text-neutral-800">
                          {queueInitials(queue.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="min-w-0 truncate text-sm font-semibold capitalize text-neutral-900">
                              {queue.name}
                            </p>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                isActive
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-neutral-100 text-neutral-600",
                              )}
                            >
                              {isActive ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-sm text-neutral-600">
                            {queue.description || "No description"}
                          </p>
                        </div>
                      </button>
                      <div
                        className="flex shrink-0 items-center gap-2 pt-1"
                        onClick={(e) => e.preventDefault()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <QueueSectionLabel>Status</QueueSectionLabel>
                        <StatusToggle
                          checked={isActive}
                          disabled={isBusy}
                          compact
                          showLabel={false}
                          onChange={(status) => onStatusChange(queue, status)}
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectQueue(queue.id)}
                      className="mt-3 w-full text-left"
                    >
                      <div className="grid grid-cols-2 gap-4">
                        <QueueStatTile label="Team" value={teamName} />
                        <QueueStatTile
                          label="Agents"
                          value={`${agentCount} assigned`}
                        />
                        <QueueStatTile label="Hours" value={hoursName} />
                        <QueueStatTile label="Shifts" value={shiftLabel} />
                        <div className="col-span-2">
                          <QueueChannelBar channels={channels} />
                        </div>
                        <div className={cn("col-span-2", queueStatTileClassName)}>
                          <div className="flex items-center justify-between gap-2">
                            <QueueSectionLabel>Skills</QueueSectionLabel>
                            <span className="text-sm font-medium tabular-nums text-neutral-400">
                              {queue.skills.length > 0 ? queue.skills.length : "—"}
                            </span>
                          </div>
                          {skillsPreview.length > 0 ? (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {skillsPreview.map((skill) => (
                                <span key={skill} className={skillTagClassName}>
                                  {skill}
                                </span>
                              ))}
                              {extraSkills > 0 ? (
                                <span className="text-[11px] text-neutral-600">+{extraSkills} more</span>
                              ) : null}
                            </div>
                          ) : (
                            <p className="mt-1 text-sm text-neutral-600">None required</p>
                          )}
                        </div>
                      </div>
                    </button>

                    <p className="relative mt-3 pt-2.5 text-xs text-neutral-400 after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:border-t-[0.6px] after:border-[#e5e5e5] after:content-['']">
                      Updated {formatUpdatedAtLong(queue.updatedAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PanelScrollArea>
    </div>
  );
}
