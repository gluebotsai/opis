import type { WorkspaceMessage } from "@/features/workspace/types";

function hadBotPhaseBefore(messages: WorkspaceMessage[], index: number): boolean {
  return messages
    .slice(0, index)
    .some((message) => message.role === "bot" || message.transcriptPhase === "bot");
}

/**
 * The first line after the voice bot hands the call to a person.
 * is_bot / bot_type mark a later customer line when the stream sends them.
 * An agent line still starts the live section when those flags are missing.
 * On a voice call, assignedAt covers the same gap if the agent has not spoken.
 */
export function findLiveAgentHandoffMessageId(
  messages: WorkspaceMessage[],
  assignedAt?: string | null,
): string | null {
  const flaggedIndex = messages.findIndex(
    (message, index) =>
      message.transcriptPhase === "live_agent" && hadBotPhaseBefore(messages, index),
  );
  if (flaggedIndex !== -1) return messages[flaggedIndex]!.id;

  const firstAgentIndex = messages.findIndex((message) => message.role === "agent");
  if (firstAgentIndex !== -1 && hadBotPhaseBefore(messages, firstAgentIndex)) {
    return messages[firstAgentIndex]!.id;
  }

  const connectedAt = assignedAt ? Date.parse(assignedAt) : Number.NaN;
  if (Number.isFinite(connectedAt)) {
    const afterConnect = messages.findIndex((message, index) => {
      if (message.role === "bot" || message.transcriptPhase === "bot") return false;
      const sentAt = Date.parse(message.sentAt);
      return Number.isFinite(sentAt) && sentAt >= connectedAt && hadBotPhaseBefore(messages, index);
    });
    if (afterConnect !== -1) return messages[afterConnect]!.id;
  }

  return null;
}
