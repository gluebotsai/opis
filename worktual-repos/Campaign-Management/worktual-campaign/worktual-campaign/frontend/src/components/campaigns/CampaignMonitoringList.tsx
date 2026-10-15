import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { ContentFadeIn } from "@/components/skeleton";
import { useLoadOnce } from "@/hooks/useLoadOnce";
import {
  fetchCampaigns,
  fetchDashboard,
  type CampaignBucket,
  type CampaignListItem,
  type DashboardCounts,
} from "@/services/campaigns.service";
import { CampaignsPageSkeleton } from "@/pages/CampaignsPageSkeleton";
import {
  DEFAULT_PACK_ID,
  getActivePackId,
  subscribeActivePack,
} from "@/lib/industry-packs";
import {
  formatCampaignMonitoringSummary,
  formatCampaignMonitoringSummaryTitle,
  formatCampaignScheduleDate,
  type MonitoringTab,
} from "@/lib/campaign-monitoring-summary";
import { MonitorBucketTabs } from "@/components/campaigns/MonitorBucketTabs";
import {
  formatOnDemandDisplayTitle,
  formatOnDemandListMeta,
  formatOnDemandListSummary,
  mapApiRunToOnDemandRun,
  type OnDemandRun,
} from "@/lib/on-demand-sends-mock";
import { listOnDemandRunsApi } from "@/services/on-demand.service";
import {
  listPersonalisedCrmRunsApi,
  type PersonalisedCrmApiRun,
} from "@/services/personalised-crm.service";

export type { MonitoringTab } from "@/lib/campaign-monitoring-summary";

/** Page size for Live / Scheduled / Past / On-demand monitoring lists. */
const MONITOR_PAGE_SIZE = 50;

function tabCount(
  counts: DashboardCounts | null,
  tab: "live" | "scheduled" | "past",
): number {
  if (!counts) return 0;
  return counts[tab] || 0;
}

