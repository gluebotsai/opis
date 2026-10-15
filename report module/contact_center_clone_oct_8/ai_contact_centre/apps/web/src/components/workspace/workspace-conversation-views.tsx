import {
  useCallback,
  useEffect,
  useRef,
  useState,
  Fragment,
  type ReactNode,
  type UIEvent,
} from "react";

import { AssistantMessageContent } from "@/components/assistant/assistant-message-content";
import { PanelLoader } from "@/components/ui/panel-loader";
import { messageBubbleClassName, THREAD_SYSTEM_LINE } from "@/components/ui/message-bubble-styles";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import {
  hasConversationOutcomeDetails,
  WorkspaceConversationOutcome,
} from "@/components/workspace/workspace-conversation-outcome";
import {
  didAppendLatestMessage,
  isConversationNearBottom,
} from "@/features/workspace/conversation-auto-scroll";
import { findLiveAgentHandoffMessageId } from "@/features/workspace/live-agent-handoff";
import type {
  WorkspaceConversation,
  WorkspaceMessage,
} from "@/features/workspace/types";
import { formatEmailBody, formatDeliveryStateLabel, isVoiceChannel } from "@/features/workspace/workspace-utils";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";

type ConversationViewProps = {
  conversation: WorkspaceConversation;
  focusMessageId?: string | null;
  messagesLoading?: boolean;
  messagesLoadingMore?: boolean;
  hasMoreMessages?: boolean;
  onLoadOlderMessages?: () => void;
};

/** Workspace keeps the agent desk sides. Monitoring puts every non-customer turn on the right. */
type ThreadSpeakerLayout = "workspace" | "monitor";

function formatMessageTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function MessageDeliveryMeta({
  sentAt,
  isOutgoing,
  deliveryState,
  inverted = false,
}: {
  sentAt: string;
  isOutgoing: boolean;
  deliveryState?: WorkspaceMessage["deliveryState"];
  inverted?: boolean;
}) {
  const deliveryLabel = isOutgoing ? formatDeliveryStateLabel(deliveryState) : null;
  return (
    <p
      className={cn(
        "m-0 text-right text-[12px] leading-4",
        deliveryState === "failed"
          ? "text-red-400"
          : inverted
            ? "text-white/70"
            : "text-neutral-400",
      )}
    >
      {formatMessageTime(sentAt)}
      {deliveryLabel ? ` · ${deliveryLabel}` : ""}
    </p>
  );
}

function MessageAttachments({
  attachments,
  inverted = false,
}: {
  attachments?: WorkspaceMessage["attachments"];
  inverted?: boolean;
}) {
  if (!attachments?.length) return null;
  return (
    <>
      {attachments.map((attachment) => {
        const label = `${attachment.fileName} · ${Math.max(1, Math.ceil(attachment.byteSize / 1024))} KB`;
        return attachment.downloadUrl &&
          /^https?:\/\//i.test(attachment.downloadUrl) &&
          attachment.status === "available" ? (
          <a
            key={attachment.id}
            href={attachment.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium",
              inverted
                ? "border-neutral-400/40 bg-white/10 text-neutral-100 hover:bg-white/15"
                : "border-neutral-200 bg-white/70 text-neutral-700 hover:bg-white",
            )}
          >
            <FileText className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </a>
        ) : (
          <div
            key={attachment.id}
            title={`Attachment ${attachment.status}`}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs",
              inverted
                ? "border-neutral-400/30 bg-white/5 text-neutral-300"
                : "border-neutral-200 bg-white/50 text-neutral-600",
            )}
          >
            <FileText className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </div>
        );
      })}
    </>
  );
}

function liveAgentHandoffId(conversation: WorkspaceConversation): string | null {
  return findLiveAgentHandoffMessageId(
    conversation.messages,
    isVoiceChannel(conversation.channel) ? conversation.assignedAt : null,
  );
}

function LiveAgentConnectedDivider({
  scrollRef,
}: {
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={scrollRef}
      className="scroll-mt-4 flex items-center gap-3 py-1"
      role="separator"
      aria-label="Live agent connected"
    >
      <div className="h-px flex-1 bg-neutral-200" />
      <span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-600">
        Live agent connected
      </span>
      <div className="h-px flex-1 bg-neutral-200" />
    </div>
  );
}

