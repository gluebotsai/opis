import { api, apiGet } from "./api";

export type OnDemandApiChecklistStep = {
  id: string;
  label: string;
  detail?: string;
  status: "done" | "active" | "pending" | "failed" | "skipped";
  at: string | null;
};

export type OnDemandApiChannelMetric = {
  channel: string;
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  openRate: number | null;
  clickRate: number | null;
};

export type OnDemandApiRun = {
  id: string;
  title: string;
  status: string;
  source?: "agent" | "spoke" | "hub" | "internal";
  channels: string[];
  audienceCount: number;
  audienceHint: string;
  sent: number;
  failed: number;
  pending: number;
  opens?: number;
  clicks?: number;
  openRate?: number | null;
  clickRate?: number | null;
  channelMetrics?: OnDemandApiChannelMetric[];
  requestText: string;
  subject: string;
  bodyPreview: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  warnings: string[];
  checklist: OnDemandApiChecklistStep[];
  agentThought: string[];
};

export type LaunchOnDemandInput = {
  request_text: string;
  emails?: string[];
  phones?: string[];
  contact_ids?: string[];
  customer_ids?: string[];
  channels?: Array<"email" | "push" | "web" | "whatsapp">;
  subject?: string | null;
  body?: string | null;
  title?: string | null;
  name?: string | null;
  source?: "agent" | "spoke" | "hub" | "internal";
};

type ApiBody<T> = T & {
  statusCode?: number;
  message?: string;
};

export async function listOnDemandRunsApi(): Promise<OnDemandApiRun[]> {
  const { data } = await apiGet<ApiBody<{ runs?: OnDemandApiRun[] }>>(
    "/campaigns/on-demand",
  );
  return Array.isArray(data?.runs) ? data.runs : [];
}

export async function getOnDemandRunApi(
  id: string,
): Promise<OnDemandApiRun | null> {
  const { data } = await apiGet<ApiBody<{ run?: OnDemandApiRun }>>(
    `/campaigns/on-demand/${encodeURIComponent(id)}`,
  );
  return data?.run ?? null;
}

export async function launchOnDemandApi(
  input: LaunchOnDemandInput,
): Promise<{
  run: OnDemandApiRun;
  warnings: string[];
}> {
  const { data } = await api.post<
    ApiBody<{ run?: OnDemandApiRun; warnings?: string[] }>
  >("/campaigns/on-demand", input);
  if (!data?.run) {
    throw new Error(data?.message || "On-demand launch did not return a run.");
  }
  return {
    run: data.run,
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
}

/** Hub/spoke fire-and-forget — ack only, no further hub communication. */
export async function acceptOnDemandFromHubApi(
  input: Omit<LaunchOnDemandInput, "request_text"> & {
    request_text?: string;
  },
): Promise<{
  accepted: boolean;
  received: boolean;
  run_id: string | null;
  message: string;
  warnings: string[];
}> {
  const { data } = await api.post<
    ApiBody<{
      accepted?: boolean;
      received?: boolean;
      run_id?: string | null;
      message?: string;
      warnings?: string[];
    }>
  >("/campaigns/on-demand/accept", input);
  return {
    accepted: Boolean(data?.accepted),
    received: Boolean(data?.received),
    run_id: data?.run_id ?? null,
    message: data?.message || "Request received",
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  };
}
