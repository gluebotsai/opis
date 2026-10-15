import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { env } from "@/config/env";
import { useSearchParams } from "react-router";

import {
  mergeWorkspaceCustomerFromContact,
  mergeWorkspaceConversationUpdate,
  workspaceApi,
  plainTextMessageBody,
  WORKSPACE_PRESENCE_UPDATED,
  WORKSPACE_VOICE_OPENED,
  type ApiMessage,
  type PresenceState,
} from "./api";
import { notifyPresenceUpdated } from "./presence-session";
import {
  isWorkspaceTabUserSet,
  persistWorkspaceSelection,
  persistWorkspaceTab,
  readPersistedWorkspaceSelection,
  readPersistedWorkspaceTab,
} from "./workspace-session";
import {
  compareInboxActivityDesc,
  insertMessageBySentAt,
  isEmailChannel,
  isVoiceChannel,
  shouldOpenWebchatCustomerDisposition,
  truncatePreview,
} from "./workspace-utils";
import { placeLoadedConversation } from "./conversation-load";
import { extractCustomerFacingSuggestion } from "./suggestion-text";
import {
  ASSISTANT_WORKSPACE_CONTACT_UPDATED,
  ASSISTANT_WORKSPACE_OPEN_CONVERSATION,
  confirmBooxooTicket,
  dispatchCoworkerRequest,
  recordCopilotTurn,
  streamCopilotMessage,
} from "@/features/assistant/assistant-api";
import { contactsApi } from "@/features/contacts/api";
import { notifyInboxAssistTurnRecorded } from "@/features/assistant/coworker-assist-memory";
import { newId } from "@/lib/new-id";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import {
  fetchConversationMessagesPage,
  MESSAGE_PAGE_SIZE_EXPORT,
  resetMessagePage,
  setConversationLoadingId,
  setInboxLoading,
} from "@/store/slices/workspace-slice";
import type {
  ConversationSentiment,
  WorkspaceAiSuggestion,
  WorkspaceConversation,
  WorkspaceDispositionOption,
  WorkspaceInboxTab,
  WorkspaceMessage,
} from "./types";
import {
  useWorkspaceSocket,
  type ContactEnrichedPayload,
  type WorkspaceTransferEvent,
} from "./use-workspace-socket";
import { queuesApi } from "@/features/workforce/queues/api";
import type { Queue } from "@/features/workforce/queues/types";
import type {
  WorkspaceDisposition,
  WorkspaceTransferAgent,
  WorkspaceTransferInput,
} from "./types";
import { readAuthFromStorage } from "@/services/http";
import {
  isOutboundTransferBlocking,
  isTransferAccepted,
  isTransferPending,
  isTransferSource,
  matchesInboxTab,
  resolveInitialInboxTab,
  resolveTabForConversation,
} from "./inbox-matching";
import { TRANSFER_ACTION_TRANSFEROR_CANCEL } from "@/features/voice/sip-transfer";
import {
  completeSipCallDisposition,
  getSipCallStatus,
  holdCustomerForConsult,
  inviteConsultTransfer,
  publishVoiceWrapUpReady,
} from "@/features/voice/sip-ua";
import { useSipCallStatus } from "@/features/voice/use-sip-call-status";

function matchesTab(conversation: WorkspaceConversation, tab: WorkspaceInboxTab) {
  return matchesInboxTab(conversation, tab, readAuthFromStorage().userId);
}

function mapMessageFromApi(message: ApiMessage): WorkspaceMessage {
  const role =
    message.senderType === "customer"
      ? "customer"
      : message.senderType === "agent"
        ? "agent"
        : message.senderType === "bot"
          ? "bot"
        : "system";
  return {
    id: message.id,
    role,
    content: message.body,
    sentAt: message.createdAt,
    deliveryState:
      message.deliveryState === "pending" ||
      message.deliveryState === "sent" ||
      message.deliveryState === "read" ||
      message.deliveryState === "failed"
        ? message.deliveryState
        : "delivered",
    attachments: message.attachments,
    senderUserId: message.senderUserId ?? null,
    senderName: message.senderName ?? null,
    transcriptPhase: message.transcriptPhase ?? null,
  };
}

function appendUniqueMessage(
  messages: WorkspaceMessage[],
  message: WorkspaceMessage,
): WorkspaceMessage[] {
  return insertMessageBySentAt(messages, message);
}

function reconcileOutgoingAgentMessage(
  messages: WorkspaceMessage[],
  message: WorkspaceMessage,
): WorkspaceMessage[] {
  if (messages.some((item) => item.id === message.id)) {
    return messages;
  }
  const pendingIndex = messages.findIndex(
    (item) =>
      item.id.startsWith("pending-") &&
      item.role === "agent" &&
      item.content === message.content,
  );
  if (pendingIndex >= 0) {
    return messages.map((item, index) => (index === pendingIndex ? message : item));
  }
  return appendUniqueMessage(messages, message);
}

function prependUniqueMessages(
  messages: WorkspaceMessage[],
  older: WorkspaceMessage[],
): WorkspaceMessage[] {
  const existingIds = new Set(messages.map((message) => message.id));
  const toPrepend = older.filter((message) => !existingIds.has(message.id));
  return [...toPrepend, ...messages];
}

function mergeLoadedMessages(
  existing: WorkspaceMessage[],
  loaded: WorkspaceMessage[],
  mode: "replace" | "prepend",
): WorkspaceMessage[] {
  if (mode === "replace") {
    return existing.reduce(
      (messages, message) => appendUniqueMessage(messages, message),
      loaded,
    );
  }
  return prependUniqueMessages(existing, loaded);
}

async function syncPresenceFromServer() {
  const presence = await workspaceApi.getPresence();
  if (presence?.state) {
    notifyPresenceUpdated(presence.state);
  }
}

function resolveInitialSelection(
  conversations: WorkspaceConversation[],
  tab: WorkspaceInboxTab,
  options: {
    requestedConversationId: string | null;
    incomingOfferId?: string;
    persistedSelectionId: string | null;
    restorePersistedSelection: boolean;
  },
): string {
  const {
    requestedConversationId,
    incomingOfferId,
    persistedSelectionId,
    restorePersistedSelection,
  } = options;

  if (
    requestedConversationId &&
    conversations.some((conversation) => conversation.id === requestedConversationId)
  ) {
    return requestedConversationId;
  }

  if (
    incomingOfferId &&
    conversations.some((conversation) => conversation.id === incomingOfferId)
  ) {
    return incomingOfferId;
  }

  if (restorePersistedSelection && persistedSelectionId) {
    const persisted = conversations.find(
      (conversation) => conversation.id === persistedSelectionId,
    );
    if (persisted && matchesTab(persisted, tab)) {
      return persistedSelectionId;
    }
  }

  if (tab === "open") {
    const active = conversations
      .filter((conversation) => matchesTab(conversation, "open"))
      .sort(compareInboxActivityDesc)[0];
    if (active) return active.id;

    const waiting = conversations.find(
      (conversation) => conversation.status === "waiting" && conversation.offerPending,
    );
    if (waiting) return waiting.id;
  }

  return firstConversationIdForTab(conversations, tab);
}

function firstConversationIdForTab(
  conversations: WorkspaceConversation[],
  tab: WorkspaceInboxTab,
): string {
  return (
    conversations
      .filter((conversation) => matchesTab(conversation, tab))
      .sort(compareInboxActivityDesc)[0]?.id ?? ""
  );
}

function isAssignedToCurrentUser(conversation: WorkspaceConversation): boolean {
  const userId = readAuthFromStorage().userId;
  return Boolean(userId && conversation.assignedUserId === userId);
}

function plainTextFromAssistantHtml(content: string): string {
  const element = document.createElement("div");
  element.innerHTML = content;
  return element.textContent?.trim() ?? content.trim();
}

function instantReplyDraft(_customerText: string): string {
  // Never show bot handoff templates during live agent sessions — wait for NLP.
  return "";
}

function buildSuggestionPrompt(customerText: string): string {
  const trimmed = customerText.trim();
  const prefix =
    "Draft one customer-facing reply. Load conversation context first. " +
    "Call organization knowledge only if this ask needs product, policy, FAQ, or company facts. " +
    "Extract entities only if the customer stated a new identity field. " +
    "A live agent is already connected.";
  if (!trimmed) return prefix;
  return `${prefix}\n\nCustomer's latest message:\n${trimmed}`;
}

function latestCustomerMessageText(messages: WorkspaceMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "customer") {
      return plainTextMessageBody(message.content);
    }
  }
  return "";
}

function cumulativeCustomerMessageText(messages: WorkspaceMessage[]): string {
  return messages
    .filter((message) => message.role === "customer")
    .map((message) => plainTextMessageBody(message.content).trim())
    .filter(Boolean)
    .join("\n");
}

function suggestionQueryText(conversation: WorkspaceConversation, latestText = ""): string {
  if (isVoiceChannel(conversation.channel)) {
    return cumulativeCustomerMessageText(conversation.messages) || latestText.trim();
  }
  return latestText.trim() || latestCustomerMessageText(conversation.messages);
}

function shouldAutoSuggestForConversation(
  conversation: WorkspaceConversation,
  senderType: string,
): boolean {
  if (senderType !== "customer") return false;
  if (!isAssignedToCurrentUser(conversation)) return false;
  if (conversation.offerPending) return false;
  if (conversation.status === "resolved") return false;
  return conversation.status === "active";
}

function shouldAutoSuggestLoadedConversation(conversation: WorkspaceConversation): boolean {
  if (!isAssignedToCurrentUser(conversation)) return false;
  if (conversation.offerPending) return false;
  if (conversation.status !== "active") return false;
  return latestCustomerMessageText(conversation.messages).length > 0;
}

function upsertConversation(
  conversations: WorkspaceConversation[],
  conversation: WorkspaceConversation,
): WorkspaceConversation[] {
  const index = conversations.findIndex((item) => item.id === conversation.id);
  if (index === -1) return [conversation, ...conversations];
  const next = [...conversations];
  const existing = next[index]!;
  next[index] = mergeWorkspaceConversationUpdate(existing, conversation);
  return next;
}

