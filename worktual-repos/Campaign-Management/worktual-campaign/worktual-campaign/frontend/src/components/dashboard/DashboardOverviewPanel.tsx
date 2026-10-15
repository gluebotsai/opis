import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ChevronRight,
  Eye,
  Megaphone,
  MousePointerClick,
  Pause,
  Send,
  Settings2,
  Zap,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ContentFadeIn } from "@/components/skeleton";
import { DashboardSkeleton } from "@/pages/DashboardSkeleton";
import { DashboardCampaignMonitoringPreview } from "@/components/dashboard/DashboardCampaignMonitoringPreview";
import {
  formatOpenCount,
  formatPct,
  isOpenTrackedChannel,
  rangeHint,
  rangeLabel,
  type ChannelRollup,
  type DashboardDailyPoint,
  type PausedAlert,
  type PerformanceCustomRange,
  type PerformanceRange,
} from "@/lib/dashboard-metrics";
import type {
  ActiveLiveSendRow,
  CampaignListItem,
} from "@/services/campaigns.service";
import type { ConfigChannel } from "@/services/configuration.service";

export type DashboardKpis = {
  ranCount: number;
  liveCount: number;
  scheduledCount: number;
  completedCount: number;
  /** Ran campaigns with at least one delivery. */
  campaignsWithSend: number;
  /** Ran campaigns with send failures. */
  campaignsWithFailure: number;
  /** Message volume (ran campaigns only). */
  messagesSent: number;
  messagesFailed: number;
  sent: number;
  /** Unique email openers. */
  opens: number;
  /** Unique email clickers. */
  clicks: number;
  /** Hits including repeats. */
  totalOpens?: number;
  totalClicks?: number;
  /** Delivered on email — open-rate denominator. */
  trackedSent?: number;
  /** Delivered on email — click-rate denominator. */
  clickTrackedSent?: number;
  failed: number;
  stubSent: number;
  openRate: number | null;
  clickRate: number | null;
  ctor?: number | null;
};

type DashboardOverviewPanelProps = {
  loading: boolean;
  error: string | null;
  range: PerformanceRange;
  customRange?: PerformanceCustomRange | null;
  kpis: DashboardKpis;
  channelRollup: ChannelRollup[];
  dailyTrend: DashboardDailyPoint[];
  /** Messaging campaigns for monitoring preview (live → scheduled → past, capped in card). */
  monitoringCampaigns: CampaignListItem[];
  pausedAlerts: PausedAlert[];
  criticalConfig: ConfigChannel[];
  hasAttention: boolean;
  /** Show “Sample data” chip when Overview is synthetic. */
  synthetic?: boolean;
  /** Latest Hub / spoke on-demand activity for the dashboard card. */
  hubOnDemand?: {
    count: number;
    latest: {
      id: string;
      title: string;
      brief: string;
      createdAt: string;
    } | null;
  } | null;
  activeLiveSends?: ActiveLiveSendRow[];
  onOpenCampaignMonitoring?: () => void;
  onOpenHubOnDemand?: () => void;
  onOpenEventsTracking?: () => void;
  onSelectMonitoringCampaign?: (id: string) => void;
  onSelectEvent?: (id: string) => void;
};

