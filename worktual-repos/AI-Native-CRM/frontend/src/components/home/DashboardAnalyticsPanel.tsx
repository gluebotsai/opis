import { Button } from "@/components/ui/Button";
import { OutcomeDonut, LollipopBars } from "@/components/home/sales-charts";
import type {
  ChartSlice,
  DashboardAnalyticsData,
  CoachingInsightSummary,
  CoachingTrendRow,
} from "@/services/home";
import { SECTION_H2_CLASS, SUCCESS_FLASH_CLASS } from "@/lib/ui-tones";

const IMPRESSION_LABELS: Record<string, string> = {
  strong: "Strong",
  solid: "Solid",
  needs_work: "Needs work",
};

const IMPRESSION_TONE: Record<string, string> = {
  strong: "bg-emerald-500/10 text-emerald-700",
  solid: "bg-sky-500/10 text-sky-700",
  needs_work: "bg-amber-500/10 text-amber-700",
};

export type DashboardAnalyticsPanelProps = {
  analytics: DashboardAnalyticsData;
  /** Hide win/loss when salesMetrics charts already show them. */
  showFunnelCharts?: boolean;
  showMyCoaching?: boolean;
  showTeamCoaching?: boolean;
  showSnapshotMeta?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshMessage?: string | null;
  refreshError?: string | null;
};

