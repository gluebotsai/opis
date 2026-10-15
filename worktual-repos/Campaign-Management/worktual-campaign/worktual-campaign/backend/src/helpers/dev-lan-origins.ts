/** Dev-only: allow Campaign SPA on any RFC1918 / loopback host (Vite on 0.0.0.0). */

const DEV_FE_PORT_PATTERN = ":(5173|4173)$";
const DEV_LAN_FE_ORIGIN = new RegExp(
  `^https?://(192\\.168\\.\\d{1,3}\\.\\d{1,3}|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|127\\.0\\.0\\.1|localhost)${DEV_FE_PORT_PATTERN}`,
);

const DEV_WEB_PUSH_PORT_PATTERN = ":5500$";
const DEV_LAN_WEB_PUSH_ORIGIN = new RegExp(
  `^https?://(192\\.168\\.\\d{1,3}\\.\\d{1,3}|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|127\\.0\\.0\\.1|localhost)${DEV_WEB_PUSH_PORT_PATTERN}`,
);

export function isDevLanFrontendOrigin(origin: string): boolean {
  return DEV_LAN_FE_ORIGIN.test(origin.trim());
}

export function isDevLanWebPushOrigin(origin: string): boolean {
  return DEV_LAN_WEB_PUSH_ORIGIN.test(origin.trim());
}
