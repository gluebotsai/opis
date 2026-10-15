import { useEffect, useState } from "react";

import { internalChatApi } from "./api";
import { totalUnreadCount } from "./internal-chat-utils";
import { useInternalChatSocket } from "./use-internal-chat-socket";
import type { InternalChatRoom } from "./types";

/** Number of team chats with something unread. Counts chats, not messages. */
export function useTeamChatPendingCount(currentUserId: string | null): number {
  const [rooms, setRooms] = useState<InternalChatRoom[]>([]);

  useEffect(() => {
    if (!currentUserId) {
      setRooms([]);
      return;
    }
    let cancelled = false;
    void internalChatApi
      .listRooms()
      .then((next) => {
        if (!cancelled) setRooms(next);
      })
      .catch(() => {
        if (!cancelled) setRooms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useInternalChatSocket({
    onMessageCreated: (roomId, message) => {
      setRooms((current) => {
        const fromSelf = Boolean(currentUserId && message.senderUserId === currentUserId);
        const existing = current.some((room) => room.id === roomId);
        if (!existing) {
          void internalChatApi.listRooms().then(setRooms).catch(() => undefined);
          return current;
        }
        return current.map((room) =>
          room.id === roomId
            ? {
                ...room,
                lastMessageAt: message.createdAt,
                lastReadAt: fromSelf ? message.createdAt : room.lastReadAt,
              }
            : room,
        );
      });
    },
    onRoomUpdated: (roomId, patch) => {
      setRooms((current) =>
        current.map((room) => (room.id === roomId ? { ...room, ...patch } : room)),
      );
    },
    onRoomRead: (roomId, lastReadAt) => {
      setRooms((current) =>
        current.map((room) => (room.id === roomId ? { ...room, lastReadAt } : room)),
      );
    },
  });

  if (!currentUserId) return 0;
  return totalUnreadCount(rooms);
}
