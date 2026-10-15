import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getMonitorListenAudioStream,
  getRemoteCustomerAudioStream,
  subscribeMonitorListenAudioStream,
  subscribeRemoteCustomerAudioStream,
} from "./sip-ua";

export const WAVEFORM_BAR_COUNT = 32;
const IDLE_LEVEL = 0.12;
const MID_CEILING = 0.88;
const SMOOTHING = 0.42;
const FRAME_MS = 70;
const SPEECH_FLOOR = 0.016;

export function idleWaveformLevels(barCount = WAVEFORM_BAR_COUNT): number[] {
  return Array.from({ length: barCount }, () => IDLE_LEVEL);
}

const IDLE_LEVELS = idleWaveformLevels();

type BrowserWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export function levelsFromTimeDomain(
  samples: ArrayLike<number>,
  barCount = WAVEFORM_BAR_COUNT,
): number[] {
  const bucketSize = Math.max(1, Math.floor(samples.length / barCount));
  const raw = Array.from({ length: barCount }, (_, index) => {
    const start = index * bucketSize;
    let energy = 0;
    let peak = 0;
    let count = 0;
    for (let offset = 0; offset < bucketSize; offset += 1) {
      const sample = samples[start + offset];
      if (sample == null) break;
      const amplitude = Math.abs(sample - 128) / 128;
      peak = Math.max(peak, amplitude);
      energy += amplitude * amplitude;
      count += 1;
    }
    if (count === 0) return 0;
    const rms = Math.sqrt(energy / count);
    return Math.max(rms * 1.7, peak * 0.85);
  });

  const loudest = raw.reduce((max, value) => Math.max(max, value), 0);
  if (loudest < SPEECH_FLOOR) return idleWaveformLevels(barCount);

  const gain = Math.min(12, 0.84 / loudest);
  return raw.map((value) => Math.max(IDLE_LEVEL, Math.min(MID_CEILING, value * gain)));
}

export function smoothWaveformLevels(
  previous: number[],
  next: number[],
  amount = SMOOTHING,
): number[] {
  return next.map((value, index) => {
    const prior = previous[index] ?? IDLE_LEVEL;
    return prior + (value - prior) * amount;
  });
}

export function isCustomerSpeaking(levels: number[]): boolean {
  const average = levels.reduce((sum, value) => sum + value, 0) / levels.length;
  return average > 0.18;
}

export function useRemoteCustomerWaveform(enabled: boolean): {
  levels: number[];
  speaking: boolean;
} {
  const stream = useSyncExternalStore(
    subscribeRemoteCustomerAudioStream,
    getRemoteCustomerAudioStream,
    () => null,
  );
  const [levels, setLevels] = useState<number[]>(IDLE_LEVELS);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!enabled || !stream || typeof window === "undefined") {
      setLevels(IDLE_LEVELS);
      setSpeaking(false);
      return;
    }

    const audioTracks = stream.getAudioTracks().filter((track) => track.readyState !== "ended");
    if (audioTracks.length === 0) {
      setLevels(IDLE_LEVELS);
      setSpeaking(false);
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ?? (window as BrowserWindow).webkitAudioContext;
    if (!AudioContextConstructor) return;

    const context = new AudioContextConstructor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.62;
    let source: MediaStreamAudioSourceNode;
    try {
      source = context.createMediaStreamSource(
        audioTracks.length === stream.getAudioTracks().length ? stream : new MediaStream(audioTracks),
      );
    } catch {
      void context.close();
      setLevels(IDLE_LEVELS);
      setSpeaking(false);
      return;
    }
    source.connect(analyser);
    const timeDomain = new Uint8Array(analyser.fftSize);
    let previous = IDLE_LEVELS;
    void context.resume().catch(() => undefined);

    const draw = () => {
      analyser.getByteTimeDomainData(timeDomain);
      const next = smoothWaveformLevels(previous, levelsFromTimeDomain(timeDomain));
      previous = next;
      setLevels(next);
      setSpeaking(isCustomerSpeaking(next));
    };
    draw();
    const timer = window.setInterval(draw, FRAME_MS);

    return () => {
      window.clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      void context.close();
      setLevels(IDLE_LEVELS);
      setSpeaking(false);
    };
  }, [enabled, stream]);

  return { levels, speaking };
}

