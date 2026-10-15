import type { ChatMessage } from "@/features/assistant/copilot-engine";
import { env } from "@/config/env";
import { apiV1 } from "@/config/api-paths";
import { ccCoreHttp } from "@/services/http";
import { readAuthFromStorage } from "@/services/http";

export type AssistantAction =
  | { type: "navigate"; path: string }
  | { type: "refresh"; resource: "queues" | "contacts" | "tasks" };

export type CopilotLlmContext = {
  path: string;
  surface: string;
  recordLabel?: string;
  queueId?: string;
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  taskId?: string;
  conversationId?: string;
  incidentId?: string;
  sourceMessageId?: string;
  assistRevision?: number;
  assistStructured?: boolean;
  pendingConfirmation?: {
    id: string;
    tool: string;
    args: Record<string, unknown>;
  };
  range?: string;
  start?: string;
  end?: string;
  contactDraft?: {
    mode: "create" | "update";
    contactId?: string | null;
    fields: Record<string, unknown>;
    nextField: string | null;
    nextQuestion?: string | null;
    skippedFields?: string[];
    ready?: boolean;
  } | null;
  queueDraft?: QueueGuidedDraft | null;
};

export type ContactOperationPreview = {
  mode: "create" | "update";
  contact: Record<string, unknown>;
  changes?: Record<string, unknown>;
};

export type ContactConfirmation = {
  id: string;
  tool: "create_contact" | "update_contact";
  args: Record<string, unknown>;
  message: string;
  preview: ContactOperationPreview;
};

export type ContactDraftField =
  | "firstName"
  | "lastName"
  | "primaryEmail"
  | "primaryPhone"
  | "secondaryEmail"
  | "secondaryPhone"
  | "gender"
  | "dateOfBirth"
  | "company"
  | "industry"
  | "city"
  | "region"
  | "country"
  | "language"
  | "timezone"
  | "customFields"
  | "isActive";

export type ContactGuidedDraft = {
  mode: "create" | "update";
  contactId?: string | null;
  fields: Partial<Record<ContactDraftField, unknown>>;
  nextField: ContactDraftField | null;
  nextQuestion?: string | null;
  skippedFields?: ContactDraftField[];
  ready?: boolean;
};

export type QueueDraftField =
  | "name"
  | "team"
  | "description"
  | "status"
  | "businessHours"
  | "shifts"
  | "staffing"
  | "staffingMode"
  | "shiftAgents"
  | "agentChannels"
  | "addAnotherAgent"
  | "channels"
  | "review";

export type QueueGuidedDraft = {
  mode: "create";
  fields: Partial<{
    name: string;
    teamName: string;
    teamId: string;
    description: string;
    status: "active" | "inactive";
    businessHoursId: string;
    businessHoursName: string;
    businessHoursSkipped?: boolean;
    shiftTypes: string[];
    staffingMode: "specific" | "all" | string;
    staffingComplete?: boolean;
    staffingSkipped?: boolean;
    currentShift: string;
    currentAgentId: string;
    currentAgentName: string;
    shiftAgentAssignments: Record<string, unknown>;
    channels: string[];
  }>;
  nextField: QueueDraftField | null;
  nextQuestion?: string | null;
  ready?: boolean;
  choices?: string[];
  choicesLabel?: string;
  agentChoices?: {
    shift?: string | null;
    queueName?: string | null;
    available?: Array<Record<string, unknown>>;
    elsewhere?: Array<Record<string, unknown>>;
  };
  channelChoices?: {
    agentId?: string | null;
    agentName?: string | null;
    shift?: string | null;
    channels?: string[];
  };
  staffingActions?: {
    currentShift?: string | null;
    otherShifts?: string[];
    actions?: Array<{ id?: string; label?: string; message?: string }>;
  };
  staffingForm?: {
    shiftTypes?: string[];
    queueName?: string | null;
    currentShift?: string | null;
    assignments?: Record<string, unknown>;
    available?: Array<Record<string, unknown>>;
    elsewhere?: Array<Record<string, unknown>>;
    doneMessage?: string;
  };
};

export type CopilotLlmHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CopilotOrchestrateResult = {
  route: string;
  reply: string;
  tools: Array<{ name: string; args: Record<string, unknown> }>;
  config: Record<string, unknown>;
  config_updates: Record<string, unknown>;
};

