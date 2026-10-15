/** Live Users widget poll — keep faster than dashboard aggregates (VITE_DASHBOARD_REFRESH_MS). */
export const LIVE_USERS_REFRESH_MS =
  Number(import.meta.env.VITE_LIVE_USERS_REFRESH_MS) || 5000;
