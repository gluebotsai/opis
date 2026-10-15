import type { Server as SocketIOServer } from "socket.io";

import {
  conversationRoom,
  internalChatRoom,
  organizationRoom,
  userRoom,
} from "../lib/socket-rooms.js";
import type {
  ConversationRecord,
  ConversationTransferRecord,
  DispositionRecord,
  MessageReceiptRecord,
  MessageRecord,
} from "./conversations.js";
import type { AgentPresenceRecord } from "./presence.js";
import type { ContactEnrichmentResult } from "./contact-identity.js";

let ioRef: SocketIOServer | null = null;

export function setRealtimeServer(io: SocketIOServer): void {
  ioRef = io;
}

export function orgRoom(organizationId: string): string {
  return organizationRoom(organizationId);
}

export function agentRoom(organizationId: string, userId: string): string {
  return userRoom(organizationId, userId);
}

export { conversationRoom };

export function emitConversationCreated(
  organizationId: string,
  conversation: ConversationRecord,
): void {
  ioRef?.to(orgRoom(organizationId)).emit("conversation.created", { conversation });
}

export function emitVoiceCallOpened(
  organizationId: string,
  userId: string,
  conversation: ConversationRecord,
  sessionId: string,
  options?: { consultAnswered?: boolean },
): void {
  ioRef?.to(agentRoom(organizationId, userId)).emit("voice.call.opened", {
    conversation,
    sessionId,
    consultAnswered: options?.consultAnswered ?? false,
  });
}

export function emitVoiceConsultUpdated(
  organizationId: string,
  userId: string,
  payload: {
    conversationId: string;
    sessionId: string;
    action: number;
    merged?: boolean;
  },
): void {
  ioRef?.to(agentRoom(organizationId, userId)).emit("voice.consult.updated", payload);
}

export function emitMessageCreated(
  organizationId: string,
  conversationId: string,
  message: MessageRecord,
): void {
  ioRef?.to(orgRoom(organizationId)).emit("message.created", { conversationId, message });
}

export function emitContactEnriched(
  organizationId: string,
  conversationId: string,
  result: ContactEnrichmentResult,
): void {
  ioRef
    ?.to(orgRoom(organizationId))
    .emit("contact.enriched", buildContactEnrichedPayload(organizationId, conversationId, result));
}

export function buildContactEnrichedPayload(
  organizationId: string,
  conversationId: string,
  result: ContactEnrichmentResult,
): {
  tenantId: string;
  organizationId: string;
  conversationId: string;
  outcome: ContactEnrichmentResult["outcome"];
  canonicalContactId: string;
  previousContactId: string | null;
  appliedFields: ContactEnrichmentResult["appliedFields"];
  skippedFields: ContactEnrichmentResult["skippedFields"];
  requiresConfirmation: ContactEnrichmentResult["requiresConfirmation"];
  contact: ContactEnrichmentResult["contact"];
} {
  return {
    tenantId: organizationId,
    organizationId,
    conversationId,
    outcome: result.outcome,
    canonicalContactId: result.canonicalContactId,
    previousContactId: result.previousContactId,
    appliedFields: result.appliedFields,
    skippedFields: result.skippedFields,
    requiresConfirmation: result.requiresConfirmation,
    contact: result.contact,
  };
}

export function emitMessageReceiptUpdated(
  organizationId: string,
  conversationId: string,
  receipt: MessageReceiptRecord,
): void {
  ioRef?.to(orgRoom(organizationId)).emit("message.receipt.updated", {
    conversationId,
    receipt,
  });
}

export function emitTypingUpdated(
  organizationId: string,
  conversationId: string,
  participant: "visitor" | "agent",
  active: boolean,
): void {
  ioRef?.to(orgRoom(organizationId)).emit("conversation.typing", {
    conversationId,
    participant,
    active,
  });
}

/**
 * Org-wide monitoring signal. Agent-facing offer/accept/reject events are
 * agent-room-only, so supervisors need this to refresh live monitoring.
 */
export function emitMonitoringUpdated(organizationId: string, kind: string): void {
  ioRef?.to(orgRoom(organizationId)).emit("monitoring.updated", { kind });
}

export function emitConversationAssigned(
  organizationId: string,
  conversation: ConversationRecord,
  userId: string,
): void {
  ioRef
    ?.to(agentRoom(organizationId, userId))
    .emit("conversation.assigned", { conversation });
  emitMonitoringUpdated(organizationId, "conversation.assigned");
}

