import { useCallback, useEffect, useMemo, useState } from "react";

import type { AuthUser } from "@/types/auth";

import { internalChatApi } from "./api";
import { useInternalChatSocket } from "./use-internal-chat-socket";
import type {
  InternalChatCreateGroupPayload,
  InternalChatState,
  InternalChatUpdateGroupPayload,
} from "./types";
import type { InternalChatSendPayload } from "./api";

export type { InternalChatSendPayload };

export function useInternalChat(user: AuthUser | null) {
  const [state, setState] = useState<InternalChatState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const next = await internalChatApi.bootstrap();
      setState(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load internal chat");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useInternalChatSocket({
    onMessageCreated: (roomId, message) => {
      setState((current) => {
        if (!current) return current;
        const exists = current.messages.some((item) => item.id === message.id);
        return {
          ...current,
          messages: exists ? current.messages : [...current.messages, message],
          rooms: current.rooms.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  lastMessageAt: message.createdAt,
                  lastMessagePreview:
                    message.voiceDurationMs != null
                      ? "🎤 Voice message"
                      : message.attachments?.length
                        ? message.attachments.map((item) => item.name).join(", ")
                        : message.body,
                }
              : room,
          ),
        };
      });
    },
    onRoomUpdated: (roomId, patch) => {
      setState((current) => {
        if (!current) return current;
        return {
          ...current,
          rooms: current.rooms.map((room) =>
            room.id === roomId ? { ...room, ...patch } : room,
          ),
        };
      });
    },
  });

  const selectRoom = useCallback(async (roomId: string) => {
    try {
      const lastReadAt = await internalChatApi.markRoomRead(roomId);
      setState((current) => {
        if (!current) return current;
        return {
          ...current,
          rooms: current.rooms.map((room) =>
            room.id === roomId ? { ...room, lastReadAt } : room,
          ),
        };
      });
    } catch {
      // Keep UI responsive even if read receipt fails.
    }
  }, []);

  const sendMessage = useCallback(async (roomId: string, payload: InternalChatSendPayload) => {
    const message = await internalChatApi.sendMessage(roomId, payload);
    setState((current) => {
      if (!current) return current;
      const exists = current.messages.some((item) => item.id === message.id);
      if (exists) return current;
      return {
        ...current,
        messages: [...current.messages, message],
        rooms: current.rooms.map((room) =>
          room.id === roomId
            ? {
                ...room,
                lastMessageAt: message.createdAt,
                lastMessagePreview:
                  message.voiceDurationMs != null
                    ? "🎤 Voice message"
                    : message.attachments?.length
                      ? message.attachments.map((item) => item.name).join(", ")
                      : message.body,
                lastReadAt: message.createdAt,
              }
            : room,
        ),
      };
    });
  }, []);

  const createGroup = useCallback(
    async (payload: InternalChatCreateGroupPayload & { avatarStorageKey?: string }) => {
      const room = await internalChatApi.createGroup(payload);
      setState((current) => {
        if (!current) return current;
        return {
          ...current,
          rooms: [room, ...current.rooms.filter((item) => item.id !== room.id)],
        };
      });
      return room.id;
    },
    [],
  );

  const startDm = useCallback(async (targetUserId: string) => {
    const room = await internalChatApi.createDm(targetUserId);
    setState((current) => {
      if (!current) return current;
      return {
        ...current,
        rooms: [room, ...current.rooms.filter((item) => item.id !== room.id)],
      };
    });
    return room.id;
  }, []);

  const renameRoom = useCallback(async (roomId: string, name: string) => {
    const room = await internalChatApi.renameRoom(roomId, name);
    setState((current) => {
      if (!current) return current;
      return {
        ...current,
        rooms: current.rooms.map((item) => (item.id === roomId ? { ...item, ...room } : item)),
      };
    });
  }, []);

  const updateGroup = useCallback(async (roomId: string, payload: InternalChatUpdateGroupPayload) => {
    const room = await internalChatApi.updateGroup(roomId, {
      name: payload.name,
      description: payload.description,
      category: payload.category,
      avatarStorageKey: payload.removeAvatar
        ? null
        : payload.avatarStorageKey,
    });
    await internalChatApi.updateGroupMembers(roomId, payload.memberIds);
    setState((current) => {
      if (!current) return current;
      const nextMemberIds = Array.from(new Set([current.currentUserId, ...payload.memberIds]));
      return {
        ...current,
        rooms: current.rooms.map((item) =>
          item.id === roomId ? { ...item, ...room, memberIds: nextMemberIds } : item,
        ),
      };
    });
  }, []);

  const updateRoomMembers = useCallback(async (_roomId: string, _memberIds: string[]) => {
    // Reserved for manage-members UI.
  }, []);

  return useMemo(
    () => ({
      state,
      loading,
      error,
      refresh,
      selectRoom,
      sendMessage,
      createGroup,
      startDm,
      updateRoomMembers,
      renameRoom,
      updateGroup,
    }),
    [state, loading, error, refresh, selectRoom, sendMessage, createGroup, startDm, updateRoomMembers, renameRoom, updateGroup],
  );
}