function MonitorListPager({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const from = (page - 1) * MONITOR_PAGE_SIZE + 1;
  const to = Math.min(page * MONITOR_PAGE_SIZE, total);
  return (
    <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3">
      <p className="text-xs tabular-nums text-neutral-500">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-xs tabular-nums text-neutral-500">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function firstTabWithCampaigns(
  counts: DashboardCounts | null,
  skip?: MonitoringTab,
): MonitoringTab | null {
  for (const t of ["live", "scheduled", "past"] as const) {
    if (t === skip) continue;
    if (tabCount(counts, t) > 0) return t;
  }
  return null;
}

function formatRate(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/** Shared labels for list → detail (Activity / Engagement / Efficiency). */
export function formatCampaignListMetrics(row: {
  hasPpc?: boolean;
  spend?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  currency?: string | null;
  sent?: number;
  opens?: number;
  openRate?: number | null;
  clickRate?: number | null;
  ctor?: number | null;
  channelMetrics?: Array<{
    channel: string;
    selected?: number;
    sent: number;
    failed?: number;
    bounced?: number;
    stubSent?: number;
    opens?: number;
    clicks?: number;
    totalOpens?: number;
    totalClicks?: number;
  }>;
}) {
  const hasPpc = Boolean(row.hasPpc && (row.spend ?? 0) > 0);
  let activity: string;
  if (hasPpc) {
    activity = `${row.currency || "INR"} ${Math.round(row.spend || 0).toLocaleString()} spend · ${(row.impressions ?? 0).toLocaleString()} impr · ${row.clicks ?? 0} clicks${
      (row.conversions ?? 0) > 0 ? ` · ${row.conversions} conv` : ""
    }`;
  } else if (row.channelMetrics && row.channelMetrics.length > 0) {
    activity = row.channelMetrics
      .map((c) => {
        const label =
          c.channel === "push"
            ? "App Push"
            : c.channel === "web"
              ? "Web Push"
              : c.channel.charAt(0).toUpperCase() + c.channel.slice(1);
        if (c.channel === "email") {
          const opens = c.opens ?? 0;
          const clicks = c.clicks ?? 0;
          const repeats =
            (c.totalOpens ?? opens) > opens || (c.totalClicks ?? clicks) > clicks
              ? ` (${c.totalOpens ?? opens} / ${c.totalClicks ?? clicks} hits)`
              : "";
          return `${label} ${c.sent} sent · ${c.bounced ?? 0} bounced · ${opens} open · ${clicks} click${repeats}`;
        }
        if (c.channel === "push" || c.channel === "web") {
          const clicks = c.clicks ?? 0;
          const stub = c.stubSent || 0;
          const base = `${label} ${c.sent} sent · ${c.failed ?? 0} failed · ${clicks} click`;
          return stub > 0 ? `${base} (${stub} stub)` : base;
        }
        const stub = c.stubSent || 0;
        const base = `${label} ${c.sent} sent · ${c.failed ?? 0} failed`;
        return stub > 0 ? `${base} (${stub} stub)` : base;
      })
      .join(" · ");
  } else if (row.opens != null) {
    activity = `${row.sent ?? 0} · ${row.opens} opens · ${row.clicks ?? 0} clicks`;
  } else {
    activity = String(row.sent ?? 0);
  }

  /** Unique openers / delivered (email); PPC falls back to CTR. */
  const engagement =
    row.hasPpc && (row.impressions ?? 0) > 0
      ? `${formatRate((row.clicks ?? 0) / (row.impressions || 1))} CTR`
      : row.openRate == null
        ? "—"
        : `${formatRate(row.openRate)} open rate`;

  /** Click rate on email + app/web push (each channel tracked separately upstream). */
  const efficiency =
    row.hasPpc && (row.spend ?? 0) > 0 && (row.clicks ?? 0) > 0
      ? `${row.currency || "INR"} ${((row.spend || 0) / (row.clicks || 1)).toFixed(1)} CPC`
      : row.clickRate == null
        ? "—"
        : `${formatRate(row.clickRate)} click rate${
            row.ctor != null ? ` · ${formatRate(row.ctor)} CTOR` : ""
          }`;

  return { activity, engagement, efficiency };
}

/** @deprecated import from @/lib/campaign-monitoring-summary */
export { formatCampaignScheduleDate } from "@/lib/campaign-monitoring-summary";

/** Client-side safety sort — mirrors backend monitoring bucket order. */
export function sortCampaignsForMonitoringTab(
  items: CampaignListItem[],
  tab: MonitoringTab,
): CampaignListItem[] {
  const sortMs = (row: CampaignListItem): number => {
    const localDate = row.launchLocalDate?.trim() || "";
    if (localDate) {
      const time = (row.launchLocalTime?.trim() || "00:00").slice(0, 5);
      const parsed = Date.parse(
        `${localDate}T${time.length === 5 ? time : "00:00"}:00`,
      );
      if (!Number.isNaN(parsed)) return parsed;
    }
    for (const raw of [row.startsAt, row.endsAt, row.createdAt]) {
      if (!raw) continue;
      const t = Date.parse(raw);
      if (!Number.isNaN(t)) return t;
    }
    return 0;
  };

  const sorted = [...items];
  sorted.sort((a, b) => {
    if (tab === "scheduled") {
      const diff = sortMs(a) - sortMs(b);
      if (diff !== 0) return diff;
      return a.createdAt.localeCompare(b.createdAt);
    }
    if (tab === "past") {
      const aEnd = a.endsAt ? Date.parse(a.endsAt) : sortMs(a);
      const bEnd = b.endsAt ? Date.parse(b.endsAt) : sortMs(b);
      const aMs = Number.isNaN(aEnd) ? sortMs(a) : aEnd;
      const bMs = Number.isNaN(bEnd) ? sortMs(b) : bEnd;
      const diff = bMs - aMs;
      if (diff !== 0) return diff;
      return b.createdAt.localeCompare(a.createdAt);
    }
    const diff = sortMs(b) - sortMs(a);
    if (diff !== 0) return diff;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return sorted;
}

type Props = {
  tab: MonitoringTab;
  onTabChange: (tab: MonitoringTab) => void;
  onSelectCampaign?: (id: string) => void;
  compact?: boolean;
};

/**
 * Queues-style campaign list (CCaaS LAYOUTS) — name + date/status meta + chevron.
 * Shared by /campaigns and Reports monitoring. On-demand uses the same row chrome.
 */
export function CampaignMonitoringList({
  tab,
  onTabChange,
  onSelectCampaign,
  compact = false,
}: Props) {
  const packId = useSyncExternalStore(
    subscribeActivePack,
    getActivePackId,
    () => DEFAULT_PACK_ID,
  );
  const isOnDemand = tab === "on-demand";
  const isPersonalisedCrm = tab === "personalised-crm";
  const isIsolated = isOnDemand || isPersonalisedCrm;

  const { data: items, error, loading, reload } = useLoadOnce(
    () =>
      isOnDemand
        ? Promise.resolve([] as CampaignListItem[])
        : isPersonalisedCrm
          ? Promise.resolve([] as CampaignListItem[])
          : fetchCampaigns(tab as CampaignBucket),
    [tab, packId, isIsolated],
  );
  const { data: bucketCounts } = useLoadOnce(
    () => fetchDashboard(),
    [packId],
  );

  const [onDemandRuns, setOnDemandRuns] = useState<OnDemandRun[]>([]);
  const [onDemandLoading, setOnDemandLoading] = useState(false);
  const [onDemandError, setOnDemandError] = useState<string | null>(null);
  const [crmRuns, setCrmRuns] = useState<PersonalisedCrmApiRun[]>([]);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    if (!isOnDemand) return;
    let cancelled = false;
    setOnDemandLoading(true);
    setOnDemandError(null);
    (async () => {
      try {
        const apiRuns = await listOnDemandRunsApi();
        if (cancelled) return;
        setOnDemandRuns(
          apiRuns.map((row) => {
            try {
              return mapApiRunToOnDemandRun(row);
            } catch {
              return mapApiRunToOnDemandRun({
                id: String(row?.id || "unknown"),
                title: "On-demand send",
                status: "ready",
              });
            }
          }),
        );
      } catch (err: unknown) {
        if (!cancelled) {
          setOnDemandRuns([]);
          const msg =
            err &&
            typeof err === "object" &&
            "response" in err &&
            err.response &&
            typeof err.response === "object" &&
            "data" in err.response &&
            err.response.data &&
            typeof err.response.data === "object" &&
            "message" in err.response.data
              ? String((err.response.data as { message?: string }).message)
              : err instanceof Error
                ? err.message
                : "";
          setOnDemandError(
            msg
              ? `Could not load on-demand sends: ${msg}`
              : "Could not load on-demand sends.",
          );
        }
      } finally {
        if (!cancelled) setOnDemandLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOnDemand, packId]);

  useEffect(() => {
    if (!isPersonalisedCrm) return;
    let cancelled = false;
    setCrmLoading(true);
    setCrmError(null);
    (async () => {
      try {
        const apiRuns = await listPersonalisedCrmRunsApi();
        if (cancelled) return;
        setCrmRuns(apiRuns);
      } catch {
        if (!cancelled) {
          setCrmRuns([]);
          setCrmError("Could not load Personalised CRM sends.");
        }
      } finally {
        if (!cancelled) setCrmLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPersonalisedCrm, packId]);

  useEffect(() => {
    if (tab !== "live") return;
    const id = window.setInterval(() => {
      void reload();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [tab, reload]);

  const orderedItems = useMemo(
    () =>
      !isIsolated && items
        ? sortCampaignsForMonitoringTab(items, tab)
        : items,
    [items, tab, isIsolated],
  );

  const autoPickedTabRef = useRef(false);
  useEffect(() => {
    if (autoPickedTabRef.current) return;
    if (isIsolated) {
      autoPickedTabRef.current = true;
      return;
    }
    if (loading || !bucketCounts) return;
    if (orderedItems && orderedItems.length > 0) {
      autoPickedTabRef.current = true;
      return;
    }
    const next = firstTabWithCampaigns(bucketCounts, tab);
    autoPickedTabRef.current = true;
    if (next && next !== tab) onTabChange(next);
  }, [loading, bucketCounts, orderedItems, tab, onTabChange, isIsolated]);

  const emptyHint = useMemo(() => {
    if (tab === "live") return "No live campaigns yet.";
    if (tab === "scheduled") return "No scheduled campaigns yet.";
    if (tab === "on-demand") {
      return "Hub and agent triggered sends will show here.";
    }
    if (tab === "personalised-crm") {
      return "CRM-requested sends for named people will show here.";
    }
    return "No past campaigns yet.";
  }, [tab]);

  const dateLabel =
    tab === "scheduled" ? "Scheduled" : tab === "past" ? "Ended" : "Launched";

  const openRow = (id: string) => {
    if (onSelectCampaign) onSelectCampaign(id);
  };

  const listLoading = isOnDemand
    ? onDemandLoading
    : isPersonalisedCrm
      ? crmLoading
      : loading;
  const listError = isOnDemand
    ? onDemandError
    : isPersonalisedCrm
      ? crmError
      : error;
  const onDemandCount =
    typeof bucketCounts?.onDemand === "number"
      ? bucketCounts.onDemand
      : onDemandRuns.length;
  const personalisedCrmCount =
    typeof bucketCounts?.personalisedCrm === "number"
      ? bucketCounts.personalisedCrm
      : crmRuns.length;

  const totalRows = isOnDemand
    ? onDemandRuns.length
    : isPersonalisedCrm
      ? crmRuns.length
      : orderedItems?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / MONITOR_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedCampaigns = useMemo(() => {
    if (!orderedItems) return [];
    const start = (safePage - 1) * MONITOR_PAGE_SIZE;
    return orderedItems.slice(start, start + MONITOR_PAGE_SIZE);
  }, [orderedItems, safePage]);

  const pagedOnDemand = useMemo(() => {
    const start = (safePage - 1) * MONITOR_PAGE_SIZE;
    return onDemandRuns.slice(start, start + MONITOR_PAGE_SIZE);
  }, [onDemandRuns, safePage]);

  const pagedCrm = useMemo(() => {
    const start = (safePage - 1) * MONITOR_PAGE_SIZE;
    return crmRuns.slice(start, start + MONITOR_PAGE_SIZE);
  }, [crmRuns, safePage]);

  return (
    <div className={compact ? "flex h-full min-h-0 flex-col p-3" : undefined}>
      <MonitorBucketTabs
        active={tab}
        counts={bucketCounts}
        onDemandCount={onDemandCount}
        personalisedCrmCount={personalisedCrmCount}
        compact={compact}
        onMonitoringTab={onTabChange}
      />

      {listError ? (
        <p className="text-sm text-red-600">{listError}</p>
      ) : listLoading ? (
        <CampaignsPageSkeleton />
      ) : isOnDemand ? (
        onDemandRuns.length === 0 ? (
          <ContentFadeIn>
            <div
              className={`rounded-2xl border border-dashed border-neutral-200 bg-white text-center shadow-sm ${
                compact ? "px-4 py-10" : "px-6 py-16"
              }`}
            >
              <p className="text-sm font-medium text-neutral-900">
                No on-demand sends
              </p>
              <p className="mt-1 text-sm text-neutral-500">{emptyHint}</p>
              <Link
                to="/campaigns/create/on-demand"
                className="mt-4 inline-flex h-9 items-center justify-center rounded-full bg-black px-4 text-xs font-medium text-white hover:bg-neutral-800"
              >
                New on-demand send
              </Link>
            </div>
          </ContentFadeIn>
        ) : (
          <ContentFadeIn className="flex min-h-0 flex-1 flex-col">
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {pagedOnDemand.map((run) => {
                const meta = formatOnDemandListMeta(run);
                const summary = formatOnDemandListSummary(run);
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-neutral-900">
                        {formatOnDemandDisplayTitle(run.title)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-neutral-500">
                        {meta}
                      </p>
                      <p
                        className="mt-1 truncate text-xs text-neutral-700"
                        title={summary}
                      >
                        {summary}
                      </p>
                    </div>
                    <ChevronRight
                      className="size-4 shrink-0 text-neutral-400"
                      strokeWidth={1.75}
                    />
                  </>
                );
                return (
                  <li key={run.id}>
                    {onSelectCampaign ? (
                      <button
                        type="button"
                        onClick={() => openRow(run.id)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 text-left shadow-sm transition-colors hover:bg-neutral-50"
                      >
                        {body}
                      </button>
                    ) : (
                      <Link
                        to={`/campaigns/on-demand/${run.id}`}
                        className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 shadow-sm transition-colors hover:bg-neutral-50"
                      >
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            <MonitorListPager
              page={safePage}
              totalPages={totalPages}
              total={totalRows}
              onPageChange={setPage}
            />
          </ContentFadeIn>
        )
      ) : isPersonalisedCrm ? (
        crmRuns.length === 0 ? (
          <ContentFadeIn>
            <div
              className={`rounded-2xl border border-dashed border-neutral-200 bg-white text-center shadow-sm ${
                compact ? "px-4 py-10" : "px-6 py-16"
              }`}
            >
              <p className="text-sm font-medium text-neutral-900">
                No Personalised CRM sends
              </p>
              <p className="mt-1 text-sm text-neutral-500">{emptyHint}</p>
            </div>
          </ContentFadeIn>
        ) : (
          <ContentFadeIn className="flex min-h-0 flex-1 flex-col">
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {pagedCrm.map((run) => {
                const when = run.sendAt || run.scheduledAt || run.createdAt;
                let whenLabel = when;
                try {
                  whenLabel = new Date(when).toLocaleString();
                } catch {
                  whenLabel = when;
                }
                const meta = `${whenLabel} · ${run.status}`;
                const summary = `${run.channels.join(", ") || "channels"} · ${run.audienceCount} people`;
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-neutral-900">
                        {run.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs capitalize text-neutral-500">
                        {meta}
                      </p>
                      <p
                        className="mt-1 truncate text-xs text-neutral-700"
                        title={summary}
                      >
                        {summary}
                      </p>
                    </div>
                    <ChevronRight
                      className="size-4 shrink-0 text-neutral-400"
                      strokeWidth={1.75}
                    />
                  </>
                );
                return (
                  <li key={run.id}>
                    {onSelectCampaign ? (
                      <button
                        type="button"
                        onClick={() => openRow(run.id)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 text-left shadow-sm transition-colors hover:bg-neutral-50"
                      >
                        {body}
                      </button>
                    ) : (
                      <Link
                        to={`/campaigns/personalised-crm/${run.id}`}
                        className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 shadow-sm transition-colors hover:bg-neutral-50"
                      >
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            <MonitorListPager
              page={safePage}
              totalPages={totalPages}
              total={totalRows}
              onPageChange={setPage}
            />
          </ContentFadeIn>
        )
      ) : !orderedItems || orderedItems.length === 0 ? (
        <ContentFadeIn>
          <div
            className={`rounded-2xl border border-dashed border-neutral-200 bg-white text-center shadow-sm ${
              compact ? "px-4 py-10" : "px-6 py-16"
            }`}
          >
            <p className="text-sm font-medium text-neutral-900">No campaigns</p>
            <p className="mt-1 text-sm text-neutral-500">{emptyHint}</p>
            <Link
              to="/campaigns/create"
              className="mt-4 inline-flex h-9 items-center justify-center rounded-full bg-black px-4 text-xs font-medium text-white hover:bg-neutral-800"
            >
              Create campaign
            </Link>
          </div>
        </ContentFadeIn>
      ) : (
        <ContentFadeIn className="flex min-h-0 flex-1 flex-col">
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {pagedCampaigns.map((row) => {
              const scheduleText =
                tab === "past" && row.endsAt
                  ? new Date(row.endsAt).toLocaleString()
                  : formatCampaignScheduleDate(row);
              const meta = `${dateLabel} ${scheduleText} · ${row.status}`;
              const summary = formatCampaignMonitoringSummary(
                row,
                tab as "live" | "scheduled" | "past",
              );
              const summaryTitle = formatCampaignMonitoringSummaryTitle(
                row,
                tab as "live" | "scheduled" | "past",
              );
              const body = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-neutral-900">
                      {row.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs capitalize text-neutral-500">
                      {meta}
                    </p>
                    <p
                      className="mt-1 truncate text-xs text-neutral-700"
                      title={summaryTitle}
                    >
                      {summary}
                    </p>
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-neutral-400"
                    strokeWidth={1.75}
                  />
                </>
              );

              return (
                <li key={row.id}>
                  {onSelectCampaign ? (
                    <button
                      type="button"
                      onClick={() => openRow(row.id)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 text-left shadow-sm transition-colors hover:bg-neutral-50"
                    >
                      {body}
                    </button>
                  ) : (
                    <Link
                      to={`/campaigns/${row.id}`}
                      className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 shadow-sm transition-colors hover:bg-neutral-50"
                    >
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          <MonitorListPager
            page={safePage}
            totalPages={totalPages}
            total={totalRows}
            onPageChange={setPage}
          />
        </ContentFadeIn>
      )}
    </div>
  );
}
