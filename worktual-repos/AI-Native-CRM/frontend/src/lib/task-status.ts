export type TaskStatus = "open" | "in_progress" | "completed" | "cancelled";

/** Display status for tasks: stored workflow + derived overdue. */
export type TaskDisplayStatus = TaskStatus | "overdue";

export function deriveTaskDisplayStatus(
  taskStatus: TaskStatus | null | undefined,
  dueAt: Date | string | null | undefined,
  now = new Date(),
): TaskDisplayStatus | null {
  if (!taskStatus) return null;
  if (taskStatus === "completed") return "completed";
  if (dueAt) {
    const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
    if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) {
      return "overdue";
    }
  }
  return taskStatus;
}

export const TASK_DISPLAY_STATUS_LABELS: Record<TaskDisplayStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  overdue: "Overdue",
};
