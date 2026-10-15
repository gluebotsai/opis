/**
 * Tenant-scoped opportunity / events (forms, etc.).
 */

import { apiDelete, apiGet, apiPut } from "@/services/api";
import type { OpportunityEvent } from "@/lib/opportunity-events-store";

type ApiBody<T> = {
  statusCode: number;
  message: string;
} & T;

export async function fetchOpportunityEvents(): Promise<OpportunityEvent[]> {
  const { data } = await apiGet<ApiBody<{ items: unknown[] }>>(
    "/opportunity-events",
  );
  const rows = Array.isArray(data.items) ? data.items : [];
  return rows as OpportunityEvent[];
}

export async function putOpportunityEvents(
  events: OpportunityEvent[],
): Promise<OpportunityEvent[]> {
  const { data } = await apiPut<ApiBody<{ items: unknown[] }>>(
    "/opportunity-events",
    { events },
  );
  const rows = Array.isArray(data.items) ? data.items : events;
  return rows as OpportunityEvent[];
}

export async function deleteOpportunityEventApi(
  publicId: string,
): Promise<void> {
  await apiDelete(`/opportunity-events/${encodeURIComponent(publicId)}`);
}

export type AgentEventsSnapshot = {
  launched: OpportunityEvent[];
  drafts: OpportunityEvent[];
  submissions: {
    id: string;
    formId: string;
    formSlug: string;
    answers: Record<string, string>;
    createdAt: string;
  }[];
  captured_at: string;
  source?: string;
};

export async function fetchAgentEventsSnapshot(): Promise<AgentEventsSnapshot> {
  const { data } = await apiGet<
    ApiBody<{
      launched: unknown[];
      drafts: unknown[];
      submissions: AgentEventsSnapshot["submissions"];
      captured_at: string;
      source?: string;
    }>
  >("/opportunity-events/agent-snapshot");
  return {
    launched: (Array.isArray(data.launched) ? data.launched : []) as OpportunityEvent[],
    drafts: (Array.isArray(data.drafts) ? data.drafts : []) as OpportunityEvent[],
    submissions: Array.isArray(data.submissions) ? data.submissions : [],
    captured_at: data.captured_at || new Date().toISOString(),
    source: data.source,
  };
}
