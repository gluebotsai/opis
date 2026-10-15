import { apiGet } from "./api";

export type PersonalisedCrmApiChannelMetric = {
  channel: string;
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  openRate: number | null;
  clickRate: number | null;
};

export type PersonalisedCrmApiRun = {
  id: string;
  title: string;
  status: string;
  origin?: "crm";
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
  channelMetrics?: PersonalisedCrmApiChannelMetric[];
  brief: string;
  subject: string;
  bodyPreview: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  sendAt?: string | null;
  timezone?: string;
  warnings: string[];
};

export type PersonalisedCrmRecipientChannel = {
  channel: string;
  outcome: string;
  status: string;
  skip_fail_reason: string | null;
  destination: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
};

export type PersonalisedCrmRecipientRow = {
  contact_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  outcome: string;
  channels: PersonalisedCrmRecipientChannel[];
};

export type PersonalisedCrmRecipientsReport = {
  campaign_id: string;
  name: string;
  audience_count: number;
  totals: {
    selected: number;
    sent: number;
    failed: number;
    pending: number;
    not_sent: number;
  };
  recipients: PersonalisedCrmRecipientRow[];
};

type ApiBody<T> = T & {
  statusCode?: number;
  message?: string;
};

export async function listPersonalisedCrmRunsApi(): Promise<
  PersonalisedCrmApiRun[]
> {
  const { data } = await apiGet<ApiBody<{ runs?: PersonalisedCrmApiRun[] }>>(
    "/campaigns/personalised-crm",
  );
  return Array.isArray(data?.runs) ? data.runs : [];
}

export async function getPersonalisedCrmRunApi(
  id: string,
): Promise<PersonalisedCrmApiRun | null> {
  const { data } = await apiGet<ApiBody<{ run?: PersonalisedCrmApiRun }>>(
    `/campaigns/personalised-crm/${encodeURIComponent(id)}`,
  );
  return data?.run ?? null;
}

export async function getPersonalisedCrmRecipientsApi(
  id: string,
): Promise<PersonalisedCrmRecipientsReport | null> {
  const { data } = await apiGet<ApiBody<PersonalisedCrmRecipientsReport>>(
    `/campaigns/personalised-crm/${encodeURIComponent(id)}/recipients`,
  );
  if (!data?.campaign_id && !Array.isArray(data?.recipients)) return null;
  return data as PersonalisedCrmRecipientsReport;
}