function messageSpeaker(
  message: WorkspaceMessage,
  conversation: WorkspaceConversation,
  currentUserId: string | undefined,
  layout: ThreadSpeakerLayout = "workspace",
): { outgoing: boolean; name: string; key: string } {
  if (layout === "monitor") {
    if (message.role === "customer") {
      const name = conversation.customer.name.trim() || "Customer";
      return { outgoing: false, name, key: "customer" };
    }
    if (message.role === "bot") {
      return { outgoing: true, name: "Assistant", key: "bot" };
    }
    if (message.role === "agent") {
      const name = message.senderName?.trim() || "Agent";
      return {
        outgoing: true,
        name,
        key: `agent:${message.senderUserId || name}`,
      };
    }
    return { outgoing: false, name: "", key: message.role };
  }
  if (message.role === "customer") {
    const name = conversation.customer.name.trim() || "Customer";
    return { outgoing: false, name, key: "customer" };
  }
  if (message.role === "bot") {
    return { outgoing: false, name: "Assistant", key: "bot" };
  }
  if (message.role === "agent") {
    const mine = Boolean(currentUserId && message.senderUserId && message.senderUserId === currentUserId);
    return {
      outgoing: mine,
      name: mine ? "" : message.senderName?.trim() || "Agent",
      key: mine ? `me:${currentUserId}` : `agent:${message.senderUserId || message.senderName || "unknown"}`,
    };
  }
  return { outgoing: false, name: "", key: message.role };
}

function ChatMessageBubble({
  content,
  sentAt,
  isOutgoing,
  speakerName,
  deliveryState,
  attachments,
}: {
  content: string;
  sentAt: string;
  isOutgoing: boolean;
  speakerName?: string;
  deliveryState?: WorkspaceMessage["deliveryState"];
  attachments?: WorkspaceMessage["attachments"];
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        messageBubbleClassName({ outgoing: isOutgoing }),
      )}
    >
      {speakerName ? (
        <p className={cn("text-[14px] font-semibold", isOutgoing ? "text-white/80" : "text-neutral-700")}>
          {speakerName}
        </p>
      ) : null}
      <AssistantMessageContent
        content={/<\s*\w+/i.test(content) ? content : formatEmailBody(content)}
        inverted={isOutgoing}
      />
      {attachments?.length ? (
        <div className="space-y-2">
          <MessageAttachments attachments={attachments} inverted={isOutgoing} />
        </div>
      ) : null}
      <MessageDeliveryMeta
        sentAt={sentAt}
        isOutgoing={isOutgoing}
        deliveryState={deliveryState}
        inverted={isOutgoing}
      />
    </div>
  );
}


function useSmartConversationScroll({
  conversationId,
  messageCount,
  latestMessageId,
  focusMessageId,
  messagesLoading = false,
  messagesLoadingMore = false,
  liveAgentHandoffMessageId,
}: {
  conversationId: string;
  messageCount: number;
  latestMessageId?: string;
  focusMessageId?: string | null;
  messagesLoading?: boolean;
  messagesLoadingMore?: boolean;
  liveAgentHandoffMessageId: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const handoffScrollRef = useRef<HTMLDivElement>(null);
  const openedConversationRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(messageCount);
  const previousLatestMessageIdRef = useRef(latestMessageId);
  const pinnedRef = useRef(true);
  const [hasNewMessage, setHasNewMessage] = useState(false);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    pinnedRef.current = true;
    setHasNewMessage(false);
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    function updatePinnedState() {
      const node = scrollRef.current;
      if (!node) return;
      pinnedRef.current = isConversationNearBottom(
        node.scrollHeight,
        node.scrollTop,
        node.clientHeight,
      );
      if (pinnedRef.current) setHasNewMessage(false);
    }

    function keepLatestVisible() {
      if (pinnedRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      }
    }

    element.addEventListener("scroll", updatePinnedState, { passive: true });
    const observer = new ResizeObserver(keepLatestVisible);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    updatePinnedState();

    return () => {
      element.removeEventListener("scroll", updatePinnedState);
      observer.disconnect();
    };
  }, [conversationId]);

  useEffect(() => {
    if (focusMessageId || messagesLoading) return;

    const isInitialOpen = openedConversationRef.current !== conversationId;
    const messageAdded = didAppendLatestMessage(
      previousMessageCountRef.current,
      messageCount,
      previousLatestMessageIdRef.current,
      latestMessageId,
    );
    previousMessageCountRef.current = messageCount;
    previousLatestMessageIdRef.current = latestMessageId;
    if (isInitialOpen) {
      openedConversationRef.current = conversationId;
      pinnedRef.current = true;
      setHasNewMessage(false);

      if (liveAgentHandoffMessageId) {
        pinnedRef.current = false;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            handoffScrollRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
          });
        });
        return;
      }
      scrollToLatest("auto");
      return;
    }

    if (messagesLoadingMore) return;
    if (!messageAdded) return;
    if (pinnedRef.current) {
      scrollToLatest("smooth");
    } else {
      setHasNewMessage(true);
    }
  }, [
    conversationId,
    messageCount,
    latestMessageId,
    focusMessageId,
    messagesLoading,
    messagesLoadingMore,
    liveAgentHandoffMessageId,
    handoffScrollRef,
    scrollToLatest,
  ]);

  return {
    bottomRef,
    handoffScrollRef,
    hasNewMessage,
    scrollRef,
    scrollToLatest,
  };
}

