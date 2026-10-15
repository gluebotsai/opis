import type { AgentTask, AgentTaskStats, AgentTaskTab, AgentTaskType } from "./types";

/** Legacy API values collapse to follow-up for display. */
export function normalizeTaskType(type: string): AgentTaskType {
  if (type === "callback") return "callback";
  if (type === "suggestion") return "suggestion";
  return "follow_up";
}

export function taskTypeLabel(type: AgentTaskType | string): string {
  switch (normalizeTaskType(type)) {
    case "follow_up":
      return "Follow-up";
    case "callback":
      return "Callback";
    case "suggestion":
      return "Suggestion";
  }
}

export function taskSourceLabel(source: AgentTask["source"]): string {
  switch (source) {
    case "self":
      return "You";
    case "admin":
      return "Admin";
    case "coworker":
      return "Co-worker";
    case "system":
      return "System";
  }
}

export function taskChannelLabel(channel: AgentTask["channel"]): string {
  if (!channel) return "—";
  switch (channel) {
    case "voice":
      return "Voice";
    case "email":
      return "Email";
    case "webchat":
      return "Webchat";
    case "whatsapp":
      return "WhatsApp";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
  }
}

export function taskPriorityLabel(priority: AgentTask["priority"]): string {
  switch (priority) {
    case "critical":
      return "Critical";
    case "high":
      return "High";
    case "normal":
      return "Normal";
    case "low":
      return "Low";
  }
}

export function taskPriorityTone(priority: AgentTask["priority"]): string {
  switch (priority) {
    case "critical":
      return "bg-red-50 text-red-700";
    case "high":
      return "bg-amber-50 text-amber-700";
    case "normal":
      return "bg-sky-50 text-sky-700";
    case "low":
      return "bg-neutral-100 text-neutral-600";
  }
}

export function taskTypeTone(type: AgentTaskType | string): string {
  switch (normalizeTaskType(type)) {
    case "callback":
      return "bg-emerald-50 text-emerald-700";
    case "follow_up":
      return "bg-blue-50 text-blue-700";
    case "suggestion":
      return "bg-fuchsia-50 text-fuchsia-700";
  }
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function isTaskOverdue(task: AgentTask, reference = new Date()): boolean {
  if (task.status !== "open" || !task.dueAt) return false;
  return new Date(task.dueAt).getTime() < reference.getTime();
}

export function isTaskDueToday(task: AgentTask, reference = new Date()): boolean {
  if (task.status !== "open" || !task.dueAt) return false;
  const due = new Date(task.dueAt);
  return due >= startOfDay(reference) && due <= endOfDay(reference);
}

export function formatTaskDueAt(value: string | null): string {
  if (!value) return "No due date";
  const due = new Date(value);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);

  if (Math.abs(diffMs) < 60_000) {
    return diffMs >= 0 ? "Due now" : "Just overdue";
  }
  if (absMinutes < 60) {
    return diffMs >= 0 ? `Due in ${absMinutes}m` : `${absMinutes}m overdue`;
  }

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return diffMs >= 0 ? `Due in ${absHours}h` : `${absHours}h overdue`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(due);
}

export function formatTaskTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Relative time for list rows (e.g. "5m ago", "2h ago"). */
export function formatTaskRelativeTime(value: string, reference = new Date()): string {
  const date = new Date(value);
  const diffMin = Math.floor((reference.getTime() - date.getTime()) / 60_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 24 * 60) return `${Math.floor(diffMin / 60)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function computeTaskStats(tasks: AgentTask[]): AgentTaskStats {
  const openTasks = tasks.filter((task) => task.status === "open");
  return {
    open: openTasks.length,
    dueToday: openTasks.filter((task) => isTaskDueToday(task)).length,
    overdue: openTasks.filter((task) => isTaskOverdue(task)).length,
  };
}

export function filterTasksByTab(tasks: AgentTask[], tab: AgentTaskTab): AgentTask[] {
  switch (tab) {
    case "admin_assigned":
      return tasks.filter(
        (task) =>
          task.status === "open" &&
          task.source !== "coworker" &&
          task.type !== "suggestion",
      );
    case "coworker_assigned":
      return tasks.filter(
        (task) =>
          task.status === "open" &&
          (task.source === "coworker" || task.type === "suggestion"),
      );
    case "done":
      return tasks.filter((task) => task.status === "completed");
  }
}

export function searchTasks(tasks: AgentTask[], query: string): AgentTask[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return tasks;
  return tasks.filter((task) =>
    [
      task.title,
      task.summary,
      task.customerName,
      task.customerEmail,
      task.customerPhone,
      task.notes,
      task.assignedBy,
      taskTypeLabel(task.type),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

function taskCompletedAtMs(task: AgentTask): number {
  const raw = task.completedAt ?? task.updatedAt;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function sortTasks(tasks: AgentTask[]): AgentTask[] {
  return [...tasks].sort((left, right) => {
    const leftDone = left.status === "completed";
    const rightDone = right.status === "completed";
    if (leftDone && rightDone) {
      return taskCompletedAtMs(right) - taskCompletedAtMs(left);
    }
    if (leftDone !== rightDone) return leftDone ? 1 : -1;

    const leftOverdue = isTaskOverdue(left);
    const rightOverdue = isTaskOverdue(right);
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;

    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

export function taskTabCounts(tasks: AgentTask[]): Record<AgentTaskTab, number> {
  return {
    admin_assigned: tasks.filter(
      (task) =>
        task.status === "open" &&
        task.source !== "coworker" &&
        task.type !== "suggestion",
    ).length,
    coworker_assigned: tasks.filter(
      (task) =>
        task.status === "open" &&
        (task.source === "coworker" || task.type === "suggestion"),
    ).length,
    done: tasks.filter((task) => task.status === "completed").length,
  };
}
