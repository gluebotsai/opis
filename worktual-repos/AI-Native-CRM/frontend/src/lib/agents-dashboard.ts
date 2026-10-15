/**
 * Client-safe Agents dashboard types (mirrors agents-dashboard-shared).
 */

export type AgentRangeId = "1h" | "1d" | "7d";

export const AGENT_RANGE_OPTIONS: Array<{
  id: AgentRangeId;
  label: string;
  ms: number;
}> = [
  { id: "1h", label: "Last 1 hour", ms: 60 * 60_000 },
  { id: "1d", label: "Last 1 day", ms: 24 * 60 * 60_000 },
  { id: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60_000 },
];

export function parseAgentRange(raw: string | null | undefined): AgentRangeId {
  if (raw === "1h" || raw === "1d" || raw === "7d") return raw;
  return "1d";
}

export type AgentMetricCard = {
  id: string;
  name: string;
  description: string;
  total: number;
  breakdown: Array<{ label: string; count: number }>;
};

export type AgentsDashboardPayload = {
  organizationId: string;
  range: AgentRangeId;
  since: string;
  until: string;
  agents: AgentMetricCard[];
};
