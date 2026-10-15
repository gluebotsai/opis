import { Info, LoaderCircle, Pencil, ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { InternalChatComposer } from "@/components/internal-chat/internal-chat-composer";
import { InternalChatGroupMembersDialog } from "@/components/internal-chat/internal-chat-group-members-dialog";
import { InternalChatGroupAvatar } from "@/components/internal-chat/internal-chat-group-avatar";
import {
  InternalChatMessageAttachments,
} from "@/components/internal-chat/internal-chat-file-attachment";
import { InternalChatVoiceMessage } from "@/components/internal-chat/internal-chat-voice-message";
import { isImageAttachment } from "@/features/internal-chat/attachment-utils";
import { messageBubbleClassName } from "@/components/ui/message-bubble-styles";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { IconButton } from "@/components/ui/button";
import {
  formatMessageTime,
  memberById,
  presenceDotClass,
  presenceLabel,
  roomMessages,
} from "@/features/internal-chat/internal-chat-utils";
import type { InternalChatMember, InternalChatMessage, InternalChatPendingMessage } from "@/features/internal-chat/types";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

function MessageBubble({
  message,
  sender,
  isOutgoing,
  sending = false,
  failed = false,
}: {
  message: InternalChatMessage;
  sender?: InternalChatMember;
  isOutgoing: boolean;
  sending?: boolean;
  failed?: boolean;
}) {
  const attachments = message.attachments ?? [];
  const hasAttachments = attachments.length > 0;
  const hasCaption = Boolean(message.body.trim());
  const hasVoice = typeof message.voiceDurationMs === "number";
  const imageOnly =
    hasAttachments &&
    attachments.every((attachment) => isImageAttachment(attachment) && attachment.previewUrl);
  const hasPlayableVoice = hasVoice && Boolean(message.voiceAudioUrl);
  const showFooterTimestamp =
    !hasPlayableVoice &&
    (hasCaption || hasVoice || !imageOnly || attachments.some((attachment) => !isImageAttachment(attachment)));

  return (
    <div className={cn("flex w-full flex-col gap-1", isOutgoing ? "items-end" : "items-start")}>
      {!isOutgoing && sender ? (
        <span className="px-1 text-[11px] font-medium text-neutral-600">{sender.name}</span>
      ) : null}
      <div
        className={cn(
          imageOnly && !hasCaption
            ? "max-w-[min(92%,17rem)]"
            : messageBubbleClassName({
                outgoing: isOutgoing,
                className: cn(
                  hasAttachments && "max-w-[min(92%,20rem)] p-2",
                  hasPlayableVoice && !hasAttachments && "max-w-[min(92%,18rem)] px-3 py-2.5",
                  sending && "opacity-70",
                  failed && "border border-red-200 bg-red-50",
                ),
              }),
        )}
      >
        {hasAttachments ? (
          <InternalChatMessageAttachments
            attachments={attachments}
            sentAt={message.createdAt}
            isOutgoing={isOutgoing}
            hasCaption={hasCaption}
          />
        ) : null}
        {hasCaption ? (
          <p
            className={cn(
              "whitespace-pre-wrap break-words",
              hasAttachments &&
                (imageOnly
                  ? messageBubbleClassName({ outgoing: isOutgoing, className: "mt-1.5" })
                  : "mt-2 px-0.5"),
            )}
          >
            {message.body}
          </p>
        ) : null}
        {hasPlayableVoice ? (
          <InternalChatVoiceMessage
            audioUrl={message.voiceAudioUrl!}
            durationMs={message.voiceDurationMs!}
            isOutgoing={isOutgoing}
            sentAt={formatMessageTime(message.createdAt)}
          />
        ) : hasVoice ? (
          <p className="whitespace-pre-wrap break-words">🎤 Voice message</p>
        ) : null}
        {showFooterTimestamp || sending || failed ? (
          <p
            className={cn(
              "mt-1 flex items-center justify-end gap-1 text-[10px]",
              hasAttachments ? "px-0.5" : "",
              failed ? "text-red-500" : isOutgoing ? "text-white/70" : "text-neutral-400",
            )}
          >
            {sending ? (
              <>
                <LoaderCircle className="size-3 animate-spin" />
                <span>Sending…</span>
              </>
            ) : failed ? (
              <span>Failed to send</span>
            ) : (
              formatMessageTime(message.createdAt)
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type InternalChatThreadPanelProps = {
  roomId: string | null;
  roomLabel: string;
  roomType: "group" | "dm" | null;
  roomAvatarUrl?: string;
  memberCount: number;
  memberIds: string[];
  messages: InternalChatMessage[];
  pendingMessages?: InternalChatPendingMessage[];
  members: InternalChatMember[];
  currentUserId: string;
  draft: string;
  pendingAttachments: File[];
  onDraftChange: (value: string) => void;
  onAddAttachments: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  onClearAttachments?: () => void;
  onSend: () => void;
  onSendVoiceNote?: (payload: { durationMs: number; audioBlob: Blob }) => void;
  sending?: boolean;
  onEditGroup?: () => void;
  onBack?: () => void;
};

export function InternalChatThreadPanel({
  roomId,
  roomLabel,
  roomType,
  roomAvatarUrl,
  memberCount,
  memberIds,
  messages,
  pendingMessages = [],
  members,
  currentUserId,
  draft,
  pendingAttachments,
  onDraftChange,
  onAddAttachments,
  onRemoveAttachment,
  onClearAttachments,
  onSend,
  onSendVoiceNote,
  sending = false,
  onEditGroup,
  onBack,
}: InternalChatThreadPanelProps) {
  const [membersOpen, setMembersOpen] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const threadMessages = roomId ? roomMessages(messages, roomId) : [];
  const roomPendingMessages = roomId
    ? pendingMessages.filter((item) => item.roomId === roomId)
    : [];
  const dmMember = useMemo(() => {
    if (roomType !== "dm") return null;
    const otherUserId = memberIds.find((id) => id !== currentUserId);
    return otherUserId ? memberById(members, otherUserId) : null;
  }, [currentUserId, memberIds, members, roomType]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [roomId, threadMessages.length, roomPendingMessages.length]);

  if (!roomId) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        {onBack ? (
          <div className={cn("shrink-0 px-2 py-1.5", contentPanelHeaderBorderClassName)}>
            <IconButton variant="ghostIcon" onClick={onBack} aria-label="Back to chats">
              <ChevronLeft />
            </IconButton>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <p className="text-base font-semibold text-neutral-900">Select a chat</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-600">
            Choose a group or direct message from the list to start chatting with your team.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 px-3 py-2.5 xl:gap-3 xl:px-5 xl:py-3.5",
          contentPanelHeaderBorderClassName,
        )}
      >
        {onBack ? (
          <IconButton
            variant="ghostIcon"
            className="shrink-0"
            onClick={onBack}
            aria-label="Back to chats"
          >
            <ChevronLeft />
          </IconButton>
        ) : null}
        <div className="relative shrink-0">
          {roomType === "group" ? (
            <InternalChatGroupAvatar
              name={roomLabel}
              avatarUrl={roomAvatarUrl}
              className="size-10 text-xs"
            />
          ) : (
            <span
              className={profileAvatarClassName(roomLabel, "size-10 text-xs")}
              aria-hidden
            >
              {profileInitials(roomLabel)}
            </span>
          )}
          {dmMember ? (
            <span
              className={cn(
                "absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-white",
                presenceDotClass(dmMember.presence),
              )}
              title={presenceLabel(dmMember.presence)}
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <h3 className="truncate text-sm font-semibold text-neutral-900">{roomLabel}</h3>
            {roomType === "group" && onEditGroup ? (
              <IconButton
                variant="ghostIcon"
                onClick={onEditGroup}
                aria-label="Edit group"
                title="Edit group"
                className="size-6 shrink-0 text-neutral-600 hover:text-neutral-900"
              >
                <Pencil className="size-3.5" />
              </IconButton>
            ) : null}
          </div>
          {roomType === "group" ? (
            <div className="mt-0.5 flex items-center gap-0.5 text-xs text-neutral-600">
              <span>{memberCount} members</span>
              <IconButton
                variant="ghostIcon"
                onClick={() => setMembersOpen(true)}
                aria-label="View group members"
                title="View group members"
                className="size-6 shrink-0 text-neutral-400 hover:text-neutral-700"
              >
                <Info className="size-3.5" />
              </IconButton>
            </div>
          ) : (
            <p className="mt-0.5 text-sm text-neutral-600">
              {dmMember ? (
                <>
                  <span
                    className={cn(
                      "font-medium",
                      dmMember.presence === "offline" ? "text-neutral-400" : "text-emerald-600",
                    )}
                  >
                    {presenceLabel(dmMember.presence)}
                  </span>
                  <span> · Direct message</span>
                </>
              ) : (
                "Direct message"
              )}
            </p>
          )}
        </div>
      </div>

      {roomType === "group" ? (
        <InternalChatGroupMembersDialog
          open={membersOpen}
          memberIds={memberIds}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setMembersOpen(false)}
        />
      ) : null}

      <PanelScrollArea className="min-h-0 flex-1 px-4 py-5 sm:px-5">
        <div className="space-y-4">
          {threadMessages.map((message) => {
            const isOutgoing = message.senderUserId === currentUserId;
            const sender = memberById(members, message.senderUserId);
            return (
              <MessageBubble
                key={message.id}
                message={message}
                sender={sender}
                isOutgoing={isOutgoing}
              />
            );
          })}
          {roomPendingMessages.map((pending) => (
            <MessageBubble
              key={pending.id}
              message={{
                id: pending.id,
                roomId: pending.roomId,
                senderUserId: pending.senderUserId,
                body: pending.body,
                createdAt: pending.createdAt,
                attachments: pending.attachments,
              }}
              isOutgoing
              sending={pending.status === "uploading"}
              failed={pending.status === "failed"}
            />
          ))}
          <div ref={scrollAnchorRef} />
        </div>
      </PanelScrollArea>

      <InternalChatComposer
        draft={draft}
        pendingAttachments={pendingAttachments}
        disabled={sending}
        onDraftChange={onDraftChange}
        onAddAttachments={onAddAttachments}
        onRemoveAttachment={onRemoveAttachment}
        onClearAttachments={onClearAttachments}
        onSend={onSend}
        onSendVoiceNote={onSendVoiceNote}
      />
    </div>
  );
}
