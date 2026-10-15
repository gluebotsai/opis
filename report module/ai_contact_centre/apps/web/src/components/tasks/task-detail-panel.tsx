import { ChevronLeft, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { Button, IconButton } from "@/components/ui/button";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import {
  PROFILE_EMPTY_FACT,
  ProfileFact,
  ProfileFactGrid,
  ProfileSection,
} from "@/components/ui/profile-detail-row";
import { StatusBanner } from "@/components/ui/status-banner";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { tasksApi } from "@/features/tasks/api";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import type { AgentTask } from "@/features/tasks/types";
import {
  formatTaskDueAt,
  formatTaskTimestamp,
  isTaskOverdue,
  taskChannelLabel,
  taskPriorityLabel,
  taskSourceLabel,
  taskTypeLabel,
} from "@/features/tasks/tasks-utils";
import { cn } from "@/lib/utils";

type TaskDetailPanelProps = {
  task: AgentTask;
  onClose: () => void;
  onComplete: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
  onAcceptSuggestion: (taskId: string) => void;
};

function formatFactValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : PROFILE_EMPTY_FACT;
}

function taskStatusBadge(task: AgentTask): { label: string; className: string } {
  if (task.status === "completed") {
    return { label: "Completed", className: "bg-emerald-50 text-emerald-700" };
  }
  if (task.status === "dismissed") {
    return { label: "Dismissed", className: "bg-neutral-100 text-neutral-600" };
  }
  if (isTaskOverdue(task)) {
    return { label: "Overdue", className: "bg-red-50 text-red-700" };
  }
  return { label: "Open", className: "bg-neutral-100 text-neutral-600" };
}

export function TaskDetailPanel({
  task,
  onClose,
  onComplete,
  onDismiss,
  onAcceptSuggestion,
}: TaskDetailPanelProps) {
  const navigate = useNavigate();
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const overdue = isTaskOverdue(task);
  const isSuggestion = task.type === "suggestion" && task.status === "open";
  const isCompleted = task.status === "completed";
  const canOpenWorkspace = Boolean(task.conversationId || (task.contactId && task.channel));
  const status = taskStatusBadge(task);

  async function handleOpenWorkspace() {
    if (!canOpenWorkspace || openingWorkspace) return;
    setOpeningWorkspace(true);
    setWorkspaceError(null);
    try {
      const { conversationId } = await tasksApi.openWorkspace(task.id);
      navigate(`/agent/workspace?conversationId=${conversationId}`);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Failed to open workspace",
      );
    } finally {
      setOpeningWorkspace(false);
    }
  }

  return (
    <div className={contentPanelClassName}>
      <div className={`flex shrink-0 items-center justify-between gap-2 px-4 py-3 ${contentPanelHeaderBorderClassName}`}>
        <div className="flex min-w-0 items-center gap-2">
          <IconButton
            variant="ghostIcon"
            onClick={onClose}
            className="shrink-0 [&_svg]:size-[18px]"
            aria-label="Back to tasks"
          >
            <ChevronLeft />
          </IconButton>
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold text-neutral-900">Task</h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canOpenWorkspace ? (
            <Button
              variant="outline"
              disabled={openingWorkspace}
              onClick={() => void handleOpenWorkspace()}
            >
              <ExternalLink className="size-[18px]" />
              {openingWorkspace ? "Opening…" : "Open workspace"}
            </Button>
          ) : null}
          {!isCompleted ? (
            isSuggestion ? (
              <>
                <Button onClick={() => onAcceptSuggestion(task.id)}>Accept task</Button>
                <Button variant="secondary" onClick={() => onDismiss(task.id)}>
                  Dismiss
                </Button>
              </>
            ) : (
              <Button onClick={() => onComplete(task.id)}>Mark complete</Button>
            )
          ) : null}
          <PanelExpandButton side="right" />
        </div>
      </div>

      <PanelScrollArea className="min-h-0 flex-1">
        <div className="space-y-[16px] px-4 py-4">
          {workspaceError ? <StatusBanner tone="error">{workspaceError}</StatusBanner> : null}

          <div className="flex items-center gap-3">
            <div className={profileAvatarClassName(task.id, "size-12 shrink-0 text-sm")}>
              {profileInitials(task.customerName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-[18px] font-semibold text-neutral-900">
                  {task.customerName}
                </p>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    status.className,
                  )}
                >
                  {status.label}
                </span>
              </div>
              <p className="mt-0.5 truncate text-sm text-neutral-600">{task.title}</p>
            </div>
          </div>

          <ProfileSection title="Summary" description="What this follow-up is about">
            <p className="text-sm leading-relaxed text-neutral-900">{task.summary}</p>
          </ProfileSection>

          <ProfileSection title="Details" description="Assignment and timing">
            <ProfileFactGrid>
              <ProfileFact label="Type" value={taskTypeLabel(task.type)} />
              <ProfileFact label="Priority" value={taskPriorityLabel(task.priority)} />
              <ProfileFact label="Channel" value={taskChannelLabel(task.channel)} />
              <ProfileFact label="Due">
                <p
                  className={cn(
                    "truncate text-sm font-semibold",
                    overdue && !isCompleted ? "text-red-600" : "text-neutral-900",
                  )}
                >
                  {formatTaskDueAt(task.dueAt)}
                </p>
              </ProfileFact>
              <ProfileFact label="Source" value={taskSourceLabel(task.source)} />
              <ProfileFact label="Assigned by" value={formatFactValue(task.assignedBy)} />
              <ProfileFact label="Updated" value={formatTaskTimestamp(task.updatedAt)} />
              {isCompleted ? (
                <ProfileFact
                  label="Completed"
                  value={
                    task.completedAt ? formatTaskTimestamp(task.completedAt) : "Recently"
                  }
                />
              ) : null}
            </ProfileFactGrid>
          </ProfileSection>

          <ProfileSection title="Contact" description="Reachability">
            <ProfileFactGrid>
              <ProfileFact label="Email" value={formatFactValue(task.customerEmail)} />
              <ProfileFact label="Phone" value={formatFactValue(task.customerPhone)} />
            </ProfileFactGrid>
          </ProfileSection>

          {overdue && !isCompleted ? (
            <StatusBanner tone="warning">
              This task is overdue. Complete it or reschedule from the conversation workspace.
            </StatusBanner>
          ) : null}

          {isSuggestion ? (
            <StatusBanner tone="info">
              Your co-worker suggested this follow-up from the conversation. Accept to keep it in
              your open tasks.
            </StatusBanner>
          ) : null}
        </div>
      </PanelScrollArea>
    </div>
  );
}
