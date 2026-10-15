import type { QueueStaffingFormPayload } from "@/components/workforce/queue-staffing-form";

export type ToolStatus = "collecting" | "running" | "success" | "error";

export type CreateQueueArgs = {
  name: string;
  teamName: string;
  status: "active" | "inactive";
  description: string | null;
};

export type CreateQueueResult = {
  id: string;
  createdAt: string;
  draftOnly?: boolean;
};

export type QueueListItem = {
  id: string;
  name: string;
  teamName: string;
  status: "active" | "inactive";
  agentCount: number;
};

export type ListQueuesResult = {
  queues: QueueListItem[];
};

export type QueueActionResult = {
  id: string;
  name: string;
  status?: "active" | "inactive";
  deleted?: boolean;
};

export type TextChatMessage = {
  id: string;
  kind: "text";
  role: "user" | "assistant";
  content: string;
  copilotTurnId?: string;
  createdAt: string;
  queueStaffingForm?: QueueStaffingFormPayload;
};

export type CreateQueueToolMessage = {
  id: string;
  kind: "tool";
  tool: "create_queue";
  status: ToolStatus;
  args: CreateQueueArgs;
  result?: CreateQueueResult;
  error?: string;
  createdAt: string;
};

export type ListQueuesToolMessage = {
  id: string;
  kind: "tool";
  tool: "list_queues";
  status: ToolStatus;
  args: Record<string, never>;
  result?: ListQueuesResult;
  error?: string;
  createdAt: string;
};

export type UpdateQueueStatusToolMessage = {
  id: string;
  kind: "tool";
  tool: "update_queue_status";
  status: ToolStatus;
  args: { queueName: string; status: "active" | "inactive" };
  result?: QueueActionResult;
  error?: string;
  createdAt: string;
};

export type DeleteQueueToolMessage = {
  id: string;
  kind: "tool";
  tool: "delete_queue";
  status: ToolStatus;
  args: { queueName: string };
  result?: QueueActionResult;
  error?: string;
  createdAt: string;
};

export type GenericCopilotToolMessage = {
  id: string;
  kind: "tool";
  tool: "list_teams" | "list_agents" | "list_presence";
  status: ToolStatus;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAt: string;
};

export type GeneratePlotToolMessage = {
  id: string;
  kind: "tool";
  tool: "generate_plot";
  status: ToolStatus;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
};

export type AskSemanticLayerToolMessage = {
  id: string;
  kind: "tool";
  tool: "ask_semantic_layer";
  status: ToolStatus;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
};

export type SqlAnalyticsToolMessage = {
  id: string;
  kind: "tool";
  tool: "sql_analytics";
  status: ToolStatus;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
};

export type GeneratePerformanceReportToolMessage = {
  id: string;
  kind: "tool";
  tool: "generate_performance_report";
  status: ToolStatus;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
};

export type DashboardAnalyticsToolMessage = {
  id: string;
  kind: "tool";
  tool: "get_dashboard_analytics_snapshot" | "get_analytics_hourly_volume";
  status: ToolStatus;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
};

export type ContactToolMessage = {
  id: string;
  kind: "tool";
  tool:
    | "list_contacts"
    | "get_contact"
    | "create_contact"
    | "update_contact";
  status: ToolStatus;
  args: Record<string, unknown>;
  result?: {
    contact?: Record<string, unknown>;
    contacts?: Array<Record<string, unknown>>;
    deleted?: boolean;
    [key: string]: unknown;
  };
  error?: string;
  createdAt: string;
};

export type TaskToolMessage = {
  id: string;
  kind: "tool";
  tool: "list_tasks" | "get_task" | "update_task" | "open_task_workspace";
  status: ToolStatus;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
};

export type ToolMessage =
  | CreateQueueToolMessage
  | ListQueuesToolMessage
  | UpdateQueueStatusToolMessage
  | DeleteQueueToolMessage
  | GenericCopilotToolMessage
  | GeneratePlotToolMessage
  | AskSemanticLayerToolMessage
  | SqlAnalyticsToolMessage
  | GeneratePerformanceReportToolMessage
  | DashboardAnalyticsToolMessage
  | ContactToolMessage
  | TaskToolMessage;

export type ChatMessage = TextChatMessage | ToolMessage;

export function helpText(role: "admin" | "agent") {
  if (role === "agent") {
    return [
      "I can help you navigate and answer questions. Try:",
      "• “Show my queues”",
      "• “Go to inbox”",
    ].join("\n");
  }
  return [
    "I'm your Worktual co-worker. I can:",
    "• **List queues** and summarize the result",
    "• **Create a queue** with you, one question at a time",
    "• **Activate / Deactivate** a queue by name",
    "• **Delete queue** by name",
    "• **Go to queues** / **Open create queue**",
    "",
    "I’ll show progress in the activity loader while I work. Traditional forms and buttons remain available.",
  ].join("\n");
}
