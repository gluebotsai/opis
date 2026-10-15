import { cn } from "@/lib/utils";

import {
  mergeChannelCapacity,
  sortMonitoringChannelCapacity,
} from "@/features/monitoring/channel-utils";
import type { AgentChannelCapacity, LiveAgent } from "@/features/monitoring/types";

export function formatMonitoringDuration(seconds: number | null): string {
  if (seconds == null || seconds < 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function presenceBadgeClass(presence: string): string {
  switch (presence) {
    case "ready":
      return "bg-emerald-50 text-emerald-700 ring-emerald-100";
    case "busy":
    case "after_contact_work":
      return "bg-amber-50 text-amber-700 ring-amber-100";
    case "not_ready":
    case "break":
    case "away":
      return "bg-orange-50 text-orange-700 ring-orange-100";
    case "offline":
      return "bg-neutral-100 text-neutral-600 ring-neutral-200";
    default:
      return "bg-sky-50 text-sky-700 ring-sky-100";
  }
}

export function slaBadgeClass(status: "ok" | "warning" | "breached" | null): string {
  switch (status) {
    case "breached":
      return "bg-rose-50 text-rose-700";
    case "warning":
      return "bg-amber-50 text-amber-700";
    case "ok":
      return "bg-emerald-50 text-emerald-700";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

export function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    voice: "Voice",
    webchat: "Web Chat",
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    facebook: "Facebook",
    email: "Email",
  };
  return labels[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1);
}

export { sortMonitoringChannelCapacity } from "@/features/monitoring/channel-utils";

export function resolveAgentChannelCapacity(agent: LiveAgent): AgentChannelCapacity[] {
  if (agent.channelCapacity.length > 0) {
    return mergeChannelCapacity(agent.channelCapacity);
  }

  if (agent.channels.length === 0) {
    return [
      {
        channel: "webchat",
        active: agent.conversations.length,
        reserved: 0,
        max: Math.max(1, agent.maxCapacity),
      },
    ];
  }

  const maxEach = Math.max(1, Math.ceil(agent.maxCapacity / agent.channels.length));
  return sortMonitoringChannelCapacity(
    agent.channels.map((channel) => ({
      channel,
      active: agent.conversations.filter((row) => row.channel === channel).length,
      reserved: 0,
      max: maxEach,
    })),
  );
}

/** Matches workspace toolbar presence labels (Ready, Not Ready, etc.). */
export function agentPresenceLabel(presence: string): string {
  switch (presence) {
    case "ready":
    case "available":
      return "Ready";
    case "busy":
      return "Busy";
    case "after_contact_work":
      return "After contact work";
    case "away":
      return "Away";
    case "not_ready":
      return "Not Ready";
    case "break":
      return "Break";
    case "offline":
      return "Offline";
    default:
      return presence.replaceAll("_", " ");
  }
}

export function agentPresenceTone(
  presence: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (presence) {
    case "ready":
    case "available":
      return "success";
    case "busy":
      return "info";
    case "after_contact_work":
      return "warning";
    case "away":
    case "not_ready":
    case "break":
      return "warning";
    case "offline":
      return "neutral";
    default:
      return "neutral";
  }
}

export type AgentPresenceFilter =
  | "all"
  | "ready"
  | "busy"
  | "away"
  | "not_ready"
  | "break"
  | "offline";

export function matchesAgentPresenceFilter(
  presence: string,
  filter: AgentPresenceFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "ready") return presence === "ready" || presence === "available";
  return presence === filter;
}

export function isAgentLoggedIn(presence: string): boolean {
  return presence !== "offline" && presence !== "inactive" && presence.trim() !== "";
}

/** Presence shown on monitoring cards — accounts for active workload. */
export function resolveMonitoringAgentPresence(agent: {
  presence: string;
  activeCount: number;
  conversations: unknown[];
}): string {
  let presence = agent.presence;
  if (presence === "active" || presence === "inactive") {
    presence = "offline";
  }

  const hasWork = agent.activeCount > 0 || agent.conversations.length > 0;
  if (
    hasWork &&
    (presence === "offline" || presence === "not_ready" || presence === "break" || presence === "away")
  ) {
    return "busy";
  }

  return presence;
}

/** Maps legacy monitoring status buckets to cc-core presence values. */
export function agentStatusToPresence(status: string): string {
  switch (status) {
    case "available":
      return "ready";
    case "wrap-up":
      return "after_contact_work";
    default:
      return status;
  }
}

export function MetricTile({
  label,
  value,
  caption,
  tone = "neutral",
  compact = false,
}: {
  label: string;
  value: string | number;
  caption?: string;
  tone?: "neutral" | "warning" | "critical" | "success";
  compact?: boolean;
}) {
  const toneClass =
    tone === "critical"
      ? "border-rose-200 bg-rose-50/60"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/60"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-neutral-200 bg-white";

  return (
    <div className={cn("rounded-xl border px-3.5 py-3", toneClass, compact && "px-3 py-2.5")}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">{label}</p>
      <p className={cn("mt-1 font-semibold text-neutral-900", compact ? "text-xl" : "text-2xl")}>
        {value}
      </p>
      {caption ? <p className="mt-0.5 text-[11px] text-neutral-600">{caption}</p> : null}
    </div>
  );
}
