/** Local demo + HTTPS tunnel hosts allowed in development for public web push. */

import { isDevLanWebPushOrigin } from "./dev-lan-origins.js";

const LOCAL_WEB_PUSH_DEMO_ORIGINS = new Set([
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://localhost:5500",
  "https://127.0.0.1:5500",
]);

/** ngrok, Cloudflare Tunnel, localtunnel — publicly trusted HTTPS for testers. */
const DEV_TUNNEL_ORIGIN_PATTERNS = [
  /^https:\/\/[\w-]+\.ngrok-free\.app$/,
  /^https:\/\/[\w-]+\.ngrok-free\.dev$/,
  /^https:\/\/[\w-]+\.ngrok\.io$/,
  /^https:\/\/[\w-]+\.ngrok\.app$/,
  /^https:\/\/[\w-]+\.trycloudflare\.com$/,
  /^https:\/\/[\w-]+\.loca\.lt$/,
];

export function isDevWebPushDemoOrigin(origin: string): boolean {
  const o = origin.trim().toLowerCase();
  if (LOCAL_WEB_PUSH_DEMO_ORIGINS.has(o)) return true;
  if (isDevLanWebPushOrigin(origin)) return true;
  return DEV_TUNNEL_ORIGIN_PATTERNS.some((re) => re.test(o));
}
