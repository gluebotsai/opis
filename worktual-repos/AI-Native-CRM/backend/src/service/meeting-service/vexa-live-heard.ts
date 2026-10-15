import type { MeetingServiceSegment } from "@/service/meeting-service/client";

/** Latest line for the Meet add-on Heard bubble (draft tail or last completed). */
export function latestSegmentForHeard(
  segments: MeetingServiceSegment[],
): {
  speaker: string | null;
  speakerKey?: string | null;
  speaker_key?: string | null;
  text: string;
  segmentId?: string | null;
  start?: number | null;
  end?: number | null;
} | null {
  let best: MeetingServiceSegment | null = null;
  for (const seg of segments) {
    const text = (seg.text || "").trim();
    if (!text) continue;
    if (!best) {
      best = seg;
      continue;
    }
    const forming = seg.completed === false;
    const bestForming = best.completed === false;
    if (forming && !bestForming) {
      best = seg;
      continue;
    }
    if (forming === bestForming) {
      const end = Number(seg.end ?? seg.start ?? 0);
      const bestEnd = Number(best.end ?? best.start ?? 0);
      if (end >= bestEnd) best = seg;
    }
  }
  if (!best) return null;
  return {
    speaker: best.speaker?.trim() || null,
    speakerKey: best.speakerKey?.trim() || null,
    speaker_key: best.speaker_key?.trim() || null,
    text: (best.text || "").trim(),
    segmentId: best.segment_id ?? null,
    start: best.start ?? null,
    end: best.end ?? null,
  };
}
