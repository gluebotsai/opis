import { isCallbackEligibleChannel } from "@/features/monitoring/map-monitoring-snapshot";
import type { CallbackInteraction, MissedInteraction } from "@/features/monitoring/types";
import type { MissedInteractionGroup } from "@/features/monitoring/group-missed-interactions";

export type MissedFollowUpStatus =
  | "connected"
  | "coworker_assigned"
  | "callback_assigned"
  | "callback_pending"
  | "no_callback_for_web";

export type MissedStatusFilter = "all" | MissedFollowUpStatus;

type MissedFollowUpContext = Pick<
  MissedInteractionGroup,
  "connectedAfterMiss" | "callbackAssigned" | "callbackStatus" | "callbackAssignmentSource" | "channel"
>;

export function resolveMissedFollowUpStatus(group: MissedFollowUpContext): MissedFollowUpStatus {
  if (group.connectedAfterMiss) return "connected";
  if (group.callbackAssigned && group.callbackAssignmentSource === "coworker") {
    return "coworker_assigned";
  }
  if (group.callbackAssigned) return "callback_assigned";
  if (!isCallbackEligibleChannel(group.channel)) return "no_callback_for_web";
  return "callback_pending";
}

export function matchesMissedStatusFilter(
  group: MissedFollowUpContext,
  filter: MissedStatusFilter,
): boolean {
  if (filter === "all") return true;
  return resolveMissedFollowUpStatus(group) === filter;
}

export function missedFollowUpLabel(status: MissedFollowUpStatus): string {
  switch (status) {
    case "connected":
      return "Agent reached";
    case "coworker_assigned":
      return "Coworker assigned";
    case "callback_assigned":
      return "Supervisor assigned";
    case "callback_pending":
      return "Not assigned";
    case "no_callback_for_web":
      return "No callback for web";
  }
}

export function missedFollowUpDisplayLabel(group: MissedFollowUpContext): string {
  return missedFollowUpLabel(resolveMissedFollowUpStatus(group));
}

export function missedFollowUpDisplayTone(
  group: MissedFollowUpContext,
): "success" | "warning" | "neutral" | "info" {
  return missedFollowUpTone(resolveMissedFollowUpStatus(group));
}

export function missedFollowUpTone(
  status: MissedFollowUpStatus,
): "success" | "warning" | "neutral" | "info" {
  switch (status) {
    case "connected":
      return "success";
    case "coworker_assigned":
      return "info";
    case "callback_assigned":
      return "info";
    case "callback_pending":
      return "warning";
    case "no_callback_for_web":
      return "neutral";
  }
}

export function canAssignMissedCallback(
  group: Pick<
    MissedInteractionGroup,
    "connectedAfterMiss" | "callbackAssigned" | "callbackStatus" | "callbackAssignmentSource" | "channel"
  >,
): boolean {
  return (
    resolveMissedFollowUpStatus(group) === "callback_pending" &&
    isCallbackEligibleChannel(group.channel)
  );
}

export function callbackTaskStatusLabel(status: CallbackInteraction["status"]): string {
  if (status === "completed") return "Done";
  if (status === "dismissed") return "Dismissed";
  return "Open";
}

export function callbackTaskStatusTone(
  status: CallbackInteraction["status"],
): "success" | "warning" | "neutral" | "info" {
  if (status === "completed") return "success";
  if (status === "dismissed") return "neutral";
  return "info";
}

export function latestMissedAttempt(attempts: MissedInteraction[]): MissedInteraction | null {
  if (attempts.length === 0) return null;
  return [...attempts].sort(
    (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  )[0]!;
}

/** Follow-up status reflects the newest miss only — not earlier attempts in the episode. */
export function resolveMissedGroupConnected(
  attempts: MissedInteraction[],
): Pick<MissedInteractionGroup, "connectedAfterMiss" | "connectedAt" | "connectedAgentName"> {
  const latest = latestMissedAttempt(attempts);
  return {
    connectedAfterMiss: latest?.connectedAfterMiss ?? false,
    connectedAt: latest?.connectedAt ?? null,
    connectedAgentName: latest?.connectedAgentName ?? null,
  };
}

/** Prefer supervisor-assigned callbacks when an episode has both admin and coworker tasks. */
export function resolveMissedGroupCallback(
  attempts: MissedInteraction[],
): Pick<
  MissedInteractionGroup,
  "callbackAssigned" | "callbackAssignedAgentName" | "callbackStatus" | "callbackAssignmentSource"
> {
  const sortedAttempts = [...attempts].sort(
    (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  );
  const withCallback = sortedAttempts.filter((attempt) => attempt.callbackAssigned);
  if (withCallback.length === 0) {
    return {
      callbackAssigned: false,
      callbackAssignedAgentName: null,
      callbackStatus: null,
      callbackAssignmentSource: null,
    };
  }

  const preferred =
    withCallback.find((attempt) => attempt.callbackAssignmentSource === "admin") ??
    withCallback.find((attempt) => attempt.callbackStatus === "open") ??
    withCallback[0]!;

  return {
    callbackAssigned: true,
    callbackAssignedAgentName: preferred.callbackAssignedAgentName,
    callbackStatus: preferred.callbackStatus,
    callbackAssignmentSource: preferred.callbackAssignmentSource,
  };
}
