import type { CallbackInteraction } from "@/features/monitoring/types";

export type CallbackInteractionGroup = {
  id: string;
  customer: string;
  channel: CallbackInteraction["channel"];
  queue: string;
  assignedAgentName: string;
  count: number;
  /** Newest task first. */
  tasks: CallbackInteraction[];
  latest: CallbackInteraction;
};

function groupBaseKey(row: CallbackInteraction): string {
  const statusBucket = row.status === "open" ? "open" : "history";
  if (row.conversationId) {
    return `conversation:${row.conversationId}|${statusBucket}`;
  }
  if (row.contactId) {
    return `contact:${row.contactId}|${statusBucket}`;
  }
  // A display name is not an identity. Keep unlinked tasks separate instead
  // of merging unrelated people called "Customer" (or sharing a name).
  return `task:${row.taskId}`;
}

function buildGroup(tasks: CallbackInteraction[]): CallbackInteractionGroup {
  const sorted = [...tasks].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const latest = sorted[0]!;

  return {
    id: `${groupBaseKey(latest)}:${latest.taskId}`,
    customer: latest.customer,
    channel: latest.channel,
    queue: latest.queue,
    assignedAgentName: latest.assignedAgentName,
    count: sorted.length,
    tasks: sorted,
    latest,
  };
}

/** Collapse duplicate open callback tasks for the same conversation, contact, or customer. */
export function groupCallbackInteractions(rows: CallbackInteraction[]): CallbackInteractionGroup[] {
  const byKey = new Map<string, CallbackInteraction[]>();

  for (const row of rows) {
    const key = groupBaseKey(row);
    const bucket = byKey.get(key) ?? [];
    bucket.push(row);
    byKey.set(key, bucket);
  }

  return [...byKey.values()]
    .map((tasks) => buildGroup(tasks))
    .sort(
      (left, right) =>
        new Date(right.latest.createdAt).getTime() - new Date(left.latest.createdAt).getTime(),
    );
}

export function sortWaitingInteractions<T extends {
  waitingSeconds: number;
  priority: "low" | "normal" | "high";
  sla: "healthy" | "at_risk" | "breached";
}>(rows: T[]): T[] {
  const slaRank = (sla: T["sla"]) => (sla === "breached" ? 0 : sla === "at_risk" ? 1 : 2);
  const priorityRank = (priority: T["priority"]) =>
    priority === "high" ? 0 : priority === "normal" ? 1 : 2;

  return [...rows].sort((left, right) => {
    const slaDiff = slaRank(left.sla) - slaRank(right.sla);
    if (slaDiff !== 0) return slaDiff;
    const priorityDiff = priorityRank(left.priority) - priorityRank(right.priority);
    if (priorityDiff !== 0) return priorityDiff;
    return right.waitingSeconds - left.waitingSeconds;
  });
}