function withCreatedMessage(
  conversation: WorkspaceConversation,
  message: ApiMessage,
  mapped: WorkspaceMessage,
  selectedConversationId: string,
): WorkspaceConversation {
  const messages =
    message.senderType === "agent"
      ? reconcileOutgoingAgentMessage(conversation.messages, mapped)
      : appendUniqueMessage(conversation.messages, mapped);
  const isIncomingCustomerMessage =
    message.senderType === "customer" && selectedConversationId !== conversation.id;
  return {
    ...conversation,
    preview: truncatePreview(plainTextMessageBody(message.body)),
    updatedAt: mapped.sentAt,
    unread: isIncomingCustomerMessage || conversation.unread,
    unreadCount: isIncomingCustomerMessage
      ? (conversation.unreadCount ?? 0) + 1
      : conversation.unreadCount ?? 0,
    messages,
  };
}

function focusConversationTab(
  conversation: WorkspaceConversation,
  setTab: (tab: WorkspaceInboxTab) => void,
) {
  const nextTab = resolveTabForConversation(conversation);
  setTab(nextTab);
  persistWorkspaceTab(nextTab, true);
}

export function useWorkspaceState() {
  const dispatch = useAppDispatch();
  const sip = useSipCallStatus();
  const [searchParams] = useSearchParams();
  const requestedConversationId = searchParams.get("conversationId");
  const [conversations, setConversations] = useState<WorkspaceConversation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailsReadyId, setDetailsReadyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(
    () => readPersistedWorkspaceSelection() ?? "",
  );
  const [tab, setTabState] = useState<WorkspaceInboxTab>(() => {
    if (isWorkspaceTabUserSet()) {
      return readPersistedWorkspaceTab() ?? "closed";
    }
    return "closed";
  });
  const [search, setSearch] = useState("");
  const [draft, setDraftValue] = useState("");
  const [draftCopilotTurnId, setDraftCopilotTurnId] = useState<string | undefined>();
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const [ringingOfferId, setRingingOfferId] = useState<string | null>(null);
  const [offerActionBusy, setOfferActionBusy] = useState(false);
  const [replySending, setReplySending] = useState(false);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);
  const [dispositionDialogOpen, setDispositionDialogOpen] = useState(false);
  const [webchatDispositionId, setWebchatDispositionId] = useState<string | null>(null);
  const openedVoiceDispositionIdRef = useRef<string | null>(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferDispositionConversationId, setTransferDispositionConversationId] = useState<
    string | null
  >(null);
  const [transferDispositionLoading, setTransferDispositionLoading] = useState(false);
  const [transferOptionsLoading, setTransferOptionsLoading] = useState(false);
  const [transferTargetsLoading, setTransferTargetsLoading] = useState(false);
  const [transferTargetsError, setTransferTargetsError] = useState<string | null>(null);
  const [transferTargetsNextCursor, setTransferTargetsNextCursor] = useState<string | undefined>();
  const [transferTargetQuery, setTransferTargetQuery] = useState({ queueId: "", search: "" });
  const [transferCancelLoading, setTransferCancelLoading] = useState(false);
  const [transferNotice, setTransferNotice] = useState<string | null>(null);
  const [dispositionOptionsLoading, setDispositionOptionsLoading] = useState(false);
  const [dispositionOptions, setDispositionOptions] = useState<WorkspaceDispositionOption[]>([]);
  const [transferQueues, setTransferQueues] = useState<Queue[]>([]);
  const [transferAgents, setTransferAgents] = useState<WorkspaceTransferAgent[]>([]);
  const loading = useAppSelector((state) => state.workspace.inboxLoading);
  const conversationLoadingId = useAppSelector(
    (state) => state.workspace.conversationLoadingId,
  );
  const messagePages = useAppSelector((state) => state.workspace.messagePages);
  const [aiSuggestions, setAiSuggestions] = useState<
    Record<string, WorkspaceAiSuggestion>
  >({});
  const sendingRef = useRef(false);
  const resolveSubmissionRef = useRef(false);
  const ringingOfferIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef("");
  const loadedConversationIdsRef = useRef(new Set<string>());
  const conversationLoadGenerationRef = useRef(0);
  const conversationsRef = useRef<WorkspaceConversation[]>([]);
  const suggestionControllersRef = useRef(new Map<string, AbortController>());
  const suggestionRevisionsRef = useRef(new Map<string, number>());
  const readReceiptIdsRef = useRef(new Set<string>());
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingConversationRef = useRef<string | null>(null);
  const inboxLoadedRef = useRef(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const inboxPagingRef = useRef<Record<WorkspaceInboxTab, { offset: number; hasMore: boolean }>>({
    open: { offset: 0, hasMore: false },
    transferred: { offset: 0, hasMore: false },
    closed: { offset: 0, hasMore: false },
  });
  const loadingMoreInboxRef = useRef(false);
  const [inboxHasMore, setInboxHasMore] = useState<Record<WorkspaceInboxTab, boolean>>({
    open: false,
    transferred: false,
    closed: false,
  });
  const [loadingMoreInbox, setLoadingMoreInbox] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledRequestedConversationRef = useRef<string | null>(null);
  const requestedConversationIdRef = useRef(requestedConversationId);
  const sipCallRef = useRef(sip);
  const transferTargetsGenerationRef = useRef(0);
  requestedConversationIdRef.current = requestedConversationId;
  sipCallRef.current = sip;

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (typingConversationRef.current) {
        void workspaceApi.updateTyping(typingConversationRef.current, false).catch(() => undefined);
      }
      inboxLoadedRef.current = false;
      handledRequestedConversationRef.current = null;
    };
  }, []);

  const markCustomerMessagesRead = useCallback(
    (conversationId: string, messages: Array<ApiMessage | WorkspaceMessage>) => {
      for (const message of messages) {
        const isCustomer =
          "senderType" in message ? message.senderType === "customer" : message.role === "customer";
        if (!isCustomer || readReceiptIdsRef.current.has(message.id)) continue;
        readReceiptIdsRef.current.add(message.id);
        void workspaceApi.markMessageRead(conversationId, message.id).catch(() => {
          readReceiptIdsRef.current.delete(message.id);
        });
      }
    },
    [],
  );

  useEffect(() => {
    ringingOfferIdRef.current = ringingOfferId;
  }, [ringingOfferId]);

  useEffect(() => {
    function handlePresence(event: Event) {
      const presence = (event as CustomEvent<{ state: PresenceState }>).detail;
      if (presence.state !== "ready") {
        setRingingOfferId(null);
      }
    }
    window.addEventListener(WORKSPACE_PRESENCE_UPDATED, handlePresence);
    return () => window.removeEventListener(WORKSPACE_PRESENCE_UPDATED, handlePresence);
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    setDraftValue("");
    setDraftCopilotTurnId(undefined);
  }, [selectedId]);

  const handleIncomingOffer = useCallback((conversation: WorkspaceConversation) => {
    if (!isAssignedToCurrentUser(conversation)) return;
    if (!conversation.offerPending) return;
    const offered = {
      ...conversation,
      status: "waiting" as const,
      offerPending: true,
      unread: true,
    };
    setConversations((prev) => upsertConversation(prev, offered));
    setRingingOfferId(conversation.id);
    setSelectedId((current) => {
      const nextId = current || conversation.id;
      persistWorkspaceSelection(nextId);
      return nextId;
    });
    setTabState("open");
    persistWorkspaceTab("open", false);
  }, []);

  const refreshConversations = useCallback(async (options?: { merge?: boolean }) => {
    const merge = options?.merge === true && inboxLoadedRef.current;
    const showLoading = !inboxLoadedRef.current;
    if (showLoading) {
      dispatch(setInboxLoading(true));
    }
    setLoadError(null);
    setActionError(null);
    try {
      const pages = await workspaceApi.listInboxFirstPages();
      const items = pages.conversations;
      if (!merge) {
        inboxPagingRef.current = {
          open: { offset: pages.fetched.open, hasMore: pages.hasMore.open },
          transferred: { offset: pages.fetched.transferred, hasMore: pages.hasMore.transferred },
          closed: { offset: pages.fetched.closed, hasMore: pages.hasMore.closed },
        };
        setInboxHasMore(pages.hasMore);
      }
      const currentUserId = readAuthFromStorage().userId;
      const currentRequestedConversationId = requestedConversationIdRef.current;
      const currentSip = sipCallRef.current;
      setConversations((previous) => {
        const mapped = items
          .filter(
            (item) =>
              item.status !== "resolved" ||
              item.transferred ||
              isAssignedToCurrentUser(item) ||
              isTransferSource(item.transfer, currentUserId),
          )
          .map((item) => {
            const existing = previous.find((conversation) => conversation.id === item.id);
            const liveCall =
              currentSip.conversationId === item.id &&
              (currentSip.callState === "active" ||
                currentSip.callState === "dialing" ||
                currentSip.callState === "ringing");
            const next = liveCall ? { ...item, status: "active" as const } : item;
            return existing ? mergeWorkspaceConversationUpdate(existing, next) : next;
          });
        const keepId =
          currentRequestedConversationId ||
          currentSip.conversationId ||
          readPersistedWorkspaceSelection();
        if (merge) {
          const mappedIds = new Set(mapped.map((item) => item.id));
          const rest = previous.filter((item) => !mappedIds.has(item.id));
          return [...mapped, ...rest];
        }
        const kept = keepId
          ? previous.find((item) => item.id === keepId && !mapped.some((row) => row.id === item.id))
          : undefined;
        return kept ? [kept, ...mapped] : mapped;
      });
      const incomingOffer = items.find(
        (item) => item.offerPending && isAssignedToCurrentUser(item),
      );
      if (incomingOffer) {
        setRingingOfferId(incomingOffer.id);
      } else if (!merge) {
        setRingingOfferId(null);
      }
      const acceptedOutbound = items.find(
        (item) =>
          !isVoiceChannel(item.channel) &&
          isTransferSource(item.transfer, currentUserId) &&
          isTransferAccepted(item.transfer),
      );
      setTransferDispositionConversationId(acceptedOutbound?.id ?? null);
      const isFirstLoad = !inboxLoadedRef.current;
      const userSetTab = isWorkspaceTabUserSet();
      const persistedTab = readPersistedWorkspaceTab();
      const persistedSelectionId = readPersistedWorkspaceSelection();
      const initialTab = isFirstLoad
        ? resolveInitialInboxTab(items, {
            userSetTab,
            persistedTab,
            persistedSelectionId,
            requestedConversationId: currentRequestedConversationId,
            currentUserId,
          })
        : null;

      if (!merge && isFirstLoad && initialTab) {
        setTabState(initialTab);
        if (!userSetTab) {
          persistWorkspaceTab(initialTab, false);
        }
      }

      if (!merge) setSelectedId((current) => {
        if (currentRequestedConversationId) return currentRequestedConversationId;
        if (
          current &&
          items.some((item) => item.id === current) &&
          (!isFirstLoad || !initialTab)
        ) {
          const currentConversation = items.find((item) => item.id === current);
          if (currentConversation && matchesTab(currentConversation, tab)) {
            return current;
          }
        }

        const selectionTab = initialTab ?? tab;
        const nextId = resolveInitialSelection(items, selectionTab, {
          requestedConversationId: currentRequestedConversationId,
          incomingOfferId: incomingOffer?.id,
          persistedSelectionId,
          restorePersistedSelection: Boolean(persistedSelectionId) || userSetTab,
        });

        if (nextId) {
          persistWorkspaceSelection(nextId);
        }

        return nextId;
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load conversations");
      if (!merge) {
        setConversations([]);
        setSelectedId("");
        setInboxHasMore({ open: false, transferred: false, closed: false });
      }
    } finally {
      inboxLoadedRef.current = true;
      dispatch(setInboxLoading(false));
    }
  }, [dispatch, requestedConversationId, sip.callState, sip.conversationId]);

  const scheduleSilentRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshConversations({ merge: true });
    }, 500);
  }, [refreshConversations]);

  const loadMoreInbox = useCallback(async () => {
    const inbox = tabRef.current;
    const paging = inboxPagingRef.current[inbox];
    if (!paging.hasMore || loadingMoreInboxRef.current) return;
    loadingMoreInboxRef.current = true;
    setLoadingMoreInbox(true);
    try {
      const page = await workspaceApi.listInboxPage(inbox, paging.offset);
      inboxPagingRef.current[inbox] = {
        offset: paging.offset + page.fetched,
        hasMore: page.hasMore,
      };
      setInboxHasMore((current) => ({ ...current, [inbox]: page.hasMore }));
      if (page.conversations.length === 0) return;
      const currentUserId = readAuthFromStorage().userId;
      const currentSip = sipCallRef.current;
      setConversations((previous) => {
        const existingIds = new Set(previous.map((item) => item.id));
        const added = page.conversations
          .filter((item) => !existingIds.has(item.id))
          .filter(
            (item) =>
              item.status !== "resolved" ||
              item.transferred ||
              isAssignedToCurrentUser(item) ||
              isTransferSource(item.transfer, currentUserId),
          )
          .map((item) => {
            const liveCall =
              currentSip.conversationId === item.id &&
              (currentSip.callState === "active" ||
                currentSip.callState === "dialing" ||
                currentSip.callState === "ringing");
            return liveCall ? { ...item, status: "active" as const } : item;
          });
        return added.length > 0 ? [...previous, ...added] : previous;
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load conversations");
    } finally {
      loadingMoreInboxRef.current = false;
      setLoadingMoreInbox(false);
    }
  }, []);

  useEffect(() => {
    if (!requestedConversationId) return;
    if (handledRequestedConversationRef.current === requestedConversationId) return;

    const conversation = conversations.find((item) => item.id === requestedConversationId);
    if (conversation) {
      handledRequestedConversationRef.current = requestedConversationId;
      const liveCall =
        sip.conversationId === conversation.id &&
        (sip.callState === "active" || sip.callState === "dialing" || sip.callState === "ringing");
      const nextTab = liveCall ? "open" : resolveTabForConversation(conversation);
      setSelectedId(requestedConversationId);
      setTabState(nextTab);
      persistWorkspaceTab(nextTab, false);
      return;
    }

    void workspaceApi
      .getConversation(requestedConversationId)
      .then((loaded) => {
        const alreadyOpened =
          handledRequestedConversationRef.current === requestedConversationId;
        handledRequestedConversationRef.current = requestedConversationId;
        setConversations((previous) => upsertConversation(previous, loaded));
        setSelectedId(loaded.id);
        persistWorkspaceSelection(loaded.id);
        if (alreadyOpened) return;
        const liveCall =
          sip.conversationId === loaded.id &&
          (sip.callState === "active" ||
            sip.callState === "dialing" ||
            sip.callState === "ringing");
        const nextTab = liveCall ? "open" : resolveTabForConversation(loaded);
        setTabState(nextTab);
        persistWorkspaceTab(nextTab, false);
        console.log("[voice] selected conversation from url", { conversationId: loaded.id });
      })
      .catch((error) => {
        console.warn("[voice] failed to load conversation from url", requestedConversationId, error);
      });
  }, [conversations, requestedConversationId, sip.callState, sip.conversationId]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    function handleVoiceOpened(event: Event) {
      const detail = (event as CustomEvent<{ conversation?: WorkspaceConversation }>).detail;
      const conversation = detail?.conversation;
      if (!conversation?.id) return;
      console.log("[voice] workspace received open event", { conversationId: conversation.id });
      handledRequestedConversationRef.current = conversation.id;
      setConversations((previous) => upsertConversation(previous, { ...conversation, status: "active" }));
      setSelectedId(conversation.id);
      setTabState("open");
      persistWorkspaceTab("open", false);
      persistWorkspaceSelection(conversation.id);
    }
    window.addEventListener(WORKSPACE_VOICE_OPENED, handleVoiceOpened);
    return () => window.removeEventListener(WORKSPACE_VOICE_OPENED, handleVoiceOpened);
  }, []);

  useEffect(() => {
    function openConversation(conversationId: string) {
      const currentSip = sipCallRef.current;
      const existing = conversationsRef.current.find((item) => item.id === conversationId);

      const show = (conversation: WorkspaceConversation) => {
        handledRequestedConversationRef.current = conversation.id;
        setConversations((previous) =>
          upsertConversation(previous, conversation).map((item) =>
            item.id === conversation.id ? { ...item, unread: false, unreadCount: 0 } : item,
          ),
        );
        setSelectedId(conversation.id);
        persistWorkspaceSelection(conversation.id);
        setFocusedMessageId(null);
        const liveCall =
          currentSip.conversationId === conversation.id &&
          (currentSip.callState === "active" ||
            currentSip.callState === "dialing" ||
            currentSip.callState === "ringing");
        const nextTab = liveCall ? "open" : resolveTabForConversation(conversation);
        setTabState(nextTab);
        persistWorkspaceTab(nextTab, false);
      };

      if (existing) {
        show(existing);
        return;
      }

      void workspaceApi
        .getConversation(conversationId)
        .then((loaded) => show(loaded))
        .catch(() => undefined);
    }

    function onOpenConversation(event: Event) {
      const conversationId = (
        event as CustomEvent<{ conversationId?: string }>
      ).detail?.conversationId?.trim();
      if (!conversationId) return;
      openConversation(conversationId);
    }

    function onContactUpdated(event: Event) {
      const contactId = (
        event as CustomEvent<{ contactId?: string }>
      ).detail?.contactId?.trim();
      if (!contactId) return;
      void contactsApi
        .getContact(contactId)
        .then(({ contact }) => {
          setConversations((previous) =>
            previous.map((conversation) =>
              conversation.customer.contactId === contact.id
                ? {
                    ...conversation,
                    customer: mergeWorkspaceCustomerFromContact(conversation.customer, contact),
                  }
                : conversation,
            ),
          );
        })
        .catch(() => undefined);
    }

    window.addEventListener(ASSISTANT_WORKSPACE_OPEN_CONVERSATION, onOpenConversation);
    window.addEventListener(ASSISTANT_WORKSPACE_CONTACT_UPDATED, onContactUpdated);
    return () => {
      window.removeEventListener(ASSISTANT_WORKSPACE_OPEN_CONVERSATION, onOpenConversation);
      window.removeEventListener(ASSISTANT_WORKSPACE_CONTACT_UPDATED, onContactUpdated);
    };
  }, []);

  const generateAiSuggestion = useCallback(async (
    conversationId: string,
    replace = false,
    customerText = "",
  ) => {
    const existingController = suggestionControllersRef.current.get(conversationId);
    if (existingController && !replace) return;
    existingController?.abort();
    const controller = new AbortController();
    const provisionalText = instantReplyDraft(customerText);
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    const sourceMessageId =
      [...(conversation?.messages ?? [])].reverse().find((message) => message.role === "customer")
        ?.id ?? "";
    const revision = (suggestionRevisionsRef.current.get(conversationId) ?? 0) + 1;
    if (conversation && isVoiceChannel(conversation.channel)) {
      console.info("[voice][assist] generation.started", {
        conversationId,
        sourceMessageId: sourceMessageId || null,
        revision,
        replace,
      });
    }
    suggestionRevisionsRef.current.set(conversationId, revision);
    suggestionControllersRef.current.set(conversationId, controller);
    setAiSuggestions((current) => ({
      ...current,
      [conversationId]: {
        status: "loading",
        text: provisionalText,
        replyDraft: provisionalText,
        revision,
        sourceMessageId,
      },
    }));

    let response = "";
    let turnId: string | undefined;
    let routingChain: string[] | undefined;
    let promptVersions: Record<string, string> | undefined;
    const streamedAssistState: { current?: WorkspaceAiSuggestion } = {};
    const startedAt = performance.now();
    try {
      await streamCopilotMessage(
        env.passiveAssistStructuredEnabled
          ? customerText
          : buildSuggestionPrompt(customerText),
        "agent",
        {
          context: {
            path: "/agent/workspace",
            surface: "inbox",
            conversationId,
            contactId: conversation?.customer.contactId || undefined,
            contactName: conversation?.customer.name,
            contactEmail: conversation?.customer.email,
            contactPhone: conversation?.customer.phone,
            sourceMessageId,
            assistRevision: revision,
            assistStructured: env.passiveAssistStructuredEnabled,
          },
          signal: controller.signal,
          fastSuggestion: true,
          onEvent: (event) => {
            if (event.event === "text_delta") {
              response += event.data.delta;
            }
            if (event.event === "assist_state") {
              if (
                event.data.revision !== revision ||
                (sourceMessageId && event.data.sourceMessageId !== sourceMessageId)
              ) {
                return;
              }
              streamedAssistState.current = {
                status: "ready",
                text: event.data.replyDraft,
                replyDraft: event.data.replyDraft,
                privateNotes: event.data.privateNotes,
                actionProposal: event.data.actionProposal,
                revision: event.data.revision,
                sourceMessageId: event.data.sourceMessageId,
              };
            }
            if (event.event === "done") {
              turnId = event.data.turnId;
              routingChain = event.data.routingChain;
              promptVersions = event.data.promptVersions;
            }
          },
        },
      );
      if (suggestionRevisionsRef.current.get(conversationId) !== revision) return;
      const assistState = streamedAssistState.current;
      const text =
        assistState?.replyDraft ||
        extractCustomerFacingSuggestion(plainTextFromAssistantHtml(response));
      if (!text) throw new Error("No suggestion was generated");
      if (conversation && isVoiceChannel(conversation.channel)) {
        console.info("[voice][assist] generation.succeeded", {
          conversationId,
          sourceMessageId: sourceMessageId || null,
          revision,
          structured: Boolean(assistState),
        });
      }
      setAiSuggestions((current) => ({
        ...current,
        [conversationId]: {
          ...(assistState ?? { status: "ready" as const, text }),
          text,
        },
      }));
      void recordCopilotTurn({
        id: turnId,
        conversationId,
        surface: "inbox",
        agentInput: "Automatic reply suggestion",
        copilotResponse: response,
        suggestionText: text,
        latencyMs: Math.round(performance.now() - startedAt),
        routingChain,
        promptVersions,
        assistState: assistState
          ? {
              replyDraft: assistState.replyDraft,
              privateNotes: assistState.privateNotes,
              actionProposal: assistState.actionProposal,
              revision: assistState.revision,
              sourceMessageId: assistState.sourceMessageId,
            }
          : undefined,
      }).then((recorded) => {
        notifyInboxAssistTurnRecorded(conversationId);
        setAiSuggestions((current) => {
          const existing = current[conversationId];
          if (!existing || existing.status !== "ready") return current;
          return {
            ...current,
            [conversationId]: {
              ...existing,
              copilotTurnId: recorded.id,
            },
          };
        });
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (conversation && isVoiceChannel(conversation.channel)) {
        console.error("[voice][assist] generation.failed", {
          conversationId,
          sourceMessageId: sourceMessageId || null,
          revision,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      setAiSuggestions((current) => ({
        ...current,
        [conversationId]: {
          status: "error",
          text: error instanceof Error ? error.message : "Suggestion unavailable",
        },
      }));
    } finally {
      if (suggestionControllersRef.current.get(conversationId) === controller) {
        suggestionControllersRef.current.delete(conversationId);
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;

    const existing = conversationsRef.current.find(
      (conversation) => conversation.id === selectedId,
    );
    const missingSpeakerIdentity = Boolean(
      existing &&
        isVoiceChannel(existing.channel) &&
        existing.messages.some((message) => message.role === "agent" && !message.senderUserId),
    );
    if (missingSpeakerIdentity) {
      loadedConversationIdsRef.current.delete(selectedId);
    }
    if (
      existing &&
      existing.messages.length > 0 &&
      loadedConversationIdsRef.current.has(selectedId) &&
      !missingSpeakerIdentity
    ) {
      setDetailsReadyId(selectedId);
      return;
    }

    if (loadedConversationIdsRef.current.has(selectedId) && !existing?.messages.length) {
      loadedConversationIdsRef.current.delete(selectedId);
    }

    if (loadedConversationIdsRef.current.has(selectedId)) return;

    const generation = ++conversationLoadGenerationRef.current;
    const loadingFor = selectedId;
    setDetailsReadyId((current) => (current === loadingFor ? null : current));
    dispatch(resetMessagePage(loadingFor));
    dispatch(setConversationLoadingId(loadingFor));

    void Promise.all([
      workspaceApi.getConversation(loadingFor),
      dispatch(fetchConversationMessagesPage({ conversationId: loadingFor, offset: 0 })).unwrap(),
    ])
      .then(([conversation, messagePage]) => {
        if (conversationLoadGenerationRef.current !== generation) return;
        setActionError(null);
        const messages = messagePage.messages.map(mapMessageFromApi);
        const mergedConversation: WorkspaceConversation = {
          ...conversation,
          unread: false,
          unreadCount: 0,
          messages: mergeLoadedMessages(
            conversationsRef.current.find((item) => item.id === loadingFor)?.messages ?? [],
            messages,
            "replace",
          ),
        };
        setConversations((prev) => {
          const current = prev.find((item) => item.id === loadingFor);
          return placeLoadedConversation(prev, {
            ...conversation,
            unread: false,
            unreadCount: 0,
            messages: mergeLoadedMessages(current?.messages ?? [], messages, "replace"),
          });
        });
        loadedConversationIdsRef.current.add(loadingFor);
        setDetailsReadyId(loadingFor);
        if (shouldAutoSuggestLoadedConversation(mergedConversation)) {
          void generateAiSuggestion(
            loadingFor,
            false,
            suggestionQueryText(mergedConversation),
          );
        }
        markCustomerMessagesRead(loadingFor, messagePage.messages);
        void workspaceApi
          .getConversationContext(loadingFor)
          .then((context) => {
            if (conversationLoadGenerationRef.current !== generation) return;
            setConversations((prev) =>
              prev.map((item) =>
                item.id === loadingFor
                  ? {
                      ...item,
                      customer: mergeWorkspaceCustomerFromContact(item.customer, context.contact),
                      crossChannelSummary: context.crossChannelSummary ?? [],
                    }
                  : item,
              ),
            );
          })
          .catch(() => undefined);
      })
      .catch((error) => {
        if (conversationLoadGenerationRef.current !== generation) return;
        setActionError(
          error instanceof Error ? error.message : "Failed to load conversation",
        );
      })
      .finally(() => {
        if (conversationLoadGenerationRef.current === generation) {
          dispatch(setConversationLoadingId(null));
        }
      });
  }, [dispatch, generateAiSuggestion, markCustomerMessagesRead, selectedId]);

  const loadOlderMessages = useCallback(
    async (conversationId: string) => {
      const page = messagePages[conversationId];
      if (!page?.hasMore || page.loadingMore || page.loading) return;

      const nextOffset = Math.max(0, page.offset - MESSAGE_PAGE_SIZE_EXPORT);
      try {
        const messagePage = await dispatch(
          fetchConversationMessagesPage({
            conversationId,
            offset: nextOffset,
            anchor: "start",
          }),
        ).unwrap();
        const older = messagePage.messages.map(mapMessageFromApi);
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  messages: mergeLoadedMessages(conversation.messages, older, "prepend"),
                }
              : conversation,
          ),
        );
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Failed to load older messages",
        );
      }
    },
    [dispatch, messagePages],
  );

  const handleTransferRestored = useCallback(
    (conversation: WorkspaceConversation, outcome: "rejected" | "expired" | "cancelled") => {
      const currentUserId = readAuthFromStorage().userId;
      const existing = conversationsRef.current.find((item) => item.id === conversation.id);
      const transfer = conversation.transfer ?? existing?.transfer;
      if (isTransferSource(transfer, currentUserId)) {
        const restored: WorkspaceConversation = {
          ...conversation,
          transfer: {
            ...transfer,
            state: outcome,
            [`${outcome}At`]: new Date().toISOString(),
          },
          status: "active",
          offerPending: false,
          transferred: undefined,
        };
        setConversations((prev) => upsertConversation(prev, restored));
        setTransferDispositionConversationId(null);
        setTransferNotice(
          outcome === "rejected"
            ? "The receiving agent declined the transfer. The conversation is active again."
            : outcome === "expired"
              ? "The transfer offer expired. The conversation is active again."
              : "The transfer was cancelled. The conversation is active again.",
        );
        setTabState("open");
        persistWorkspaceTab("open", false);
        return;
      }
      setRingingOfferId((current) =>
        current === conversation.id ? null : current,
      );
      setConversations((prev) =>
        prev.filter(
          (item) =>
            item.id !== conversation.id ||
            (!item.offerPending && !item.consultParticipant),
        ),
      );
      setSelectedId((current) => (current === conversation.id ? "" : current));
    },
    [],
  );

  const speakerRefreshTimersRef = useRef<Map<string, number>>(new Map());
  const refreshVoiceSpeakerIdentity = useCallback(
    (conversationId: string) => {
      const timers = speakerRefreshTimersRef.current;
      const pending = timers.get(conversationId);
      if (pending) window.clearTimeout(pending);
      timers.set(
        conversationId,
        window.setTimeout(() => {
          timers.delete(conversationId);
          void dispatch(
            fetchConversationMessagesPage({ conversationId, offset: 0 }),
          )
            .unwrap()
            .then((messagePage) => {
              const loaded = messagePage.messages.map(mapMessageFromApi);
              setConversations((prev) =>
                prev.map((conversation) =>
                  conversation.id === conversationId
                    ? {
                        ...conversation,
                        messages: mergeLoadedMessages(conversation.messages, loaded, "replace"),
                      }
                    : conversation,
                ),
              );
            })
            .catch(() => undefined);
        }, 400),
      );
    },
    [dispatch],
  );

  useEffect(() => {
    return () => {
      for (const timer of speakerRefreshTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      speakerRefreshTimersRef.current.clear();
    };
  }, []);

  const socketHandlers = useMemo(
    () => ({
      onConversationCreated: (conversation: WorkspaceConversation) => {
        setConversations((prev) => {
          if (prev.some((item) => item.id === conversation.id)) return prev;
          return [conversation, ...prev];
        });
        setSelectedId((current) => current || conversation.id);
      },
      onConversationAssigned: handleIncomingOffer,
      onConversationOffer: handleIncomingOffer,
      onConversationAccepted: (conversation: WorkspaceConversation) => {
        let customerText = "";
        setConversations((prev) => {
          const existing = prev.find((item) => item.id === conversation.id);
          const merged: WorkspaceConversation = {
            ...(existing ?? conversation),
            ...conversation,
            transfer: conversation.transfer ?? existing?.transfer ?? null,
            status: "active",
            offerPending: false,
            messages:
              existing && existing.messages.length > 0
                ? existing.messages
                : conversation.messages,
          };
          customerText = suggestionQueryText(merged);
          return upsertConversation(prev, merged);
        });
        if (ringingOfferIdRef.current === conversation.id) {
          setRingingOfferId(null);
        }
        if (isAssignedToCurrentUser(conversation)) {
          void syncPresenceFromServer();
          void generateAiSuggestion(conversation.id, false, customerText);
        }
      },
      onConversationRejected: (conversation: WorkspaceConversation) => {
        setConversations((prev) => prev.filter((item) => item.id !== conversation.id));
        setRingingOfferId((current) => (current === conversation.id ? null : current));
        setSelectedId((current) => (current === conversation.id ? "" : current));
      },
      onConversationQueued: (conversation: WorkspaceConversation) => {
        setConversations((prev) =>
          upsertConversation(prev, {
            ...conversation,
            offerPending: false,
            status: conversation.status,
          }),
        );
        setRingingOfferId((current) => (current === conversation.id ? null : current));
      },
      onConversationResolved: (conversation: WorkspaceConversation) => {
        if (!isAssignedToCurrentUser(conversation)) return;
        setConversations((prev) =>
          upsertConversation(prev, {
            ...conversation,
            status: "resolved",
            offerPending: false,
          }),
        );
        if (selectedIdRef.current === conversation.id) {
          focusConversationTab(
            { ...conversation, status: "resolved", offerPending: false },
            setTabState,
          );
        }
        void syncPresenceFromServer();
      },
      onConversationEnded: (conversation: WorkspaceConversation) => {
        if (!isAssignedToCurrentUser(conversation)) return;
        const pendingVoiceDisposition =
          sipCallRef.current.awaitingDisposition &&
          sipCallRef.current.conversationId === conversation.id;
        const ended = {
          ...conversation,
          status: "resolved" as const,
          offerPending: false,
        };
        const openWebchatDisposition =
          !pendingVoiceDisposition && shouldOpenWebchatCustomerDisposition(ended);
        setConversations((prev) => upsertConversation(prev, ended));
        if (openWebchatDisposition) {
          setSelectedId(ended.id);
          persistWorkspaceSelection(ended.id);
          focusConversationTab(ended, setTabState);
          setWebchatDispositionId(ended.id);
          setDispositionDialogOpen(true);
          setResolveLoading(false);
          resolveSubmissionRef.current = false;
          setDispositionOptionsLoading(true);
          void workspaceApi
            .listDispositions()
            .then(setDispositionOptions)
            .catch((error) => {
              setActionError(
                error instanceof Error ? error.message : "Failed to load dispositions",
              );
            })
            .finally(() => setDispositionOptionsLoading(false));
        } else if (selectedIdRef.current === conversation.id) {
          focusConversationTab(ended, setTabState);
          if (!pendingVoiceDisposition) {
            if (conversation.id === webchatDispositionId) setWebchatDispositionId(null);
            setDispositionDialogOpen(false);
            setResolveLoading(false);
            resolveSubmissionRef.current = false;
          }
        }
        if (
          !pendingVoiceDisposition &&
          sipCallRef.current.conversationId === conversation.id
        ) {
          completeSipCallDisposition(conversation.id);
        } else if (!pendingVoiceDisposition) {
          void syncPresenceFromServer();
        }
      },
      onConversationTransferred: (conversation: WorkspaceConversation) => {
        // Recipient of a transfer offer should keep ringing — do not mark as transferred yet.
        if (conversation.offerPending && isAssignedToCurrentUser(conversation)) {
          handleIncomingOffer(conversation);
          return;
        }
        setConversations((prev) =>
          upsertConversation(prev, { ...conversation, transferred: undefined, offerPending: false }),
        );
      },
      onConversationTransferOffered: (event: WorkspaceTransferEvent) => {
        const base =
          event.conversation ??
          conversationsRef.current.find((item) => item.id === event.conversationId);
        if (!base) return;
        const conversation = { ...base, transfer: event.transfer };
        const currentUserId = readAuthFromStorage().userId;
        if (!isTransferSource(conversation.transfer, currentUserId)) {
          if (isVoiceChannel(conversation.channel)) {
            setConversations((prev) =>
              upsertConversation(prev, {
                ...conversation,
                consultParticipant: true,
                offerPending: false,
                status: conversation.status === "resolved" ? "resolved" : "active",
              }),
            );
            return;
          }
          handleIncomingOffer({
            ...conversation,
            assignedUserId: currentUserId,
            offerPending: true,
            status: "waiting",
          });
        } else {
          setConversations((prev) =>
            upsertConversation(prev, {
              ...conversation,
              transferred: undefined,
              offerPending: false,
            }),
          );
        }
      },
      onConversationTransferAccepted: (event: WorkspaceTransferEvent) => {
        const existing = conversationsRef.current.find(
          (item) => item.id === event.conversationId,
        );
        const conversation = event.conversation ?? existing;
        if (!conversation) return;
        const transfer = event.transfer;
        if (!isTransferSource(transfer, readAuthFromStorage().userId)) return;
        // Ignore premature "accepted" sockets that still carry offered/ringing state.
        if (isTransferPending(transfer) || (transfer?.state && transfer.state !== "accepted")) {
          setConversations((prev) =>
            upsertConversation(prev, {
              ...conversation,
              transfer,
              transferred: undefined,
              offerPending: false,
            }),
          );
          return;
        }
        const acceptedConversation = {
          ...conversation,
          transfer: {
            ...transfer,
            state: "accepted" as const,
            acceptedAt: transfer?.acceptedAt ?? new Date().toISOString(),
          },
        };
        setConversations((prev) =>
          upsertConversation(prev, {
            ...acceptedConversation,
            transferred: undefined,
            offerPending: false,
          }),
        );
        setSelectedId(conversation.id);
        setTabState("open");
        if (!isVoiceChannel(conversation.channel)) {
          setTransferDispositionConversationId(conversation.id);
        }
      },
      onConversationTransferRejected: (event: WorkspaceTransferEvent) => {
        const conversation =
          event.conversation ??
          conversationsRef.current.find((item) => item.id === event.conversationId);
        if (conversation) {
          handleTransferRestored({ ...conversation, transfer: event.transfer }, "rejected");
        }
      },
      onConversationTransferExpired: (event: WorkspaceTransferEvent) => {
        const conversation =
          event.conversation ??
          conversationsRef.current.find((item) => item.id === event.conversationId);
        if (conversation) {
          handleTransferRestored({ ...conversation, transfer: event.transfer }, "expired");
        }
      },
      onConversationTransferCancelled: (event: WorkspaceTransferEvent) => {
        const conversation =
          event.conversation ??
          conversationsRef.current.find((item) => item.id === event.conversationId);
        if (conversation) {
          handleTransferRestored({ ...conversation, transfer: event.transfer }, "cancelled");
        }
      },
      onConversationTransferCompleted: (event: WorkspaceTransferEvent) => {
        const existing = conversationsRef.current.find(
          (item) => item.id === event.conversationId,
        );
        if (!existing) return;
        const conversation = event.conversation ?? existing;
        const transfer = event.transfer;
        if (!isTransferSource(transfer, readAuthFromStorage().userId)) return;
        const completed = {
          ...conversation,
          transfer: {
            ...transfer,
            state: "completed",
            completedAt: transfer?.completedAt ?? new Date().toISOString(),
          },
          transferred: true,
          offerPending: false,
        };
        setConversations((prev) => upsertConversation(prev, completed));
        setTransferDispositionConversationId(null);
        if (selectedIdRef.current === conversation.id) {
          focusConversationTab(completed, setTabState);
        }
      },
      onConversationReopened: (conversation: WorkspaceConversation) => {
        setConversations((prev) => prev.filter((item) => item.id !== conversation.id));
        setSelectedId((current) => (current === conversation.id ? "" : current));
        if (selectedIdRef.current === conversation.id) {
          setFocusedMessageId(null);
        }
        setAiSuggestions((current) => {
          const next = { ...current };
          delete next[conversation.id];
          return next;
        });
      },
      onContactEnriched: (payload: ContactEnrichedPayload) => {
        const authoritativeContact = {
          ...payload.contact,
          id: payload.canonicalContactId,
        };
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === payload.conversationId
              ? {
                  ...conversation,
                  customer: {
                    ...mergeWorkspaceCustomerFromContact(
                      conversation.customer,
                      authoritativeContact,
                    ),
                    contactEnrichmentOutcome: payload.outcome,
                  },
                }
              : conversation,
          ),
        );
      },
      onSentimentUpdated: (conversationId: string, sentiment: ConversationSentiment) => {
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, sentiment }
              : conversation,
          ),
        );
      },
      onReconnect: () => {
        scheduleSilentRefresh();
      },
      onMessageCreated: (conversationId: string, message: ApiMessage) => {
        const mapped = mapMessageFromApi(message);
        const applyMessage = (conversation: WorkspaceConversation) => {
          const current =
            conversationsRef.current.find((item) => item.id === conversationId) ??
            conversation;
          const nextConversation = withCreatedMessage(
            current,
            message,
            mapped,
            selectedIdRef.current,
          );
          const index = conversationsRef.current.findIndex(
            (item) => item.id === conversationId,
          );
          const nextConversations =
            index === -1
              ? [nextConversation, ...conversationsRef.current]
              : conversationsRef.current.map((item) =>
                  item.id === conversationId ? nextConversation : item,
                );
          conversationsRef.current = nextConversations;
          setConversations(nextConversations);
          if (isVoiceChannel(nextConversation.channel)) {
            console.info("[voice][transcript] message.created", {
              conversationId,
              messageId: message.id,
              senderType: message.senderType,
              status: nextConversation.status,
              selected: selectedIdRef.current === conversationId,
            });
          }
          if (
            isVoiceChannel(nextConversation.channel) &&
            mapped.role === "agent" &&
            !mapped.senderUserId
          ) {
            refreshVoiceSpeakerIdentity(conversationId);
          }
          if (shouldAutoSuggestForConversation(nextConversation, message.senderType)) {
            void generateAiSuggestion(
              conversationId,
              true,
              suggestionQueryText(nextConversation, message.body),
            );
          }
        };

        const existing = conversationsRef.current.find(
          (conversation) => conversation.id === conversationId,
        );
        if (existing) {
          applyMessage(existing);
        } else {
          void workspaceApi
            .getConversation(conversationId)
            .then((conversation) => {
              const latest =
                conversationsRef.current.find((item) => item.id === conversationId) ??
                conversation;
              applyMessage(latest);
            })
            .catch((error) => {
              console.warn("[workspace] failed to load conversation for message", {
                conversationId,
                error,
              });
            });
        }
        if (message.senderType === "customer" && selectedIdRef.current === conversationId) {
          markCustomerMessagesRead(conversationId, [message]);
        }
      },
      onMessageReceiptUpdated: (
        conversationId: string,
        receipt: { messageId: string; status: "sent" | "delivered" | "read" },
      ) => {
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  messages: conversation.messages.map((message) =>
                    message.id === receipt.messageId
                      ? { ...message, deliveryState: receipt.status }
                      : message,
                  ),
                }
              : conversation,
          ),
        );
      },
      onTypingUpdated: (
        conversationId: string,
        participant: "visitor" | "agent",
        active: boolean,
      ) => {
        if (participant !== "visitor") return;
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, visitorTyping: active }
              : conversation,
          ),
        );
      },
      onPresenceUpdated: (state: PresenceState) => {
        notifyPresenceUpdated(state);
      },
    }),
    [
      generateAiSuggestion,
      handleIncomingOffer,
      handleTransferRestored,
      markCustomerMessagesRead,
      refreshVoiceSpeakerIdentity,
      scheduleSilentRefresh,
      webchatDispositionId,
    ],
  );

  useEffect(() => {
    if (!selectedId) return;
    const existing = conversationsRef.current.find((conversation) => conversation.id === selectedId);
    if (!existing || !isVoiceChannel(existing.channel)) return;
    if (existing.messages.some((message) => message.role === "agent" && !message.senderUserId)) {
      refreshVoiceSpeakerIdentity(selectedId);
    }
  }, [refreshVoiceSpeakerIdentity, selectedId]);

  useWorkspaceSocket(socketHandlers);

  useEffect(() => {
    if (!transferDispositionConversationId) return;
    void loadDispositionOptions();
    // Intentionally only when a transfer is accepted — loadDispositionOptions reads latest options state.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per accepted transfer id
  }, [transferDispositionConversationId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations
      .filter((conversation) => {
        if (!matchesTab(conversation, tab)) return false;
        if (!query) return true;
        const haystack = [
          conversation.customer.name,
          conversation.subject,
          conversation.preview,
          conversation.queue,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort(compareInboxActivityDesc);
  }, [conversations, tab, search]);

  useEffect(() => {
    if (!selectedId) return;

    const selectedConversation = conversations.find(
      (conversation) => conversation.id === selectedId,
    );
    if (!selectedConversation) {
      if (
        selectedId === webchatDispositionId ||
        selectedId === requestedConversationId ||
        selectedId === sip.conversationId ||
        selectedId === readPersistedWorkspaceSelection()
      ) {
        return;
      }
      const nextId = filtered[0]?.id ?? "";
      if (nextId !== selectedId) {
        setSelectedId(nextId);
        persistWorkspaceSelection(nextId);
        setFocusedMessageId(null);
      }
      return;
    }

    if (!matchesTab(selectedConversation, tab)) {
      const liveCall =
        sip.conversationId === selectedConversation.id &&
        (sip.callState === "active" ||
          sip.callState === "dialing" ||
          sip.callState === "ringing");
      if (
        liveCall ||
        (selectedConversation.id === requestedConversationId &&
          selectedConversation.status !== "resolved" &&
          !selectedConversation.transferred)
      ) {
        setTabState("open");
        persistWorkspaceTab("open", false);
        return;
      }
      focusConversationTab(selectedConversation, setTabState);
    }
  }, [
    conversations,
    filtered,
    requestedConversationId,
    selectedId,
    sip.callState,
    sip.conversationId,
    tab,
    webchatDispositionId,
  ]);

  const selected = useMemo(() => {
    const conversation =
      conversations.find((item) => item.id === selectedId) ?? null;
    if (!conversation) return null;
    if (sip.awaitingDisposition && sip.conversationId === conversation.id) {
      return conversation;
    }
    if (matchesTab(conversation, tab)) return conversation;
    const liveCall =
      sip.conversationId === conversation.id &&
      (sip.callState === "active" ||
        sip.callState === "dialing" ||
        sip.callState === "ringing");
    if (liveCall) return conversation;
    if (
      conversation.id === requestedConversationId &&
      conversation.status !== "resolved" &&
      !conversation.transferred
    ) {
      return conversation;
    }
    return null;
  }, [
    conversations,
    requestedConversationId,
    selectedId,
    sip.awaitingDisposition,
    sip.callState,
    sip.conversationId,
    tab,
  ]);
  const voiceDispositionRequired = Boolean(
    sip.awaitingDisposition &&
      sip.conversationId &&
      selected?.id === sip.conversationId &&
      isVoiceChannel(selected.channel),
  );

  useEffect(() => {
    if (!sip.awaitingDisposition || !sip.conversationId) {
      openedVoiceDispositionIdRef.current = null;
      return;
    }
    if (openedVoiceDispositionIdRef.current === sip.conversationId) return;
    const callConversation = conversations.find(
      (conversation) => conversation.id === sip.conversationId,
    );
    if (!callConversation) return;

    openedVoiceDispositionIdRef.current = sip.conversationId;
    setSelectedId(callConversation.id);
    persistWorkspaceSelection(callConversation.id);
    focusConversationTab(callConversation, setTabState);
    setDispositionDialogOpen(true);

    if (dispositionOptions.length === 0 && !dispositionOptionsLoading) {
      setDispositionOptionsLoading(true);
      void workspaceApi
        .listDispositions()
        .then(setDispositionOptions)
        .catch((error) => {
          setActionError(error instanceof Error ? error.message : "Failed to load dispositions");
        })
        .finally(() => setDispositionOptionsLoading(false));
    }
  }, [
    conversations,
    dispositionOptions.length,
    dispositionOptionsLoading,
    sip.awaitingDisposition,
    sip.conversationId,
  ]);
  const aiSuggestion = selected ? aiSuggestions[selected.id] ?? null : null;
  const selectedTransferBlocking = Boolean(
    selected &&
      isOutboundTransferBlocking(selected, readAuthFromStorage().userId),
  );

  const counts = useMemo(
    () => ({
      open: conversations.filter((item) => matchesTab(item, "open")).length,
      transferred: conversations.filter((item) => matchesTab(item, "transferred")).length,
      closed: conversations.filter(
        (item) =>
          !item.transferred &&
          item.status === "resolved" &&
          isAssignedToCurrentUser(item),
      ).length,
    }),
    [conversations],
  );

  function selectConversation(id: string) {
    if (webchatDispositionId && id !== webchatDispositionId) return;
    setActionError(null);
    setSelectedId(id);
    persistWorkspaceSelection(id);
    setFocusedMessageId(null);
    const conversation = conversationsRef.current.find((item) => item.id === id);
    if (conversation && conversation.messages.length === 0) {
      loadedConversationIdsRef.current.delete(id);
    }
    setConversations((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, unread: false, unreadCount: 0 } : item,
      ),
    );
    const customerMessages = conversation?.messages.filter((message) => message.role === "customer") ?? [];
    markCustomerMessagesRead(id, customerMessages);
  }

  function selectHistoryInteraction(conversationId: string, messageId: string) {
    void (async () => {
      setActionError(null);
      setFocusedMessageId(messageId);

      try {
        const loaded = await workspaceApi.getConversation(conversationId, true);
        const tab =
          loaded.status === "active" || loaded.status === "waiting"
            ? "open"
            : "closed";

        if (tab === "open" || tab === "closed") {
          setTabState(tab);
          persistWorkspaceTab(tab, true);
        }

        loadedConversationIdsRef.current.add(conversationId);
        setSelectedId(conversationId);
        persistWorkspaceSelection(conversationId);
        setConversations((prev) =>
          upsertConversation(prev, { ...loaded, unread: false, unreadCount: 0 }),
        );
      } catch (error) {
        setFocusedMessageId(null);
        setActionError(
          error instanceof Error ? error.message : "Failed to open previous interaction",
        );
      }
    })();
  }

  async function acceptOffer(conversationId?: string) {
    const id = conversationId ?? ringingOfferId ?? selectedId;
    if (!id || offerActionBusy) return;

    setOfferActionBusy(true);
    setActionError(null);
    try {
      const conversation = await workspaceApi.acceptOffer(id);
      setRingingOfferId(null);
      const merged: WorkspaceConversation = {
        ...conversation,
        status: "active",
        offerPending: false,
      };
      setConversations((prev) => upsertConversation(prev, merged));
      setSelectedId(id);
      setTabState("open");
      persistWorkspaceTab("open", false);
      void generateAiSuggestion(
        id,
        false,
        suggestionQueryText(merged),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to accept offer";
      const staleOffer =
        message.includes("expired") ||
        message.includes("already handled") ||
        message.includes("No pending offer");
      if (staleOffer) {
        setRingingOfferId((current) => (current === id ? null : current));
        setConversations((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, offerPending: false, status: "waiting" } : item,
          ),
        );
        void refreshConversations();
      }
      setActionError(message);
    } finally {
      setOfferActionBusy(false);
    }
  }

  async function rejectOffer(conversationId?: string) {
    const id = conversationId ?? ringingOfferId ?? selectedId;
    if (!id || offerActionBusy) return;

    setOfferActionBusy(true);
    setActionError(null);
    try {
      await workspaceApi.rejectOffer(id);
      setRingingOfferId((current) => (current === id ? null : current));
      setConversations((prev) => prev.filter((item) => item.id !== id));
      setSelectedId((current) => (current === id ? "" : current));
      void refreshConversations();
    } catch (error) {
      await workspaceApi
        .updatePresence("not_ready", "offer_rejected")
        .then((presence) => notifyPresenceUpdated(presence.state))
        .catch(() => undefined);
      setActionError(error instanceof Error ? error.message : "Failed to reject offer");
    } finally {
      setOfferActionBusy(false);
    }
  }

  async function sendReply() {
    const trimmed = draft.trim();
    if (
      !trimmed ||
      !selected ||
      sendingRef.current ||
      selected.offerPending ||
      selectedTransferBlocking
    ) return;

    const conversationId = selected.id;
    const copilotTurnId = draftCopilotTurnId;
    const optimisticId = `pending-${newId()}`;
    const optimisticMessage: WorkspaceMessage = {
      id: optimisticId,
      role: "agent",
      content: trimmed,
      sentAt: new Date().toISOString(),
      deliveryState: "pending",
      senderUserId: readAuthFromStorage().userId ?? null,
    };

    sendingRef.current = true;
    setReplySending(true);
    setActionError(null);
    setDraftValue("");
    setDraftCopilotTurnId(undefined);
    setAiSuggestions((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    typingConversationRef.current = null;
    void workspaceApi.updateTyping(conversationId, false).catch(() => undefined);
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              preview: trimmed,
              updatedAt: optimisticMessage.sentAt,
              messages: appendUniqueMessage(conversation.messages, optimisticMessage),
            }
          : conversation,
      ),
    );

    try {
      const sentMessage = await workspaceApi.sendReply(conversationId, trimmed, copilotTurnId);
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                preview: truncatePreview(plainTextMessageBody(sentMessage.content)),
                updatedAt: sentMessage.sentAt,
                messages: reconcileOutgoingAgentMessage(conversation.messages, sentMessage),
              }
            : conversation,
        ),
      );
      if (isEmailChannel(selected.channel)) {
        setDispositionDialogOpen(true);
        void loadDispositionOptions();
      }
    } catch (error) {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: conversation.messages.filter((message) => message.id !== optimisticId),
              }
            : conversation,
        ),
      );
      setDraftValue(trimmed);
      if (copilotTurnId) setDraftCopilotTurnId(copilotTurnId);
      setActionError(error instanceof Error ? error.message : "Failed to send reply");
    } finally {
      sendingRef.current = false;
      setReplySending(false);
    }
  }

  async function loadDispositionOptions() {
    if (dispositionOptions.length > 0 || dispositionOptionsLoading) return;
    setDispositionOptionsLoading(true);
    try {
      setDispositionOptions(await workspaceApi.listDispositions());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to load dispositions");
    } finally {
      setDispositionOptionsLoading(false);
    }
  }

  function openDispositionDialog() {
    if (
      selected &&
      selected.status !== "resolved" &&
      !selected.offerPending &&
      !selectedTransferBlocking
    ) {
      setDispositionDialogOpen(true);
      void loadDispositionOptions();
    }
  }

  async function resolveSelected(disposition: WorkspaceDisposition) {
    if (!selected || resolveLoading || resolveSubmissionRef.current) return;
    const resolvingConversation = selected;
    resolveSubmissionRef.current = true;

    try {
      setResolveLoading(true);
      setActionError(null);
      if (sip.awaitingTransferredDisposition) {
        const transferredDisposition = { ...disposition, resolution: "transferred" };
        let completedTransfer = resolvingConversation.transfer;
        if (sip.transferredDispositionCompletesTransfer) {
          completedTransfer = await workspaceApi.completeTransfer(
            resolvingConversation.id,
            transferredDisposition,
          );
        } else {
          await workspaceApi.saveDisposition(
            resolvingConversation.id,
            transferredDisposition,
            { source: "transfer", isFinal: false },
          );
        }
        const next = {
          ...resolvingConversation,
          transfer: completedTransfer,
          transferred: true,
          offerPending: false,
        };
        setConversations((prev) => upsertConversation(prev, next));
        focusConversationTab(next, setTabState);
        setSelectedId(next.id);
        setWebchatDispositionId(null);
        setDispositionDialogOpen(false);
        completeSipCallDisposition(resolvingConversation.id);
        publishVoiceWrapUpReady();
        return;
      }
      if (
        sip.awaitingMergeDisposition ||
        (resolvingConversation.consultParticipant &&
          isVoiceChannel(resolvingConversation.channel) &&
          resolvingConversation.transfer?.outcomeReason === "voice_consult_merged")
      ) {
        await workspaceApi.saveDisposition(resolvingConversation.id, disposition, {
          source: "merge",
          isFinal: false,
        });
        setWebchatDispositionId(null);
        setDispositionDialogOpen(false);
        completeSipCallDisposition(resolvingConversation.id);
        publishVoiceWrapUpReady();
        return;
      }
      const resolved = await workspaceApi.resolveConversation(
        resolvingConversation.id,
        disposition,
      );
      const transferredWrapUp = disposition.resolution === "transferred";
      const next = {
        ...resolved,
        status: "resolved" as const,
        transferred: transferredWrapUp || resolved.transferred,
        offerPending: false,
      };
      setConversations((prev) => upsertConversation(prev, next));
      focusConversationTab(next, setTabState);
      setSelectedId(resolved.id);
      setWebchatDispositionId(null);
      setDispositionDialogOpen(false);
      if (isVoiceChannel(resolvingConversation.channel)) {
        completeSipCallDisposition(resolved.id);
        publishVoiceWrapUpReady();
      } else {
        void syncPresenceFromServer();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to resolve conversation");
    } finally {
      resolveSubmissionRef.current = false;
      setResolveLoading(false);
    }
  }

  async function openTransferDialog() {
    if (
      !selected ||
      selected.status === "resolved" ||
      selected.offerPending ||
      (selectedTransferBlocking && !isVoiceChannel(selected.channel))
    ) return;
    if (isVoiceChannel(selected.channel)) {
      const sip = getSipCallStatus();
      if (sip.consultState !== "idle") {
        setActionError("A consult invite is already in progress");
        return;
      }
    }
    setTransferDialogOpen(true);
    setTransferOptionsLoading(true);
    setTransferAgents([]);
    setTransferTargetsError(null);
    setTransferTargetsNextCursor(undefined);
    setTransferTargetQuery({ queueId: "", search: "" });
    setActionError(null);
    try {
      const queueResult = await queuesApi.listQueues({
        page: 1,
        pageSize: 100,
        status: "active",
      });
      const activeQueues = queueResult.queues.filter((q) => q.status === "active");
      setTransferQueues(activeQueues);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to load transfer options");
    } finally {
      setTransferOptionsLoading(false);
    }
  }

  const loadTransferTargets = useCallback(
    async (queueId: string, targetSearch: string, cursor?: string) => {
      const conversationId = selectedIdRef.current;
      if (!conversationId || !queueId) return;
      const generation = ++transferTargetsGenerationRef.current;
      setTransferTargetsLoading(true);
      setTransferTargetsError(null);
      setTransferTargetQuery({ queueId, search: targetSearch });
      // Clear stale agents immediately so a previous queue cannot flash as empty/full.
      if (!cursor) setTransferAgents([]);
      try {
        const selectedConversation = conversationsRef.current.find((item) => item.id === conversationId);
        const result = await workspaceApi.listTransferTargets(conversationId, {
          queueId,
          search: targetSearch,
          cursor,
          voice: isVoiceChannel(selectedConversation?.channel ?? ""),
        });
        if (generation !== transferTargetsGenerationRef.current) return;
        setTransferAgents((current) => cursor ? [...current, ...result.agents] : result.agents);
        setTransferTargetsNextCursor(result.nextCursor);
      } catch (error) {
        if (generation !== transferTargetsGenerationRef.current) return;
        setTransferAgents((current) => cursor ? current : []);
        setTransferTargetsNextCursor(undefined);
        setTransferTargetsError(
          error instanceof Error ? error.message : "Failed to load eligible agents",
        );
      } finally {
        if (generation === transferTargetsGenerationRef.current) {
          setTransferTargetsLoading(false);
        }
      }
    },
    [],
  );

  async function transferSelected(input: WorkspaceTransferInput) {
    if (!selected || transferLoading) return;
    if (isVoiceChannel(selected.channel)) {
      try {
        setTransferLoading(true);
        setActionError(null);
        if (!(await holdCustomerForConsult())) {
          setActionError(getSipCallStatus().error || "Hold the customer call before inviting");
          return;
        }
        const selectedAgent = transferAgents.find((agent) => agent.agentId === input.agentId);
        const invited = await workspaceApi.inviteVoiceConsult(selected.id, {
          queueId: input.queueId,
          agentId: input.agentId,
          ext: selectedAgent?.ext ?? undefined,
        });
        const started = await inviteConsultTransfer({
          ext: invited.ext,
          sessionId: invited.sessionId || getSipCallStatus().acdSessionId || "",
          name: invited.target.name,
        });
        if (!started) {
          setActionError(getSipCallStatus().error || "Unable to invite the agent");
          void workspaceApi
            .voiceTransferAction(selected.id, TRANSFER_ACTION_TRANSFEROR_CANCEL)
            .catch(() => undefined);
          return;
        }
        setTransferDialogOpen(false);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Failed to invite agent");
      } finally {
        setTransferLoading(false);
      }
      return;
    }
    try {
      setTransferLoading(true);
      setActionError(null);
      const transferred = await workspaceApi.transferConversation(selected.id, input);
      const selectedAgent = transferAgents.find((agent) => agent.agentId === input.agentId);
      const selectedQueue = transferQueues.find((queue) => queue.id === input.queueId);
      const directEmailTransfer = isEmailChannel(selected.channel);
      setConversations((prev) =>
        upsertConversation(prev, {
          ...transferred,
          assignedUserId: selected.assignedUserId,
          status: directEmailTransfer ? transferred.status : "active",
          transfer: {
            ...transferred.transfer,
            state: directEmailTransfer
              ? "completed"
              : transferred.transfer?.state ?? "offered",
            fromUserId: readAuthFromStorage().userId,
            requestedAt: transferred.transfer?.requestedAt ?? new Date().toISOString(),
            completedAt: directEmailTransfer
              ? new Date().toISOString()
              : transferred.transfer?.completedAt ?? null,
            requestedAgentId: input.agentId,
            offeredAgentId: input.agentId,
            requestedAgentName: selectedAgent?.name,
            offeredAgentName: selectedAgent?.name,
            toQueueId: input.queueId,
            targetQueueName: selectedQueue?.name,
            notes: input.notes ?? null,
          },
          transferred: directEmailTransfer ? true : undefined,
          offerPending: false,
        }),
      );
      setTransferDialogOpen(false);
      setSelectedId(transferred.id);
      if (directEmailTransfer) {
        setTabState("transferred");
        persistWorkspaceTab("transferred", true);
        void syncPresenceFromServer();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to transfer conversation");
      if (transferTargetQuery.queueId) {
        void loadTransferTargets(transferTargetQuery.queueId, transferTargetQuery.search);
      }
    } finally {
      setTransferLoading(false);
    }
  }

  async function cancelSelectedTransfer() {
    if (!selected || transferCancelLoading || !isTransferPending(selected.transfer)) return;
    try {
      setTransferCancelLoading(true);
      setActionError(null);
      const restored = await workspaceApi.cancelTransfer(selected.id);
      handleTransferRestored(
        {
          ...restored,
          transfer: restored.transfer ?? {
            ...selected.transfer,
            state: "cancelled",
            cancelledAt: new Date().toISOString(),
          },
        },
        "cancelled",
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to cancel transfer");
      void refreshConversations();
    } finally {
      setTransferCancelLoading(false);
    }
  }

  async function submitTransferDisposition(details: WorkspaceDisposition) {
    if (!transferDispositionConversationId || transferDispositionLoading) return;
    try {
      setTransferDispositionLoading(true);
      setActionError(null);
      const completedTransfer = await workspaceApi.completeTransfer(
        transferDispositionConversationId,
        details,
      );
      const existing = conversationsRef.current.find(
        (conversation) => conversation.id === transferDispositionConversationId,
      );
      if (!existing) {
        throw new Error("Transferred conversation is no longer available");
      }
      const completed: WorkspaceConversation = {
        ...existing,
        transfer: completedTransfer,
        transferred: true,
        offerPending: false,
      };
      setConversations((prev) =>
        upsertConversation(prev, completed),
      );
      setTransferDispositionConversationId(null);
      setTabState("transferred");
      persistWorkspaceTab("transferred", true);
      setSelectedId(completed.id);
      void syncPresenceFromServer();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to save transfer disposition",
      );
    } finally {
      setTransferDispositionLoading(false);
    }
  }

  function setDraft(value: string) {
    setDraftValue(value);
    setDraftCopilotTurnId(undefined);
    if (
      !selected ||
      selected.offerPending ||
      selected.status === "resolved" ||
      selectedTransferBlocking
    ) return;
    const startedTyping = typingConversationRef.current !== selected.id;
    if (startedTyping) {
      if (typingConversationRef.current) {
        void workspaceApi.updateTyping(typingConversationRef.current, false).catch(() => undefined);
      }
      typingConversationRef.current = selected.id;
    }
    if (value.trim()) {
      if (startedTyping) {
        void workspaceApi.updateTyping(selected.id, true).catch(() => undefined);
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        void workspaceApi.updateTyping(selected.id, false).catch(() => undefined);
        typingConversationRef.current = null;
      }, 2_500);
    } else {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
      typingConversationRef.current = null;
      void workspaceApi.updateTyping(selected.id, false).catch(() => undefined);
    }
  }

  function useCopilotSuggestion(value: string, copilotTurnId?: string) {
    setDraftValue(value);
    setDraftCopilotTurnId(copilotTurnId && /^\d+$/.test(copilotTurnId) ? copilotTurnId : undefined);
  }

  function useInlineAiSuggestion() {
    if (!selected || !aiSuggestion?.text || aiSuggestion.status === "error") return;
    useCopilotSuggestion(plainTextFromAssistantHtml(aiSuggestion.text), aiSuggestion.copilotTurnId);
    dismissInlineAiSuggestion();
  }

  function dismissInlineAiSuggestion() {
    if (!selected) return;
    suggestionControllersRef.current.get(selected.id)?.abort();
    suggestionControllersRef.current.delete(selected.id);
    setAiSuggestions((current) => {
      const next = { ...current };
      delete next[selected.id];
      return next;
    });
  }

  function approveInlineAiAction() {
    if (!selected || !aiSuggestion?.actionProposal) return;
    const proposal = aiSuggestion.actionProposal;
    if (proposal.actionType === "create_booxoo_ticket") {
      const conversationId = selected.id;
      setActionError(null);
      setAiSuggestions((current) => {
        const existing = current[conversationId];
        if (!existing?.actionProposal) return current;
        return {
          ...current,
          [conversationId]: {
            ...existing,
            actionProposal: {
              ...existing.actionProposal,
              status: "submitted",
              resultText: "Creating the ticket…",
            },
          },
        };
      });
      void confirmBooxooTicket({
        conversationId,
        collectedInputs: proposal.collectedInputs,
      })
        .then((result) => {
          const ticketLabel = result.ticketNumber ? `Ticket ${result.ticketNumber}` : "Ticket";
          const resultText = result.ok
            ? `${ticketLabel} is ${result.status || "open"}.`
            : result.message || "The ticket was not created.";
          setAiSuggestions((current) => {
            const existing = current[conversationId];
            if (!existing?.actionProposal || existing.actionProposal.id !== proposal.id) return current;
            return {
              ...current,
              [conversationId]: {
                ...existing,
                actionProposal: {
                  ...existing.actionProposal,
                  status: result.ok ? "submitted" : "proposed",
                  resultText: result.ok ? resultText : undefined,
                },
              },
            };
          });
          if (!result.ok) setActionError(result.message || "The ticket was not created.");
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "The ticket was not created.";
          setAiSuggestions((current) => {
            const existing = current[conversationId];
            if (!existing?.actionProposal || existing.actionProposal.id !== proposal.id) return current;
            return {
              ...current,
              [conversationId]: {
                ...existing,
                actionProposal: {
                  ...existing.actionProposal,
                  status: "proposed",
                  resultText: undefined,
                },
              },
            };
          });
          setActionError(message);
        });
      return;
    }
    dispatchCoworkerRequest(
      [
        `Help me continue this proposed ${proposal.actionType} action for conversation ${selected.id}.`,
        proposal.summary,
        `Collected inputs: ${JSON.stringify(proposal.collectedInputs)}.`,
        proposal.missingInputs.length
          ? `Missing inputs: ${proposal.missingInputs.join(", ")}.`
          : "No missing inputs were identified.",
        "Re-verify the current data and use the normal preview and confirmation workflow before any mutation.",
      ].join("\n"),
    );
    setAiSuggestions((current) => {
      const existing = current[selected.id];
      if (!existing) return current;
      return {
        ...current,
        [selected.id]: {
          ...existing,
          actionProposal: {
            ...proposal,
            status: "submitted",
          },
        },
      };
    });
  }

  function declineInlineAiAction() {
    if (!selected || !aiSuggestion?.actionProposal) return;
    const proposal = aiSuggestion.actionProposal;
    setAiSuggestions((current) => {
      const existing = current[selected.id];
      if (!existing) return current;
      return {
        ...current,
        [selected.id]: {
          ...existing,
          actionProposal: {
            ...proposal,
            status: "dismissed",
          },
        },
      };
    });
  }

  function changeTab(nextTab: WorkspaceInboxTab) {
    if (webchatDispositionId) return;
    setActionError(null);
    persistWorkspaceTab(nextTab, true);
    setTabState(nextTab);
    const nextId = firstConversationIdForTab(conversations, nextTab);
    setSelectedId(nextId);
    persistWorkspaceSelection(nextId);
    setFocusedMessageId(null);
  }

  const selectedMessagePage = selectedId ? messagePages[selectedId] : undefined;

  return {
    conversations: filtered,
    allConversations: conversations,
    selected,
    selectedId,
    tab,
    search,
    draft,
    counts,
    focusedMessageId,
    offerActionBusy,
    replySending,
    resolveLoading,
    transferLoading,
    dispositionDialogOpen,
    dispositionDismissible: !voiceDispositionRequired && !webchatDispositionId,
    transferDialogOpen,
    transferDispositionConversationId,
    transferDispositionLoading,
    selectedTransferBlocking,
    transferCancelLoading,
    transferNotice,
    transferOptionsLoading,
    transferTargetsLoading,
    transferTargetsError,
    transferTargetsNextCursor,
    transferQueues,
    transferAgents,
    dispositionOptions,
    dispositionOptionsLoading,
    conversationLoadingId,
    detailsReady: Boolean(selectedId) && detailsReadyId === selectedId,
    messagesLoading: Boolean(selectedMessagePage?.loading),
    messagesLoadingMore: Boolean(selectedMessagePage?.loadingMore),
    hasMoreMessages: Boolean(selectedMessagePage?.hasMore),
    loading,
    loadingMore: loadingMoreInbox,
    inboxHasMore,
    loadError,
    actionError,
    dismissActionError: () => setActionError(null),
    aiSuggestion,
    setTab: changeTab,
    setSearch,
    setDraft,
    useCopilotSuggestion,
    useInlineAiSuggestion,
    dismissInlineAiSuggestion,
    approveInlineAiAction,
    declineInlineAiAction,
    selectConversation,
    selectHistoryInteraction,
    sendReply,
    acceptOffer,
    rejectOffer,
    openDispositionDialog,
    resolveSelected,
    voiceConsultInvite: Boolean(selected && isVoiceChannel(selected.channel)),
    voiceTransferWrapUp: Boolean(sip.awaitingTransferredDisposition),
    voiceMergeParticipantWrapUp: Boolean(
      sip.awaitingMergeDisposition ||
        (selected?.consultParticipant &&
          isVoiceChannel(selected.channel) &&
          selected.transfer?.outcomeReason === "voice_consult_merged"),
    ),
    openTransferDialog,
    transferSelected,
    loadTransferTargets,
    cancelSelectedTransfer,
    submitTransferDisposition,
    dismissTransferNotice: () => setTransferNotice(null),
    closeDispositionDialog: () => {
      if (!resolveLoading && !voiceDispositionRequired && !webchatDispositionId) {
        setDispositionDialogOpen(false);
      }
    },
    closeTransferDialog: () => {
      if (!transferLoading) setTransferDialogOpen(false);
    },
    closeTransferDispositionDialog: () => {
      if (!transferDispositionLoading) setTransferDispositionConversationId(null);
    },
    refreshConversations,
    loadMoreInbox,
    loadOlderMessages,
  };
}
