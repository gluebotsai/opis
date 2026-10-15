import { api } from "./api";
import type { AgentsDashboardPayload } from "@/lib/agents-dashboard";
import type { AgentStepDto } from "./contacts";

export async function fetchAgentsDashboard(range?: string) {
  const { data } = await api.get<{ ok: true; data: AgentsDashboardPayload }>(
    "/api/agents",
    { params: range ? { range } : undefined },
  );
  return data.data;
}

/**
 * Agents with a dedicated "Recent runs" page. The first five have a job
 * table + contactId; the rest have no job table — the backend derives their
 * runs directly from `agent_step_events` (an ephemeral run id the agent
 * generates per invocation), so `contactId` can be null for those (e.g. a
 * company-only `sales_assignment` run).
 */
export const AGENT_RUN_IDS = [
  "lead_enrichment",
  "lead_scoring",
  "lead_nurture",
  "lead_lifecycle",
  "email_auto_reply",
  "lead_summary",
  "sales_assignment",
  "meeting_brief",
  "meeting_reminder",
  "meeting_miss_escalation",
  "meeting_mom",
  "post_meeting_process",
  "pipeline_forecast",
  "sales_coach",
  "compliance_privacy",
  "invoice_escalation",
  "expansion_matcher",
  "prospect_search",
  "prospect_qualify",
  "prospect_personnel",
  "proposal_corpus",
  "proposal_generate",
] as const;
export type AgentRunId = (typeof AGENT_RUN_IDS)[number];

export function isAgentRunId(id: string): id is AgentRunId {
  return (AGENT_RUN_IDS as readonly string[]).includes(id);
}

export type AgentRunSummary = {
  agent: AgentRunId;
  jobId: string;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  companyName: string | null;
  subjectLabel: string | null;
  subjectHref: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  durationMs: number | null;
};

export type AgentRunDetail = {
  run: AgentRunSummary;
  steps: AgentStepDto[];
};

/** Run summary + curated step trace for one agent run's detail page. */
export async function fetchAgentRunSteps(agentId: AgentRunId, jobId: string) {
  const { data } = await api.get<
    { ok: true; data: AgentRunDetail } | { ok: false; error?: string }
  >(`/api/agents/${agentId}/runs/${jobId}/steps`);
  if (!data.ok) {
    throw new Error(data.error || "Failed to load this run.");
  }
  return data.data;
}

export type AgentRunsPage = {
  runs: AgentRunSummary[];
  total: number;
};

/** Paginated run history for the dedicated "Recent runs" page. */
export async function fetchAgentRunsPage(
  agentId: AgentRunId,
  params: {
    limit: number;
    offset: number;
    status?: string | null;
    range?: string | null;
  },
) {
  const { data } = await api.get<
    { ok: true; data: AgentRunsPage } | { ok: false; error?: string }
  >(`/api/agents/${agentId}/runs/page`, {
    params: {
      limit: params.limit,
      offset: params.offset,
      status: params.status || undefined,
      range: params.range || undefined,
    },
  });
  if (!data.ok) {
    throw new Error(data.error || "Failed to load runs.");
  }
  return data.data;
}
