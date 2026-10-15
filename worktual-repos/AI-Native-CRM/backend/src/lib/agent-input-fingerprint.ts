/**
 * Stable hashes of agent inputs so cron sweeps skip unchanged LLM calls.
 */

import { createHash } from "node:crypto";

export function hashAgentInput(parts: unknown): string {
  const payload = JSON.stringify(parts, (_key, value) => {
    if (value === undefined) return null;
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Date) return value.toISOString();
    return value;
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 40);
}

/** Coarse day bands — score/forecast don't need daily LLM for +1 day silence. */
export function activityAgeBand(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "unknown";
  if (days < 3) return "0-2";
  if (days < 7) return "3-6";
  if (days < 14) return "7-13";
  if (days < 30) return "14-29";
  if (days < 60) return "30-59";
  if (days < 90) return "60-89";
  return "90+";
}

export function overdueBand(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "unknown";
  if (days <= 0) return "not_due";
  if (days < 7) return "1-6";
  if (days < 15) return "7-14";
  if (days < 30) return "15-29";
  if (days < 60) return "30-59";
  return "60+";
}
