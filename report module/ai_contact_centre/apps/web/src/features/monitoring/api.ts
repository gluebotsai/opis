import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";

export type MonitoringSnapshot = {
  generatedAt: string;
  summary: {
    waiting: number;
    active: number;
    botActive: number;
    readyAgents: number;
    loggedInAgents: number;
    slaAtRisk: number;
    slaBreached: number;
    offersRinging: number;
  };
  queues: Array<{
    id: string;
    name: string;
    waiting: number;
    active: number;
    botActive: number;
    oldestWaitSeconds: number | null;
    readyAgents: number;
    closeTime: string | null;
  }>;
  agents: Array<{
    id: string;
    agentId: string;
    name: string;
    email: string;
    workEmail: string | null;
    employeeId: string | null;
    firstName: string | null;
    lastName: string | null;
    teamName: string | null;
    skills: string[];
    shiftTypes: string[];
    primaryLanguage: string | null;
    secondaryLanguage: string | null;
    location: string | null;
    accountStatus: string | null;
    agentStatus: string;
    presenceUpdatedAt: string | null;
    presence: string;
    loggedIn?: boolean;
    attendanceToday: "present" | "absent";
    canReceiveCallback?: boolean;
    queueNames: string[];
    capacity: Array<{
      channel: string;
      active: number;
      reserved: number;
      max: number;
    }>;
    previousConversations: Array<{
      id: string;
      channel: string;
      customerName: string;
      subject: string | null;
      queueName: string | null;
      endedAt: string;
    }>;
  }>;
  conversations: Array<{
    id: string;
    channel: string;
    status: string;
    subject: string | null;
    visitorId: string | null;
    contactId: string | null;
    customerName: string;
    queueId: string | null;
    queueName: string | null;
    assignedAgentId: string | null;
    assignedAgentName: string | null;
    waitSeconds: number | null;
    activeSeconds: number | null;
    createdAt: string;
    priority: number;
    slaStatus: "ok" | "warning" | "breached" | null;
  }>;
  waiting: Array<{
    id: string;
    conversationId: string;
    contactId: string | null;
    customerName: string;
    channel: string;
    queueId: string | null;
    queueName: string | null;
    waitingSeconds: number;
    position: number;
    priority: number;
    slaStatus: "ok" | "warning" | "breached" | null;
  }>;
  missed: Array<{
    id: string;
    conversationId: string | null;
    contactId: string | null;
    customerName: string;
    channel: string;
    queueId: string | null;
    queueName: string | null;
    occurredAt: string;
    waitSeconds: number | null;
    reason: "offer_timeout" | "no_agent_available";
    priority: "low" | "normal" | "high" | "critical";
    callbackAssigned: boolean;
    callbackAssignedAgentName: string | null;
    callbackTaskId: string | null;
    callbackStatus?: "open" | "completed" | null;
    callbackAssignmentSource?: "admin" | "coworker" | null;
    connectedAfterMiss?: boolean;
    connectedAt?: string | null;
    connectedAgentName?: string | null;
  }>;
  callbacks: Array<{
    id: string;
    taskId: string;
    conversationId: string | null;
    contactId: string | null;
    customerName: string;
    channel: string;
    title: string;
    assignedAgentName: string;
    assignedBy: string | null;
    assignmentSource?: "admin" | "coworker" | null;
    createdAt: string;
    status?: "open" | "completed" | "dismissed";
    completedAt?: string | null;
    priority: "low" | "normal" | "high" | "critical";
  }>;
  alerts: Array<
    | {
        id: string;
        type: "sla_warning" | "sla_breached" | "offer_expiring" | "long_wait";
        severity: "warning" | "critical";
        title: string;
        detail: string;
        conversationId?: string;
        queueId?: string;
      }
    | {
        id: string;
        type: "agent_not_ready_extended";
        severity: "warning";
        title: string;
        detail: string;
        agentId: string;
        createdAt: string;
      }
    | {
        id: string;
        type: "agent_not_ready_escalated";
        severity: "critical";
        title: string;
        detail: string;
        agentId: string;
        escalationId: string;
        createdAt: string;
        insight?: {
          summary: string;
          suggestion: string;
          classification: string;
          classificationLabel?: string;
        };
      }
    | {
        id: string;
        type: "coworker_callback_assigned";
        severity: "info";
        title: string;
        detail: string;
        attemptId: string;
        taskId: string;
        contactId?: string;
        queueId?: string;
        channel?: string;
        missedContactId?: string;
        createdAt: string;
      }
    | {
        id: string;
        type: "sentiment_very_negative";
        severity: "critical";
        title: string;
        detail: string;
        conversationId: string;
        channel: string;
        customerName: string;
        agentName: string;
        queueName: string | null;
        subject: string | null;
        side: "customer" | "agent";
        createdAt: string;
      }
  >;
};

export type CreateCallbackTaskInput = {
  assignedUserId: string;
  conversationId?: string;
  contactId?: string;
  channel?: "whatsapp" | "instagram" | "facebook" | "email";
  title?: string;
  summary?: string;
  notes?: string;
  dueAt?: string;
  priority?: "low" | "normal" | "high" | "critical";
};

export type AgentAttendanceDay = {
  date: string;
  attendance: "present" | "absent";
  hasHistory: boolean;
  durationsSeconds: Record<string, number>;
};

