import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { setSipAgentPresenceState } from "@/features/voice/sip-ua";
import { workspaceApi, WORKSPACE_PRESENCE_UPDATED, type PresenceState } from "./api";
import { notifyPresenceUpdated } from "./presence-session";

let sharedPresenceState: PresenceState = "not_ready";
let sharedPresenceInitialized = false;
let initializationPromise: Promise<void> | null = null;
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

function ensurePresenceInitialized(): Promise<void> {
  if (initializationPromise) return initializationPromise;
  initializationPromise = workspaceApi
    .initializePresence()
    .then(({ presence }) => {
      emitSharedPresence(presence?.state ?? "offline");
      if (presence?.state) notifyPresenceUpdated(presence.state);
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
      emitSharedPresence(presence.state);
    }
    window.addEventListener(WORKSPACE_PRESENCE_UPDATED, handlePresence);
    return () => window.removeEventListener(WORKSPACE_PRESENCE_UPDATED, handlePresence);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void workspaceApi.heartbeatPresence().then((presence) => {
        if (!presence?.state) return;
        emitSharedPresence(presence.state);
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
