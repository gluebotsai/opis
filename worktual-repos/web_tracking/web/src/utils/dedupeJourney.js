const JOURNEY_REPEAT_WINDOW_MS = 2 * 60 * 1000;

function journeyTimestamp(step) {
  if (!step?.created_at) return 0;
  const ms = new Date(step.created_at).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function preferTitle(current, candidate) {
  const currentTitle = (current.page_title ?? '').trim();
  const candidateTitle = (candidate.page_title ?? '').trim();
  if (candidateTitle.length > currentTitle.length) {
    return { ...current, page_title: candidateTitle };
  }
  return current;
}

/** Collapse duplicate journey steps (same path within 2 minutes). */
export function dedupeJourneySteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return [];

  const sorted = [...steps].sort(
    (a, b) => journeyTimestamp(a) - journeyTimestamp(b),
  );

  const out = [];
  for (const step of sorted) {
    const path = step.page_path || '';
    const prev = out[out.length - 1];
    if (prev && (prev.page_path || '') === path) {
      const delta = journeyTimestamp(step) - journeyTimestamp(prev);
      if (delta >= 0 && delta < JOURNEY_REPEAT_WINDOW_MS) {
        out[out.length - 1] = preferTitle(prev, step);
        continue;
      }
    }
    out.push({ ...step });
  }

  return out;
}
