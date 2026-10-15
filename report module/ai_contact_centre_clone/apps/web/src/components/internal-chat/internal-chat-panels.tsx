import { App } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import { WorkspacePanel } from "@/components/workspace/workspace-panel";
import { InternalChatCreateGroupDialog } from "@/components/internal-chat/internal-chat-create-group-dialog";
import { InternalChatEditGroupDialog } from "@/components/internal-chat/internal-chat-edit-group-dialog";
import { InternalChatNewChatDialog } from "@/components/internal-chat/internal-chat-new-chat-dialog";
import { InternalChatRoomListPanel } from "@/components/internal-chat/internal-chat-room-list-panel";
import { InternalChatThreadPanel } from "@/components/internal-chat/internal-chat-thread-panel";
import { internalChatApi } from "@/features/internal-chat/api";
import { fileToAttachment } from "@/features/internal-chat/attachment-utils";
import { roomDisplayName } from "@/features/internal-chat/internal-chat-utils";
import { useInternalChatRoomSubscription } from "@/features/internal-chat/use-internal-chat-socket";
import type { InternalChatSendPayload } from "@/features/internal-chat/api";
import type { InternalChatSendPayload as MockInternalChatSendPayload } from "@/features/internal-chat/use-internal-chat-mock";
import type { InternalChatState, InternalChatCreateGroupPayload, InternalChatUpdateGroupPayload, InternalChatPendingMessage } from "@/features/internal-chat/types";
import { useMediaQuery } from "@/hooks/use-media-query";
import { MEDIA_LG, MEDIA_XL } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

const USE_MOCK_INTERNAL_CHAT = import.meta.env.VITE_INTERNAL_CHAT_MOCK === "1";

type InternalChatPanelsSendPayload = InternalChatSendPayload | MockInternalChatSendPayload;

type InternalChatPanelsProps = {
  state: InternalChatState;
  isAdmin: boolean;
  initialDmUserId?: string | null;
  onInitialDmHandled?: () => void;
  onSelectRoom: (roomId: string) => void | Promise<void>;
  onSendMessage: (roomId: string, payload: InternalChatPanelsSendPayload) => void | Promise<void>;
  onCreateGroup: (payload: InternalChatCreateGroupPayload) => string | null | Promise<string | null>;
  onStartDm: (targetUserId: string) => string | null | Promise<string | null>;
  onUpdateGroup: (roomId: string, payload: InternalChatUpdateGroupPayload) => void | Promise<void>;
};

