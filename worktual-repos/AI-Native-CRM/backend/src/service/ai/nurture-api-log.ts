/**
 * Durable audit log for API traffic used by lead nurture.
 *
 * Files: backend/logs/nurture-api-YYYY-MM-DD.log
 * Each record starts with NURTURE EMAIL | VOICEBOT | COMPOSE so `tail -f`
 * can tell campaign email from cc-core voice bot.
 * Secrets are always redacted. Customer payloads are intentionally retained
 * because this log is used to diagnose the exact outbound nurture request.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";

const LOG_PREFIX = "nurture-api";
const DEFAULT_KEEP_DAYS = 5;
const MAX_STRING_LENGTH = 16_000;
const MAX_ARRAY_LENGTH = 100;
const MAX_DEPTH = 8;
const SECRET_KEY_PATTERN =
  /authorization|cookie|password|secret|token|(?:api|integration|service)[-_]?key|key$/i;

let lastPrunedDay: string | null = null;

/** Outbound email vs voice bot vs LLM compose (before send). */
export type NurtureKind = "email" | "voicebot" | "compose";

export type NurtureApiLogEvent = {
  nurtureKind: NurtureKind;
  service: "ai-service" | "cc-core" | "campaign" | "crm-bot";
  operation: string;
  method: string;
  url: string;
  request?: unknown;
  response?: unknown;
  status?: number | null;
  ok: boolean;
  durationMs?: number;
  organizationId?: string | null;
  contactId?: string | null;
  error?: string | null;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function logDirectory(): string {
  return (
    process.env.NURTURE_API_LOG_DIR?.trim() ||
    join(import.meta.dirname, "..", "..", "..", "logs")
  );
}

function retentionDays(): number {
  const parsed = Number.parseInt(
    process.env.AGENT_LOG_RETENTION_DAYS ?? "",
    10,
  );
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(30, parsed))
    : DEFAULT_KEEP_DAYS;
}

function pruneOldLogs(directory: string, day: string): void {
  if (lastPrunedDay === day) return;
  lastPrunedDay = day;
  try {
    if (!existsSync(directory)) return;
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays());
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    for (const file of readdirSync(directory)) {
      if (!file.startsWith(`${LOG_PREFIX}-`) || !file.endsWith(".log")) {
        continue;
      }
      const fileDay = file.slice(LOG_PREFIX.length + 1, -4);
      if (fileDay < cutoffDay) {
        try {
          unlinkSync(join(directory, file));
        } catch {
          // Best-effort retention must never interrupt nurture.
        }
      }
    }
  } catch {
    // Logging must never interrupt nurture.
  }
}

function safeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString();
  } catch {
    return raw.slice(0, 2_000);
  }
}

function sanitize(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : value;
  }
  if (typeof value !== "object") return String(value);
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    const entries = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitize(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_LENGTH) {
      entries.push(`[${value.length - MAX_ARRAY_LENGTH} more items]`);
    }
    return entries;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : sanitize(item, depth + 1, seen);
  }
  return out;
}

function kindHeader(kind: NurtureKind): string {
  if (kind === "email") return "EMAIL";
  if (kind === "voicebot") return "VOICEBOT";
  return "COMPOSE";
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

function formatBlock(event: NurtureApiLogEvent): string {
  const kind = kindHeader(event.nurtureKind);
  const result = event.ok ? "OK" : "FAIL";
  const status = event.status ?? "-";
  const ms = event.durationMs != null ? `${event.durationMs}ms` : "-";
  const request = sanitize(event.request);
  const response = sanitize(event.response);
  const lines = [
    `========== NURTURE ${kind} | ${event.method} ${event.operation} | ${result} status=${status} ${ms} ==========`,
    `timestamp: ${new Date().toISOString()}`,
    `service: ${event.service}`,
    `host: ${os.hostname()} pid=${process.pid}`,
    `url: ${safeUrl(event.url)}`,
    event.organizationId ? `organizationId: ${event.organizationId}` : null,
    event.contactId ? `contactId: ${event.contactId}` : null,
    event.error ? `error: ${event.error}` : null,
    "--- request payload ---",
    prettyJson(request),
    "--- response ---",
    prettyJson(response),
    `========== END NURTURE ${kind} ==========`,
    "",
  ];
  return lines.filter((line) => line != null).join("\n") + "\n";
}

export function writeNurtureApiLog(event: NurtureApiLogEvent): void {
  try {
    const day = today();
    const directory = logDirectory();
    mkdirSync(directory, { recursive: true });
    pruneOldLogs(directory, day);
    appendFileSync(
      join(directory, `${LOG_PREFIX}-${day}.log`),
      formatBlock(event),
      "utf8",
    );
  } catch {
    // Observability must never change nurture delivery behavior.
  }
}
