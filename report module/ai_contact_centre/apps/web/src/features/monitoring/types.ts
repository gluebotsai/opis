export type MonitoringTab = "agents" | "queues";

export type AgentStatus = "available" | "busy" | "wrap-up" | "away" | "offline";

export type MonitoringChannel = "voice" | "webchat" | "whatsapp" | "instagram" | "email" | "facebook";

export type SlaStatus = "healthy" | "at_risk" | "breached";

export type AgentChannelCapacity = {
  channel: MonitoringChannel;
  active: number;
  reserved: number;
  max: number;
};

export type AgentPastConversation = {
  id: string;
  channel: MonitoringChannel;
  customer: string;
  intent: string;
  queue: string;
  endedAt: string;
};

export type LiveAgent = {
  id: string;
  agentId: string;
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
  name: string;
  initials: string;
  status: AgentStatus;
  /** Raw presence from cc-core — used for display labels aligned with workspace toolbar. */
  presence: string;
  /** Logged in at any point today (org day), even if currently offline. */
  attendanceToday: "present" | "absent";
  /** False for admin users. They stay out of the Agents list. */
  canReceiveCallback?: boolean;
  channels: MonitoringChannel[];
  queues: string[];
  activeCount: number;
  maxCapacity: number;
  channelCapacity: AgentChannelCapacity[];
  lastActivityAt: string;
  conversations: LiveAgentConversation[];
  previousConversations: AgentPastConversation[];
};

export type LiveAgentConversation = {
  id: string;
  channel: MonitoringChannel;
  customer: string;
  durationSeconds: number;
  intent: string;
  sla: SlaStatus;
  queue: string;
  /** Resolved/closed conversation opened from agent history — read-only transcript. */
  isPast?: boolean;
};

/** A conversation that is still open: waiting, with an agent, or with the bot. */
export type LiveConversation = {
  id: string;
  channel: MonitoringChannel;
  customer: string;
  queue: string;
  status: string;
  agentName: string | null;
  /** When the conversation was created. The live clock counts from this. */
  startedAt: string | null;
  durationSeconds: number;
  intent: string;
  sla: SlaStatus;
};

export type QueueSnapshot = {
  id: string;
  name: string;
  waiting: number;
  active: number;
  botActive: number;
  oldestWaitSeconds: number | null;
  readyAgents: number;
  status: "healthy" | "watch" | "critical";
  slaRisk: number;
};

export type MonitoringSummary = {
  waiting: number;
  active: number;
  botActive: number;
  readyAgents: number;
  loggedInAgents: number;
  slaAtRisk: number;
  slaBreached: number;
  offersRinging: number;
};

export type WaitingInteraction = {
  id: string;
  position: number;
  customer: string;
  channel: MonitoringChannel;
  queue: string;
  waitingSeconds: number;
  priority: "low" | "normal" | "high";
  sla: SlaStatus;
  status: "waiting";
};

export type MissedInteraction = {
  id: string;
  conversationId?: string | null;
  contactId?: string | null;
  customer: string;
  channel: MonitoringChannel;
  queue: string;
  occurredAt: string;
  waitSeconds: number;
  reason: "missed_call" | "abandoned_call" | "abandoned_chat" | "failed_transfer";
  priority: "low" | "normal" | "high";
  callbackAssigned: boolean;
  callbackAssignedAgentName: string | null;
  callbackTaskId: string | null;
  /** open = assigned awaiting agent; completed = callback finished after this miss */
  callbackStatus: "open" | "completed" | null;
  callbackAssignmentSource: "admin" | "coworker" | null;
  connectedAfterMiss: boolean;
  connectedAt: string | null;
  connectedAgentName: string | null;
};

export type CallbackInteraction = {
  id: string;
  taskId: string;
  conversationId: string | null;
  contactId: string | null;
  customer: string;
  channel: MonitoringChannel;
  queue: string;
  title: string;
  assignedAgentName: string;
  assignedBy: string | null;
  assignmentSource: "admin" | "coworker" | null;
  createdAt: string;
  status: "open" | "completed" | "dismissed";
  completedAt: string | null;
  priority: "low" | "normal" | "high";
};

export type ActivityEvent = {
  id: string;
  timestamp: string;
  type:
    | "accepted"
    | "entered_queue"
    | "transferred"
    | "sla_warning"
    | "abandoned"
    | "status_change"
    | "assigned"
    | "closed";
  agent?: string;
  customer?: string;
  channel?: MonitoringChannel;
  description: string;
  severity?: "info" | "warning" | "critical";
};

export type AttentionAlert = {
  id: string;
  severity: "critical" | "warning" | "notice";
  icon: string;
  title: string;
  detail: string;
  actionLabel: string;
  actionType: "conversation" | "agent" | "queue" | "reassign" | "callback";
  targetId?: string;
};

export type LiveMonitoringState = {
  updatedAt: string;
  summary: MonitoringSummary;
  agents: LiveAgent[];
  queues: QueueSnapshot[];
  waiting: WaitingInteraction[];
  missed: MissedInteraction[];
  callbacks: CallbackInteraction[];
  liveConversations: LiveConversation[];
  activity: ActivityEvent[];
  alerts: AttentionAlert[];
};

export type ConversationDetail = LiveAgentConversation & {
  agentName: string;
  messages?: string[];
};
