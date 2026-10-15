/**
 * Stream mic PCM16 over WebSocket → CRM STT → Assist chunks.
 * Falls back to HTTP WAV slices if the socket cannot connect.
 */

import { api } from "@/services/api";
import { getMeetingAssistPanelToken } from "@/lib/meeting-assist-panel-auth";

export type SttCaptureHandlers = {
  onText: (text: string) => void;
  onError?: (message: string) => void;
  onListeningChange?: (listening: boolean) => void;
  onStatus?: (status: string | null) => void;
  speaker?: string;
  /** HTTP fallback slice length in ms (default 800). */
  sliceMs?: number;
};

export type SttCaptureController = {
  stop: () => void;
};

const TARGET_SAMPLE_RATE = 16_000;

function floatTo16BitPcm(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downsample(
  input: Float32Array,
  inputRate: number,
  targetRate: number,
): Float32Array {
  if (inputRate === targetRate) return input;
  const ratio = inputRate / targetRate;
  const newLen = Math.max(1, Math.floor(input.length / ratio));
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = Math.floor(i * ratio);
    result[i] = input[idx] ?? 0;
  }
  return result;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const pcm = floatTo16BitPcm(samples);
  const dataSize = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(offset, pcm[i]!, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function streamUrl(sessionId: string): string {
  const token = getMeetingAssistPanelToken();
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${proto}//${window.location.host}/api/meeting-assist/sessions/${encodeURIComponent(sessionId)}/stt/stream${qs}`;
}

async function openMic(): Promise<{
  stream: MediaStream;
  audioCtx: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  mute: GainNode;
  inputRate: number;
}> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error("Microphone is not available in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    },
  });

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const audioCtx = new AudioCtx();
  if (audioCtx.state === "suspended") {
    await audioCtx.resume().catch(() => undefined);
  }
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  return {
    stream,
    audioCtx,
    source,
    processor,
    mute,
    inputRate: audioCtx.sampleRate,
  };
}

function tearDownMic(parts: {
  stream: MediaStream;
  audioCtx: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  mute: GainNode;
}) {
  try {
    parts.processor.disconnect();
    parts.source.disconnect();
    parts.mute.disconnect();
  } catch {
    /* ignore */
  }
  void parts.audioCtx.close();
  parts.stream.getTracks().forEach((t) => t.stop());
}

/**
 * Prefer WebSocket PCM streaming; HTTP WAV is the fallback path.
 */
export async function startWorktualSttCapture(
  sessionId: string,
  handlers: SttCaptureHandlers,
): Promise<SttCaptureController> {
  if (!sessionId) throw new Error("Missing session.");

  try {
    return await startWsCapture(sessionId, handlers);
  } catch (err) {
    console.warn("STT stream unavailable, falling back to HTTP", err);
    return startHttpCapture(sessionId, handlers);
  }
}

async function startWsCapture(
  sessionId: string,
  handlers: SttCaptureHandlers,
): Promise<SttCaptureController> {
  const mic = await openMic();
  const ws = new WebSocket(streamUrl(sessionId));
  ws.binaryType = "arraybuffer";

  let stopped = false;
  const lastTextRef = { current: "" };

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("STT stream connect timeout"));
    }, 8_000);
    ws.onopen = () => {
      window.clearTimeout(timer);
      ws.send(
        JSON.stringify({
          type: "start",
          speaker: handlers.speaker || "Customer",
        }),
      );
      resolve();
    };
    ws.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("STT stream failed to connect"));
    };
  });

  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    try {
      const msg = JSON.parse(ev.data) as {
        type?: string;
        text?: string;
        error?: string;
        status?: string;
      };
      if (msg.type === "partial" || msg.type === "final") {
        const text = (msg.text || "").trim();
        if (text && text !== lastTextRef.current) {
          lastTextRef.current = text;
          handlers.onText(text);
        }
        if (msg.type === "final") handlers.onStatus?.(null);
      } else if (msg.type === "status") {
        if (msg.status === "transcribing") handlers.onStatus?.("Transcribing…");
        else if (msg.status === "listening") handlers.onStatus?.(null);
      } else if (msg.type === "error" && msg.error) {
        handlers.onError?.(msg.error);
      }
    } catch {
      /* ignore */
    }
  };

  ws.onclose = () => {
    if (!stopped) handlers.onListeningChange?.(false);
  };

  mic.processor.onaudioprocess = (ev) => {
    if (stopped || ws.readyState !== WebSocket.OPEN) return;
    const input = ev.inputBuffer.getChannelData(0);
    const down = downsample(input, mic.inputRate, TARGET_SAMPLE_RATE);
    const pcm = floatTo16BitPcm(down);
    ws.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  };

  handlers.onListeningChange?.(true);

  return {
    stop: () => {
      stopped = true;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "stop" }));
          ws.close();
        }
      } catch {
        /* ignore */
      }
      tearDownMic(mic);
      handlers.onListeningChange?.(false);
      handlers.onStatus?.(null);
    },
  };
}

async function startHttpCapture(
  sessionId: string,
  handlers: SttCaptureHandlers,
): Promise<SttCaptureController> {
  const mic = await openMic();
  const sliceMs = handlers.sliceMs ?? 800;
  let stopped = false;
  let uploading = false;
  let pending: Float32Array[] = [];
  let pendingSamples = 0;
  const lastTextRef = { current: "" };
  const inputRate = mic.inputRate;
  const samplesPerSlice = Math.floor((inputRate * sliceMs) / 1000);

  const flush = async () => {
    if (stopped || pendingSamples < inputRate * 0.35) {
      pending = [];
      pendingSamples = 0;
      return;
    }
    if (uploading) return;

    const merged = new Float32Array(pendingSamples);
    let offset = 0;
    for (const part of pending) {
      merged.set(part, offset);
      offset += part.length;
    }
    pending = [];
    pendingSamples = 0;

    const down = downsample(merged, inputRate, TARGET_SAMPLE_RATE);
    let peak = 0;
    for (let i = 0; i < down.length; i++) {
      const a = Math.abs(down[i]!);
      if (a > peak) peak = a;
    }
    if (peak < 0.01) return;

    const wav = encodeWav(down, TARGET_SAMPLE_RATE);
    uploading = true;
    handlers.onStatus?.("Transcribing…");
    try {
      const audioBase64 = await blobToBase64(wav);
      const { data } = await api.post<{
        ok?: boolean;
        text?: string;
        error?: string;
      }>(`/api/meeting-assist/sessions/${sessionId}/stt`, {
        audioBase64,
        mimeType: "audio/wav",
        filename: "slice.wav",
        speaker: handlers.speaker || "Customer",
      });
      if (data && data.ok === false) {
        handlers.onError?.(data.error || "STT failed");
        return;
      }
      const text = (data.text || "").trim();
      if (text && text !== lastTextRef.current) {
        lastTextRef.current = text;
        handlers.onText(text);
      }
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err.message : "STT failed");
    } finally {
      uploading = false;
      if (!stopped) handlers.onStatus?.(null);
    }
  };

  mic.processor.onaudioprocess = (ev) => {
    if (stopped) return;
    const input = ev.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    pending.push(copy);
    pendingSamples += copy.length;
    if (pendingSamples >= samplesPerSlice) {
      void flush();
    }
  };

  handlers.onListeningChange?.(true);

  return {
    stop: () => {
      stopped = true;
      tearDownMic(mic);
      handlers.onListeningChange?.(false);
      handlers.onStatus?.(null);
    },
  };
}
