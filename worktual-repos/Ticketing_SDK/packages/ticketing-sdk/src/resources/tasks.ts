import { TicketingApiError } from "../http.js";
import type {
  AiInsightResult,
  AiMetricValue,
  AiTaskArticle,
  AiTaskInput,
  AiTaskResult,
  AiTaskStatus,
  AiTaskTicket,
  AiToolProposal,
  AiTurnInput,
  AiTurnResult,
  SdkTaskId,
} from "../types.js";

type CardTaskId = Exclude<
  SdkTaskId,
  "analytics.ask" | "analytics.why" | "ticket.list"
>;
type InsightTaskId = Exclude<SdkTaskId, CardTaskId>;

type TaskSpec = {
  feature: string;
  needsTicket: boolean;
  message: string;
};

const TASKS: Record<CardTaskId, TaskSpec> = {
  "ticket.summarize": {
    feature: "ai.tasks.summarize",
    needsTicket: true,
    message: "Summarize this ticket.",
  },
  "ticket.classify": {
    feature: "ai.tasks.classify",
    needsTicket: true,
    message: "Classify and prioritize this ticket.",
  },
  "ticket.draftReply": {
    feature: "ai.tasks.draftReply",
    needsTicket: true,
    message: "Draft a customer reply for this ticket. Do not send it.",
  },
  "ticket.similar": {
    feature: "ai.tasks.similar",
    needsTicket: true,
    message: "Find similar tickets. Recommend only. Do not merge or update.",
  },
  "ticket.kb": {
    feature: "ai.tasks.recommendKb",
    needsTicket: true,
    message: "Recommend published knowledge articles for this ticket. Do not change the ticket.",
  },
  "intake.deflect": {
    feature: "ai.tasks.deflect",
    needsTicket: false,
    message: "",
  },
  "ticket.create": {
    feature: "ai.tasks.createTicket",
    needsTicket: false,
    message: "",
  },
  "ticket.assign": {
    feature: "ai.tasks.assign",
    needsTicket: true,
    message: "Choose the best assignee for this ticket. Confirm if it already has an owner.",
  },
  "ticket.resolveSuggest": {
    feature: "ai.tasks.resolveSuggest",
    needsTicket: true,
    message: "Suggest resolve or reopen for this ticket. Do not change status until confirmed.",
  },
  "ticket.quality": {
    feature: "ai.tasks.qualityCheck",
    needsTicket: true,
    message: "Review resolution quality for this ticket.",
  },
  "sla.advise": {
    feature: "ai.tasks.slaAdvise",
    needsTicket: true,
    message: "Explain SLA risk for this ticket. Escalate only with confirmation.",
  },
  "ticket.workload": {
    feature: "ai.tasks.workload",
    needsTicket: false,
    message: "Review open workload and recommend a balance. Do not reassign.",
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function articlesFrom(data?: Record<string, unknown>): AiTaskArticle[] {
  const raw = data?.articles;
  if (!Array.isArray(raw)) return [];
  const out: AiTaskArticle[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const title = String(row.title || row.name || "").trim();
    if (!title) continue;
    out.push({
      id: row.id != null ? String(row.id) : undefined,
      title,
      url: row.url != null ? String(row.url) : undefined,
    });
  }
  return out;
}

function ticketsFrom(data?: Record<string, unknown>): AiTaskTicket[] {
  const raw = data?.tickets || data?.similarTickets || data?.similar;
  if (!Array.isArray(raw)) return [];
  const out: AiTaskTicket[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const ticketNumber = String(
      row.ticketNumber || row.ticket_number || row.number || row.id || ""
    ).trim();
    if (!ticketNumber) continue;
    out.push({
      ticketNumber,
      subject: row.subject != null ? String(row.subject) : undefined,
    });
  }
  return out;
}

function gated(proposals: AiToolProposal[]): AiToolProposal | null {
  return (
    proposals.find((proposal) => proposal.auto === false || proposal.risk === "high") || null
  );
}

function deflected(result: AiTurnResult): boolean {
  return Boolean(result.data?.dssa_deflected || result.data?.deflected || result.agent === "dssa");
}

function taskStatus(task: CardTaskId, result: AiTurnResult): AiTaskStatus {
  if (task === "ticket.similar" || task === "ticket.kb" || task === "ticket.workload") {
    return "recommendation";
  }
  if (task === "ticket.quality") {
    if (result.status === "confirmation_required" || result.status === "applied") return result.status;
    return "recommendation";
  }
  if (task === "intake.deflect") {
    if (result.status === "confirmation_required") return "confirmation_required";
    return deflected(result) ? "deflected" : "answered";
  }
  return result.status;
}

function unavailable(result: AiTurnResult): boolean {
  const data = result.data || {};
  if (data.code === "temporarily_unavailable") return true;
  const last = asRecord(data.lastToolOutcome);
  const message = String(last?.message || "");
  return /CONTEXT_LAYER_URL|ONTOLOGY_CHAT_URL/.test(message);
}

function metricValue(row: Record<string, unknown>): AiMetricValue | null {
  const value = row.value ?? row.metric_value ?? row.count;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = row.id ?? row.metric ?? row.metric_id;
  const label = row.label ?? row.name ?? row.metric;
  return {
    id: id != null ? String(id) : undefined,
    label: label != null ? String(label) : undefined,
    value,
  };
}

function isTicketRow(row: Record<string, unknown>): boolean {
  return "ticketNumber" in row || "ticket_number" in row || "subject" in row;
}

function insightParts(result: AiTurnResult): Pick<AiInsightResult, "metrics" | "rows" | "why"> {
  const data = result.data || {};
  const last = asRecord(data.lastToolOutcome);
  const payload = asRecord(last?.payload) || data;
  const nested = asRecord(payload.data) || {};
  const metricSource = payload.metrics || nested.metrics || payload.rows || nested.rows;
  const metrics: AiMetricValue[] = [];
  const rows: Array<Record<string, unknown>> = [];
  if (Array.isArray(metricSource)) {
    for (const item of metricSource) {
      const row = asRecord(item);
      if (!row) continue;
      if (isTicketRow(row)) {
        rows.push(row);
        continue;
      }
      const metric = metricValue(row);
      if (metric) metrics.push(metric);
    }
  }
  const rowSource = payload.rows || nested.rows || payload.tickets;
  if (rows.length === 0 && Array.isArray(rowSource)) {
    for (const item of rowSource) {
      const row = asRecord(item);
      if (row && isTicketRow(row)) rows.push(row);
    }
  }
  const why = typeof payload.answer === "string" ? payload.answer : undefined;
  return { metrics, rows, why };
}

function toInsight(task: InsightTaskId, result: AiTurnResult): AiInsightResult {
  if (unavailable(result)) {
    return {
      ...result,
      task,
      status: "temporarily_unavailable",
      code: "temporarily_unavailable",
      reply: result.reply || "This answer is temporarily unavailable.",
      metrics: [],
      rows: [],
    };
  }
  return { ...result, task, status: "answered", ...insightParts(result) };
}

function toCard(task: CardTaskId, result: AiTurnResult): AiTaskResult {
  return {
    ...result,
    task,
    status: taskStatus(task, result),
    draft: task === "ticket.draftReply" ? result.reply : undefined,
    articles: articlesFrom(result.data),
    tickets: ticketsFrom(result.data),
    proposal: gated(result.toolProposals),
    deflected: task === "intake.deflect" && deflected(result),
  };
}

export function createTaskResource(
  postTurn: (input: AiTurnInput, feature: string) => Promise<AiTurnResult>
) {
  async function run(task: CardTaskId, input: AiTaskInput): Promise<AiTaskResult> {
    const spec = TASKS[task];
    const ticket = String(input.ticketNumber || "").trim();
    if (spec.needsTicket && !ticket) {
      throw new TicketingApiError("ticketNumber is required", 400, null);
    }
    const provided = String(input.message || "").trim();
    if ((task === "intake.deflect" || task === "ticket.create") && !provided) {
      throw new TicketingApiError(
        task === "ticket.create" ? "message is required to create a ticket" : "message is required to deflect",
        400,
        null
      );
    }
    const result = await postTurn(
      {
        message: provided || spec.message,
        locale: input.locale,
        sessionToken: input.sessionToken,
        sessionId: input.sessionId,
        focusedTicketId: ticket || undefined,
        sessionMemory: input.sessionMemory,
        sdkTask: task,
      },
      spec.feature
    );
    return toCard(task, result);
  }

  async function ask(task: InsightTaskId, feature: string, input: AiTaskInput): Promise<AiInsightResult> {
    const message = String(input.message || "").trim();
    if (!message) throw new TicketingApiError("message is required", 400, null);
    const result = await postTurn(
      {
        message,
        locale: input.locale,
        sessionToken: input.sessionToken,
        sessionId: input.sessionId,
        sessionMemory: input.sessionMemory,
        sdkTask: task,
      },
      feature
    );
    return toInsight(task, result);
  }

  return {
    summarize: (input: AiTaskInput) => run("ticket.summarize", input),
    classify: (input: AiTaskInput) => run("ticket.classify", input),
    draftReply: (input: AiTaskInput) => run("ticket.draftReply", input),
    similar: (input: AiTaskInput) => run("ticket.similar", input),
    recommendKb: (input: AiTaskInput) => run("ticket.kb", input),
    deflect: (input: AiTaskInput) => run("intake.deflect", input),
    createTicket: (input: AiTaskInput) => run("ticket.create", input),
    assign: (input: AiTaskInput) => run("ticket.assign", input),
    resolveSuggest: (input: AiTaskInput) => run("ticket.resolveSuggest", input),
    qualityCheck: (input: AiTaskInput) => run("ticket.quality", input),
    slaAdvise: (input: AiTaskInput) => run("sla.advise", input),
    workload: (input: AiTaskInput) => run("ticket.workload", input),
    /** Certified counts. Numbers come from the tool payload. */
    askMetrics: (input: AiTaskInput) => ask("analytics.ask", "ai.tasks.askMetrics", input),
    /** Why a metric moved. The narrative comes from the knowledge graph. */
    askWhy: (input: AiTaskInput) => ask("analytics.why", "ai.tasks.askWhy", input),
    /** Ticket rows. Natural language only; SQL is not a parameter. */
    listTickets: (input: AiTaskInput) => ask("ticket.list", "ai.tasks.listTickets", input),
  };
}

export type AiTaskResource = ReturnType<typeof createTaskResource>;
