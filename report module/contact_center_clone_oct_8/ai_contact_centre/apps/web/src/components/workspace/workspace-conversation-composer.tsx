import { ArrowUp, LoaderCircle, Paperclip, X } from "lucide-react";
import { useRef } from "react";

import type {
  WorkspaceAiSuggestion,
  WorkspaceConversation,
} from "@/features/workspace/types";
import { isEmailChannel, incomingOfferComposerHint, isVoiceChannel } from "@/features/workspace/workspace-utils";
import { AssistantMessageContent } from "@/components/assistant/assistant-message-content";
import { WorkspaceVoiceCallControls } from "./workspace-voice-call-bar";
import { buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type WorkspaceConversationComposerProps = {
  conversation: WorkspaceConversation;
  draft: string;
  aiSuggestion?: WorkspaceAiSuggestion | null;
  replySending?: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onUseAiSuggestion?: () => void;
  onDismissAiSuggestion?: () => void;
  onApproveAiAction?: () => void;
  onDeclineAiAction?: () => void;
  onInviteTransfer?: () => void;
};

function SuggestedReplyCard({
  aiSuggestion,
  showUseReply,
  onUseAiSuggestion,
  onDismissAiSuggestion,
  onApproveAiAction,
  onDeclineAiAction,
  onUseReplyFocus,
}: {
  aiSuggestion: WorkspaceAiSuggestion;
  showUseReply: boolean;
  onUseAiSuggestion?: () => void;
  onDismissAiSuggestion?: () => void;
  onApproveAiAction?: () => void;
  onDeclineAiAction?: () => void;
  onUseReplyFocus?: () => void;
}) {
  return (
    <div className="mb-3 rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3.5 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-neutral-600">
        {aiSuggestion.status === "loading" ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : null}
        Suggested reply
        {onDismissAiSuggestion ? (
          <button
            type="button"
            onClick={onDismissAiSuggestion}
            aria-label="Dismiss suggested reply"
            className="ml-auto text-neutral-400 hover:text-neutral-700"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="mt-2 max-h-40 overflow-y-auto overscroll-contain pr-1 text-sm leading-relaxed text-neutral-700">
        {aiSuggestion.text ? (
          <AssistantMessageContent content={aiSuggestion.text} />
        ) : (
          <p>Drafting a response…</p>
        )}
      </div>
      {showUseReply && aiSuggestion.text && onUseAiSuggestion ? (
        <button
          type="button"
          onClick={() => {
            onUseAiSuggestion();
            onUseReplyFocus?.();
          }}
          className="mt-2.5 inline-flex h-[38px] items-center rounded-lg bg-neutral-900 px-3.5 text-xs font-semibold text-white hover:bg-neutral-800"
        >
          Use reply
        </button>
      ) : null}
      {aiSuggestion.actionProposal &&
      aiSuggestion.actionProposal.status !== "dismissed" ? (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
            Proposed action
          </p>
          {aiSuggestion.actionProposal.actionType === "create_booxoo_ticket" &&
          aiSuggestion.actionProposal.confirmationText ? (
            <p className="mt-1 text-xs font-medium text-blue-950">
              {aiSuggestion.actionProposal.confirmationText}
            </p>
          ) : null}
          <p className="mt-1 text-xs font-medium text-blue-950">
            {aiSuggestion.actionProposal.summary ||
              aiSuggestion.actionProposal.actionType}
          </p>
          {aiSuggestion.actionProposal.missingInputs.length ? (
            <p className="mt-1 text-xs text-blue-800">
              Still needed: {aiSuggestion.actionProposal.missingInputs.join(", ")}
            </p>
          ) : null}
          {aiSuggestion.actionProposal.status === "proposed" ? (
            <div className="mt-2 flex gap-2">
              {onApproveAiAction ? (
                <button
                  type="button"
                  onClick={onApproveAiAction}
                  className="inline-flex h-7 items-center rounded-md bg-blue-700 px-2.5 text-[11px] font-semibold text-white hover:bg-blue-800"
                >
                  {aiSuggestion.actionProposal.actionType === "create_booxoo_ticket"
                    ? "Create ticket"
                    : "Approve in coworker chat"}
                </button>
              ) : null}
              {onDeclineAiAction ? (
                <button
                  type="button"
                  onClick={onDeclineAiAction}
                  className="inline-flex h-7 items-center rounded-md border border-blue-200 bg-white px-2.5 text-[11px] font-semibold text-blue-800 hover:bg-blue-100"
                >
                  Decline
                </button>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-[11px] font-medium text-blue-700">
              {aiSuggestion.actionProposal.resultText ||
                "Sent to coworker chat for verification."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceConversationComposer({
  conversation,
  draft,
  aiSuggestion,
  replySending = false,
  onDraftChange,
  onSend,
  onUseAiSuggestion,
  onDismissAiSuggestion,
  onApproveAiAction,
  onDeclineAiAction,
  onInviteTransfer,
}: WorkspaceConversationComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isEmail = isEmailChannel(conversation.channel);
  const firstName = conversation.customer.name.split(" ")[0];
  const canSend = Boolean(draft.trim());
  const showSuggestion =
    Boolean(aiSuggestion) &&
    aiSuggestion?.status !== "error" &&
    Boolean(aiSuggestion?.text || aiSuggestion?.actionProposal) &&
    (
      isVoiceChannel(conversation.channel) ||
      !draft.trim() ||
      Boolean(aiSuggestion?.actionProposal)
    );
  const showingReplyDraft = Boolean(showSuggestion && aiSuggestion?.text && !isVoiceChannel(conversation.channel));

  if (conversation.status === "resolved") {
    return (
      <div className="shrink-0 border-t-[0.6px] border-[#bfbfbf] px-4 py-3 text-center text-sm text-neutral-600">
        This conversation is closed.
      </div>
    );
  }

  if (conversation.offerPending) {
    return (
      <div className="shrink-0 border-t-[0.6px] border-[#bfbfbf] px-4 py-3 text-center text-sm text-neutral-600">
        {incomingOfferComposerHint(conversation.channel)}
      </div>
    );
  }

  if (isVoiceChannel(conversation.channel)) {
    return (
      <div className="shrink-0 border-t-[0.6px] border-[#bfbfbf] bg-white px-4 py-3 sm:px-5">
        {showSuggestion && aiSuggestion ? (
          <SuggestedReplyCard
            aiSuggestion={aiSuggestion}
            showUseReply={false}
            onDismissAiSuggestion={onDismissAiSuggestion}
            onApproveAiAction={onApproveAiAction}
            onDeclineAiAction={onDeclineAiAction}
          />
        ) : null}
        <div className="shrink-0 bg-white">
          <WorkspaceVoiceCallControls
            conversation={conversation}
            onInviteTransfer={onInviteTransfer}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t-[0.6px] border-[#bfbfbf] bg-white px-4 py-3 sm:px-5">
      {isEmail ? (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          <span className="min-w-0 truncate">
            <span className="font-medium text-neutral-400">Subject</span>{" "}
            <span className="font-medium text-neutral-800">Re: {conversation.subject}</span>
          </span>
        </div>
      ) : null}

      {showSuggestion && aiSuggestion ? (
        <SuggestedReplyCard
          aiSuggestion={aiSuggestion}
          showUseReply
          onUseAiSuggestion={onUseAiSuggestion}
          onDismissAiSuggestion={onDismissAiSuggestion}
          onApproveAiAction={onApproveAiAction}
          onDeclineAiAction={onDeclineAiAction}
          onUseReplyFocus={() => {
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />
      ) : null}

      {showingReplyDraft ? null : (
        <form
          className="space-y-0"
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <div
            className={cn(
              "relative flex items-end rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 p-1.5 transition",
              "focus-within:border-neutral-300 focus-within:bg-white focus-within:shadow-sm focus-within:ring-2 focus-within:ring-neutral-200/70",
            )}
          >
            <button
              type="button"
              disabled
              title="File uploads are not configured yet"
              aria-label="Attach file (uploads not configured)"
              className="mb-0.5 inline-flex size-9 shrink-0 cursor-not-allowed items-center justify-center rounded-xl text-neutral-300"
            >
              <Paperclip className="size-4" aria-hidden />
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !isEmail) {
                  event.preventDefault();
                  onSend();
                }
              }}
              rows={isEmail ? 5 : 2}
              placeholder={isEmail ? "Write your reply…" : `Reply to ${firstName}…`}
              className="max-h-40 min-h-10 min-w-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-600"
            />
            <button
              type="submit"
              disabled={!canSend || replySending}
              aria-label={isEmail ? "Send email" : "Send message"}
              className={buttonClassName(canSend && !replySending ? "send" : "sendDisabled", "mb-0.5")}
            >
              {replySending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <ArrowUp className="size-4 stroke-[2.5]" aria-hidden />
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