export function DashboardOverviewPanel({
  loading,
  error,
  range,
  customRange = null,
  kpis,
  channelRollup,
  dailyTrend,
  monitoringCampaigns,
  pausedAlerts,
  criticalConfig,
  hasAttention,
  synthetic = false,
  hubOnDemand = null,
  activeLiveSends = [],
  onOpenCampaignMonitoring,
  onOpenHubOnDemand,
  onOpenEventsTracking,
  onSelectMonitoringCampaign,
  onSelectEvent,
}: DashboardOverviewPanelProps) {
  const periodName = rangeLabel(range, customRange);
  const periodHint = rangeHint(range, customRange);
  if (error) {
    return <p className="px-4 py-6 text-sm text-text-danger">{error}</p>;
  }

  if (loading) {
    return (
      <div className="px-4 py-4">
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <ContentFadeIn>
      <div className="@container/kpis w-full min-w-0 space-y-4 px-4 pt-4 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-neutral-500">
            Showing{" "}
            <span className="font-medium text-neutral-800">{kpis.ranCount}</span>{" "}
            campaign{kpis.ranCount === 1 ? "" : "s"} ran · {periodName}
            <span className="text-neutral-400">
              {" "}
              ({periodHint} · KPI cards = launched in period)
            </span>
          </p>
          {synthetic ? (
            <span className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              Sample data
            </span>
          ) : null}
        </div>

        {activeLiveSends.length > 0 ? (
          <section className="rounded-xl border-[0.6px] border-emerald-200 bg-emerald-50/60 p-4">
            <p className="text-sm font-semibold text-emerald-950">Live sends</p>
            <ul className="mt-2 space-y-2 text-sm text-emerald-900">
              {activeLiveSends.map((row) => (
                <li key={`${row.campaign_id}-${row.batch_id}`}>
                  <span className="font-medium">{row.campaign_name || row.campaign_id}</span>
                  {" · "}
                  {row.channel} · {row.batch_status}
                  {" · "}
                  {row.sent ?? 0} sent / {row.pending ?? 0} pending
                  {(row.failed ?? 0) > 0 ? ` · ${row.failed} failed` : ""}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {hasAttention ? (
          <section
            aria-label="Needs attention"
            className="space-y-3 rounded-xl border-[0.6px] border-amber-200 bg-amber-50/70 p-4 shadow-none"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
              <AlertTriangle className="size-[18px]" strokeWidth={2.25} />
              Needs your attention
            </div>

            {criticalConfig.map((ch) => (
              <Link
                key={ch.channel}
                to={`/configuration/${ch.channel}`}
                className="flex items-center justify-between gap-3 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 text-sm hover:bg-neutral-50"
              >
                <span className="flex items-center gap-2 text-amber-950">
                  <Settings2 className="size-[18px] shrink-0" strokeWidth={2.25} />
                  <span>
                    <span className="font-medium">{ch.label}</span> config
                    blocked
                  </span>
                </span>
                <span className="text-xs font-medium text-neutral-900">Fix</span>
              </Link>
            ))}

            {pausedAlerts.slice(0, 4).map((row) => {
              const body = (
                <>
                  <Pause className="mt-0.5 size-[14px] shrink-0 text-amber-700" strokeWidth={2.25} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-amber-950">
                      {row.campaignName}
                    </span>
                    <span className="text-amber-800">
                      {" "}
                      · {row.channel} paused
                    </span>
                    {row.reason ? (
                      <span className="mt-0.5 block truncate text-xs text-amber-700/90">
                        {row.reason}
                      </span>
                    ) : null}
                  </span>
                </>
              );
              if (synthetic || row.campaignId.startsWith("synth-")) {
                return (
                  <div
                    key={`${row.campaignId}-${row.channel}`}
                    className="flex items-start gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 text-sm"
                  >
                    {body}
                  </div>
                );
              }
              return (
                <Link
                  key={`${row.campaignId}-${row.channel}`}
                  to={`/campaigns/${row.campaignId}?from=dashboard`}
                  className="flex items-start gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 text-sm hover:bg-neutral-50"
                >
                  {body}
                </Link>
              );
            })}
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 @min-[28rem]/kpis:grid-cols-2 @min-[42rem]/kpis:grid-cols-3 @min-[72rem]/kpis:grid-cols-5">
          <KpiCard
            label="Campaigns ran"
            value={String(kpis.ranCount)}
            hint={`${kpis.liveCount} live · ${kpis.completedCount} completed · ${periodName}`}
            icon={Megaphone}
            tone="blue"
          />
          <KpiCard
            label="Delivered"
            value={kpis.messagesSent.toLocaleString()}
            hint={`${kpis.campaignsWithSend} campaigns with delivery · ${periodName}`}
            icon={Send}
            tone="green"
          />
          <KpiCard
            label="Failures"
            value={kpis.messagesFailed.toLocaleString()}
            hint={`${kpis.campaignsWithFailure} campaigns with failures · ${periodName}`}
            icon={XCircle}
            tone="red"
          />
          <KpiCard
            label="Open rate"
            value={formatPct(kpis.openRate)}
            hint={`${(kpis.opens ?? 0).toLocaleString()} unique opens · ${(
              kpis.trackedSent ?? 0
            ).toLocaleString()} email delivered`}
            icon={Eye}
            tone="orange"
          />
          <KpiCard
            label="Click rate"
            value={formatPct(kpis.clickRate)}
            hint={`${(kpis.clicks ?? 0).toLocaleString()} unique clickers · ${(
              kpis.clickTrackedSent ?? kpis.trackedSent ?? 0
            ).toLocaleString()} click-tracked delivered`}
            icon={MousePointerClick}
            tone="violet"
          />
        </section>

        <HubOnDemandCard
          hubOnDemand={hubOnDemand}
          onOpen={() => onOpenHubOnDemand?.()}
        />

        {channelRollup.length > 0 ? (
          <section
            aria-label="Delivered by channel"
            className="grid grid-cols-1 gap-3 @min-[28rem]/kpis:grid-cols-2 @min-[42rem]/kpis:grid-cols-3"
          >
            {channelRollup.map((row) => {
              const showOpens = isOpenTrackedChannel(row.key);
              return (
              <div
                key={row.key}
                className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-3 shadow-none"
              >
                <p className="text-sm font-bold capitalize text-neutral-900">
                  {row.label}
                  <span className="ml-1.5 text-sm font-normal normal-case text-neutral-500">
                    {row.campaigns} campaign
                    {row.campaigns === 1 ? "" : "s"}
                  </span>
                </p>
                <div
                  className={`mt-2 grid gap-3 ${showOpens ? "grid-cols-2" : "grid-cols-1"}`}
                >
                  <div>
                    <p className="text-sm font-semibold text-neutral-800">
                      Delivered
                    </p>
                    <p className="mt-0.5 text-[22px] font-bold tabular-nums text-neutral-900">
                      {row.sent.toLocaleString()}
                    </p>
                    {row.stubSent > 0 ? (
                      <p className="text-sm text-neutral-500">
                        + {row.stubSent.toLocaleString()} stub
                      </p>
                    ) : null}
                  </div>
                  {showOpens ? (
                  <div>
                    <p className="text-sm font-semibold text-neutral-800">
                      Opens
                    </p>
                    <p className="mt-0.5 text-[22px] font-bold tabular-nums text-neutral-900">
                      {formatOpenCount(row.key, row.opens)}
                    </p>
                  </div>
                  ) : null}
                </div>
              </div>
              );
            })}
          </section>
        ) : null}

        <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold capitalize text-neutral-900">
                Delivery trend
              </h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                Activity by day (IST) — sends, failures, email opens/clicks ·{" "}
                {periodName}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#3b82f6]" /> Delivered
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#f59e0b]" /> Opens
                (email)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#8b5cf6]" /> Clicks
                (email)
              </span>
            </div>
          </div>

          <div className="mt-4 h-64 w-full sm:h-72">
            {dailyTrend.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-lg border-[0.6px] border-dashed border-[#bfbfbf] text-sm text-neutral-500">
                No daily activity for {periodName.toLowerCase()}.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={dailyTrend}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="dashSentFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#bfdbfe" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#bfdbfe" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="dashOpensFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="dashClicksFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#858f96"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: "#212121" }}
                    tickLine={false}
                    axisLine={{ stroke: "#909090", strokeWidth: 0.6 }}
                    interval="preserveStartEnd"
                    minTickGap={28}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "#212121" }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "none",
                      background: "#171717",
                      color: "#fff",
                      fontSize: 12,
                      boxShadow: "none",
                    }}
                    itemStyle={{ color: "#fff" }}
                    labelStyle={{ color: "#fff", fontWeight: 600 }}
                    formatter={(value: number | string, name: string) => [
                      typeof value === "number"
                        ? value.toLocaleString()
                        : value,
                      name === "sent"
                        ? "Delivered"
                        : name === "opens"
                          ? "Opens (email pixel)"
                          : name === "clicks"
                            ? "Clicks (tracked)"
                            : name,
                    ]}
                    labelFormatter={(label) => String(label)}
                  />
                  <Area
                    type="monotone"
                    dataKey="sent"
                    name="sent"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#dashSentFill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="opens"
                    name="opens"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#dashOpensFill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="clicks"
                    name="clicks"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    fill="url(#dashClicksFill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <DashboardCampaignMonitoringPreview
          campaigns={monitoringCampaigns}
          liveCount={kpis.liveCount}
          scheduledCount={kpis.scheduledCount}
          completedCount={kpis.completedCount}
          onViewAll={() => onOpenCampaignMonitoring?.()}
          onSelectCampaign={
            onSelectMonitoringCampaign ||
            (onOpenCampaignMonitoring
              ? () => onOpenCampaignMonitoring()
              : undefined)
          }
        />
      </div>
    </ContentFadeIn>
  );
}

function HubOnDemandCard({
  hubOnDemand,
  onOpen,
}: {
  hubOnDemand: DashboardOverviewPanelProps["hubOnDemand"];
  onOpen?: () => void;
}) {
  const count = hubOnDemand?.count ?? 0;
  const latest = hubOnDemand?.latest ?? null;
  const brief =
    latest?.brief ||
    (count > 0
      ? `${count} on-demand run${count === 1 ? "" : "s"} from Hub.`
      : "No Hub on-demand runs yet. When Hub triggers a send, it will show here.");

  return (
    <section aria-label="Hub on-demand activity">
      <button
        type="button"
        onClick={() => onOpen?.()}
        className="group flex w-full items-start gap-3 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 text-left shadow-none transition-colors hover:bg-neutral-50"
      >
        <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-[#111111] text-white">
          <Zap className="size-[18px]" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold capitalize text-neutral-900">
              Hub on-demand
            </h2>
            {count > 0 ? (
              <span className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                {count} run{count === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-snug text-neutral-700">{brief}</p>
          <p className="mt-2 text-[11px] font-medium text-neutral-500 group-hover:text-neutral-900">
            {latest
              ? "Open on-demand monitor →"
              : "View on-demand monitor →"}
          </p>
        </div>
        <ChevronRight
          className="mt-1 size-[18px] shrink-0 text-neutral-400 group-hover:text-neutral-700"
          strokeWidth={2.25}
        />
      </button>
    </section>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Megaphone;
  tone: "blue" | "green" | "orange" | "violet" | "red";
}) {
  const toneClass = {
    blue: "bg-blue-100 text-blue-600",
    green: "bg-emerald-100 text-emerald-600",
    orange: "bg-amber-100 text-amber-600",
    violet: "bg-violet-100 text-violet-600",
    red: "bg-rose-100 text-rose-600",
  }[tone];

  return (
    <div className="flex min-h-[136px] min-w-0 flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4 shadow-none">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold leading-5 text-neutral-800">
          {label}
        </p>
        <span
          className={`inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl ${toneClass}`}
        >
          <Icon className="size-[18px]" strokeWidth={2.25} />
        </span>
      </div>
      <p className="mt-2 text-[22px] font-bold tabular-nums tracking-tight text-neutral-900">
        {value}
      </p>
      <p className="mt-1 text-sm leading-5 text-neutral-500">{hint}</p>
    </div>
  );
}
