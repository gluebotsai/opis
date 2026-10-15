import type { CampaignListItem } from "@/services/campaigns.service";

export type MonitoringTab = "live" | "scheduled" | "past" | "on-demand" | "personalised-crm";

/** Readable date/time for monitoring lists (browser locale, no raw ISO). */
export function formatMonitoringDateTime(
  value: string | Date | null | undefined,
): string {
  if (value == null || value === "") return "—";
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

export function formatCampaignScheduleDate(
  row: Pick<
    CampaignListItem,
    "startsAt" | "launchLocalDate" | "launchLocalTime"
  >,
): string {
  if (row.launchLocalDate) {
    const time = row.launchLocalTime ? ` ${row.launchLocalTime}` : "";
    return `${row.launchLocalDate}${time}`;
  }
  if (row.startsAt) return new Date(row.startsAt).toLocaleString();
  return "—";
}

export type ChannelMetricSlice = {
  channel: string;
  selected?: number;
  sent?: number;
  failed?: number;
  bounced?: number;
  opens?: number;
  clicks?: number;
};

function monitorChannelLabel(channel: string): string {
  const c = channel.toLowerCase();
  if (c === "push" || c === "app_push" || c === "apppush") return "App push";
  if (c === "web" || c === "web_push" || c === "webpush") return "Web push";
  if (c === "ppc") return "PPC";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function fmt(n: number | undefined): string {
  return (n ?? 0).toLocaleString();
}

function channelKeys(row: CampaignListItem): string[] {
  const fromMetrics = (row.channelMetrics || []).map((c) => c.channel);
  const fromList = row.channels || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...fromMetrics, ...fromList]) {
    const key = String(raw || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function metricFor(row: CampaignListItem, channel: string): ChannelMetricSlice {
  const hit = row.channelMetrics?.find(
    (c) => c.channel.toLowerCase() === channel.toLowerCase(),
  );
  if (hit) return hit;
  return { channel, selected: row.audienceCount ?? 0 };
}

function formatDeliveryChannelLine(ch: ChannelMetricSlice): string {
  const label = monitorChannelLabel(ch.channel);
  const key = ch.channel.toLowerCase();
  const isEmail = key === "email";
  const isPushClick =
    key === "push" ||
    key === "app_push" ||
    key === "apppush" ||
    key === "web" ||
    key === "web_push" ||
    key === "webpush";
  if (isEmail) {
    return `${label}: ${fmt(ch.selected)} sel · ${fmt(ch.sent)} sent · ${fmt(ch.bounced)} bounced · ${fmt(ch.opens)} open · ${fmt(ch.clicks)} click`;
  }
  if (isPushClick) {
    return `${label}: ${fmt(ch.selected)} sel · ${fmt(ch.sent)} sent · ${fmt(ch.failed)} failed · ${fmt(ch.clicks)} click`;
  }
  return `${label}: ${fmt(ch.selected)} sel · ${fmt(ch.sent)} sent · ${fmt(ch.failed)} failed`;
}

function formatScheduledSummary(row: CampaignListItem): string {
  const keys = channelKeys(row);
  const labels = keys.map(monitorChannelLabel);
  const audience = row.audienceCount ?? 0;
  const schedule = formatCampaignScheduleDate(row);
  const channelPart =
    labels.length > 0 ? labels.join(" · ") : "No channels";
  const audiencePart =
    audience > 0 ? `${audience.toLocaleString()} audience` : "Audience pending";
  return `${channelPart} · ${audiencePart} · Runs ${schedule}`;
}

/**
 * Tab-aware one-line summary for campaign monitoring list rows.
 */
export function formatCampaignMonitoringSummary(
  row: CampaignListItem,
  tab: MonitoringTab,
): string {
  if (tab === "scheduled") {
    return formatScheduledSummary(row);
  }

  const keys = channelKeys(row);
  if (!keys.length) {
    if (tab === "live" || tab === "past") {
      const audience = row.audienceCount ?? 0;
      if (audience > 0) {
        return `${audience.toLocaleString()} selected · awaiting channel metrics`;
      }
    }
    return "No channel metrics yet";
  }

  const lines = keys
    .map((key) => formatDeliveryChannelLine(metricFor(row, key)))
    .filter(Boolean);

  if (lines.length <= 2) return lines.join(" · ");
  return `${lines.slice(0, 2).join(" · ")} · +${lines.length - 2} more`;
}

export function formatCampaignMonitoringSummaryTitle(
  row: CampaignListItem,
  tab: MonitoringTab,
): string {
  if (tab === "scheduled") return formatScheduledSummary(row);
  const keys = channelKeys(row);
  return keys
    .map((key) => formatDeliveryChannelLine(metricFor(row, key)))
    .join(" · ");
}

/** Detail / performance pane — per-channel metric line. */
export function formatMonitorChannelMetricsLine(ch: {
  channel: string;
  selected?: number;
  totalToSend?: number;
  sent?: number;
  failed?: number;
  bounced?: number;
  opens?: number;
  clicks?: number;
  totalOpens?: number;
  totalClicks?: number;
  openRate?: number | null;
  clickRate?: number | null;
  ctor?: number | null;
  stubSent?: number;
  fromLiveSends?: boolean;
  paused?: boolean;
  status?: string;
}): string {
  const isScheduled =
    String(ch.status || "").toLowerCase() === "scheduled";
  const selected = ch.selected ?? ch.totalToSend ?? 0;
  const key = ch.channel.toLowerCase();
  const isEmail = key === "email";
  const isPushClick =
    key === "push" ||
    key === "app_push" ||
    key === "apppush" ||
    key === "web" ||
    key === "web_push" ||
    key === "webpush";

  if (isScheduled) {
    return `Selected ${fmt(selected)} · Scheduled to send`;
  }

  const stub =
    (ch.stubSent || 0) > 0 ? ` · Stub ${fmt(ch.stubSent)} (not delivered)` : "";
  const pct = (rate: number | null | undefined) =>
    rate != null ? ` (${(rate * 100).toFixed(1)}%)` : "";

  if (isEmail) {
    const opens = ch.opens ?? 0;
    const clicks = ch.clicks ?? 0;
    const repeats =
      (ch.totalOpens ?? opens) > opens || (ch.totalClicks ?? clicks) > clicks
        ? ` · Repeat hits ${fmt(ch.totalOpens ?? opens)} open / ${fmt(ch.totalClicks ?? clicks)} click`
        : "";
    return (
      `Selected ${fmt(selected)} · Sent ${fmt(ch.sent)} · Bounced ${fmt(ch.bounced)}` +
      ` · Unique opens ${fmt(opens)}${pct(ch.openRate)}` +
      ` · Unique clicks ${fmt(clicks)}${pct(ch.clickRate)}` +
      (ch.ctor != null ? ` · CTOR ${(ch.ctor * 100).toFixed(1)}%` : "") +
      repeats +
      stub +
      (ch.fromLiveSends ? " · live sends" : "") +
      (ch.paused ? " · Paused" : "")
    );
  }

  if (isPushClick) {
    const clicks = ch.clicks ?? 0;
    return (
      `Selected ${fmt(selected)} · Sent ${fmt(ch.sent)} · Failed ${fmt(ch.failed)}` +
      ` · Unique clicks ${fmt(clicks)}${pct(ch.clickRate)}` +
      stub +
      (ch.fromLiveSends ? " · live sends" : "") +
      (ch.paused ? " · Paused" : "")
    );
  }

  return (
    `Selected ${fmt(selected)} · Sent ${fmt(ch.sent)} · Failed ${fmt(ch.failed)}` +
    stub +
    (ch.fromLiveSends ? " · live sends" : "") +
    (ch.paused ? " · Paused" : "")
  );
}