export function emitConversationOffer(
  organizationId: string,
  conversation: ConversationRecord,
  userId: string,
): void {
  ioRef?.to(agentRoom(organizationId, userId)).emit("conversation.offer", { conversation });
  emitMonitoringUpdated(organizationId, "conversation.offer");
}

/** Email routes directly to active; chat/whatsapp still use offer/ringing. */
export function emitConversationRouted(
  organizationId: string,
  conversation: ConversationRecord,
  userId: string,
): void {
  if (conversation.channel === "email" && conversation.status === "active") {
    emitConversationAccepted(organizationId, conversation, userId);
    return;
  }
  // The agent browser rings only when pendingOffer is set. Webchat, WhatsApp,
  // Instagram, and Facebook all arrive here without that flag.
  emitConversationOffer(organizationId, { ...conversation, pendingOffer: true }, userId);
}

export function shouldScheduleOfferExpiration(conversation: ConversationRecord): boolean {
  return !(conversation.channel === "email" && conversation.status === "active");
}

export function emitConversationAccepted(
  organizationId: string,
  conversation: ConversationRecord,
  userId: string,
): void {
  ioRef
    ?.to(agentRoom(organizationId, userId))
    .emit("conversation.accepted", { conversation });
  emitMonitoringUpdated(organizationId, "conversation.accepted");
}

export function emitConversationRejected(
  organizationId: string,
  conversation: ConversationRecord,
  userId: string,
): void {
  ioRef
    ?.to(agentRoom(organizationId, userId))
    .emit("conversation.rejected", { conversation });
  emitMonitoringUpdated(organizationId, "conversation.rejected");
}

export function emitConversationQueued(
  organizationId: string,
  conversation: ConversationRecord,
): void {
  ioRef?.to(orgRoom(organizationId)).emit("conversation.queued", { conversation });
}

export function emitConversationResolved(
  organizationId: string,
  conversation: ConversationRecord,
  userId: string,
): void {
  ioRef?.to(agentRoom(organizationId, userId)).emit("conversation.resolved", { conversation });
  emitMonitoringUpdated(organizationId, "conversation.resolved");
}

export function emitConversationTransferred(
  organizationId: string,
  conversation: ConversationRecord,
  transfer: ConversationTransferRecord,
): void {
  ioRef?.to(orgRoom(organizationId)).emit("conversation.transferred", {
    conversation,
    transfer,
  });
}

export function emitConversationTransferAccepted(
  organizationId: string,
  conversation: ConversationRecord,
  fromUserId: string,
): void {
  ioRef
    ?.to(agentRoom(organizationId, fromUserId))
    .emit("conversation.transfer.accepted", { conversation });
}

function emitTransferLifecycle(
  organizationId: string,
  event:
    | "conversation.transfer.offered"
    | "conversation.transfer.accepted"
    | "conversation.transfer.rejected"
    | "conversation.transfer.expired"
    | "conversation.transfer.cancelled"
    | "conversation.transfer.completed",
  transfer: ConversationTransferRecord,
  userIds: Array<string | null | undefined>,
  conversation?: ConversationRecord,
): void {
  const payload = { conversationId: transfer.conversationId, transfer, conversation };
  for (const userId of new Set(userIds.filter((value): value is string => Boolean(value)))) {
    ioRef?.to(agentRoom(organizationId, userId)).emit(event, payload);
  }
  emitMonitoringUpdated(organizationId, event);
}

export const emitTransferOffered = (
  organizationId: string,
  transfer: ConversationTransferRecord,
  targetUserId: string,
  conversation: ConversationRecord,
): void => emitTransferLifecycle(organizationId, "conversation.transfer.offered", transfer, [transfer.fromUserId, targetUserId], conversation);

export const emitTransferAccepted = (
  organizationId: string,
  transfer: ConversationTransferRecord,
  conversation: ConversationRecord,
): void => emitTransferLifecycle(organizationId, "conversation.transfer.accepted", transfer, [transfer.fromUserId, transfer.acceptedUserId], conversation);

export const emitTransferRejected = (
  organizationId: string,
  transfer: ConversationTransferRecord,
  targetUserId: string,
  conversation: ConversationRecord,
): void => emitTransferLifecycle(organizationId, "conversation.transfer.rejected", transfer, [transfer.fromUserId, targetUserId], conversation);

