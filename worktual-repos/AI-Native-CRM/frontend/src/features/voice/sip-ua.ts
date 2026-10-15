/**
 * Browser SIP REGISTER and outbound INVITE.
 * Port of ai_contact_centre/apps/web/src/features/voice/sip-ua.ts.
 */

import JsSIP from "jssip";
import {
  applyLegacySipHeaders,
  composeDialedNumber,
  CRM_INVITE_HEADER,
  DEFAULT_DIAL_CODE,
  incomingInfoCallStatus,
  isIncomingSipBye,
  isIncomingSipInfo,
  randomInviteContactUser,
  receivedHostFromSipResponse,
  registeredHostPortFromRegister200,
  sipInviteTarget,
  sipOkForIncomingBye,
  sipOkForIncomingInfo,
} from "@/features/voice/sip-outbound";
import { discoverViaHost, peerConnectionIceServers, sipContactUri } from "@/features/voice/sip-via-host";
import { updatePresence } from "@/services/presence";
import { getSipSession, restoreSipRegistrar, type SipUaSession } from "@/services/sip";

const SIP_USER_AGENT = "CCAAS:BROWSER";
const CALL_STORAGE_KEY = "worktual.active-call";

type JsSipRegistrator = {
  _contact?: string;
  setExtraContactParams?: (params: Record<string, never>) => void;
};

type JsSipRtcSession = {
  direction?: string;
  remote_identity?: { display_name?: string; uri?: { user?: string } };
  terminate: (options?: { status_code?: number; reason_phrase?: string }) => void;
  answer?: (options: Record<string, unknown>) => void;
  mute?: (options?: { audio?: boolean; video?: boolean }) => void;
  unmute?: (options?: { audio?: boolean; video?: boolean }) => void;
  hold?: (options?: Record<string, unknown>, done?: () => void) => void;
  unhold?: (options?: Record<string, unknown>, done?: () => void) => void;
  sendDTMF?: (tones: string, options?: Record<string, unknown>) => void;
  connection?: RTCPeerConnection;
  on: (event: string, handler: (event: unknown) => void) => void;
};

type JsSipUa = {
  start: () => void;
  stop: () => void;
  unregister: () => void;
  registrator: () => JsSipRegistrator;
  call: (target: string, options: Record<string, unknown>) => JsSipRtcSession;
  on: (event: string, handler: (event: unknown) => void) => void;
};

export type OutboundCallPhase = "idle" | "dialing" | "ringing" | "active";

export type OutboundCallEndReason = "hangup" | "remote_bye" | "failed";

export type OutboundCallState = {
  phase: OutboundCallPhase;
  direction: "inbound" | "outbound" | null;
  incomingOffer: boolean;
  destination: string | null;
  label: string | null;
  error: string | null;
  registered: boolean;
  muted: boolean;
  held: boolean;
  connectedAt: number | null;
  endReason: OutboundCallEndReason | null;
};

type JsSipSocket = {
  send: (message: string) => boolean;
  connect: () => void;
  via_transport: string;
  _ws?: WebSocket | null;
};

let ua: JsSipUa | null = null;
let uaSession: SipUaSession | null = null;
let rtcSession: JsSipRtcSession | null = null;
let remoteAudio: HTMLAudioElement | null = null;
let registered = false;
let registeredHostPort: string | null = null;
let inviteContactUser = "";
let pendingOutboundNumber: string | null = null;
let startGeneration = 0;
let closingFromRemote = false;
let sipStopping = false;
let registerRecovery = 0;
let activeViaHost: string | null = null;
let forcedViaHost: string | null = null;
let pendingReceivedHost: string | null = null;
let readyRestoreSent = false;

const idleCall: OutboundCallState = {
  phase: "idle",
  direction: null,
  incomingOffer: false,
  destination: null,
  label: null,
  error: null,
  registered: false,
  muted: false,
  held: false,
  connectedAt: null,
  endReason: null,
};
let callState: OutboundCallState = { ...idleCall };
const callListeners = new Set<() => void>();
let pageUnloading = false;

