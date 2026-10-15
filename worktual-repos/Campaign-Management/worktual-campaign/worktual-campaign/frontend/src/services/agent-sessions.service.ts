/**
 * Create-campaign agent session API (server-backed drafts).
 */

import { api, apiGet } from "./api";

export type AgentSessionPayload = Record<string, unknown>;

export type AgentSessionListItem = {
  id: string;
  module: string;
  stage: string;
  campaign_name: string;
  goal: string;
  message_count: number;
  channels: string[];
  campaign_id: string | null;
  campaign_status: string | null;
  /** Linked campaign endsAt/startsAt ISO — Completed Drafts list date. */
  campaign_ends_at?: string | null;
  pinned?: boolean;
  created_at: string;
  updated_at: string;
  session: AgentSessionPayload;
};

type ApiBody<T> = {
  statusCode: number;
  message: string;
} & T;

export type AgentSessionListResult = {
  sessions: AgentSessionListItem[];
  total: number;
};

export type DraftListBucket =
  | "all"
  | "live"
  | "scheduled"
  | "completed"
  | "in_progress";

export async function listCreateCampaignSessions(options?: {
  limit?: number;
  offset?: number;
  bucket?: DraftListBucket;
}) {
  const { data } = await apiGet<
    ApiBody<{ sessions: AgentSessionListItem[]; total?: number }>
  >("/agent-sessions", {
    params: {
      module: "create_campaign",
      limit: options?.limit ?? 30,
      offset: options?.offset ?? 0,
      ...(options?.bucket && options.bucket !== "all"
        ? { bucket: options.bucket }
        : {}),
    },
  });
  return {
    sessions: data.sessions ?? [],
    total: typeof data.total === "number" ? data.total : (data.sessions ?? []).length,
  };
}

export async function getOrCreateAgentSession(
  sessionId: string,
  module: "create_campaign" | "contacts" | "monitoring" = "create_campaign",
) {
  const { data } = await apiGet<
    ApiBody<{ session: AgentSessionPayload; contact_ids: string[] }>
  >(`/agent-sessions/${sessionId}`, {
    params: { module, create: "true" },
  });
  return data;
}

/** Load an existing session; returns null on 404 (does not create). */
export async function getAgentSessionIfExists(
  sessionId: string,
  module: "create_campaign" | "contacts" | "monitoring" = "create_campaign",
): Promise<{
  session: AgentSessionPayload;
  contact_ids: string[];
} | null> {
  try {
    const { data } = await apiGet<
      ApiBody<{ session: AgentSessionPayload; contact_ids: string[] }>
    >(`/agent-sessions/${sessionId}`, {
      params: { module, create: "false" },
    });
    return data;
  } catch (err: unknown) {
    const status =
      err &&
      typeof err === "object" &&
      "response" in err &&
      (err as { response?: { status?: number } }).response?.status;
    if (status === 404) return null;
    throw err;
  }
}

export async function saveAgentSession(
  sessionId: string,
  session: AgentSessionPayload,
) {
  const { data } = await api.put<
    ApiBody<{ session: AgentSessionPayload; contact_ids: string[] }>
  >(`/agent-sessions/${sessionId}`, { session });
  return data;
}

export async function pinAgentSession(sessionId: string, pinned: boolean) {
  const { data } = await api.patch<
    ApiBody<{ id: string; pinned: boolean }>
  >(`/agent-sessions/${sessionId}/pin`, { pinned });
  return data;
}

export async function deleteAgentSession(sessionId: string) {
  const { data } = await api.delete<
    ApiBody<{ id: string; deleted: boolean }>
  >(`/agent-sessions/${sessionId}`);
  return data;
}
