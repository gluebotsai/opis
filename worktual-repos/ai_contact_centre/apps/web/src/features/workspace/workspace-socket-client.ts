import { io, type Socket } from "socket.io-client";

import { env } from "@/config/env";
import { readAuthFromStorage } from "@/services/http";

let socket: Socket | null = null;
let socketAuthKey: string | null = null;

function socketKey(auth: ReturnType<typeof readAuthFromStorage>): string {
  return `${auth.token ?? ""}:${auth.organizationId ?? ""}:${auth.userId ?? ""}`;
}

export function getOrCreateWorkspaceSocket(auth: ReturnType<typeof readAuthFromStorage>): Socket {
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
