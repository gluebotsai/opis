import type { MissedInteraction } from "@/features/monitoring/types";
import {
  resolveMissedGroupCallback,
  resolveMissedGroupConnected,
} from "@/features/monitoring/monitoring-queue-utils";

/** Group repeated missed contacts from the same customer within this window. */
export const MISSED_GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type MissedInteractionGroup = {
  id: string;
  customer: string;
  channel: MissedInteraction["channel"];
  queue: string;
  reason: MissedInteraction["reason"];
  count: number;
  /** Newest attempt first. */
  attempts: MissedInteraction[];
  latest: MissedInteraction;
  callbackAssigned: boolean;
  callbackAssignedAgentName: string | null;
  callbackStatus: MissedInteraction["callbackStatus"];
  callbackAssignmentSource: MissedInteraction["callbackAssignmentSource"];
  connectedAfterMiss: boolean;
  connectedAt: string | null;
  connectedAgentName: string | null;
};

function groupBaseKey(row: MissedInteraction): string {
  const queue = row.queue.trim().toLowerCase();
  if (row.conversationId) {
    return `conversation:${row.conversationId}|${row.channel}|${queue}`;
  }
  if (row.contactId) {
    return `contact:${row.contactId}|${row.channel}|${queue}`;
  }
  return `customer:${row.customer.trim().toLowerCase()}|${row.channel}|${queue}`;
}

function shouldMergeIntoCluster(lastRow: MissedInteraction, row: MissedInteraction): boolean {
  if (groupBaseKey(lastRow) !== groupBaseKey(row)) {
    return false;
  }

  const gapMs =
    new Date(row.occurredAt).getTime() - new Date(lastRow.occurredAt).getTime();
  if (gapMs > MISSED_GROUP_WINDOW_MS) {
    return false;
  }

  // A successful connection closes the episode only when it happened before
  // the next miss. Older attempts in one routing cycle may all point to the
  // same later connection and must remain grouped.
  if (
    lastRow.connectedAt &&
    new Date(lastRow.connectedAt).getTime() < new Date(row.occurredAt).getTime()
  ) {
    return false;
  }

  return true;
}

function buildGroup(attempts: MissedInteraction[]): MissedInteractionGroup {
  const sortedAttempts = [...attempts].sort(
    (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  );
  const latest = sortedAttempts[0]!;

  return {
    id: `${groupBaseKey(latest)}:${latest.occurredAt}`,
    customer: latest.customer,
    channel: latest.channel,
    queue: latest.queue,
    reason: latest.reason,
    count: attempts.length,
    attempts: sortedAttempts,
    latest,
    ...resolveMissedGroupCallback(attempts),
    ...resolveMissedGroupConnected(attempts),
  };
}

/**
 * Collapse repeated missed/abandoned rows (same conversation · contact · channel · queue)
 * when attempts fall within {@link MISSED_GROUP_WINDOW_MS} of the previous one.
 * A resolved connection between misses starts a new episode.
 */
export function groupMissedInteractions(rows: MissedInteraction[]): MissedInteractionGroup[] {
  if (rows.length === 0) return [];

  const sortedAsc = [...rows].sort(
    (left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime(),
  );

  const clusters: MissedInteraction[][] = [];

  for (const row of sortedAsc) {
    const lastCluster = clusters.at(-1);
    const lastRow = lastCluster?.at(-1);

    if (lastCluster && lastRow && shouldMergeIntoCluster(lastRow, row)) {
      lastCluster.push(row);
      continue;
    }

    clusters.push([row]);
  }

  return clusters
    .map((attempts) => buildGroup(attempts))
    .sort(
      (left, right) =>
        new Date(right.latest.occurredAt).getTime() - new Date(left.latest.occurredAt).getTime(),
    );
}
