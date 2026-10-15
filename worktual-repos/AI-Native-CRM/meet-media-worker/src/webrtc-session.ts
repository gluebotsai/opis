/**
 * Node WebRTC adapter for Meet Media API.
 * Uses optional `wrtc` when installed. Without it, the worker runs in
 * signaling-check mode only (validates OAuth + documents next step).
 */

export type AudioPcmHandler = (pcm: Int16Array, meta: { csrc?: number }) => void;

export type MeetPeerSession = {
  createOfferSdp: () => Promise<string>;
  setRemoteAnswer: (answer: string) => Promise<void>;
  close: () => void;
  /** True when real RTP audio can be consumed. */
  audioEnabled: boolean;
};

export async function createMeetPeerSession(input: {
  onAudioPcm?: AudioPcmHandler;
}): Promise<MeetPeerSession> {
  let wrtc: typeof import("wrtc") | null = null;
  try {
    wrtc = await import("wrtc");
  } catch {
    wrtc = null;
  }

  if (!wrtc?.RTCPeerConnection) {
    return createDryRunPeerSession();
  }

  const { RTCPeerConnection, RTCSessionDescription, nonstandard } = wrtc as typeof import("wrtc") & {
    nonstandard?: {
      RTCAudioSink?: new (track: MediaStreamTrack) => {
        ondata: ((ev: { samples: Int16Array }) => void) | null;
        stop: () => void;
      };
    };
  };

  const pc = new RTCPeerConnection({
    sdpSemantics: "unified-plan",
  } as RTCConfiguration);

  // Meet requires exactly 3 recvonly audio m-lines + data channels.
  for (let i = 0; i < 3; i++) {
    pc.addTransceiver("audio", { direction: "recvonly" });
  }

  const sinks: Array<{ stop: () => void }> = [];

  pc.ontrack = (ev) => {
    const track = ev.track;
    if (track.kind !== "audio") return;
    const Sink = nonstandard?.RTCAudioSink;
    if (!Sink || !input.onAudioPcm) return;
    const sink = new Sink(track);
    sink.ondata = (event) => {
      if (event?.samples?.length) {
        input.onAudioPcm?.(event.samples, {});
      }
    };
    sinks.push(sink);
  };

  // Ordered data channels required by Meet Media API.
  pc.createDataChannel("session-control", { ordered: true });
  pc.createDataChannel("media-stats", { ordered: true });

  return {
    audioEnabled: true,
    async createOfferSdp() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Wait briefly for ICE candidates in non-trickle setups
      await new Promise((r) => setTimeout(r, 500));
      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("Failed to create local SDP offer");
      return ensureSetupActive(sdp);
    },
    async setRemoteAnswer(answer: string) {
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp: answer }),
      );
    },
    close() {
      for (const s of sinks) {
        try {
          s.stop();
        } catch {
          /* ignore */
        }
      }
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function ensureSetupActive(sdp: string): string {
  // Meet requires a=setup:actpass or a=setup:active on every media section.
  return sdp
    .split("\n")
    .map((line) => {
      if (line.startsWith("a=setup:")) return "a=setup:actpass";
      return line;
    })
    .join("\n");
}

function createDryRunPeerSession(): MeetPeerSession {
  return {
    audioEnabled: false,
    async createOfferSdp() {
      // Minimal placeholder — signaling will fail until wrtc is installed /
      // Developer Preview client is wired. Kept for control-plane testing.
      throw new Error(
        "Meet Media WebRTC runtime missing. Install optional dependency `wrtc` (or use Google's reference client) and enroll the Cloud project in Workspace Developer Preview.",
      );
    },
    async setRemoteAnswer() {
      /* no-op */
    },
    close() {
      /* no-op */
    },
  };
}
