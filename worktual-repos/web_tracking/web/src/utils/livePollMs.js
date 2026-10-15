/** Poll interval when /api/analytics/live uses Redis (presence_source=redis). SSE is primary; poll is backup. */
export const LIVE_POLL_MS_REDIS =
  Number(import.meta.env.VITE_LIVE_USERS_REFRESH_MS) || 1_000;

/** Poll interval when live falls back to ClickHouse (no Redis / presence_source=clickhouse). */
export const LIVE_POLL_MS_FALLBACK =
  Number(import.meta.env.VITE_LIVE_USERS_REFRESH_MS_FALLBACK)
  || Number(import.meta.env.VITE_LIVE_USERS_REFRESH_MS)
  || 3_000;

export function livePollMsForPresenceSource(presenceSource) {
  return presenceSource === 'redis' ? LIVE_POLL_MS_REDIS : LIVE_POLL_MS_FALLBACK;
}
