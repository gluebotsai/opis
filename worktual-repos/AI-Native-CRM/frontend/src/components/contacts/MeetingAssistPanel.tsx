import { useEffect, useState, useTransition } from "react";
import { Headphones } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import {
  fetchMeetingAssistForActivity,
  type MeetingAssistChunk,
} from "@/services/meetingAssist";
import { meetingCapturePollMaxAttempts } from "@/lib/meeting-capture-poll";

type ConversationLine = {
  id: string;
  speaker: string | null;
  text: string;
};

function linesFromTranscriptText(raw: string): ConversationLine[] {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = line.match(/^([^:]{1,80}):\s*(.+)$/);
      if (m) {
        return {
          id: `t-${i}`,
          speaker: m[1].trim(),
          text: m[2].trim(),
        };
      }
      return { id: `t-${i}`, speaker: null, text: line };
    });
}

function linesFromChunks(chunks: MeetingAssistChunk[]): ConversationLine[] {
  return chunks
    .filter((c) => c.text?.trim())
    .map((c) => ({
      id: c.id,
      speaker: c.speaker,
      text: c.text.trim(),
    }));
}

/**
 * Contact meeting activity: History shows the conversation only
 * (saved transcript or live capture chunks).
 */
export function MeetingAssistPanel({
  activityId,
  dueAt = null,
}: {
  activityId: string;
  contactId: string;
  provider?: string | null;
  dueAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ConversationLine[]>([]);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [captureHint, setCaptureHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let attempts = 0;

    const load = async (showPending: boolean) => {
      if (showPending) {
        startTransition(() => {
          setError(null);
        });
      }
      try {
        const existing = await fetchMeetingAssistForActivity(activityId);
        if (cancelled) return true;
        const full = existing.activity?.transcriptText?.trim() || "";
        const captureStatus = existing.meta?.captureBot?.status || null;
        const stillCapturing =
          captureStatus === "scheduled" || captureStatus === "joined";
        if (full) {
          setLines(linesFromTranscriptText(full));
          setSourceLabel(
            existing.activity?.transcriptSource || "meeting transcript",
          );
          setCaptureHint(null);
          setError(null);
          return !stillCapturing;
        }
        const fromChunks = linesFromChunks(existing.chunks || []);
        setLines(fromChunks);
        setSourceLabel(fromChunks.length > 0 ? "live capture" : null);
        if (fromChunks.length > 0) {
          setCaptureHint(null);
          setError(null);
          return !stillCapturing;
        }
        if (captureStatus === "scheduled" || captureStatus === "joined") {
          setCaptureHint(
            captureStatus === "joined"
              ? "Capture is in the call. Conversation appears here when the host ends the meeting (not at calendar end time)."
              : "Capture bot is scheduled. Conversation appears after the host ends the meeting.",
          );
          setError(null);
          return false;
        }
        if (captureStatus === "failed" || captureStatus === "denied" || captureStatus === "missing") {
          setCaptureHint(null);
          setError(
            existing.meta?.captureBot?.error ||
              "No conversation saved for this meeting yet.",
          );
          return true;
        }
        setCaptureHint(null);
        setError(null);
        return false;
      } catch {
        if (!cancelled) {
          setLines([]);
          setSourceLabel(null);
          setCaptureHint(null);
          setError("No conversation saved for this meeting yet.");
        }
        return true;
      }
    };

    void load(true);
    const maxAttempts = meetingCapturePollMaxAttempts(dueAt);
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts > maxAttempts) {
        window.clearInterval(timer);
        return;
      }
      void load(false).then((done) => {
        if (done) window.clearInterval(timer);
      });
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, activityId, dueAt]);

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-8 text-xs"
          onClick={() => setOpen(true)}
          disabled={pending}
        >
          {pending ? (
            <Skeleton height={14} width={14} borderRadius={999} />
          ) : (
            <Headphones className="size-3.5" strokeWidth={1.75} />
          )}
          History
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border-default bg-subtle/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">Conversation</p>
          {sourceLabel ? (
            <p className="text-[11px] text-text-caption">{sourceLabel}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="tertiary"
          className="h-7 text-xs"
          onClick={() => setOpen(false)}
        >
          Hide
        </Button>
      </div>

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {captureHint && lines.length === 0 ? (
        <p className="text-xs text-text-caption">{captureHint}</p>
      ) : null}

      {pending && lines.length === 0 ? (
        <div className="space-y-2 rounded-md border border-border-default bg-surface p-3">
          <div className="flex items-center gap-2">
            <Skeleton height={14} width={14} borderRadius={999} />
            <SkeletonText width={120} height={12} />
          </div>
          <SkeletonText width="84%" height={12} />
          <SkeletonText width="62%" height={12} />
        </div>
      ) : lines.length > 0 ? (
        <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-border-default bg-surface p-3 text-sm">
          {lines.map((line) => (
            <p key={line.id} className="leading-snug text-text-secondary">
              {line.speaker ? (
                <span className="font-semibold text-text-primary">
                  {line.speaker}:{" "}
                </span>
              ) : null}
              {line.text}
            </p>
          ))}
        </div>
      ) : !error && !captureHint ? (
        <p className="text-xs text-text-caption">
          No conversation yet. After the meeting ends and capture finishes, the
          full transcript appears here.
        </p>
      ) : null}
    </div>
  );
}
