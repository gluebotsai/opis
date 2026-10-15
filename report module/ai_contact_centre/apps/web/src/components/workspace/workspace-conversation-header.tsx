import { ArrowRightLeft, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";

import { IconButton } from "@/components/ui/button";
import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import { SessionSentimentInline } from "@/components/workspace/sentiment-chip";
import { contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";
import type { WorkspaceConversation } from "@/features/workspace/types";
import {
  formatQueueLabel,
  isEmailChannel,
  isVoiceChannel,
  resolveWorkspaceConversationTitle,
  resolveWorkspaceEmailSubjectLine,
} from "@/features/workspace/workspace-utils";
import { WorkspaceVoiceCallTimer, WorkspaceVoiceWaveform } from "./workspace-voice-call-bar";

type WorkspaceConversationHeaderProps = {
  conversation: WorkspaceConversation;
  onResolve: () => void;
  onTransfer: () => void;
  resolveLoading?: boolean;
  transferLoading?: boolean;
  actionsDisabled?: boolean;
  onBack?: () => void;
  onCustomerInfo?: () => void;
  ongoingCount?: number;
  awaitingReplyCount?: number;
};

function MetaDot() {
  return <span className="text-neutral-300" aria-hidden="true">·</span>;
}

export function WorkspaceConversationHeader({
  conversation,
  onResolve,
  onTransfer,
  resolveLoading = false,
  transferLoading = false,
  actionsDisabled = false,
  onBack,
  onCustomerInfo,
  ongoingCount,
  awaitingReplyCount = 0,
}: WorkspaceConversationHeaderProps) {
  const isEmail = isEmailChannel(conversation.channel);
  const queueLabel = formatQueueLabel(conversation.queue);

  const title = resolveWorkspaceConversationTitle({
    customerName: conversation.customer.name,
    channel: conversation.channel,
    subject: conversation.subject,
  });
  const emailSubjectLine = isEmail
    ? resolveWorkspaceEmailSubjectLine(conversation.subject)
    : null;
  const showActions = conversation.status !== "resolved" && !conversation.offerPending;
  const showVoiceChrome = isVoiceChannel(conversation.channel);
  const showTransferAction = showActions && !showVoiceChrome;
  const showResolveAction = showActions && isEmail;
  const showEndAction = showActions && !isEmail && !showVoiceChrome;

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 px-3 py-2.5 xl:gap-3 xl:px-5 xl:py-3.5",
        contentPanelHeaderBorderClassName,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {onBack ? (
          <IconButton
            variant="ghostIcon"
            className="shrink-0"
            onClick={onBack}
            aria-label="Back to inbox"
          >
            <ChevronLeft />
          </IconButton>
        ) : null}
        <WorkspaceChannelIcon
          channel={conversation.channel}
          className="size-6 shrink-0 rounded-lg shadow-none"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <h2
              className={cn(
                "min-w-0 truncate capitalize text-[18px] font-semibold leading-6 text-neutral-900",
                showVoiceChrome ? "max-w-[14rem] shrink sm:max-w-[18rem]" : "flex-1",
              )}
            >
              {title}
            </h2>
            {showVoiceChrome ? <WorkspaceVoiceWaveform conversation={conversation} /> : null}
          </div>
        </div>
        {showActions || onCustomerInfo ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {showTransferAction || showResolveAction || showEndAction ? (
              <>
                {showTransferAction ? (
                <button
                  type="button"
                  onClick={onTransfer}
                  disabled={actionsDisabled || transferLoading || resolveLoading}
                  className="inline-flex h-[38px] items-center gap-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 active:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {transferLoading ? (
                    <LoaderCircle className="size-3 animate-spin text-neutral-900" />
                  ) : (
                    <ArrowRightLeft className="size-3 text-neutral-900" />
                  )}
                  <span className="hidden sm:inline">Transfer</span>
                </button>
                ) : null}
                {showResolveAction ? (
                  <button
                    type="button"
                    onClick={onResolve}
                    disabled={actionsDisabled || resolveLoading || transferLoading}
                    className="inline-flex h-[38px] items-center gap-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 active:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resolveLoading ? (
                      <LoaderCircle className="size-3 animate-spin text-neutral-900" />
                    ) : (
                      <CheckCircle2 className="size-3 text-neutral-900" />
                    )}
                    Resolve
                  </button>
                ) : null}
                {showEndAction ? (
                  <button
                    type="button"
                    onClick={onResolve}
                    disabled={actionsDisabled || resolveLoading || transferLoading}
                    className="inline-flex h-[38px] items-center gap-1 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white hover:bg-neutral-800 active:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resolveLoading ? (
                      <LoaderCircle className="size-3 animate-spin text-white" />
                    ) : (
                      <CheckCircle2 className="size-3 text-white" />
                    )}
                    End
                  </button>
                ) : null}
              </>
            ) : null}
            {onCustomerInfo ? (
              <IconButton
                variant="ghostIcon"
                className="shrink-0"
                onClick={onCustomerInfo}
                aria-label="Customer info"
                title="Customer info"
              >
                <ChevronRight />
              </IconButton>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-2 text-[14px] capitalize leading-5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f3f4f6] px-2 py-1">
            <span className="font-medium text-neutral-600">Queue</span>
            <span className="text-neutral-300" aria-hidden="true">
              ·
            </span>
            <span className="font-semibold text-[#171717]">{queueLabel}</span>
          </span>
          {conversation.sentiment ? (
            <SessionSentimentInline
              sentiment={conversation.sentiment}
              variant="header"
              pulseOnChange
              pulseResetKey={conversation.id}
            />
          ) : null}
          {ongoingCount != null && ongoingCount > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f3f4f6] px-2 py-1 normal-case">
              <span className="font-semibold tabular-nums text-[#171717]">{ongoingCount}</span>
              <span className="font-medium text-neutral-600">ongoing</span>
            </span>
          ) : null}
          {(awaitingReplyCount ?? 0) > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f3f4f6] px-2 py-1 normal-case">
              <span className="font-semibold tabular-nums text-[#171717]">{awaitingReplyCount}</span>
              <span className="font-medium text-neutral-600">to answer</span>
            </span>
          ) : null}
        </div>
        {showVoiceChrome ? <WorkspaceVoiceCallTimer conversation={conversation} /> : null}
      </div>

      {isEmail ? (
        <div className="flex min-w-0 items-center gap-x-2 overflow-x-auto text-xs text-neutral-600">
          {emailSubjectLine ? (
            <>
              <span className="max-w-full shrink-0 truncate text-neutral-600">{emailSubjectLine}</span>
              <MetaDot />
            </>
          ) : null}
          <span className="max-w-full shrink-0 truncate text-neutral-600">{conversation.customer.email}</span>
        </div>
      ) : null}
    </div>
  );
}
