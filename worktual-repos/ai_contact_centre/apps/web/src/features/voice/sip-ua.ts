import JsSIP from "jssip";

import { callServiceApi, type OutboundCallerOption, type SipUaSession } from "@/services/call-service";
import {
  discoverViaHost,
  peerConnectionIceServers,
  sipContactUri,
} from "@/features/voice/sip-via-host";
import {
  inboundAcdContext,
  inboundAcdSessionFromSession,
  inboundInviteCancelledBeforeConnect,
  queueInviteReadyAfterDisposition,
  shouldPublishInboundBusy,
  shouldRestoreReadyAfterCancelledRing,
  inboundCallerFromSession,
  inboundSipBusyOptions,
  inboundSipRejectionOptions,
  inboundVoiceTransferFromSession,
  presenceAfterVoiceMediaEnded,
  shouldAcceptIncomingInvite,
  voiceEndedNeedsDisposition,
} from "@/features/voice/sip-inbound";
import {
  type ConsultCallState,
  type VoiceTransferAction,
  TRANSFER_ACTION_TRANSFEROR_CANCEL,
  TRANSFER_ACTION_TRANSFEROR_ENDALL,
  TRANSFER_ACTION_TRANSFEROR_LEAVE,
  TRANSFER_ACTION_TRANSFEROR_MERGE,
  TRANSFER_ACTION_TRANSFEROR_TRANSFER,
  acdActionForVoiceHangup,
  hangupTeardownOrder,
  canStartVoiceConsultInvite,
  isVoiceConsultInviteForExt,
  isVoiceConsultRinging,
  isSupervisorListenInvite,
  voiceSupervisorListenHeaders,
  voiceTransferInviteHeaders,
} from "@/features/voice/sip-transfer";
import {
  applyLegacySipHeaders,
  isIncomingSipBye,
  isIncomingSipInfo,
  normalizeDialedNumber,
  randomInviteContactUser,
  registeredHostPortFromRegister200,
  normalizeRemoteAnswerSdp,
  sipInviteTarget,
  sipOkForIncomingBye,
  sipOkForIncomingInfo,
} from "@/features/voice/sip-outbound";
import {
  type SipDialogIdentity,
  type SipDialogLeg,
  SipDialogRegistry,
} from "@/features/voice/sip-dialog";
import {
  shouldKeepConsultPlayback,
  shouldPlayCustomerConferenceTrack,
} from "@/features/voice/sip-remote-mix";
import {
  persistVoiceCallSession,
  readPersistedVoiceCallSession,
} from "@/features/voice/voice-call-session";
import {
  transitionVoiceCall,
  type VoiceCallPhase,
} from "@/features/voice/voice-call-fsm";
import {
  clearPendingVoiceConsultWorkspace,
  rememberInboundVoiceConsultSession,
} from "@/features/voice/voice-consult-workspace";
import { persistWorkspaceSelection } from "@/features/workspace/workspace-session";
import { apiV1 } from "@/config/api-paths";
import { env } from "@/config/env";
import { workspaceApi } from "@/features/workspace/api";
import { notifyPresenceUpdated } from "@/features/workspace/presence-session";
import { readAuthFromStorage } from "@/services/http";

const SIP_USER_AGENT = "CCAAS:BROWSER";

type JsSipRegistrator = {
  _contact?: string;
  setExtraContactParams?: (params: Record<string, never>) => void;
};

type JsSipRtcSession = {
  direction?: "incoming" | "outgoing";
  terminate: (options?: { status_code?: number; reason_phrase?: string }) => void;
  answer?: (options: Record<string, unknown>) => void;
  hold?: (options?: Record<string, unknown>, done?: () => void) => void;
  unhold?: (options?: Record<string, unknown>, done?: () => void) => void;
  mute?: (options?: { audio?: boolean; video?: boolean }) => void;
  unmute?: (options?: { audio?: boolean; video?: boolean }) => void;
  isMuted?: () => { audio?: boolean };
  isOnHold?: () => { local?: boolean };
  connection?: RTCPeerConnection;
  remote_identity?: { uri?: { user?: string | null } | null } | null;
  request?: {
    getHeader?: (name: string) => string | undefined;
  } | null;
  on: (event: string, handler: (event: unknown) => void) => void;
};

type JsSipUa = {
  start: () => void;
  stop: () => void;
  unregister: () => void;
  registrator: () => JsSipRegistrator;
  call: (target: string, options: Record<string, unknown>) => JsSipRtcSession;
  contact?: { uri?: { toString: () => string; host?: string; user?: string } };
  configuration?: { via_host?: string };
  on: (event: string, handler: (event: unknown) => void) => void;
};

type JsSipSocket = {
  send: (message: string) => boolean;
  connect: () => void;
  via_transport: string;
  _ws?: WebSocket | null;
};

export type SipCallState = "idle" | "dialing" | "ringing" | "active";

export type { OutboundCallerOption };

export type SipCallStatus = {
  phase: VoiceCallPhase;
  registered: boolean;
  callState: SipCallState;
  destination: string | null;
  error: string | null;
  canPlaceOutbound: boolean;
  outboundOptions: OutboundCallerOption[];
  muted: boolean;
  held: boolean;
  consultHeld: boolean;
  acdSessionId: string | null;
  conversationId: string | null;
  awaitingDisposition: boolean;
  remoteEnded: boolean;
  inboundOffer: boolean;
  inboundTransferOffer: boolean;
  direction: "inbound" | "outbound" | null;
  connectedAt: number | null;
  endedAt: number | null;
  consultState: ConsultCallState;
  consultExt: string | null;
  consultName: string | null;
  merged: boolean;
  transferConsultRole: "primary" | "secondary" | null;
  awaitingTransferredDisposition: boolean;
  transferredDispositionCompletesTransfer: boolean;
  awaitingMergeDisposition: boolean;
  secondaryConsultOnly: boolean;
};

const idleStatus: SipCallStatus = {
  phase: "idle",
  registered: false,
  callState: "idle",
  destination: null,
  error: null,
  canPlaceOutbound: false,
  outboundOptions: [],
  muted: false,
  held: false,
  consultHeld: false,
  acdSessionId: null,
  conversationId: null,
  awaitingDisposition: false,
  remoteEnded: false,
  inboundOffer: false,
  inboundTransferOffer: false,
  direction: null,
  connectedAt: null,
  endedAt: null,
  consultState: "idle",
  consultExt: null,
  consultName: null,
  merged: false,
  transferConsultRole: null,
  awaitingTransferredDisposition: false,
  transferredDispositionCompletesTransfer: false,
  awaitingMergeDisposition: false,
  secondaryConsultOnly: false,
};

let ua: JsSipUa | null = null;
let uaSession: SipUaSession | null = null;
let rtcSession: JsSipRtcSession | null = null;
let consultSession: JsSipRtcSession | null = null;
let inboundOfferAudible = false;
let pendingRemoteStream: MediaStream | null = null;
let pendingTransferHeaders: string[] | null = null;
let consultAcdPublished = false;
let consultAnsweredPublished = false;
let pendingConsultAction: VoiceTransferAction | null = null;
let mergeConsultLegEnded = false;
let monitorSession: JsSipRtcSession | null = null;
let monitorAudio: HTMLAudioElement | null = null;
let monitorSilence: { context: AudioContext; stream: MediaStream } | null = null;
let monitorMicrophone: MediaStream | null = null;
let pendingMonitorHeaders: string[] | null = null;
let monitorInviteUser: string | null = null;
let onMonitorEnded: ((reason?: string) => void) | null = null;
let remoteAudio: HTMLAudioElement | null = null;
let remoteAudioStream: MediaStream | null = null;
let customerConferenceAudio: HTMLAudioElement | null = null;
const watchedCustomerConferenceTracks = new WeakSet<MediaStreamTrack>();
const sipDialogs = new SipDialogRegistry();
let startGeneration = 0;
let pageExitHangupSent = false;
let presenceBeforeBusy: "ready" | "not_ready" | null = null;
let pendingOutboundNumber: string | null = null;
let status: SipCallStatus = { ...idleStatus };
let agentPresenceReady: boolean | null = null;
let agentPresenceState: string | null = null;
let inboundAnswerBusySent = false;
const persistedCall = readPersistedVoiceCallSession();
if (persistedCall) {
  status = {
    ...status,
    acdSessionId: persistedCall.acdSessionId,
    conversationId: persistedCall.conversationId,
    destination: persistedCall.destination,
  };
}
const statusListeners = new Set<() => void>();
const remoteAudioStreamListeners = new Set<() => void>();
let presenceUpdateQueue: Promise<void> = Promise.resolve();
let presenceGeneration = 0;

