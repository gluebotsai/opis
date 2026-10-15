/**
 * Shared realtime co-worker contract: session_ready merge, welcomes, dedupe.
 */
import type { ChatMessage } from "@/lib/campaign-drafts";
import {
  dedupeConsecutiveUserMessages,
  mergeMessagesServerWinsPendingLocal,
} from "@/lib/campaign-drafts";
import {
  pickModuleWelcome,
  type WelcomeModule,
} from "@/lib/module-welcomes";

export type SessionReadyPhase = "initial" | "hydration";

export type SessionReadyPayload = {
  ready_phase?: string;
  session_id?: string;
  module?: string;
  messages?: unknown[];
};

export function sessionReadyPhase(payload: SessionReadyPayload): SessionReadyPhase {
  return payload.ready_phase === "hydration" ? "hydration" : "initial";
}

export function isHydrationSessionReady(payload: SessionReadyPayload): boolean {
  return sessionReadyPhase(payload) === "hydration";
}

type Row = { role?: string; text?: string };

export function transcriptHasUser(rows: Row[]): boolean {
  return rows.some((m) => m.role === "user" && String(m.text || "").trim());
}

/** Keep optimistic / in-flight local thread when server transcript lags. */
export function shouldPreserveLocalTranscriptOnReady(options: {
  prev: Row[];
  remote: Row[];
  busy?: boolean;
  followUpReady?: boolean;
  hydration?: boolean;
}): boolean {
  const { prev, remote, busy = false, followUpReady = false, hydration = false } =
    options;
  const localHasUser = transcriptHasUser(prev);
  const remoteHasUser = transcriptHasUser(remote);
  if (localHasUser && !remoteHasUser) return true;
  if (prev.length > remote.length && localHasUser) return true;
  if (busy && followUpReady && hydration) return true;
  if (busy && followUpReady && localHasUser && !remoteHasUser) return true;
  return false;
}

/** Apply session_ready messages without wiping an in-flight user turn. */
export function applySessionReadyChatMessages(
  prev: ChatMessage[],
  remote: ChatMessage[],
  options: {
    busy?: boolean;
    followUpReady?: boolean;
    hydration?: boolean;
  } = {},
): ChatMessage[] {
  if (
    shouldPreserveLocalTranscriptOnReady({
      prev,
      remote,
      ...options,
    })
  ) {
    return prev;
  }
  if (!remote.length) return dedupeConsecutiveUserMessages(prev);
  if (!prev.length) return dedupeConsecutiveUserMessages(remote);
  return dedupeConsecutiveUserMessages(
    mergeMessagesServerWinsPendingLocal(prev, remote),
  );
}

export function moduleStaticWelcomeMessage(module: WelcomeModule): ChatMessage {
  return {
    id: `welcome-${module}-${crypto.randomUUID()}`,
    role: "assistant",
    text: pickModuleWelcome(module),
  };
}

export function appendAssistantDeduped(
  prev: ChatMessage[],
  text: string,
): ChatMessage[] {
  const trimmed = text.trim();
  if (!trimmed) return prev;
  const last = prev[prev.length - 1];
  if (last?.role === "assistant" && last.text.trim() === trimmed) return prev;
  return [
    ...prev,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      text: trimmed,
    },
  ];
}

export function isAgentBusyError(payload: {
  message?: string;
  code?: string;
}): boolean {
  if (payload.code === "agent_busy") return true;
  return /wait for the current agent response/i.test(payload.message || "");
}
