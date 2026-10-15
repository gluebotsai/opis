import type { ConversationRecord, DispositionRecord, MessageRecord } from "./conversations.js";

const NLP_URL = process.env.NLP_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
const WRAP_UP_FETCH_TIMEOUT_MS = Number(process.env.WRAP_UP_FETCH_TIMEOUT_MS ?? 12_000);

export type AgentSessionTurn = {
  role: "customer" | "agent" | "system";
  text: string;
  at: string;
};

export type WrapUpSuggestion = {
  summary: string;
  resolution: "resolved" | "unresolved" | "transferred";
  dispositionCode: string | null;
};

function stripMessageBody(body: string): string {
  return body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function mapContextMessage(message: MessageRecord) {
  return {
    id: message.id,
    role: message.senderType,
    body: stripMessageBody(message.body),
    sentAt: message.sentAt,
  };
}

function findAgentSessionStart(messages: MessageRecord[]): number | null {
  const firstAgent = messages.find((message) => message.senderType === "agent");
  if (firstAgent) {
    return new Date(firstAgent.sentAt).getTime();
  }
  const handoffSystem = messages.find(
    (message) =>
      message.senderType === "system" &&
      /agent|handoff|connect|live/i.test(stripMessageBody(message.body)),
  );
  return handoffSystem ? new Date(handoffSystem.sentAt).getTime() : null;
}

export function filterAgentSessionMessages(
  messages: MessageRecord[],
  assignedAt: string | null,
): MessageRecord[] {
  const sessionStartMs = assignedAt
    ? new Date(assignedAt).getTime()
    : findAgentSessionStart(messages);

  return messages.filter((message) => {
    if (message.senderType === "bot") return false;
    if (sessionStartMs !== null && new Date(message.sentAt).getTime() < sessionStartMs) {
      return false;
    }
    return (
      message.senderType === "customer" ||
      message.senderType === "agent" ||
      message.senderType === "system"
    );
  });
}

export function buildAgentSessionTranscript(
  messages: MessageRecord[],
  assignedAt: string | null,
): AgentSessionTurn[] {
  return filterAgentSessionMessages(messages, assignedAt)
    .map((message) => {
      const text = stripMessageBody(message.body);
      if (!text) return null;
      const role =
        message.senderType === "customer" ||
        message.senderType === "agent" ||
        message.senderType === "system"
          ? message.senderType
          : null;
      if (!role) return null;
      return {
        role,
        text,
        at: message.sentAt,
      };
    })
    .filter((turn): turn is AgentSessionTurn => turn !== null);
}

function fallbackSummary(transcript: AgentSessionTurn[]): string {
  if (transcript.length === 0) {
    return "Agent session ended with no customer-visible messages recorded.";
  }
  const preview = transcript
    .slice(-4)
    .map((turn) => `${turn.role}: ${turn.text}`)
    .join(" ");
  return preview.slice(0, 500);
}

function normalizeResolution(value: unknown): WrapUpSuggestion["resolution"] {
  if (value === "unresolved" || value === "transferred") return value;
  return "resolved";
}

function pickDispositionCode(
  value: unknown,
  dispositions: DispositionRecord[],
): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().toLowerCase();
  const match = dispositions.find(
    (disposition) =>
      disposition.code.toLowerCase() === normalized ||
      disposition.label.toLowerCase() === normalized,
  );
  return match?.code ?? null;
}

export async function suggestWrapUpFromNlp(input: {
  organizationId: string;
  conversation: ConversationRecord;
  transcript: AgentSessionTurn[];
  dispositions: DispositionRecord[];
}): Promise<WrapUpSuggestion> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-tenant-id": input.organizationId,
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }

  try {
    const response = await fetch(`${NLP_URL}/api/v1/workspace/wrap-up/suggest`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        organization_id: input.organizationId,
        conversation_id: input.conversation.id,
        channel: input.conversation.channel,
        subject: input.conversation.subject,
        transcript: input.transcript,
        dispositions: input.dispositions.map((disposition) => ({
          code: disposition.code,
          label: disposition.label,
          description: disposition.description,
        })),
      }),
      signal: AbortSignal.timeout(WRAP_UP_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Wrap-up suggest failed (${response.status})`);
    }
    const body = (await response.json()) as {
      summary?: string;
      resolution?: string;
      disposition_code?: string | null;
    };
    const summary = body.summary?.trim() || fallbackSummary(input.transcript);
    const dispositionCode = pickDispositionCode(body.disposition_code, input.dispositions);
    return {
      summary: summary.slice(0, 2000),
      resolution: normalizeResolution(body.resolution),
      dispositionCode,
    };
  } catch {
    return {
      summary: fallbackSummary(input.transcript),
      resolution: "resolved",
      dispositionCode: input.dispositions[0]?.code ?? null,
    };
  }
}
