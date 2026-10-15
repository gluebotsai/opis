const DEFAULT_SLOW_MS = 300;

function readLocalFlag() {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }
  try {
    return window.localStorage.getItem("PERF_LOG") === "1";
  } catch {
    return false;
  }
}

/** DevTools timing logs when Vite DEV or localStorage.PERF_LOG=1. */
export function isClientPerfLogEnabled() {
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    return true;
  }
  return readLocalFlag();
}

export function getClientPerfSlowMs() {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_SLOW_MS;
  }
  try {
    const raw = window.localStorage.getItem("PERF_LOG_SLOW_MS");
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLOW_MS;
  } catch {
    return DEFAULT_SLOW_MS;
  }
}

function formatPairs(details = {}) {
  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

/**
 * Log a timed step to the browser console.
 * @param {{ channel?: string, action: string, ok: boolean, durationMs: number, error?: unknown, [key: string]: unknown }} input
 */
export function logTimedClient(input) {
  if (!isClientPerfLogEnabled()) {
    return;
  }

  const {
    channel = "http",
    action,
    ok,
    durationMs,
    error,
    ...rest
  } = input;

  const duration = Math.max(0, Math.round(Number(durationMs) || 0));
  const slowMs = getClientPerfSlowMs();
  let status = ok ? "OK" : "FAIL";
  if (ok && duration >= slowMs) {
    status = "SLOW";
  }

  const errorMessage =
    error instanceof Error ? error.message : error ? String(error) : rest.error;

  const pairs = formatPairs({
    ...rest,
    ...(errorMessage ? { error: errorMessage } : {}),
  });
  const line = `[${channel}] ${status.padEnd(4)} ${action}  ${duration}ms${pairs ? `  ${pairs}` : ""}`;

  if (!ok) {
    console.error(line);
  } else if (status === "SLOW") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Time an async UI / fetch step for DevTools.
 */
export async function withClientTiming(channel, action, fn, details = {}) {
  const started = performance.now();
  try {
    const result = await fn();
    logTimedClient({
      channel,
      action,
      ok: true,
      durationMs: performance.now() - started,
      ...details,
    });
    return result;
  } catch (error) {
    logTimedClient({
      channel,
      action,
      ok: false,
      durationMs: performance.now() - started,
      error,
      ...details,
    });
    throw error;
  }
}