function persistCall() {
  if (typeof sessionStorage === "undefined") return;
  if (pageUnloading) return;
  if (callState.phase === "idle") {
    sessionStorage.removeItem(CALL_STORAGE_KEY);
    return;
  }
  if (callState.phase !== "active" || !callState.destination) return;
  sessionStorage.setItem(
    CALL_STORAGE_KEY,
    JSON.stringify({
      phase: "active",
      direction: callState.direction,
      destination: callState.destination,
      label: callState.label,
      muted: callState.muted,
      held: callState.held,
      connectedAt: callState.connectedAt,
    }),
  );
}

function restorePersistedCall() {
  if (typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(CALL_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<OutboundCallState>;
    if (saved.phase !== "active" || !saved.destination) {
      sessionStorage.removeItem(CALL_STORAGE_KEY);
      return;
    }
    callState = {
      ...idleCall,
      phase: "active",
      direction: saved.direction === "inbound" ? "inbound" : "outbound",
      destination: saved.destination,
      label: saved.label ?? null,
      muted: Boolean(saved.muted),
      held: Boolean(saved.held),
      connectedAt: typeof saved.connectedAt === "number" ? saved.connectedAt : Date.now(),
    };
  } catch {
    sessionStorage.removeItem(CALL_STORAGE_KEY);
  }
}

restorePersistedCall();

function setCall(patch: Partial<OutboundCallState>) {
  callState = { ...callState, ...patch, registered };
  persistCall();
  for (const listener of callListeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (callState.phase !== "active") return;
    persistCall();
    pageUnloading = true;
    try {
      rtcSession?.terminate();
    } catch {
      // The reloaded page still shows Hang up from the saved call.
    }
  });
}

export function getOutboundCallState(): OutboundCallState {
  return callState;
}

export function subscribeOutboundCall(listener: () => void): () => void {
  callListeners.add(listener);
  return () => {
    callListeners.delete(listener);
  };
}

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

function causeFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const cause = (event as { cause?: unknown }).cause;
  return typeof cause === "string" && cause.trim() ? cause : null;
}

function sipResponseStatus(event: unknown): number | null {
  if (!event || typeof event !== "object") return null;
  const status = (event as { response?: { status_code?: unknown } }).response?.status_code;
  return typeof status === "number" ? status : null;
}

function microphoneContextError(): string | null {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    (window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === "function")
  ) {
    return null;
  }
  return "Microphone access requires HTTPS. Open CRM on localhost, or use an HTTPS URL, then retry.";
}

function sipText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data as ArrayBufferView);
  }
  return "";
}

function sipFirstLine(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trim().split("\n")[0]?.trim() ?? "";
}

function sipTraceChannel(raw: string): "registration" | "outbound" {
  const line = sipFirstLine(raw);
  if (/^(INVITE|BYE|ACK|CANCEL)\s/i.test(line)) return "outbound";
  if (/^CSeq:.*\b(INVITE|BYE|ACK|CANCEL)\b/im.test(raw)) return "outbound";
  return "registration";
}

/** Same trace as CCaaS: one console line per SIP message, then the raw frame. */
function logSipMessage(direction: "sent" | "recv", raw: string) {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return;
  const line = sipFirstLine(text);
  const channel = sipTraceChannel(text);
  console.info(`[voice][sip] ${channel}.${direction}`, { line });
  console.log(`[sip] ${direction}\n${text}\n`);
}

function wrapSipTrace(socket: JsSipSocket) {
  const send = socket.send.bind(socket);
  socket.send = (message: string) => {
    let outbound = message;
    try {
      const text = sipText(message);
      if (text) {
        outbound = applyLegacySipHeaders(
          text,
          registeredHostPort,
          inviteContactUser,
          pendingOutboundNumber,
        );
      }
      logSipMessage("sent", sipText(outbound) || sipText(message));
    } catch (error) {
      logError("outbound SIP rewrite failed", error);
      outbound = message;
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
      try {
        logSipMessage("recv", text);
        const host = registeredHostPortFromRegister200(text);
        if (host && host !== registeredHostPort) {
          registeredHostPort = host;
          log(`REGISTER 200 Contact host ${host}`);
          console.info("[voice][sip] registration.contact", { host });
        }
        const received = receivedHostFromSipResponse(text);
        if (received) pendingReceivedHost = received;
        if (isIncomingSipInfo(text)) {
          const ok = sipOkForIncomingInfo(text);
          if (ok) socket.send(ok);
          if (incomingInfoCallStatus(text) === "connected") {
            console.info("[voice][sip] outbound.acd-connected", {
              destination: callState.destination,
            });
            markAcdConnected();
          }
          return;
        }
        if (isIncomingSipBye(text)) {
          const ok = sipOkForIncomingBye(text);
          if (ok) socket.send(ok);
          console.info("[voice][sip] outbound.remote-bye", {
            destination: callState.destination,
          });
          endCallFromRemoteBye();
          return;
        }
      } catch {
        // never block signaling
      }
      onmessage?.call(ws, event);
    };
  };
}