export function InternalChatPanels({
  state,
  isAdmin,
  initialDmUserId = null,
  onInitialDmHandled,
  onSelectRoom,
  onSendMessage,
  onCreateGroup,
  onStartDm,
  onUpdateGroup,
}: InternalChatPanelsProps) {
  const { message } = App.useApp();
  const handledInitialDmRef = useRef<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(
    () => state.rooms[0]?.id ?? null,
  );
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<InternalChatPendingMessage[]>([]);
  const isLg = useMediaQuery(MEDIA_LG);
  const isXl = useMediaQuery(MEDIA_XL);
  const [mobileShowThread, setMobileShowThread] = useState(false);

  useInternalChatRoomSubscription(selectedRoomId);

  const selectedRoom = useMemo(
    () => state.rooms.find((room) => room.id === selectedRoomId) ?? null,
    [selectedRoomId, state.rooms],
  );

  useEffect(() => {
    if (selectedRoomId && !state.rooms.some((room) => room.id === selectedRoomId)) {
      setSelectedRoomId(state.rooms[0]?.id ?? null);
    }
  }, [selectedRoomId, state.rooms]);

  useEffect(() => {
    setDraft("");
    setPendingAttachments([]);
  }, [selectedRoomId]);

  function handleAddAttachments(files: File[]) {
    setPendingAttachments((current) => [...current, ...files]);
  }

  function handleRemoveAttachment(index: number) {
    setPendingAttachments((current) => current.filter((_, fileIndex) => fileIndex !== index));
  }

  function handleClearAttachments() {
    setPendingAttachments([]);
  }

  function handleSelectRoom(roomId: string) {
    setSelectedRoomId(roomId);
    if (!isLg) setMobileShowThread(true);
    void onSelectRoom(roomId);
  }

  useEffect(() => {
    if (!initialDmUserId || initialDmUserId === state.currentUserId) {
      return;
    }
    if (handledInitialDmRef.current === initialDmUserId) {
      return;
    }
    handledInitialDmRef.current = initialDmUserId;

    const existing = state.rooms.find(
      (room) =>
        room.type === "dm" &&
        room.memberIds.includes(initialDmUserId) &&
        room.memberIds.includes(state.currentUserId),
    );

    if (existing) {
      handleSelectRoom(existing.id);
      onInitialDmHandled?.();
      return;
    }

    void (async () => {
      try {
        const roomId = await onStartDm(initialDmUserId);
        if (roomId) {
          handleSelectRoom(roomId);
        }
      } finally {
        onInitialDmHandled?.();
      }
    })();
  }, [initialDmUserId, onInitialDmHandled, onStartDm, state.currentUserId, state.rooms]);

  async function handleSend() {
    if (!selectedRoomId || sending) return;
    const body = draft.trim();
    if (!body && pendingAttachments.length === 0) return;

    const roomId = selectedRoomId;
    const files = [...pendingAttachments];
    const pendingId = `pending-${crypto.randomUUID()}`;

    setPendingMessages((current) => [
      ...current,
      {
        id: pendingId,
        roomId,
        senderUserId: state.currentUserId,
        body,
        createdAt: new Date().toISOString(),
        attachments: files.length > 0 ? files.map((file) => fileToAttachment(file)) : undefined,
        status: "uploading",
      },
    ]);
    setDraft("");
    setPendingAttachments([]);
    setSending(true);

    try {
      if (USE_MOCK_INTERNAL_CHAT) {
        await onSendMessage(roomId, {
          body: body || undefined,
          attachments:
            files.length > 0 ? files.map((file) => fileToAttachment(file)) : undefined,
        } as InternalChatPanelsSendPayload);
      } else {
        const uploads =
          files.length > 0
            ? await Promise.all(
                files.map((file) => internalChatApi.uploadRoomFile(roomId, file)),
              )
            : [];

        await onSendMessage(roomId, {
          body: body || undefined,
          attachments:
            uploads.length > 0
              ? uploads.map((upload) => ({
                  storageKey: upload.storageKey,
                  fileName: upload.fileName,
                  contentType: upload.contentType,
                  byteSize: upload.byteSize,
                  checksumSha256: upload.checksumSha256,
                }))
              : undefined,
        });
      }
      setPendingMessages((current) => current.filter((item) => item.id !== pendingId));
    } catch (cause) {
      const errorMessage =
        cause instanceof Error ? cause.message : "Failed to send message";
      setPendingMessages((current) =>
        current.map((item) =>
          item.id === pendingId ? { ...item, status: "failed", error: errorMessage } : item,
        ),
      );
      message.error(errorMessage);
    } finally {
      setSending(false);
    }
  }

  async function handleSendVoiceNote(payload: { durationMs: number; audioBlob: Blob }) {
    if (!selectedRoomId || sending) return;
    setSending(true);
    try {
      if (USE_MOCK_INTERNAL_CHAT) {
        const audioUrl = URL.createObjectURL(payload.audioBlob);
        await onSendMessage(selectedRoomId, {
          voiceDurationMs: payload.durationMs,
          voiceAudioUrl: audioUrl,
        } as InternalChatPanelsSendPayload);
      } else {
        const file = new File([payload.audioBlob], "voice-message.webm", {
          type: payload.audioBlob.type || "audio/webm",
        });
        const upload = await internalChatApi.uploadRoomFile(selectedRoomId, file);
        await onSendMessage(selectedRoomId, {
          voiceDurationMs: payload.durationMs,
          voiceStorageKey: upload.storageKey,
        });
      }
    } finally {
      setSending(false);
    }
  }

  const roomLabel = selectedRoom
    ? roomDisplayName(selectedRoom, state.members, state.currentUserId)
    : "";

  return (
    <>
      <div
        className={cn(
          "grid h-full min-h-0 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(220px,34%)_minmax(0,1fr)] xl:grid-cols-[minmax(260px,28%)_minmax(0,1fr)] xl:gap-4",
        )}
      >
        <WorkspacePanel className={cn(!isLg && mobileShowThread && "hidden")}>
          <InternalChatRoomListPanel
            rooms={state.rooms}
            messages={state.messages}
            members={state.members}
            currentUserId={state.currentUserId}
            selectedRoomId={selectedRoomId}
            isAdmin={isAdmin}
            onSelectRoom={handleSelectRoom}
            onStartChat={() => setNewChatOpen(true)}
            onCreateGroup={isAdmin ? () => setCreateOpen(true) : undefined}
          />
        </WorkspacePanel>

        <WorkspacePanel
          className={cn(
            !isLg && !mobileShowThread && "hidden",
            isLg && !isXl && "border-l-[0.6px] border-[#bfbfbf]",
          )}
        >
          <InternalChatThreadPanel
            roomId={selectedRoomId}
            roomLabel={roomLabel}
            roomType={selectedRoom?.type ?? null}
            roomAvatarUrl={selectedRoom?.avatarUrl}
            memberCount={selectedRoom?.memberIds.length ?? 0}
            memberIds={selectedRoom?.memberIds ?? []}
            messages={state.messages}
            pendingMessages={pendingMessages}
            members={state.members}
            currentUserId={state.currentUserId}
            draft={draft}
            pendingAttachments={pendingAttachments}
            onDraftChange={setDraft}
            onAddAttachments={handleAddAttachments}
            onRemoveAttachment={handleRemoveAttachment}
            onClearAttachments={handleClearAttachments}
            onSend={() => void handleSend()}
            onSendVoiceNote={(payload) => void handleSendVoiceNote(payload)}
            sending={sending}
            onEditGroup={
              isAdmin && selectedRoom?.type === "group" ? () => setEditOpen(true) : undefined
            }
            onBack={!isLg ? () => setMobileShowThread(false) : undefined}
          />
        </WorkspacePanel>
      </div>

      <InternalChatNewChatDialog
        open={newChatOpen}
        members={state.members}
        currentUserId={state.currentUserId}
        onClose={() => setNewChatOpen(false)}
        onStartChat={(targetUserId) => {
          void (async () => {
            const roomId = await onStartDm(targetUserId);
            if (roomId) {
              handleSelectRoom(roomId);
            }
            setNewChatOpen(false);
          })();
        }}
      />

      <InternalChatCreateGroupDialog
        open={createOpen}
        members={state.members}
        currentUserId={state.currentUserId}
        onClose={() => setCreateOpen(false)}
        onCreate={(payload) => {
          void (async () => {
            if (USE_MOCK_INTERNAL_CHAT) {
              const roomId = await onCreateGroup(payload);
              if (roomId) {
                handleSelectRoom(roomId);
              }
              setCreateOpen(false);
              return;
            }

            let avatarStorageKey = payload.avatarStorageKey;
            if (payload.avatarFile) {
              const upload = await internalChatApi.uploadAvatar(payload.avatarFile);
              avatarStorageKey = upload.storageKey;
            }
            const roomId = await onCreateGroup({
              name: payload.name,
              description: payload.description,
              category: payload.category,
              memberIds: payload.memberIds,
              avatarStorageKey,
            });
            if (roomId) {
              handleSelectRoom(roomId);
            }
            setCreateOpen(false);
          })();
        }}
      />

      {selectedRoom?.type === "group" ? (
        <InternalChatEditGroupDialog
          open={editOpen}
          room={selectedRoom}
          members={state.members}
          currentUserId={state.currentUserId}
          onClose={() => setEditOpen(false)}
          onSave={async (payload) => {
            if (USE_MOCK_INTERNAL_CHAT) {
              await onUpdateGroup(selectedRoom.id, payload);
              message.success("Group updated.");
              setEditOpen(false);
              return;
            }

            let avatarStorageKey: string | null | undefined;
            if (payload.removeAvatar) {
              avatarStorageKey = null;
            } else if (payload.avatarFile) {
              const upload = await internalChatApi.uploadAvatar(payload.avatarFile);
              avatarStorageKey = upload.storageKey;
            }

            await onUpdateGroup(selectedRoom.id, {
              name: payload.name,
              description: payload.description,
              category: payload.category,
              memberIds: payload.memberIds,
              ...(avatarStorageKey !== undefined ? { avatarStorageKey } : {}),
            });
            message.success("Group updated.");
            setEditOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