function log(message: string) {
  console.log(`[sip] ${message}`);
}

function logError(message: string, extra?: unknown) {
  if (extra !== undefined) {
    console.error(`[sip] ${message}`, extra);
    return;
  }
  console.error(`[sip] ${message}`);
}

/** Last connected conversation, so a late hangup can still open wrap-up after the id was cleared. */
let wrapUpConversationId: string | null = null;

function rememberWrapUpConversation(): void {
  if (status.conversationId && status.connectedAt) {
    wrapUpConversationId = status.conversationId;
  }
}

function setStatus(patch: Partial<SipCallStatus>) {
  status = { ...status, ...patch };
  rememberWrapUpConversation();
  if ("acdSessionId" in patch || "conversationId" in patch || "destination" in patch) {
    persistVoiceCallSession({
      acdSessionId: status.acdSessionId,
      conversationId: status.conversationId,
      destination: status.destination,
    });
    if (status.conversationId) persistWorkspaceSelection(status.conversationId);
    log(
      `session stored acd=${status.acdSessionId ?? "none"} conversation=${status.conversationId ?? "none"} dest=${status.destination ?? "none"}`,
    );
  }
  for (const listener of statusListeners) listener();
}

function setVoicePhase(next: VoiceCallPhase): void {
  try {
    setStatus({ phase: transitionVoiceCall(status.phase, next) });
  } catch (error) {
    logError("voice FSM transition rejected", error);
  }
}

function rememberPresenceBeforeBusy(
  next: "ready" | "not_ready" | "busy" | "after_contact_work",
): void {
  if (next === "busy") {
    if (agentPresenceState === "ready" || agentPresenceState === "not_ready") {
      presenceBeforeBusy = agentPresenceState;
    }
    return;
  }
  if (next === "ready" || next === "not_ready") presenceBeforeBusy = null;
}