const boundPeerConnections = new WeakSet<RTCPeerConnection>();
const watchedRemoteTracks = new WeakSet<MediaStreamTrack>();

function watchRemoteTrack(track: MediaStreamTrack) {
  if (watchedRemoteTracks.has(track)) return;
  watchedRemoteTracks.add(track);
  track.addEventListener("unmute", () => playRemoteAudio(new MediaStream([track])));
}

function ensureRemoteAudio(): HTMLAudioElement {
  if (!remoteAudio) {
    remoteAudio = new Audio();
    remoteAudio.autoplay = true;
    remoteAudio.setAttribute("playsinline", "true");
  }
  return remoteAudio;
}

function playRemoteAudio(stream: MediaStream) {
  const tracks = stream.getAudioTracks().filter((track) => track.readyState !== "ended");
  if (tracks.length === 0) return;
  for (const track of tracks) watchRemoteTrack(track);
  const audio = ensureRemoteAudio();
  const current = audio.srcObject instanceof MediaStream ? audio.srcObject : null;
  const same =
    current !== null &&
    current.getAudioTracks().map((track) => track.id).join(",") ===
      tracks.map((track) => track.id).join(",");
  if (!same) audio.srcObject = new MediaStream(tracks);
  if (!same || audio.paused) {
    void audio.play().catch((error) => logError("remote audio play failed", error));
  }
}

function playPeerAudio(pc: RTCPeerConnection) {
  const tracks = pc
    .getReceivers()
    .map((receiver) => receiver.track)
    .filter((track): track is MediaStreamTrack => Boolean(track && track.kind === "audio"));
  if (tracks.length > 0) playRemoteAudio(new MediaStream(tracks));
}

function bindRemoteAudio(pc: RTCPeerConnection) {
  if (boundPeerConnections.has(pc)) {
    playPeerAudio(pc);
    return;
  }
  boundPeerConnections.add(pc);
  pc.addEventListener("track", (event) => {
    const streamed = event.streams[0];
    if (streamed && streamed.getAudioTracks().length > 0) {
      playRemoteAudio(streamed);
    } else if (event.track?.kind === "audio") {
      playRemoteAudio(new MediaStream([event.track]));
    } else {
      playPeerAudio(pc);
    }
  });
  playPeerAudio(pc);
}

function stopRemoteAudio() {
  if (!remoteAudio) return;
  remoteAudio.pause();
  remoteAudio.srcObject = null;
}

function clearRtcSession() {
  rtcSession = null;
  pendingOutboundNumber = null;
  stopRemoteAudio();
}

function markBusyForCall() {
  void import("@/features/voice/agent-presence").then(({ applyAgentPresence }) => {
    applyAgentPresence({ state: "busy", statusName: "Busy", confirmed: false });
  });
  void updatePresence("busy", "voice")
    .then((presence) => {
      if (presence.state !== "busy") return;
      return import("@/features/voice/agent-presence").then(({ applyAgentPresence }) => {
        applyAgentPresence(presence);
      });
    })
    .catch((error) => {
      logError("presence busy during call failed", error);
    });
}

function restoreReadyAfterCall() {
  if (sipStopping || readyRestoreSent) return;
  readyRestoreSent = true;
  void import("@/features/voice/agent-presence").then(({ applyAgentPresence }) => {
    applyAgentPresence({ state: "ready", statusName: "Ready", confirmed: false });
  });
  void updatePresence("ready", "voice")
    .then((presence) => {
      if (presence.state !== "ready") return;
      return import("@/features/voice/agent-presence").then(({ applyAgentPresence }) => {
        applyAgentPresence(presence);
      });
    })
    .catch((error) => {
      readyRestoreSent = false;
      logError("presence ready after call failed", error);
    });
}

