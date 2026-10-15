import fs from "node:fs";
import path from "node:path";

import { logsRoot } from "../config/runtime-paths.js";
import { formatPaymentMessage } from "../modules/payments/logContext.js";

const LOG_DIR = process.env.APP_LOG_DIR || logsRoot;

function envFlag(name: any, defaultValue: any = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  return !["0", "false", "off", "no"].includes(String(raw).trim().toLowerCase());
}

function isDevelopment() {
  const nodeEnv = process.env.NODE_ENV;
  return !nodeEnv || nodeEnv === "development" || nodeEnv === "test";
}

/** Master switch — on by default in development. */
export function isPerfLogEnabled() {
  return envFlag("PERF_LOG", isDevelopment());
}

export function getPerfSlowMs() {
  const parsed = Number(process.env.PERF_LOG_SLOW_MS || 300);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

export function isPerfHttpEnabled() {
  return isPerfLogEnabled() && envFlag("PERF_LOG_HTTP", true);
}

export function isPerfMailEnabled() {
  return isPerfLogEnabled() && envFlag("PERF_LOG_MAIL", true);
}

export function isPerfClientHintEnabled() {
  return isPerfLogEnabled() && envFlag("PERF_LOG_CLIENT", true);
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logFilePath(channel: any) {
  return path.join(LOG_DIR, `${channel}.log`);
}

function writeLogLine(channel: any, entry: any) {
  try {
    ensureLogDir();
    const line = `${JSON.stringify({
      ts: new Date().toISOString(),
      channel,
      ...entry,
    })}\n`;
    fs.appendFileSync(logFilePath(channel), line, "utf8");
  } catch (error) {
    console.error(
      `[logger] Could not write ${channel} log:`,
      error instanceof Error ? error.message : error,
    );
  }
}

const SECRET_KEY_PATTERN =
  /pass(word)?|secret|token|authorization|cookie|pdfBase64|contentBase64|api[_-]?key/i;

function sanitizeDetails(details: any = {}) {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (typeof value === "string" && value.length > 500) {
      out[key] = `${value.slice(0, 200)}…`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function formatDetailPairs(details: any = {}) {
  return Object.entries(details)
    .filter(([key]: any) => key !== "stack" && key !== "error")
    .map(([key, value]: any) => {
      if (value === null || value === undefined) {
        return `${key}=`;
      }
      if (typeof value === "object") {
        try {
          return `${key}=${JSON.stringify(value)}`;
        } catch {
          return `${key}=[object]`;
        }
      }
      return `${key}=${value}`;
    })
    .join(" ");
}

/**
 * Structured timing log → console + logs/<channel>.log
 * @param {{ channel?: string, action: string, ok: boolean, durationMs: number, error?: unknown, [key: string]: unknown }} input
 */
export function logTimed(input: any) {
  const {
    channel = "perf",
    action,
    ok,
    durationMs,
    error,
    ...rest
  } = input;

  if (!isPerfLogEnabled()) {
    return;
  }

  // HTTP middleware checks isPerfHttpEnabled before calling; mail uses channel "mail".
  if (channel === "http" && !isPerfHttpEnabled()) {
    return;
  }
  if (channel === "mail" && !isPerfMailEnabled()) {
    return;
  }

  const slowMs = getPerfSlowMs();
  const duration = Math.max(0, Math.round(Number(durationMs) || 0));
  const errorMessage =
    error instanceof Error ? error.message : error ? String(error) : rest.message || undefined;

  let status = ok ? "OK" : "FAIL";
  if (ok && duration >= slowMs) {
    status = "SLOW";
  }

  const details = sanitizeDetails({
    ...rest,
    ...(errorMessage ? { error: errorMessage } : {}),
  });

  writeLogLine(channel, {
    action,
    status,
    ok: Boolean(ok),
    durationMs: duration,
    ...details,
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  });

  const pairs = formatDetailPairs(details);
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
 * Time an async (or sync) function and log OK/FAIL + duration.
 * For the perf channel (or when PERF_TRACE=1), logs a start line so hangs show the in-flight stage.
 */
export async function withTiming(channel: any, action: any, fn: any, details: any = {}) {
  const traceStart =
    channel === "perf" || String(process.env.PERF_TRACE || "").trim() === "1";
  if (traceStart) {
    const pairs = formatDetailPairs(sanitizeDetails(details));
    console.log(`[${channel}] START ${action}${pairs ? `  ${pairs}` : ""}`);
  }

  const started = performance.now();
  try {
    const result = await fn();
    logTimed({
      channel,
      action,
      ok: true,
      durationMs: performance.now() - started,
      ...details,
    });
    return result;
  } catch (error) {
    logTimed({
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

export function logPayment(action: any, details: any = {}) {
  const sanitized = sanitizeDetails(details);
  // Build console sentence from fields; do not treat errorMessage as the whole line.
  const { message: explicitMessage, ...forFormat } = sanitized;
  const message =
    typeof explicitMessage === "string" && explicitMessage.trim()
      ? explicitMessage.trim()
      : formatPaymentMessage(action, forFormat);
  const entry = { action, ...sanitized, message };
  writeLogLine("payments", entry);
  const line = `[payments] ${message}`;
  if (sanitized.level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function logPaymentError(action: any, error: any, details: any = {}) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const { message: explicitMessage, ...rest } = details;
  logPayment(action, {
    ...rest,
    level: "error",
    errorMessage,
    ...(typeof explicitMessage === "string" && explicitMessage.trim()
      ? { message: explicitMessage.trim() }
      : {}),
    stack: error instanceof Error ? error.stack : undefined,
  });
}
