import {
  UserAgent,
  Registerer,
  RegistererState,
  Session,
  SessionState,
  Invitation,
  Inviter,
  TransportState,
} from 'sip.js';

export type SipState = 'UNREGISTERED' | 'REGISTERING' | 'REGISTERED' | 'ERROR';

function isSecureContextOk(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function defaultWsUrl(): string {
  const host = window.location.hostname || 'localhost';
  const envUrl = import.meta.env.VITE_ASTERISK_WSS_URL as string | undefined;
  if (window.location.protocol === 'https:') {
    return `wss://${window.location.host}/asterisk-ws`;
  }
  if (envUrl) return envUrl;
  return `ws://${host}:8088/ws`;
}

class Softphone {
  private userAgent: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private activeSession: Session | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private state: SipState = 'UNREGISTERED';
  private onState: ((s: SipState) => void) | null = null;
  private onError: ((msg: string) => void) | null = null;
  private autoAnswer = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wantRegistered = false;
  private lastOpts: {
    extension: string;
    password: string;
    wsUrl: string;
    domain: string;
  } | null = null;
  extension = '';

  getState() {
    return this.state;
  }

  setAutoAnswer(v: boolean) {
    this.autoAnswer = v;
  }

  onStateChange(cb: (s: SipState) => void) {
    this.onState = cb;
  }

  onMediaError(cb: (msg: string) => void) {
    this.onError = cb;
  }

  private setState(s: SipState) {
    this.state = s;
    this.onState?.(s);
  }

  private ensureAudio() {
    if (!this.remoteAudio) {
      this.remoteAudio = document.createElement('audio');
      this.remoteAudio.autoplay = true;
      this.remoteAudio.setAttribute('playsinline', 'true');
      (this.remoteAudio as any).playsInline = true;
      document.body.appendChild(this.remoteAudio);
    }
    return this.remoteAudio;
  }

  private playRemoteAudio() {
    const audio = this.remoteAudio;
    if (!audio) return;
    const p = audio.play();
    if (!p) return;
    p.catch((err: any) => {
      // Harmless race when track events fire back-to-back
      if (err?.name === 'AbortError') return;
      if (String(err?.message || '').includes('interrupted')) return;
      this.onError?.(`Audio playback blocked: ${err?.message || err}`);
    });
  }

  private attachMedia(session: Session) {
    const sdh = session.sessionDescriptionHandler as any;
    const pc: RTCPeerConnection | undefined = sdh?.peerConnection;
    if (!pc) return;
    const audio = this.ensureAudio();

    // Reuse one MediaStream so track updates don't replace srcObject (avoids play() abort)
    let stream = audio.srcObject instanceof MediaStream ? audio.srcObject : null;
    if (!stream) {
      stream = new MediaStream();
      audio.srcObject = stream;
    }

    const addTrack = (track: MediaStreamTrack) => {
      if (track.kind !== 'audio') return;
      if (stream!.getTracks().some((t) => t.id === track.id)) return;
      stream!.addTrack(track);
      this.playRemoteAudio();
    };

    pc.getReceivers().forEach((r) => {
      if (r.track) addTrack(r.track);
    });
    // Avoid duplicate listeners if attachMedia is called twice for same PC
    if (!(pc as any).__agentUiTrackHooked) {
      (pc as any).__agentUiTrackHooked = true;
      pc.addEventListener('track', (ev) => {
        if (ev.track) addTrack(ev.track);
      });
    }
    this.playRemoteAudio();
  }

  async ensureMicrophone(): Promise<void> {
    if (!isSecureContextOk()) {
      throw new Error(
        'Browser blocks microphone on insecure HTTP. Open https://' +
          (window.location.host || 'HOST:5174') +
          ' (accept the certificate warning), then Allow microphone.',
      );
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'getUserMedia unavailable. Use HTTPS agent UI (https://HOST:5174), not http://.',
      );
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // Unlock audio element under the same user gesture (dial / accept click)
    const audio = this.ensureAudio();
    audio.srcObject = stream;
    await audio.play().catch(() => {});
    audio.srcObject = null;
    stream.getTracks().forEach((t) => t.stop());
  }

  /** Register if needed; safe to call from dial/accept. */
  async ensureRegistered(opts?: {
    extension?: string;
    password?: string;
    wsUrl?: string;
    domain?: string;
  }): Promise<void> {
    if (this.state === 'REGISTERED' && this.userAgent) return;
    await this.register(opts);
    if (this.state !== 'REGISTERED') {
      throw new Error('SIP still not registered after retry');
    }
  }

  private scheduleReconnect() {
    if (!this.wantRegistered || !this.lastOpts) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.wantRegistered) return;
      if (this.state === 'REGISTERED') return;
      this.register(this.lastOpts!).catch((err) => {
        console.warn('SIP reconnect failed', err);
        this.scheduleReconnect();
      });
    }, 2000);
  }

  async register(opts?: { extension?: string; password?: string; wsUrl?: string; domain?: string }) {
    const host = window.location.hostname || 'localhost';
    const extension = opts?.extension || this.lastOpts?.extension || import.meta.env.VITE_AGENT_EXTENSION || 'w1001';
    const password =
      opts?.password || this.lastOpts?.password || import.meta.env.VITE_AGENT_PASSWORD || 'webrtc_pass1001';
    const wsUrl = opts?.wsUrl || this.lastOpts?.wsUrl || defaultWsUrl();
    let domain = opts?.domain || this.lastOpts?.domain || host;
    try {
      domain = opts?.domain || this.lastOpts?.domain || new URL(wsUrl.replace(/^wss?/, 'http')).hostname || host;
    } catch {
      domain = opts?.domain || this.lastOpts?.domain || host;
    }

    this.wantRegistered = true;
    this.lastOpts = { extension, password, wsUrl, domain };

    if (this.userAgent && this.state === 'REGISTERED' && this.extension === extension) {
      return;
    }

    if (this.state === 'REGISTERING') {
      // Let in-flight register finish
      await new Promise((r) => setTimeout(r, 800));
      if (this.getState() === 'REGISTERED') return;
    }

    if (this.userAgent) {
      await this.teardownUa(false);
    }

    this.extension = extension;
    this.setState('REGISTERING');

    const uri = UserAgent.makeURI(`sip:${extension}@${domain}`);
    if (!uri) {
      this.setState('ERROR');
      throw new Error('Invalid SIP URI');
    }

    this.userAgent = new UserAgent({
      uri,
      transportOptions: {
        server: wsUrl,
        connectionTimeout: 15,
      },
      authorizationUsername: extension,
      authorizationPassword: password,
      displayName: `Agent ${extension}`,
      sessionDescriptionHandlerFactoryOptions: {
        constraints: { audio: true, video: false },
        peerConnectionConfiguration: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        },
      },
      delegate: {
        onInvite: (invitation: Invitation) => {
          this.handleInvite(invitation).catch((err) => {
            console.error('handleInvite error', err);
            this.onError?.(`Failed to answer WebRTC INVITE: ${err?.message || err}`);
          });
        },
      },
    });

    this.userAgent.transport.stateChange.addListener((st: TransportState) => {
      if (st === TransportState.Disconnected || st === TransportState.Disconnecting) {
        if (this.state === 'REGISTERED' || this.state === 'REGISTERING') {
          this.setState('UNREGISTERED');
          this.onError?.('SIP WebSocket disconnected — reconnecting…');
          this.scheduleReconnect();
        }
      }
    });

    this.registerer = new Registerer(this.userAgent, { expires: 300 });
    this.registerer.stateChange.addListener((st: RegistererState) => {
      if (st === RegistererState.Registered) {
        this.setState('REGISTERED');
      } else if (st === RegistererState.Unregistered || st === RegistererState.Terminated) {
        // Ignore Unregistered while we are intentionally (re)registering
        if (this.state === 'REGISTERING') return;
        if (this.state !== 'ERROR') this.setState('UNREGISTERED');
        if (this.wantRegistered) this.scheduleReconnect();
      }
    });

    try {
      await this.userAgent.start();
      await this.registerer.register();
      this.setState('REGISTERED');
    } catch (err) {
      this.setState('ERROR');
      this.scheduleReconnect();
      throw err;
    }
  }

  private async handleInvite(invitation: Invitation) {
    this.activeSession = invitation;
    invitation.stateChange.addListener((st) => {
      if (st === SessionState.Established) this.attachMedia(invitation);
      if (st === SessionState.Terminated && this.activeSession === invitation) {
        this.activeSession = null;
        if (this.remoteAudio) this.remoteAudio.srcObject = null;
      }
    });

    if (!this.autoAnswer) return;

    try {
      await this.ensureMicrophone();
      await invitation.accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      });
      this.attachMedia(invitation);
    } catch (err: any) {
      console.error('INVITE accept failed', err);
      this.onError?.(
        `WebRTC accept failed: ${err?.message || err}. Use https:// UI and allow microphone.`,
      );
      try {
        if (invitation.state !== SessionState.Terminated) {
          await invitation.reject();
        }
      } catch {
        /* ignore */
      }
      this.activeSession = null;
      throw err;
    }
  }

  async hangup() {
    if (!this.activeSession) return;
    const s = this.activeSession;
    try {
      if (s.state === SessionState.Established) await s.bye();
      else if (s instanceof Invitation) await s.reject();
      else if (s instanceof Inviter) await s.cancel();
    } catch {
      /* ignore */
    }
    this.activeSession = null;
    if (this.remoteAudio) this.remoteAudio.srcObject = null;
  }

  async mute(muted: boolean) {
    const pc = (this.activeSession?.sessionDescriptionHandler as any)?.peerConnection as
      | RTCPeerConnection
      | undefined;
    pc?.getSenders().forEach((sender) => {
      if (sender.track?.kind === 'audio') sender.track.enabled = !muted;
    });
  }

  private async teardownUa(updateWant: boolean) {
    if (updateWant) this.wantRegistered = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      await this.hangup();
      await this.registerer?.unregister().catch(() => {});
      await this.userAgent?.stop().catch(() => {});
    } finally {
      this.registerer = null;
      this.userAgent = null;
    }
  }

  async unregister() {
    try {
      await this.teardownUa(true);
    } finally {
      this.setState('UNREGISTERED');
    }
  }
}

export const softphone = new Softphone();
export { isSecureContextOk };
