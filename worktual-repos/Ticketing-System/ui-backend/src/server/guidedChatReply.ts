/**
 * Guided chat phrasing — Express callers stay the same,
 * implementation proxies to Python coworker-agents (no Node LLM).
 * Returns LLM text only; throws if the agents service cannot produce a reply.
 */

export type GuidedModule = "ticket" | "team" | "greeting" | "nav";

export type GuidedChatReplyInput = {
  module: GuidedModule;
  kind: string;
  userText?: string;
  pageLabel?: string;
  context?: Record<string, string | number | boolean | null | undefined>;
  validationHint?: string;
  /** Intent hint for the model only — never returned as the user-visible reply. */
  fallback: string;
  ticketDraft?: Record<string, string | number | boolean | null | undefined>;
};

export type TicketReasonIntent =
  | "correct_field"
  | "provide_issue"
  | "confirm"
  | "cancel"
  | "ambiguous"
  | "question"
  | "continue";

export type TicketReasonField =
  | "email"
  | "phone"
  | "name"
  | "issue"
  | "contact"
  | null;

export type TicketReasonResult = {
  intent: TicketReasonIntent;
  field: TicketReasonField;
  newValue: string | null;
  reason: string;
  reply: string;
};

export type TicketReasonInput = {
  userText: string;
  stepId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  issue?: string;
  subject?: string;
  fallbackReply: string;
};

const COWORKER_AGENTS_URL = (
  process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012"
).replace(/\/$/, "");

function agentsHeaders(): Record<string, string> {
  const secret =
    String(process.env.COWORKER_TASKS_SECRET || "").trim() ||
    "worktual-tasks-dev-secret";
  return {
    "Content-Type": "application/json",
    "X-Coworker-Tasks-Key": secret,
  };
}

function normalizeReply(s: string): string {
  return s
    .toLowerCase()
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripIntentPrefix(s: string): string {
  const t = normalizeReply(s);
  return t.startsWith("intent:") ? t.slice("intent:".length).trim() : t;
}

/** True when the model pasted Intent/fallback/nextStep instead of writing. */
function isSeedOrNextStepEcho(
  reply: string,
  fallback: string,
  nextStep: string
): boolean {
  const norm = normalizeReply(reply);
  if (!norm) return true;
  if (norm.startsWith("intent:")) return true;
  if (fallback) {
    const fb = normalizeReply(fallback);
    const fbCore = stripIntentPrefix(fallback);
    if (norm === fb || norm === fbCore) return true;
    if (fbCore.length >= 24 && norm.includes(fbCore) && norm.length <= fbCore.length + 48) {
      return true;
    }
  }
  if (nextStep) {
    const ns = normalizeReply(nextStep);
    if (!ns) return false;
    if (norm === ns || norm.endsWith(ns)) return true;
    if (ns.length >= 12 && norm.includes(ns) && norm.length <= ns.length + 48) {
      return true;
    }
  }
  return false;
}

export async function guidedChatReply(
  input: GuidedChatReplyInput
): Promise<string> {
  const payload = {
    module: input.module,
    kind: input.kind,
    fallback: input.fallback,
    user_text: input.userText,
    page_label: input.pageLabel,
    context: input.context || {},
    validation_hint: input.validationHint,
    ticket_draft: input.ticketDraft || undefined,
  };

  const callOnce = async (): Promise<string> => {
    const upstream = await fetch(`${COWORKER_AGENTS_URL}/phrase`, {
      method: "POST",
      headers: agentsHeaders(),
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) {
      throw new Error(`phrase HTTP ${upstream.status}`);
    }
    const data = (await upstream.json().catch(() => ({}))) as {
      reply?: string;
      error?: string;
    };
    const reply = String(data.reply || "")
      .replace(/^\s*intent\s*:\s*[^\n]*(?:\n+|$)/i, "")
      .trim();
    if (!reply) throw new Error(data.error || "empty phrase reply");
    const nextStep = String(
      (input.context && (input.context as { nextStep?: unknown }).nextStep) || ""
    ).trim();
    if (isSeedOrNextStepEcho(reply, input.fallback || "", nextStep)) {
      throw new Error("phrase echoed static seed or nextStep");
    }
    return reply;
  };

  try {
    return await callOnce();
  } catch (err) {
    console.warn("guidedChatReply retry", err);
    try {
      return await callOnce();
    } catch (err2) {
      console.warn("guidedChatReply Python proxy failed", err2);
      throw err2;
    }
  }
}

export async function guidedTicketReasonTurn(
  input: TicketReasonInput
): Promise<TicketReasonResult | null> {
  try {
    const upstream = await fetch(`${COWORKER_AGENTS_URL}/ticket-reason`, {
      method: "POST",
      headers: agentsHeaders(),
      body: JSON.stringify({
        user_text: input.userText,
        step_id: input.stepId,
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone,
        issue: input.issue,
        subject: input.subject,
        fallback_reply: input.fallbackReply,
      }),
    });
    if (!upstream.ok) return null;
    const data = (await upstream.json()) as TicketReasonResult;
    if (!data?.reply || !data?.intent) return null;
    return data;
  } catch (err) {
    console.warn("guidedTicketReasonTurn Python proxy failed", err);
    return null;
  }
}
