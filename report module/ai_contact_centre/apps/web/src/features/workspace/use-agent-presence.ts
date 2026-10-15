import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { getSipCallStatus, setSipAgentPresenceState } from "@/features/voice/sip-ua";
import { workspaceApi, WORKSPACE_PRESENCE_UPDATED, type PresenceState } from "./api";
import { applyPresenceAfterLogin, loginToolbarPresence } from "./login-presence";
import { notifyPresenceUpdated } from "./presence-session";

let sharedPresenceState: PresenceState = "not_ready";
let sharedPresenceInitialized = false;
let initializationPromise: Promise<void> | null = null;
let loginStaleState: PresenceState | null = null;
const presenceListeners = new Set<() => void>();

function emitSharedPresence(state: PresenceState, initialized = true): void {
  sharedPresenceState = state;
  sharedPresenceInitialized = initialized;
  for (const listener of presenceListeners) listener();
}

function subscribeSharedPresence(listener: () => void): () => void {
  presenceListeners.add(listener);
  return () => presenceListeners.delete(listener);
}

function getSharedPresenceSnapshot(): string {
  return `${sharedPresenceState}:${sharedPresenceInitialized ? "1" : "0"}`;
}

function isLiveCall(): boolean {
  const sip = getSipCallStatus();
  return sip.callState !== "idle" || sip.awaitingDisposition;
}

function acceptServerPresence(state: PresenceState): void {
  const next = applyPresenceAfterLogin({
    incoming: state,
    ignoreUntilChanged: loginStaleState,
    liveCall: isLiveCall(),
  });
  if (!next.state) return;
  loginStaleState = next.ignoreUntilChanged;
  emitSharedPresence(next.state);
}

/** Drop the in-memory login badge so the next sign-in loads presence again. */
export function resetAgentPresenceClient(): void {
  initializationPromise = null;
  loginStaleState = null;
  sharedPresenceState = "not_ready";
  sharedPresenceInitialized = false;
  for (const listener of presenceListeners) listener();
}

function ensurePresenceInitialized(): Promise<void> {
  if (initializationPromise) return initializationPromise;
  initializationPromise = workspaceApi
    .initializePresence()
    .then(({ presence, initialized }) => {
      const choice = loginToolbarPresence({
        initialized,
        stored: presence?.state ?? null,
      });
      loginStaleState = choice.ignoreUntilChanged;
      emitSharedPresence(choice.display);
      if (!choice.ignoreUntilChanged && presence?.state) notifyPresenceUpdated(presence.state);
    })
    .catch(() => {
      emitSharedPresence("not_ready");
      initializationPromise = null;
    });
  return initializationPromise;
}

export function useAgentPresence() {
  useSyncExternalStore(
    subscribeSharedPresence,
    getSharedPresenceSnapshot,
    getSharedPresenceSnapshot,
  );
  const presenceState = sharedPresenceState;
  const presenceInitialized = sharedPresenceInitialized;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!presenceInitialized) return;
    setSipAgentPresenceState(presenceState);
  }, [presenceInitialized, presenceState]);

  useEffect(() => {
    void ensurePresenceInitialized();
  }, []);

  useEffect(() => {
    function handlePresence(event: Event) {
      const presence = (event as CustomEvent<{ state: PresenceState }>).detail;
      acceptServerPresence(presence.state);
    }
    window.addEventListener(WORKSPACE_PRESENCE_UPDATED, handlePresence);
    return () => window.removeEventListener(WORKSPACE_PRESENCE_UPDATED, handlePresence);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void workspaceApi.heartbeatPresence().then((presence) => {
        if (!presence?.state) return;
        acceptServerPresence(presence.state);
      });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const setPresence = useCallback(
    async (state: PresenceState) => {
      const previous = presenceState;
      setMenuOpen(false);
      try {
        console.info("[presence] sent to ACD", { state });
        const presence = await workspaceApi.updatePresence(
          state,
          state === "not_ready" ? "default_not_ready" : undefined,
          { source: "toolbar" },
        );
        if (presence.state !== state) {
          console.info("[presence] waiting for ACD", { requested: state, stored: presence.state });
          return;
        }
        loginStaleState = null;
        emitSharedPresence(presence.state);
        notifyPresenceUpdated(presence.state);
      } catch {
        emitSharedPresence(previous);
      }
    },
    [presenceState],
  );

  return {
    presenceState,
    menuOpen,
    setMenuOpen,
    setPresence,
  };
}
