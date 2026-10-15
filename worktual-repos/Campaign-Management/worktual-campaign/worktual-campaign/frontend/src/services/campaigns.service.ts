import {
  parseSendFailureRow,
  type CampaignSendFailureRow,
} from "@/lib/campaign-send-failures";
import { api, apiGet, getToken } from "./api";

export type { CampaignSendFailureRow };

export type DashboardCounts = {
  live: number;
  scheduled: number;
  draft: number;
  past: number;
  /** On-demand runs (tagged launch_plan.on_demand). */
  onDemand?: number;
  /** Personalised CRM runs (tagged launch_plan.personalised_crm). */
  personalisedCrm?: number;
};

export type CampaignChannelMetric = {
  channel: string;
  selected: number;
  sent: number;
  failed: number;
  bounced: number;
  /** Delivered messages — denominator for open / click rates. */
  delivered?: number;
  stubSent?: number;
  /** Unique openers / clickers. */
  opens: number;
  clicks: number;
  /** Hits including repeats. */
  totalOpens?: number;
  totalClicks?: number;
  impressions: number;
  spend: number;
  conversions: number;
  currency: string | null;
  openRate: number | null;
  clickRate: number | null;
  /** Click-to-open rate: unique clicks / unique opens. */
  ctor?: number | null;
  fromLiveSends: boolean;
};

export type CampaignListItem = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone?: string;
  launchLocalDate?: string | null;
  launchLocalTime?: string | null;
  sourceChannel: string;
  createdAt: string;
  goal?: string | null;
  objective?: string | null;
  audienceSummary?: string | null;
  audienceCount?: number;
  sent?: number;
  failed?: number;
  stubSent?: number;
  delivered?: number;
  opens?: number;
  clicks?: number;
  totalOpens?: number;
  totalClicks?: number;
  openRate?: number | null;
  clickRate?: number | null;
  ctor?: number | null;
  impressions?: number;
  spend?: number;
  conversions?: number;
  currency?: string | null;
  hasPpc?: boolean;
  /** Channel ids on the campaign (from list API). */
  channels?: string[];
  channelMetrics?: CampaignChannelMetric[];
  emailSent?: number;
  emailOpens?: number;
  emailClicks?: number;
};

export type CampaignChannelDetail = {
  id: string;
  channel: string;
  howItWorks: string | null;
  plannedLaunchAt: string | null;
  status: string;
  templateId: string | null;
  totalToSend: number;
  selected: number;
  sent: number;
  failed: number;
  bounced: number;
  delivered?: number;
  stubSent?: number;
  opens?: number;
  clicks?: number;
  totalOpens?: number;
  totalClicks?: number;
  openRate?: number | null;
  clickRate?: number | null;
  ctor?: number | null;
  paused: boolean;
  pauseReason: string | null;
  /** When the channel was paused (ISO); used for 10-day dashboard alerts. */
  pausedAt?: string | null;
  network?: string | null;
  impressions?: number;
  spend?: number;
  currency?: string | null;
  conversions?: number;
  dailyBudget?: number | null;
  planSummary?: string | null;
  ctr?: number | null;
  cpc?: number | null;
  cpa?: number | null;
  fromLiveSends?: boolean;
};

export type EmailAbVariantStats = {
  variant: "a" | "b";
  sent: number;
  failed: number;
  held: number;
  opens: number;
  clicks: number;
  openRate: number | null;
  clickRate: number | null;
};

export type EmailAbStats = {
  enabled: boolean;
  winner: "a" | "b" | null;
  auto: boolean;
  pctA: number;
  pctB: number;
  pctHoldout: number;
  decideAfterMinutes: number;
  remainderReleased: boolean;
  variants: EmailAbVariantStats[];
  holdout: { held: number; sent: number };
};

export type CampaignDetail = {
  id: string;
  name: string;
  description: string | null;
  goal: string | null;
  objective: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  audienceCount: number;
  audienceSummary: string | null;
  stubSent?: number;
  launchPlan: Record<string, unknown> | null;
  sourceChannel: string;
  createdAt: string;
  channels: CampaignChannelDetail[];
  sent?: number;
  failed?: number;
  delivered?: number;
  opens?: number;
  clicks?: number;
  totalOpens?: number;
  totalClicks?: number;
  openRate?: number | null;
  clickRate?: number | null;
  ctor?: number | null;
  emailSent?: number;
  emailOpens?: number;
  emailClicks?: number;
  emailAb?: EmailAbStats | null;
};

