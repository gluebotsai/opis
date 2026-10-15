import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Globe,
  Mail,
  Megaphone,
  MessageCircle,
  Radio,
  Smartphone,
  Users,
} from "lucide-react";
import {
  formatCampaignScheduleDate,
  type MonitoringTab,
} from "@/lib/campaign-monitoring-summary";
import {
  isClickTrackedChannel,
  isOpenTrackedChannel,
  rollupKey,
} from "@/lib/dashboard-metrics";
import type { CampaignListItem } from "@/services/campaigns.service";

export const DASHBOARD_PREVIEW_LIMIT = 5;

function statusTab(status: string): MonitoringTab {
  const s = String(status || "").toLowerCase();
  if (s === "live") return "live";
  if (s === "scheduled") return "scheduled";
  return "past";
}

function statusLabel(status: string): string {
  const s = String(status || "").toLowerCase();
  if (s === "live") return "Running";
  if (s === "scheduled") return "Scheduled";
  if (s === "completed") return "Completed";
  return s || "—";
}

function statusChipClass(status: string): string {
  const s = String(status || "").toLowerCase();
  if (s === "live") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (s === "scheduled") {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  return "border-[#bfbfbf] bg-neutral-50 text-neutral-700";
}

function channelKey(channel: string): string {
  return String(channel || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function channelWord(channel: string): string {
  const k = channelKey(channel);
  if (k === "push" || k === "app_push" || k === "apppush") return "App push";
  if (k === "web" || k === "web_push" || k === "webpush") return "Web push";
  if (k === "ppc") return "PPC";
  if (!k) return "—";
  return k.charAt(0).toUpperCase() + k.slice(1);
}

function channelLabel(channels: string[] | undefined): string {
  if (!channels?.length) return "—";
  return channels.map((c) => channelWord(c)).join(" + ");
}

function primaryChannel(channels: string[] | undefined): string {
  return channels?.[0] || "";
}

function ChannelMark({ channel }: { channel: string }) {
  const k = channelKey(channel);
  const Icon =
    k === "email"
      ? Mail
      : k === "whatsapp"
        ? MessageCircle
        : k === "sms"
          ? Smartphone
          : k === "web" || k === "web_push" || k === "webpush"
            ? Globe
            : k === "push" || k === "app_push" || k === "apppush"
              ? Bell
              : Megaphone;
  const tone =
    k === "email"
      ? "bg-blue-50 text-blue-700"
      : k === "whatsapp"
        ? "bg-emerald-50 text-emerald-700"
        : k === "sms"
          ? "bg-sky-50 text-sky-700"
          : k === "web" || k === "web_push" || k === "webpush"
            ? "bg-violet-50 text-violet-700"
            : k === "push" || k === "app_push" || k === "apppush"
              ? "bg-orange-50 text-orange-700"
              : "bg-neutral-100 text-neutral-800";
  return (
    <span
      className={`inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl ${tone}`}
    >
      <Icon className="size-[18px]" strokeWidth={2.25} />
    </span>
  );
}

function relativeFrom(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(abs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function whenLabel(row: CampaignListItem): string {
  const tab = statusTab(row.status);
  if (tab === "scheduled") {
    return formatCampaignScheduleDate(row);
  }
  if (tab === "past" && row.endsAt) {
    return `Completed ${relativeFrom(row.endsAt)}`;
  }
  if (row.startsAt) {
    return `Started ${relativeFrom(row.startsAt)}`;
  }
  return formatCampaignScheduleDate(row);
}

type PreviewMetrics = {
  targeted: number;
  delivered: number;
  opens: number | null;
  clicks: number | null;
};

function previewMetrics(row: CampaignListItem): PreviewMetrics {
  const channels =
    row.channelMetrics && row.channelMetrics.length
      ? row.channelMetrics
      : (row.channels || []).map((channel) => ({
          channel,
          selected: row.audienceCount ?? 0,
          sent: row.sent ?? 0,
          opens: row.opens ?? 0,
          clicks: row.clicks ?? 0,
        }));

  let targeted = 0;
  let delivered = 0;
  let opens = 0;
  let clicks = 0;
  let hasOpen = false;
  let hasClick = false;

  for (const ch of channels) {
    const key = rollupKey(String(ch.channel || "")) || String(ch.channel || "");
    targeted += ch.selected ?? 0;
    delivered += ch.delivered ?? ch.sent ?? 0;
    if (isOpenTrackedChannel(key)) {
      hasOpen = true;
      opens += ch.opens ?? 0;
    }
    if (isClickTrackedChannel(key)) {
      hasClick = true;
      clicks += ch.clicks ?? 0;
    }
  }

  if (!channels.length) {
    return {
      targeted: row.audienceCount ?? 0,
      delivered: row.delivered ?? row.sent ?? 0,
      opens: row.opens ?? null,
      clicks: row.clicks ?? null,
    };
  }

  return {
    targeted: targeted || row.audienceCount || 0,
    delivered,
    opens: hasOpen ? opens : null,
    clicks: hasClick ? clicks : null,
  };
}

function CompactMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-[4.5rem] shrink-0">
      <p className="whitespace-nowrap text-[11px] font-medium text-neutral-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-neutral-900">
        {value}
      </p>
    </div>
  );
}

export function pickDashboardCampaignPreview(
  rows: CampaignListItem[],
  limit = DASHBOARD_PREVIEW_LIMIT,
): CampaignListItem[] {
  const live: CampaignListItem[] = [];
  const scheduled: CampaignListItem[] = [];
  const past: CampaignListItem[] = [];
  for (const row of rows) {
    const s = String(row.status || "").toLowerCase();
    if (s === "live") live.push(row);
    else if (s === "scheduled") scheduled.push(row);
    else past.push(row);
  }
  return [...live, ...scheduled, ...past].slice(0, limit);
}

type Props = {
  campaigns: CampaignListItem[];
  liveCount: number;
  scheduledCount: number;
  completedCount: number;
  onViewAll: () => void;
  onSelectCampaign?: (id: string) => void;
};

/**
 * Overview right-panel preview — max 5 campaigns; View all opens in-dashboard monitoring.
 */
export function DashboardCampaignMonitoringPreview({
  campaigns,
  liveCount,
  scheduledCount,
  completedCount,
  onViewAll,
  onSelectCampaign,
}: Props) {
  const preview = pickDashboardCampaignPreview(campaigns);

  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold capitalize text-neutral-900">
            Campaign monitoring
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-medium text-neutral-600">
            <span className="inline-flex items-center gap-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2 py-0.5">
              <Radio className="size-3 text-emerald-600" strokeWidth={2.25} />
              {liveCount} Live
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2 py-0.5">
              <Clock3 className="size-3 text-blue-600" strokeWidth={2.25} />
              {scheduledCount} Scheduled
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2 py-0.5">
              <CheckCircle2
                className="size-3 text-neutral-500"
                strokeWidth={2.25}
              />
              {completedCount} Completed
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="shrink-0 text-xs font-medium text-neutral-900 hover:underline"
        >
          View all →
        </button>
      </div>

      {preview.length === 0 ? (
        <p className="mt-4 py-8 text-center text-sm text-neutral-500">
          No campaigns to monitor yet.
        </p>
      ) : (
        <div className="dashboard-x-scroll mt-4 max-w-full overflow-x-auto overflow-y-hidden pb-1">
          <ul className="w-max min-w-full divide-y divide-neutral-200 border-t border-neutral-200">
            {preview.map((row) => {
              const tab = statusTab(row.status);
              const status = String(row.status || "");
              const metrics = previewMetrics(row);
              const showMetrics = tab !== "scheduled";
              const channels = row.channels?.length
                ? row.channels
                : row.channelMetrics?.map((c) => c.channel);
              const subtitle = (row.description || "").trim();
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectCampaign
                        ? onSelectCampaign(row.id)
                        : onViewAll()
                    }
                    className="flex w-[52rem] max-w-none shrink-0 items-center gap-3 py-3 text-left transition-colors hover:bg-neutral-50"
                  >
                    <ChannelMark channel={primaryChannel(channels)} />
                    <div className="w-44 shrink-0">
                      <p className="truncate text-sm font-semibold text-neutral-900">
                        {row.name}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-neutral-500">
                        {channelLabel(channels)}
                      </p>
                      {subtitle ? (
                        <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                          {subtitle}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 rounded-lg border-[0.6px] px-2 py-0.5 text-[11px] font-medium ${statusChipClass(status)}`}
                    >
                      {statusLabel(status)}
                    </span>
                    {showMetrics ? (
                      <div className="flex shrink-0 items-center gap-5">
                        <CompactMetric
                          label="Targeted"
                          value={metrics.targeted.toLocaleString()}
                        />
                        <CompactMetric
                          label="Delivered"
                          value={metrics.delivered.toLocaleString()}
                        />
                        <CompactMetric
                          label="Opened"
                          value={
                            metrics.opens == null
                              ? "—"
                              : metrics.opens.toLocaleString()
                          }
                        />
                        <CompactMetric
                          label="Clicked"
                          value={
                            metrics.clicks == null
                              ? "—"
                              : metrics.clicks.toLocaleString()
                          }
                        />
                      </div>
                    ) : (
                      <div className="w-[18.5rem] shrink-0" />
                    )}
                    <div className="ml-auto w-44 shrink-0 text-right text-[11px] leading-4 text-neutral-400">
                      <p className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {tab === "scheduled" ? (
                          <CalendarDays
                            className="size-3 shrink-0"
                            strokeWidth={2.25}
                          />
                        ) : (
                          <Clock3
                            className="size-3 shrink-0"
                            strokeWidth={2.25}
                          />
                        )}
                        {whenLabel(row)}
                      </p>
                      <p className="mt-0.5 flex items-center justify-end gap-1 whitespace-nowrap">
                        <Users className="size-3 shrink-0" strokeWidth={2.25} />
                        Audience:{" "}
                        {(
                          row.audienceCount ?? metrics.targeted
                        ).toLocaleString()}
                      </p>
                    </div>
                    <ChevronRight
                      className="size-[18px] shrink-0 text-neutral-400"
                      strokeWidth={2.25}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
