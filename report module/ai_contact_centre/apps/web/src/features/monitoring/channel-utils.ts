import type { AgentChannelCapacity, MonitoringChannel } from "./types";

const MONITORING_CHANNEL_ORDER: MonitoringChannel[] = [
  "voice",
  "webchat",
  "whatsapp",
  "instagram",
  "facebook",
  "email",
];

/** Maps legacy/alias channel ids to canonical monitoring channels. */
export function normalizeMonitoringChannel(channel: string): MonitoringChannel {
  const value = channel.trim().toLowerCase();
  if (value === "chat" || value === "webchat") return "webchat";
  if (value === "call" || value === "phone" || value === "voice") return "voice";
  if (
    value === "whatsapp" ||
    value === "instagram" ||
    value === "email" ||
    value === "facebook"
  ) {
    return value;
  }
  return "webchat";
}

export function sortMonitoringChannelCapacity(
  rows: AgentChannelCapacity[],
): AgentChannelCapacity[] {
  return [...rows].sort(
    (left, right) =>
      MONITORING_CHANNEL_ORDER.indexOf(left.channel) -
      MONITORING_CHANNEL_ORDER.indexOf(right.channel),
  );
}

/** Collapses duplicate rows (e.g. chat + webchat) into one per canonical channel. */
export function mergeChannelCapacity(rows: AgentChannelCapacity[]): AgentChannelCapacity[] {
  const byChannel = new Map<MonitoringChannel, AgentChannelCapacity>();

  for (const row of rows) {
    const channel = normalizeMonitoringChannel(row.channel);
    const existing = byChannel.get(channel);
    if (existing) {
      existing.active += row.active;
      existing.reserved += row.reserved;
      existing.max = Math.max(existing.max, row.max);
    } else {
      byChannel.set(channel, { ...row, channel });
    }
  }

  return sortMonitoringChannelCapacity([...byChannel.values()]);
}
