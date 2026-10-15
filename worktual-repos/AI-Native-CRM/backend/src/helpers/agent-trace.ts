/**
 * Day-wise agent trace logger for backend (Fastify side).
 *
 * Writes JSON lines to `backend/logs/coworker-YYYY-MM-DD.log` and
 * `backend/logs/proactive-YYYY-MM-DD.log`.  Keeps **3 days**; on day 4
 * the oldest file for that prefix is deleted automatically.
 *
 * Usage:
 *   import { agentTrace } from "@/helpers/agent-trace";
 *   agentTrace("coworker", { agent: "crm-agent", step: "dispatch", module: "contact", user: "hi" });
 */

import { createWriteStream, readdirSync, unlinkSync, mkdirSync, existsSync, type WriteStream } from "node:fs";
import { join } from "node:path";

const LOG_DIR = join(import.meta.dirname, "..", "..", "logs");
const KEEP_DAYS = 3;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function stamp(): string {
  return new Date().toISOString();
}

const streams = new Map<string, { day: string; ws: WriteStream }>();

function prunePrefix(prefix: string): void {
  try {
    if (!existsSync(LOG_DIR)) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const f of readdirSync(LOG_DIR)) {
      if (!f.startsWith(`${prefix}-`) || !f.endsWith(".log")) continue;
      const day = f.slice(prefix.length + 1, -4);
      if (day < cutoffStr) {
        try {
          unlinkSync(join(LOG_DIR, f));
        } catch { /* best effort */ }
      }
    }
  } catch { /* ignore */ }
}

function getStream(prefix: string): WriteStream {
  const d = today();
  const cached = streams.get(prefix);
  if (cached && cached.day === d) return cached.ws;
  if (cached) {
    try { cached.ws.end(); } catch { /* ignore */ }
  }
  mkdirSync(LOG_DIR, { recursive: true });
  const ws = createWriteStream(join(LOG_DIR, `${prefix}-${d}.log`), { flags: "a" });
  streams.set(prefix, { day: d, ws });
  prunePrefix(prefix);
  return ws;
}

export function agentTrace(
  channel: "coworker" | "proactive",
  fields: Record<string, unknown>,
): void {
  try {
    const line = JSON.stringify({ ts: stamp(), ...fields }) + "\n";
    getStream(channel).write(line);
  } catch { /* never throw from logging */ }
}
