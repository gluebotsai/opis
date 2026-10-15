import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatChannel, formatPct, formatWhen } from "@/lib/dashboard-metrics";
import {
  formatContactsApiError,
  fetchContactCampaignActivity,
  type CampaignContactEngagement,
  type ContactCampaignActivity,
  type ContactCampaignActivityRow,
  type ContactChannelSummary,
} from "@/services/contacts.service";

function outcomeLabel(outcome: string): string {
  if (outcome === "sent") return "Sent";
  if (outcome === "failed") return "Failed";
  if (outcome === "skipped") return "Skipped";
  if (outcome === "pending") return "Pending";
  return "Not sent";
}

function rowHasSend(row: ContactCampaignActivityRow): boolean {
  if (row.outcome === "sent") return true;
  return row.channels.some((ch) => ch.outcome === "sent" && ch.sent_at);
}

function rowLatestSentAt(row: ContactCampaignActivityRow): string | null {
  const sentTimes = row.channels
    .map((ch) => ch.sent_at)
    .filter((t): t is string => Boolean(t));
  if (sentTimes.length) {
    return sentTimes.sort().reverse()[0]!;
  }
  return row.starts_at ?? row.updated_at;
}

function aggregateSendMetrics(
  byChannel: Record<string, ContactChannelSummary>,
  engagement?: CampaignContactEngagement | null,
) {
  const email =
    byChannel.email ??
    byChannel.Email ??
    Object.entries(byChannel).find(([k]) => k.toLowerCase() === "email")?.[1];

  let sends = 0;
  let opens = 0;
  let clicks = 0;

  if (email) {
    sends = email.sent;
    opens = email.opens ?? engagement?.email_open_count ?? 0;
    clicks = email.clicks ?? engagement?.email_click_count ?? 0;
  } else {
    for (const stats of Object.values(byChannel)) {
      sends += stats.sent;
      opens += stats.opens ?? 0;
      clicks += stats.clicks ?? 0;
    }
    if (engagement) {
      opens = Math.max(opens, engagement.email_open_count ?? 0);
      clicks = Math.max(clicks, engagement.email_click_count ?? 0);
    }
  }

  const openRate = sends > 0 ? opens / sends : null;
  const clickRate = sends > 0 ? clicks / sends : null;
  return { sends, opens, clicks, openRate, clickRate };
}

function collectSentCampaignRows(
  activity: ContactCampaignActivity,
  pastItems: ContactCampaignActivityRow[],
): ContactCampaignActivityRow[] {
  const seen = new Set<string>();
  const rows: ContactCampaignActivityRow[] = [];
  for (const row of [...activity.active, ...pastItems]) {
    if (!rowHasSend(row) || seen.has(row.campaign_id)) continue;
    seen.add(row.campaign_id);
    rows.push(row);
  }
  rows.sort((a, b) => {
    const ta = rowLatestSentAt(a);
    const tb = rowLatestSentAt(b);
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });
  return rows;
}

function relativeActivityTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return formatWhen(iso);
}

