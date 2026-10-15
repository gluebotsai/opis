/**
 * Shared agents Socket.IO join helpers for embed soft-nav reliability.
 */
import type { Socket } from "socket.io-client";
import { getAgentsSocket, refreshAgentsSocketAuth } from "@/services/agents.socket";
import { getToken } from "@/services/api";

export type JoinSessionPayload = {
  session_id: string;
  module: string;
  token?: string;
  client_timezone?: string;
  [key: string]: unknown;
};

/** Browser IANA timezone for agent scheduling and relative dates (today, tomorrow). */
export function clientTimezoneForAgentsJoin(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
    return tz || undefined;
  } catch {
    return undefined;
  }
}

/** Merge client_timezone into a join_session payload when the browser exposes it. */
export function withClientTimezone<T extends JoinSessionPayload>(payload: T): T {
  const client_timezone =
    payload.client_timezone ?? clientTimezoneForAgentsJoin();
  if (!client_timezone) return payload;
  return { ...payload, client_timezone };
}

/** Ensure socket is connected with the latest embed/SPA JWT before join_session. */
export function ensureAgentsSocketReady(): Socket {
  refreshAgentsSocketAuth();
  return getAgentsSocket();
}

/**
 * Hub and draft share one Socket.IO client. Only the claimed session_id may
 * emit join_session so a stale hub `connect` listener cannot steal the draft.
 */
let createCampaignSocketSessionId: string | null = null;

export function claimedCreateCampaignSocketSession(): string | null {
  return createCampaignSocketSessionId;
}

export function claimCreateCampaignSocketSession(sessionId: string): void {
  const id = String(sessionId || "").trim();
  if (!id) return;
  createCampaignSocketSessionId = id;
}

export function releaseCreateCampaignSocketSession(sessionId: string): void {
  const id = String(sessionId || "").trim();
  if (createCampaignSocketSessionId === id) {
    createCampaignSocketSessionId = null;
  }
}

/** True when this session owns the shared create-campaign socket (or none claimed yet). */
export function canJoinCreateCampaignSocketSession(sessionId: string): boolean {
  const id = String(sessionId || "").trim();
  if (!id) return false;
  const claimed = createCampaignSocketSessionId;
  if (!claimed) return true;
  return claimed === id;
}

export function resetCreateCampaignSocketSessionClaimForTests(): void {
  createCampaignSocketSessionId = null;
}

/** Socket.IO namespace handshake failure (`44"Unable to connect"`). */
export function isAgentsUnableToConnectError(message: unknown): boolean {
  if (typeof message === "string") {
    return /unable to connect/i.test(message);
  }
  if (message && typeof message === "object") {
    const err = message as { message?: unknown };
    return /unable to connect/i.test(String(err.message || ""));
  }
  return false;
}

/** Register join on connect (caller must socket.off in cleanup). */
export function bindJoinOnConnect(socket: Socket, join: () => void): void {
  socket.on("connect", join);
  if (socket.connected) join();
}

/** Single join_session emit (safe for retry timers — no extra connect listeners). */
export function emitJoinSessionNow(
  socket: Socket,
  payload: JoinSessionPayload,
): void {
  const token = payload.token || getToken();
  if (!token) return;
  socket.emit("join_session", withClientTimezone({ ...payload, token }));
}

/**
 * Emit join_session now and on reconnect until `dispose()` (avoids leaked once handlers).
 */
export function emitJoinSession(
  socket: Socket,
  payload: JoinSessionPayload,
): () => void {
  const join = () => emitJoinSessionNow(socket, payload);
  socket.on("connect", join);
  if (socket.connected) join();
  return () => {
    socket.off("connect", join);
  };
}

/** Update dashboard Overview period on the agent session without re-joining (keeps chat UI). */
export function emitUpdateDashboardPeriod(
  socket: Socket,
  payload: {
    session_id: string;
    module: string;
    token?: string;
    dashboard_period: Record<string, unknown>;
    dashboard_snapshot?: Record<string, unknown> | null;
    events_snapshot?: Record<string, unknown> | null;
  },
): () => void {
  const token = payload.token || getToken();
  if (!token) return () => {};
  const send = () => {
    if (claimedCreateCampaignSocketSession()) return;
    socket.emit("update_dashboard_period", { ...payload, token });
  };
  const onConnect = () => send();
  if (socket.connected) send();
  else socket.on("connect", onConnect);
  return () => {
    socket.off("connect", onConnect);
  };
}

export function emitLeaveSession(
  socket: Socket,
  sessionId: string,
  module?: string,
): void {
  const token = getToken();
  socket.emit("leave_session", {
    session_id: sessionId,
    ...(token ? { token } : {}),
    ...(module ? { module } : {}),
  });
}
