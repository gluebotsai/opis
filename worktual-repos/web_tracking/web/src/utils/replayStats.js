/** Height / width at or above this → portrait (mobile) recording layout in player. */
export const REPLAY_PORTRAIT_HEIGHT_WIDTH_RATIO = 1.15;

/** IncrementalSource values we treat as visible user activity during replay. */
const MOTION_SOURCES = new Set([1, 2, 3, 5, 6, 12, 14]); // mouseMove, mouseInteraction, scroll, input, touch, drag, selection

export function classifyRecordingLayout(viewportWidth, viewportHeight) {
  const w = Number(viewportWidth);
  const h = Number(viewportHeight);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'unknown';
  if (h / w >= REPLAY_PORTRAIT_HEIGHT_WIDTH_RATIO) return 'portrait';
  return 'landscape';
}

function incrementalSource(event) {
  if (event?.type !== 3) return null;
  const source = event?.data?.source;
  return Number.isFinite(Number(source)) ? Number(source) : null;
}

/** Summarize rrweb events — distinguish static snapshot vs motion replay. */
export function getReplayStats(events) {
  if (!events?.length) {
    return {
      durationMs: 0,
      activeDurationMs: 0,
      incrementals: 0,
      motionEvents: 0,
      snapshots: 0,
      isStaticOnly: true,
      recordingKind: 'empty',
      viewportWidth: 1280,
      viewportHeight: 720,
      recordingLayout: 'unknown',
      isPortraitRecording: false,
    };
  }

  let minTs = Infinity;
  let maxTs = -Infinity;
  let minMotionTs = Infinity;
  let maxMotionTs = -Infinity;
  let incrementals = 0;
  let motionEvents = 0;
  let snapshots = 0;
  let viewportWidth = 1280;
  let viewportHeight = 720;

  for (const event of events) {
    const ts = Number(event?.timestamp ?? 0);
    if (Number.isFinite(ts) && ts > 0) {
      minTs = Math.min(minTs, ts);
      maxTs = Math.max(maxTs, ts);
    }
    if (event?.type === 2) snapshots += 1;
    if (event?.type === 3) {
      incrementals += 1;
      const source = incrementalSource(event);
      if (source != null && MOTION_SOURCES.has(source)) {
        motionEvents += 1;
        if (Number.isFinite(ts) && ts > 0) {
          minMotionTs = Math.min(minMotionTs, ts);
          maxMotionTs = Math.max(maxMotionTs, ts);
        }
      }
    }
    if (event?.type === 4 && event?.data) {
      viewportWidth = Number(event.data.width) || viewportWidth;
      viewportHeight = Number(event.data.height) || viewportHeight;
    }
  }

  const durationMs = maxTs > minTs ? maxTs - minTs : 0;
  let activeDurationMs =
    maxMotionTs > minMotionTs ? maxMotionTs - minMotionTs : 0;
  if (motionEvents > 0 && activeDurationMs <= 0 && durationMs > 0) {
    activeDurationMs = durationMs;
  }

  let recordingKind = 'video';
  if (incrementals === 0 || snapshots === 0) {
    recordingKind = incrementals === 0 ? 'snapshot' : 'broken';
  } else if (motionEvents < 5 || activeDurationMs < 3000) {
    recordingKind = durationMs > 30_000 ? 'snapshot-idle' : 'snapshot-minimal';
  }

  const recordingLayout = classifyRecordingLayout(viewportWidth, viewportHeight);

  return {
    durationMs,
    activeDurationMs,
    incrementals,
    motionEvents,
    snapshots,
    isStaticOnly: incrementals === 0 || snapshots === 0,
    isPlayableVideo:
      snapshots > 0 &&
      incrementals > 0 &&
      (motionEvents >= 5 && activeDurationMs >= 3000 || durationMs >= 10_000),
    recordingKind,
    viewportWidth,
    viewportHeight,
    recordingLayout,
    isPortraitRecording: recordingLayout === 'portrait',
  };
}

export function formatReplayTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hr = Math.floor(totalMin / 60);
  if (hr > 0) {
    return `${hr}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${totalMin}:${String(sec).padStart(2, '0')}`;
}

export function replayKindLabel(kind) {
  switch (kind) {
    case 'video':
      return 'Video replay';
    case 'snapshot':
      return 'Static image only';
    case 'snapshot-idle':
      return 'Static image (long idle gap — not video)';
    case 'snapshot-minimal':
      return 'Static image (too few interactions)';
    case 'broken':
      return 'Incomplete recording';
    default:
      return 'Unknown';
  }
}

/** Replay detail page: enough rrweb data to mount the player (may still be low-motion). */
export function canOpenReplayPlayer(stats) {
  if (!stats) return false;
  return stats.snapshots > 0 && stats.incrementals > 0;
}

/** Session list row — only full motion replay (exclude image / preview / gaps). */
export function isVideoReplaySession(session) {
  if (!session) return false;
  return Boolean(
    session.playable &&
    session.recording_kind === 'video' &&
    !session.has_chunk_gaps,
  );
}