function markAcdConnected() {
  if (callState.phase === "idle") return;
  setCall({
    phase: "active",
    error: null,
    connectedAt: callState.connectedAt ?? Date.now(),
  });
}

function endCallFromRemoteBye() {
  closingFromRemote = true;
  const session = rtcSession;
  const wasActive = callState.phase === "active";
  clearRtcSession();
  try {
    session?.connection?.close();
  } catch {
    // already gone
  }
  setCall({
    ...idleCall,
    registered,
    endReason: wasActive ? "remote_bye" : null,
  });
  closingFromRemote = false;
  restoreReadyAfterCall();
}

function attachOutboundSession(session: JsSipRtcSession) {
  if (session.connection) bindRemoteAudio(session.connection);
  session.on("peerconnection", (event) => {
    const pc = (event as { peerconnection?: RTCPeerConnection }).peerconnection ?? session.connection;
    if (pc) bindRemoteAudio(pc);
  });
  for (const eventName of [
    "getusermediafailed",
    "peerconnection:setremotedescriptionfailed",
    "peerconnection:createanswerfailed",
    "peerconnection:setlocaldescriptionfailed",
  ]) {
    session.on(eventName, (error) => {
      logError(`${eventName}`, error);
    });
  }
  session.on("progress", () => {
    log("outbound ringing");
    console.info("[voice][sip] outbound.ringing", { destination: callState.destination });
    if (session.connection) playPeerAudio(session.connection);
    if (callState.phase !== "active") setCall({ phase: "ringing", error: null });
  });
  session.on("accepted", () => {
    log("outbound sip accepted");
    console.info("[voice][sip] outbound.accepted", { destination: callState.destination });
    try {
      if (session.connection) playPeerAudio(session.connection);
      if (callState.direction === "inbound" && !callState.incomingOffer) markAcdConnected();
    } catch (error) {
      // Never let UI/audio handling throw back into JsSIP's answer promise.
      // JsSIP converts listener exceptions into a failed call with "Internal Error".
      logError("accepted event handling failed", error);
    }
  });
  session.on("confirmed", () => {
    console.info("[voice][sip] outbound.confirmed", { destination: callState.destination });
    try {
      if (session.connection) playPeerAudio(session.connection);
      if (callState.direction === "inbound" && !callState.incomingOffer) markAcdConnected();
    } catch (error) {
      logError("confirmed event handling failed", error);
    }
  });
  session.on("ended", () => {
    if (closingFromRemote || rtcSession !== session) return;
    log("outbound ended");
    console.info("[voice][sip] outbound.ended", { destination: callState.destination });
    clearRtcSession();
    setCall({
      ...idleCall,
      registered,
      endReason: callState.phase === "active" ? "hangup" : null,
    });
    restoreReadyAfterCall();
  });
  session.on("failed", (event) => {
    if (closingFromRemote || rtcSession !== session) return;
    const cause = causeFromEvent(event) ?? "Call failed";
    const offered = callState.incomingOffer;
    logError("outbound failed", cause);
    console.error("[voice][sip] outbound.failed", { cause, destination: callState.destination });
    clearRtcSession();
    const failedWhileConnected = callState.phase === "active";
    if (offered) {
      setCall({ ...idleCall, registered });
    } else {
      setCall({
        ...idleCall,
        registered,
        error: cause,
        label: callState.label,
        destination: callState.destination,
        endReason: failedWhileConnected ? "failed" : null,
      });
    }
    restoreReadyAfterCall();
  });
}

function teardownUa() {
  sipStopping = true;
  const current = ua;
  ua = null;
  uaSession = null;
  registered = false;
  registeredHostPort = null;
  inviteContactUser = "";
  if (rtcSession) {
    try {
      rtcSession.terminate();
    } catch {
      // already gone
    }
    clearRtcSession();
  }
  setCall({ ...idleCall, registered: false });
  if (!current) return;
  log("unregister + stop UA");
  console.info("[voice][sip] registration.stop");
  try {
    current.unregister();
  } catch (error) {
    logError("unregister threw", error);
  }
  try {
    current.stop();
  } catch (error) {
    logError("stop threw", error);
  }
}

export async function stopSipRegistration(): Promise<void> {
  startGeneration += 1;
  if (!ua) return;
  teardownUa();
}

