import { useEffect, useRef } from "react";

import { readAuthFromStorage } from "@/services/http";
import { getOrCreateWorkspaceSocket } from "./workspace-socket-client";

import type {
  ContactEnrichmentOutcome,
  ConversationSentiment,
  WorkspaceConversation,
  WorkspaceTransferMetadata,
} from "./types";
import {
  mapApiConversation,
  type ApiContact,
  type ApiConversation,
  type ApiMessage,
  type PresenceState,
} from "./api";

export type ContactEnrichedPayload = {
  organizationId: string;
  conversationId: string;
  outcome: ContactEnrichmentOutcome;
  contact: ApiContact;
  canonicalContactId: string;
  previousContactId: string | null;
  appliedFields: Array<"email" | "phone" | "displayName" | "company" | "city" | "country">;
};

export type WorkspaceTransferEvent = {
  conversationId: string;
  transfer: WorkspaceTransferMetadata;
  conversation?: WorkspaceConversation;
};

type WorkspaceSocketHandlers = {
  onConversationCreated?: (conversation: WorkspaceConversation) => void;
  onMessageCreated?: (conversationId: string, message: ApiMessage) => void;
  onMessageReceiptUpdated?: (
    conversationId: string,
    receipt: { messageId: string; status: "sent" | "delivered" | "read" },
  ) => void;
  onTypingUpdated?: (
    conversationId: string,
    participant: "visitor" | "agent",
    active: boolean,
  ) => void;
  onConversationAssigned?: (conversation: WorkspaceConversation) => void;
  onConversationOffer?: (conversation: WorkspaceConversation) => void;
  onConversationAccepted?: (conversation: WorkspaceConversation) => void;
  onConversationRejected?: (conversation: WorkspaceConversation) => void;
  onConversationQueued?: (conversation: WorkspaceConversation) => void;
  onConversationResolved?: (conversation: WorkspaceConversation) => void;
  onConversationTransferred?: (conversation: WorkspaceConversation) => void;
  onConversationTransferOffered?: (event: WorkspaceTransferEvent) => void;
  onConversationTransferAccepted?: (event: WorkspaceTransferEvent) => void;
  onConversationTransferRejected?: (event: WorkspaceTransferEvent) => void;
  onConversationTransferExpired?: (event: WorkspaceTransferEvent) => void;
  onConversationTransferCancelled?: (event: WorkspaceTransferEvent) => void;
  onConversationTransferCompleted?: (event: WorkspaceTransferEvent) => void;
  onConversationEnded?: (conversation: WorkspaceConversation) => void;
  onConversationReopened?: (conversation: WorkspaceConversation) => void;
  onContactEnriched?: (payload: ContactEnrichedPayload) => void;
  onSentimentUpdated?: (conversationId: string, sentiment: ConversationSentiment) => void;
  onPresenceUpdated?: (state: PresenceState) => void;
  onVoiceCallOpened?: (
    conversation: WorkspaceConversation,
    sessionId: string,
    options?: { consultAnswered?: boolean },
  ) => void;
  onVoiceConsultUpdated?: (event: {
    conversationId: string;
    sessionId: string;
    action: number;
    merged?: boolean;
  }) => void;
  onMissedContactCreated?: (payload: {
    item: {
      id: string;
      conversationId: string;
      channel: string;
      reason: string;
      customerName: string;
      missedAt: string;
    };
    unreadCount: number;
  }) => void;
  onReconnect?: () => void;
};

let latestPresenceVersion = 0;
let latestPresenceState: PresenceState | null = null;

