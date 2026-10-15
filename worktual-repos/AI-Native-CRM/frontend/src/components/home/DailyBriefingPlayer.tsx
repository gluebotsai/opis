import { useEffect, useState } from "react";
import { EyeOff } from "lucide-react";
import {
  fetchDailyBriefing,
  fetchDailyBriefingAudio,
  markDailyBriefingPlayed,
} from "@/services/home";
import {
  briefingHeardDate,
  briefingPlayDueAt,
  hasLoginAudioUnlock,
  markBriefingHeard,
  playEncodedAudio,
  stopEncodedAudio,
} from "@/lib/unlock-audio";
import {
  getOutboundCallState,
  subscribeOutboundCall,
} from "@/features/voice/sip-ua";

type Engine = {
  script: string;
  dateKey: string;
  buffer: ArrayBuffer | null;
  started: boolean;
  finished: boolean;
  playing: boolean;
  panelHidden: boolean;
  dueAt: number;
  retries: number;
  timer: ReturnType<typeof setTimeout> | null;
};

let engine: Engine | null = null;
let fetchInFlight = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function ensureEngine(dueAt: number): Engine {
  if (!engine) {
    engine = {
      script: "",
      dateKey: "",
      buffer: null,
      started: false,
      finished: false,
      playing: false,
      panelHidden: false,
      dueAt,
      retries: 0,
      timer: null,
    };
  }
  return engine;
}

export function resetDailyBriefingSession(): void {
  if (engine?.timer) clearTimeout(engine.timer);
  engine = null;
  fetchInFlight = false;
  emit();
}

function finishPlayback() {
  if (!engine || engine.finished) return;
  engine.playing = false;
  engine.finished = true;
  engine.started = true;
  if (engine.dateKey) markBriefingHeard(engine.dateKey);
  emit();
}

function hideBriefingPanel() {
  if (!engine) return;
  engine.panelHidden = true;
  // Hiding the briefing dismisses it: stop the voice, drop any pending or
  // call-deferred play, and mark it heard so it does not start again later.
  stopEncodedAudio();
  if (engine.timer) {
    clearTimeout(engine.timer);
    engine.timer = null;
  }
  finishPlayback();
  emit();
}

/** Ringing, connecting or connected — the speaker belongs to the call. */
function callIsLive(): boolean {
  try {
    return getOutboundCallState().phase !== "idle";
  } catch {
    return false;
  }
}

/** How often to re-check once a call has pushed the briefing back. */
const CALL_DEFER_MS = 5000;

let callWatch: (() => void) | null = null;

function schedulePlay() {
  if (
    !engine ||
    engine.started ||
    engine.finished ||
    !engine.script ||
    !hasLoginAudioUnlock()
  ) {
    return;
  }
  if (engine.timer) {
    clearTimeout(engine.timer);
    engine.timer = null;
  }
  const wait = Math.max(0, engine.dueAt - Date.now());
  engine.timer = setTimeout(() => {
    if (engine) engine.timer = null;
    void playBriefing();
  }, wait);
}

async function ensureAudioBuffer(): Promise<ArrayBuffer> {
  if (engine?.buffer && engine.buffer.byteLength > 16) return engine.buffer;
  const buf = await fetchDailyBriefingAudio();
  if (engine) engine.buffer = buf;
  return buf;
}

async function playBriefing() {
  if (!engine || engine.started || engine.finished || !engine.script) return;
  if (!hasLoginAudioUnlock()) return;
  if (callIsLive()) {
    // Wait the call out rather than talking over it. Deliberately not counted
    // as a retry, so a long call cannot exhaust the error budget.
    if (engine.timer) clearTimeout(engine.timer);
    engine.timer = setTimeout(() => {
      if (engine) engine.timer = null;
      void playBriefing();
    }, CALL_DEFER_MS);
    return;
  }
  engine.started = true;
  try {
    const buffer = await ensureAudioBuffer();
    await playEncodedAudio(buffer, finishPlayback);
    engine.playing = true;
    emit();
    void markDailyBriefingPlayed();
  } catch {
    engine.started = false;
    engine.playing = false;
    emit();
    const retries = (engine.retries ?? 0) + 1;
    engine.retries = retries;
    if (retries <= 4) {
      engine.timer = setTimeout(() => {
        if (engine) engine.timer = null;
        void playBriefing();
      }, 1500);
    }
  }
}

export function startDailyBriefingClock(): void {
  if (!hasLoginAudioUnlock()) return;
  if (!callWatch) {
    callWatch = subscribeOutboundCall(() => {
      if (!engine?.playing || !callIsLive()) return;
      // A call started while the briefing was speaking — cut it and re-arm so
      // the briefing is delivered once the call is over.
      stopEncodedAudio();
      engine.playing = false;
      engine.started = false;
      emit();
      schedulePlay();
    });
  }
  const dueAt = briefingPlayDueAt();
  if (engine?.started && !engine.finished) return;
  if (engine?.finished) {
    engine.finished = false;
    engine.started = false;
    engine.playing = false;
    engine.panelHidden = false;
  }
  ensureEngine(dueAt).dueAt = dueAt;
  void loadAndArmBriefing();
}

async function loadAndArmBriefing() {
  if (fetchInFlight) return;
  if (!hasLoginAudioUnlock()) return;
  const dueAt = engine?.dueAt || briefingPlayDueAt();
  if (!dueAt) return;
  const current = ensureEngine(dueAt);
  if (current.started && !current.finished) return;
  fetchInFlight = true;
  try {
    const briefing = await fetchDailyBriefing();
    if (!engine) return;
    if (briefing.enabled === false) {
      engine.finished = true;
      engine.playing = false;
      emit();
      return;
    }
    const alreadyHeard =
      Boolean(briefing.playedAt) &&
      briefingHeardDate() === (briefing.briefingDate || "");
    if (alreadyHeard) {
      engine.finished = true;
      engine.playing = false;
      emit();
      return;
    }
    if (!briefing.script) {
      fetchInFlight = false;
      window.setTimeout(() => {
        void loadAndArmBriefing();
      }, 4000);
      return;
    }
    engine.finished = false;
    engine.script = briefing.script;
    engine.dateKey = briefing.briefingDate || "";
    engine.dueAt = dueAt;
    void ensureAudioBuffer().catch(() => {});
    schedulePlay();
  } catch {
    window.setTimeout(() => {
      void loadAndArmBriefing();
    }, 4000);
  } finally {
    fetchInFlight = false;
  }
}

export function DailyBriefingPlayer() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    if (hasLoginAudioUnlock()) void loadAndArmBriefing();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (!engine?.playing || engine.panelHidden || !engine.script) return null;

  return (
    <div
      className="absolute inset-x-3 top-2 z-30 max-h-[40%] overflow-y-auto rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 pr-12 text-sm leading-relaxed text-text-primary shadow-lg sm:inset-x-4"
      role="status"
    >
      <button
        type="button"
        onClick={hideBriefingPanel}
        className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-violet-100 hover:text-neutral-800"
        aria-label="Hide briefing"
        title="Hide briefing"
      >
        <EyeOff className="size-4" />
      </button>
      <div className="whitespace-pre-line">{engine.script}</div>
    </div>
  );
}
