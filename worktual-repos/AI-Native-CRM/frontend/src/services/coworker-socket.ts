import { io, type Socket } from "socket.io-client";

type CoworkerAgentTurnSocketPayload = {
  messages?: Array<{ role: "assistant" | "user"; text: string }>;
  context?: {
    module?: string | null;
    surface?: string | null;
    entityId?: string | null;
    pathname?: string | null;
    draft?: Record<string, unknown> | null;
    sessionMemory?: Record<string, unknown> | null;
  };
  sessionMemory?: Record<string, unknown> | null;
  confirmTool?: { name?: string; args?: Record<string, unknown> } | null;
  conversationId?: string;
  runId?: string;
  traceId?: string;
  idempotencyKey?: string;
  traceparent?: string;
};

const EVENT = "coworker:agent-turn";

/** Match backend AI_SERVICE_JOB_TIMEOUT_MS (210s) with headroom. */
const AGENT_TURN_ACK_MS = 240_000;

let socketSingleton: Socket | null = null;
let connectPromise: Promise<Socket> | null = null;

function formatSocketError(err: unknown): string {
  if (typeof err === "string" && err.trim()) {
    if (/timeout/i.test(err)) {
      return "The coworker connection timed out. Please try again.";
    }
    return err.trim();
  }
  if (err instanceof Error && err.message.trim()) {
    const msg = err.message.trim();
    if (/timeout/i.test(msg)) {
      return "The coworker connection timed out. Please try again.";
    }
    if (/disconnected|connection (?:lost|closed)/i.test(msg)) {
      return "Connection to the coworker dropped. Please try again.";
    }
    return msg;
  }
  return "Unable to reach the coworker service. Please try again.";
}

function resetSocketSingleton(): void {
  if (socketSingleton) {
    try {
      socketSingleton.removeAllListeners();
      socketSingleton.disconnect();
    } catch {
      /* ignore */
    }
  }
  socketSingleton = null;
  connectPromise = null;
}

function getSocket(): Socket {
  if (socketSingleton) return socketSingleton;

  // Always same-origin: Vite (dev) or the deployed SPA host proxies /socket-io
  // to Fastify. Connecting directly to :4000 breaks session cookies when the
  // page host is localhost but the socket target is 127.0.0.1 (or vice versa).
  socketSingleton = io({
    withCredentials: true,
    // Polling-only avoids flaky websocket upgrades through the dev proxy.
    transports: ["polling"],
    upgrade: false,
    path: "/socket-io",
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 800,
    timeout: 45_000,
  });
  return socketSingleton;
}

async function ensureConnected(): Promise<Socket> {
  let socket = getSocket();
  if (socket.connected) return socket;

  // Stuck mid-reconnect after API restart — hard reset before waiting.
  if (socket.active && !socket.connected) {
    resetSocketSingleton();
    socket = getSocket();
  }
  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve, reject) => {
    const connectDeadlineMs = 12_000;
    const timer = setTimeout(() => {
      cleanup();
      connectPromise = null;
      resetSocketSingleton();
      reject(new Error(formatSocketError("timeout")));
    }, connectDeadlineMs);

    const onConnect = () => {
      cleanup();
      connectPromise = null;
      resolve(socket);
    };
    const onError = (err: unknown) => {
      cleanup();
      connectPromise = null;
      resetSocketSingleton();
      reject(new Error(formatSocketError(err)));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };

    socket.once("connect", onConnect);
    socket.once("connect_error", onError);
    socket.connect();
  });
  return connectPromise;
}

async function emitAgentTurn(
  socket: Socket,
  payload: CoworkerAgentTurnSocketPayload,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket
      .timeout(AGENT_TURN_ACK_MS)
      .emit(EVENT, payload, (err: unknown, res: unknown) => {
        if (err) return reject(new Error(formatSocketError(err)));
        resolve(res);
      });
  });
}

export async function sendCoworkerAgentTurn(
  payload: CoworkerAgentTurnSocketPayload,
): Promise<unknown> {
  const socket = await ensureConnected();

  try {
    return await emitAgentTurn(socket, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const retryable =
      /disconnected|connection (?:lost|closed)|timed out/i.test(message);
    if (!retryable) {
      throw err;
    }
    // One reconnect + retry after transport drop (common on long turns / API restart).
    resetSocketSingleton();
    const fresh = await ensureConnected();
    return emitAgentTurn(fresh, payload);
  }
}