export const emitTransferExpired = (
  organizationId: string,
  transfer: ConversationTransferRecord,
  targetUserId: string | null,
  conversation: ConversationRecord,
): void => emitTransferLifecycle(organizationId, "conversation.transfer.expired", transfer, [transfer.fromUserId, targetUserId], conversation);

export const emitTransferCancelled = (
  organizationId: string,
  transfer: ConversationTransferRecord,
  targetUserId: string | null,
  conversation: ConversationRecord,
): void => emitTransferLifecycle(organizationId, "conversation.transfer.cancelled", transfer, [transfer.fromUserId, targetUserId], conversation);

export const emitTransferCompleted = (
  organizationId: string,
  transfer: ConversationTransferRecord,
): void => emitTransferLifecycle(organizationId, "conversation.transfer.completed", transfer, [transfer.fromUserId, transfer.acceptedUserId]);

export function emitConversationDispositionSaved(
  organizationId: string,
  conversationId: string,
  disposition: {
    id: string;
    disposition: DispositionRecord;
    note: string | null;
    isFinal: boolean;
    appliedAt: string;
  },
): void {
  ioRef?.to(orgRoom(organizationId)).emit("conversation.disposition.saved", {
    conversationId,
    disposition,
  });
}

export function emitConversationEnded(
  organizationId: string,
  conversation: ConversationRecord,
): void {
  ioRef?.to(orgRoom(organizationId)).emit("conversation.ended", { conversation });
}

export function emitConversationReopened(
  organizationId: string,
  conversation: ConversationRecord,
): void {
  ioRef?.to(orgRoom(organizationId)).emit("conversation.reopened", { conversation });
}

export type ConversationSentimentPayload = {
  customer: {
    label: string;
    score: number;
    confidence?: number;
    rationale?: string;
  };
  agent: {
    label: string;
    score: number;
    confidence?: number;
    rationale?: string;
  };
  updatedAt: string;
  messageId?: string;
};

export function emitConversationSentimentUpdated(
  organizationId: string,
  conversationId: string,
  sentiment: ConversationSentimentPayload,
): void {
  ioRef?.to(orgRoom(organizationId)).emit("conversation.sentiment.updated", {
    conversationId,
    sentiment,
  });
}

export function emitPresenceUpdated(
  organizationId: string,
  presence: AgentPresenceRecord,
  userId: string,
): void {
  ioRef?.to(orgRoom(organizationId)).emit("presence.updated", { presence, userId });
}

export function emitPresenceUpdatedForAgent(
  organizationId: string,
  userId: string,
  presence: AgentPresenceRecord,
): void {
  ioRef?.to(agentRoom(organizationId, userId)).emit("presence.updated", { presence, userId });
  emitMonitoringUpdated(organizationId, "presence.updated");
}

export function emitMissedContactCreated(
  organizationId: string,
  userId: string,
  payload: {
    item: {
      id: string;
      conversationId: string;
      channel: string;
      reason: string;
      customerName: string;
      missedAt: string;
    };
    unreadCount: number;
  },
): void {
  ioRef?.to(agentRoom(organizationId, userId)).emit("missed_contact.created", payload);
}

export { internalChatRoom };

export function emitInternalChatMessageCreated(
  organizationId: string,
  roomId: string,
  message: Record<string, unknown>,
): void {
  ioRef
    ?.to(internalChatRoom(organizationId, roomId))
    .emit("internal_chat.message.created", { roomId, message });
  ioRef?.to(orgRoom(organizationId)).emit("internal_chat.message.created", { roomId, message });
}

export function emitInternalChatRoomRead(
  organizationId: string,
  userId: string,
  roomId: string,
  lastReadAt: string,
): void {
  ioRef?.to(agentRoom(organizationId, userId)).emit("internal_chat.room.read", {
    roomId,
    lastReadAt,
  });
}

export function emitInternalChatRoomUpdated(
  organizationId: string,
  roomIds: string[],
  patch: Record<string, unknown>,
): void {
  for (const roomId of roomIds) {
    ioRef
      ?.to(internalChatRoom(organizationId, roomId))
      .emit("internal_chat.room.updated", { roomId, patch });
  }
  ioRef?.to(orgRoom(organizationId)).emit("internal_chat.room.updated", { roomIds, patch });
}
