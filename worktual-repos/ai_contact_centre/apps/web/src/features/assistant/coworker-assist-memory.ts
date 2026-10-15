import type { ChatMessage, TextChatMessage } from "@/features/assistant/copilot-engine";

export const INBOX_ASSIST_MESSAGE_PREFIX = "inbox-assist:";
export const WORKSPACE_ASSIST_TURN_RECORDED = "workspace-assist-turn-recorded";

export type InboxAssistTurn = {
  id: string;
  conversationId: string | null;
  suggestionText: string | null;
  copilotResponse: string | null;
  createdAt: string;
  assistState?: Record<string, unknown> | null;
};

export function inboxAssistMessageId(turnId: string): string {
  return `${INBOX_ASSIST_MESSAGE_PREFIX}${turnId}`;
}

export function isInboxAssistMessage(message: ChatMessage): boolean {
  return message.id.startsWith(INBOX_ASSIST_MESSAGE_PREFIX);
}

export function formatInboxAssistMemory(turn: InboxAssistTurn): string {
  const state = turn.assistState ?? {};
  const draft = String(
    (typeof state.replyDraft === "string" && state.replyDraft.trim()) ||
      turn.suggestionText?.trim() ||
      "",
  ).trim();
  return draft;
}

export function inboxAssistTurnToMessage(turn: InboxAssistTurn): TextChatMessage {
  return {
    id: inboxAssistMessageId(turn.id),
    kind: "text",
    role: "assistant",
    content: formatInboxAssistMemory(turn),
    copilotTurnId: /^\d+$/.test(turn.id) ? turn.id : undefined,
    createdAt: turn.createdAt,
  };
}

export function mergeInboxAssistTurns(
  messages: ChatMessage[],
  turns: InboxAssistTurn[],
): ChatMessage[] {
  const source = Array.isArray(messages) ? messages : [];
  const withoutAssist = source.filter((message) => !isInboxAssistMessage(message));
  const assistMessages = turns
    .filter((turn) => formatInboxAssistMemory(turn).trim())
    .slice(-1)
    .map(inboxAssistTurnToMessage);
  if (assistMessages.length === 0) return withoutAssist;

  const welcomeIndex = withoutAssist.findIndex((message) => message.id === "welcome");
  if (welcomeIndex === -1) {
    return [...assistMessages, ...withoutAssist];
  }
  return [
    ...withoutAssist.slice(0, welcomeIndex + 1),
    ...assistMessages,
    ...withoutAssist.slice(welcomeIndex + 1),
  ];
}

export function notifyInboxAssistTurnRecorded(conversationId: string): void {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_ASSIST_TURN_RECORDED, {
      detail: { conversationId },
    }),
  );
}