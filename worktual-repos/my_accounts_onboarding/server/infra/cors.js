import { env, getAppUrl, isProduction } from "./env.js";

function normalizeOrigin(origin) {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return origin.replace(/\/$/, "");
  }
}

function isLocalOrPrivateHost(hostname) {
  if (!hostname) {
    return false;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return true;
  }

  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }

  return false;
}

function getConfiguredOrigins() {
  const origins = new Set([
    normalizeOrigin(getAppUrl()),
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);

  const extras = env("CORS_ALLOWED_ORIGINS");
  if (extras) {
    for (const entry of extras.split(",")) {
      const trimmed = entry.trim();
      if (trimmed) {
        origins.add(normalizeOrigin(trimmed));
      }
    }
  }

  return origins;
}

export function isAllowedCorsOrigin(origin) {
  if (!origin) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (getConfiguredOrigins().has(normalized)) {
    return true;
  }

  if (!isProduction()) {
    try {
      const { hostname } = new URL(origin);
      if (isLocalOrPrivateHost(hostname)) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

export function createCorsOriginValidator() {
  return (origin, callback) => {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, true);
      return;
    }

    console.warn(`[cors] Blocked origin: ${origin}`);
    callback(null, false);
  };
}
