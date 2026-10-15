import { isVoiceTransferFeatureReq } from "./sip-transfer";
import { sameVoiceSessionId } from "./voice-workspace-open";

export function shouldAcceptIncomingInvite(input: {
  hasActiveSession: boolean;
  callState: "idle" | "dialing" | "ringing" | "active";
  awaitingDisposition: boolean;
  presenceReady: boolean;
  isTransferOffer?: boolean;
}): boolean {
  return (
    (input.presenceReady || input.isTransferOffer === true) &&
    !input.hasActiveSession &&
    input.callState === "idle" &&
    !input.awaitingDisposition
  );
}

/** A Ready agent can take the next queue call once disposition is saved. */
export function queueInviteReadyAfterDisposition(presenceState: string | null): boolean {
  return presenceState === "ready";
}

/** Caller or ACD cancelled the INVITE before the agent connected. */
export function inboundInviteCancelledBeforeConnect(input: {
  direction: "inbound" | "outbound" | null;
  connectedAt: number | null;
  cause: string | null;
}): boolean {
  if (input.direction !== "inbound" || input.connectedAt) return false;
  const cause = (input.cause ?? "").trim().toLowerCase();
  return cause === "request terminated" || cause === "canceled" || cause === "cancelled";
}

/** A connected call stays Busy through wrap-up. Ready is published after that save. */
export function presenceAfterVoiceMediaEnded(needsDisposition: boolean): "ready" | null {
  return needsDisposition ? null : "ready";
}

/** Inbound Busy is published when the 200 OK is sent, not when Accept is clicked. */
export function shouldPublishInboundBusy(input: { event: "accept-click" | "sip-accepted" }): boolean {
  return input.event === "sip-accepted";
}

/**
 * A Ready agent whose ring was cancelled before connect must be published Ready
 * again. Accept already clears the offer, and that path publishes Ready itself.
 */
export function shouldRestoreReadyAfterCancelledRing(input: {
  presenceState: string | null;
  inboundOffer: boolean;
  connectedAt: number | null;
}): boolean {
  return input.presenceState === "ready" && input.inboundOffer && input.connectedAt == null;
}

/** Wrap-up only after the agent actually connected. A missed ring must not lock presence. */
export function voiceEndedNeedsDisposition(input: {
  conversationId: string | null;
  connectedAt: number | null;
  consultOnlySecondary?: boolean;
}): boolean {
  return Boolean(
    input.conversationId &&
      input.connectedAt &&
      input.consultOnlySecondary !== true,
  );
}

/** Live call locks the picker. Away after a missed offer must stay changeable. */
export function shouldLockAgentPresence(input: {
  callState: "idle" | "dialing" | "ringing" | "active";
  awaitingDisposition: boolean;
  presenceState: string;
}): boolean {
  if (input.presenceState === "away" || input.presenceState === "not_ready") {
    return input.callState === "dialing" || input.callState === "active";
  }
  return input.callState !== "idle" || input.awaitingDisposition;
}

export function inboundAcdContext(
  input: {
    acdSessionId: string | null;
    conversationId: string | null;
  },
  incomingSessionId: string | null,
): {
  acdSessionId: string | null;
  conversationId: string | null;
} {
  if (!incomingSessionId) {
    return { acdSessionId: null, conversationId: null };
  }
  const sameSession = sameVoiceSessionId(input.acdSessionId, incomingSessionId);
  return {
    acdSessionId: incomingSessionId,
    conversationId: sameSession ? input.conversationId : null,
  };
}

function headerValue(
  session: {
    request?: {
      getHeader?: (name: string) => string | undefined;
    } | null;
  },
  names: string[],
): string | null {
  for (const name of names) {
    const value = session.request?.getHeader?.(name)?.trim();
    if (value) return value;
  }
  return null;
}

/** Gateway puts the ACD session on `a=iuid:` when it is not a SIP header. */
export function acdSessionIdFromSdp(body: string | null | undefined): string | null {
  if (!body) return null;
  const match = body.match(/^(?:a=)?iuid:\s*(\S+)/im);
  const value = match?.[1]?.trim();
  return value || null;
}

