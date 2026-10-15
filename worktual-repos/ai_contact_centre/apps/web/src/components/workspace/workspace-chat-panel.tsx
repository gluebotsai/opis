import type {
  WorkspaceAiSuggestion,
  WorkspaceConversation,
} from "@/features/workspace/types";
import { useEffect, useState } from "react";
import { LoaderCircle, PhoneCall, X, ChevronLeft } from "lucide-react";
import { isEmailChannel, isVoiceChannel } from "@/features/workspace/workspace-utils";
import { WorkspaceEmptyState } from "@/components/workspace/workspace-empty-state";
import { WorkspaceChatPanelSkeleton } from "@/components/workspace/workspace-side-skeletons";
import { IconButton } from "@/components/ui/button";
import { contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

import { WorkspaceConversationComposer } from "./workspace-conversation-composer";
import { WorkspaceConversationHeader } from "./workspace-conversation-header";
import {
  ConversationThreadSkeleton,
  WorkspaceChatView,
  WorkspaceEmailView,
} from "./workspace-conversation-views";

type WorkspaceChatPanelProps = {
  conversation: WorkspaceConversation | null;
  /** Inbox/bootstrap loading — show panel skeleton while nothing is selected. */
  loading?: boolean;
  draft: string;
  focusMessageId?: string | null;
  conversationLoading?: boolean;
  messagesLoading?: boolean;
  messagesLoadingMore?: boolean;
  hasMoreMessages?: boolean;
  replySending?: boolean;
  resolveLoading?: boolean;
  transferLoading?: boolean;
  transferBlocking?: boolean;
  transferCancelLoading?: boolean;
  transferNotice?: string | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onResolve: () => void;
  onTransfer: () => void;
  onCancelTransfer?: () => void;
  onDismissTransferNotice?: () => void;
  onLoadOlderMessages?: () => void;
  aiSuggestion?: WorkspaceAiSuggestion | null;
  onUseAiSuggestion?: () => void;
  onSendAiSuggestion?: () => void;
  onDismissAiSuggestion?: () => void;
  onApproveAiAction?: () => void;
  onDeclineAiAction?: () => void;
  onBack?: () => void;
  onCustomerInfo?: () => void;
  ongoingCount?: number;
  awaitingReplyCount?: number;
};

function formatElapsed(startedAt?: string | null): string {
  if (!startedAt) return "0:00";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function OutboundTransferStatus({
  conversation,
  cancelling,
  onCancel,
}: {
  conversation: WorkspaceConversation;
  cancelling: boolean;
  onCancel?: () => void;
}) {
  const [, setTick] = useState(0);
  const transfer = conversation.transfer;
  const accepted = transfer?.state === "accepted";
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const target =
    transfer?.offeredAgentName ??
    transfer?.requestedAgentName ??
    transfer?.targetAgentName ??
    (transfer?.offeredAgentId || transfer?.requestedAgentId
      ? `Agent ${transfer.offeredAgentId ?? transfer.requestedAgentId}`
      : "selected agent");
  const queue =
    transfer?.targetQueueName ??
    transfer?.toQueueName ??
    (transfer?.toQueueId ? `Queue ${transfer.toQueueId}` : conversation.queue);

  return (
    <div
      className="mx-4 mt-3 flex shrink-0 items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-950 sm:mx-5"
      aria-live="polite"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-100 text-blue-700">
        <PhoneCall className={accepted ? "size-4" : "size-4 animate-pulse"} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {accepted ? `Transfer accepted by ${target}` : `Calling ${target}…`}
        </p>
        <p className="truncate text-xs text-blue-700">
          {accepted
            ? `${queue} · ${formatElapsed(transfer?.acceptedAt ?? transfer?.requestedAt ?? transfer?.offeredAt)}`
            : `${queue} · Ringing · ${formatElapsed(transfer?.requestedAt ?? transfer?.offeredAt)}`}
        </p>
      </div>
      {!accepted && onCancel ? (
        <button
          type="button"
          disabled={cancelling}
          onClick={onCancel}
          className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-60"
        >
          {cancelling ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          Cancel
        </button>
      ) : null}
    </div>
  );
}

function ConversationThread({
  conversation,
  focusMessageId,
  messagesLoading,
  messagesLoadingMore,
  hasMoreMessages,
  onLoadOlderMessages,
}: {
  conversation: WorkspaceConversation;
  focusMessageId?: string | null;
  messagesLoading?: boolean;
  messagesLoadingMore?: boolean;
  hasMoreMessages?: boolean;
  onLoadOlderMessages?: () => void;
}) {
  if (isEmailChannel(conversation.channel)) {
    return (
      <WorkspaceEmailView
        conversation={conversation}
        focusMessageId={focusMessageId}
        messagesLoading={messagesLoading}
        messagesLoadingMore={messagesLoadingMore}
        hasMoreMessages={hasMoreMessages}
        onLoadOlderMessages={onLoadOlderMessages}
      />
    );
  }

  return (
    <WorkspaceChatView
      conversation={conversation}
      focusMessageId={focusMessageId}
      messagesLoading={messagesLoading}
      messagesLoadingMore={messagesLoadingMore}
      hasMoreMessages={hasMoreMessages}
      onLoadOlderMessages={onLoadOlderMessages}
    />
  );
}

export function WorkspaceChatPanel({
  conversation,
  loading = false,
  draft,
  focusMessageId,
  conversationLoading = false,
  messagesLoading = false,
  messagesLoadingMore = false,
  hasMoreMessages = false,
  replySending = false,
  resolveLoading = false,
  transferLoading = false,
  transferBlocking = false,
  transferCancelLoading = false,
  transferNotice = null,
  onDraftChange,
  onSend,
  onResolve,
  onTransfer,
  onCancelTransfer,
  onDismissTransferNotice,
  onLoadOlderMessages,
  aiSuggestion,
  onUseAiSuggestion,
  onSendAiSuggestion,
  onDismissAiSuggestion,
  onApproveAiAction,
  onDeclineAiAction,
  onBack,
  onCustomerInfo,
  ongoingCount,
  awaitingReplyCount,
}: WorkspaceChatPanelProps) {
  if (!conversation) {
    if (loading) {
      return <WorkspaceChatPanelSkeleton />;
    }
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        {onBack ? (
          <div className={cn("shrink-0 px-2 py-1.5", contentPanelHeaderBorderClassName)}>
            <IconButton variant="ghostIcon" onClick={onBack} aria-label="Back to inbox">
              <ChevronLeft />
            </IconButton>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <WorkspaceEmptyState
            variant="chat"
            title="Select a conversation"
            description="Choose a thread from the inbox to view messages and reply."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <WorkspaceConversationHeader
        conversation={conversation}
        onResolve={onResolve}
        onTransfer={onTransfer}
        resolveLoading={resolveLoading}
        transferLoading={transferLoading}
        actionsDisabled={transferBlocking}
        onBack={onBack}
        onCustomerInfo={onCustomerInfo}
        ongoingCount={ongoingCount}
        awaitingReplyCount={awaitingReplyCount}
      />
      {transferNotice ? (
        <div className="mx-4 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 sm:mx-5">
          <span>{transferNotice}</span>
          {onDismissTransferNotice ? (
            <button type="button" onClick={onDismissTransferNotice} aria-label="Dismiss transfer notice">
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      {transferBlocking ? (
        <OutboundTransferStatus
          conversation={conversation}
          cancelling={transferCancelLoading}
          onCancel={onCancelTransfer}
        />
      ) : null}
      {conversationLoading && conversation.messages.length === 0 ? (
        <ConversationThreadSkeleton isEmail={isEmailChannel(conversation.channel)} />
      ) : (
        <ConversationThread
          conversation={conversation}
          focusMessageId={focusMessageId}
          messagesLoading={messagesLoading && conversation.messages.length === 0}
          messagesLoadingMore={messagesLoadingMore}
          hasMoreMessages={hasMoreMessages}
          onLoadOlderMessages={onLoadOlderMessages}
        />
      )}
      {transferBlocking && !isVoiceChannel(conversation.channel) ? (
        <div className="shrink-0 border-t-[0.6px] border-[#bfbfbf] bg-neutral-50 px-5 py-4 text-center text-sm text-neutral-600">
          Messaging is paused while the transfer is in progress.
        </div>
      ) : (
        <WorkspaceConversationComposer
          conversation={conversation}
          draft={draft}
          aiSuggestion={aiSuggestion}
          replySending={replySending}
          onDraftChange={onDraftChange}
          onSend={onSend}
          onUseAiSuggestion={onUseAiSuggestion}
          onSendAiSuggestion={onSendAiSuggestion}
          onDismissAiSuggestion={onDismissAiSuggestion}
          onApproveAiAction={onApproveAiAction}
          onDeclineAiAction={onDeclineAiAction}
          onInviteTransfer={onTransfer}
        />
      )}
    </div>
  );
}
