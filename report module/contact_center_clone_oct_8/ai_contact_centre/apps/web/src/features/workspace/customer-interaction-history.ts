import type { CustomerInteractionHistory, WorkspaceConversation } from "./types";

function anchorMessage(conversation: WorkspaceConversation) {
  return (
    conversation.messages.find((message) => message.role === "customer") ??
    conversation.messages.find((message) => message.role !== "system") ??
    conversation.messages[0]
  );
}

export function getCustomerInteractionHistory(
  customerId: string,
  conversations: WorkspaceConversation[],
): CustomerInteractionHistory[] {
  return conversations
    .filter((conversation) => conversation.customer.id === customerId)
    .map((conversation) => {
      const message = anchorMessage(conversation);
      if (!message) return null;

      return {
        id: `hist-${conversation.id}`,
        conversationId: conversation.id,
        messageId: message.id,
        channel: conversation.channel,
        queue: conversation.queue,
        subject: conversation.subject,
        summary: conversation.preview,
        occurredAt: conversation.updatedAt,
      } satisfies CustomerInteractionHistory;
    })
    .filter((entry): entry is CustomerInteractionHistory => entry !== null)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}