type ApiBody<T> = {
  statusCode: number;
  message: string;
} & T;

export async function fetchDashboard() {
  const { data } = await apiGet<ApiBody<{ counts: DashboardCounts }>>(
    "/campaigns/dashboard",
  );
  return data.counts;
}

export type CampaignBucket =
  | "live"
  | "scheduled"
  | "past"
  | "draft"
  | "all"
  | "calendar";

export async function fetchCampaigns(
  bucket: CampaignBucket = "live",
  opts?: {
    relative?: "today" | "yesterday" | "last_7_days" | "last_month" | null;
    from?: string | null;
    to?: string | null;
    /** Skip send metrics — faster for calendar. */
    lite?: boolean;
  },
) {
  const { data } = await apiGet<
    ApiBody<{ getCampaignDetails: CampaignListItem[] }>
  >("/campaigns", {
    params: {
      bucket,
      ...(opts?.relative ? { relative: opts.relative } : {}),
      ...(opts?.from ? { from: opts.from } : {}),
      ...(opts?.to ? { to: opts.to } : {}),
      ...(opts?.lite ? { lite: "1" } : {}),
    },
  });
  return data.getCampaignDetails ?? [];
}

export type PortfolioTotalsApi = {
  campaigns: number;
  campaigns_ran?: number;
  campaigns_with_send?: number;
  campaigns_with_failure?: number;
  messages_sent?: number;
  messages_failed?: number;
  draft_count?: number;
  kpi_glossary?: string;
  live_count: number;
  scheduled_count: number;
  completed_count?: number;
  sent: number;
  delivered: number;
  failed: number;
  stub_sent?: number;
  opens: number;
  clicks: number;
  total_opens?: number;
  total_clicks?: number;
  open_rate_pct: number | null;
  click_rate_pct: number | null;
  ctor_pct?: number | null;
  open_rate_display?: string | null;
  click_rate_display?: string | null;
  open_tracked_delivered?: number;
  click_tracked_delivered?: number;
  channel_rollup?: Array<{
    channel: string;
    sent: number;
    failed: number;
    stubSent?: number;
    delivered: number;
    opens: number;
    clicks: number;
    campaigns: number;
  }>;
};

export type ActiveLiveSendRow = {
  campaign_id: string;
  campaign_name?: string;
  campaign_status?: string;
  channel?: string;
  batch_id?: string;
  batch_status?: string;
  scheduled_for?: string;
  pending?: number;
  sent?: number;
  failed?: number;
};

export async function fetchActiveLiveSends(limit = 10) {
  const { data } = await apiGet<
    ApiBody<{ active_sends: ActiveLiveSendRow[]; as_of?: string }>
  >("/campaigns/live-sends/active", { params: { limit: String(limit) } });
  return {
    asOf: data.as_of ?? null,
    activeSends: data.active_sends ?? [],
  };
}

/** @deprecated Prefer fetchPortfolioPerformance — same totals via SSOT contract. */
export async function fetchPortfolioMetrics(opts?: {
  relative?: string;
  from?: string;
  to?: string;
  channels?: string;
}) {
  const perf = await fetchPortfolioPerformance({ ...opts, mode: "launch" });
  return {
    totals: perf.totals,
    campaignsMatched: perf.campaignsMatched,
  };
}

/** SSOT Dashboard performance — launch KPIs + activity series (agent parity). */
export async function fetchPortfolioPerformance(opts?: {
  mode?: "launch" | "activity";
  relative?: string;
  from?: string;
  to?: string;
  activityFrom?: string;
  activityTo?: string;
  channels?: string;
}) {
  const { data } = await apiGet<
    ApiBody<{
      portfolio_totals: PortfolioTotalsApi;
      activity_series: ActivitySeriesPoint[];
      campaigns_matched: number;
      performance_mode?: string;
      period?: Record<string, unknown>;
      definitions?: Record<string, string>;
    }>
  >("/campaigns/portfolio/performance", {
    params: {
      bucket: "all",
      mode: opts?.mode ?? "launch",
      ...(opts?.relative ? { relative: opts.relative } : {}),
      ...(opts?.from ? { from: opts.from } : {}),
      ...(opts?.to ? { to: opts.to } : {}),
      ...(opts?.activityFrom ? { activity_from: opts.activityFrom } : {}),
      ...(opts?.activityTo ? { activity_to: opts.activityTo } : {}),
      ...(opts?.channels ? { channels: opts.channels } : {}),
    },
  });
  return {
    totals: data.portfolio_totals,
    activitySeries: data.activity_series ?? [],
    campaignsMatched: data.campaigns_matched ?? 0,
    performanceMode: data.performance_mode ?? "launch",
    period: data.period ?? null,
    definitions: data.definitions ?? null,
  };
}

