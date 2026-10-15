import { sdkErrorText, sdkStableCode } from "../errorText.js";
import { TicketingApiError } from "../http.js";
import type { HttpClient } from "../http.js";
import { resolveLocale } from "../locale.js";
import type { AiToolProposal, AiTurnInput, AiTurnResult, AiTurnStatus } from "../types.js";
import { createProposalResource } from "./proposals.js";
import { createTaskResource } from "./tasks.js";

type AgentTurnPayload = {
  assistantText?: string | null;
  reply?: string | null;
  agent?: string;
  session_id?: string;
  request_id?: string;
  ui_actions?: unknown[];
  toolProposals?: unknown[];
  data?: Record<string, unknown>;
  trace?: unknown;
  sessionMemoryPatch?: Record<string, unknown> | null;
  error?: string;
  detail?: string;
  code?: string;
  status?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function proposalsFrom(raw: unknown): AiToolProposal[] {
  if (!Array.isArray(raw)) return [];
  const out: AiToolProposal[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const name = String(row.name || "").trim();
    if (!name) continue;
    const args = asRecord(row.args) || undefined;
    out.push({
      name,
      args,
      risk: typeof row.risk === "string" ? row.risk : undefined,
      auto: typeof row.auto === "boolean" ? row.auto : undefined,
    });
  }
  return out;
}

export function turnStatus(proposals: AiToolProposal[]): AiTurnStatus {
  const needsConfirm = proposals.some(
    (proposal) => proposal.auto === false || proposal.risk === "high"
  );
  if (needsConfirm) return "confirmation_required";
  const applied = proposals.some((proposal) => proposal.auto === true);
  return applied ? "applied" : "answered";
}

function focusedEntity(input: AiTurnInput): Record<string, unknown> | undefined {
  if (input.focusedEntity) return input.focusedEntity;
  const ticket = String(input.focusedTicketId || "").trim();
  if (!ticket) return undefined;
  return { type: "ticket", id: ticket, ticketNumber: ticket };
}

function turnBody(http: HttpClient, input: AiTurnInput, feature: string) {
  const locale = resolveLocale(input.locale, http.config.locale);
  return {
    feature,
    locale,
    body: {
      message: input.message,
      locale,
      session_id: input.sessionId,
      module: input.module,
      page: input.page,
      history: input.history,
      focused_entity: focusedEntity(input),
      entity_id: input.focusedTicketId,
      ticket_draft: input.ticketDraft,
      session_memory: input.sessionMemory,
      confirm_tool: input.confirmTool,
      sdk_task: input.sdkTask,
      ...(input.debug ? { debug: true } : {}),
    },
  };
}

function customerMissing(value: unknown, depth = 0): boolean {
  if (depth > 5 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => customerMissing(item, depth + 1));
  const row = value as Record<string, unknown>;
  if (row.customer_not_found === true || row.customerNotFound === true) return true;
  for (const key of ["ticket_draft", "ticketDraft", "draft", "collected", "durable", "lastToolOutcome", "last_tool_outcome"]) {
    if (key in row && customerMissing(row[key], depth + 1)) return true;
  }
  return false;
}

function turnCode(payload: AgentTurnPayload, data: Record<string, unknown> | undefined, patch: Record<string, unknown> | null): string | undefined {
  const refusal = asRecord(data?.refusal);
  return (
    sdkStableCode(payload.code) ||
    sdkStableCode(data?.code) ||
    sdkStableCode(refusal?.code) ||
    (customerMissing(data) || customerMissing(patch) ? "customer_not_found" : undefined) ||
    undefined
  );
}

function routingTrace(value: unknown): AiTurnResult["trace"] {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const agents = Array.isArray(raw.agents)
    ? raw.agents.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const routes: Array<{ from: string; to: string }> = [];
  if (Array.isArray(raw.routes)) {
    for (const item of raw.routes) {
      const row = asRecord(item);
      if (!row) continue;
      const to = String(row.to || "").trim();
      if (!to) continue;
      routes.push({ from: String(row.from || "").trim(), to });
    }
  }
  if (!agents.length && !routes.length) return undefined;
  return { agents, routes };
}

function toResult(payload: AgentTurnPayload, locale: string): AiTurnResult {
  const toolProposals = proposalsFrom(payload.toolProposals);
  const uiActions = Array.isArray(payload.ui_actions)
    ? payload.ui_actions.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    : [];
  const patch = asRecord(payload.sessionMemoryPatch);
  const lastTool =
    asRecord(patch?.lastToolOutcome) || asRecord(patch?.last_tool_outcome);
  const base = asRecord(payload.data) || {};
  const data = lastTool ? { ...base, lastToolOutcome: lastTool } : asRecord(payload.data) || undefined;
  const code = turnCode(payload, data, patch);
  const catalog = code ? sdkErrorText(code, locale) : null;
  const reply = catalog || String(payload.assistantText || payload.reply || "").trim();
  if (!reply) {
    throw new TicketingApiError(
      String(payload.detail || payload.error || "Empty co-worker reply"),
      502,
      payload
    );
  }
  return {
    reply,
    status: turnStatus(toolProposals),
    agent: String(payload.agent || "general"),
    sessionId: payload.session_id,
    requestId: payload.request_id,
    locale,
    code,
    trace: routingTrace(payload.trace) || routingTrace(asRecord(payload.data)?.trace),
    uiActions,
    toolProposals,
    data,
  };
}

async function readSse(res: Response, onProgress?: AiTurnInput["onProgress"]): Promise<AgentTurnPayload> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new TicketingApiError("Co-worker stream has no body", 502, null);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AgentTurnPayload | null = null;
  let streamError: AgentTurnPayload | null = null;

  const consume = (block: string) => {
    const lines = block.split(/\r?\n/);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    let data: unknown = dataLines.join("\n");
    try {
      data = JSON.parse(dataLines.join("\n")) as unknown;
    } catch {
      /* keep text */
    }
    const record = asRecord(data) || {};
    if (event === "progress") onProgress?.(record);
    if (event === "result") result = record as AgentTurnPayload;
    if (event === "error") {
      const nested = asRecord(record.payload) || record;
      const status = typeof record.status === "number" ? record.status : undefined;
      streamError = { ...(nested as AgentTurnPayload), status };
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() || "";
    for (const part of parts) {
      if (part.trim()) consume(part);
    }
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);

  if (streamError) {
    const err = streamError as AgentTurnPayload;
    const status = typeof err.status === "number" ? err.status : 502;
    throw new TicketingApiError(
      String(err.detail || err.error || "Co-worker stream failed"),
      status,
      err
    );
  }
  if (!result) {
    throw new TicketingApiError("Co-worker stream ended without a result", 502, null);
  }
  return result;
}

export function createAiResource(http: HttpClient) {
  async function postTurn(input: AiTurnInput, feature: string) {
    const prepared = turnBody(http, input, feature);
    const payload = await http.request<AgentTurnPayload>({
      method: "POST",
      path: "/api/coworker/agent-turn",
      auth: "accessToken",
      accessToken: input.sessionToken,
      headers: { "X-Worktual-Sdk-Feature": prepared.feature },
      body: prepared.body,
    });
    return toResult(payload, prepared.locale);
  }

  return {
    /** One co-worker turn. Super routes; Express still owns writes. */
    turn(input: AiTurnInput): Promise<AiTurnResult> {
      return postTurn(input, "ai.turn");
    },

    /** Same turn over server-sent events. `onProgress` receives progress payloads. */
    async stream(input: AiTurnInput): Promise<AiTurnResult> {
      const feature = input.sdkTask === "ticket.create" ? "ai.tasks.createTicket" : "ai.stream";
      const prepared = turnBody(http, input, feature);
      const res = await http.requestStream({
        method: "POST",
        path: "/api/coworker/agent-turn/stream",
        auth: "accessToken",
        accessToken: input.sessionToken,
        headers: { "X-Worktual-Sdk-Feature": feature },
        body: prepared.body,
      });
      const payload = await readSse(res, input.onProgress);
      return toResult(payload, prepared.locale);
    },

    /** Apply a proposed tool. The session user must be allowed to make that write. */
    confirm(input: AiTurnInput & { confirmTool: { name: string; args?: Record<string, unknown> } }) {
      return postTurn(
        {
          ...input,
          message: input.message || "confirm",
        },
        "ai.confirm"
      );
    },

    /** Decline the pending action in the same co-worker thread. */
    reject(input: AiTurnInput) {
      return postTurn(
        {
          ...input,
          confirmTool: undefined,
          message: input.message || "Do not apply the pending action.",
        },
        "ai.reject"
      );
    },

    /** Button tasks. Each call pins one Skill instead of asking Super to route. */
    tasks: createTaskResource(postTurn),

    /** Proactive cards Worktual already queued. */
    proposals: createProposalResource(http),
  };
}

export type AiResource = ReturnType<typeof createAiResource>;