function NewMessageButton({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-4 left-1/2 z-20 inline-flex h-[38px] -translate-x-1/2 items-center rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-4 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
    >
      New message
    </button>
  );
}

function MessageScrollTarget({
  messageId,
  focusMessageId,
  className,
  children,
}: {
  messageId: string;
  focusMessageId?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusMessageId !== messageId) return;
    const frame = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusMessageId, messageId]);

  return (
    <div ref={ref} className={cn("scroll-mt-4", className)}>
      {children}
    </div>
  );
}

function useLoadOlderOnScroll(
  hasMore: boolean,
  loadingMore: boolean,
  onLoadOlder?: () => void,
) {
  const loadingRef = useRef(false);

  useEffect(() => {
    loadingRef.current = loadingMore;
  }, [loadingMore]);

  return useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!hasMore || loadingRef.current || !onLoadOlder) return;
      const target = event.currentTarget;
      if (target.scrollTop <= 72) {
        onLoadOlder();
      }
    },
    [hasMore, onLoadOlder],
  );
}

function EmailMessageBubble({
  message,
  conversation,
  isFirstInThread,
}: {
  message: WorkspaceMessage;
  conversation: WorkspaceConversation;
  isFirstInThread: boolean;
}) {
  const isOutgoing = message.role === "agent" || message.role === "bot";
  const subjectLine = isFirstInThread ? conversation.subject : `Re: ${conversation.subject}`;
  const customerEmail = conversation.customer.email.trim();
  const mailboxEmail = conversation.mailboxEmail?.trim() ?? "";
  const fromAddress = isOutgoing
    ? mailboxEmail || "Support mailbox"
    : customerEmail || conversation.customer.name;
  const toAddress = isOutgoing
    ? customerEmail || conversation.customer.name
    : mailboxEmail || "Support mailbox";

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        messageBubbleClassName({ outgoing: isOutgoing }),
      )}
    >
      <div
        className={cn(
          "space-y-1 border-b pb-2 text-[13px] leading-snug",
          isOutgoing ? "border-neutral-400/50" : "border-neutral-300/50",
        )}
      >
        <p className={cn("m-0 truncate", isOutgoing ? "text-neutral-200" : "text-neutral-700")}>
          <span className="font-semibold text-neutral-600">From:</span> {fromAddress}
        </p>
        <p className={cn("m-0 truncate", isOutgoing ? "text-neutral-200" : "text-neutral-700")}>
          <span className="font-semibold text-neutral-600">To:</span> {toAddress}
        </p>
        <p className={cn("m-0", isOutgoing ? "text-neutral-100" : "text-neutral-800")}>
          <span className="font-semibold text-neutral-600">Subject:</span>{" "}
          <span className="font-semibold text-neutral-400">{subjectLine}</span>
        </p>
      </div>
      <AssistantMessageContent
        content={
          /<\s*\w+/i.test(message.content)
            ? message.content
            : formatEmailBody(message.content)
        }
        inverted={isOutgoing}
      />
      {message.attachments?.length ? (
        <div className="space-y-2">
          <MessageAttachments attachments={message.attachments} inverted={isOutgoing} />
        </div>
      ) : null}
      <MessageDeliveryMeta
        sentAt={message.sentAt}
        isOutgoing={isOutgoing}
        deliveryState={message.deliveryState}
        inverted={isOutgoing}
      />
    </div>
  );
}

function EmptyConversationThread() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center">
      <p className="text-sm text-neutral-600">No conversation found</p>
    </div>
  );
}