function firstSipToken(value: string | undefined): string | null {
  const token = value?.trim().split(/\s+/)[0]?.replace(/[,;]+$/, "");
  return token || null;
}

/**
 * Old contact center reads the raw INVITE before SDP.
 * A queue call carries `iuid:`. A transfer carries `CCAAS-SESSION-ID` inside `ExtraRemote-Info`.
 */
export function acdSessionIdFromSipMessage(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const beforeSdp = raw.split(/v=0/i)[0] ?? "";
  const extraAt = beforeSdp.search(/ExtraRemote-Info:/i);
  const headers = extraAt >= 0 ? beforeSdp.slice(0, extraAt) : beforeSdp;
  const extra = extraAt >= 0 ? beforeSdp.slice(extraAt) : "";
  const transferId = firstSipToken(extra.split(/CCAAS-SESSION-ID:/i)[1]);
  if (transferId) return transferId;
  return firstSipToken(headers.split(/iuid:/i)[1]);
}

function rawSipMessage(session: {
  request?: { data?: unknown } | null;
  _request?: { data?: unknown } | null;
  incomingRequest?: { message?: { data?: unknown } | null } | null;
}): string | null {
  const data =
    session.request?.data ??
    session._request?.data ??
    session.incomingRequest?.message?.data;
  return typeof data === "string" && data.trim() ? data : null;
}

function requestBody(session: {
  request?: { body?: unknown; data?: unknown } | null;
}): string | null {
  const body = session.request?.body ?? session.request?.data;
  return typeof body === "string" && body.trim() ? body : null;
}

export function inboundAcdSessionFromSession(session: {
  request?: {
    getHeader?: (name: string) => string | undefined;
    body?: unknown;
    data?: unknown;
  } | null;
  _request?: { data?: unknown; body?: unknown; getHeader?: (name: string) => string | undefined } | null;
  incomingRequest?: { message?: { data?: unknown } | null } | null;
}): string | null {
  const request = session.request ?? session._request ?? null;
  return (
    headerValue({ request }, ["CCAAS-SESSION-ID", "Ccaas-Session-Id", "iuid", "Iuid"]) ??
    acdSessionIdFromSipMessage(rawSipMessage(session)) ??
    acdSessionIdFromSdp(requestBody({ request }))
  );
}

export function inboundVoiceTransferFromSession(session: {
  request?: {
    getHeader?: (name: string) => string | undefined;
    data?: unknown;
  } | null;
  _request?: { data?: unknown; getHeader?: (name: string) => string | undefined } | null;
  incomingRequest?: { message?: { data?: unknown } | null } | null;
}): boolean {
  const request = session.request ?? session._request ?? null;
  const raw = rawSipMessage({ ...session, request });
  const extra = raw?.split(/v=0/i)[0]?.split(/ExtraRemote-Info:/i)[1] ?? "";
  return (
    isVoiceTransferFeatureReq(
      headerValue({ request }, ["CCAAS-FEATURE-REQ", "Ccaas-Feature-Req"]),
    ) ||
    headerValue({ request }, ["CCAAS-TRANSFER-TYPE", "Ccaas-Transfer-Type"])?.toUpperCase() ===
      "AGENT" ||
    /CCAAS-SESSION-ID:/i.test(extra) ||
    /CCAAS-FEATURE-REQ:\s*TRANSFER/i.test(extra)
  );
}

export function inboundCallerFromSession(session: {
  remote_identity?: { uri?: { user?: string | null } | null } | null;
}): string | null {
  const user = session.remote_identity?.uri?.user?.trim();
  return user || null;
}

export function inboundSipRejectionOptions(): {
  status_code: 486;
  reason_phrase: "Busy Here";
} {
  return {
    status_code: 486,
    reason_phrase: "Busy Here",
  };
}

export function inboundSipBusyOptions(): {
  status_code: 600;
  reason_phrase: "Busy Everywhere";
} {
  return {
    status_code: 600,
    reason_phrase: "Busy Everywhere",
  };
}