export type AgentAttendanceRangeResponse = {
  timeZone: string;
  days: AgentAttendanceDay[];
};

export type AgentAttendanceDayResponse = {
  timeZone: string;
  day: AgentAttendanceDay;
};

export type AgentAttentionInsight = {
  classification: string;
  classificationLabel: string;
  summary: string;
  suggestion: string;
  generatedAt: string;
  source: "nlp" | "rules";
  context: {
    agentId: string;
    agentName: string;
    teamName: string | null;
    queueNames: string[];
    notReadyMinutes: number;
    todayKpis: {
      handled: number;
      teamAvgHandled: number | null;
      slaRate: number | null;
    };
    presenceTodaySeconds: Record<string, number>;
    escalationsLast7Days: number;
    queueWaitingTotal: number;
  };
};

export type CallbackChannelOption = "whatsapp" | "instagram" | "facebook" | "email";

export type ContactCallbackChannels = {
  preferredChannel: CallbackChannelOption | null;
  availableChannels: CallbackChannelOption[];
  source: "explicit" | "inferred" | "hint" | null;
};

export const monitoringApi = {
  async getSnapshot(): Promise<MonitoringSnapshot> {
    const { data } = await ccCoreHttp.get<MonitoringSnapshot>(apiV1("/monitoring/snapshot"));
    return data;
  },

  async getContactCallbackChannels(
    contactId: string,
    hintChannel?: CallbackChannelOption,
  ): Promise<ContactCallbackChannels> {
    const { data } = await ccCoreHttp.get<ContactCallbackChannels>(
      apiV1(`/monitoring/contacts/${encodeURIComponent(contactId)}/callback-channels`),
      {
        params: hintChannel ? { hintChannel } : undefined,
      },
    );
    return data;
  },

  async createCallbackTask(input: CreateCallbackTaskInput): Promise<{ task: { id: string } }> {
    const { data } = await ccCoreHttp.post<{ task: { id: string } }>(
      apiV1("/monitoring/callback-tasks"),
      input,
    );
    return data;
  },

  async logoutAgent(agentId: string): Promise<{ ok: true }> {
    const { data } = await ccCoreHttp.post<{ ok: true }>(
      apiV1(`/monitoring/agents/${agentId}/logout`),
    );
    return data;
  },

  async setAgentPresence(
    agentId: string,
    presence: "ready" | "not_ready",
  ): Promise<{ ok: true; presence: "ready" | "not_ready" }> {
    const { data } = await ccCoreHttp.post<{ ok: true; presence: "ready" | "not_ready" }>(
      apiV1(`/monitoring/agents/${encodeURIComponent(agentId)}/presence`),
      { presence },
    );
    return data;
  },

  async getAgentPreviousConversations(
    agentId: string,
  ): Promise<{ conversations: MonitoringSnapshot["agents"][number]["previousConversations"] }> {
    const { data } = await ccCoreHttp.get<{
      conversations: MonitoringSnapshot["agents"][number]["previousConversations"];
    }>(apiV1(`/monitoring/agents/${encodeURIComponent(agentId)}/previous-conversations`));
    return data;
  },

  async getAgentAttendance(
    agentId: string,
    params?: { from?: string; to?: string; date?: string },
  ): Promise<AgentAttendanceRangeResponse | AgentAttendanceDayResponse> {
    const { data } = await ccCoreHttp.get<AgentAttendanceRangeResponse | AgentAttendanceDayResponse>(
      apiV1(`/monitoring/agents/${encodeURIComponent(agentId)}/attendance`),
      { params },
    );
    return data;
  },

  async supervisorForceClose(conversationId: string, reason: string): Promise<void> {
    await ccCoreHttp.post(apiV1(`/workspace/conversations/${conversationId}/supervisor/force-close`), {
      reason,
    });
  },

  async supervisorReassign(
    conversationId: string,
    input: { reason: string; agentId: string },
  ): Promise<void> {
    await ccCoreHttp.post(apiV1(`/workspace/conversations/${conversationId}/supervisor/reassign`), input);
  },

  async supervisorTakeover(conversationId: string, reason: string): Promise<void> {
    await ccCoreHttp.post(apiV1(`/workspace/conversations/${conversationId}/supervisor/takeover`), {
      reason,
    });
  },

  async acknowledgeNotReadyEscalation(escalationId: string): Promise<{ ok: true }> {
    const { data } = await ccCoreHttp.post<{ ok: true }>(
      apiV1(`/monitoring/not-ready-escalations/${encodeURIComponent(escalationId)}/acknowledge`),
    );
    return data;
  },

  async getAgentAttentionInsight(escalationId: string): Promise<{ insight: AgentAttentionInsight }> {
    const { data } = await ccCoreHttp.get<{ insight: AgentAttentionInsight }>(
      apiV1(`/monitoring/not-ready-escalations/${encodeURIComponent(escalationId)}/insight`),
    );
    return data;
  },

  async acknowledgeProactiveCallback(attemptId: string): Promise<{ ok: true }> {
    const { data } = await ccCoreHttp.post<{ ok: true }>(
      apiV1(`/monitoring/proactive-callbacks/${encodeURIComponent(attemptId)}/acknowledge`),
    );
    return data;
  },
};