function ConversationOutcomeSection({
  conversation,
}: {
  conversation: WorkspaceConversation;
}) {
  if (!hasConversationOutcomeDetails(conversation)) return null;

  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white">
      <h3 className="border-b-[0.6px] border-[#bfbfbf] px-4 py-3 text-xs font-semibold text-neutral-900">
        Outcome
      </h3>
      <div className="px-4 py-3">
        <WorkspaceConversationOutcome conversation={conversation} />
      </div>
    </section>
  );
}

export function ConversationThreadSkeleton({ isEmail = false }: { isEmail?: boolean }) {
  return (
    <PanelScrollArea className="min-h-0 flex-1 px-5 py-5">
      <div className="animate-pulse space-y-6">
        <div className="flex w-full justify-start">
          <div
            className={cn(
              "w-full space-y-3 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 p-4",
              isEmail ? "max-w-2xl" : "max-w-md",
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-7 rounded-full bg-neutral-200" />
                <div className="h-3.5 w-32 rounded bg-neutral-200" />
              </div>
              <div className="h-3 w-16 rounded bg-neutral-200" />
            </div>
            {isEmail ? <div className="h-4 w-3/4 rounded bg-neutral-200" /> : null}
            <div className="space-y-2 pt-1">
              <div className="h-3 w-full rounded bg-neutral-200" />
              <div className="h-3 w-5/6 rounded bg-neutral-200" />
              <div className="h-3 w-4/6 rounded bg-neutral-200" />
            </div>
          </div>
        </div>

        <div className="flex w-full justify-end">
          <div
            className={cn(
              "w-full space-y-3 rounded-2xl bg-neutral-100 p-4",
              isEmail ? "max-w-xl" : "max-w-sm",
            )}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="h-3.5 w-24 rounded bg-neutral-200" />
              <div className="h-3 w-12 rounded bg-neutral-200" />
            </div>
            <div className="space-y-2 pt-1">
              <div className="h-3 w-full rounded bg-neutral-200" />
              <div className="h-3 w-2/3 rounded bg-neutral-200" />
            </div>
          </div>
        </div>

        <div className="flex w-full justify-start">
          <div
            className={cn(
              "w-full space-y-2 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 p-4",
              isEmail ? "max-w-xl" : "max-w-xs",
            )}
          >
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-full bg-neutral-200" />
              <div className="h-3.5 w-28 rounded bg-neutral-200" />
            </div>
            <div className="h-3 w-5/6 rounded bg-neutral-200" />
          </div>
        </div>
      </div>
    </PanelScrollArea>
  );
}

export function WorkspaceChatView({
  conversation,
  focusMessageId,
  messagesLoading = false,
  messagesLoadingMore = false,
  hasMoreMessages = false,
  onLoadOlderMessages,
  speakerLayout = "workspace",
}: ConversationViewProps & { speakerLayout?: ThreadSpeakerLayout }) {
  const handleScroll = useLoadOlderOnScroll(
    hasMoreMessages,
    messagesLoadingMore,
    onLoadOlderMessages,
  );
  const { user } = useAuth();
  const liveAgentHandoffMessageId = liveAgentHandoffId(conversation);
  const {
    bottomRef,
    handoffScrollRef,
    hasNewMessage,
    scrollRef,
    scrollToLatest,
  } = useSmartConversationScroll({
    conversationId: conversation.id,
    messageCount: conversation.messages.length,
    latestMessageId: conversation.messages.at(-1)?.id,
    focusMessageId,
    messagesLoading,
    messagesLoadingMore,
    liveAgentHandoffMessageId,
  });

  if (messagesLoading && conversation.messages.length === 0) {
    return <ConversationThreadSkeleton isEmail={false} />;
  }

  const threadEmpty = conversation.messages.length === 0;

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      <PanelScrollArea
        ref={scrollRef}
        className={cn("min-h-0 flex-1 px-5 py-5", threadEmpty && "flex flex-col")}
        onScroll={handleScroll}
      >
      {threadEmpty ? (
        <>
          <EmptyConversationThread />
          <ConversationOutcomeSection conversation={conversation} />
          <div ref={bottomRef} />
        </>
      ) : (
      <div className="space-y-6">
        {messagesLoadingMore ? (
          <PanelLoader inline label="Loading earlier messages…" />
        ) : null}
        {conversation.messages.map((message) => {
          if (message.role === "system") {
            return (
              <MessageScrollTarget
                key={message.id}
                messageId={message.id}
                focusMessageId={focusMessageId}
                className="flex justify-center py-1"
              >
                <p className={THREAD_SYSTEM_LINE}>{message.content}</p>
              </MessageScrollTarget>
            );
          }

          const speaker = messageSpeaker(message, conversation, user?.id, speakerLayout);
          const showLiveAgentDivider = message.id === liveAgentHandoffMessageId;

          return (
            <Fragment key={message.id}>
              {showLiveAgentDivider ? (
                <LiveAgentConnectedDivider scrollRef={handoffScrollRef} />
              ) : null}
              <MessageScrollTarget
                messageId={message.id}
                focusMessageId={focusMessageId}
                className={cn("flex w-full", speaker.outgoing ? "justify-end" : "justify-start")}
              >
                <ChatMessageBubble
                  content={message.content}
                  sentAt={message.sentAt}
                  isOutgoing={speaker.outgoing}
                  speakerName={speaker.name || undefined}
                  deliveryState={message.deliveryState}
                  attachments={message.attachments}
                />
              </MessageScrollTarget>
            </Fragment>
          );
        })}
        {conversation.visitorTyping ? (
          <p className={cn("pl-1", THREAD_SYSTEM_LINE)}>
            {conversation.customer.name} is typing…
          </p>
        ) : null}
        <ConversationOutcomeSection conversation={conversation} />
        <div ref={bottomRef} />
      </div>
      )}
      </PanelScrollArea>
      <NewMessageButton
        visible={hasNewMessage}
        onClick={() => scrollToLatest("smooth")}
      />
    </div>
  );
}

export function WorkspaceEmailView({
  conversation,
  focusMessageId,
  messagesLoading = false,
  messagesLoadingMore = false,
  hasMoreMessages = false,
  onLoadOlderMessages,
}: ConversationViewProps) {
  const handleScroll = useLoadOlderOnScroll(
    hasMoreMessages,
    messagesLoadingMore,
    onLoadOlderMessages,
  );
  const liveAgentHandoffMessageId = liveAgentHandoffId(conversation);
  const {
    bottomRef,
    handoffScrollRef,
    hasNewMessage,
    scrollRef,
    scrollToLatest,
  } = useSmartConversationScroll({
    conversationId: conversation.id,
    messageCount: conversation.messages.length,
    latestMessageId: conversation.messages.at(-1)?.id,
    focusMessageId,
    messagesLoading,
    messagesLoadingMore,
    liveAgentHandoffMessageId,
  });

  if (messagesLoading && conversation.messages.length === 0) {
    return <ConversationThreadSkeleton isEmail />;
  }

  const threadMessages = conversation.messages.filter((message) => message.role !== "system");
  const threadEmpty = threadMessages.length === 0;

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      <PanelScrollArea
        ref={scrollRef}
        className={cn("min-h-0 flex-1 px-5 py-5", threadEmpty && "flex flex-col")}
        onScroll={handleScroll}
      >
      {threadEmpty ? (
        <>
          <EmptyConversationThread />
          <ConversationOutcomeSection conversation={conversation} />
          <div ref={bottomRef} />
        </>
      ) : (
      <div className="space-y-6">
        {messagesLoadingMore ? (
          <PanelLoader inline label="Loading earlier messages…" />
        ) : null}
        {threadMessages.map((message, index) => {
            const isOutgoing = message.role === "agent" || message.role === "bot";
            const showLiveAgentDivider = message.id === liveAgentHandoffMessageId;

            return (
              <Fragment key={message.id}>
                {showLiveAgentDivider ? (
                  <LiveAgentConnectedDivider scrollRef={handoffScrollRef} />
                ) : null}
                <MessageScrollTarget
                  messageId={message.id}
                  focusMessageId={focusMessageId}
                  className={cn("flex w-full", isOutgoing ? "justify-end" : "justify-start")}
                >
                  <EmailMessageBubble
                    message={message}
                    conversation={conversation}
                    isFirstInThread={index === 0}
                  />
                </MessageScrollTarget>
              </Fragment>
            );
          })}
        <ConversationOutcomeSection conversation={conversation} />
        <div ref={bottomRef} />
      </div>
      )}
      </PanelScrollArea>
      <NewMessageButton
        visible={hasNewMessage}
        onClick={() => scrollToLatest("smooth")}
      />
    </div>
  );
}