async function restoreSipRegistrarAfterGateway(generation: number) {
  const delays = [250, 1200];
  for (const delay of delays) {
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    if (generation !== startGeneration) return;
    try {
      await restoreSipRegistrar();
      log("restored full Redis SIP payload after gateway overwrite");
      console.info("[voice][sip] registration.redis-restored");
    } catch (error) {
      logError("Redis SIP payload restore failed", error);
    }
  }
}

function applySimpleContact(nextUa: JsSipUa, contactValue: string) {
  const registrator = nextUa.registrator();
  registrator._contact = contactValue;
  registrator.setExtraContactParams?.({});
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
    const generation = startGeneration;
    registered = true;
    registerRecovery = 0;
    setCall({});
    log("REGISTER succeeded (200)");
    console.info("[voice][sip] registration.succeeded");
    void restoreSipRegistrarAfterGateway(generation);
  });
  nextUa.on("unregistered", () => {
    registered = false;
    setCall({});
    log("unregistered");
    console.warn("[voice][sip] registration.unregistered");
  });
  nextUa.on("registrationFailed", (event) => {
    registered = false;
    const status = sipResponseStatus(event);
    logError("REGISTER failed", event);
    console.error("[voice][sip] registration.failed", {
      cause: causeFromEvent(event),
      status,
    });
    const received = pendingReceivedHost;
    const retryWithReceived = Boolean(
      received && received !== activeViaHost && registerRecovery < 1 && !sipStopping,
    );
    if (!retryWithReceived) {
      setCall({
        ...idleCall,
        registered: false,
        error: "Phone registration was rejected. Try the call again.",
      });
      return;
    }
    registerRecovery += 1;
    forcedViaHost = received;
    console.info("[voice][sip] registration.retry-received", {
      from: activeViaHost,
      received,
    });
    void restoreSipRegistrar()
      .catch((error) => logError("SIP registrar restore before retry failed", error))
      .finally(() => {
        if (sipStopping) return;
        void startSipRegistration();
      });
  });
  nextUa.on("newRTCSession", (event) => {
    const data = event as { originator?: string; session?: JsSipRtcSession };
    if (data.originator !== "remote" && data.session?.direction !== "incoming") return;
    if (!data.session) return;
    acceptIncomingCall(data.session);
  });
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

function incomingParty(session: JsSipRtcSession): { destination: string; label: string | null } {
  const number = session.remote_identity?.uri?.user?.trim() || "Unknown";
  const name = session.remote_identity?.display_name?.trim() || "";
  const label = name && name !== " " && name !== number ? name : null;
  return { destination: number, label };
}

function acceptIncomingCall(session: JsSipRtcSession) {
  if (rtcSession) {
    console.info("[voice][sip] inbound.busy");
    try {
      session.terminate({ status_code: 486, reason_phrase: "Busy Here" });
    } catch (error) {
      logError("inbound busy reject failed", error);
    }
    return;
  }
  const party = incomingParty(session);
  rtcSession = session;
  pendingOutboundNumber = null;
  console.info("[voice][sip] inbound.invite", party);
  readyRestoreSent = false;
  markBusyForCall();
  setCall({
    phase: "ringing",
    direction: "inbound",
    incomingOffer: true,
    destination: party.destination,
    label: party.label,
    error: null,
    muted: false,
    held: false,
    connectedAt: null,
    endReason: null,
  });
  attachOutboundSession(session);
  console.info("[voice][sip] inbound.offer", party);
}

