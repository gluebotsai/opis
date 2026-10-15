/**
 * Shared portfolio / activity query parsing (Dashboard parity).
 */
import { toAgentChannel } from "./channel-ids.js";

export function parseAllowedChannelsParam(
  raw: unknown,
): Set<string> | null {
  if (raw == null || raw === "") return null;
  const parts = String(raw)
    .split(/[,|]/)
    .map((s) => toAgentChannel(s.trim()))
    .filter(Boolean);
  if (!parts.length) return null;
  return new Set(parts);
}
