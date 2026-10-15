/** Default CRM meeting slot length when body has no explicit end. */
const DEFAULT_MEETING_DURATION_MS = 30 * 60_000;

/** Keep polling capture status until expected end + buffer (min ~2 min). */
export function meetingCapturePollMaxAttempts(dueAt: string | null): number {
  const bufferMs = 20 * 60_000;
  const minAttempts = 30;
  if (!dueAt) return minAttempts;
  const endMs = new Date(dueAt).getTime() + DEFAULT_MEETING_DURATION_MS + bufferMs;
  const remainingMs = Math.max(endMs - Date.now(), 2 * 60_000);
  return Math.max(minAttempts, Math.ceil(remainingMs / 4000));
}