export function DashboardAnalyticsPanel({
  analytics,
  showFunnelCharts = true,
  showMyCoaching = true,
  showTeamCoaching = true,
  showSnapshotMeta = true,
  onRefresh,
  refreshing = false,
  refreshMessage = null,
  refreshError = null,
}: DashboardAnalyticsPanelProps) {
  const snap = analytics.funnelSnapshot;

  return (
    <div className="@container space-y-6">
      {showSnapshotMeta && analytics.canSeeOrgSnapshot ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-caption">
              Funnel snapshot
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {snap?.generatedAt
                ? `Last refreshed ${new Date(snap.generatedAt).toLocaleString()}`
                : "No snapshot yet — refresh or wait for the nightly sweep."}
            </p>
          </div>
          {onRefresh ? (
            <Button
              type="button"
              disabled={refreshing}
              onClick={() => void onRefresh()}
            >
              {refreshing ? "Refreshing…" : "Refresh snapshot"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {refreshMessage ? (
        <p className={SUCCESS_FLASH_CLASS}>{refreshMessage}</p>
      ) : null}
      {refreshError ? (
        <p className="text-sm text-text-danger">{refreshError}</p>
      ) : null}

      {showFunnelCharts ? (
        <FunnelSnapshotSection
          analytics={analytics}
          snap={snap}
        />
      ) : null}

      {showMyCoaching ? (
        <MyCoachingSection items={analytics.myCoaching} />
      ) : null}

      {showTeamCoaching && analytics.canSeeOrgSnapshot ? (
        <TeamCoachingTrendsSection rows={analytics.teamCoachingTrends} />
      ) : null}
    </div>
  );
}

function FunnelSnapshotSection({
  analytics,
  snap,
}: {
  analytics: DashboardAnalyticsData;
  snap: DashboardAnalyticsData["funnelSnapshot"];
}) {
  if (!snap) {
    return (
      <div className="rounded-xl border-[0.6px] border-dashed border-[#bfbfbf] bg-white px-6 py-10 text-center text-sm text-text-caption">
        {analytics.canSeeOrgSnapshot
          ? "No funnel snapshot yet."
          : "No owned pipeline data yet."}
      </div>
    );
  }

  const winLoss: ChartSlice[] = [
    { id: "won", label: "Won", value: snap.wonCount },
    { id: "lost", label: "Lost", value: snap.lostCount },
  ];
  const lostReasons: ChartSlice[] = Object.entries(snap.lostReasons).map(
    ([label, value]) => ({ id: label, label, value }),
  );
  const quoteSlices: ChartSlice[] = Object.entries(snap.quoteCounts).map(
    ([label, value]) => ({ id: label, label, value }),
  );
  const invoiceSlices: ChartSlice[] = Object.entries(snap.invoiceCounts).map(
    ([label, value]) => ({ id: label, label, value }),
  );

  return (
    <div className="@container space-y-4">
      <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
        <StatTile
          label="Won / Lost"
          value={`${snap.wonCount} won · ${snap.lostCount} lost`}
        />
        <StatTile
          label="Generated"
          value={
            snap.generatedAt
              ? new Date(snap.generatedAt).toLocaleString()
              : "Live rollup"
          }
        />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <section className="w-full min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 lg:flex-1">
          <h3 className={SECTION_H2_CLASS}>Win / loss mix</h3>
          <OutcomeDonut slices={winLoss} />
        </section>
        {lostReasons.length > 0 ? (
          <section className="w-full min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 lg:flex-1">
            <h3 className={SECTION_H2_CLASS}>Lost reasons</h3>
            <LollipopBars slices={lostReasons} />
          </section>
        ) : null}
      </div>

      {(quoteSlices.length > 0 || invoiceSlices.length > 0) && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          {quoteSlices.length > 0 ? (
            <section className="w-full min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 lg:flex-1">
              <h3 className={SECTION_H2_CLASS}>Quotes by status</h3>
              <OutcomeDonut slices={quoteSlices} />
            </section>
          ) : null}
          {invoiceSlices.length > 0 ? (
            <section className="w-full min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 lg:flex-1">
              <h3 className={SECTION_H2_CLASS}>Invoices by status</h3>
              <OutcomeDonut slices={invoiceSlices} />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-caption">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}

function ImpressionBadge({ impression }: { impression: string }) {
  const tone = IMPRESSION_TONE[impression] ?? "bg-subtle text-text-caption";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {IMPRESSION_LABELS[impression] ?? impression}
    </span>
  );
}

export function MyCoachingSection({
  items,
}: {
  items: CoachingInsightSummary[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h2 className="text-base font-semibold text-text-primary">My Coaching</h2>
      <p className="mt-1 text-sm text-text-caption">
        Private feedback on your recent calls &amp; meetings — visible only to you.
      </p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <ImpressionBadge impression={item.overallImpression} />
              <span className="text-xs text-text-caption">
                {new Date(item.analyzedAt).toLocaleDateString()}
              </span>
            </div>
            <p className="mt-3 text-sm font-medium text-text-primary">
              {item.coachingNote}
            </p>
            {item.discoveryQuality ? (
              <p className="mt-2 text-sm text-text-secondary">
                <span className="font-medium text-text-primary">Discovery: </span>
                {item.discoveryQuality}
              </p>
            ) : null}
            {item.objectionHandling ? (
              <p className="mt-1 text-sm text-text-secondary">
                <span className="font-medium text-text-primary">Objections: </span>
                {item.objectionHandling}
              </p>
            ) : null}
            {item.methodologyNote ? (
              <p className="mt-1 text-sm text-text-secondary">
                <span className="font-medium text-text-primary">Methodology: </span>
                {item.methodologyNote}
              </p>
            ) : null}
            {item.talkBalanceNote ? (
              <p className="mt-1 text-sm text-text-secondary">
                <span className="font-medium text-text-primary">Talk balance: </span>
                {item.talkBalanceNote}
              </p>
            ) : null}
            {item.strengths.length > 0 ? (
              <p className="mt-2 text-sm text-text-secondary">
                <span className="font-medium text-text-primary">Strengths: </span>
                {item.strengths.join(" · ")}
              </p>
            ) : null}
            {item.growthAreas.length > 0 ? (
              <p className="mt-1 text-sm text-text-secondary">
                <span className="font-medium text-text-primary">Growth areas: </span>
                {item.growthAreas.join(" · ")}
              </p>
            ) : null}
            {item.highlightedMoment ? (
              <p className="mt-2 rounded-lg bg-subtle px-3 py-2 text-xs text-text-caption">
                {item.highlightedMoment}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TeamCoachingTrendsSection({
  rows,
}: {
  rows: CoachingTrendRow[] | null;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-text-primary">
        Team Coaching Trends
      </h2>
      <p className="mt-1 text-sm text-text-caption">
        Aggregate counts only, last 90 days — never per-interaction notes or quotes.
      </p>
      {!rows || rows.length === 0 ? (
        <div className="mt-4 rounded-xl border-[0.6px] border-dashed border-[#bfbfbf] bg-white px-6 py-8 text-center text-sm text-text-caption">
          No coaching data yet.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border-[0.6px] border-[#bfbfbf] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-xs font-medium uppercase tracking-wide text-text-caption">
                <th className="px-4 py-3">Rep</th>
                <th className="px-4 py-3">Strong</th>
                <th className="px-4 py-3">Solid</th>
                <th className="px-4 py-3">Needs work</th>
                <th className="px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.repUserId}
                  className="border-b border-border-default last:border-0"
                >
                  <td className="px-4 py-3 font-medium text-text-primary">
                    {row.repName}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{row.strong}</td>
                  <td className="px-4 py-3 text-text-secondary">{row.solid}</td>
                  <td className="px-4 py-3 text-text-secondary">{row.needsWork}</td>
                  <td className="px-4 py-3 text-text-secondary">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