export function useWorkspaceSocket(handlers: WorkspaceSocketHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const auth = readAuthFromStorage();
    const activeSocket = getOrCreateWorkspaceSocket(auth);

    const handleMessageCreated = (payload: {
      conversationId: string;
      message: ApiMessage;
    }) => {
      handlersRef.current.onMessageCreated?.(payload.conversationId, payload.message);
    };

    const handleConversationCreated = (payload: { conversation: ApiConversation }) => {
      if (payload.conversation.status === "bot_active") return;
      handlersRef.current.onConversationCreated?.(mapApiConversation(payload.conversation));
    };
    const handleReceiptUpdated = (payload: {
      conversationId: string;
      receipt: { messageId: string; status: "sent" | "delivered" | "read" };
    }) => {
      handlersRef.current.onMessageReceiptUpdated?.(payload.conversationId, payload.receipt);
    };
    const handleTypingUpdated = (payload: {
      conversationId: string;
      participant: "visitor" | "agent";
      active: boolean;
    }) => {
      handlersRef.current.onTypingUpdated?.(
        payload.conversationId,
        payload.participant,
        payload.active,
      );
    };

    const handleConversationAssigned = (payload: { conversation: ApiConversation }) => {
      handlersRef.current.onConversationAssigned?.(mapApiConversation(payload.conversation));
    };

    const handleConversationOffer = (payload: { conversation: ApiConversation }) => {
      handlersRef.current.onConversationOffer?.(mapApiConversation(payload.conversation));
    };

    const handleConversationAccepted = (payload: { conversation: ApiConversation }) => {
      handlersRef.current.onConversationAccepted?.(mapApiConversation(payload.conversation));
    };
    const handleConversationRejected = (payload: { conversation: ApiConversation }) => {
      handlersRef.current.onConversationRejected?.(mapApiConversation(payload.conversation));
    };
    const handleConversationQueued = (payload: { conversation: ApiConversation }) => {
      handlersRef.current.onConversationQueued?.(mapApiConversation(payload.conversation));
    };
    const handleConversationResolved = (payload: { conversation: ApiConversation }) => {
      handlersRef.current.onConversationResolved?.(mapApiConversation(payload.conversation));
    };
    type TransferEventPayload = {
      conversationId?: string;
      conversation?: ApiConversation;
      transfer?: WorkspaceTransferMetadata;
    };
    const mapTransferEvent = (
      payload: TransferEventPayload,
    ): WorkspaceTransferEvent | null => {
      const transfer = payload.transfer ?? payload.conversation?.transfer;
      if (!transfer) return null;
      return {
        conversationId: payload.conversationId ?? payload.conversation?.id ?? "",
        transfer,
        conversation: payload.conversation
          ? {
              ...mapApiConversation(payload.conversation),
              transfer,
            }
          : undefined,
      };
    };
    const handleConversationTransferred = (payload: TransferEventPayload) => {
      if (!payload.conversation) return;
      handlersRef.current.onConversationTransferred?.({
        ...mapApiConversation(payload.conversation),
        transfer: payload.transfer ?? payload.conversation.transfer ?? null,
      });
    };
    const handleConversationTransferOffered = (payload: TransferEventPayload) => {
      const event = mapTransferEvent(payload);
      if (event) handlersRef.current.onConversationTransferOffered?.(event);
    };
    const handleConversationTransferAccepted = (payload: TransferEventPayload) => {
      const event = mapTransferEvent(payload);
      if (event) handlersRef.current.onConversationTransferAccepted?.(event);
    };
    const handleConversationTransferRejected = (payload: TransferEventPayload) => {
      const event = mapTransferEvent(payload);
      if (event) handlersRef.current.onConversationTransferRejected?.(event);
    };
    const handleConversationTransferExpired = (payload: TransferEventPayload) => {
      const event = mapTransferEvent(payload);
      if (event) handlersRef.current.onConversationTransferExpired?.(event);
    };
    const handleConversationTransferCancelled = (payload: TransferEventPayload) => {
      const event = mapTransferEvent(payload);
      if (event) handlersRef.current.onConversationTransferCancelled?.(event);
    };
    const handleConversationTransferCompleted = (payload: TransferEventPayload) => {
      const event = mapTransferEvent(payload);
      if (event) handlersRef.current.onConversationTransferCompleted?.(event);
    };
    const handleConversationEnded = (payload: { conversation: ApiConversation }) => {
      handlersRef.current.onConversationEnded?.(mapApiConversation(payload.conversation));
    };
    const handleConversationReopened = (payload: { conversation: ApiConversation }) => {
      handlersRef.current.onConversationReopened?.(mapApiConversation(payload.conversation));
    };
    const handleContactEnriched = (payload: ContactEnrichedPayload) => {
      handlersRef.current.onContactEnriched?.(payload);
    };
    const handleSentimentUpdated = (payload: {
      conversationId: string;
      sentiment: ConversationSentiment;
    }) => {
      handlersRef.current.onSentimentUpdated?.(payload.conversationId, payload.sentiment);
    };
    const handlePresenceUpdated = (payload: {
      presence: { state: PresenceState; version?: number };
      userId: string;
    }) => {
      const auth = readAuthFromStorage();
      if (auth.userId && payload.userId === auth.userId) {
        const version = payload.presence.version ?? 0;
        const state = payload.presence.state;
        if (state === latestPresenceState) {
          if (version > latestPresenceVersion) latestPresenceVersion = version;
          return;
        }
        if (version > 0 && version < latestPresenceVersion) return;
        const notify = handlersRef.current.onPresenceUpdated;
        if (!notify) return;
        if (version > 0) latestPresenceVersion = version;
        latestPresenceState = state;
        console.info("[presence] ACD returned", { state, version });
        notify(state);
      }
    };
    const handleVoiceConsultUpdated = (payload: {
      conversationId: string;
      sessionId: string;
      action: number;
      merged?: boolean;
    }) => {
      handlersRef.current.onVoiceConsultUpdated?.(payload);
    };
    const handleVoiceCallOpened = (payload: {
      conversation: ApiConversation;
      sessionId: string;
      consultAnswered?: boolean;
    }) => {
      console.log("[voice] socket voice.call.opened", {
        sessionId: payload.sessionId,
        conversationId: payload.conversation?.id,
        channel: payload.conversation?.channel,
      });
      handlersRef.current.onVoiceCallOpened?.(
        mapApiConversation(payload.conversation),
        payload.sessionId,
        { consultAnswered: payload.consultAnswered },
      );
    };
    const handleMissedContactCreated = (payload: {
      item: {
        id: string;
        conversationId: string;
        channel: string;
        reason: string;
        customerName: string;
        missedAt: string;
      };
      unreadCount: number;
    }) => {
      handlersRef.current.onMissedContactCreated?.(payload);
    };
    let connectedOnce = activeSocket.connected;
    const handleConnect = () => {
      if (connectedOnce) handlersRef.current.onReconnect?.();
      connectedOnce = true;
    };

    activeSocket.on("message.created", handleMessageCreated);
    activeSocket.on("message.receipt.updated", handleReceiptUpdated);
    activeSocket.on("conversation.typing", handleTypingUpdated);
    activeSocket.on("conversation.created", handleConversationCreated);
    activeSocket.on("conversation.assigned", handleConversationAssigned);
    activeSocket.on("conversation.offer", handleConversationOffer);
    activeSocket.on("conversation.accepted", handleConversationAccepted);
    activeSocket.on("conversation.rejected", handleConversationRejected);
    activeSocket.on("conversation.queued", handleConversationQueued);
    activeSocket.on("conversation.resolved", handleConversationResolved);
    activeSocket.on("conversation.transferred", handleConversationTransferred);
    activeSocket.on("conversation.transfer.offered", handleConversationTransferOffered);
    activeSocket.on("conversation.transfer.accepted", handleConversationTransferAccepted);
    activeSocket.on("conversation.transfer.rejected", handleConversationTransferRejected);
    activeSocket.on("conversation.transfer.expired", handleConversationTransferExpired);
    activeSocket.on("conversation.transfer.cancelled", handleConversationTransferCancelled);
    activeSocket.on("conversation.transfer.completed", handleConversationTransferCompleted);
    activeSocket.on("transfer.offered", handleConversationTransferOffered);
    activeSocket.on("transfer.accepted", handleConversationTransferAccepted);
    activeSocket.on("transfer.rejected", handleConversationTransferRejected);
    activeSocket.on("transfer.expired", handleConversationTransferExpired);
    activeSocket.on("transfer.cancelled", handleConversationTransferCancelled);
    activeSocket.on("transfer.completed", handleConversationTransferCompleted);
    activeSocket.on("conversation.ended", handleConversationEnded);
    activeSocket.on("conversation.reopened", handleConversationReopened);
    activeSocket.on("contact.enriched", handleContactEnriched);
    activeSocket.on("conversation.sentiment.updated", handleSentimentUpdated);
    activeSocket.on("presence.updated", handlePresenceUpdated);
    activeSocket.on("voice.call.opened", handleVoiceCallOpened);
    activeSocket.on("voice.consult.updated", handleVoiceConsultUpdated);
    activeSocket.on("missed_contact.created", handleMissedContactCreated);
    activeSocket.on("connect", handleConnect);

    return () => {
      activeSocket.off("message.created", handleMessageCreated);
      activeSocket.off("message.receipt.updated", handleReceiptUpdated);
      activeSocket.off("conversation.typing", handleTypingUpdated);
      activeSocket.off("conversation.created", handleConversationCreated);
      activeSocket.off("conversation.assigned", handleConversationAssigned);
      activeSocket.off("conversation.offer", handleConversationOffer);
      activeSocket.off("conversation.accepted", handleConversationAccepted);
      activeSocket.off("conversation.rejected", handleConversationRejected);
      activeSocket.off("conversation.queued", handleConversationQueued);
      activeSocket.off("conversation.resolved", handleConversationResolved);
      activeSocket.off("conversation.transferred", handleConversationTransferred);
      activeSocket.off("conversation.transfer.offered", handleConversationTransferOffered);
      activeSocket.off("conversation.transfer.accepted", handleConversationTransferAccepted);
      activeSocket.off("conversation.transfer.rejected", handleConversationTransferRejected);
      activeSocket.off("conversation.transfer.expired", handleConversationTransferExpired);
      activeSocket.off("conversation.transfer.cancelled", handleConversationTransferCancelled);
      activeSocket.off("conversation.transfer.completed", handleConversationTransferCompleted);
      activeSocket.off("transfer.offered", handleConversationTransferOffered);
      activeSocket.off("transfer.accepted", handleConversationTransferAccepted);
      activeSocket.off("transfer.rejected", handleConversationTransferRejected);
      activeSocket.off("transfer.expired", handleConversationTransferExpired);
      activeSocket.off("transfer.cancelled", handleConversationTransferCancelled);
      activeSocket.off("transfer.completed", handleConversationTransferCompleted);
      activeSocket.off("conversation.ended", handleConversationEnded);
      activeSocket.off("conversation.reopened", handleConversationReopened);
      activeSocket.off("contact.enriched", handleContactEnriched);
      activeSocket.off("conversation.sentiment.updated", handleSentimentUpdated);
      activeSocket.off("presence.updated", handlePresenceUpdated);
      activeSocket.off("voice.call.opened", handleVoiceCallOpened);
      activeSocket.off("voice.consult.updated", handleVoiceConsultUpdated);
      activeSocket.off("missed_contact.created", handleMissedContactCreated);
      activeSocket.off("connect", handleConnect);
    };
  }, []);
}
