export type AgentTaskType = "follow_up" | "callback" | "suggestion";

export type AgentTaskStatus = "open" | "completed" | "dismissed";

export type AgentTaskPriority = "low" | "normal" | "high" | "critical";

export type AgentTaskSource = "self" | "admin" | "coworker" | "system";

export type AgentTask = {
  id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
  source: AgentTaskSource;
  title: string;
  summary: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  channel: "voice" | "email" | "webchat" | "whatsapp" | "instagram" | "facebook" | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  assignedBy?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  notes?: string | null;
};

export type AgentTaskTab = "admin_assigned" | "coworker_assigned" | "done";

export type AgentTaskStats = {
  open: number;
  dueToday: number;
  overdue: number;
};
