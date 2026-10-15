import { Link } from "react-router-dom";
import { useState } from "react";
import {
  CalendarDays,
  CheckSquare,
  Handshake,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  ActivityTypeBadge,
  activityTypeDisplayLabel,
} from "@/lib/activity-type-style";
import {
  AgingHeatStrip,
  OutcomeDonut,
  StageFunnel,
  WonRevenueLine,
} from "@/components/home/sales-charts";
import type {
  RepOpsData,
  DashboardAnalyticsData,
  ScorecardRowStatus,
} from "@/services/home";
import { formatMoney, formatMoneyFull } from "@/lib/deal-stages";
import {
  SECTION_H2_CLASS,
  TONE_ACCENT,
  TONE_DANGER,
  TONE_NEUTRAL,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";
import {
  WorktualDashboardPanel,
  WorktualKpiGrid,
  WorktualLineTabs,
  WorktualPanelHeader,
  WORKTUAL_CHART_CARD,
  WORKTUAL_KPI_CARD,
} from "@/components/home/worktual-dashboard-shell";
import {
  KPI_ICON_TONES,
  ReportKpiCard,
} from "@/components/home/ReportDashboardLayout";
import { MyCoachingSection } from "@/components/home/DashboardAnalyticsPanel";

type RepTab = "today" | "pipeline" | "book";

const REP_HERO = [
  "active_opportunities",
  "total_pipeline",
  "weighted_pipeline",
  "win_rate",
] as const;
const REP_BOOK = [
  "won_revenue",
  "lost_revenue",
  "sales_velocity",
  "avg_deal_size",
] as const;

export function RepOpsPanel({
  data,
  analytics,
}: {
  data: RepOpsData;
  analytics: DashboardAnalyticsData;
}) {
  const [tab, setTab] = useState<RepTab>("today");
  const sales = data.salesMetrics;
  const byId = new Map((sales?.cards ?? []).map((c) => [c.id, c]));

  const tabs: Array<{ id: RepTab; label: string; icon: LucideIcon }> = [
    { id: "today", label: "Today", icon: CalendarDays },
    { id: "pipeline", label: "My pipeline", icon: Handshake },
    { id: "book", label: "My book", icon: Sparkles },
  ];

  const repKpis = [
    {
      label: "My open deals",
      value: String(data.totals.open),
      hint: "All open deals",
      href: "/sales",
      icon: Handshake,
    },
    {
      label: "My pipeline",
      value: byId.get("total_pipeline")?.value ?? "—",
      hint: "Open value · last 30 days",
      href: "/sales",
      icon: TrendingUp,
    },
    {
      label: "My win rate",
      value: byId.get("win_rate")?.value ?? "—",
      hint: "Closed deals won · last 30 days",
      href: "/sales",
      icon: Sparkles,
    },
    {
      label: "Meetings today",
      value: String(data.meetingsToday.length),
      hint: "Today",
      href: "/activities",
      icon: CalendarDays,
    },
    {
      label: "Tasks due",
      value: String(data.tasksToday.length),
      hint: data.tasksToday.some((t) => t.overdue)
        ? "Includes overdue"
        : "Due today",
      href: "/activities?type=task",
      icon: CheckSquare,
    },
  ] as const;

  return (
    <WorktualDashboardPanel
      className="@container"
      header={
        <WorktualPanelHeader
          title="My performance"
          subtitle={tab === "today" ? "Today" : "Last 30 days"}
        />
      }
      tabs={
        <WorktualLineTabs
          tabs={tabs}
          active={tab}
          onChange={setTab}
          ariaLabel="Rep dashboard sections"
        />
      }
    >
      {tab === "today" ? (
        <div className="space-y-6">
          <WorktualKpiGrid title="Key metrics">
            {repKpis.map((card, index) => (
              <ReportKpiCard
                key={card.label}
                label={card.label}
                value={card.value}
                hint={card.hint}
                href={card.href}
                icon={card.icon}
                iconClassName={KPI_ICON_TONES[index % KPI_ICON_TONES.length]}
              />
            ))}
          </WorktualKpiGrid>

          {data.myWeek ? (
            <MyWeekScorecardCard myWeek={data.myWeek} />
          ) : null}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <div className="w-full min-w-0 lg:flex-[1.6]">
              <Panel title="Today’s schedule" subtitle="Today">
                <ScheduleTimeline
                  meetings={data.meetingsToday}
                  tasks={data.tasksToday}
                />
              </Panel>
            </div>
            <div className="flex w-full min-w-0 flex-col gap-4 lg:flex-1">
              <Panel title="Activity summary" subtitle="Recent">
                <ActivitySummary recent={data.recentActivity} tasks={data.tasksToday} />
              </Panel>
              {(data.needsReview?.length ?? 0) > 0 ? (
                <Panel
                  title="Needs your review"
                  subtitle="Needs review"
                >
                  <ul className="space-y-2">
                    {(data.needsReview ?? []).slice(0, 6).map((item) => (
                      <li key={item.id}>
                        <Link
                          to={`/contact/${item.id}`}
                          className="flex items-start justify-between gap-2 rounded-xl border-[0.6px] border-[#e5e5e5] px-3 py-2.5 hover:bg-subtle/80"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-text-primary">
                              {item.displayName}
                            </span>
                            <span className="block truncate text-xs text-text-caption">
                              {item.reason?.slice(0, 100) || "Agent needs input"}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${TONE_NEUTRAL}`}
                          >
                            Review
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
              <Panel title="Next best actions" subtitle="Suggested next">
                <NextBestActions
                  tasks={data.tasksToday}
                  leads={data.myLeads}
                  needsReview={data.needsReview}
                />
              </Panel>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <div className="w-full min-w-0 lg:flex-1">
              <ActivityListCard
                title="Recent activity"
                empty="No recent calls, emails, or SMS yet."
                to="/activities"
                items={data.recentActivity.map((a) => ({
                  id: a.id,
                  badge: activityTypeDisplayLabel(a.type),
                  activityType: a.type,
                  title: a.subject,
                  href: `/contact/${a.contactId}`,
                  subtitle: `${a.contactName} · ${relativeTime(a.createdAt)}`,
                }))}
              />
            </div>
            <div className="w-full min-w-0 lg:flex-1">
              <LeadsCard leads={data.myLeads} />
            </div>
          </div>

          <MyCoachingSection items={analytics.myCoaching} />
        </div>
      ) : null}

      {tab === "pipeline" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @2xl:grid-cols-4">
            {REP_HERO.map((id, i) => {
              const card = byId.get(id);
              if (!card) return null;
              return (
                <MetricCard
                  key={card.id}
                  label={card.label}
                  value={card.value}
                  hint={card.hint}
                  to={card.href ?? "/sales"}
                  icon={i === 0 ? Handshake : i === 1 ? TrendingUp : Sparkles}
                />
              );
            })}
          </div>

          <Panel title="My pipeline by stage" subtitle="Created · last 30 days">
            <StageFunnel slices={sales?.funnel ?? []} />
          </Panel>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <div className="w-full min-w-0 lg:flex-[1.6]">
              <Panel title="My opportunities" subtitle="All open deals">
                <OpportunitiesTable
                  deals={data.openDeals}
                  currency={data.salesMetrics?.currency || "USD"}
                />
              </Panel>
            </div>
            <div className="w-full min-w-0 lg:flex-1">
              <Panel title="Aging" subtitle="Days open · last 30 days">
                <AgingHeatStrip slices={sales?.aging ?? []} />
              </Panel>
            </div>
          </div>

          <Panel title="Top opportunities" subtitle="Largest open · last 30 days">
            <TopOpps rows={sales?.topOpportunities ?? []} />
          </Panel>

          {sales?.methodologyNote ? (
            <p className="text-xs text-text-caption">{sales.methodologyNote}</p>
          ) : null}
        </div>
      ) : null}

      {tab === "book" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @2xl:grid-cols-4">
            {REP_BOOK.map((id) => {
              const card = byId.get(id);
              if (!card) return null;
              return (
                <MetricCard
                  key={card.id}
                  label={card.label}
                  value={card.value}
                  hint={card.hint}
                  to={card.href ?? "/sales"}
                  icon={TrendingUp}
                />
              );
            })}
          </div>

          <Panel title="My won revenue" subtitle="Last 6 months">
            <WonRevenueLine
              slices={sales?.wonRevenueTrend ?? []}
              height={180}
              formatValue={(n) =>
                formatMoney(String(n), sales?.currency || "USD")
              }
            />
          </Panel>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <div className="w-full min-w-0 lg:flex-1">
            <Panel title="Won vs lost" subtitle="Closed · last 30 days">
              <OutcomeDonut slices={sales?.winLoss ?? []} />
            </Panel>
            </div>
            <div className="w-full min-w-0 lg:flex-1">
            <DealListCard
              title="Closed won"
              empty="No closed-won deals yet — keep pushing."
              currency={data.salesMetrics?.currency || "USD"}
              deals={data.closedDeals.map((d) => ({
                id: d.id,
                title: d.title,
                meta: d.closedAt
                  ? `${d.companyName} · Closed ${new Date(d.closedAt).toLocaleDateString()}`
                  : d.companyName,
                amount: d.amount,
              }))}
            />
            </div>
          </div>

          <Link
            to="/sales"
            className="inline-flex h-[38px] items-center rounded-lg bg-black px-4 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Open full pipeline
          </Link>
        </div>
      ) : null}
    </WorktualDashboardPanel>
  );
}

function MetricCard({
  label,
  value,
  hint,
  to,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  to: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      to={to}
      className={`${WORKTUAL_KPI_CARD} group`}
    >
      <span
        className={`inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl ${KPI_ICON_TONES[0]}`}
      >
        <Icon className="size-[18px]" strokeWidth={2.25} />
      </span>
      <p className="mt-4 text-xs font-medium tracking-wide text-text-caption uppercase">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-text-primary">
        {value}
      </p>
      <p className="mt-1 line-clamp-2 text-xs text-text-caption">{hint}</p>
    </Link>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex flex-col ${WORKTUAL_CHART_CARD}`}>
      <h2 className="text-sm font-bold text-neutral-900">{title}</h2>
      {subtitle ? (
        <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ScheduleTimeline({
  meetings,
  tasks,
}: {
  meetings: RepOpsData["meetingsToday"];
  tasks: RepOpsData["tasksToday"];
}) {
  const items = [
    ...meetings.map((m) => ({
      id: m.id,
      kind: "meeting" as const,
      subject: m.subject,
      contactId: m.contactId,
      contactName: m.contactName,
      at: m.dueAt,
      overdue: false,
    })),
    ...tasks.map((t) => ({
      id: t.id,
      kind: "task" as const,
      subject: t.subject,
      contactId: t.contactId,
      contactName: t.contactName,
      at: t.dueAt,
      overdue: t.overdue,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  if (items.length === 0) {
    return (
      <p className="text-sm text-text-caption">
        Nothing on the calendar for today.
      </p>
    );
  }

  return (
    <ol className="relative space-y-0 border-l border-border-default ml-2">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`} className="relative pb-4 pl-5 last:pb-0">
          <span
            className={`absolute -left-1.5 top-1.5 size-3 rounded-full border-2 border-surface ${
              item.overdue ? "bg-[#c73e32]" : "bg-neutral-900"
            }`}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span
              className={`text-xs font-medium tabular-nums ${
                item.overdue ? "text-text-danger" : "text-text-caption"
              }`}
            >
              {item.overdue ? "Overdue" : timeLabel(item.at)}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-text-caption">
              {item.kind === "meeting" ? "Meeting" : "Task"}
            </span>
          </div>
          <p className="mt-0.5 text-sm font-medium text-text-primary">
            {item.subject}
          </p>
          <Link
            to={`/contact/${item.contactId}`}
            className="text-xs text-text-secondary hover:text-text-primary hover:underline"
          >
            {item.contactName}
          </Link>
        </li>
      ))}
    </ol>
  );
}

function ActivitySummary({
  recent,
  tasks,
}: {
  recent: RepOpsData["recentActivity"];
  tasks: RepOpsData["tasksToday"];
}) {
  const calls = recent.filter((a) => a.type === "call").length;
  const emails = recent.filter(
    (a) => a.type === "email" || a.type === "sms",
  ).length;
  const chips = [
    { id: "tasks", label: "Tasks", value: tasks.length },
    { id: "calls", label: "Calls", value: calls },
    { id: "emails", label: "Emails", value: emails },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {chips.map((chip) => (
        <div
          key={chip.id}
          className="rounded-xl border-[0.6px] border-[#e5e5e5] px-3 py-3 text-center"
        >
          <p className="text-xl font-semibold tabular-nums text-text-primary">
            {chip.value}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-text-caption">
            {chip.label}
          </p>
        </div>
      ))}
    </div>
  );
}

function NextBestActions({
  tasks,
  leads,
  needsReview = [],
}: {
  tasks: RepOpsData["tasksToday"];
  leads: RepOpsData["myLeads"];
  needsReview?: RepOpsData["needsReview"];
}) {
  const actions = [
    ...(needsReview ?? []).slice(0, 3).map((l) => ({
      id: `review-${l.id}`,
      title: `Review ${l.displayName}`,
      href: `/contact/${l.id}`,
      meta: l.reason?.slice(0, 60) || "Flagged by lifecycle",
      urgency: "High" as const,
    })),
    ...tasks
      .filter((t) => t.overdue)
      .slice(0, 4)
      .map((t) => ({
        id: `task-${t.id}`,
        title: t.subject,
        href: `/contact/${t.contactId}`,
        meta: t.contactName,
        urgency: "High" as const,
      })),
    ...leads
      .filter((l) => l.untouched)
      .slice(0, 4)
      .map((l) => ({
        id: `lead-${l.id}`,
        title: `Follow up with ${l.displayName}`,
        href: `/contact/${l.id}`,
        meta: `${l.ageHours}h untouched`,
        urgency: "Medium" as const,
      })),
  ].slice(0, 6);

  if (actions.length === 0) {
    return (
      <p className="text-sm text-text-caption">
        You’re clear — no overdue tasks or cold leads.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {actions.map((action) => (
        <li key={action.id}>
          <Link
            to={action.href}
            className="flex items-start justify-between gap-3 rounded-xl border-[0.6px] border-[#e5e5e5] px-3 py-2.5 hover:bg-subtle/80"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-text-primary">
                {action.title}
              </span>
              <span className="block truncate text-xs text-text-caption">
                {action.meta}
              </span>
            </span>
            <span
              className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                action.urgency === "High" ? TONE_DANGER : TONE_WARNING
              }`}
            >
              {action.urgency}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function OpportunitiesTable({
  deals,
  currency,
}: {
  deals: RepOpsData["openDeals"];
  currency: string;
}) {
  if (deals.length === 0) {
    return (
      <p className="text-sm text-text-caption">
        No open deals assigned to you.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-default text-xs text-text-caption">
            <th className="pb-2 pr-3 font-medium">Opportunity</th>
            <th className="pb-2 pr-3 font-medium">Stage</th>
            <th className="pb-2 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {deals.slice(0, 8).map((deal) => (
            <tr key={deal.id}>
              <td className="py-2.5 pr-3">
                <Link
                  to={`/sales/${deal.id}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {deal.title}
                </Link>
                <p className="truncate text-xs text-text-caption">
                  {deal.companyName}
                </p>
              </td>
              <td className="py-2.5 pr-3 text-text-secondary">
                {deal.stageLabel}
              </td>
              <td className="py-2.5 text-right tabular-nums font-semibold text-text-primary">
                {deal.amount ? formatMoneyFull(deal.amount, currency) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopOpps({
  rows,
}: {
  rows: NonNullable<RepOpsData["salesMetrics"]>["topOpportunities"];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-caption">No open deals yet.</p>;
  }
  return (
    <ul className="divide-y divide-border-default">
      {rows.slice(0, 6).map((row) => (
        <li
          key={row.id}
          className="flex items-start justify-between gap-3 py-2.5 first:pt-0"
        >
          <div className="min-w-0">
            <Link
              to={`/sales/${row.id}`}
              className="text-sm font-medium text-text-primary hover:underline"
            >
              {row.title}
            </Link>
            <p className="truncate text-xs text-text-caption">
              {row.companyName}
            </p>
          </div>
          <div className="shrink-0 text-right text-xs text-text-secondary">
            <p className="tabular-nums font-semibold text-text-primary">
              {row.amount ?? "—"}
            </p>
            <p>
              {row.stageLabel} · {row.agingDays}d
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityListCard({
  title,
  empty,
  to,
  items,
}: {
  title: string;
  empty: string;
  to: string;
  items: Array<{
    id: string;
    badge: string;
    badgeDanger?: boolean;
    activityType?: string;
    title: string;
    href: string;
    subtitle: string;
  }>;
}) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className={SECTION_H2_CLASS}>{title}</h2>
        <Link
          to={to}
          className="text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          All
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="relative block rounded-lg px-2.5 py-2.5 transition-colors hover:bg-subtle"
            >
              <div className="flex flex-wrap items-center gap-2">
                {item.activityType ? (
                  <ActivityTypeBadge type={item.activityType} />
                ) : (
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                      item.badgeDanger ? TONE_DANGER : TONE_ACCENT
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm font-medium text-text-primary">
                {item.title}
              </p>
              <Link
                to={item.href}
                className="text-sm text-text-secondary hover:text-text-primary hover:underline"
              >
                {item.subtitle}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LeadsCard({ leads }: { leads: RepOpsData["myLeads"] }) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className={SECTION_H2_CLASS}>My leads</h2>
        <Link
          to="/contact?stage=lead"
          className="text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          All
        </Link>
      </div>
      {leads.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">
          No leads assigned to you yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {leads.map((lead) => (
            <li
              key={lead.id}
              className="relative flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-2.5 text-sm hover:bg-subtle"
            >
              <div className="min-w-0">
                <Link
                  to={`/contact/${lead.id}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {lead.displayName}
                </Link>
                <p className="truncate text-xs text-text-caption">
                  {lead.email}
                </p>
              </div>
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                  lead.untouched ? TONE_WARNING : "text-text-caption"
                }`}
              >
                {lead.untouched
                  ? `${lead.ageHours}h untouched`
                  : `Updated ${relativeTime(lead.updatedAt)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DealListCard({
  title,
  empty,
  deals,
  currency,
}: {
  title: string;
  empty: string;
  currency: string;
  deals: Array<{
    id: string;
    title: string;
    meta: string;
    amount: string | null;
  }>;
}) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className={SECTION_H2_CLASS}>{title}</h2>
        <Link
          to="/sales"
          className="text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          Pipeline
        </Link>
      </div>
      {deals.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border-default">
          {deals.map((deal) => (
            <li
              key={deal.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
            >
              <div className="min-w-0">
                <Link
                  to={`/sales/${deal.id}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {deal.title}
                </Link>
                <p className="text-xs text-text-caption">{deal.meta}</p>
              </div>
              {deal.amount ? (
                <span className="tabular-nums text-text-secondary">
                  {formatMoneyFull(deal.amount, currency)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function repWeekStatusTone(status: ScorecardRowStatus): string {
  if (status === "ahead") return TONE_SUCCESS;
  if (status === "behind") return TONE_DANGER;
  return TONE_WARNING;
}

function repWeekStatusLabel(status: ScorecardRowStatus): string {
  if (status === "ahead") return "Ahead of pace";
  if (status === "behind") return "Behind pace";
  return "On track";
}

function MyWeekScorecardCard({
  myWeek,
}: {
  myWeek: NonNullable<RepOpsData["myWeek"]>;
}) {
  const metricLabel =
    myWeek.track === "sqm" ? "SQM this week" : "Quotes sent this week";

  return (
    <section className={WORKTUAL_CHART_CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-neutral-900">My week</h2>
          <p className="mt-0.5 text-sm text-neutral-500">{myWeek.weekLabel}</p>
        </div>
        <span
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${repWeekStatusTone(myWeek.status)}`}
        >
          {repWeekStatusLabel(myWeek.status)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-text-primary">
          {myWeek.achieved}
        </span>
        <span className="text-sm text-text-caption">
          / {myWeek.target} {metricLabel.toLowerCase()}
        </span>
        {myWeek.gap > 0 ? (
          <span className="text-sm text-text-secondary">
            · {myWeek.gap} to target
          </span>
        ) : null}
      </div>
    </section>
  );
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(0, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
