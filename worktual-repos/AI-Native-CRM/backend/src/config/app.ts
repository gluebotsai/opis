/** App / API runtime config (structure aligned with channel-server layout). */
export const API_PORT = Number(process.env.API_PORT || 4000);
export const API_HOST = process.env.API_HOST || "0.0.0.0";
export const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "http://localhost:5173";
