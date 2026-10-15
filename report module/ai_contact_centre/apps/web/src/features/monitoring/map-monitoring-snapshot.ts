import type { MonitoringSnapshot } from "@/features/monitoring/api";
import {
  mergeChannelCapacity,
  normalizeMonitoringChannel,
} from "@/features/monitoring/channel-utils";
import type {
  AgentPastConversation,
  AgentStatus,
  CallbackInteraction,
  LiveAgent,
  LiveAgentConversation,
  LiveConversation,
  LiveMonitoringState,
  MissedInteraction,
  MonitoringChannel,
  MonitoringSummary,
  QueueSnapshot,
  SlaStatus,
  WaitingInteraction,
} from "@/features/monitoring/types";

const CALLBACK_ELIGIBLE_CHANNELS = new Set(["whatsapp", "instagram", "facebook", "email"]);

function ageSeconds(createdAt: string | null | undefined, fallback: number): number {
  if (!createdAt) return fallback;
  const startedMs = Date.parse(createdAt);
  if (!Number.isFinite(startedMs)) return fallback;
  return Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
}

function mapChannel(channel: string): MonitoringChannel {
  return normalizeMonitoringChannel(channel);
}

export function mapAgentPastConversation(
  row: MonitoringSnapshot["agents"][number]["previousConversations"][number],
): AgentPastConversation {
  return {
    id: row.id,
    channel: mapChannel(row.channel),
    customer: row.customerName,
    intent: row.subject?.trim() || "Conversation",
    queue: row.queueName ?? "—",
    endedAt: row.endedAt,
  };
}

function mapPresence(presence: string): AgentStatus {
  if (presence === "ready" || presence === "available") return "available";
  if (presence === "busy") return "busy";
  if (presence === "after_contact_work") return "wrap-up";
  if (presence === "away" || presence === "not_ready" || presence === "break") return "away";
  return "offline";
}