export async function recordCopilotTurn(input: {
  id?: string;
  conversationId?: string;
  surface: string;
  agentInput: string;
  copilotResponse: string;
  suggestionText?: string;
  latencyMs: number;
  routingChain?: string[];
  promptVersions?: Record<string, string>;
  assistState?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const payload = { ...input };
  if (payload.id && !/^\d+$/.test(payload.id)) {
    delete payload.id;
  }
  const { data } = await ccCoreHttp.post<{ turn: { id: string } }>(
    apiV1("/workspace/copilot/turns"),
    payload,
  );
  return { id: data.turn.id };
}

export type WorkspaceCopilotTurn = {
  id: string;
  conversationId: string | null;
  surface: string | null;
  suggestionText: string | null;
  copilotResponse: string | null;
  createdAt: string;
  assistState: Record<string, unknown> | null;
};

export async function listWorkspaceCopilotTurns(input: {
  conversationId: string;
  surface?: string;
  limit?: number;
}): Promise<WorkspaceCopilotTurn[]> {
  const { data } = await ccCoreHttp.get<{ turns: WorkspaceCopilotTurn[] }>(
    apiV1("/workspace/copilot/turns"),
    {
      params: {
        conversationId: input.conversationId,
        surface: input.surface ?? "inbox",
        limit: input.limit ?? 12,
      },
    },
  );
  return data.turns ?? [];
}

export type CopilotStreamEvent =
  | { event: "status"; data: { phase: string; label: string } }
  | { event: "tool_call"; data: { tool: string; args: Record<string, unknown> } }
  | { event: "text_delta"; data: { delta: string } }
  | { event: "block"; data: ChatMessage }
  | { event: "action"; data: AssistantAction }
  | { event: "contact_draft"; data: ContactGuidedDraft }
  | { event: "queue_draft"; data: QueueGuidedDraft }
  | {
      event: "assist_state";
      data: {
        version: number;
        replyDraft: string;
        privateNotes: Array<{ kind: string; text: string }>;
        actionProposal: {
          id: string;
          actionType: string;
          summary: string;
          collectedInputs: Record<string, unknown>;
          missingInputs: string[];
          confirmationText: string;
          status: "proposed";
        } | null;
        revision: number;
        sourceMessageId: string;
      };
    }
  | {
      event: "confirmation_required";
      data: {
        id: string;
        tool: string;
        args: Record<string, unknown>;
        message: string;
        preview?: ContactOperationPreview;
      };
    }
  | { event: "error"; data: { code: string; message: string } }
  | {
      event: "done";
      data: {
        turnId: string;
        route?: string;
        routingChain?: string[];
        promptVersions?: Record<string, string>;
      };
    };

function parseSseFrame(frame: string): CopilotStreamEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    if (line.startsWith("data:")) data.push(line.slice("data:".length).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: JSON.parse(data.join("\n")) } as CopilotStreamEvent;
}

