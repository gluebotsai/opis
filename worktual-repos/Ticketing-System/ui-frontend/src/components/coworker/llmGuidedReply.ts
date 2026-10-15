/**
 * Client helpers for co-worker replies.
 * Rule: never show static seed/fallback text to the user — only Python LLM output
 * (guided /phrase or LangGraph /chat).
 */
import {
  askCoworkerAgents,
  type CoworkerHistoryItem,
  type TicketDraftSnapshot,
} from "../../config/coworker";

export async function llmGuidedReply(
  payload: {
    module: "ticket" | "team" | "greeting" | "nav" | "macro" | "kb" | "priority";
    kind: string;
    userText?: string;
    pageLabel?: string;
    context?: Record<string, string | number | boolean | null | undefined>;
    validationHint?: string;
  },
  /** Intent hint for the model only — never shown to the user. */
  intentHint: string
): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch("/api/coworker/guided-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify({ ...payload, fallback: intentHint }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const reply = String(data.reply || "")
      .replace(/^\s*intent\s*:\s*[^\n]*(?:\n+|$)/i, "")
      .trim();
    if (!reply) return null;
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/\*+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const stripIntent = (s: string) => {
      const t = norm(s);
      return t.startsWith("intent:") ? t.slice("intent:".length).trim() : t;
    };
    const nReply = norm(reply);
    if (nReply.startsWith("intent:")) return null;
    if (intentHint) {
      const fb = norm(intentHint);
      const fbCore = stripIntent(intentHint);
      if (nReply === fb || nReply === fbCore) return null;
      if (
        fbCore.length >= 24 &&
        nReply.includes(fbCore) &&
        nReply.length <= fbCore.length + 48
      ) {
        return null;
      }
    }
    const nextStep = String(payload.context?.nextStep || "").trim();
    if (nextStep) {
      const ns = norm(nextStep);
      if (nReply === ns || nReply.endsWith(ns)) return null;
      if (ns.length >= 12 && nReply.includes(ns) && nReply.length <= ns.length + 48) {
        return null;
      }
    }
    return reply;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Phrase LLM first; optionally LangGraph /chat. Never returns the intent seed.
 * Guided ticket/team steps should pass `allowAgentsFallback: false` so a bare
 * name/email is never re-interpreted as navigate/filter by the command graph.
 */
export async function llmOnlyReply(
  payload: {
    module: "ticket" | "team" | "greeting" | "nav" | "macro" | "kb" | "priority";
    kind: string;
    userText?: string;
    pageLabel?: string;
    context?: Record<string, string | number | boolean | null | undefined>;
    validationHint?: string;
  },
  intentHint: string,
  agents?: {
    message: string;
    page?: string;
    sessionId?: string;
    history?: CoworkerHistoryItem[];
    draft?: TicketDraftSnapshot | null;
    nextStep?: string | null;
    /** Default true. Set false for guided field answers (name, email, etc.). */
    allowAgentsFallback?: boolean;
  }
): Promise<string | null> {
  const phrased = await llmGuidedReply(payload, intentHint);
  if (phrased) return phrased;
  if (agents?.allowAgentsFallback === false) return null;
  if (!agents?.message) return null;
  const live = await askCoworkerAgents(agents.message, agents.page || payload.pageLabel, {
    sessionId: agents.sessionId,
    history: agents.history,
    draft: agents.draft,
    nextStep: agents.nextStep,
  });
  return live?.reply?.trim() || null;
}

export type TicketReasonResult = {
  intent:
    | "correct_field"
    | "provide_issue"
    | "confirm"
    | "cancel"
    | "ambiguous"
    | "question"
    | "continue";
  field: "email" | "phone" | "name" | "issue" | "contact" | null;
  newValue: string | null;
  reason: string;
  reply: string;
};

/** LLM classifies the guided-ticket turn and returns a dynamic reply. */
export async function llmTicketReason(payload: {
  userText: string;
  stepId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  issue?: string;
  subject?: string;
}): Promise<TicketReasonResult | null> {
  try {
    const res = await fetch("/api/coworker/ticket-reason", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        ...payload,
        fallbackReply: "Continue the ticket.",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.reply || !data?.intent) return null;
    const reply = String(data.reply).trim();
    if (!reply) return null;
    return {
      intent: data.intent,
      field: data.field ?? null,
      newValue: data.newValue ?? null,
      reason: String(data.reason || ""),
      reply,
    };
  } catch {
    return null;
  }
}
