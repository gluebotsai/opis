import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AdminOpsPanel } from "@/components/home/AdminOpsPanel";
import { RepOpsPanel } from "@/components/home/RepOpsPanel";
import { ActivityTypeBadge } from "@/lib/activity-type-style";
import { DEAL_STAGE_LABELS } from "@/lib/deal-stages";
import { DashboardAnalyticsPanel } from "@/components/home/DashboardAnalyticsPanel";
import {
  fetchHomeDashboard,
  refreshFunnelSnapshot,
  type ChartSlice,
  type HomeDashboardData,
  type KpiCard,
} from "@/services/home";
import { DashboardPageSkeleton } from "./DashboardPageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { CHART_PIE_SERIES } from "@/components/analytics/chart-colors";
import { SECTION_H2_CLASS } from "@/lib/ui-tones";
import type { WorktualWorkspaceHeaderState } from "@/components/home/worktual-dashboard-shell";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<HomeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [analyticsBusy, setAnalyticsBusy] = useState(false);
  const [analyticsMessage, setAnalyticsMessage] = useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [workspaceHeader, setWorkspaceHeader] =
    useState<WorktualWorkspaceHeaderState | null>(null);

  const dashboardWelcome =
    "I'm your **Worktual co-worker**. Create records, ask about win rate or pipeline breakdown, or get coaching feedback — the dashboard stays fully usable on the right.";
  const pageSnapshot = Object.fromEntries(searchParams.entries());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = Object.fromEntries(searchParams.entries());
      const next = await fetchHomeDashboard(params);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
      setData(null);
    } finally {
      setLoading(false);
      setPending(false);
    }
  }, [searchParams]);

  const queryKey = searchParams.toString();

  const onRefreshAnalytics = useCallback(async () => {
    setAnalyticsBusy(true);
    setAnalyticsMessage(null);
    setAnalyticsError(null);
    try {
      const result = await refreshFunnelSnapshot();
      if (!result.ok) {
        setAnalyticsError(result.error);
        return;
      }
      setAnalyticsMessage("Snapshot refreshed.");
      await load();
    } catch (err) {
      setAnalyticsError(
        err instanceof Error ? err.message : "Refresh failed.",
      );
    } finally {
      setAnalyticsBusy(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load, queryKey]);

  const setParam = useCallback((key: string, value: string | null) => {
    setPending(true);
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (loading && !data) {
    return (
      <AgentModuleShell
        moduleId="dashboard"
        title="Dashboard"
        welcome={dashboardWelcome}
        pageSnapshot={pageSnapshot}
        surface="list"
        workspace={<DashboardPageSkeleton />}
        workspaceTitle="Dashboard"
        workspaceSubtitle={MODULE_WORKSPACE_DESCRIPTION.dashboard}
        collapseChatToFab
      />
    );
  }

  if (!data) {
    return (
      <AgentModuleShell
        moduleId="dashboard"
        title="Dashboard"
        welcome={dashboardWelcome}
        pageSnapshot={pageSnapshot}
        surface="list"
        workspace={
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
            <p className="text-sm text-red-700">
              {error ?? "Dashboard data is unavailable right now."}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 text-sm font-medium text-text-link hover:underline"
            >
              Retry
            </button>
          </div>
        }
        workspaceTitle="Dashboard"
        workspaceSubtitle={MODULE_WORKSPACE_DESCRIPTION.dashboard}
        collapseChatToFab
      />
    );
  }

  const showLegacyBelow = !data.adminOps && !data.repOps;

  const workspace = (
    <div className="crm-fade-in w-full min-w-0 bg-white">
      <div className="mx-auto w-full max-w-[1400px] space-y-4">
          {data.adminOps ? (
            <AdminOpsPanel
              data={data.adminOps}
              analytics={data.analytics}
              pending={pending || loading}
              onParam={setParam}
              onRefresh={() => void load()}
              onRefreshAnalytics={onRefreshAnalytics}
              analyticsRefreshing={analyticsBusy}
              analyticsMessage={analyticsMessage}
              analyticsError={analyticsError}
              onHeaderActionsChange={setWorkspaceHeader}
            />
          ) : null}

          {data.repOps ? (
            <RepOpsPanel data={data.repOps} analytics={data.analytics} />
          ) : null}

          {showLegacyBelow ? (
            <div className="@container space-y-4">
              <div className="grid grid-cols-1 items-stretch gap-3 @sm:grid-cols-2 @2xl:grid-cols-4">
                {data.kpis.slice(0, 4).map((kpi, i) => (
                  <KpiTile key={kpi.id} kpi={kpi} accent={i === 0} />
                ))}
              </div>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
                <section className="w-full min-w-0 rounded-xl border border-border-default bg-surface p-4 lg:flex-[1.6]">
                  <h2 className={SECTION_H2_CLASS}>
                    {data.persona === "finance"
                      ? "Invoice amounts by status"
                      : data.persona === "marketing"
                        ? "Contacts & leads pulse"
                        : "Pipeline by stage"}
                  </h2>
                  <p className="mt-0.5 text-xs text-text-caption">
                    {data.persona === "finance"
                      ? "Open invoices by status"
                      : data.persona === "marketing"
                        ? "Current book"
                        : "Open deals by stage"}
                  </p>
                  <BarChart slices={data.pipelineBars} />
                </section>

                <section className="w-full min-w-0 rounded-xl border border-border-default bg-surface p-4 lg:flex-1">
                  <h2 className={SECTION_H2_CLASS}>
                    {data.persona === "finance"
                      ? "Status mix"
                      : data.persona === "marketing"
                        ? "Lifecycle mix"
                        : "Outcome mix"}
                  </h2>
                  <p className="mt-0.5 text-xs text-text-caption">
                    {data.persona === "finance" ? "By status" : "By outcome"}
                  </p>
                  <DonutChart slices={data.statusDonut} />
                </section>
              </div>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
                {data.persona === "finance" ? (
                  <div className="w-full min-w-0 lg:flex-1">
                    <InvoiceTable invoices={data.openInvoices} />
                  </div>
                ) : (
                  <>
                    <div className="w-full min-w-0 lg:flex-1">
                    <DealTable
                      deals={data.openDeals}
                      title={
                        data.persona === "marketing"
                          ? "Recent contacts"
                          : data.persona === "rep"
                            ? "My open deals"
                            : "Recent deals"
                      }
                    />
                    </div>
                    <div className="w-full min-w-0 lg:flex-1">
                    <ActivityTable activities={data.dueActivities} />
                    </div>
                  </>
                )}
              </div>

              <DashboardAnalyticsPanel
                analytics={data.analytics}
                onRefresh={
                  data.analytics.canSeeOrgSnapshot
                    ? () => void onRefreshAnalytics()
                    : undefined
                }
                refreshing={analyticsBusy}
                refreshMessage={analyticsMessage}
                refreshError={analyticsError}
              />
            </div>
          ) : null}
        </div>
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="dashboard"
      title={data.title}
      welcome={dashboardWelcome}
      pageSnapshot={pageSnapshot}
      surface="list"
      workspace={workspace}
      workspaceTitle={data.adminOps ? "Reports" : data.title}
      workspaceSubtitle={
        data.adminOps
          ? MODULE_WORKSPACE_DESCRIPTION.reports
          : MODULE_WORKSPACE_DESCRIPTION.dashboard
      }
      workspaceHeaderLeading={
        data.adminOps ? workspaceHeader?.leading : undefined
      }
      workspaceHeaderActions={
        data.adminOps ? workspaceHeader?.actions : undefined
      }
      workspaceHeaderTall={data.adminOps ? workspaceHeader?.tall : undefined}
      collapseChatToFab
      onAfterTool={() => void load()}
    />
  );
}

function KpiTile({ kpi, accent }: { kpi: KpiCard; accent?: boolean }) {
  const inner = (
    <>
      <div
        className={`mb-3 h-1 w-10 rounded-full ${
          accent ? "bg-neutral-900" : "bg-brand/70"
        }`}
      />
      <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
        {kpi.label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
        {kpi.value}
      </p>
      <p className="mt-1 text-xs text-text-caption">{kpi.hint}</p>
    </>
  );

  const className =
    "flex h-full flex-col rounded-xl border border-border-default bg-surface p-4 transition-colors hover:border-neutral-300";

  if (kpi.href) {
    return (
      <Link to={kpi.href} className={className}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}

function BarChart({ slices }: { slices: ChartSlice[] }) {
  const max = Math.max(1, ...slices.map((s) => s.value));
  if (slices.length === 0 || slices.every((s) => s.value === 0)) {
    return (
      <p className="mt-6 text-sm text-text-caption">No chart data yet.</p>
    );
  }

  return (
    <div className="mt-5 flex h-44 items-end gap-2 sm:gap-3">
      {slices.map((slice) => {
        const h = Math.max(4, Math.round((slice.value / max) * 100));
        return (
          <div
            key={slice.id}
            className="flex min-w-0 flex-1 flex-col items-center gap-2"
          >
            <span className="text-[10px] font-medium text-text-caption">
              {slice.value || ""}
            </span>
            <div className="flex h-32 w-full items-end justify-center">
              <div
                className="w-full max-w-10 rounded-t-md bg-brand/85"
                style={{ height: `${h}%` }}
                title={`${slice.label}: ${slice.value}`}
              />
            </div>
            <span className="w-full truncate text-center text-[10px] text-text-caption capitalize">
              {slice.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const DONUT_COLORS = CHART_PIE_SERIES;

function DonutChart({ slices }: { slices: ChartSlice[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return (
      <p className="mt-6 text-sm text-text-caption">No status data yet.</p>
    );
  }

  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg viewBox="0 0 120 120" className="size-36 shrink-0">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--color-neutral-100)"
          strokeWidth="16"
        />
        {slices.map((slice, i) => {
          if (slice.value <= 0) return null;
          const len = (slice.value / total) * c;
          const el = (
            <circle
              key={slice.id}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth="16"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += len;
          return el;
        })}
        <text
          x="60"
          y="58"
          textAnchor="middle"
          className="fill-[var(--clr-text-primary)] text-[18px] font-semibold"
        >
          {total}
        </text>
        <text
          x="60"
          y="74"
          textAnchor="middle"
          className="fill-[var(--clr-text-caption)] text-[9px]"
        >
          total
        </text>
      </svg>
      <ul className="w-full space-y-2 text-sm">
        {slices.map((slice, i) => (
          <li
            key={slice.id}
            className="flex items-center justify-between gap-2 capitalize"
          >
            <span className="flex items-center gap-2 text-text-secondary">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{
                  background: DONUT_COLORS[i % DONUT_COLORS.length],
                }}
              />
              {slice.label}
            </span>
            <span className="font-medium text-text-primary">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DealTable({
  deals,
  title,
}: {
  deals: HomeDashboardData["openDeals"];
  title: string;
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none">
      <div className="flex items-center justify-between gap-2">
        <h2 className={SECTION_H2_CLASS}>{title}</h2>
        <Link
          to="/sales"
          className="text-sm font-medium text-text-link hover:underline"
        >
          Pipeline
        </Link>
      </div>
      {deals.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">No deals to show.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border-default">
          {deals.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <div className="min-w-0">
                <Link
                  to={`/sales/${d.id}`}
                  className="font-medium text-text-link hover:underline"
                >
                  {d.title}
                </Link>
                <p className="text-text-caption">{d.companyName}</p>
              </div>
              <div className="text-right text-text-secondary">
                <p>{DEAL_STAGE_LABELS[d.stage] ?? d.stage}</p>
                {d.amount ? <p className="text-xs">${d.amount}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityTable({
  activities,
}: {
  activities: HomeDashboardData["dueActivities"];
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none">
      <div className="flex items-center justify-between gap-2">
        <h2 className={SECTION_H2_CLASS}>
          Due activities
        </h2>
        <Link
          to="/activities"
          className="text-sm font-medium text-text-link hover:underline"
        >
          All
        </Link>
      </div>
      {activities.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">
          Nothing due in the next 7 days.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border-default">
          {activities.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ActivityTypeBadge type={a.type} />
                {a.dueAt ? (
                  <span className="text-xs text-text-caption">
                    {new Date(a.dueAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm font-medium text-text-primary">
                {a.subject}
              </p>
              <Link
                to={`/contact/${a.contactId}`}
                className="text-sm text-text-link hover:underline"
              >
                {a.contactName}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InvoiceTable({
  invoices,
}: {
  invoices: HomeDashboardData["openInvoices"];
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none">
      <div className="flex items-center justify-between gap-2">
        <h2 className={SECTION_H2_CLASS}>
          Open invoices
        </h2>
        <Link
          to="/finance"
          className="text-sm font-medium text-text-link hover:underline"
        >
          Finance
        </Link>
      </div>
      {invoices.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">No open invoices.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border-default">
          {invoices.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <div>
                <Link
                  to={`/finance/${inv.id}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {inv.number}
                </Link>
                <p className="text-text-caption">{inv.companyName}</p>
              </div>
              <div className="text-right">
                <p className="text-text-secondary">
                  {inv.currency} {inv.total}
                </p>
                <span className="inline-flex rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium capitalize text-text-caption">
                  {inv.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
