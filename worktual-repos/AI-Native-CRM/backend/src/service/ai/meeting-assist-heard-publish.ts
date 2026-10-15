import type { LiveAssistLatencyTrace } from "@/lib/meeting-assist-latency";
import { publishLiveHeardPreview } from "@/service/ai/meeting-assist";

type HeardKey = string;

const firstHeardAt = new Map<HeardKey, string>();
const lastPublished = new Map<
  string,
  {
    text: string;
    segmentId: string | null;
    detail: string;
    speaker: string | null;
    publishedAt: number;
  }
>();

function heardKey(sessionId: string, segmentId: string | null | undefined): HeardKey {
  const seg = (segmentId || "").trim();
  return seg ? `${sessionId}:${seg}` : `${sessionId}:text`;
}

/** First wall-clock time this segment line hit the panel (stable across sync-live polls). */
export function stableHeardAtForSegment(
  sessionId: string,
  segmentId: string | null | undefined,
): string {
  const key = heardKey(sessionId, segmentId);
  let at = firstHeardAt.get(key);
  if (!at) {
    at = new Date().toISOString();
    firstHeardAt.set(key, at);
  }
  return at;
}

export function publishHeardIfChanged(input: {
  sessionId: string;
  speaker: string | null;
  text: string;
  speakerKey?: string | null;
  attendeeRole?: string | null;
  segmentId?: string | null;
  /**
   * Whether this is a *final* segment (vs. a still-forming Whisper draft).
   * Whisper re-decodes the whole rolling audio buffer on every draft tick
   * (~600ms), so consecutive drafts of the *same* utterance can shrink,
   * reword, or otherwise regress rather than only ever extending — which
   * looked like the "Heard" line flickering/jumping around. Defaults to
   * `true` (existing call sites that don't pass it are treated as
   * final/stable, preserving prior behavior); only the raw live-caption
   * draft path passes `false`.
   */
  completed?: boolean;
  latency?: LiveAssistLatencyTrace | null;
  latencyDetail?: string | null;
}): void {
  const sessionId = input.sessionId.trim();
  const text = input.text.trim();
  if (!sessionId || !text) return;

  const segmentId = input.segmentId?.trim() || null;
  const detail = input.latencyDetail?.trim() || "";
  const speaker = input.speaker?.trim() || null;
  const completed = input.completed !== false;
  const prev = lastPublished.get(sessionId);
  const now = Date.now();
  // Vexa can emit the same physical utterance on two transport channels a
  // few milliseconds apart. Do not render two fallback prompts for that one
  // utterance. This is display dedupe only; it never assigns identity.
  if (
    prev &&
    prev.text === text &&
    prev.speaker === speaker &&
    now - prev.publishedAt <= 1_500
  ) {
    return;
  }
  if (
    prev &&
    prev.text === text &&
    prev.segmentId === segmentId &&
    prev.detail === detail
  ) {
    return;
  }

  // Same speaker's utterance still forming: only let it replace the Heard
  // line if it moved forward (grew, or extends what was already shown).
  // Otherwise wait for the next draft/final instead of visibly regressing.
  if (!completed && prev && prev.speaker === speaker) {
    const grew = text.length >= prev.text.length;
    const prevHead = prev.text.toLowerCase().slice(0, Math.min(12, prev.text.length));
    const extendsPrev = prevHead.length > 0 && text.toLowerCase().startsWith(prevHead);
    if (!grew && !extendsPrev) return;
  }

  lastPublished.set(sessionId, {
    text,
    segmentId,
    detail,
    speaker,
    publishedAt: now,
  });
  publishLiveHeardPreview(
    sessionId,
    input.speaker,
    text,
    input.latency ?? undefined,
    {
      speakerKey: input.speakerKey,
      attendeeRole: input.attendeeRole,
      completed: input.completed !== false,
    },
  );
}

export function clearHeardPublishState(sessionId: string): void {
  const sid = sessionId.trim();
  lastPublished.delete(sid);
  for (const key of [...firstHeardAt.keys()]) {
    if (key.startsWith(`${sid}:`)) firstHeardAt.delete(key);
  }
}
