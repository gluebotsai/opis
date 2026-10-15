/**
 * Thin Express → AI service HTTP client.
 */
const AGENTS_URL = (
  process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012"
).replace(/\/$/, "");

function tasksSecret(): string {
  return (
    String(process.env.COWORKER_TASKS_SECRET || "").trim() ||
    "worktual-tasks-dev-secret"
  );
}

/** Pull a human-readable message from agents SSE / envelope error shapes. */
export function aiStreamErrorDetail(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== "object") return "AI service stream error";
  const nested =
    payload.payload && typeof payload.payload === "object"
      ? (payload.payload as Record<string, unknown>)
      : payload;
  const serviceError =
    nested.serviceError && typeof nested.serviceError === "object"
      ? (nested.serviceError as Record<string, unknown>)
      : payload.serviceError && typeof payload.serviceError === "object"
        ? (payload.serviceError as Record<string, unknown>)
        : null;
  const candidates = [
    nested.detail,
    nested.message,
    nested.error,
    serviceError?.message,
    serviceError?.code,
    payload.detail,
    payload.message,
    payload.error,
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return "AI service stream error";
}

/** User text, or a factual attach line from this turn's /uploads/ names. */
export function runMessageFromUploads(
  message: string,
  ticketDraft?: Record<string, unknown> | null,
  extraUrls?: string[]
): string {
  const text = String(message || "").trim();
  if (text) return text;
  const raw = [
    ...(Array.isArray(ticketDraft?.attachments) ? ticketDraft.attachments : []),
    ...(Array.isArray(extraUrls) ? extraUrls : []),
  ];
  const names = raw
    .map((item) => String(item || "").trim())
    .filter(
      (url) =>
        url.startsWith("/uploads/") && !url.includes("..") && !url.includes("\\")
    )
    .map((url) => url.split("/").filter(Boolean).pop() || url);
  if (!names.length) return "";
  return `Attached ${names.join(", ")}`;
}

export type AiAgentRunInput = {
  agentName?: string;
  message: string;
  organizationId: string;
  userId?: string;
  userRole?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  sessionId?: string;
  requestId?: string;
  module?: string;
  surface?: string;
  page?: string;
  pageSurface?: string;
  channel?: string;
  history?: Array<{ role: string; text: string }>;
  focusedEntity?: Record<string, unknown> | null;
  drafts?: Record<string, unknown>;
  ticketDraft?: Record<string, unknown> | null;
  sessionMemory?: Record<string, unknown>;
  canCreateTicket?: boolean;
  mcpToken?: string;
  portalCustomerId?: string | null;
  portalAuthenticated?: boolean;
  portalAuthMode?: string | null;
  confirmTool?: Record<string, unknown> | null;
  executionMode?: "native" | "legacy" | "dry_run";
  locale?: string;
  debug?: boolean;
};

export async function callAiServiceAgent(
  input: AiAgentRunInput
): Promise<Record<string, unknown>> {
  const agent = encodeURIComponent(input.agentName || "ticketing-coworker");
  const url = `${AGENTS_URL}/ai/v1/agents/${agent}/run`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Coworker-Tasks-Key": tasksSecret(),
    },
    body: JSON.stringify(agentRunBody(input)),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(
      String(
        (data as { message?: string }).message ||
          (data as { error?: string }).error ||
          `AI service HTTP ${res.status}`
      )
    ) as Error & { status?: number; payload?: Record<string, unknown> };
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function agentRunBody(input: AiAgentRunInput): Record<string, unknown> {
  return {
    message: input.message,
    organization_id: input.organizationId,
    user_id: input.userId,
    user_role: input.userRole,
    user_name: input.userName,
    user_email: input.userEmail,
    user_phone: input.userPhone,
    session_id: input.sessionId,
    request_id: input.requestId,
    module: input.module,
    surface: input.surface,
    page: input.page,
    page_surface: input.pageSurface,
    channel: input.channel || "chat",
    history: input.history || [],
    focused_entity: input.focusedEntity || null,
    drafts: input.drafts || {},
    ticket_draft: input.ticketDraft || null,
    session_memory: input.sessionMemory || {},
    can_create_ticket: input.canCreateTicket,
    mcp_token: input.mcpToken,
    portal_customer_id: input.portalCustomerId || null,
    portal_authenticated: input.portalAuthenticated,
    portal_auth_mode: input.portalAuthMode || null,
    confirm_tool: input.confirmTool || null,
    execution_mode: input.executionMode || "native",
    locale: input.locale || null,
    ...(input.debug ? { debug: true } : {}),
  };
}

/** Stream progress + final envelope from `/run/stream` (ontology status lines). */
export async function callAiServiceAgentStream(
  input: AiAgentRunInput,
  onProgress?: (event: Record<string, unknown>) => void
): Promise<Record<string, unknown>> {
  const agent = encodeURIComponent(input.agentName || "ticketing-coworker");
  const url = `${AGENTS_URL}/ai/v1/agents/${agent}/run/stream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Coworker-Tasks-Key": tasksSecret(),
    },
    body: JSON.stringify(agentRunBody(input)),
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const err = new Error(
      String(
        (data as { message?: string }).message ||
          (data as { error?: string }).error ||
          `AI service stream HTTP ${res.status}`
      )
    ) as Error & { status?: number; payload?: Record<string, unknown> };
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];
  let result: Record<string, unknown> | null = null;
  let streamError: Error | null = null;

  const flush = () => {
    if (!dataLines.length) {
      eventName = "message";
      return;
    }
    const raw = dataLines.join("\n").trim();
    dataLines = [];
    const name = eventName || "message";
    eventName = "message";
    let payload: Record<string, unknown> = {};
    try {
      payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      payload = { text: raw };
    }
    if (name === "progress") {
      onProgress?.(payload);
    } else if (name === "result") {
      result = payload;
    } else if (name === "error") {
      const status = Number(payload.status || 502);
      const detail = aiStreamErrorDetail(payload);
      const err = new Error(detail) as Error & {
        status?: number;
        payload?: Record<string, unknown>;
      };
      err.status = status;
      err.payload =
        (payload.payload as Record<string, unknown>) || payload;
      streamError = err;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";
    for (const line of parts) {
      const s = line.replace(/\r$/, "");
      if (s.startsWith("event:")) {
        eventName = s.slice(6).trim() || "message";
      } else if (s.startsWith("data:")) {
        dataLines.push(s.slice(5).replace(/^\s/, ""));
      } else if (s === "") {
        flush();
      }
    }
  }
  flush();

  if (streamError) throw streamError;
  if (!result) {
    throw new Error("AI service stream ended without result");
  }
  return result;
}

/** Compatibility: still hit legacy /agent-turn when needed. */
export async function callLegacyAgentTurn(
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${AGENTS_URL}/agent-turn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Coworker-Tasks-Key": tasksSecret(),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(`Legacy agent-turn HTTP ${res.status}`) as Error & {
      status?: number;
      payload?: Record<string, unknown>;
    };
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}
