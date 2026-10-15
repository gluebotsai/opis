import {
  UserAgent,
  Registerer,
  RegistererState,
  Session,
  SessionState,
  Invitation,
  Inviter,
} from 'sip.js';

export type SoftphoneRegistrationState = 'UNREGISTERED' | 'REGISTERING' | 'REGISTERED' | 'ERROR';

type IncomingCallHandler = (invitation: Invitation) => void;
type StateChangeHandler = (state: SoftphoneRegistrationState) => void;

/**
 * Browser WebRTC softphone using SIP.js over Asterisk PJSIP WebSocket.
 */
class WebRtcSoftphoneService {
  private userAgent: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private activeSession: Session | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private registrationState: SoftphoneRegistrationState = 'UNREGISTERED';
  private onIncomingCall: IncomingCallHandler | null = null;
  private onStateChange: StateChangeHandler | null = null;
  private autoAnswer = true;
  private extension = '';

  getRegistrationState(): SoftphoneRegistrationState {
    return this.registrationState;
  }

  getExtension(): string {
    return this.extension;
  }

  setAutoAnswer(enabled: boolean) {
    this.autoAnswer = enabled;
  }

  onIncoming(handler: IncomingCallHandler) {
    this.onIncomingCall = handler;
  }

  onRegistrationStateChange(handler: StateChangeHandler) {
    this.onStateChange = handler;
  }

  private setState(state: SoftphoneRegistrationState) {
    this.registrationState = state;
    this.onStateChange?.(state);
  }

  private ensureRemoteAudio(): HTMLAudioElement {
    if (!this.remoteAudio) {
      this.remoteAudio = document.createElement('audio');
      this.remoteAudio.autoplay = true;
      this.remoteAudio.id = 'webrtc-remote-audio';
      document.body.appendChild(this.remoteAudio);
    }
    return this.remoteAudio;
  }

  private setupRemoteMedia(session: Session) {
    const sdh = session.sessionDescriptionHandler as any;
    if (!sdh?.peerConnection) return;

    const audio = this.ensureRemoteAudio();
    const pc: RTCPeerConnection = sdh.peerConnection;

    const attach = () => {
      const receivers = pc.getReceivers().filter((r) => r.track && r.track.kind === 'audio');
      if (receivers.length) {
        const stream = new MediaStream(receivers.map((r) => r.track));
        audio.srcObject = stream;
        audio.play().catch(() => {});
      }
    };

    pc.addEventListener('track', attach);
    attach();
  }

  async register(options?: {
    extension?: string;
    password?: string;
    wsUrl?: string;
    domain?: string;
  }): Promise<void> {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const extension =
      options?.extension ||
      (import.meta as any).env?.VITE_AGENT_EXTENSION ||
      'w1001';
    const password =
      options?.password ||
      (import.meta as any).env?.VITE_AGENT_PASSWORD ||
      'webrtc_pass1001';
    const wsUrl =
      options?.wsUrl ||
      (import.meta as any).env?.VITE_ASTERISK_WSS_URL ||
      `ws://${hostname}:8088/ws`;
    const domain = options?.domain || hostname;

    if (this.userAgent) {
      await this.unregister();
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
      },
      authorizationUsername: extension,
      authorizationPassword: password,
      displayName: `Agent ${extension}`,
      sessionDescriptionHandlerFactoryOptions: {
        constraints: { audio: true, video: false },
        peerConnectionConfiguration: {
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        },
      },
      delegate: {
        onInvite: (invitation: Invitation) => {
          this.handleInvite(invitation);
        },
      },
    });

    this.registerer = new Registerer(this.userAgent);

    this.registerer.stateChange.addListener((state: RegistererState) => {
      if (state === RegistererState.Registered) this.setState('REGISTERED');
      else if (state === RegistererState.Unregistered) this.setState('UNREGISTERED');
      else if (state === RegistererState.Terminated) this.setState('UNREGISTERED');
    });

    try {
      await this.userAgent.start();
      await this.registerer.register();
      this.setState('REGISTERED');
    } catch (err) {
      console.error('WebRTC softphone register failed:', err);
      this.setState('ERROR');
      throw err;
    }
  }

  private async handleInvite(invitation: Invitation) {
    this.activeSession = invitation;
    this.onIncomingCall?.(invitation);

    invitation.stateChange.addListener((state: SessionState) => {
      if (state === SessionState.Established) {
        this.setupRemoteMedia(invitation);
      }
      if (state === SessionState.Terminated) {
        if (this.activeSession === invitation) {
          this.activeSession = null;
          if (this.remoteAudio) this.remoteAudio.srcObject = null;
        }
      }
    });

    if (this.autoAnswer) {
      try {
        await invitation.accept({
          sessionDescriptionHandlerOptions: {
            constraints: { audio: true, video: false },
          },
        });
        this.setupRemoteMedia(invitation);
      } catch (err) {
        console.error('Auto-answer failed:', err);
      }
    }
  }

  async answer(): Promise<void> {
    if (!this.activeSession || !(this.activeSession instanceof Invitation)) {
      return;
    }
    const invitation = this.activeSession as Invitation;
    if (invitation.state === SessionState.Initial || invitation.state === SessionState.Establishing) {
      await invitation.accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      });
      this.setupRemoteMedia(invitation);
    }
  }

  async hangup(): Promise<void> {
    if (!this.activeSession) return;
    const session = this.activeSession;
    try {
      switch (session.state) {
        case SessionState.Initial:
        case SessionState.Establishing:
          if (session instanceof Invitation) {
            await session.reject();
          } else if (session instanceof Inviter) {
            await session.cancel();
          }
          break;
        case SessionState.Established:
          await session.bye();
          break;
        default:
          break;
      }
    } catch (err) {
      console.warn('Softphone hangup error:', err);
    } finally {
      this.activeSession = null;
      if (this.remoteAudio) this.remoteAudio.srcObject = null;
    }
  }

  async mute(muted: boolean): Promise<void> {
    if (!this.activeSession) return;
    const sdh = this.activeSession.sessionDescriptionHandler as any;
    const pc: RTCPeerConnection | undefined = sdh?.peerConnection;
    if (!pc) return;
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'audio') {
        sender.track.enabled = !muted;
      }
    });
  }

  async unregister(): Promise<void> {
    try {
      await this.hangup();
      if (this.registerer) {
        await this.registerer.unregister().catch(() => {});
      }
      if (this.userAgent) {
        await this.userAgent.stop();
      }
    } catch {
      // ignore cleanup errors
    } finally {
      this.registerer = null;
      this.userAgent = null;
      this.activeSession = null;
      this.setState('UNREGISTERED');
    }
  }
}

export const webrtcSoftphone = new WebRtcSoftphoneService();
