import type {
  CampaignChannelDetail,
  CampaignDetail,
} from "@/services/campaigns.service";

export type DeliverySegment = {
  key: "sent" | "failed" | "bounced" | "pending";
  label: string;
  value: number;
  color: string;
  barClass: string;
};

export type DeliveryMetrics = {
  selected: number;
  sent: number;
  failed: number;
  bounced: number;
  pending: number;
  stubSent: number;
  segments: DeliverySegment[];
  total: number;
  hasActivity: boolean;
};

export type EmailEngagementMetrics = {
  hasEmail: boolean;
  emailSent: number;
  /** Rate denominator: messages accepted by the provider. */
  delivered: number;
  /** Unique openers / clickers. */
  opens: number;
  clicks: number;
  /** Hits including repeats — shown as context, never as a rate. */
  totalOpens: number;
  totalClicks: number;
  openRate: number | null;
  clickRate: number | null;
  /** Click-to-open rate: unique clicks / unique opens. */
  ctor: number | null;
};

export type PpcPerformanceMetrics = {
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  currency: string | null;
  bars: { name: string; value: number; color: string }[];
};

export type CampaignPerformanceMetrics = {
  delivery: DeliveryMetrics;
  email: EmailEngagementMetrics;
  ppc: PpcPerformanceMetrics | null;
};

type ChannelLike = Pick<
  CampaignChannelDetail,
  | "channel"
  | "selected"
  | "totalToSend"
  | "sent"
  | "failed"
  | "bounced"
  | "delivered"
  | "stubSent"
  | "opens"
  | "clicks"
  | "totalOpens"
  | "totalClicks"
  | "openRate"
  | "clickRate"
  | "ctor"
  | "impressions"
  | "spend"
  | "conversions"
  | "currency"
>;

function sumChannels<T>(
  channels: ChannelLike[],
  pick: (ch: ChannelLike) => T,
  add: (a: T, b: T) => T,
  zero: T,
): T {
  return channels.reduce((acc, ch) => add(acc, pick(ch)), zero);
}

