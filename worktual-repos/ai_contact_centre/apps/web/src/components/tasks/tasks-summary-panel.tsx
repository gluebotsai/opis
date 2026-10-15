import {
  ChevronRight,
  ClipboardList,
  LoaderCircle,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";

import { PanelExpandButton, PanelRefreshButton, useCopilotWorkspacePanels } from "@/components/assistant/copilot-workspace";
import { segmentTabClassName } from "@/components/ui/button";
import { listRowButtonClassName, listRowDividerClassName, listRowTimestampClassName } from "@/components/ui/list-row";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { StatusBanner } from "@/components/ui/status-banner";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import type { AgentTask, AgentTaskTab } from "@/features/tasks/types";
import {
  formatTaskDueAt,
  formatTaskRelativeTime,
  isTaskOverdue,
  taskChannelLabel,
  taskPriorityTone,
  taskTypeLabel,
  taskTypeTone,
} from "@/features/tasks/tasks-utils";
import { cn } from "@/lib/utils";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";

type TasksSummaryPanelProps = {
  tasks: AgentTask[];
  selectedId: string | null;
  search: string;
  tab: AgentTaskTab;
  counts: Record<AgentTaskTab, number>;
  loading?: boolean;
  error?: string | null;
  onSearchChange: (value: string) => void;
  onTabChange: (tab: AgentTaskTab) => void;
  onSelectTask: (taskId: string) => void;
  onRefresh: () => void;
};

const TABS: { id: AgentTaskTab; label: string }[] = [
  { id: "admin_assigned", label: "Admin assigned" },
  { id: "coworker_assigned", label: "Coworker assigned" },
  { id: "done", label: "Done" },
];

function useMinuteTick(): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return tick;
}

export function TasksSummaryPanel({
  tasks,
  selectedId,
  search,
  tab,
  counts,
  loading = false,
  error = null,
  onSearchChange,
  onTabChange,
  onSelectTask,
  onRefresh,
}: TasksSummaryPanelProps) {
  const nowTick = useMinuteTick();
  const copilotMinimized = Boolean(useCopilotWorkspacePanels()?.copilotMinimized);

  const toolbar = (
    <>
      <PanelRefreshButton onClick={onRefresh} refreshing={loading} />
      <PanelExpandButton side="right" />
    </>
  );

  return (
    <div className={contentPanelClassName}>
      {copilotMinimized ? null : (
        <div className={`shrink-0 px-4 py-3.5 ${contentPanelHeaderBorderClassName}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[18px] font-semibold text-neutral-900">My Tasks</h2>
              <p className="mt-0.5 text-sm text-neutral-600">
                Callbacks and follow-ups from your conversations
              </p>
            </div>
            <div className="flex items-center gap-2">{toolbar}</div>
          </div>
        </div>
      )}

      <div className="shrink-0 px-3 py-3">
        <div className="grid grid-cols-3 gap-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={segmentTabClassName({
                active: tab === item.id,
                className: "w-full",
              })}
            >
              {item.label}
              {counts[item.id] > 0 ? (
                <span className={cn("ml-1", tab === item.id ? "text-white/70" : "text-neutral-400")}>
                  {counts[item.id]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-neutral-900" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search customer, task, or channel…"
              className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 pr-3 pl-9 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200"
            />
          </div>
          {copilotMinimized ? <div className="flex shrink-0 items-center gap-2">{toolbar}</div> : null}
        </div>
      </div>

      {error ? (
        <div className="mx-3 mt-2 shrink-0">
          <StatusBanner tone="error">{error}</StatusBanner>
        </div>
      ) : null}

      <PanelScrollArea className="min-h-0 flex-1 px-3 pb-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-600">
            <LoaderCircle className="size-4 animate-spin" />
            Loading tasks…
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-2 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100">
              <ClipboardList className="size-4 text-neutral-600" />
            </div>
            <p className="mt-3 text-sm font-medium text-neutral-800">No tasks in this view</p>
            <p className="mt-1 text-xs text-neutral-600">Try another tab or search term.</p>
          </div>
        ) : (
          <ul>
            {tasks.map((task) => {
              const isSelected = task.id === selectedId;
              const overdue = isTaskOverdue(task);
              return (
                <li key={task.id} className={listRowDividerClassName()}>
                  <button
                    type="button"
                    onClick={() => onSelectTask(task.id)}
                    className={cn(
                      listRowButtonClassName,
                      "flex items-start gap-3",
                      isSelected ? "bg-neutral-100" : "hover:bg-neutral-50",
                    )}
                  >
                    <div className={profileAvatarClassName(task.id, "size-10 text-xs")}>
                      {profileInitials(task.customerName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-neutral-900">
                            {task.customerName}
                          </p>
                        </div>
                        <div className="shrink-0 text-right leading-relaxed">
                          <p className={listRowTimestampClassName}>
                            Assigned{" "}
                            {formatTaskRelativeTime(task.createdAt, new Date(nowTick))}
                          </p>
                          {task.status === "completed" ? (
                            <p className={cn(listRowTimestampClassName, "text-neutral-600")}>
                              Done{" "}
                              {formatTaskRelativeTime(
                                task.completedAt ?? task.updatedAt,
                                new Date(nowTick),
                              )}
                            </p>
                          ) : (
                            <p
                              className={cn(
                                listRowTimestampClassName,
                                overdue ? "font-medium text-red-600" : "text-neutral-600",
                              )}
                            >
                              {formatTaskDueAt(task.dueAt)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-sm font-medium",
                            taskTypeTone(task.type),
                          )}
                        >
                          {taskTypeLabel(task.type)}
                        </span>
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-sm font-medium text-neutral-600">
                          {taskChannelLabel(task.channel)}
                        </span>
                        {task.priority === "high" || task.priority === "critical" ? (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-sm font-medium",
                              taskPriorityTone(task.priority),
                            )}
                          >
                            {task.priority === "critical" ? "Critical" : "High"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <ChevronRight className="mt-2 size-3.5 shrink-0 text-neutral-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PanelScrollArea>
    </div>
  );
}
