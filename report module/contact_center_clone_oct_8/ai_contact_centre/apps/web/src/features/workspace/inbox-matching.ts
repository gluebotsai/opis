import type {
  WorkspaceConversation,
  WorkspaceInboxTab,
  WorkspaceTransferMetadata,
} from "./types";

export type TransferOfferFlags = {
  offerPending: boolean;
  transferred: boolean | undefined;
};

/** Pure helper: a ringing offer for the current agent is not a completed transfer. */
export function resolveTransferOfferFlags(input: {
  status: string;
  assignedUserId?: string | null;
  currentUserId?: string | null;
  pendingOffer?: boolean | null;
  transferredHint: boolean;
  transfer?: WorkspaceTransferMetadata | null;
}): TransferOfferFlags {
  const offerPending = Boolean(input.pendingOffer);
  const isSource = isTransferSource(input.transfer, input.currentUserId);
  const completedForSource = isSource && isTransferCompleted(input.transfer);
  const legacyTransferred =
    !input.transfer?.state && !input.transfer?.fromUserId && input.transferredHint;
  return {
    offerPending: Boolean(offerPending),
    transferred:
      offerPending || !completedForSource && !legacyTransferred
        ? undefined
        : true,
  };
}

const PENDING_TRANSFER_STATES = new Set(["requested", "offered", "queued"]);
const RESTORED_TRANSFER_STATES = new Set(["rejected", "expired", "cancelled"]);

export function isTransferSource(
  transfer: WorkspaceTransferMetadata | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  return Boolean(currentUserId && transfer?.fromUserId === currentUserId);
}

export function isTransferPending(transfer: WorkspaceTransferMetadata | null | undefined): boolean {
  return Boolean(transfer?.state && PENDING_TRANSFER_STATES.has(transfer.state));
}

export function isTransferAccepted(
  transfer: WorkspaceTransferMetadata | null | undefined,
): boolean {
  return transfer?.state === "accepted" && !transfer.completedAt;
}

export function isTransferCompleted(
  transfer: WorkspaceTransferMetadata | null | undefined,
): boolean {
  return transfer?.state === "completed" || Boolean(transfer?.completedAt);
}

export function isTransferRestored(
  transfer: WorkspaceTransferMetadata | null | undefined,
): boolean {
  return Boolean(transfer?.state && RESTORED_TRANSFER_STATES.has(transfer.state));
}

export function isOutboundTransferBlocking(
  conversation: WorkspaceConversation,
  currentUserId: string | null | undefined,
): boolean {
  return (
    isTransferSource(conversation.transfer, currentUserId) &&
    (isTransferPending(conversation.transfer) || isTransferAccepted(conversation.transfer))
  );
}

function isAssignedToMe(
  conversation: WorkspaceConversation,
  currentUserId: string | null | undefined,
): boolean {
  return Boolean(currentUserId && conversation.assignedUserId === currentUserId);
}

/**
 * Inbox tab rules for workspace conversations.
 * Transfer offers that are still ringing for the current agent stay in Open
 * even when transferredAt is set on the conversation record.
 */
export function matchesInboxTab(
  conversation: WorkspaceConversation,
  tab: WorkspaceInboxTab,
  currentUserId: string | null | undefined,
): boolean {
  const assignedToMe = isAssignedToMe(conversation, currentUserId);
  const isSource = isTransferSource(conversation.transfer, currentUserId);
  const outboundPending = isSource && isTransferPending(conversation.transfer);
  const outboundAccepted = isSource && isTransferAccepted(conversation.transfer);
  const completedForSource = isSource && isTransferCompleted(conversation.transfer);
  switch (tab) {
    case "open":
      if (outboundPending || outboundAccepted) return true;
      if (
        conversation.consultParticipant &&
        (conversation.status === "waiting" || conversation.status === "active")
      ) {
        return true;
      }
      if (
        conversation.offerPending &&
        assignedToMe &&
        (conversation.status === "waiting" || conversation.status === "active")
      ) {
        return true;
      }
      return (
        !conversation.transferred &&
        assignedToMe &&
        (conversation.status === "active" ||
          (conversation.status === "waiting" && Boolean(conversation.offerPending)))
      );
    case "transferred":
      return (
        !conversation.offerPending &&
        (completedForSource ||
          (Boolean(conversation.transferred) && !conversation.transfer?.fromUserId))
      );
    case "closed":
      return !conversation.transferred && conversation.status === "resolved" && assignedToMe;
  }
}

export function resolveTabForConversation(conversation: WorkspaceConversation): WorkspaceInboxTab {
  if (conversation.transferred) return "transferred";
  if (conversation.status === "resolved") return "closed";
  return "open";
}

export function resolveInitialInboxTab(
  conversations: WorkspaceConversation[],
  options: {
    userSetTab: boolean;
    persistedTab: WorkspaceInboxTab | null;
    persistedSelectionId: string | null;
    requestedConversationId?: string | null;
    currentUserId?: string | null;
  },
): WorkspaceInboxTab {
  if (options.requestedConversationId) {
    const requested = conversations.find(
      (conversation) => conversation.id === options.requestedConversationId,
    );
    if (requested) return resolveTabForConversation(requested);
    return "open";
  }

  const hasOngoing = conversations.some((item) =>
    matchesInboxTab(item, "open", options.currentUserId),
  );

  if (options.persistedSelectionId) {
    const selected = conversations.find(
      (conversation) => conversation.id === options.persistedSelectionId,
    );
    if (selected) {
      return resolveTabForConversation(selected);
    }
  }

  if (hasOngoing) {
    if (options.userSetTab && options.persistedTab) {
      return options.persistedTab;
    }
    return "open";
  }

  if (options.userSetTab && options.persistedTab && options.persistedTab !== "open") {
    return options.persistedTab;
  }

  return "closed";
}
