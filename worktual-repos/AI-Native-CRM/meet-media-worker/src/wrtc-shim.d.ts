declare module "wrtc" {
  export class RTCPeerConnection {
    constructor(config?: RTCConfiguration);
    addTransceiver(
      kind: string,
      init?: { direction?: string },
    ): unknown;
    createOffer(): Promise<RTCSessionDescriptionInit>;
    setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>;
    setRemoteDescription(desc: RTCSessionDescription): Promise<void>;
    createDataChannel(
      label: string,
      opts?: { ordered?: boolean },
    ): unknown;
    close(): void;
    ontrack: ((ev: { track: MediaStreamTrack }) => void) | null;
    localDescription: RTCSessionDescriptionInit | null;
  }

  export class RTCSessionDescription {
    constructor(init: RTCSessionDescriptionInit);
  }

  export const nonstandard: {
    RTCAudioSink?: new (track: MediaStreamTrack) => {
      ondata: ((ev: { samples: Int16Array }) => void) | null;
      stop: () => void;
    };
  };
}