function publishPresenceBeforeBusyOnPageExit(): void {
  const state = presenceBeforeBusy;
  if (state !== "ready" && state !== "not_ready") return;
  const auth = readAuthFromStorage();
  if (!auth.token) return;
  const base = env.ccCoreUrl.replace(/\/$/, "");
  void fetch(`${base}${apiV1("/workspace/presence")}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state,
      source: "voice",
      ...(state === "not_ready" ? { reasonCode: "default_not_ready" } : {}),
    }),
    keepalive: true,
  }).catch(() => undefined);
}

function setCallPresence(
  state: "ready" | "not_ready" | "busy" | "after_contact_work",
  reason?: string,
  options?: { isVoiceCallTransfer?: boolean },
): void {
  rememberPresenceBeforeBusy(state);
  const generation = ++presenceGeneration;
  console.info("[voice][presence] sent to ACD", {
    state,
    reason: reason ?? null,
    generation,
  });
  presenceUpdateQueue = presenceUpdateQueue
    .catch(() => undefined)
    .then(async () => {
      if (generation !== presenceGeneration) return;
      const presence = await workspaceApi.updatePresence(state, reason, {
        ...options,
        source: "voice",
      });
      if (generation !== presenceGeneration) return;
      console.info("[voice][presence] update.succeeded", {
        requestedState: state,
        appliedState: presence.state,
        reason: reason ?? null,
        generation,
      });
      notifyPresenceUpdated(presence.state);
    })
    .catch((error) => {
      logError(`${state} presence update failed`, error);
      console.error("[voice][presence] update.failed", {
        state,
        reason: reason ?? null,
        generation,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function getSipCallStatus(): SipCallStatus {
  return status;
}

export function subscribeSipCallStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getRemoteCustomerAudioStream(): MediaStream | null {
  return remoteAudioStream;
}

export function subscribeRemoteCustomerAudioStream(listener: () => void): () => void {
  remoteAudioStreamListeners.add(listener);
  return () => {
    remoteAudioStreamListeners.delete(listener);
  };
}

function setRemoteCustomerAudioStream(stream: MediaStream | null): void {
  if (remoteAudioStream === stream) return;
  remoteAudioStream = stream;
  for (const listener of remoteAudioStreamListeners) listener();
}

function sipText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data as ArrayBufferView);
  }
  return "";
}

let monitorListenStream: MediaStream | null = null;
const monitorListenStreamListeners = new Set<() => void>();

export function getMonitorListenAudioStream(): MediaStream | null {
  return monitorListenStream;
}

export function subscribeMonitorListenAudioStream(listener: () => void): () => void {
  monitorListenStreamListeners.add(listener);
  return () => {
    monitorListenStreamListeners.delete(listener);
  };
}

function setMonitorListenAudioStream(stream: MediaStream | null): void {
  if (monitorListenStream === stream) return;
  monitorListenStream = stream;
  for (const listener of monitorListenStreamListeners) listener();
}

function logSipMessage(direction: "sent" | "recv", raw: string) {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return;
  console.log(`[sip] ${direction}\n${text}\n`);
}

function headerTag(value: string | undefined): string | null {
  return value?.match(/(?:^|;)\s*tag=([^;>\s]+)/i)?.[1]?.trim() || null;
}

function dialogIdentityForSession(session: JsSipRtcSession): SipDialogIdentity | null {
  const getHeader = session.request?.getHeader;
  const callId = getHeader?.("Call-ID") ?? getHeader?.("call-id");
  if (!callId?.trim()) return null;
  return {
    callId: callId.trim(),
    localTag: headerTag(getHeader?.("To") ?? getHeader?.("to")),
    remoteTag: headerTag(getHeader?.("From") ?? getHeader?.("from")),
  };
}

function registerSessionDialog(session: JsSipRtcSession, leg: SipDialogLeg): void {
  const identity = dialogIdentityForSession(session);
  if (!identity) {
    console.warn("[voice][sip] dialog.register-skipped", { leg, reason: "missing-call-id" });
    return;
  }
  sipDialogs.register(identity, leg);
  console.info("[voice][sip] dialog.registered", {
    leg,
    callId: identity.callId,
    localTag: identity.localTag,
    remoteTag: identity.remoteTag,
    sessionId: status.acdSessionId,
    conversationId: status.conversationId,
  });
}

function wrapSipTrace(socket: JsSipSocket, inviteContactUser: string) {
  const send = socket.send.bind(socket);
  let registeredHostPort: string | null = null;

  socket.send = (message: string) => {
    let outbound = message;
    try {
      const text = sipText(message);
      if (text) {
        const transferHeaders = isVoiceConsultInviteForExt(text, status.consultExt)
          ? pendingTransferHeaders
          : isSupervisorListenInvite(text, monitorInviteUser)
            ? pendingMonitorHeaders
            : null;
        outbound = applyLegacySipHeaders(
          text,
          registeredHostPort,
          inviteContactUser,
          pendingOutboundNumber,
          transferHeaders,
        );
      }
    } catch (error) {
      logError("outbound SIP rewrite failed", error);
      outbound = message;
    }
    try {
      logSipMessage("sent", sipText(outbound) || sipText(message));
    } catch {
      // never block signaling
    }
    return send(outbound);
  };

  const connect = socket.connect.bind(socket);
  socket.connect = () => {
    connect();
    const ws = socket._ws;
    if (!ws || (ws as { __sipTrace?: boolean }).__sipTrace) return;
    (ws as { __sipTrace?: boolean }).__sipTrace = true;
    const onmessage = ws.onmessage;
    ws.onmessage = (event: MessageEvent) => {
      const text = sipText(event.data);
      logSipMessage("recv", text);
      const hostPort = registeredHostPortFromRegister200(text);
      if (hostPort && hostPort !== registeredHostPort) {
        registeredHostPort = hostPort;
        log(`REGISTER 200 Contact host ${hostPort}`);
      }
      if (isIncomingSipBye(text)) {
        const dialog = sipDialogs.resolve(text);
        if (!dialog) {
          console.warn("[voice][sip] dialog.unmatched", { method: "BYE" });
          onmessage?.call(ws, event);
          return;
        }
        const ok = sipOkForIncomingBye(text);
        if (ok) socket.send(ok);
        closeCallAfterRemoteBye(dialog.leg);
        return;
      }
      if (isIncomingSipInfo(text)) {
        const dialog = sipDialogs.resolve(text);
        if (!dialog) {
          onmessage?.call(ws, event);
          return;
        }
        const ok = sipOkForIncomingInfo(text);
        if (ok) socket.send(ok);
        return;
      }
      onmessage?.call(ws, event);
    };
  };
}

function ensureRemoteAudio(): HTMLAudioElement {
  if (!remoteAudio) {
    remoteAudio = new Audio();
    remoteAudio.autoplay = true;
    remoteAudio.setAttribute("playsinline", "true");
  }
  return remoteAudio;
}

function ensureCustomerConferenceAudio(): HTMLAudioElement {
  if (!customerConferenceAudio) {
    customerConferenceAudio = new Audio();
    customerConferenceAudio.autoplay = true;
    customerConferenceAudio.setAttribute("playsinline", "true");
  }
  return customerConferenceAudio;
}

function stopCustomerConferenceAudio(): void {
  if (!customerConferenceAudio) return;
  customerConferenceAudio.pause();
  customerConferenceAudio.srcObject = null;
}

function stopRemoteAudio() {
  setRemoteCustomerAudioStream(null);
  stopCustomerConferenceAudio();
  if (!remoteAudio) return;
  remoteAudio.pause();
  remoteAudio.srcObject = null;
}

function audioTrackKey(stream: MediaStream): string {
  return stream
    .getAudioTracks()
    .map((track) => track.id)
    .sort()
    .join(",");
}

function playSingleRemoteStream(stream: MediaStream) {
  if (stream.getAudioTracks().length === 0) {
    setRemoteCustomerAudioStream(null);
    return;
  }
  const audio = ensureRemoteAudio();
  const current = audio.srcObject instanceof MediaStream ? audio.srcObject : null;
  const replaced = !current || audioTrackKey(current) !== audioTrackKey(stream);
  if (replaced) {
    audio.srcObject = stream;
    setRemoteCustomerAudioStream(stream);
  }
  if (!replaced && !audio.paused) return;
  void audio.play().catch((error) => logError("remote audio play failed", error));
}

function playCustomerConferenceTrack(track: MediaStreamTrack): void {
  if (
    !shouldPlayCustomerConferenceTrack({
      merged: status.merged,
      muted: track.muted,
      ended: track.readyState === "ended",
    })
  ) {
    return;
  }
  const audio = ensureCustomerConferenceAudio();
  const current = audio.srcObject instanceof MediaStream ? audio.srcObject : null;
  if (current?.getAudioTracks()[0]?.id !== track.id) {
    audio.srcObject = new MediaStream([track]);
  }
  if (!audio.paused) return;
  void audio.play().catch((error) => logError("customer conference audio play failed", error));
}

function watchCustomerConferenceTrack(track: MediaStreamTrack): void {
  if (!watchedCustomerConferenceTracks.has(track)) {
    watchedCustomerConferenceTracks.add(track);
    track.addEventListener("unmute", () => playCustomerConferenceTrack(track));
    track.addEventListener("ended", () => {
      const audio = customerConferenceAudio;
      const current = audio?.srcObject instanceof MediaStream ? audio.srcObject : null;
      if (current?.getAudioTracks()[0]?.id !== track.id || !audio) return;
      audio.pause();
      audio.srcObject = null;
    });
  }
  playCustomerConferenceTrack(track);
}

function playRemoteStream(stream: MediaStream) {
  if (status.inboundOffer && !inboundOfferAudible) {
    pendingRemoteStream = stream;
    return;
  }
  pendingRemoteStream = null;
  playSingleRemoteStream(stream);
}

export function setInboundOfferAudible(audible: boolean): void {
  inboundOfferAudible = audible;
  if (audible && pendingRemoteStream) playRemoteStream(pendingRemoteStream);
}

function attachRemoteAudio(
  pc: RTCPeerConnection,
  leg: "customer" | "consult" = "customer",
) {
  const publish = (stream: MediaStream) => {
    if (
      shouldKeepConsultPlayback({
        leg,
        merged: status.merged,
        consultActive: Boolean(consultSession) && status.consultState !== "idle",
      })
    ) {
      return;
    }
    if (leg === "customer" && status.merged) {
      for (const track of stream.getAudioTracks()) watchCustomerConferenceTrack(track);
      return;
    }
    playRemoteStream(stream);
  };
  pc.addEventListener("track", (event) => {
    const stream = event.streams[0];
    if (stream) publish(stream);
  });
  const receivers = pc.getReceivers();
  const tracks = receivers
    .map((receiver) => receiver.track)
    .filter((track): track is MediaStreamTrack => Boolean(track && track.kind === "audio"));
  if (tracks.length > 0) publish(new MediaStream(tracks));
}

function causeFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const cause = (event as { cause?: unknown }).cause;
  return typeof cause === "string" && cause.length > 0 ? cause : null;
}

function clearRtcSession() {
  rtcSession = null;
  sipDialogs.unregisterLeg("customer");
  stopRemoteAudio();
}

function clearConsultSession() {
  consultSession = null;
  sipDialogs.unregisterLeg("consult");
  pendingTransferHeaders = null;
}

function idleConsultPatch(): Partial<SipCallStatus> {
  return {
    consultState: "idle",
    consultHeld: false,
    consultExt: null,
    consultName: null,
    merged: false,
    transferConsultRole: status.inboundTransferOffer ? status.transferConsultRole : null,
  };
}

function terminateSession(session: JsSipRtcSession | null) {
  if (!session) return;
  try {
    session.terminate();
  } catch (error) {
    logError("session terminate threw", error);
  }
}

function publishConsultActionOnce(
  conversationId: string | null,
  action: number,
): Promise<void> {
  if (!conversationId || consultAcdPublished) return Promise.resolve();
  consultAcdPublished = true;
  return workspaceApi.voiceTransferAction(conversationId, action).then(
    () => undefined,
    (error) => {
      logError(`ACD transfer action ${action} failed`, error);
    },
  );
}

function publishInboundBusyOnce(): void {
  if (!shouldPublishInboundBusy({ event: "sip-accepted" })) return;
  if (status.direction !== "inbound" || inboundAnswerBusySent) return;
  inboundAnswerBusySent = true;
  setCallPresence("busy");
}

function publishInboundConsultAnsweredOnce(): void {
  if (
    consultAnsweredPublished ||
    !status.inboundTransferOffer ||
    !status.conversationId
  ) {
    return;
  }
  consultAnsweredPublished = true;
  void workspaceApi
    .markVoiceConsultAnswered(status.conversationId)
    .catch((error) => {
      consultAnsweredPublished = false;
      logError("voice consult answered update failed", error);
    });
}

function finishCall(remoteEnded: boolean, error: string | null = null) {
  if (pageExitHangupSent) return;
  if (status.awaitingDisposition) {
    setStatus({ remoteEnded: status.remoteEnded || remoteEnded });
    return;
  }
  const conversationId = status.conversationId;
  if (
    status.consultState !== "idle" &&
    !status.merged &&
    status.transferConsultRole !== "secondary"
  ) {
    void publishConsultActionOnce(
      conversationId,
      TRANSFER_ACTION_TRANSFEROR_CANCEL,
    );
  }
  const unansweredInbound = status.inboundOffer && !status.connectedAt;
  const needsDisposition = voiceEndedNeedsDisposition({
    conversationId,
    connectedAt: status.connectedAt,
    consultOnlySecondary:
      status.transferConsultRole === "secondary" &&
      !status.merged &&
      status.secondaryConsultOnly,
  });
  const mergeParticipantDisposition =
    status.merged && status.transferConsultRole === "secondary";
  const transferredByPrimary =
    pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_TRANSFER &&
    status.transferConsultRole === "primary";
  pendingOutboundNumber = null;
  pendingTransferHeaders = null;
  terminateSession(consultSession);
  clearConsultSession();
  clearRtcSession();
  setStatus({
    callState: "idle",
    error,
    muted: false,
    held: false,
    acdSessionId: null,
    conversationId: needsDisposition ? conversationId : null,
    awaitingDisposition: needsDisposition,
    awaitingTransferredDisposition: needsDisposition && transferredByPrimary,
    transferredDispositionCompletesTransfer: needsDisposition && transferredByPrimary,
    awaitingMergeDisposition: needsDisposition && mergeParticipantDisposition,
    secondaryConsultOnly: false,
    remoteEnded,
    inboundOffer: false,
    inboundTransferOffer: false,
    direction: null,
    endedAt: status.connectedAt ? Date.now() : null,
    ...idleConsultPatch(),
    transferConsultRole: null,
  });
  setVoicePhase(needsDisposition ? "wrap_up" : "closed");
  inboundAnswerBusySent = false;
  if (!unansweredInbound) {
    const nextPresence = presenceAfterVoiceMediaEnded(needsDisposition);
    if (nextPresence) setCallPresence(nextPresence);
  }
  pendingConsultAction = null;
}

function endConsultLeg(error: string | null = null) {
  const wasRinging = isVoiceConsultRinging(status.consultState);
  const transferring = pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_TRANSFER;
  clearConsultSession();
  if (
    !transferring &&
    status.callState === "active" &&
    rtcSession &&
    (status.held || wasRinging)
  ) {
    try {
      rtcSession.unhold?.({});
    } catch (holdError) {
      logError("unhold after consult end failed", holdError);
    }
  }
  setStatus({
    error,
    held: false,
    consultHeld: false,
    consultState: "idle",
    consultExt: null,
    consultName: null,
    merged: false,
    transferConsultRole: status.transferConsultRole === "primary" ? null : status.transferConsultRole,
  });
  if (!transferring) setVoicePhase("established");
  stopCustomerConferenceAudio();
  if (rtcSession?.connection) attachRemoteAudio(rtcSession.connection);
}

function releaseMergedConsultLeg(): void {
  const bStillPresent = Boolean(consultSession);
  clearConsultSession();
  if (bStillPresent && rtcSession) {
    setStatus({
      merged: false,
      consultState: "idle",
      consultHeld: false,
      consultName: null,
      consultExt: null,
    });
    setVoicePhase("established");
    stopCustomerConferenceAudio();
    if (rtcSession.connection) attachRemoteAudio(rtcSession.connection);
    return;
  }
  finishCall(true);
}

function closeCallAfterRemoteBye(leg: SipDialogLeg) {
  if (leg === "consult") {
    log("remote BYE routed to consult dialog");
    if (pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_TRANSFER) {
      clearConsultSession();
      setVoicePhase("transferred");
      return;
    }
    if (pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_MERGE) {
      clearConsultSession();
      return;
    }
    if (status.merged) {
      releaseMergedConsultLeg();
      return;
    }
    void publishConsultActionOnce(
      status.conversationId,
      TRANSFER_ACTION_TRANSFEROR_CANCEL,
    );
    endConsultLeg();
    return;
  }
  log("remote BYE routed to customer dialog");
  finishCall(true);
}

function rtcMediaOptions(): Record<string, unknown> {
  return {
    mediaConstraints: { audio: true, video: false },
    pcConfig: {
      iceServers: peerConnectionIceServers(uaSession?.iceServers ?? []),
      iceTransportPolicy: "relay",
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    },
  };
}

function rejectIncomingCall(
  session: JsSipRtcSession,
  reason: string,
  options: { status_code?: number; reason_phrase?: string } = inboundSipRejectionOptions(),
) {
  log(`inbound INVITE rejected (${reason})`);
  console.warn("[voice][sip] inbound.rejected", {
    reason,
    sessionId: status.acdSessionId,
    conversationId: status.conversationId,
    callState: status.callState,
  });
  try {
    session.terminate(options);
  } catch (error) {
    logError("inbound reject threw", error);
  }
}

async function refreshAgentPresenceReady(): Promise<boolean> {
  try {
    const presence = await workspaceApi.getPresence();
    agentPresenceReady = presence?.state === "ready";
  } catch (error) {
    logError("presence refresh failed", error);
  }
  return agentPresenceReady === true;
}

async function offerIncomingCall(session: JsSipRtcSession) {
  const transferOffer = inboundVoiceTransferFromSession(session);
  if (transferOffer) {
    consultAcdPublished = false;
    consultAnsweredPublished = false;
    pendingConsultAction = null;
    mergeConsultLegEnded = false;
  }
  const presenceReady =
    agentPresenceReady ?? (await refreshAgentPresenceReady());
  if (
    !shouldAcceptIncomingInvite({
      hasActiveSession: Boolean(rtcSession),
      callState: status.callState,
      awaitingDisposition: status.awaitingDisposition,
      presenceReady,
      isTransferOffer: transferOffer,
    })
  ) {
    rejectIncomingCall(
      session,
      presenceReady ? "agent busy" : "agent not ready",
      inboundSipBusyOptions(),
    );
    return;
  }

  const destination = inboundCallerFromSession(session);
  const incomingAcdSessionId = inboundAcdSessionFromSession(session);
  const pendingConsult = transferOffer
    ? rememberInboundVoiceConsultSession(incomingAcdSessionId)
    : null;
  const acdContext = {
    ...inboundAcdContext(status, incomingAcdSessionId),
    conversationId:
      pendingConsult?.conversation.id ??
      inboundAcdContext(status, incomingAcdSessionId).conversationId,
  };
  console.info("[voice][sip] inbound.invite-received", {
    sessionId: incomingAcdSessionId,
    replacedSessionId:
      status.acdSessionId &&
      incomingAcdSessionId &&
      status.acdSessionId !== incomingAcdSessionId
        ? status.acdSessionId
        : null,
    preservedConversationId: acdContext.conversationId,
  });
  log(
    destination
      ? `inbound INVITE ringing from ${destination} acd=${acdContext.acdSessionId ?? "none"} conversation=${acdContext.conversationId ?? "none"}`
      : `inbound INVITE ringing acd=${acdContext.acdSessionId ?? "none"} conversation=${acdContext.conversationId ?? "none"}`,
  );
  inboundAnswerBusySent = false;
  rtcSession = session;
  registerSessionDialog(session, "customer");
  pendingOutboundNumber = null;
  setStatus({
    callState: "ringing",
    destination,
    error: null,
    ...acdContext,
    awaitingDisposition: false,
    remoteEnded: false,
    inboundOffer: true,
    inboundTransferOffer: transferOffer,
    transferConsultRole: transferOffer ? "secondary" : null,
    secondaryConsultOnly: transferOffer,
    direction: "inbound",
    connectedAt: null,
    endedAt: null,
  });
  setVoicePhase("ringing");
  attachSessionHandlers(session);
}

export function acceptInboundSipCall(): void {
  if (!rtcSession?.answer || !status.inboundOffer) {
    console.error("[voice][sip] inbound.accept-skipped", {
      hasAnswer: Boolean(rtcSession?.answer),
      inboundOffer: status.inboundOffer,
      sessionId: status.acdSessionId,
      conversationId: status.conversationId,
    });
    logError(
      `inbound accept skipped: answer=${Boolean(rtcSession?.answer)} inboundOffer=${status.inboundOffer} acd=${status.acdSessionId ?? "none"} conversation=${status.conversationId ?? "none"}`,
    );
    return;
  }
  log(
    `inbound offer accepted acd=${status.acdSessionId ?? "none"} conversation=${status.conversationId ?? "none"} dest=${status.destination ?? "none"}`,
  );
  console.info("[voice][sip] inbound.answer-requested", {
    sessionId: status.acdSessionId,
    conversationId: status.conversationId,
  });
  setStatus({ inboundOffer: false, error: null });
  try {
    rtcSession.answer(rtcMediaOptions());
  } catch (error) {
    const session = rtcSession;
    rtcSession = null;
    const message = error instanceof Error ? error.message : "Unable to answer call";
    logError("inbound answer threw", error);
    console.error("[voice][sip] inbound.answer-failed", {
      sessionId: status.acdSessionId,
      conversationId: status.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      session.terminate();
    } catch {
      // already failed
    }
    setStatus({
      callState: "idle",
      error: message,
      destination: null,
    inboundOffer: false,
    inboundTransferOffer: false,
    transferConsultRole: null,
    secondaryConsultOnly: false,
    direction: null,
  });
    setCallPresence("ready");
  }
}

export function rejectInboundSipCall(): void {
  if (!rtcSession || !status.inboundOffer) {
    log("inbound reject skipped: no ringing offer");
    console.warn("[voice][sip] inbound.reject-skipped", {
      hasSession: Boolean(rtcSession),
      inboundOffer: status.inboundOffer,
      sessionId: status.acdSessionId,
    });
    return;
  }
  log("inbound offer rejected");
  console.info("[voice][sip] inbound.reject-requested", {
    sessionId: status.acdSessionId,
    conversationId: status.conversationId,
  });
  const conversationId = status.conversationId;
  const sessionId = status.acdSessionId;
  const transferOffer = status.inboundTransferOffer;
  const session = rtcSession;
  rtcSession = null;
  setStatus({
    callState: "idle",
    error: null,
    destination: null,
    acdSessionId: null,
    conversationId: null,
    awaitingDisposition: false,
    remoteEnded: false,
    inboundOffer: false,
    inboundTransferOffer: false,
    transferConsultRole: null,
    secondaryConsultOnly: false,
    direction: null,
  });
  rejectIncomingCall(session, "agent rejected");
  if (transferOffer) {
    clearPendingVoiceConsultWorkspace(conversationId ?? undefined);
    if (conversationId) {
      void workspaceApi.rejectVoiceConsult(conversationId).catch((error) => {
        logError("voice consult reject failed", error);
      });
    }
    return;
  }
  if (conversationId || sessionId) {
    void workspaceApi
      .finalizeVoiceCall({
        conversationId,
        sessionId,
        reason: "agent_declined",
      })
      .catch((error) => {
        logError("inbound decline finalize failed", error);
      });
  }
}

function attachSessionHandlers(session: JsSipRtcSession) {
  session.on("progress", () => {
    log("call ringing");
    console.info("[voice][sip] call.ringing", {
      direction: status.direction,
      sessionId: status.acdSessionId,
      conversationId: status.conversationId,
    });
    setStatus({ callState: "ringing", error: null });
  });
  session.on("accepted", () => {
    registerSessionDialog(session, "customer");
    log("call accepted");
    console.info("[voice][sip] call.accepted", {
      direction: status.direction,
      sessionId: status.acdSessionId,
      conversationId: status.conversationId,
    });
    setStatus({
      callState: "active",
      error: null,
      connectedAt: status.connectedAt ?? Date.now(),
      endedAt: null,
    });
    setVoicePhase("established");
    publishInboundBusyOnce();
    publishInboundConsultAnsweredOnce();
  });
  session.on("confirmed", () => {
    registerSessionDialog(session, "customer");
    log("call confirmed");
    console.info("[voice][sip] call.confirmed", {
      direction: status.direction,
      sessionId: status.acdSessionId,
      conversationId: status.conversationId,
    });
    setStatus({
      callState: "active",
      error: null,
      connectedAt: status.connectedAt ?? Date.now(),
      endedAt: null,
    });
    setVoicePhase("established");
    publishInboundConsultAnsweredOnce();
    if (session.connection) attachRemoteAudio(session.connection);
  });
  session.on("peerconnection", (event) => {
    const pc = (event as { peerconnection?: RTCPeerConnection }).peerconnection;
    if (pc) attachRemoteAudio(pc);
  });
  session.on("failed", (event) => {
    const wasActive = rtcSession === session;
    const cause = causeFromEvent(event) ?? "Call failed";
    if (wasActive) logError(`call failed (${cause})`);
    else log(`call cancelled (${cause})`);
    console.error("[voice][sip] call.failed", {
      cause,
      wasActive,
      direction: status.direction,
      sessionId: status.acdSessionId,
      conversationId: status.conversationId,
    });
    if (!wasActive) return;
    if (
      inboundInviteCancelledBeforeConnect({
        direction: status.direction,
        connectedAt: status.connectedAt,
        cause,
      })
    ) {
      const conversationId = status.conversationId;
      const sessionId = status.acdSessionId;
      const restoreReady = shouldRestoreReadyAfterCancelledRing({
        presenceState: agentPresenceState,
        inboundOffer: status.inboundOffer,
        connectedAt: status.connectedAt,
      });
      finishCall(true, null);
      if (restoreReady) setCallPresence("ready");
      if (conversationId || sessionId) {
        void workspaceApi
          .finalizeVoiceCall({
            conversationId,
            sessionId,
            reason: "abandoned",
          })
          .catch((error) => {
            logError("cancelled inbound finalize failed", error);
          });
      }
      return;
    }
    finishCall(false, cause);
  });
  session.on("ended", (event) => {
    const cause = causeFromEvent(event);
    log(cause ? `call ended (${cause})` : "call ended");
    console.info("[voice][sip] call.ended", {
      cause,
      direction: status.direction,
      sessionId: status.acdSessionId,
      conversationId: status.conversationId,
    });
    finishCall(false);
  });
}

function attachConsultHandlers(session: JsSipRtcSession) {
  session.on("progress", () => {
    log("consult ringing");
    setStatus({ consultState: "ringing", error: null });
  });
  session.on("accepted", () => {
    registerSessionDialog(session, "consult");
    log("consult accepted");
    setStatus({ consultState: "active", error: null });
    setVoicePhase("consult_active");
    if (session.connection) attachRemoteAudio(session.connection, "consult");
  });
  session.on("confirmed", () => {
    registerSessionDialog(session, "consult");
    log("consult confirmed");
    setStatus({ consultState: "active", error: null });
    setVoicePhase("consult_active");
    if (session.connection) attachRemoteAudio(session.connection, "consult");
  });
  session.on("peerconnection", (event) => {
    const pc = (event as { peerconnection?: RTCPeerConnection }).peerconnection;
    if (pc) attachRemoteAudio(pc, "consult");
  });
  session.on("failed", (event) => {
    if (consultSession !== session) return;
    if (pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_MERGE) {
      log("old consult leg closed during conference merge");
      mergeConsultLegEnded = true;
      return;
    }
    if (status.merged) {
      log("consult leg failed after merge");
      releaseMergedConsultLeg();
      return;
    }
    const cause = causeFromEvent(event) ?? "Consult failed";
    logError(`consult failed (${cause})`);
    const conversationId = status.conversationId;
    void publishConsultActionOnce(
      conversationId,
      TRANSFER_ACTION_TRANSFEROR_CANCEL,
    );
    endConsultLeg(cause);
  });
  session.on("ended", () => {
    if (consultSession !== session) return;
    log("consult ended");
    if (pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_MERGE) {
      log("old consult leg ended during conference merge");
      mergeConsultLegEnded = true;
      return;
    }
    if (status.merged) {
      log("consult leg ended after merge");
      releaseMergedConsultLeg();
      return;
    }
    if (pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_TRANSFER) {
      finishCall(false);
      return;
    }
    const conversationId = status.conversationId;
    void publishConsultActionOnce(
      conversationId,
      TRANSFER_ACTION_TRANSFEROR_CANCEL,
    );
    endConsultLeg();
  });
}

function hangupActiveCall() {
  pendingOutboundNumber = null;
  if (!rtcSession) return;
  const session = rtcSession;
  rtcSession = null;
  try {
    session.terminate();
  } catch (error) {
    logError("hangup threw", error);
  }
  finishCall(false);
}

function teardownUa() {
  hangupActiveCall();
  if (!ua) {
    uaSession = null;
    setStatus({ ...idleStatus });
    return;
  }
  log("unregister + stop UA");
  try {
    ua.unregister();
  } catch (error) {
    logError("unregister threw", error);
  }
  try {
    ua.stop();
  } catch (error) {
    logError("stop threw", error);
  }
  ua = null;
  uaSession = null;
  if (!status.awaitingDisposition) setStatus({ ...idleStatus });
}

/** Hang up this tab's live legs when the page is actually leaving. In-call controls do not use this. */
export function endLiveSipSessionsOnPageExit(): void {
  if (pageExitHangupSent) return;
  const hadCustomerLeg = Boolean(rtcSession || consultSession);
  const sessions = [consultSession, rtcSession, monitorSession].filter(
    (session): session is JsSipRtcSession => Boolean(session),
  );
  if (sessions.length === 0) {
    if (!status.awaitingDisposition) return;
    pageExitHangupSent = true;
    publishPresenceBeforeBusyOnPageExit();
    return;
  }
  pageExitHangupSent = true;
  consultSession = null;
  rtcSession = null;
  monitorSession = null;
  for (const session of sessions) {
    terminateSession(session);
    try {
      session.connection?.close();
    } catch (error) {
      logError("peer connection close on page exit threw", error);
    }
  }
  if (hadCustomerLeg) publishPresenceBeforeBusyOnPageExit();
}

export async function stopSipRegistration(): Promise<void> {
  startGeneration += 1;
  if (!ua) {
    log("no active UA to unregister");
    setStatus({ ...idleStatus });
    return;
  }
  teardownUa();
}

export function hangupOutboundCall(): void {
  if (!rtcSession && !consultSession && status.consultState === "idle") {
    log("no active outbound call to hang up");
    return;
  }
  const action = acdActionForVoiceHangup({
    merged: status.merged,
    transferConsultRole: status.transferConsultRole,
    consultState: status.consultState,
    secondaryConsultOnly: status.secondaryConsultOnly,
  });
  const order = hangupTeardownOrder(action);
  log("hangup outbound call");
  if (order === "sip-bye" || !action) {
    hangupActiveCall();
    return;
  }
  void publishConsultActionOnce(status.conversationId, action).finally(() => {
    if (order === "consult-then-customer") cancelConsultTransfer();
    hangupActiveCall();
  });
}

function sessionsForMediaControls(): JsSipRtcSession[] {
  if (status.merged) {
    return [rtcSession, consultSession].filter((session): session is JsSipRtcSession => Boolean(session));
  }
  if (
    status.transferConsultRole !== "secondary" &&
    consultSession &&
    status.consultState !== "idle"
  ) {
    return [consultSession];
  }
  return rtcSession ? [rtcSession] : [];
}

export function setSipAcdSessionId(sessionId: string | null): void {
  setStatus({ acdSessionId: sessionId });
}

export function setSipAcdCallContext(sessionId: string, conversationId: string): void {
  setStatus({
    acdSessionId: sessionId,
    conversationId,
    awaitingDisposition: false,
  });
}

export function setSipAgentPresenceState(state: string): void {
  agentPresenceState = state;
  console.info("[voice][presence] local-state.received", {
    state,
    awaitingDisposition: status.awaitingDisposition,
  });
  if (
    (state === "away" || state === "not_ready") &&
    status.callState !== "active" &&
    status.callState !== "dialing"
  ) {
    if (status.inboundOffer && rtcSession) {
      const session = rtcSession;
      rtcSession = null;
      rejectIncomingCall(session, "presence away");
    }
    if (status.awaitingDisposition && !status.connectedAt) {
      setStatus({
        callState: "idle",
        inboundOffer: false,
        inboundTransferOffer: false,
        awaitingDisposition: false,
        conversationId: null,
        acdSessionId: null,
        direction: null,
      });
    }
  }
  if (status.awaitingDisposition) {
    agentPresenceReady = false;
    return;
  }
  agentPresenceReady = state === "ready";
}

export function beginConsultTransferAction(action: VoiceTransferAction): void {
  pendingConsultAction = action;
  consultAcdPublished = true;
  if (action === TRANSFER_ACTION_TRANSFEROR_MERGE) {
    mergeConsultLegEnded = false;
    setVoicePhase("merge_requested");
  } else if (action === TRANSFER_ACTION_TRANSFEROR_TRANSFER) {
    setVoicePhase("transfer_requested");
  }
}

export function failConsultTransferAction(action: VoiceTransferAction): void {
  if (pendingConsultAction !== action) return;
  pendingConsultAction = null;
  consultAcdPublished = false;
  if (
    action === TRANSFER_ACTION_TRANSFEROR_MERGE ||
    action === TRANSFER_ACTION_TRANSFEROR_TRANSFER
  ) {
    setVoicePhase("consult_active");
  }
  if (
    action === TRANSFER_ACTION_TRANSFEROR_MERGE &&
    mergeConsultLegEnded
  ) {
    mergeConsultLegEnded = false;
    endConsultLeg("Unable to merge the calls");
  }
}

function sameConversationId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left == null || right == null) return false;
  return String(left) === String(right);
}

/**
 * Customer hangup ends the conversation on the socket, which can beat or miss the SIP BYE.
 * Finish a connected leg now so wrap-up does not depend on that order.
 * Returns true when the disposition picker should open.
 */
export function endVoiceCallForWrapUp(conversationId: string): boolean {
  const consultOnlySecondary =
    status.transferConsultRole === "secondary" &&
    !status.merged &&
    status.secondaryConsultOnly;
  if (consultOnlySecondary && sameConversationId(status.conversationId, conversationId)) {
    return false;
  }
  if (status.inboundOffer && !status.connectedAt && sameConversationId(status.conversationId, conversationId)) {
    return false;
  }
  if (sameConversationId(status.conversationId, conversationId) && status.awaitingDisposition) {
    return true;
  }
  if (
    sameConversationId(status.conversationId, conversationId) &&
    status.connectedAt &&
    status.callState !== "idle"
  ) {
    finishCall(true);
    return status.awaitingDisposition && sameConversationId(status.conversationId, conversationId);
  }
  if (
    !status.awaitingDisposition &&
    status.callState === "idle" &&
    !status.inboundOffer &&
    !status.conversationId &&
    sameConversationId(wrapUpConversationId, conversationId)
  ) {
    wrapUpConversationId = null;
    setStatus({
      conversationId: String(conversationId),
      awaitingDisposition: true,
      remoteEnded: true,
    });
    setVoicePhase("wrap_up");
    return true;
  }
  return false;
}

export function requireVoiceDisposition(
  conversationId: string,
  options?: { transferred?: boolean; completeTransfer?: boolean },
): void {
  if (status.inboundOffer) return;
  if (status.callState !== "idle") return;
  console.info("[voice][workspace] disposition.required", {
    conversationId,
    previousConversationId: status.conversationId,
    transferred: Boolean(options?.transferred),
  });
  setStatus({
    conversationId,
    awaitingDisposition: true,
    remoteEnded: true,
    awaitingTransferredDisposition: Boolean(
      options?.transferred || status.awaitingTransferredDisposition,
    ),
    transferredDispositionCompletesTransfer: Boolean(
      options?.transferred && (options.completeTransfer ?? true),
    ),
    awaitingMergeDisposition: false,
  });
  setVoicePhase("wrap_up");
}

/** Ready after a successful wrap-up save. The badge follows the stored row. */
export function publishVoiceWrapUpReady(): void {
  setCallPresence("ready");
}

export function completeSipCallDisposition(conversationId: string): void {
  if (status.conversationId && status.conversationId !== conversationId) return;
  if (sameConversationId(wrapUpConversationId, conversationId)) wrapUpConversationId = null;
  clearConsultSession();
  setStatus({
    conversationId: null,
    acdSessionId: null,
    awaitingDisposition: false,
    remoteEnded: false,
    inboundTransferOffer: false,
    awaitingTransferredDisposition: false,
    transferredDispositionCompletesTransfer: false,
    awaitingMergeDisposition: false,
    secondaryConsultOnly: false,
    ...idleConsultPatch(),
    transferConsultRole: null,
  });
  setVoicePhase("idle");
  agentPresenceReady = queueInviteReadyAfterDisposition(agentPresenceState);
}

export function muteOutboundCall(muted: boolean): void {
  const sessions = sessionsForMediaControls();
  if (sessions.length === 0) return;
  try {
    for (const session of sessions) {
      if (muted) session.mute?.({ audio: true });
      else session.unmute?.({ audio: true });
    }
    setStatus({ muted });
  } catch (error) {
    logError("mute toggle failed", error);
  }
}

function setSessionHold(
  session: JsSipRtcSession,
  held: boolean,
  timeoutMs = 5_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(result);
    };
    const timeout = window.setTimeout(() => settle(false), timeoutMs);
    try {
      const method = held ? session.hold : session.unhold;
      if (!method) {
        settle(false);
        return;
      }
      method.call(session, {}, () => settle(true));
    } catch (error) {
      logError(`${held ? "hold" : "unhold"} failed`, error);
      settle(false);
    }
  });
}

export function holdOutboundCall(held: boolean): void {
  const sessions = sessionsForMediaControls();
  if (sessions.length === 0) return;
  const consultingPrimary =
    status.transferConsultRole !== "secondary" &&
    Boolean(consultSession) &&
    status.consultState !== "idle" &&
    !status.merged;
  try {
    for (const session of sessions) {
      if (held) session.hold?.({});
      else session.unhold?.({});
    }
    setStatus(consultingPrimary ? { consultHeld: held } : { held });
  } catch (error) {
    logError("hold toggle failed", error);
  }
}

export async function holdCustomerForConsult(): Promise<boolean> {
  if (!rtcSession || status.callState !== "active") {
    setStatus({ error: "Hold the live customer call before inviting an agent" });
    return false;
  }
  if (status.held) return true;
  const held = await setSessionHold(rtcSession, true);
  if (!held) {
    setStatus({ error: "Customer hold was not acknowledged" });
    return false;
  }
  setStatus({ held: true, error: null });
  return true;
}

export async function prepareConsultMerge(): Promise<boolean> {
  if (!rtcSession || !consultSession || status.consultState !== "active") {
    setStatus({ error: "Both calls must be active before merging" });
    return false;
  }
  return true;
}

function ensureMonitorAudio(): HTMLAudioElement {
  if (!monitorAudio) {
    monitorAudio = new Audio();
    monitorAudio.autoplay = true;
  }
  return monitorAudio;
}

/** Unlock playback during the click that starts listen. Remote audio arrives later. */
export function primeSupervisorListenAudio(): void {
  const audio = ensureMonitorAudio();
  void audio.play().catch(() => undefined);
}

function playMonitorStream(stream: MediaStream): void {
  const audio = ensureMonitorAudio();
  audio.srcObject = stream;
  setMonitorListenAudioStream(stream);
  void audio.play().catch(() => undefined);
}

function stopMonitorAudio(): void {
  if (monitorAudio) {
    monitorAudio.pause();
    monitorAudio.srcObject = null;
  }
  setMonitorListenAudioStream(null);
  monitorMicrophone?.getTracks().forEach((track) => track.stop());
  monitorMicrophone = null;
  if (!monitorSilence) return;
  for (const track of monitorSilence.stream.getTracks()) track.stop();
  void monitorSilence.context.close().catch(() => undefined);
  monitorSilence = null;
}

function monitorAudioSender(): RTCRtpSender | null {
  const pc = monitorSession?.connection;
  if (!pc) return null;
  return pc.getSenders().find((sender) => sender.track?.kind === "audio") ?? null;
}

/** Whisper and barge send the microphone. Listen puts the silent track back. */
export async function setSupervisorListenVoice(audible: boolean): Promise<void> {
  const sender = monitorAudioSender();
  if (!sender) throw new Error("Listen audio is not ready");
  if (audible) {
    if (monitorMicrophone?.getAudioTracks().some((track) => track.readyState === "live")) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("No microphone is available");
    }
    await sender.replaceTrack(track);
    monitorMicrophone?.getTracks().forEach((item) => item.stop());
    monitorMicrophone = stream;
    return;
  }
  const silent = monitorSilence?.stream.getAudioTracks()[0] ?? null;
  await sender.replaceTrack(silent);
  monitorMicrophone?.getTracks().forEach((track) => track.stop());
  monitorMicrophone = null;
}

/** Local mute for whisper and barge. The listen leg stays up. */
export function setSupervisorListenMuted(muted: boolean): void {
  for (const track of monitorMicrophone?.getAudioTracks() ?? []) {
    track.enabled = !muted;
  }
}

/** Sendrecv offer with silence, so the gateway answers like a normal call and the mic stays off. */
function silentMonitorStream(): MediaStream {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = 0;
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start();
  monitorSilence = { context, stream: destination.stream };
  return destination.stream;
}

function attachMonitorAudio(session: JsSipRtcSession): void {
  const attach = (pc: RTCPeerConnection | undefined) => {
    if (!pc) return;
    pc.addEventListener("track", (event) => {
      const stream = event.streams[0] ?? (event.track ? new MediaStream([event.track]) : null);
      if (stream) playMonitorStream(stream);
    });
  };
  if (session.connection) attach(session.connection);
  session.on("peerconnection", (event) => {
    const pc = (event as { peerconnection?: RTCPeerConnection }).peerconnection;
    attach(pc);
  });
}

/** Supervisor listen leg. It does not use the customer or consult session and does not change presence. */
export function beginSupervisorListenInvite(sessionId: string): boolean {
  const id = sessionId.trim();
  const ext = String(uaSession?.ext ?? "").trim();
  if (!id || !ext) return false;
  if (!ua || !uaSession || !status.registered) return false;
  if (rtcSession || consultSession) return false;
  if (monitorSession) return false;
  const headers = voiceSupervisorListenHeaders(id);
  pendingMonitorHeaders = headers;
  monitorInviteUser = ext;
  try {
    const session = ua.call(sipInviteTarget(ext, uaSession.realm), {
      extraHeaders: headers,
      mediaStream: silentMonitorStream(),
      ...rtcMediaOptions(),
    });
    monitorSession = session;
    attachMonitorAudio(session);
    let mediaError: string | null = null;
    session.on("sdp", (event) => {
      const payload = event as { originator?: string; type?: string; sdp?: string };
      if (payload.originator === "remote" && payload.type === "answer" && payload.sdp) {
        payload.sdp = normalizeRemoteAnswerSdp(payload.sdp);
      }
    });
    session.on("peerconnection:setremotedescriptionfailed", (event) => {
      mediaError = event instanceof Error ? event.message : "answer SDP was rejected";
    });
    const clear = (reason?: string) => {
      if (monitorSession !== session) return;
      monitorSession = null;
      pendingMonitorHeaders = null;
      monitorInviteUser = null;
      stopMonitorAudio();
      onMonitorEnded?.(reason);
    };
    session.on("ended", () => clear());
    session.on("failed", (event) => {
      const cause = (event as { cause?: string } | undefined)?.cause;
      queueMicrotask(() => {
        const detail = mediaError ?? cause;
        clear(detail ? `Listen failed (${detail}).` : "Listen failed.");
      });
    });
    console.info("[voice][sip] supervisor.listen", { sessionId: id, ext });
    return true;
  } catch (error) {
    pendingMonitorHeaders = null;
    monitorInviteUser = null;
    monitorSession = null;
    stopMonitorAudio();
    logError("supervisor listen INVITE failed", error);
    return false;
  }
}

export function supervisorListenInviteActive(): boolean {
  return Boolean(monitorSession);
}

export function setSupervisorListenEndedHandler(handler: ((reason?: string) => void) | null): void {
  onMonitorEnded = handler;
}

/** Drop only the supervisor listen leg. */
export function endSupervisorListenInvite(): void {
  const session = monitorSession;
  monitorSession = null;
  pendingMonitorHeaders = null;
  monitorInviteUser = null;
  stopMonitorAudio();
  terminateSession(session);
}

export async function inviteConsultTransfer(input: {
  ext: string;
  sessionId: string;
  name?: string | null;
}): Promise<boolean> {
  const ext = normalizeDialedNumber(input.ext);
  const sessionId = input.sessionId.trim();
  if (!ext || !sessionId) {
    setStatus({ error: "Select a Ready agent with an extension" });
    return false;
  }
  if (!ua || !uaSession) {
    setStatus({ error: "SIP is not connected" });
    return false;
  }
  if (!status.registered) {
    setStatus({ error: "Wait for REGISTER 200 before inviting" });
    return false;
  }
  if (
    !canStartVoiceConsultInvite({
      hasCustomerSession: Boolean(rtcSession),
      customerCallState: status.callState,
      consultState: status.consultState,
    })
  ) {
    setStatus({
      error: consultSession || status.consultState !== "idle"
        ? "A consult invite is already in progress"
        : "A live customer call is required",
    });
    return false;
  }
  if (!(await holdCustomerForConsult())) return false;

  consultAcdPublished = false;
  pendingConsultAction = null;
  mergeConsultLegEnded = false;
  const target = sipInviteTarget(ext, uaSession.realm);
  pendingTransferHeaders = voiceTransferInviteHeaders(sessionId);
  pendingOutboundNumber = null;
  log(`consult INVITE ${target} session=${sessionId}`);
  setStatus({
    consultState: "dialing",
    consultExt: ext,
    consultName: input.name?.trim() || ext,
    error: null,
    transferConsultRole: "primary",
    merged: false,
  });
  setVoicePhase("consult_pending");
  try {
    const session = ua.call(target, {
      extraHeaders: pendingTransferHeaders,
      ...rtcMediaOptions(),
    });
    consultSession = session;
    registerSessionDialog(session, "consult");
    attachConsultHandlers(session);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to invite agent";
    logError("consult ua.call threw", error);
    endConsultLeg(message);
    return false;
  }
}

export function cancelConsultTransfer(): boolean {
  if (!consultSession && status.consultState === "idle") return false;
  pendingConsultAction = null;
  consultAcdPublished = true;
  const session = consultSession;
  consultSession = null;
  pendingTransferHeaders = null;
  terminateSession(session);
  endConsultLeg();
  return true;
}

/** Drop A's consult UI when B rejects, the invite expires, or the consult is cancelled. */
export function releaseConsultAfterInviteEnded(conversationId: string): void {
  if (!sameConversationId(status.conversationId, conversationId)) return;
  if (status.consultState === "idle" && !consultSession) return;
  if (status.merged || status.transferConsultRole === "secondary") return;
  if (status.callState !== "active") return;
  if (
    pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_TRANSFER ||
    pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_MERGE ||
    pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_LEAVE ||
    pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_ENDALL
  ) {
    return;
  }
  cancelConsultTransfer();
}

export function completeConsultTransfer(): void {
  consultAcdPublished = true;
  pendingTransferHeaders = null;
  pendingConsultAction = TRANSFER_ACTION_TRANSFEROR_TRANSFER;
  const conversationId = status.conversationId;
  const needsDisposition = voiceEndedNeedsDisposition({
    conversationId,
    connectedAt: status.connectedAt,
  });
  console.info("[voice][sip] transfer.completed", {
    sessionId: status.acdSessionId,
    conversationId,
  });
  // Flags first, so a BYE from releasing the consult leg cannot enter finishCall.
  setStatus({
    callState: "idle",
    error: null,
    muted: false,
    held: false,
    acdSessionId: null,
    conversationId: needsDisposition ? conversationId : null,
    awaitingDisposition: needsDisposition,
    awaitingTransferredDisposition: needsDisposition,
    transferredDispositionCompletesTransfer: needsDisposition,
    awaitingMergeDisposition: false,
    secondaryConsultOnly: false,
    remoteEnded: false,
    inboundOffer: false,
    inboundTransferOffer: false,
    direction: null,
    endedAt: status.connectedAt ? Date.now() : null,
    ...idleConsultPatch(),
    transferConsultRole: null,
  });
  setVoicePhase(needsDisposition ? "wrap_up" : "closed");
  inboundAnswerBusySent = false;
  const consult = consultSession;
  terminateSession(consult);
  clearConsultSession();
  clearRtcSession();
  pendingConsultAction = null;
}

export function completeConsultMerge(): void {
  if (status.consultState !== "active" || !consultSession) return;
  const oldConsultLegEnded = mergeConsultLegEnded;
  pendingConsultAction = null;
  mergeConsultLegEnded = false;
  consultAcdPublished = true;
  pendingTransferHeaders = null;
  setStatus({ held: false, consultHeld: false, merged: true });
  setVoicePhase("conferenced");
  if (oldConsultLegEnded) consultSession = null;
  // Merge action 1 is complete; allow a later Leave/End-all conference action.
  consultAcdPublished = false;
  if (consultSession?.connection) attachRemoteAudio(consultSession.connection, "consult");
  if (rtcSession?.connection) attachRemoteAudio(rtcSession.connection, "customer");
}

export function leaveConsultConference(): void {
  pendingConsultAction = null;
  consultAcdPublished = true;
  pendingTransferHeaders = null;
  const consult = consultSession;
  consultSession = null;
  terminateSession(consult);
  hangupActiveCall();
}

export function markConsultMerged(): void {
  if (status.transferConsultRole !== "secondary") return;
  setStatus({ merged: true, secondaryConsultOnly: false });
}

export function leaveConsultAsSecondary(): void {
  pendingConsultAction = null;
  consultAcdPublished = true;
  pendingTransferHeaders = null;
  const session = rtcSession;
  rtcSession = null;
  terminateSession(session);
  terminateSession(consultSession);
  finishCall(false);
}

export function markConsultConversationOwned(): void {
  if (status.transferConsultRole !== "secondary") return;
  setStatus({ secondaryConsultOnly: false });
}

export function notifyInboundConsultAnswered(): void {
  publishInboundConsultAnsweredOnce();
}

export async function placeOutboundCall(
  rawNumber: string,
  outboundNumber?: string | null,
): Promise<void> {
  const number = normalizeDialedNumber(rawNumber);
  if (!number) {
    setStatus({ error: "Enter a number to dial" });
    logError("outbound call skipped: empty number");
    return;
  }
  if (!ua || !uaSession) {
    setStatus({ error: "SIP is not connected" });
    logError("outbound call skipped: UA not started");
    return;
  }
  const allowed = uaSession.outboundOptions ?? [];
  if (allowed.length === 0) {
    setStatus({ error: "Outbound calling is not allowed" });
    logError("outbound call skipped: no mapped DID");
    return;
  }
  const chosen = (outboundNumber ?? uaSession.outboundCallerId ?? "").trim();
  if (!allowed.some((option) => option.phoneNumber === chosen)) {
    setStatus({ error: "Choose which number to call from" });
    logError("outbound call skipped: outbound number not in allowed list");
    return;
  }
  if (!status.registered) {
    setStatus({ error: "Wait for REGISTER 200 before dialing" });
    logError("outbound call skipped: not registered");
    return;
  }
  if (rtcSession) {
    setStatus({ error: "A call is already in progress" });
    logError("outbound call skipped: session already active");
    return;
  }

  const target = sipInviteTarget(number, uaSession.realm);
  pendingOutboundNumber = chosen;

  log(`placing outbound call ${target} from ${chosen}`);
  setStatus({
    callState: "dialing",
    destination: number,
    error: null,
    acdSessionId: null,
    conversationId: null,
    awaitingDisposition: false,
    remoteEnded: false,
    inboundOffer: false,
    direction: "outbound",
    connectedAt: null,
    endedAt: null,
  });
  setVoicePhase("ringing");
  setCallPresence("busy");

  try {
    const session = ua.call(target, {
      extraHeaders: [`X-Outbound-Number: ${chosen}`],
      ...rtcMediaOptions(),
    });
    rtcSession = session;
    registerSessionDialog(session, "customer");
    attachSessionHandlers(session);
  } catch (error) {
    pendingOutboundNumber = null;
    clearRtcSession();
    const message = error instanceof Error ? error.message : "Unable to start call";
    logError("ua.call threw", error);
    setStatus({ callState: "idle", error: message, direction: null });
    setCallPresence("ready");
  }
}

async function restoreSipRegistrarAfterGateway() {
  const delays = [250, 1200];
  for (const delay of delays) {
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    try {
      await callServiceApi.restoreSipRegistrar();
      log("restored full Redis SIP payload after gateway overwrite");
    } catch (error) {
      logError("Redis SIP payload restore failed", error);
    }
  }
}

function attachUaLogs(nextUa: JsSipUa) {
  nextUa.on("connecting", () => {
    log("WSS connecting");
    console.info("[voice][sip] registration.connecting");
  });
  nextUa.on("connected", () => {
    log("WSS connected");
    console.info("[voice][sip] registration.transport-connected");
  });
  nextUa.on("disconnected", (event) => {
    logError("WSS disconnected", event);
    console.error("[voice][sip] registration.transport-disconnected", {
      cause: causeFromEvent(event),
    });
  });
  nextUa.on("registered", () => {
    log("REGISTER succeeded (200)");
    console.info("[voice][sip] registration.succeeded");
    setStatus({ registered: true, error: null });
    void refreshAgentPresenceReady();
    void restoreSipRegistrarAfterGateway();
  });
  nextUa.on("unregistered", () => {
    log("unregistered");
    console.warn("[voice][sip] registration.unregistered");
    setStatus({ registered: false });
  });
  nextUa.on("registrationFailed", (event) => {
    logError("REGISTER failed", event);
    console.error("[voice][sip] registration.failed", {
      cause: causeFromEvent(event),
    });
    setStatus({ registered: false, error: causeFromEvent(event) ?? "REGISTER failed" });
  });
  nextUa.on("newRTCSession", (event) => {
    const session = (event as { session?: JsSipRtcSession }).session;
    if (!session || session.direction !== "incoming") return;
    void offerIncomingCall(session);
  });
}

function applySimpleContact(nextUa: JsSipUa, contactValue: string) {
  const registrator = nextUa.registrator();
  registrator._contact = contactValue;
  registrator.setExtraContactParams?.({});
}

export async function startSipRegistration(): Promise<void> {
  teardownUa();
  const generation = ++startGeneration;

  log("fetching SIP session from call-service");
  let session: SipUaSession;
  try {
    session = await callServiceApi.getSipSession();
  } catch (error) {
    logError("call-service sip/session failed", error);
    return;
  }

  if (generation !== startGeneration) {
    log("stale sip session fetch ignored");
    return;
  }

  setStatus({
    canPlaceOutbound: Boolean(session.outboundOptions?.length),
    outboundOptions: session.outboundOptions ?? [],
  });

  let viaHost: string;
  try {
    viaHost = await discoverViaHost(session.iceServers);
    log(`Via/Contact IPv4 ${viaHost}`);
  } catch (error) {
    logError("could not discover IPv4 for Via/Contact", error);
    return;
  }
  if (generation !== startGeneration) {
    log("stale sip session after via-host discovery ignored");
    return;
  }

  const contactUri = sipContactUri(session.ext, viaHost);
  const contactValue = `<${contactUri}>`;
  const displayName = session.displayName || " ";
  const userAgent = session.userAgent || SIP_USER_AGENT;
  const inviteContactUser = randomInviteContactUser();
  log(`INVITE Contact user ${inviteContactUser}`);

  const socket = new JsSIP.WebSocketInterface(session.wssUrl) as unknown as JsSipSocket;
  socket.via_transport = "WSS";
  wrapSipTrace(socket, inviteContactUser);

  let nextUa: JsSipUa;
  try {
    nextUa = new JsSIP.UA({
      sockets: [socket],
      uri: session.uri,
      registrar_server: session.registrarServer,
      authorization_user: session.authorizationUser,
      password: session.password,
      display_name: displayName,
      user_agent: userAgent,
      contact_uri: contactUri,
      via_host: viaHost,
      register: true,
      register_expires: session.expires,
      session_timers: false,
      realm: session.realm,
      pcConfig: {
        iceServers: [],
      },
    }) as unknown as JsSipUa;
  } catch (error) {
    logError("JsSIP UA construct threw", error);
    return;
  }

  applySimpleContact(nextUa, contactValue);
  attachUaLogs(nextUa);
  ua = nextUa;
  uaSession = session;
  try {
    nextUa.start();
  } catch (error) {
    logError("UA start threw", error);
    ua = null;
    uaSession = null;
  }
}