function mapSla(status: "ok" | "warning" | "breached" | null): SlaStatus {
  if (status === "warning") return "at_risk";
  if (status === "breached") return "breached";
  return "healthy";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function mapPriority(value: number): WaitingInteraction["priority"] {
  if (value >= 2) return "high";
  if (value <= -1) return "low";
  return "normal";
}

function mapMissedReason(
  reason: MonitoringSnapshot["missed"][number]["reason"] | "manual_reject" | "routing_exhausted",
  channel: string,
): MissedInteraction["reason"] {
  if (reason === "manual_reject") return "failed_transfer";
  if (channel === "voice") return "missed_call";
  return "abandoned_chat";
}

function queueStatus(
  queue: MonitoringSnapshot["queues"][number],
): QueueSnapshot["status"] {
  if (queue.waiting >= 3 || (queue.oldestWaitSeconds ?? 0) >= 300) return "critical";
  if (queue.waiting >= 1 || (queue.oldestWaitSeconds ?? 0) >= 120) return "watch";
  return "healthy";
}

export function mapMonitoringSnapshot(snapshot: MonitoringSnapshot): LiveMonitoringState {
  const conversationsByAgent = new Map<string, LiveAgentConversation[]>();

  for (const row of snapshot.conversations) {
    if (!row.assignedAgentId || row.status === "queued" || row.status === "bot_active") {
      continue;
    }
    const bucket = conversationsByAgent.get(row.assignedAgentId) ?? [];
    bucket.push({
      id: row.id,
      channel: mapChannel(row.channel),
      customer: row.customerName,
      durationSeconds: row.activeSeconds ?? row.waitSeconds ?? 0,
      intent: row.subject?.trim() || "Active conversation",
      sla: mapSla(row.slaStatus),
      queue: row.queueName ?? "—",
    });
    conversationsByAgent.set(row.assignedAgentId, bucket);
  }

  const agents: LiveAgent[] = snapshot.agents.map((agent) => {
    const channelCapacity = mergeChannelCapacity(
      agent.capacity
        .map((row) => ({
          channel: mapChannel(row.channel),
          active: row.active,
          reserved: row.reserved,
          max: row.max,
        }))
        .filter((row) => row.max > 0),
    );
    const activeCount = channelCapacity.reduce(
      (sum, row) => sum + row.active + row.reserved,
      0,
    );
    const maxCapacity = channelCapacity.reduce((sum, row) => sum + row.max, 0) || 1;
    const channels = channelCapacity.map((row) => row.channel);
    const conversations = conversationsByAgent.get(agent.agentId) ?? [];
    const presence = agent.presence;

    return {
      id: agent.id,
      agentId: agent.agentId,
      email: agent.email,
      workEmail: agent.workEmail,
      employeeId: agent.employeeId,
      firstName: agent.firstName,
      lastName: agent.lastName,
      teamName: agent.teamName,
      skills: agent.skills ?? [],
      shiftTypes: agent.shiftTypes ?? [],
      primaryLanguage: agent.primaryLanguage,
      secondaryLanguage: agent.secondaryLanguage,
      location: agent.location,
      accountStatus: agent.accountStatus,
      agentStatus: agent.agentStatus,
      presenceUpdatedAt: agent.presenceUpdatedAt,
      name: agent.name,
      initials: initials(agent.name),
      status: mapPresence(presence),
      presence,
      attendanceToday: agent.attendanceToday ?? "absent",
      canReceiveCallback: agent.canReceiveCallback !== false,
      channels: channels.length > 0 ? channels : (["webchat"] as MonitoringChannel[]),
      queues: agent.queueNames.length > 0 ? agent.queueNames : ["—"],
      activeCount,
      maxCapacity,
      channelCapacity,
      lastActivityAt: snapshot.generatedAt,
      conversations,
      previousConversations: (agent.previousConversations ?? []).map(mapAgentPastConversation),
    };
  });

  const queues: QueueSnapshot[] = snapshot.queues.map((queue) => ({
    id: queue.id,
    name: queue.name,
    waiting: queue.waiting,
    active: queue.active,
    botActive: queue.botActive,
    oldestWaitSeconds: queue.oldestWaitSeconds,
    readyAgents: queue.readyAgents,
    status: queueStatus(queue),
    slaRisk: snapshot.waiting.filter(
      (row) => row.queueId === queue.id && row.slaStatus !== "ok",
    ).length,
  }));

  const waiting: WaitingInteraction[] = snapshot.waiting.map((row) => ({
    id: row.conversationId,
    position: row.position,
    customer: row.customerName,
    channel: mapChannel(row.channel),
    queue: row.queueName ?? "—",
    waitingSeconds: row.waitingSeconds,
    priority: mapPriority(row.priority),
    sla: mapSla(row.slaStatus),
    status: "waiting",
  }));

  const missed: MissedInteraction[] = snapshot.missed.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    contactId: row.contactId,
    customer: row.customerName,
    channel: mapChannel(row.channel),
    queue: row.queueName ?? "—",
    occurredAt: row.occurredAt,
    waitSeconds: row.waitSeconds ?? 0,
    reason: mapMissedReason(row.reason, row.channel),
    priority: row.priority === "high" || row.priority === "critical" ? "high" : "normal",
    callbackAssigned: row.callbackAssigned,
    callbackAssignedAgentName: row.callbackAssignedAgentName,
    callbackTaskId: row.callbackTaskId,
    callbackStatus: row.callbackStatus ?? null,
    callbackAssignmentSource: row.callbackAssignmentSource ?? null,
    connectedAfterMiss: row.connectedAfterMiss ?? false,
    connectedAt: row.connectedAt ?? null,
    connectedAgentName: row.connectedAgentName ?? null,
  }));

  const conversationQueueById = new Map(
    snapshot.conversations.map((row) => [row.id, row.queueName ?? "—"]),
  );

  const liveConversations: LiveConversation[] = snapshot.conversations.map((row) => ({
    id: row.id,
    channel: mapChannel(row.channel),
    customer: row.customerName,
    queue: row.queueName ?? "—",
    status: row.status,
    agentName: row.assignedAgentName,
    startedAt: row.createdAt,
    durationSeconds: ageSeconds(row.createdAt, row.activeSeconds ?? row.waitSeconds ?? 0),
    intent: row.subject?.trim() || "Active conversation",
    sla: mapSla(row.slaStatus),
  }));

  const callbacks: CallbackInteraction[] = (snapshot.callbacks ?? []).map((row) => ({
    id: row.id,
    taskId: row.taskId,
    conversationId: row.conversationId,
    contactId: row.contactId,
    customer: row.customerName,
    channel: mapChannel(row.channel),
    queue:
      (row.conversationId ? conversationQueueById.get(row.conversationId) : null) ?? "—",
    title: row.title,
    assignedAgentName: row.assignedAgentName,
    assignedBy: row.assignedBy,
    assignmentSource: row.assignmentSource ?? null,
    createdAt: row.createdAt,
    status: row.status ?? "open",
    completedAt: row.completedAt ?? null,
    priority: row.priority === "high" || row.priority === "critical" ? "high" : "normal",
  }));

  const summary: MonitoringSummary = snapshot.summary;

  return {
    updatedAt: snapshot.generatedAt,
    summary,
    agents,
    queues,
    waiting,
    missed,
    callbacks,
    liveConversations,
    activity: [],
    alerts: snapshot.alerts
      .filter((alert) => alert.type !== "sentiment_very_negative")
      .map((alert) => {
      if (alert.type === "agent_not_ready_extended" || alert.type === "agent_not_ready_escalated") {
        return {
          id: alert.id,
          severity: alert.severity === "critical" ? "critical" : "warning",
          icon: alert.type,
          title: alert.title,
          detail: alert.detail,
          actionLabel: "View agent",
          actionType: "agent" as const,
          targetId: alert.agentId,
        };
      }

      if (alert.type === "coworker_callback_assigned") {
        return {
          id: alert.id,
          severity: "warning" as const,
          icon: alert.type,
          title: alert.title,
          detail: alert.detail,
          actionLabel: "View callbacks",
          actionType: "queue" as const,
          targetId: alert.taskId,
        };
      }

      return {
        id: alert.id,
        severity: alert.severity === "critical" ? "critical" : "warning",
        icon: alert.type,
        title: alert.title,
        detail: alert.detail,
        actionLabel: "conversationId" in alert && alert.conversationId ? "View" : "Review",
        actionType:
          "conversationId" in alert && alert.conversationId
            ? ("conversation" as const)
            : ("queue" as const),
        targetId:
          ("conversationId" in alert && alert.conversationId) ||
          ("queueId" in alert && alert.queueId) ||
          undefined,
      };
    }),
  };
}

export function isCallbackEligibleChannel(channel: string): boolean {
  return CALLBACK_ELIGIBLE_CHANNELS.has(channel);
}

export type CallbackAssignmentTarget = {
  conversationId?: string | null;
  contactId?: string | null;
  queueId?: string | null;
  channel: string;
  customerName: string;
  title?: string;
  summary?: string;
};

export function callbackAgentsFromSnapshot(snapshot: MonitoringSnapshot) {
  return snapshot.agents.filter((agent) => {
    if (agent.canReceiveCallback === false) return false;
    if (agent.presence === "offline") return false;
    return agent.capacity.some(
      (row) => CALLBACK_ELIGIBLE_CHANNELS.has(row.channel) && row.active < row.max,
    );
  });
}