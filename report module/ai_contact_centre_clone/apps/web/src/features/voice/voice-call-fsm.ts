export type VoiceCallPhase =
  | "idle"
  | "ringing"
  | "established"
  | "consult_pending"
  | "consult_active"
  | "merge_requested"
  | "conferenced"
  | "transfer_requested"
  | "transferred"
  | "wrap_up"
  | "closed";

const transitions: Record<VoiceCallPhase, ReadonlySet<VoiceCallPhase>> = {
  idle: new Set(["ringing", "established", "closed"]),
  ringing: new Set(["established", "idle", "closed"]),
  established: new Set(["consult_pending", "wrap_up", "closed"]),
  consult_pending: new Set(["consult_active", "established", "wrap_up", "closed"]),
  consult_active: new Set([
    "established",
    "merge_requested",
    "transfer_requested",
    "wrap_up",
    "closed",
  ]),
  merge_requested: new Set(["consult_active", "conferenced", "wrap_up", "closed"]),
  conferenced: new Set(["transferred", "wrap_up", "closed"]),
  transfer_requested: new Set(["consult_active", "transferred", "wrap_up", "closed"]),
  transferred: new Set(["wrap_up", "closed"]),
  wrap_up: new Set(["closed", "idle"]),
  closed: new Set(["idle", "ringing", "established"]),
};

export function canTransitionVoiceCall(
  current: VoiceCallPhase,
  next: VoiceCallPhase,
): boolean {
  return current === next || transitions[current].has(next);
}

export function transitionVoiceCall(
  current: VoiceCallPhase,
  next: VoiceCallPhase,
): VoiceCallPhase {
  if (!canTransitionVoiceCall(current, next)) {
    throw new Error(`Invalid voice call transition: ${current} -> ${next}`);
  }
  return next;
}