export function acceptIncomingOffer(): void {
  const session = rtcSession;
  if (!session || !callState.incomingOffer) return;
  const contextError = microphoneContextError();
  if (contextError) {
    console.error("[voice][sip] inbound.media-unavailable", {
      secureContext: window.isSecureContext,
      origin: window.location.origin,
    });
    try {
      session.terminate({ status_code: 480, reason_phrase: "Secure media context required" });
    } catch (error) {
      logError("inbound media-unavailable reject failed", error);
    }
    clearRtcSession();
    setCall({
      ...idleCall,
      registered,
      error: contextError,
      label: callState.label,
      destination: callState.destination,
    });
    restoreReadyAfterCall();
    return;
  }
  try {
    session.answer?.(rtcMediaOptions());
    if (session.connection) bindRemoteAudio(session.connection);
    console.info("[voice][sip] inbound.accepted", { destination: callState.destination });
    setCall({ incomingOffer: false, phase: "ringing", error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to answer call";
    logError("inbound answer threw", error);
    clearRtcSession();
    setCall({
      ...idleCall,
      registered,
      error: message,
      label: callState.label,
      destination: callState.destination,
    });
  }
}

export function rejectIncomingOffer(): void {
  const session = rtcSession;
  if (!session || !callState.incomingOffer) return;
  console.info("[voice][sip] inbound.rejected", { destination: callState.destination });
  closingFromRemote = true;
  try {
    session.terminate({ status_code: 603, reason_phrase: "Decline" });
  } catch (error) {
    logError("inbound reject threw", error);
  }
  clearRtcSession();
  setCall({ ...idleCall, registered });
  closingFromRemote = false;
  restoreReadyAfterCall();
}

export async function startSipRegistration(): Promise<void> {
  teardownUa();
  sipStopping = false;
  const generation = ++startGeneration;

  log("fetching SIP session");
  console.info("[voice][sip] registration.session-fetch");
  let session: SipUaSession | null;
  try {
    session = await getSipSession();
  } catch (error) {
    logError("sip/session failed", error);
    return;
  }
  if (!session) {
    log("no SIP credentials for this user");
    console.info("[voice][sip] registration.skipped", { reason: "no-credentials" });
    return;
  }
  console.info("[voice][sip] registration.session", {
    ext: session.ext,
    uri: session.uri,
    wssUrl: session.wssUrl,
    realm: session.realm,
    redisRegistered: session.redisRegistered,
  });
  if (generation !== startGeneration) return;

  let viaHost = forcedViaHost;
  forcedViaHost = null;
  if (!viaHost) {
    try {
      viaHost = await discoverViaHost(session.iceServers);
      log(`Via/Contact IPv4 ${viaHost}`);
    } catch (error) {
      logError("could not discover IPv4 for Via/Contact", error);
      return;
    }
  } else {
    log(`Via/Contact IPv4 from gateway ${viaHost}`);
  }
  activeViaHost = viaHost;
  if (generation !== startGeneration) return;

  uaSession = session;
  inviteContactUser = randomInviteContactUser();
  const contactUri = sipContactUri(session.ext, viaHost);
  console.info("[voice][sip] registration.contact-uri", { contactUri, viaHost });
  const rawSocket = new JsSIP.WebSocketInterface(session.wssUrl);
  const socket = rawSocket as unknown as JsSipSocket;
  socket.via_transport = "WSS";
  wrapSipTrace(socket);

  let nextUa: JsSipUa;
  try {
    const config = {
      sockets: [rawSocket],
      uri: session.uri,
      registrar_server: session.registrarServer,
      authorization_user: session.authorizationUser,
      password: session.password,
      display_name: session.displayName || " ",
      user_agent: session.userAgent || SIP_USER_AGENT,
      contact_uri: contactUri,
      via_host: viaHost,
      register: true,
      register_expires: session.expires,
      session_timers: false,
      realm: session.realm,
      pcConfig: { iceServers: [] },
    } as unknown as ConstructorParameters<typeof JsSIP.UA>[0];
    nextUa = new JsSIP.UA(config) as unknown as JsSipUa;
  } catch (error) {
    logError("JsSIP UA construct threw", error);
    return;
  }

  applySimpleContact(nextUa, `<${contactUri}>`);
  attachUaLogs(nextUa);
  ua = nextUa;
  console.info("[voice][sip] registration.start");
  try {
    nextUa.start();
  } catch (error) {
    logError("UA start threw", error);
    ua = null;
    uaSession = null;
  }
}

export function hangupOutboundCall(): void {
  if (!rtcSession) {
    if (callState.phase === "idle") {
      log("no active outbound call to hang up");
      return;
    }
    log("hangup restored call after refresh");
    console.info("[voice][sip] outbound.hangup.restored", { destination: callState.destination });
    setCall({
      ...idleCall,
      registered,
      endReason: "hangup",
    });
    restoreReadyAfterCall();
    return;
  }
  log("hangup outbound call");
  console.info("[voice][sip] outbound.hangup", { destination: callState.destination });
  try {
    rtcSession.terminate();
  } catch (error) {
    logError("hangup threw", error);
    clearRtcSession();
    setCall({
      ...idleCall,
      registered,
      endReason: callState.phase === "active" ? "hangup" : null,
    });
  }
  restoreReadyAfterCall();
}

export function muteOutboundCall(muted: boolean): void {
  if (!rtcSession || callState.phase !== "active") return;
  try {
    if (muted) rtcSession.mute?.({ audio: true });
    else rtcSession.unmute?.({ audio: true });
    setCall({ muted });
    console.info("[voice][sip] outbound.mute", { muted });
  } catch (error) {
    logError("mute toggle failed", error);
  }
}

export function holdOutboundCall(held: boolean): void {
  if (!rtcSession || callState.phase !== "active") return;
  try {
    if (held) rtcSession.hold?.({});
    else rtcSession.unhold?.({});
    setCall({ held });
    console.info("[voice][sip] outbound.hold", { held });
  } catch (error) {
    logError("hold toggle failed", error);
  }
}

/** RFC 4733 digit on the live call. Only 0-9, * and # are in-band tones. */
export function sendOutboundDtmf(tone: string): void {
  if (!rtcSession || callState.phase !== "active") return;
  if (!/^[0-9*#]$/.test(tone)) return;
  try {
    rtcSession.sendDTMF?.(tone);
    console.info("[voice][sip] outbound.dtmf", { tone });
  } catch (error) {
    logError("dtmf send failed", error);
  }
}

export function dismissOutboundCallError(): void {
  if (callState.phase !== "idle") return;
  setCall({ error: null, label: null, destination: null });
}

export async function placeOutboundCall(
  rawNumber: string,
  dialCode: string = DEFAULT_DIAL_CODE,
  label?: string | null,
): Promise<void> {
  const number = composeDialedNumber(dialCode, rawNumber);
  console.info("[voice][sip] outbound.number", { raw: rawNumber, dialCode, number });
  if (!number) {
    setCall({ ...idleCall, registered, error: "Enter a number to dial" });
    logError("outbound call skipped: empty number");
    return;
  }
  const contextError = microphoneContextError();
  if (contextError) {
    setCall({ ...idleCall, registered, error: contextError, label: label?.trim() || null });
    logError("outbound call skipped: insecure media context");
    return;
  }
  if (!ua || !uaSession) {
    setCall({ ...idleCall, registered, error: "SIP is not connected" });
    logError("outbound call skipped: UA not started");
    return;
  }
  if (!registered) {
    setCall({ ...idleCall, registered, error: "Wait for REGISTER 200 before dialing" });
    logError("outbound call skipped: not registered");
    return;
  }
  const chosen = (uaSession.outboundCallerId ?? "").trim();
  if (!chosen) {
    setCall({ ...idleCall, registered, error: "Outbound calling is not allowed" });
    logError("outbound call skipped: no mapped DID");
    return;
  }
  if (rtcSession) {
    setCall({ error: "A call is already in progress" });
    logError("outbound call skipped: session already active");
    return;
  }

  const target = sipInviteTarget(number, uaSession.realm);
  pendingOutboundNumber = chosen;
  readyRestoreSent = false;
  console.info("[voice][sip] outbound.invite", {
    target,
    header: CRM_INVITE_HEADER,
    callerId: chosen,
  });
  setCall({
    phase: "dialing",
    direction: "outbound",
    incomingOffer: false,
    destination: number,
    label: label?.trim() || null,
    error: null,
    muted: false,
    held: false,
    connectedAt: null,
    endReason: null,
  });
  markBusyForCall();

  try {
    const session = ua.call(target, {
      extraHeaders: [CRM_INVITE_HEADER, `X-Outbound-Number: ${chosen}`],
      ...rtcMediaOptions(),
    });
    rtcSession = session;
    attachOutboundSession(session);
  } catch (error) {
    pendingOutboundNumber = null;
    clearRtcSession();
    const message = error instanceof Error ? error.message : "Unable to start call";
    logError("ua.call threw", error);
    console.error("[voice][sip] outbound.failed", { cause: message });
    setCall({ ...idleCall, registered, error: message, label: label?.trim() || null, destination: number });
    restoreReadyAfterCall();
  }
}