export type ActivitySeriesPoint = {
  date: string;
  label?: string;
  sent: number;
  failed: number;
  opens: number;
  clicks: number;
};

export type CampaignOpsFeedPayload = {
  asOf: string | null;
  activeSends: ActiveLiveSendRow[];
  recentFailures: unknown[];
  activitySeries: ActivitySeriesPoint[];
};

function mapCampaignOpsFeedBody(data: {
  active_sends?: ActiveLiveSendRow[];
  recent_failures?: unknown[];
  activity_series?: ActivitySeriesPoint[];
  as_of?: string;
}): CampaignOpsFeedPayload {
  return {
    asOf: data.as_of ?? null,
    activeSends: data.active_sends ?? [],
    recentFailures: data.recent_failures ?? [],
    activitySeries: data.activity_series ?? [],
  };
}

export async function fetchCampaignOpsFeed(opts?: {
  relative?: string;
  from?: string;
  to?: string;
  activityFrom?: string;
  activityTo?: string;
  channels?: string;
  liveLimit?: number;
  failureLimit?: number;
}): Promise<CampaignOpsFeedPayload> {
  const { data } = await apiGet<
    ApiBody<{
      active_sends: ActiveLiveSendRow[];
      recent_failures: unknown[];
      activity_series: ActivitySeriesPoint[];
      as_of?: string;
    }>
  >("/campaigns/ops-feed", {
    params: {
      ...(opts?.relative ? { relative: opts.relative } : {}),
      ...(opts?.from ? { from: opts.from } : {}),
      ...(opts?.to ? { to: opts.to } : {}),
      ...(opts?.activityFrom ? { activity_from: opts.activityFrom } : {}),
      ...(opts?.activityTo ? { activity_to: opts.activityTo } : {}),
      ...(opts?.channels ? { channels: opts.channels } : {}),
      ...(opts?.liveLimit != null
        ? { live_limit: String(opts.liveLimit) }
        : {}),
      ...(opts?.failureLimit != null
        ? { failure_limit: String(opts.failureLimit) }
        : {}),
    },
  });
  return mapCampaignOpsFeedBody(data);
}

export async function fetchRecentSendFailures(opts?: {
  campaignId?: string;
  channel?: string;
  limit?: number;
}): Promise<{ failures: CampaignSendFailureRow[]; count: number }> {
  const { data } = await apiGet<
    ApiBody<{
      failures?: Array<Record<string, unknown>>;
      count?: number;
    }>
  >("/campaigns/send-failures/recent", {
    params: {
      ...(opts?.campaignId ? { campaign_id: opts.campaignId } : {}),
      ...(opts?.channel ? { channel: opts.channel } : {}),
      ...(opts?.limit != null ? { limit: String(opts.limit) } : {}),
    },
  });
  const failures = (data.failures ?? []).map((row) =>
    parseSendFailureRow(row),
  );
  return { failures, count: data.count ?? failures.length };
}