export function computeCampaignPerformanceMetrics(
  channels: ChannelLike[],
  opts?: {
    emailOpens?: number;
    emailClicks?: number;
    emailSent?: number;
    totalOpens?: number;
    totalClicks?: number;
    delivered?: number;
    openRate?: number | null;
    clickRate?: number | null;
    ctor?: number | null;
  },
): CampaignPerformanceMetrics {
  const selected = sumChannels(
    channels,
    (ch) => ch.selected || ch.totalToSend || 0,
    (a, b) => a + b,
    0,
  );
  const sent = sumChannels(channels, (ch) => ch.sent || 0, (a, b) => a + b, 0);
  const failed = sumChannels(
    channels,
    (ch) => ch.failed || 0,
    (a, b) => a + b,
    0,
  );
  const bounced = sumChannels(
    channels,
    (ch) => ch.bounced || 0,
    (a, b) => a + b,
    0,
  );
  const stubSent = sumChannels(
    channels,
    (ch) => ch.stubSent || 0,
    (a, b) => a + b,
    0,
  );
  const pending = Math.max(0, selected - sent - failed - bounced);

  const segmentDefs: Omit<DeliverySegment, "value">[] = [
    {
      key: "sent",
      label: "Sent",
      color: "#16a34a",
      barClass: "bg-emerald-500",
    },
    {
      key: "failed",
      label: "Failed",
      color: "#dc2626",
      barClass: "bg-red-500",
    },
    {
      key: "bounced",
      label: "Bounced",
      color: "#f97316",
      barClass: "bg-orange-500",
    },
    {
      key: "pending",
      label: "Pending",
      color: "#a3a3a3",
      barClass: "bg-neutral-300",
    },
  ];
  const values: Record<DeliverySegment["key"], number> = {
    sent,
    failed,
    bounced,
    pending,
  };
  const segments = segmentDefs
    .map((def) => ({ ...def, value: values[def.key] }))
    .filter((s) => s.value > 0);
  const total = Math.max(
    selected,
    sent + failed + bounced + pending,
    segments.reduce((n, s) => n + s.value, 0),
    0,
  );

  const emailChannel = channels.find(
    (ch) => ch.channel.toLowerCase() === "email",
  );
  const hasEmail = Boolean(emailChannel);
  const emailSent =
    opts?.emailSent ?? emailChannel?.sent ?? (hasEmail ? sent : 0);
  const opens =
    opts?.emailOpens ??
    emailChannel?.opens ??
    channels.reduce((n, ch) => n + (ch.opens || 0), 0);
  const clicks =
    opts?.emailClicks ??
    emailChannel?.clicks ??
    channels.reduce((n, ch) => n + (ch.clicks || 0), 0);
  const totalOpens =
    opts?.totalOpens ??
    emailChannel?.totalOpens ??
    channels.reduce((n, ch) => n + (ch.totalOpens || 0), 0);
  const totalClicks =
    opts?.totalClicks ??
    emailChannel?.totalClicks ??
    channels.reduce((n, ch) => n + (ch.totalClicks || 0), 0);
  const delivered = opts?.delivered ?? emailChannel?.delivered ?? emailSent;
  /** Unique numerator over delivered — matches ESP reporting, never exceeds 100%. */
  const rate = (num: number, den: number) =>
    den > 0 ? Math.min(1, num / den) : null;
  const openRate =
    opts?.openRate ?? emailChannel?.openRate ?? rate(opens, delivered);
  const clickRate =
    opts?.clickRate ?? emailChannel?.clickRate ?? rate(clicks, delivered);
  const ctor = opts?.ctor ?? emailChannel?.ctor ?? rate(clicks, opens);

  const hasPpc = channels.some((c) => c.channel.toLowerCase() === "ppc");
  const impressions = sumChannels(
    channels,
    (ch) => ch.impressions || 0,
    (a, b) => a + b,
    0,
  );
  const spend = sumChannels(channels, (ch) => ch.spend || 0, (a, b) => a + b, 0);
  const conversions = sumChannels(
    channels,
    (ch) => ch.conversions || 0,
    (a, b) => a + b,
    0,
  );
  const ppcClicks = sumChannels(
    channels,
    (ch) => ch.clicks || 0,
    (a, b) => a + b,
    0,
  );
  const currency =
    channels.find((c) => c.currency)?.currency ??
    emailChannel?.currency ??
    null;

  const ppc =
    hasPpc && (impressions > 0 || spend > 0)
      ? {
          impressions,
          clicks: ppcClicks,
          conversions,
          spend,
          currency,
          bars: [
            { name: "Impressions", value: impressions, color: "#0ea5e9" },
            { name: "Clicks", value: ppcClicks, color: "#7c3aed" },
            { name: "Conversions", value: conversions, color: "#16a34a" },
          ].filter((d) => d.value > 0),
        }
      : null;

  return {
    delivery: {
      selected,
      sent,
      failed,
      bounced,
      pending,
      stubSent,
      segments,
      total,
      hasActivity: total > 0 || stubSent > 0,
    },
    email: {
      hasEmail,
      emailSent,
      delivered,
      opens,
      clicks,
      totalOpens: Math.max(totalOpens, opens),
      totalClicks: Math.max(totalClicks, clicks),
      openRate,
      clickRate,
      ctor,
    },
    ppc,
  };
}

export function computeCampaignPerformanceFromDetail(
  campaign: CampaignDetail,
): CampaignPerformanceMetrics {
  return computeCampaignPerformanceMetrics(campaign.channels, {
    emailOpens: campaign.emailOpens,
    emailClicks: campaign.emailClicks,
    emailSent: campaign.emailSent,
    totalOpens: campaign.totalOpens,
    totalClicks: campaign.totalClicks,
    delivered: campaign.delivered,
    openRate: campaign.openRate,
    clickRate: campaign.clickRate,
    ctor: campaign.ctor,
  });
}

export function formatPerformancePct(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}
