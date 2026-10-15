import type { Server as SocketIOServer } from "socket.io";

import { verifyAccessToken } from "../lib/jwt.js";
import {
  conversationRoom,
  internalChatRoom,
  organizationRoom,
  userRoom,
} from "../lib/socket-rooms.js";

export function registerSocketHandlers(io: SocketIOServer, jwtSecret: string | undefined): void {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const tenantId = socket.handshake.auth?.tenantId as string | undefined;
    const userId = socket.handshake.auth?.userId as string | undefined;

    if (token && jwtSecret) {
      const payload = verifyAccessToken(token, jwtSecret);
      if (!payload) {
        next(new Error("Unauthorized"));
        return;
      }
      socket.data.tenantId = payload.tenant_id;
      socket.data.userId = payload.sub;
      next();
      return;
    }

    if (process.env.NODE_ENV !== "production" && tenantId && userId) {
      socket.data.tenantId = tenantId;
      socket.data.userId = userId;
      next();
      return;
    }

    next(new Error("Unauthorized"));
  });

  io.on("connection", (socket) => {
    const tenantId = socket.data.tenantId as string | undefined;
    const userId = socket.data.userId as string | undefined;

    if (tenantId) {
      socket.join(organizationRoom(tenantId));
    }
    if (tenantId && userId) {
      socket.join(userRoom(tenantId, userId));
    }

    socket.on("conversation.join", (payload: { conversationId?: string }) => {
      if (!tenantId || !payload.conversationId) return;
      socket.join(conversationRoom(tenantId, payload.conversationId));
    });

    socket.on("conversation.leave", (payload: { conversationId?: string }) => {
      if (!tenantId || !payload.conversationId) return;
      socket.leave(conversationRoom(tenantId, payload.conversationId));
    });

    socket.on("internal_chat.join", (payload: { roomId?: string }) => {
      if (!tenantId || !payload.roomId) return;
      socket.join(internalChatRoom(tenantId, payload.roomId));
    });

    socket.on("internal_chat.leave", (payload: { roomId?: string }) => {
      if (!tenantId || !payload.roomId) return;
      socket.leave(internalChatRoom(tenantId, payload.roomId));
    });

    socket.on("disconnect", () => {
      // Presence lease expiry handled server-side.
    });
  });
}