export async function confirmBooxooTicket(input: {
  conversationId: string;
  collectedInputs: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  ticketNumber?: string | null;
  status?: string | null;
  message?: string;
  existing?: boolean;
}> {
  const auth = readAuthFromStorage();
  const { data } = await ccCoreHttp.post<{
    ok?: boolean;
    ticketNumber?: string | null;
    status?: string | null;
    message?: string;
    existing?: boolean;
  }>(apiV1("/assistant/copilot/suggest-reply/confirm"), {
    conversationId: input.conversationId,
    collectedInputs: input.collectedInputs,
    role: "agent",
    tenant_id: auth.organizationId ?? (import.meta.env.DEV ? env.tenantId : undefined),
    user_id: auth.userId ?? (import.meta.env.DEV ? env.userId : undefined),
  });
  return {
    ok: Boolean(data.ok),
    ticketNumber: data.ticketNumber,
    status: data.status,
    message: data.message,
    existing: data.existing,
  };
}

export async function streamCopilotMessage(
  message: string,
  role: "admin" | "agent",
  options: {
    context: CopilotLlmContext & { queueId?: string };
    history?: CopilotLlmHistoryMessage[];
    confirmedActions?: string[];
    signal?: AbortSignal;
    fastSuggestion?: boolean;
    onEvent: (event: CopilotStreamEvent) => void;
  },
): Promise<void> {
  const auth = readAuthFromStorage();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  } else if (import.meta.env.DEV) {
    const tenantId = auth.organizationId ?? env.tenantId;
    const userId = auth.userId ?? env.userId;
    if (tenantId) headers["x-tenant-id"] = tenantId;
    if (userId) headers["x-user-id"] = userId;
  }

  const endpoint = options.fastSuggestion ? "suggest-reply/stream" : "stream";
  const response = await fetch(`${env.ccCoreUrl}${apiV1(`/assistant/copilot/${endpoint}`)}`, {
    method: "POST",
    headers,
    signal: options.signal,
    body: JSON.stringify({
      message,
      role,
      context: options.context,
      history: options.history ?? [],
      confirmed_actions: options.confirmedActions ?? [],
      tenant_id: auth.organizationId ?? (import.meta.env.DEV ? env.tenantId : undefined),
      user_id: auth.userId ?? (import.meta.env.DEV ? env.userId : undefined),
    }),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(detail || `Worktual co-worker request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event) options.onEvent(event);
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const event = parseSseFrame(buffer);
    if (event) options.onEvent(event);
  }
}

export async function sendCopilotOrchestrateMessage(
  message: string,
  role: "admin" | "agent",
  options?: {
    context?: CopilotLlmContext;
    history?: CopilotLlmHistoryMessage[];
  },
): Promise<CopilotOrchestrateResult> {
  const { data } = await ccCoreHttp.post<CopilotOrchestrateResult & { error?: string }>(
    apiV1("/assistant/orchestrate"),
    {
      message,
      role,
      context: options?.context,
      history: options?.history,
    },
  );

  return {
    route: data.route ?? "general_assistance",
    reply: data.reply ?? "",
    tools: data.tools ?? [],
    config: data.config ?? {},
    config_updates: data.config_updates ?? {},
  };
}

export async function sendCopilotLlmMessage(
  message: string,
  role: "admin" | "agent",
  options?: {
    context?: CopilotLlmContext;
    history?: CopilotLlmHistoryMessage[];
  },
): Promise<{ reply: string }> {
  const { data } = await ccCoreHttp.post<{ reply?: string; error?: string }>(
    apiV1("/assistant/llm"),
    {
      message,
      role,
      context: options?.context,
      history: options?.history,
    },
  );

  return { reply: data.reply ?? "" };
}

export const ASSISTANT_REFRESH_QUEUES = "assistant:refresh-queues";
export const ASSISTANT_REFRESH_CONTACTS = "assistant:refresh-contacts";
export const ASSISTANT_REFRESH_TASKS = "assistant:refresh-tasks";
export const ASSISTANT_REFRESH_MONITORING = "assistant:refresh-monitoring";
export const ASSISTANT_CONTACT_PREVIEW = "assistant:contact-preview";
export const ASSISTANT_CONTACT_DRAFT = "assistant:contact-draft";
export const ASSISTANT_QUEUE_DRAFT = "assistant:queue-draft";
export const ASSISTANT_CONFIRM_CONTACT = "assistant:confirm-contact";
export const ASSISTANT_CANCEL_CONTACT_PREVIEW = "assistant:cancel-contact-preview";
export const ASSISTANT_COWORKER_REQUEST = "assistant:coworker-request";
export const ASSISTANT_WORKSPACE_OPEN_CONVERSATION = "assistant:workspace-open-conversation";
export const ASSISTANT_WORKSPACE_CONTACT_UPDATED = "assistant:workspace-contact-updated";
export const COPILOT_USE_SUGGESTION = "copilot:use-suggestion";

export function dispatchCopilotSuggestion(
  conversationId: string,
  text: string,
  copilotTurnId?: string,
) {
  const container = document.createElement("div");
  container.innerHTML = text;
  const plainText = container.textContent?.trim() ?? text;
  window.dispatchEvent(
    new CustomEvent(COPILOT_USE_SUGGESTION, {
      detail: { conversationId, text: plainText, copilotTurnId },
    }),
  );
}

export function dispatchCoworkerRequest(message: string) {
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_COWORKER_REQUEST, {
      detail: { message },
    }),
  );
}

export function dispatchAssistantRefresh(resource: "queues" | "contacts" | "tasks" | "monitoring") {
  if (resource === "queues") {
    window.dispatchEvent(new CustomEvent(ASSISTANT_REFRESH_QUEUES));
    return;
  }
  if (resource === "tasks") {
    window.dispatchEvent(new CustomEvent(ASSISTANT_REFRESH_TASKS));
    return;
  }
  if (resource === "monitoring") {
    window.dispatchEvent(new CustomEvent(ASSISTANT_REFRESH_MONITORING));
    return;
  }
  window.dispatchEvent(new CustomEvent(ASSISTANT_REFRESH_CONTACTS));
}
