import type { PresenceState } from "./api";

export type LoginPresenceChoice = {
  display: PresenceState;
  /** Stored status from before this sign-in. A later read of this same status must not replace Not Ready. */
  ignoreUntilChanged: PresenceState | null;
};

/** A new sign-in shows Not Ready. A refresh keeps the saved status, including Busy on a call. */
export function loginToolbarPresence(input: {
  initialized: boolean;
  stored: PresenceState | null;
}): LoginPresenceChoice {
  if (!input.initialized) {
    return {
      display: input.stored ?? "not_ready",
      ignoreUntilChanged: null,
    };
  }
  return {
    display: "not_ready",
    ignoreUntilChanged:
      input.stored && input.stored !== "not_ready" ? input.stored : null,
  };
}

/** Returns null when this update is the stale status saved before login. */
export function applyPresenceAfterLogin(input: {
  incoming: PresenceState;
  ignoreUntilChanged: PresenceState | null;
  liveCall: boolean;
}): { state: PresenceState | null; ignoreUntilChanged: PresenceState | null } {
  const hold = input.ignoreUntilChanged;
  if (hold && input.incoming === hold && !input.liveCall) {
    return { state: null, ignoreUntilChanged: hold };
  }
  return { state: input.incoming, ignoreUntilChanged: null };
}
