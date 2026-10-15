import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

import { env } from "@/config/env";
import { readAuthFromStorage } from "@/services/http";

import type { InternalChatMessage, InternalChatRoom } from "./types";

type InternalChatSocketHandlers = {
  onMessageCreated?: (roomId: string, message: InternalChatMessage) => void;
  onRoomUpdated?: (roomId: string, patch: Partial<InternalChatRoom>) => void;
  onRoomRead?: (roomId: string, lastReadAt: string) => void;
  onJoinRoom?: (roomId: string) => void;
  onLeaveRoom?: (roomId: string) => void;
};

let socket: Socket | null = null;
let socketAuthKey: string | null = null;

function socketKey(auth: ReturnType<typeof readAuthFromStorage>): string {
  return `${auth.token ?? ""}:${auth.organizationId ?? ""}:${auth.userId ?? ""}`;
}

function getOrCreateSocket(auth: ReturnType<typeof readAuthFromStorage>): Socket {
  const key = socketKey(auth);
  if (socket && socketAuthKey === key) {
    return socket;
  }
  socket?.disconnect();
  socket = io(env.socketUrl, {
    path: env.socketPath,
    auth: {
      token: auth.token,
      tenantId: auth.organizationId ?? (import.meta.env.DEV ? env.tenantId : undefined),
      userId: auth.userId ?? (import.meta.env.DEV ? env.userId : undefined),
    },
  });
  socketAuthKey = key;
  return socket;
}

export function useInternalChatSocket(handlers: InternalChatSocketHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const auth = readAuthFromStorage();
    const activeSocket = getOrCreateSocket(auth);

    const handleMessageCreated = (payload: { roomId: string; message: InternalChatMessage }) => {
      handlersRef.current.onMessageCreated?.(payload.roomId, payload.message);
    };

    const handleRoomUpdated = (payload: {
      roomId?: string;
      roomIds?: string[];
      patch: Partial<InternalChatRoom>;
    }) => {
      if (payload.roomId) {
        handlersRef.current.onRoomUpdated?.(payload.roomId, payload.patch);
        return;
      }
      for (const roomId of payload.roomIds ?? []) {
        handlersRef.current.onRoomUpdated?.(roomId, payload.patch);
      }
    };

    const handleRoomRead = (payload: { roomId: string; lastReadAt: string }) => {
      handlersRef.current.onRoomRead?.(payload.roomId, payload.lastReadAt);
    };

    activeSocket.on("internal_chat.message.created", handleMessageCreated);
    activeSocket.on("internal_chat.room.updated", handleRoomUpdated);
    activeSocket.on("internal_chat.room.read", handleRoomRead);

    return () => {
      activeSocket.off("internal_chat.message.created", handleMessageCreated);
      activeSocket.off("internal_chat.room.updated", handleRoomUpdated);
      activeSocket.off("internal_chat.room.read", handleRoomRead);
    };
  }, []);
}

export function joinInternalChatRoom(roomId: string): void {
  const auth = readAuthFromStorage();
  getOrCreateSocket(auth).emit("internal_chat.join", { roomId });
}

export function leaveInternalChatRoom(roomId: string): void {
  const auth = readAuthFromStorage();
  getOrCreateSocket(auth).emit("internal_chat.leave", { roomId });
}

export function useInternalChatRoomSubscription(roomId: string | null): void {
  useEffect(() => {
    if (!roomId) return;
    joinInternalChatRoom(roomId);
    return () => leaveInternalChatRoom(roomId);
  }, [roomId]);
}
