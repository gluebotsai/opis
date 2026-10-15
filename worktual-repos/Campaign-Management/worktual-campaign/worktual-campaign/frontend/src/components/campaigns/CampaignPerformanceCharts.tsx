import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  computeCampaignPerformanceFromDetail,
  computeCampaignPerformanceMetrics,
  formatPerformancePct,
  type CampaignPerformanceMetrics,
} from "@/lib/campaign-performance-metrics";
import type {
  CampaignChannelDetail,
  CampaignDetail,
} from "@/services/campaigns.service";

type Props = {
  channels: CampaignChannelDetail[];
  campaign?: Pick<
    CampaignDetail,
    | "emailOpens"
    | "emailClicks"
    | "emailSent"
    | "delivered"
    | "totalOpens"
    | "totalClicks"
    | "openRate"
    | "clickRate"
    | "ctor"
  >;
  compact?: boolean;
};

function RateGauge({
  label,
  rate,
  countLabel,
  subLabel,
  accentClass,
  trackClass,
}: {
  label: string;
  rate: number | null;
  countLabel: string;
  subLabel?: string;
  accentClass: string;
  trackClass: string;
}) {
  const pct = rate != null ? Math.min(100, Math.max(0, rate * 100)) : 0;
  const arcLength = 125.66;
  const dash = (pct / 100) * arcLength;

  return (
    <div className="rounded-xl border border-border-default bg-surface p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-caption">
        {label}
      </p>
      <div className="relative mx-auto mt-1 h-24 w-full max-w-[160px]">
        <svg viewBox="0 0 100 56" className="h-full w-full" aria-hidden>
          <path
            d="M 8 48 A 42 42 0 0 1 92 48"
            fill="none"
            className={trackClass}
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path
            d="M 8 48 A 42 42 0 0 1 92 48"
            fill="none"
            className={accentClass}
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${arcLength}`}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-1 text-center">
          <p className="text-xl font-semibold tabular-nums text-text-primary">
            {formatPerformancePct(rate)}
          </p>
        </div>
      </div>
      <p className="mt-1 text-center text-xs text-text-caption">{countLabel}</p>
      {subLabel ? (
        <p className="mt-0.5 text-center text-[11px] text-text-caption">
          {subLabel}
        </p>
      ) : null}
    </div>
  );
}

function DeliveryBar({ metrics }: { metrics: CampaignPerformanceMetrics["delivery"] }) {
  if (!metrics.hasActivity) {
    return (
      <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border-default text-xs text-text-caption">
        No delivery activity yet
      </div>
    );
  }

  const total = Math.max(metrics.total, 1);

  return (
    <div>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100"
        role="img"
        aria-label="Delivery breakdown"
      >
        {metrics.segments.map((segment) => (
          <div
            key={segment.key}
            className={`${segment.barClass} h-full transition-[width]`}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.value.toLocaleString()}`}
          />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        {(
          [
            ["Selected", metrics.selected],
            ["Sent", metrics.sent],
            ["Failed", metrics.failed],
            ["Bounced", metrics.bounced],
            ["Pending", metrics.pending],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-text-caption">{label}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-text-primary">
              {value.toLocaleString()}
            </dd>
          </div>
        ))}
      </dl>
      {metrics.stubSent > 0 ? (
        <p className="mt-2 text-[11px] text-text-caption">
          + {metrics.stubSent.toLocaleString()} stub (not inbox delivery)
        </p>
      ) : null}
    </div>
  );
}

function PpcBars({ ppc }: { ppc: NonNullable<CampaignPerformanceMetrics["ppc"]> }) {
  if (!ppc.bars.length) {
    return (
      <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border-default text-xs text-text-caption">
        No PPC activity yet
      </div>
    );
  }

  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={ppc.bars} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={36} />
          <Tooltip />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {ppc.bars.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CampaignPerformanceCharts({
  channels,
  campaign,
  compact = false,
}: Props) {
  const metrics = useMemo(
    () =>
      campaign
        ? computeCampaignPerformanceFromDetail({
            channels,
            ...campaign,
          } as CampaignDetail)
        : computeCampaignPerformanceMetrics(channels),
    [channels, campaign],
  );

  const delivered = metrics.email.delivered || metrics.email.emailSent;
  const showEmailEngagement = metrics.email.hasEmail && delivered > 0;
  const showPpc = Boolean(metrics.ppc);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-text-caption">
          Delivery
        </p>
        <p className="mt-0.5 text-[11px] text-text-caption">
          Sent, failed, bounced, and pending across all channels
        </p>
        <div className="mt-2">
          <DeliveryBar metrics={metrics.delivery} />
        </div>
      </section>

      {showPpc ? (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-caption">
            PPC performance
          </p>
          <div className="mt-2">
            <PpcBars ppc={metrics.ppc!} />
          </div>
        </section>
      ) : null}

      {showEmailEngagement ? (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-caption">
            Email engagement
          </p>
          <p className="mt-0.5 text-[11px] text-text-caption">
            Unique openers and clickers as a share of delivered email
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <RateGauge
              label="Open rate"
              rate={metrics.email.openRate}
              countLabel={`${metrics.email.opens.toLocaleString()} unique of ${delivered.toLocaleString()} delivered`}
              subLabel={
                metrics.email.totalOpens > metrics.email.opens
                  ? `${metrics.email.totalOpens.toLocaleString()} opens incl. repeats`
                  : undefined
              }
              accentClass="text-blue-600"
              trackClass="text-blue-100"
            />
            <RateGauge
              label="Click rate"
              rate={metrics.email.clickRate}
              countLabel={`${metrics.email.clicks.toLocaleString()} unique of ${delivered.toLocaleString()} delivered`}
              subLabel={
                metrics.email.totalClicks > metrics.email.clicks
                  ? `${metrics.email.totalClicks.toLocaleString()} clicks incl. repeats`
                  : undefined
              }
              accentClass="text-violet-600"
              trackClass="text-violet-100"
            />
          </div>
          <p className="mt-2 text-[11px] text-text-caption">
            Click-to-open rate{" "}
            <span className="font-semibold tabular-nums text-text-primary">
              {formatPerformancePct(metrics.email.ctor)}
            </span>{" "}
            — how many openers went on to click.
          </p>
        </section>
      ) : metrics.email.hasEmail ? (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-caption">
            Email engagement
          </p>
          <p className="mt-2 rounded-lg border border-dashed border-border-default px-3 py-4 text-xs text-text-caption">
            No emails sent yet — rates appear after delivery
          </p>
        </section>
      ) : null}
    </div>
  );
}
