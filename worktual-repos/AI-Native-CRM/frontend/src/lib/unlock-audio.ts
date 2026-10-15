/** Unlock audio on the Sign-in click, then play TTS 30s later on the same media. */

const HEARD_KEY = "crm.briefing.heardDate";
const DUE_KEY = "crm.briefing.dueAt";
const HOLD_KEY = "__worktualBriefingHold";
const CTX_KEY = "__worktualBriefingCtx";

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

const OSC_KEY = "__worktualBriefingOsc";

type AudioWin = Window & {
  [HOLD_KEY]?: HTMLAudioElement;
  [CTX_KEY]?: AudioContext;
  [OSC_KEY]?: boolean;
};

function win(): AudioWin | null {
  if (typeof window === "undefined") return null;
  return window as AudioWin;
}

export function briefingHeardDate(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem(HEARD_KEY);
}

export function markBriefingHeard(date: string): void {
  sessionStorage.setItem(HEARD_KEY, date);
}

export function briefingPlayDueAt(): number {
  const stored = Number(sessionStorage.getItem(DUE_KEY) || 0);
  return Number.isFinite(stored) ? stored : 0;
}

export function hasLoginAudioUnlock(): boolean {
  return briefingPlayDueAt() > 0;
}

export function startBriefingDelayClock(): void {
  const dueAt = Date.now() + 30_000;
  sessionStorage.setItem(DUE_KEY, String(dueAt));
}

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext ||
    null
  );
}

function holdElement(): HTMLAudioElement {
  const w = win()!;
  if (!w[HOLD_KEY]) {
    const el = new Audio();
    el.preload = "auto";
    el.loop = true;
    el.setAttribute("playsinline", "true");
    w[HOLD_KEY] = el;
  }
  return w[HOLD_KEY]!;
}

function getContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  const w = win();
  if (!Ctor || !w) return null;
  if (!w[CTX_KEY] || w[CTX_KEY].state === "closed") {
    w[CTX_KEY] = new Ctor();
  }
  return w[CTX_KEY]!;
}

/** Must run synchronously inside the Sign-in pointer/click/submit handler. */
export function primeAudioFromUserGesture(): void {
  if (typeof window === "undefined") return;
  const el = holdElement();
  el.loop = true;
  el.muted = false;
  el.volume = 0.01;
  if (el.paused) {
    el.src = SILENT_WAV;
    void el.play().catch(() => {});
  }

  const ctx = getContext();
  if (!ctx) return;
  void ctx.resume();
  const w = win();
  if (w && !w[OSC_KEY]) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.00008;
      osc.frequency.value = 40;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      w[OSC_KEY] = true;
    } catch {
      /* ignore */
    }
  }
}

export function unlockAudioFromUserGesture(): void {
  primeAudioFromUserGesture();
}

export function resetAudioUnlock(): void {
  sessionStorage.removeItem(DUE_KEY);
  const w = win();
  const el = w?.[HOLD_KEY];
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
}

function ensurePlayableWav(buffer: ArrayBuffer): { buffer: ArrayBuffer; mime: string } {
  const bytes = new Uint8Array(buffer);
  const mime = sniffMime(buffer);
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "RIFF"
  ) {
    return { buffer, mime: "audio/wav" };
  }
  if (mime === "audio/mpeg" || mime === "audio/ogg") {
    return { buffer, mime };
  }
  return { buffer: pcm16leMonoToWav(buffer), mime: "audio/wav" };
}

function pcm16leMonoToWav(pcm: ArrayBuffer, sampleRate = 22050): ArrayBuffer {
  const src = new Uint8Array(pcm.byteLength % 2 === 0 ? pcm : pcm.slice(0, pcm.byteLength - 1));
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + src.length, true);
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
  view.setUint32(40, src.length, true);
  const out = new Uint8Array(44 + src.length);
  out.set(new Uint8Array(header), 0);
  out.set(src, 44);
  return out.buffer;
}

function sniffMime(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "RIFF"
  ) {
    return "audio/wav";
  }
  if (
    bytes.length >= 3 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!) === "ID3"
  ) {
    return "audio/mpeg";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  if (
    bytes.length >= 4 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "OggS"
  ) {
    return "audio/ogg";
  }
  return "audio/wav";
}

/**
 * Silence whatever the shared element is playing. Used when a phone call takes
 * over the speaker — the briefing must not talk over a live call.
 */
export function stopEncodedAudio(): void {
  const w = win();
  const el = w?.[HOLD_KEY];
  if (!el) return;
  try {
    el.onended = null;
    el.pause();
    el.removeAttribute("src");
    el.load();
  } catch {
    // Element already torn down.
  }
}

export async function playEncodedAudio(
  buffer: ArrayBuffer,
  onEnded: () => void,
): Promise<void> {
  const playable = ensurePlayableWav(buffer);
  const url = URL.createObjectURL(
    new Blob([playable.buffer], { type: playable.mime }),
  );
  const el = holdElement();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const ok = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      el.onended = null;
      el.onerror = null;
      el.onplaying = null;
      URL.revokeObjectURL(url);
      reject(err);
    };
    el.loop = false;
    el.muted = false;
    el.volume = 1;
    el.onplaying = () => ok();
    el.onended = () => {
      URL.revokeObjectURL(url);
      onEnded();
    };
    el.onerror = () => fail(new Error("audio element failed"));
    el.src = url;
    void el.play().then(() => ok()).catch((err) => {
      fail(err instanceof Error ? err : new Error("play blocked"));
    });
  });

  const ctx = getContext();
  if (ctx && ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }
}
