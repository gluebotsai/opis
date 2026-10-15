import type { CustomerInteractionHistory } from "@/features/workspace/types";

function durationSeconds(createdAt: string, endedAt: string): number {
  const endMs = Date.parse(endedAt);
  const startMs = Date.parse(createdAt);
  if (!Number.isFinite(endMs) || !Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

const OUTCOME_LABELS: Record<string, string> = {
  no_ready_agents: "No agents available",
  no_agent: "No agents available",
  no_agent_available: "No agents available",
  routing_exhausted: "No agents available",
  offer_timeout: "Missed offer",
  missed_offer: "Missed offer",
  agent_rejected: "Agent declined",
  all_agents_rejected: "Agent declined",
  manual_reject: "Agent declined",
  agent_resolved: "Resolved",
  bot_resolved: "Resolved by bot",
  bot_resolved_inactivity: "Resolved by bot",
  customer_ended: "Ended by customer",
  visitor_ended: "Ended by customer",
  customer_closed: "Ended by customer",
  agent_ended: "Ended by agent",
  supervisor_force_close: "Closed by supervisor",
  transferred: "Transferred",
  queue_and_notify: "Waiting for agent",
  bot_continue: "Bot handled",
  close_with_message: "Closed",
  resolved: "Resolved",
  closed: "Closed",
  ended: "Ended",
};

const KNOWN_OUTCOME_CODES = new Set(Object.keys(OUTCOME_LABELS));

function normalizeCode(value: string | null | undefined): string | null {
  const code = value?.trim().toLowerCase();
  return code || null;
}

function labelForCode(code: string | null | undefined): string | null {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  if (OUTCOME_LABELS[normalized]) return OUTCOME_LABELS[normalized];
  return normalized
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstKnownFact(facts: string[] | undefined): string | null {
  if (!facts?.length) return null;
  for (const fact of facts) {
    const normalized = normalizeCode(fact);
    if (normalized && KNOWN_OUTCOME_CODES.has(normalized)) {
      return normalized;
    }
  }
  return null;
}

export function isLiveInteractionStatus(status: string | undefined): boolean {
  const normalized = (status ?? "").toLowerCase();
  return (
    normalized === "active" ||
    normalized === "assigned" ||
    normalized === "queued" ||
    normalized === "waiting" ||
    normalized === "bot_active" ||
    normalized === "open" ||
    normalized === "pending"
  );
}

export function formatActivityOutcome(entry: {
  status?: string;
  endReason?: string | null;
  dispositionCode?: string | null;
  resolutionCode?: string | null;
  handoffReason?: string | null;
  agentConnected?: boolean;
  botMemory?: { extractedFacts?: string[] } | null;
}): string {
  const fromDisposition = labelForCode(entry.dispositionCode);
  if (fromDisposition) return fromDisposition;

  const fromEndReason = labelForCode(entry.endReason);
  if (fromEndReason) return fromEndReason;

  const fromResolution = labelForCode(entry.resolutionCode);
  if (fromResolution) return fromResolution;

  const fromHandoff = labelForCode(entry.handoffReason);
  if (fromHandoff) return fromHandoff;

  const fromFacts = labelForCode(firstKnownFact(entry.botMemory?.extractedFacts));
  if (fromFacts) return fromFacts;

  const status = (entry.status ?? "").toLowerCase();
  if (status === "resolved") return "Resolved";
  if (status === "closed" || status === "ended") return "Closed";
  if (status === "queued" || status === "waiting") return "Waiting for agent";
  if (entry.agentConnected) return "With agent";
  if (isLiveInteractionStatus(status)) return "Open";
  return "Conversation";
}

export function formatActivityDuration(entry: {
  createdAt?: string;
  endedAt?: string | null;
  resolvedAt?: string | null;
  occurredAt?: string;
  status?: string;
}): string {
  if (isLiveInteractionStatus(entry.status)) return "Open";

  const createdAt = entry.createdAt ?? entry.occurredAt;
  if (!createdAt) return "—";

  const endedAt = entry.endedAt ?? entry.resolvedAt ?? entry.occurredAt ?? null;
  if (!endedAt) return "—";

  const seconds = durationSeconds(createdAt, endedAt);

  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatActivityMetaLine(entry: CustomerInteractionHistory): string {
  const outcome = formatActivityOutcome(entry);
  const duration = formatActivityDuration(entry);
  return `${outcome} · ${duration}`;
}