const idleParty = { levels: IDLE_LEVELS, speaking: false };

/** Bars for the supervisor listen leg. Customer and agent follow separate tracks or channels. */
export function useMonitorListenWaveform(enabled: boolean): {
  customer: { levels: number[]; speaking: boolean };
  agent: { levels: number[]; speaking: boolean };
} {
  const stream = useSyncExternalStore(
    subscribeMonitorListenAudioStream,
    getMonitorListenAudioStream,
    () => null,
  );
  const [customer, setCustomer] = useState(idleParty);
  const [agent, setAgent] = useState(idleParty);

  useEffect(() => {
    if (!enabled || !stream || typeof window === "undefined") {
      setCustomer(idleParty);
      setAgent(idleParty);
      return;
    }
    const tracks = stream.getAudioTracks();
    const primary = tracks[0];
    if (!primary) {
      setCustomer(idleParty);
      setAgent(idleParty);
      return;
    }
    const AudioContextConstructor =
      window.AudioContext ?? (window as BrowserWindow).webkitAudioContext;
    if (!AudioContextConstructor) return;

    const context = new AudioContextConstructor();
    const customerAnalyser = context.createAnalyser();
    const agentAnalyser = context.createAnalyser();
    for (const analyser of [customerAnalyser, agentAnalyser]) {
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.62;
    }
    const nodes: AudioNode[] = [];
    const secondary = tracks[1];
    if (secondary) {
      const customerSource = context.createMediaStreamSource(new MediaStream([primary]));
      const agentSource = context.createMediaStreamSource(new MediaStream([secondary]));
      customerSource.connect(customerAnalyser);
      agentSource.connect(agentAnalyser);
      nodes.push(customerSource, agentSource);
    } else {
      const source = context.createMediaStreamSource(new MediaStream([primary]));
      nodes.push(source);
      if (source.channelCount >= 2) {
        const splitter = context.createChannelSplitter(2);
        source.connect(splitter);
        splitter.connect(customerAnalyser, 0);
        splitter.connect(agentAnalyser, 1);
        nodes.push(splitter);
      } else {
        source.connect(customerAnalyser);
        source.connect(agentAnalyser);
      }
    }
    const customerSamples = new Uint8Array(customerAnalyser.fftSize);
    const agentSamples = new Uint8Array(agentAnalyser.fftSize);
    let previousCustomer = IDLE_LEVELS;
    let previousAgent = IDLE_LEVELS;
    void context.resume().catch(() => undefined);

    const draw = () => {
      customerAnalyser.getByteTimeDomainData(customerSamples);
      agentAnalyser.getByteTimeDomainData(agentSamples);
      const nextCustomer = smoothWaveformLevels(previousCustomer, levelsFromTimeDomain(customerSamples));
      const nextAgent = smoothWaveformLevels(previousAgent, levelsFromTimeDomain(agentSamples));
      previousCustomer = nextCustomer;
      previousAgent = nextAgent;
      setCustomer({ levels: nextCustomer, speaking: isCustomerSpeaking(nextCustomer) });
      setAgent({ levels: nextAgent, speaking: isCustomerSpeaking(nextAgent) });
    };
    draw();
    const timer = window.setInterval(draw, FRAME_MS);

    return () => {
      window.clearInterval(timer);
      for (const node of nodes) node.disconnect();
      customerAnalyser.disconnect();
      agentAnalyser.disconnect();
      void context.close();
      setCustomer(idleParty);
      setAgent(idleParty);
    };
  }, [enabled, stream]);

  return { customer, agent };
}
