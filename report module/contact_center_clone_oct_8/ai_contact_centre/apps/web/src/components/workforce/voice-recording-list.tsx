import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownLeft, ArrowUpRight, Check, Clock3, Copy, Download, EllipsisVertical, Headphones, LoaderCircle, Pause, Play, UserRound, X } from "lucide-react";

import { useCopilotWorkspacePanels } from "@/components/assistant/copilot-workspace";
import { IconButton } from "@/components/ui/button";
import { ProfileDetailList, ProfileDetailRow } from "@/components/ui/profile-detail-row";
import { listRowDividerClassName } from "@/components/ui/list-row";
import { WaveformBars } from "@/components/workspace/workspace-voice-call-bar";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { organizationSettingsApi } from "@/features/workforce/organization-settings/api";
import type { VoiceRecording } from "@/features/workforce/organization-settings/types";
import {
  idleWaveformLevels,
  isCustomerSpeaking,
  levelsFromTimeDomain,
  smoothWaveformLevels,
} from "@/features/voice/use-remote-customer-waveform";
import { cn } from "@/lib/utils";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${clock}` : clock;
}

function startedParts(iso: string): { date: string; time: string; label: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: "", time: "", label: "" };
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return { date: day, time, label: `${day} · ${time}` };
}

function customerDisplay(row: VoiceRecording): { name: string; number: string | null } {
  const number = row.customerNumber.trim();
  const rawName = row.customerName.trim();
  const digits = (value: string) => value.replace(/\D/g, "");
  const nameIsNumber = digits(rawName).length > 0 && digits(rawName) === digits(number);
  if (!rawName || nameIsNumber) {
    return { name: number || "Unknown caller", number: null };
  }
  return { name: rawName, number: number || null };
}

function recordingFileName(row: VoiceRecording): string {
  try {
    const base = decodeURIComponent(new URL(row.recordingUrl).pathname.split("/").pop() ?? "");
    if (base.includes(".")) return base;
  } catch {
    // Fall through to a name built from the call.
  }
  const who = (row.customerName || row.customerNumber || "recording").replace(/[^\w.-]+/g, "-");
  return `${who}.mp3`;
}

async function playbackUrl(row: VoiceRecording, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(row.id);
  if (cached) return cached;
  const blob = await organizationSettingsApi.recordingAudio(row.id);
  const objectUrl = URL.createObjectURL(blob);
  cache.set(row.id, objectUrl);
  return objectUrl;
}

function loadRecording(audio: HTMLAudioElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (ok: boolean) => {
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("error", onError);
      if (ok) resolve();
      else reject(new Error("recording failed to load"));
    };
    const onReady = () => finish(true);
    const onError = () => finish(false);
    audio.addEventListener("canplay", onReady);
    audio.addEventListener("error", onError);
    audio.src = url;
    audio.load();
  });
}

function downloadRecording(row: VoiceRecording) {
  const anchor = document.createElement("a");
  anchor.href = row.recordingUrl;
  anchor.download = recordingFileName(row);
  anchor.target = "_blank";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

type RecordingLayout = "compact" | "table" | "studio";

function useRecordingLayout(): RecordingLayout {
  const panels = useCopilotWorkspacePanels();
  if (!panels) return "compact";
  if (panels.copilotMinimized) return "studio";
  if (panels.expandedSide === "right") return "table";
  return "compact";
}

function RecordingPlayer({
  levels,
  live,
  speaking,
  progress,
  elapsedMs,
  durationMs,
  startedAt,
  showDate = true,
  trailing,
  onSeek,
}: {
  levels: number[];
  live: boolean;
  speaking: boolean;
  progress: number;
  elapsedMs: number;
  durationMs: number;
  startedAt: string;
  showDate?: boolean;
  trailing?: ReactNode;
  onSeek: (ratio: number) => void;
}) {
  const played = Math.min(1, Math.max(0, progress));

  function ratioFromPointer(event: ReactPointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="flex h-8 w-full items-center">
        <WaveformBars levels={levels} live={live} speaking={speaking} />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="w-10 shrink-0 text-xs tabular-nums text-neutral-900">
          {formatClock(elapsedMs)}
        </span>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek recording"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(played * 100)}
          className="relative h-6 min-w-0 flex-1 cursor-pointer touch-none"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onSeek(ratioFromPointer(event));
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            onSeek(ratioFromPointer(event));
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") onSeek(Math.min(1, played + 0.05));
            if (event.key === "ArrowLeft") onSeek(Math.max(0, played - 0.05));
          }}
        >
          <div className="pointer-events-none absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full bg-neutral-200" />
          <div
            className="pointer-events-none absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-neutral-900"
            style={{ width: `${played * 100}%` }}
          />
          <span
            className="pointer-events-none absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-neutral-900"
            style={{ left: `calc(${played * 100}% - 5px)` }}
          />
        </div>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-neutral-500">
          {formatClock(durationMs)}
        </span>
        {trailing}
      </div>
      {showDate ? (
        <p className="mt-1 inline-flex min-w-0 items-center gap-1 text-xs text-neutral-500">
          <Clock3 className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
          <span className="truncate">{startedAt}</span>
        </p>
      ) : null}
    </div>
  );
}

function RecordingCustomerAvatar({ name }: { name: string }) {
  return (
    <div className={profileAvatarClassName(name, "size-[38px] self-center text-xs")}>
      {profileInitials(name)}
    </div>
  );
}

function RecordingDirectionPill({ inbound }: { inbound: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium",
        inbound ? "bg-emerald-50 text-emerald-600" : "bg-neutral-100 text-neutral-700",
      )}
    >
      {inbound ? (
        <ArrowDownLeft className="size-3" strokeWidth={2.25} aria-hidden />
      ) : (
        <ArrowUpRight className="size-3" strokeWidth={2.25} aria-hidden />
      )}
      {inbound ? "Inbound" : "Outbound"}
    </span>
  );
}

function RecordingFact({
  icon,
  primary,
  secondary,
}: {
  icon: ReactNode;
  primary: string;
  secondary?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-neutral-500">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-sm text-neutral-900">{primary}</p>
        {secondary ? <p className="truncate text-xs text-neutral-500">{secondary}</p> : null}
      </div>
    </div>
  );
}

function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-neutral-200", className)} />;
}

const STUDIO_GRID =
  "grid w-full grid-cols-[minmax(0,1.3fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(16rem,1.8fr)_auto] items-center gap-4";

function RecordingRowSkeleton({ layout }: { layout: RecordingLayout }) {
  if (layout === "studio") {
    return (
      <div className={cn(STUDIO_GRID, "py-3")}>
        <div className="flex min-w-0 items-center gap-3">
          <Bone className="size-[38px] shrink-0 rounded-full" />
          <div className="min-w-0 space-y-1.5">
            <Bone className="h-3.5 w-32" />
            <Bone className="h-3 w-24" />
          </div>
        </div>
        <Bone className="h-6 w-20 rounded-full" />
        <div className="flex min-w-0 items-center gap-3">
          <Bone className="size-[38px] shrink-0 rounded-full" />
          <Bone className="h-3.5 w-24" />
        </div>
        <Bone className="h-[72px] w-full rounded-xl" />
        <Bone className="size-[38px] shrink-0 rounded-lg" />
      </div>
    );
  }

  if (layout === "table") {
    return (
      <div className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(10rem,1.1fr)_auto] items-center gap-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Bone className="size-[38px] shrink-0 rounded-full" />
          <div className="min-w-0 space-y-1.5">
            <Bone className="h-3.5 w-32" />
            <Bone className="h-3 w-24" />
          </div>
        </div>
        <Bone className="h-3.5 w-16" />
        <Bone className="h-3.5 w-16" />
        <Bone className="h-3.5 w-20" />
        <Bone className="h-3.5 w-20" />
        <div className="min-w-0 space-y-2">
          <Bone className="h-6 w-full" />
          <Bone className="h-2 w-full" />
        </div>
        <Bone className="size-[38px] shrink-0 rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-4 px-3 py-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Bone className="size-[38px] shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Bone className="h-3.5 w-40" />
          <Bone className="h-3.5 w-36 max-w-full" />
          <div className="flex gap-1.5">
            <Bone className="h-6 w-16 rounded-full" />
            <Bone className="h-6 w-14 rounded-full" />
          </div>
        </div>
      </div>
      <div className="flex min-w-[16rem] flex-1 items-center gap-3 sm:max-w-md sm:flex-none">
        <div className="min-w-0 flex-1 space-y-2">
          <Bone className="h-6 w-full" />
          <Bone className="h-2 w-full" />
          <Bone className="h-3 w-28" />
        </div>
        <Bone className="size-[38px] shrink-0 rounded-full" />
        <Bone className="size-[38px] shrink-0 rounded-lg" />
      </div>
    </div>
  );
}

export function VoiceRecordingListSkeleton({ rows = 6 }: { rows?: number }) {
  const layout = useRecordingLayout();
  return (
    <ul aria-busy="true" aria-label="Loading recordings">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className={listRowDividerClassName("4")}>
          <RecordingRowSkeleton layout={layout} />
        </li>
      ))}
    </ul>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy"}
      title={copied ? "Copied" : "Copy"}
      className="mt-0.5 flex size-[18px] shrink-0 cursor-pointer items-center justify-center text-neutral-500 hover:text-neutral-900"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? (
        <Check className="size-[18px]" strokeWidth={2.25} aria-hidden />
      ) : (
        <Copy className="size-[18px]" strokeWidth={2.25} aria-hidden />
      )}
    </button>
  );
}

function RecordingPlaybackCard({
  playing,
  onToggle,
  player,
}: {
  playing: boolean;
  onToggle: () => void;
  player: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] px-3 py-3" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? "Pause recording" : "Play recording"}
          title={playing ? "Pause" : "Play"}
          className="mt-0.5 flex size-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-neutral-900 text-white transition hover:bg-neutral-800 active:scale-95"
        >
          {playing ? (
            <Pause className="size-4 fill-current" strokeWidth={0} aria-hidden />
          ) : (
            <Play className="ml-0.5 size-4 fill-current" strokeWidth={0} aria-hidden />
          )}
        </button>
        {player}
      </div>
    </div>
  );
}

export function RecordingDetailsPanel({
  recording,
  playing,
  onClose,
  onToggle,
  player,
}: {
  recording: VoiceRecording;
  playing: boolean;
  onClose: () => void;
  onToggle: () => void;
  player: ReactNode;
}) {
  const inbound = recording.direction === "inbound";
  const customer = customerDisplay(recording);
  const agent = recording.agentName || (recording.agentExt ? `Ext ${recording.agentExt}` : "—");
  const extension = recording.agentName && recording.agentExt ? `Ext ${recording.agentExt}` : null;
  const started = startedParts(recording.startedAt);
  const when = started.date && started.time ? `${started.date}, ${started.time}` : started.label;

  return (
    <aside className="flex min-h-0 w-full flex-1 flex-col border-t-[0.6px] border-[#bfbfbf] bg-white xl:border-t-0 xl:border-l-[0.6px]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-900">Recording details</h3>
        <IconButton aria-label="Close recording details" onClick={onClose}>
          <X strokeWidth={2.25} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-neutral-600">{when || "Voice call"}</p>
          <RecordingDirectionPill inbound={inbound} />
        </div>
        <div className="mt-3">
          <RecordingPlaybackCard playing={playing} onToggle={onToggle} player={player} />
        </div>
        <ProfileDetailList className="mt-4">
          <ProfileDetailRow label="Customer">{customer.name}</ProfileDetailRow>
          {customer.number ? <ProfileDetailRow label="Phone">{customer.number}</ProfileDetailRow> : null}
          <ProfileDetailRow label="Agent">{agent}</ProfileDetailRow>
          {extension ? <ProfileDetailRow label="Extension">{extension}</ProfileDetailRow> : null}
          <ProfileDetailRow label="Queue">{recording.queueName ?? "—"}</ProfileDetailRow>
          <ProfileDetailRow label="Direction">
            <RecordingDirectionPill inbound={inbound} />
          </ProfileDetailRow>
          <ProfileDetailRow label="Date & time">{when || "—"}</ProfileDetailRow>
          <ProfileDetailRow label="Duration">{formatClock(recording.recordingDurationMs)}</ProfileDetailRow>
          <ProfileDetailRow label="Recording URL">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">{recording.recordingUrl}</span>
              <CopyButton text={recording.recordingUrl} />
            </span>
          </ProfileDetailRow>
        </ProfileDetailList>
      </div>
    </aside>
  );
}

function RecordingRowMenu({
  busy,
  onDownload,
}: {
  busy: boolean;
  onDownload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div
      ref={menuRef}
      className="relative"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Recording actions"
        aria-expanded={open}
        className="flex size-[38px] cursor-pointer items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
        onClick={() => setOpen((current) => !current)}
      >
        <EllipsisVertical className="size-[18px]" strokeWidth={2.25} aria-hidden />
      </button>
      {open ? (
        <div className="absolute top-full right-0 z-20 mt-1 w-36 overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white shadow-sm">
          <button
            type="button"
            disabled={busy}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-neutral-900 hover:bg-neutral-50 disabled:cursor-wait disabled:opacity-60"
            onClick={() => {
              setOpen(false);
              onDownload();
            }}
          >
            {busy ? (
              <LoaderCircle className="size-[18px] animate-spin" strokeWidth={2.25} aria-hidden />
            ) : (
              <Download className="size-[18px]" strokeWidth={2.25} aria-hidden />
            )}
            Download
          </button>
        </div>
      ) : null}
    </div>
  );
}

const PLAYBACK_RATES = [1, 1.5, 2];

export function VoiceRecordingList({
  recordings,
  selectedId = null,
  onSelect,
  onCloseDetails,
  detailsHost = null,
}: {
  recordings: VoiceRecording[];
  selectedId?: string | null;
  onSelect?: (recording: VoiceRecording) => void;
  onCloseDetails?: () => void;
  detailsHost?: HTMLElement | null;
}) {
  const layout = useRecordingLayout();
  const tableLayout = layout === "table";
  const studioLayout = layout === "studio";
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelsRef = useRef(idleWaveformLevels());
  const blobUrlRef = useRef(new Map<string, string>());
  const requestRef = useRef<string | null>(null);
  const [levels, setLevels] = useState(idleWaveformLevels);
  const [analyserReady, setAnalyserReady] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const loadedIdRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [mediaDurationMs, setMediaDurationMs] = useState(0);
  const mediaDurationRef = useRef(0);
  const loadedUrlRef = useRef<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);

  function readPlayback(audio: HTMLAudioElement) {
    const elapsed = audio.currentTime * 1000;
    const fileDuration =
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0;
    if (fileDuration > 0) {
      mediaDurationRef.current = fileDuration;
      setMediaDurationMs(fileDuration);
    }
    setElapsedMs(elapsed);
    const total = fileDuration || mediaDurationRef.current;
    if (total > 0) setProgress(Math.min(1, elapsed / total));
  }

  function ensureAnalyser() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!analyserRef.current) {
      const context = new AudioContext();
      const source = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(context.destination);
      audioContextRef.current = context;
      analyserRef.current = analyser;
    }
    setAnalyserReady(true);
  }

  useEffect(() => {
    if (!playingId || !analyserReady) {
      if (!playingId) {
        levelsRef.current = idleWaveformLevels();
        setLevels(levelsRef.current);
      }
      return;
    }
    const analyser = analyserRef.current;
    if (!analyser) return;
    void audioContextRef.current?.resume();
    const samples = new Uint8Array(analyser.fftSize);
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      levelsRef.current = smoothWaveformLevels(
        levelsRef.current,
        levelsFromTimeDomain(samples),
      );
      setLevels([...levelsRef.current]);
    }, 70);
    return () => window.clearInterval(timer);
  }, [playingId, analyserReady]);

  useEffect(() => {
    const urls = blobUrlRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => readPlayback(audio);
    const onEnded = () => {
      setPlayingId(null);
      loadedIdRef.current = null;
      setLoadedId(null);
      pendingSeekRef.current = null;
      setProgress(0);
      setElapsedMs(0);
      setMediaDurationMs(0);
      mediaDurationRef.current = 0;
      loadedUrlRef.current = null;
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onTime);
    audio.addEventListener("durationchange", onTime);
    audio.addEventListener("playing", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onTime);
      audio.removeEventListener("durationchange", onTime);
      audio.removeEventListener("playing", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  useEffect(() => {
    if (!playingId) return;
    const audio = audioRef.current;
    if (!audio) return;
    let frame = 0;
    const tick = () => {
      readPlayback(audio);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playingId]);

  async function toggle(row: VoiceRecording) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === row.id) {
      requestRef.current = null;
      audio.pause();
      setPlayingId(null);
      return;
    }
    requestRef.current = row.id;
    audio.pause();
    const alreadyLoaded = loadedIdRef.current === row.id && Boolean(loadedUrlRef.current);
    if (!alreadyLoaded) {
      pendingSeekRef.current = null;
      setProgress(0);
      setElapsedMs(0);
      setMediaDurationMs(0);
      mediaDurationRef.current = 0;
      setLoadedId(row.id);
      setPlayingId(row.id);
      let src = row.recordingUrl;
      try {
        src = await playbackUrl(row, blobUrlRef.current);
      } catch {
        src = row.recordingUrl;
      }
      if (requestRef.current !== row.id) return;
      loadedIdRef.current = row.id;
      loadedUrlRef.current = src;
      try {
        if (src.startsWith("blob:")) ensureAnalyser();
        await loadRecording(audio, src);
        if (audioContextRef.current?.state === "suspended") {
          await audioContextRef.current.resume();
        }
      } catch {
        if (requestRef.current === row.id) setPlayingId(null);
        return;
      }
    } else {
      setPlayingId(row.id);
    }
    if (requestRef.current !== row.id) return;
    try {
      audio.playbackRate = playbackRate;
      await audio.play();
    } catch {
      if (requestRef.current === row.id) setPlayingId(null);
      return;
    }
    if (requestRef.current === row.id) readPlayback(audio);
  }

  async function download(row: VoiceRecording) {
    if (downloadingId) return;
    setDownloadingId(row.id);
    try {
      await downloadRecording(row);
    } finally {
      setDownloadingId((current) => (current === row.id ? null : current));
    }
  }

  function seek(row: VoiceRecording, ratio: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Math.min(1, Math.max(0, ratio));
    const place = (ratioToApply: number) => {
      const duration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : row.recordingDurationMs / 1000;
      if (!duration) return;
      const time = ratioToApply * duration;
      try {
        audio.currentTime = time;
      } catch {
        return;
      }
      setProgress(time / duration);
      setElapsedMs(time * 1000);
    };
    if (loadedIdRef.current === row.id && audio.readyState >= 1) {
      pendingSeekRef.current = next;
      place(next);
      return;
    }
    pendingSeekRef.current = next;
    setProgress(next);
    setElapsedMs(next * row.recordingDurationMs);
    if (loadedIdRef.current === row.id) return;
    loadedIdRef.current = row.id;
    loadedUrlRef.current = row.recordingUrl;
    setLoadedId(row.id);
    requestRef.current = null;
    audio.pause();
    setPlayingId(null);
    audio.removeAttribute("crossorigin");
    audio.src = row.recordingUrl;
    const onReady = () => {
      place(pendingSeekRef.current ?? next);
      audio.removeEventListener("loadedmetadata", onReady);
    };
    audio.addEventListener("loadedmetadata", onReady);
    audio.load();
  }

  function cycleRate() {
    const index = PLAYBACK_RATES.indexOf(playbackRate);
    const next = PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1;
    setPlaybackRate(next);
    const audio = audioRef.current;
    if (audio) audio.playbackRate = next;
  }

  const selected = recordings.find((row) => row.id === selectedId) ?? null;
  const selectedPlaying = selected != null && playingId === selected.id;
  const selectedActive = selected != null && loadedId === selected.id;

  return (
    <>
      <audio
        ref={audioRef}
        preload="metadata"
        className="pointer-events-none absolute h-px w-px opacity-0"
      />
      {studioLayout && selected && detailsHost
        ? createPortal(
            <RecordingDetailsPanel
              recording={selected}
              playing={selectedPlaying}
              onClose={() => onCloseDetails?.()}
              onToggle={() => void toggle(selected)}
              player={
                <RecordingPlayer
                  levels={selectedPlaying ? levels : idleWaveformLevels()}
                  live={selectedPlaying}
                  speaking={selectedPlaying && isCustomerSpeaking(levels)}
                  progress={selectedActive ? progress : 0}
                  elapsedMs={selectedActive ? elapsedMs : 0}
                  durationMs={
                    selectedActive && mediaDurationMs > 0 ? mediaDurationMs : selected.recordingDurationMs
                  }
                  startedAt={startedParts(selected.startedAt).label}
                  showDate={false}
                  trailing={
                    <button
                      type="button"
                      onClick={cycleRate}
                      className="shrink-0 cursor-pointer text-xs font-medium text-neutral-600 hover:text-neutral-900"
                    >
                      {playbackRate}x
                    </button>
                  }
                  onSeek={(ratio) => seek(selected, ratio)}
                />
              }
            />,
            detailsHost,
          )
        : null}
      {studioLayout ? (
        <div className={cn(STUDIO_GRID, "sticky top-0 z-20 -mx-5 border-b-[0.6px] border-[#e5e5e5] bg-white px-5 py-2 text-xs font-medium text-neutral-600")}>
          <span>Customer</span>
          <span>Direction</span>
          <span>Agent</span>
          <span>Recording</span>
          <span className="sr-only">Play</span>
        </div>
      ) : null}
      <ul className={studioLayout ? "pb-24" : undefined}>
        {recordings.map((row) => {
          const inbound = row.direction === "inbound";
          const agent = row.agentName ?? (row.agentExt ? `Ext ${row.agentExt}` : null);
          const playing = playingId === row.id;
          const active = loadedId === row.id;
          const started = startedParts(row.startedAt);
          const customer = customerDisplay(row);
          const player = (
            <RecordingPlayer
              levels={playing ? levels : idleWaveformLevels()}
              live={playing}
              speaking={playing && isCustomerSpeaking(levels)}
              progress={active ? progress : 0}
              elapsedMs={active ? elapsedMs : 0}
              durationMs={active && mediaDurationMs > 0 ? mediaDurationMs : row.recordingDurationMs}
              startedAt={started.label}
              showDate={!tableLayout && !studioLayout}
              onSeek={(ratio) => seek(row, ratio)}
            />
          );
          const actions = (
            <>
              <button
                type="button"
                onClick={() => toggle(row)}
                aria-label={playing ? "Pause recording" : "Play recording"}
                title={playing ? "Pause" : "Play"}
                className="flex size-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-neutral-900 text-white transition hover:bg-neutral-800 active:scale-95"
              >
                {playing ? (
                  <Pause className="size-4 fill-current" strokeWidth={0} aria-hidden />
                ) : (
                  <Play className="ml-0.5 size-4 fill-current" strokeWidth={0} aria-hidden />
                )}
              </button>
              <button
                type="button"
                aria-label="Download recording"
                title="Download"
                disabled={downloadingId === row.id}
                onClick={() => void download(row)}
                className="flex size-[38px] cursor-pointer items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-wait disabled:opacity-60"
              >
                {downloadingId === row.id ? (
                  <LoaderCircle className="size-[18px] animate-spin" strokeWidth={2.25} aria-hidden />
                ) : (
                  <Download className="size-[18px]" strokeWidth={2.25} aria-hidden />
                )}
              </button>
            </>
          );
          return (
            <li
              key={row.id}
              className={listRowDividerClassName("4")}
            >
              {studioLayout ? (
                <div
                  onClick={() => onSelect?.(row)}
                  className={cn(STUDIO_GRID, "cursor-pointer py-3 text-left", selectedId === row.id && "bg-neutral-50")}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <RecordingCustomerAvatar name={customer.name} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900">{customer.name}</p>
                      {customer.number ? (
                        <p className="truncate text-xs text-neutral-500">{customer.number}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <RecordingDirectionPill inbound={inbound} />
                  </div>
                  <div className="flex min-w-0 items-center gap-3">
                    <RecordingCustomerAvatar name={agent || "Agent"} />
                    <p className="truncate text-sm text-neutral-900">{agent ?? "—"}</p>
                  </div>
                  <RecordingPlaybackCard
                    playing={playing}
                    onToggle={() => {
                      onSelect?.(row);
                      void toggle(row);
                    }}
                    player={
                      <RecordingPlayer
                        levels={playing ? levels : idleWaveformLevels()}
                        live={playing}
                        speaking={playing && isCustomerSpeaking(levels)}
                        progress={active ? progress : 0}
                        elapsedMs={active ? elapsedMs : 0}
                        durationMs={active && mediaDurationMs > 0 ? mediaDurationMs : row.recordingDurationMs}
                        startedAt={started.label}
                        showDate={false}
                        trailing={
                          <button
                            type="button"
                            onClick={cycleRate}
                            className="shrink-0 cursor-pointer text-xs font-medium text-neutral-600 hover:text-neutral-900"
                          >
                            {playbackRate}x
                          </button>
                        }
                        onSeek={(ratio) => {
                          onSelect?.(row);
                          seek(row, ratio);
                        }}
                      />
                    }
                  />
                  <RecordingRowMenu busy={downloadingId === row.id} onDownload={() => void download(row)} />
                </div>
              ) : tableLayout ? (
                <div className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(10rem,1.1fr)_auto] items-center gap-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <RecordingCustomerAvatar name={customer.name} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900">{customer.name}</p>
                      {customer.number ? (
                        <p className="truncate text-xs text-neutral-500">{customer.number}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <RecordingDirectionPill inbound={inbound} />
                  </div>
                  <RecordingFact
                    icon={<Headphones className="size-[18px]" strokeWidth={2.25} aria-hidden />}
                    primary={row.queueName ?? "—"}
                  />
                  <RecordingFact
                    icon={<UserRound className="size-[18px]" strokeWidth={2.25} aria-hidden />}
                    primary={agent ?? "—"}
                  />
                  <RecordingFact
                    icon={<Clock3 className="size-[18px]" strokeWidth={2.25} aria-hidden />}
                    primary={started.date || "—"}
                    secondary={started.time || undefined}
                  />
                  <div className="min-w-0">{player}</div>
                  <div className="flex shrink-0 items-center gap-1">{actions}</div>
                </div>
              ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-4 px-3 py-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <RecordingCustomerAvatar name={customer.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-5 text-neutral-900">
                      {customer.name}
                    </p>
                    {customer.number ? (
                      <p className="truncate text-xs leading-5 text-neutral-500">{customer.number}</p>
                    ) : null}
                    {agent ? (
                      <p className="mt-0.5 truncate text-sm leading-5 text-neutral-600">
                        Handled by {agent}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <RecordingDirectionPill inbound={inbound} />
                      {row.queueName ? (
                        <span className="inline-flex h-6 items-center rounded-full bg-neutral-100 px-2 text-xs font-medium text-neutral-600">
                          {row.queueName}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex min-w-[16rem] flex-1 items-center gap-3 sm:max-w-md sm:flex-none">
                  <div className="min-w-0 flex-1">
                    {player}
                  </div>
                  {actions}
                </div>
              </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
