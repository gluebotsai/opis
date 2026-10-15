import { appendMessage, recordNlpTurn } from "./cc-core-client.js";

/** Placeholder customer turn for Hub-initiated proactive bot lines (no visitor message yet). */
export const PROACTIVE_ENGAGEMENT_CUSTOMER_TEXT = "[hub_proactive]";

type PersistDeps = {
  appendMessage: typeof appendMessage;
  recordNlpTurn: typeof recordNlpTurn;
};

const defaultDeps: PersistDeps = { appendMessage, recordNlpTurn };

/** Persist Hub proactive copy to durable transcript + NLP turn history. */
export async function persistProactiveBotMessage(
  organizationId: string,
  conversationId: string,
  text: string,
  options?: { reason?: string; deps?: PersistDeps },
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const deps = options?.deps ?? defaultDeps;
  const botMessage = await deps.appendMessage(organizationId, conversationId, {
    senderType: "bot",
    body: trimmed,
    direction: "outbound",
    modelMetadata: {
      source: "hub_proactive",
      ...(options?.reason ? { reason: options.reason } : {}),
    },
  });
  if (!botMessage) return false;

  const recorded = await deps.recordNlpTurn(organizationId, conversationId, {
    customerText: PROACTIVE_ENGAGEMENT_CUSTOMER_TEXT,
    botReply: trimmed,
    botMessageId: botMessage.id,
    runtimeType: "webchat_bot",
    summary: options?.reason ? `Hub proactive: ${options.reason}` : "Hub proactive engagement",
  });
  return recorded;
}
