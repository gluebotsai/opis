import { Download, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { downloadInternalChatAttachment } from "@/features/internal-chat/api";
import { useAuthenticatedMediaUrl } from "@/features/internal-chat/use-authenticated-media-url";
import { formatVoiceDuration } from "@/features/internal-chat/use-voice-recorder";
import { cn } from "@/lib/utils";

const WAVEFORM_BAR_COUNT = 32;

type InternalChatVoiceMessageProps = {
  audioUrl: string;
  durationMs: number;
  isOutgoing: boolean;
  sentAt?: string;
};

function buildWaveformHeights(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index * 0.55) * 0.35 + Math.cos(index * 0.31) * 0.25;
    return 34 + Math.round(Math.abs(wave) * 58 + (index % 5) * 4);
  });
}

export function InternalChatVoiceMessage({
  audioUrl,
  durationMs,
  isOutgoing,
  sentAt,
}: InternalChatVoiceMessageProps) {
  const resolvedAudioUrl = useAuthenticatedMediaUrl(audioUrl);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [downloading, setDownloading] = useState(false);

  const waveformHeights = useMemo(() => buildWaveformHeights(WAVEFORM_BAR_COUNT), []);

  useEffect(() => {
    if (!resolvedAudioUrl) return;
    const audio = new Audio(resolvedAudioUrl);
    audio.preload = "metadata";
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      if (!audio.duration || Number.isNaN(audio.duration)) return;
      setProgress(audio.currentTime / audio.duration);
      setCurrentMs(audio.currentTime * 1000);
    };
    const handleEnded = () => {
      setPlaying(false);
      setProgress(0);
      setCurrentMs(0);
      audio.currentTime = 0;
    };
    const handlePause = () => setPlaying(false);
    const handlePlay = () => setPlaying(true);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("play", handlePlay);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("play", handlePlay);
      audioRef.current = null;
    };
  }, [resolvedAudioUrl]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch {
      // Playback may be blocked until the user interacts with the page.
    }
  }

  const timeLabel = playing ? formatVoiceDuration(currentMs) : formatVoiceDuration(durationMs);

  async function handleDownload() {
    if (downloading || !audioUrl) return;
    setDownloading(true);
    try {
      await downloadInternalChatAttachment({
        name: "voice-message.webm",
        previewUrl: audioUrl,
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="relative w-[min(100%,15.5rem)] min-w-[12.5rem]">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => void togglePlayback()}
          aria-label={playing ? "Pause voice message" : "Play voice message"}
          title={playing ? "Pause" : "Play"}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 transition active:scale-95",
            isOutgoing
              ? "bg-white text-neutral-800 ring-black/5 hover:bg-neutral-50"
              : "bg-white text-neutral-800 ring-neutral-200/80 hover:bg-neutral-50",
          )}
        >
          {playing ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="ml-0.5 size-3.5 fill-current" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="relative flex h-7 items-center">
            <div className="flex h-full w-full items-center gap-[2px]">
              {waveformHeights.map((height, index) => {
                const barProgress = (index + 0.5) / WAVEFORM_BAR_COUNT;
                const filled = barProgress <= progress;
                return (
                  <span
                    key={index}
                    className={cn(
                      "w-[3px] shrink-0 rounded-full transition-colors duration-150",
                      filled
                        ? isOutgoing
                          ? "bg-neutral-700"
                          : "bg-neutral-600"
                        : isOutgoing
                          ? "bg-neutral-400/55"
                          : "bg-neutral-300/90",
                    )}
                    style={{ height: `${height}%` }}
                  />
                );
              })}
            </div>

            {playing ? (
              <span
                className={cn(
                  "pointer-events-none absolute top-1/2 size-2 -translate-y-1/2 rounded-full shadow-sm ring-2 ring-white/80",
                  isOutgoing ? "bg-neutral-700" : "bg-neutral-600",
                )}
                style={{ left: `calc(${Math.min(progress, 1) * 100}% - 4px)` }}
              />
            ) : null}
          </div>

          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium tabular-nums text-neutral-600">{timeLabel}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleDownload()}
                disabled={downloading}
                aria-label="Download voice message"
                title="Download"
                className="flex size-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50"
              >
                <Download className="size-3.5" />
              </button>
              {sentAt ? (
                <span className="text-[10px] tabular-nums text-neutral-400">{sentAt}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