function ActivityRow({ row }: { row: ContactCampaignActivityRow }) {
  const sentAt = rowLatestSentAt(row);
  const primaryChannel = row.channels.find((ch) => ch.sent_at)?.channel;
  const channelLabel = primaryChannel
    ? formatChannel(primaryChannel)
    : row.channels_planned.map(formatChannel).join(", ") || "Campaign";

  return (
    <li className="flex gap-3 border-b border-[#bfbfbf]/80 py-3 last:border-b-0">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
        <Megaphone className="size-[18px]" strokeWidth={2.25} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link
            to={`/campaigns/${row.campaign_id}`}
            className="text-sm font-semibold text-neutral-900 hover:underline"
          >
            {row.name}
          </Link>
          <span className="shrink-0 text-xs text-neutral-400">
            {relativeActivityTime(sentAt)}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-neutral-600">
          {outcomeLabel(row.outcome)} · {channelLabel}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
            {row.status}
          </span>
          {row.channels_planned.slice(0, 3).map((ch) => (
            <span
              key={ch}
              className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800"
            >
              {formatChannel(ch)}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}

function PerformanceCard({
  sends,
  openRate,
  clickRate,
  emailUnsubscribed,
}: {
  sends: number;
  openRate: number | null;
  clickRate: number | null;
  emailUnsubscribed: boolean;
}) {
  return (
    <section className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">
          Campaign performance
        </h3>
        <p className="mt-0.5 text-xs text-neutral-500">
          Sends and engagement for this contact
        </p>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <KpiTile label="Delivered" value={String(sends)} />
        <KpiTile label="Open rate" value={formatPct(openRate)} />
        <KpiTile label="Click rate" value={formatPct(clickRate)} />
      </div>
      {emailUnsubscribed ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Email unsubscribed — future email sends may be suppressed.
        </p>
      ) : null}
    </section>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border-[0.6px] border-[#bfbfbf]/80 bg-[#f3f4f6]/60 px-3 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">
        {value}
      </p>
    </div>
  );
}

function SentCampaignsCard({
  rows,
  emptyHint,
}: {
  rows: ContactCampaignActivityRow[];
  emptyHint: string;
}) {
  return (
    <section className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">
          Campaign received
        </h3>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">{emptyHint}</p>
      ) : (
        <ul className="mt-3">{rows.map((row) => (
            <ActivityRow key={row.campaign_id} row={row} />
          ))}</ul>
      )}
    </section>
  );
}

type ContactCampaignActivityPanelProps = {
  contactId: string;
  active?: boolean;
  className?: string;
  engagement?: CampaignContactEngagement | null;
};

export function ContactCampaignActivityPanel({
  contactId,
  active = true,
  className = "",
  engagement = null,
}: ContactCampaignActivityPanelProps) {
  const [activity, setActivity] = useState<ContactCampaignActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pastPage, setPastPage] = useState(1);
  const [pastItems, setPastItems] = useState<ContactCampaignActivityRow[]>([]);
  const [pastTotal, setPastTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const contactIdRef = useRef(contactId);
  contactIdRef.current = contactId;

  const pastItemsLengthRef = useRef(0);
  pastItemsLengthRef.current = pastItems.length;

  const load = useCallback(
    async (opts?: { pastPage?: number; appendPast?: boolean; quiet?: boolean }) => {
      const id = contactIdRef.current;
      if (!id) return;
      const page = opts?.pastPage ?? 1;
      const pastLimit =
        opts?.quiet && pastItemsLengthRef.current > 20
          ? pastItemsLengthRef.current
          : 20;
      if (!opts?.quiet) {
        if (opts?.appendPast) setLoadingMore(true);
        else setLoading(true);
      }
      setError(null);
      try {
        const data = await fetchContactCampaignActivity(id, {
          pastPage: opts?.quiet ? 1 : page,
          pastLimit,
        });
        if (contactIdRef.current !== id) return;
        setActivity(data);
        if (opts?.appendPast && page > 1) {
          setPastItems((prev) => {
            const seen = new Set(prev.map((r) => r.campaign_id));
            const merged = [...prev];
            for (const row of data.past.items) {
              if (!seen.has(row.campaign_id)) merged.push(row);
            }
            return merged;
          });
        } else {
          setPastItems(data.past.items);
        }
        setPastTotal(data.past.total);
        setPastPage(page);
      } catch (err) {
        if (contactIdRef.current !== id) return;
        setError(formatContactsApiError(err, "Failed to load campaign activity"));
      } finally {
        if (contactIdRef.current === id) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!contactId || !active) return;
    void load({ pastPage: 1 });
  }, [contactId, active, load]);

  const pollMs = useMemo(() => {
    if (!activity) return 60_000;
    if (activity.summary.active_count > 0) return 20_000;
    if (activity.summary.scheduled_count > 0) return 60_000;
    return 0;
  }, [activity]);

  useEffect(() => {
    if (!active || !contactId || !pollMs) return;
    const id = window.setInterval(() => {
      void load({ pastPage, quiet: true });
    }, pollMs);
    return () => window.clearInterval(id);
  }, [active, contactId, pollMs, pastPage, load]);

  useEffect(() => {
    if (!active || !contactId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void load({ pastPage, quiet: true });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active, contactId, pastPage, load]);

  const metrics = useMemo(() => {
    if (!activity) {
      const sends = 0;
      const opens = engagement?.email_open_count ?? 0;
      const clicks = engagement?.email_click_count ?? 0;
      return {
        sends,
        openRate: null as number | null,
        clickRate: null as number | null,
        opens,
        clicks,
      };
    }
    return aggregateSendMetrics(activity.summary.by_channel, engagement);
  }, [activity, engagement]);

  const sentRows = useMemo(() => {
    if (!activity) return [];
    return collectSentCampaignRows(activity, pastItems);
  }, [activity, pastItems]);

  const hasMorePast = pastItems.length < pastTotal;

  if (loading && !activity) {
    return (
      <div className={`space-y-4 ${className}`}>
        <section className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none">
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading campaign data…
          </div>
        </section>
      </div>
    );
  }

  if (error && !activity && !engagement) {
    return (
      <div className={`space-y-4 ${className}`}>
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            onClick={() => void load({ pastPage: 1 })}
          >
            Retry
          </Button>
        </section>
      </div>
    );
  }

  const emailUnsubscribed =
    activity?.summary.email_unsubscribed ||
    Boolean(engagement?.email_unsubscribed);

  if (!activity && !engagement) return null;

  return (
    <div className={`space-y-4 ${className}`}>
      <PerformanceCard
        sends={metrics.sends}
        openRate={metrics.openRate}
        clickRate={metrics.clickRate}
        emailUnsubscribed={emailUnsubscribed}
      />
      {activity ? (
        <>
          <SentCampaignsCard
            rows={sentRows}
            emptyHint="No sent campaigns yet for this contact."
          />
        </>
      ) : null}
      {activity && hasMorePast ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={loadingMore}
          onClick={() => void load({ pastPage: pastPage + 1, appendPast: true })}
        >
          {loadingMore ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading…
            </>
          ) : (
            `Load more campaigns (${pastItems.length} of ${pastTotal})`
          )}
        </Button>
      ) : null}
      {error ? <p className="text-xs text-amber-700">{error}</p> : null}
    </div>
  );
}

/** @deprecated Use ContactCampaignActivityPanel performance card instead. */
export function ContactCampaignEngagementSummary({
  emailUnsubscribed,
  lastOpen,
  lastClick,
  openCount,
  clickCount,
}: {
  emailUnsubscribed: boolean;
  lastOpen?: string | null;
  lastClick?: string | null;
  openCount: number;
  clickCount: number;
}) {
  const sends = Math.max(openCount, clickCount, 0);
  const openRate = sends > 0 ? openCount / sends : null;
  const clickRate = sends > 0 ? clickCount / sends : null;
  return (
    <PerformanceCard
      sends={openCount > 0 || clickCount > 0 ? Math.max(openCount, 1) : 0}
      openRate={openRate}
      clickRate={clickRate}
      emailUnsubscribed={emailUnsubscribed}
    />
  );
}
