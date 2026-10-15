import { io, type Socket } from "socket.io-client";

import { env } from "@/config/env";

const STORAGE_KEY = "cc2_auth_user";

let socket: Socket | null = null;

function readSocketAuth(): { token?: string; tenantId?: string; userId?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return import.meta.env.DEV
        ? { tenantId: env.tenantId, userId: env.userId }
        : {};
    }
    const parsed = JSON.parse(raw) as {
      token?: string;
      organizationId?: string;
      id?: string;
    };
    const tenantId =
      typeof parsed.organizationId === "string" && /^\d+$/.test(parsed.organizationId)
        ? parsed.organizationId
        : import.meta.env.DEV
          ? env.tenantId
          : undefined;
    const userId =
      typeof parsed.id === "string" && /^\d+$/.test(parsed.id)
        ? parsed.id
        : import.meta.env.DEV
          ? env.userId
          : undefined;
    return {
      token: parsed.token,
      tenantId,
      userId,
    };
  } catch {
    return import.meta.env.DEV
      ? { tenantId: env.tenantId, userId: env.userId }
      : {};
  }
}

/** Socket.IO client for cc-core realtime. Connect only after auth. */
export function getSocket(): Socket {
  if (!socket) {
    const auth = readSocketAuth();
    socket = io(env.socketUrl, {
      autoConnect: false,
      transports: ["websocket", "polling"],
      path: env.socketPath,
      auth: {
        token: auth.token,
        tenantId: auth.tenantId,
        userId: auth.userId,
      },
    });
  }
  return socket;
}

export function connectSocket(): void {
  const auth = readSocketAuth();
  const s = getSocket();
  s.auth = {
    token: auth.token,
    tenantId: auth.tenantId,
    userId: auth.userId,
  };
  if (!s.connected) s.connect();
}

export function disconnectSocket(): void {
  if (socket?.connected) socket.disconnect();
}