/** Live ops SSE — EventSource cannot send Authorization headers. */
export function subscribeCampaignOpsFeedStream(
  opts: {
    relative?: string;
    from?: string;
    to?: string;
    activityFrom?: string;
    activityTo?: string;
    channels?: string;
    liveLimit?: number;
    failureLimit?: number;
  },
  onUpdate: (feed: CampaignOpsFeedPayload) => void,
): () => void {
  const token = getToken();
  if (!token) return () => {};

  const params = new URLSearchParams();
  params.set("access_token", token);
  if (opts.relative) params.set("relative", opts.relative);
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  if (opts.activityFrom) params.set("activity_from", opts.activityFrom);
  if (opts.activityTo) params.set("activity_to", opts.activityTo);
  if (opts.channels) params.set("channels", opts.channels);
  if (opts.liveLimit != null) params.set("live_limit", String(opts.liveLimit));
  if (opts.failureLimit != null) {
    params.set("failure_limit", String(opts.failureLimit));
  }

  const buildUrl = () => {
    const p = new URLSearchParams(params);
    const latest = getToken();
    if (latest) p.set("access_token", latest);
    return `/api/campaigns/ops-feed/stream?${p.toString()}`;
  };

  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let backoffMs = 2_000;

  const attach = (source: EventSource) => {
    source.addEventListener("ops", (ev) => {
      backoffMs = 2_000;
      try {
        const raw = JSON.parse((ev as MessageEvent).data as string) as {
          active_sends?: ActiveLiveSendRow[];
          recent_failures?: unknown[];
          activity_series?: ActivitySeriesPoint[];
          as_of?: string;
        };
        onUpdate(mapCampaignOpsFeedBody(raw));
      } catch {
        /* ignore malformed frame */
      }
    });
    source.onerror = () => {
      source.close();
      if (closed) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const wait = backoffMs;
      backoffMs = Math.min(backoffMs * 2, 30_000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (closed) return;
        es = new EventSource(buildUrl());
        attach(es);
      }, wait);
    };
  };

  es = new EventSource(buildUrl());
  attach(es);

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    es?.close();
  };
}

export async function fetchCampaignById(id: string) {
    const { data } = await apiGet<ApiBody<{ campaign: CampaignDetail }>>(
    `/campaigns/${id}`,
  );
  return data.campaign;
}

export type CampaignRecipientOutcome =
  | "sent"
  | "stub"
  | "failed"
  | "skipped"
  | "pending"
  | "not_sent";

export type CampaignRecipientRow = {
  contact_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  selected: boolean;
  outcome: CampaignRecipientOutcome;
  channels: Array<{
    channel: string;
    outcome: CampaignRecipientOutcome;
    status: string;
    skip_fail_reason: string | null;
    provider_message_id: string | null;
    stub: boolean;
    opened: boolean;
    clicked: boolean;
    destination: string | null;
  }>;
};

export type CampaignRecipientsReport = {
  campaign_id: string;
  name: string;
  audience_count: number;
  audience_summary: string | null;
  totals: {
    selected: number;
    sent: number;
    stub: number;
    failed: number;
    skipped: number;
    pending: number;
    not_sent: number;
    opened: number;
    clicked: number;
  };
  recipients: CampaignRecipientRow[];
  note?: string;
};

export async function fetchCampaignRecipients(
  id: string,
  opts?: { channel?: string; limit?: number },
) {
    const { data } = await apiGet<ApiBody<CampaignRecipientsReport>>(
    `/campaigns/${id}/recipients`,
    {
      params: {
        ...(opts?.channel ? { channel: opts.channel } : {}),
        ...(opts?.limit ? { limit: opts.limit } : {}),
      },
    },
  );
  return data;
}

export async function setChannelRunState(
  campaignId: string,
  channel: string,
  body: { paused: boolean; reason?: string | null },
) {
    const { data } = await api.post<ApiBody<{ campaign: CampaignDetail }>>(
    `/campaigns/${campaignId}/channels/${encodeURIComponent(channel)}/run-state`,
    body,
  );
  return data.campaign;
}

export type StopCampaignResult = {
  stopped: boolean;
  already_finished?: boolean;
  needs_reason?: boolean;
  not_launching?: boolean;
  status: string;
  prior_status?: string;
  name: string;
  selected: number;
  sent: number;
  stub_sent?: number;
  failed?: number;
  reason?: string | null;
  message?: string;
  campaign: CampaignDetail;
};

export async function stopCampaign(
  campaignId: string,
  reason?: string | null,
) {
  const { data } = await api.post<ApiBody<StopCampaignResult>>(
    `/campaigns/${campaignId}/stop`,
    { reason: reason ?? null },
  );
  return data;
}

export async function pickEmailAbWinner(
  campaignId: string,
  body?: { winner?: "a" | "b" | null; force?: boolean },
) {
    const { data } = await api.post<
    ApiBody<{
      campaign?: CampaignDetail;
      winner?: "a" | "b" | null;
      remainder?: number;
      message?: string;
      already?: boolean;
    }>
  >(`/campaigns/${campaignId}/ab-winner`, body ?? { force: true });
  return data;
}

export async function createCampaign(body: {
  name: string;
  description?: string | null;
}) {
    const { data } = await api.post<ApiBody<{ id: string }>>("/campaigns", body);
  return data.id;
}
