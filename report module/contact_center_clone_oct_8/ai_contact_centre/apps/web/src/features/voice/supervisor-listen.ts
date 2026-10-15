import { useSyncExternalStore } from "react";

import { workspaceApi } from "@/features/workspace/api";
import {
  beginSupervisorListenInvite,
  endSupervisorListenInvite,
  primeSupervisorListenAudio,
  setSupervisorListenEndedHandler,
  setSupervisorListenMuted,
  setSupervisorListenVoice,
  supervisorListenInviteActive,
} from "@/features/voice/sip-ua";

export type SupervisorMonitorMode = "listen" | "whisper" | "barge";

export type SupervisorListenState = {
  conversationId: string | null;
  phase: "idle" | "starting" | "listening";
  mode: SupervisorMonitorMode;
  muted: boolean;
  error: string | null;
};

const idle: SupervisorListenState = {
  conversationId: null,
  phase: "idle",
  mode: "listen",
  muted: false,
  error: null,
};

let state: SupervisorListenState = idle;
let stopping = false;
const listeners = new Set<() => void>();

setSupervisorListenEndedHandler((reason) => {
  if (stopping) return;
  const conversationId = state.conversationId;
  emit({
    conversationId: null,
    phase: "idle",
    mode: "listen",
    muted: false,
    error: reason ?? "Listen ended.",
  });
  if (!conversationId) return;
  void workspaceApi.cancelSupervisorListen(conversationId).catch(() => undefined);
});

function emit(next: SupervisorListenState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function getSupervisorListenState(): SupervisorListenState {
  return state;
}

export function useSupervisorListen(): SupervisorListenState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSupervisorListenState,
    getSupervisorListenState,
  );
}

export async function stopSupervisorListen(): Promise<void> {
  const conversationId = state.conversationId;
  if (!conversationId && !supervisorListenInviteActive()) {
    emit(idle);
    return;
  }
  stopping = true;
  try {
    if (conversationId) {
      await workspaceApi.cancelSupervisorListen(conversationId);
    }
    endSupervisorListenInvite();
    emit(idle);
  } finally {
    stopping = false;
  }
}

/** Publish Listen, then send the supervisor INVITE. A second click on the same call does nothing. */
export async function listenToLiveConversation(conversationId: string): Promise<void> {
  if (
    state.conversationId === conversationId &&
    (state.phase === "listening" || state.phase === "starting")
  ) {
    return;
  }
  if (state.phase === "starting") return;
  if (state.conversationId && state.conversationId !== conversationId) {
    try {
      await stopSupervisorListen();
    } catch (error) {
      emit({
        ...state,
        error: error instanceof Error ? error.message : "Unable to leave the current listen",
      });
      return;
    }
  }
  primeSupervisorListenAudio();
  emit({ conversationId, phase: "starting", mode: "listen", muted: false, error: null });
  try {
    const started = await workspaceApi.startSupervisorListen(conversationId);
    const invited = beginSupervisorListenInvite(started.sessionId);
    if (!invited) {
      await workspaceApi.cancelSupervisorListen(conversationId).catch(() => undefined);
      emit({
        conversationId: null,
        phase: "idle",
        mode: "listen",
        muted: false,
        error: "SIP is not ready to listen. Register and end any call in this browser first.",
      });
      return;
    }
    emit({ conversationId, phase: "listening", mode: "listen", muted: false, error: null });
  } catch (error) {
    endSupervisorListenInvite();
    emit({
      conversationId: null,
      phase: "idle",
      mode: "listen",
      muted: false,
      error: error instanceof Error ? error.message : "Unable to start listen",
    });
  }
}

const monitorSwitchType: Record<SupervisorMonitorMode, 1 | 2 | 3> = {
  listen: 1,
  whisper: 2,
  barge: 3,
};

/** Whisper and barge stay on the open listen leg. The same button again returns to Listen. */
export async function setSupervisorMonitorMode(mode: Exclude<SupervisorMonitorMode, "listen">): Promise<void> {
  if (state.phase !== "listening" || !state.conversationId) {
    emit({ ...state, error: "Listen to the call before whisper or barge." });
    return;
  }
  const next: SupervisorMonitorMode = state.mode === mode ? "listen" : mode;
  if (next === state.mode) return;
  const conversationId = state.conversationId;
  const previous = state.mode;
  try {
    if (next === "listen") {
      await workspaceApi.switchSupervisorListen(conversationId, 1);
      await setSupervisorListenVoice(false);
    } else {
      await setSupervisorListenVoice(true);
      await workspaceApi.switchSupervisorListen(conversationId, monitorSwitchType[next]);
    }
    if (state.conversationId !== conversationId || state.phase !== "listening") return;
    emit({
      ...state,
      conversationId,
      phase: "listening",
      mode: next,
      muted: next === "listen" || previous === "listen" ? false : state.muted,
      error: null,
    });
  } catch (error) {
    if (next !== "listen" && previous === "listen") {
      await setSupervisorListenVoice(false).catch(() => undefined);
    }
    emit({
      ...state,
      error: error instanceof Error ? error.message : "Unable to change supervisor audio",
    });
  }
}

/** Local microphone only. Whisper and barge do not tell UMN about mute. */
export function setSupervisorMonitorMuted(muted: boolean): void {
  if (state.phase !== "listening") return;
  if (state.mode !== "whisper" && state.mode !== "barge") return;
  setSupervisorListenMuted(muted);
  emit({ ...state, muted });
}
