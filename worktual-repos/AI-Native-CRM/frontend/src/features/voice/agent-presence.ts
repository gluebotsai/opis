/**
 * Header presence. The badge changes when ACD confirms on the subscribe channel.
 * Port of ai_contact_centre use-agent-presence + shouldLockAgentPresence.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getOutboundCallState, subscribeOutboundCall } from "@/features/voice/sip-ua";
import {
  getPresence,
  initializePresence,
  updatePresence,
  type AgentPresence,
  type PresenceState,
} from "@/services/presence";

const LOGIN_KEY = "crm-presence-login";

export const PRESENCE_OPTIONS: { label: string; state: PresenceState; dot: string }[] = [
  { label: "Ready", state: "ready", dot: "bg-emerald-500" },
  { label: "Not Ready", state: "not_ready", dot: "bg-neutral-400" },
  { label: "Busy", state: "busy", dot: "bg-red-500" },
  { label: "Away", state: "away", dot: "bg-amber-500" },
];

const fallback: AgentPresence = {
  state: "not_ready",
  statusName: "Not Ready",
  confirmed: false,
};

let shared: AgentPresence = fallback;
const listeners = new Set<() => void>();
let boot: Promise<void> | null = null;

function emit(presence: AgentPresence): void {
  shared = presence;
  for (const listener of listeners) listener();
}

/** Local badge update. Call end uses this so Ready shows without waiting on ACD. */
export function applyAgentPresence(presence: AgentPresence): void {
  emit(presence);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string {
  return `${shared.state}:${shared.confirmed ? "1" : "0"}`;
}

/** Away and Not Ready stay changeable unless the call is dialing or connected. */
export function shouldLockAgentPresence(input: {
  callPhase: "idle" | "dialing" | "ringing" | "active";
  presenceState: string;
}): boolean {
  if (input.presenceState === "away" || input.presenceState === "not_ready") {
    return input.callPhase === "dialing" || input.callPhase === "active";
  }
  return input.callPhase !== "idle";
}

export function presenceLabel(state: PresenceState): string {
  return PRESENCE_OPTIONS.find((option) => option.state === state)?.label ?? "Busy";
}

export function presenceDot(state: PresenceState): string {
  return PRESENCE_OPTIONS.find((option) => option.state === state)?.dot ?? "bg-neutral-400";
}

export function clearPresenceLoginFlag(): void {
  sessionStorage.removeItem(LOGIN_KEY);
  shared = fallback;
  boot = null;
  for (const listener of listeners) listener();
}

function ensureLoaded(): Promise<void> {
  if (boot) return boot;
  boot = (async () => {
    if (sessionStorage.getItem(LOGIN_KEY) === "1") {
      emit(await getPresence());
      return;
    }
    const presence = await initializePresence();
    sessionStorage.setItem(LOGIN_KEY, "1");
    emit(presence);
  })().catch(() => {
    emit(fallback);
    boot = null;
  });
  return boot;
}

export function useAgentPresence() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const [menuOpen, setMenuOpen] = useState(false);
  const call = useSyncExternalStore(subscribeOutboundCall, getOutboundCallState, getOutboundCallState);
  const locked = shouldLockAgentPresence({
    callPhase: call.phase,
    presenceState: shared.state,
  });

  useEffect(() => {
    void ensureLoaded();
  }, []);

  useEffect(() => {
    if (locked) setMenuOpen(false);
  }, [locked]);

  useEffect(() => {
    const source = new EventSource("/api/voice/presence/events", { withCredentials: true });
    const onPresence = (event: Event) => {
      try {
        const presence = JSON.parse((event as MessageEvent).data) as AgentPresence;
        if (!presence?.state) return;
        const phase = getOutboundCallState().phase;
        if (phase !== "idle" && presence.state !== "busy") return;
        console.info("[presence] ACD confirmed", presence);
        emit(presence);
      } catch {
        /* ping */
      }
    };
    source.addEventListener("presence", onPresence);
    return () => {
      source.removeEventListener("presence", onPresence);
      source.close();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void getPresence()
        .then((presence) => {
          if (!presence.confirmed) return;
          const phase = getOutboundCallState().phase;
          if (phase !== "idle" && presence.state !== "busy") return;
          emit(presence);
        })
        .catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const setPresence = useCallback(async (state: PresenceState) => {
    setMenuOpen(false);
    if (state === "busy" || state === shared.state) return;
    const previous = shared;
    const statusName = PRESENCE_OPTIONS.find((option) => option.state === state)?.label ?? "Busy";
    emit({ state, statusName, confirmed: false });
    try {
      console.info("[presence] sent to ACD", { state });
      const presence = await updatePresence(state);
      emit(presence.state === state ? presence : { state, statusName, confirmed: false });
    } catch (error) {
      emit(previous);
      console.info(
        "[presence] publish failed",
        error instanceof Error ? error.message : error,
      );
    }
  }, []);

  return {
    presence: shared,
    menuOpen,
    setMenuOpen,
    setPresence,
    locked,
  };
}
