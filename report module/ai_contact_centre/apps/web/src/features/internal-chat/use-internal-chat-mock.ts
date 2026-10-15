import { useCallback, useMemo, useState } from "react";

import type { AuthUser } from "@/types/auth";

import { attachmentsPreviewLabel } from "./attachment-utils";
import { memberById } from "./internal-chat-utils";
import { createMockInternalChatState } from "./mock-data";
import type { InternalChatAttachment, InternalChatCreateGroupPayload, InternalChatMessage, InternalChatRoom, InternalChatState, InternalChatUpdateGroupPayload } from "./types";

export type InternalChatSendPayload = {
  body?: string;
  attachments?: InternalChatAttachment[];
  voiceDurationMs?: number;
  voiceAudioUrl?: string;
};

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useInternalChatMock(user: AuthUser | null) {
  const [state, setState] = useState<InternalChatState | null>(() =>
    user ? createMockInternalChatState(user) : null,
  );

  const refresh = useCallback(() => {
    if (!user) return;
    setState(createMockInternalChatState(user));
  }, [user]);

  const selectRoom = useCallback((roomId: string) => {
    setState((current) => {
      if (!current) return current;
      const now = new Date().toISOString();
      return {
        ...current,
        rooms: current.rooms.map((room) =>
          room.id === roomId ? { ...room, lastReadAt: now } : room,
        ),
      };
    });
  }, []);

  const sendMessage = useCallback((roomId: string, payload: InternalChatSendPayload) => {
    const body = payload.body?.trim() ?? "";
    const attachments = payload.attachments ?? [];
    const hasAttachments = attachments.length > 0;
    const hasVoice = typeof payload.voiceDurationMs === "number";
    if (!body && !hasAttachments && !hasVoice) return;

    setState((current) => {
      if (!current) return current;
      const now = new Date().toISOString();
      const message: InternalChatMessage = {
        id: nextId("msg"),
        roomId,
        senderUserId: current.currentUserId,
        body,
        createdAt: now,
        attachments: hasAttachments ? attachments : undefined,
        voiceDurationMs: payload.voiceDurationMs,
        voiceAudioUrl: payload.voiceAudioUrl,
      };
      const preview = hasAttachments
        ? attachmentsPreviewLabel(attachments)
        : hasVoice
          ? "🎤 Voice message"
          : body;
      return {
        ...current,
        messages: [...current.messages, message],
        rooms: current.rooms.map((room) =>
          room.id === roomId
            ? {
                ...room,
                lastMessageAt: now,
                lastMessagePreview: preview,
                lastReadAt: now,
              }
            : room,
        ),
      };
    });
  }, []);

  const createGroup = useCallback((payload: InternalChatCreateGroupPayload) => {
    const trimmed = payload.name.trim();
    const description = payload.description.trim();
    if (!trimmed || !description || !payload.category || payload.memberIds.length === 0) return null;
    const roomId = nextId("room");
    const now = new Date().toISOString();
    const avatarUrl = payload.avatarFile
      ? URL.createObjectURL(payload.avatarFile)
      : undefined;
    setState((current) => {
      if (!current) return current;
      const room: InternalChatRoom = {
        id: roomId,
        type: "group",
        name: trimmed,
        description,
        category: payload.category,
        avatarUrl,
        memberIds: Array.from(new Set([current.currentUserId, ...payload.memberIds])),
        createdByUserId: current.currentUserId,
        createdAt: now,
        lastReadAt: now,
      };
      return {
        ...current,
        rooms: [room, ...current.rooms],
      };
    });
    return roomId;
  }, []);

  const startDm = useCallback((targetUserId: string) => {
    if (!targetUserId) return null;
    let resolvedRoomId: string | null = null;
    setState((current) => {
      if (!current) return current;
      const existing = current.rooms.find(
        (room) =>
          room.type === "dm" &&
          room.memberIds.length === 2 &&
          room.memberIds.includes(current.currentUserId) &&
          room.memberIds.includes(targetUserId),
      );
      if (existing) {
        resolvedRoomId = existing.id;
        return current;
      }

      const target = memberById(current.members, targetUserId);
      if (!target) return current;

      const roomId = nextId("room");
      const now = new Date().toISOString();
      const room: InternalChatRoom = {
        id: roomId,
        type: "dm",
        name: target.name,
        memberIds: [current.currentUserId, targetUserId],
        createdByUserId: current.currentUserId,
        createdAt: now,
        lastReadAt: now,
      };
      resolvedRoomId = roomId;
      return {
        ...current,
        rooms: [room, ...current.rooms],
      };
    });
    return resolvedRoomId;
  }, []);

  const updateRoomMembers = useCallback((roomId: string, memberIds: string[]) => {
    setState((current) => {
      if (!current) return current;
      return {
        ...current,
        rooms: current.rooms.map((room) =>
          room.id === roomId
            ? {
                ...room,
                memberIds: Array.from(new Set([current.currentUserId, ...memberIds])),
              }
            : room,
        ),
      };
    });
  }, []);

  const updateGroup = useCallback((roomId: string, payload: InternalChatUpdateGroupPayload) => {
    const trimmed = payload.name.trim();
    const description = payload.description.trim();
    if (!trimmed || !description || !payload.category || payload.memberIds.length === 0) return;
    setState((current) => {
      if (!current) return current;
      const avatarUrl = payload.removeAvatar
        ? undefined
        : payload.avatarFile
          ? URL.createObjectURL(payload.avatarFile)
          : current.rooms.find((room) => room.id === roomId)?.avatarUrl;
      return {
        ...current,
        rooms: current.rooms.map((room) =>
          room.id === roomId && room.type === "group"
            ? {
                ...room,
                name: trimmed,
                description,
                category: payload.category,
                avatarUrl,
                memberIds: Array.from(new Set([current.currentUserId, ...payload.memberIds])),
              }
            : room,
        ),
      };
    });
  }, []);

  const renameRoom = useCallback((roomId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState((current) => {
      if (!current) return current;
      return {
        ...current,
        rooms: current.rooms.map((room) =>
          room.id === roomId && room.type === "group" ? { ...room, name: trimmed } : room,
        ),
      };
    });
  }, []);

  return useMemo(
    () => ({
      state,
      loading: false,
      error: null as string | null,
      refresh,
      selectRoom,
      sendMessage,
      createGroup,
      startDm,
      updateRoomMembers,
      updateGroup,
      renameRoom,
    }),
    [state, refresh, selectRoom, sendMessage, createGroup, startDm, updateRoomMembers, updateGroup, renameRoom],
  );
}
