const UUID_SUFFIX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRealAcdSessionId(sessionId: string | null | undefined): sessionId is string {
  return Boolean(sessionId && !sessionId.startsWith("sip-inbound:"));
}

export function sameVoiceSessionId(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftValue = left?.trim();
  const rightValue = right?.trim();
  if (!leftValue || !rightValue) return false;
  if (leftValue === rightValue) return true;
  const leftUuid = leftValue.match(UUID_SUFFIX)?.[0]?.toLowerCase();
  const rightUuid = rightValue.match(UUID_SUFFIX)?.[0]?.toLowerCase();
  return Boolean(leftUuid && rightUuid && leftUuid === rightUuid);
}

export function shouldApplyVoiceOpenedEvent(input: {
  callState: "idle" | "dialing" | "ringing" | "active";
  currentSessionId: string | null;
  eventSessionId: string;
}): boolean {
  if (input.callState === "idle") return true;
  if (!isRealAcdSessionId(input.currentSessionId)) return true;
  return sameVoiceSessionId(input.currentSessionId, input.eventSessionId);
}

export function resolveInboundWorkspaceSession(input: {
  sipSessionId: string | null;
  pendingSessionId: string | null;
}): string | null {
  if (isRealAcdSessionId(input.sipSessionId)) return input.sipSessionId;
  if (isRealAcdSessionId(input.pendingSessionId)) return input.pendingSessionId;
  return null;
}

/** B is only on the consult until A clicks Transfer. Do not open B's workspace yet. */
export function shouldHoldConsultWorkspace(input: {
  secondaryConsultOnly: boolean;
  consultAnswered?: boolean;
}): boolean {
  return input.secondaryConsultOnly || input.consultAnswered === true;
}

export function shouldOpenWorkspaceOnAcdEvent(input: {
  callState: "idle" | "dialing" | "ringing" | "active";
  inboundOffer: boolean;
  direction?: "inbound" | "outbound" | null;
  /** Set only for the ACD accepted/connected event, not for local SIP progress. */
  acdUserAccepted?: boolean;
}): boolean {
  if (input.inboundOffer) return false;
  if (input.direction === "outbound") return input.acdUserAccepted === true;
  return input.callState === "active" || input.callState === "dialing" || input.callState === "ringing";
}

export function shouldRecoverVoiceDisposition(input: {
  callState: "idle" | "dialing" | "ringing" | "active";
  inboundOffer: boolean;
  awaitingDisposition: boolean;
}): boolean {
  return input.callState === "idle" && !input.inboundOffer && !input.awaitingDisposition;
}
