import {
  loadDashboardAnalytics,
  type DashboardAnalyticsData,
} from "@/dao/reports/report-service";
import { listUserActivities } from "@/dao/activities/activity-feed-service";
import { listDeals } from "@/dao/sales/deal-service";
import { listInvoices } from "@/dao/finance/invoice-service";
import { listContacts } from "@/dao/contacts/contact-service";
import { prisma } from "@/dao/db/prisma";
import { formatDashboardMoney, resolveDashboardCurrency } from "@/lib/commercial-currency";
import {
  resolveRecordOwnerScope,
  type RecordOwnerScope,
} from "@/service/auth/ownership-scope";
import type { AppRole } from "@/service/auth/rbac";
import { DEAL_STAGES } from "@/service/sales/stages";
import { getCurrentBusinessType, getCurrentOrganizationId } from "@/service/auth/require-role";
import type { BusinessType } from "@/config/modules";
import {
  getAdminOpsDashboard,
  type AdminOpsData,
  type AdminOpsQuery,
} from "@/dao/home/admin-ops-dashboard";
import {
  getRepOpsDashboard,
  type RepOpsData,
} from "@/dao/home/rep-ops-dashboard";

export type HomePersona =
  | "admin"
  | "manager"
  | "rep"
  | "finance"
  | "marketing"
  | "viewer";

export type KpiCard = {
  id: string;
  label: string;
  value: string;
  hint: string;
  href?: string;
};

export type ChartSlice = {
  id: string;
  label: string;
  value: number;
};

export type HomeDashboardData = {
  persona: HomePersona;
  role: AppRole;
  businessType: BusinessType;
  userId: string | null;
  title: string;
  subtitle: string;
  periodLabel: string;
  kpis: KpiCard[];
  pipelineBars: ChartSlice[];
  statusDonut: ChartSlice[];
  dueActivities: Array<{
    id: string;
    type: string;
    subject: string;
    dueAt: string | null;
    contactId: string;
    contactName: string;
  }>;
  openDeals: Array<{
    id: string;
    title: string;
    stage: string;
    amount: string | null;
    companyName: string;
  }>;
  openInvoices: Array<{
    id: string;
    number: string;
    total: string;
    currency: string;
    companyName: string;
    status: string;
  }>;
  recentContacts: Array<{
    id: string;
    displayName: string;
    email: string;
    contactType: string | null;
  }>;
  /** Admin / sales_manager ops widgets (B2B team dashboard). */
  adminOps?: AdminOpsData | null;
  /** Sales rep personal ops widgets (B2B / B2B2C). */
  repOps?: RepOpsData | null;
  /** Coaching, funnel snapshot, and win/loss rollup (all personas). */
  analytics: DashboardAnalyticsData;
};

function personaForRole(role: AppRole): HomePersona {
  switch (role) {
    case "admin":
      return "admin";
    case "sales_manager":
      return "manager";
    case "finance":
      return "finance";
    case "marketing":
      return "marketing";
    case "viewer":
      return "viewer";
    default:
      return "rep";
  }
}

function money(n: number, currency: string): string {
  return formatDashboardMoney(n, currency);
}

function copyForPersona(persona: HomePersona): {
  title: string;
  subtitle: string;
} {
  switch (persona) {
    case "admin":
      return {
        title: "Admin overview",
        subtitle: "Org health across pipeline, inbox, and finance.",
      };
    case "manager":
      return {
        title: "Sales manager home",
        subtitle: "Team pipeline, win/loss, and deals needing attention.",
      };
    case "finance":
      return {
        title: "Finance home",
        subtitle: "Invoices, outstanding balances, and payment status.",
      };
    case "marketing":
      return {
        title: "Marketing home",
        subtitle: "Contacts and engagement signals you can act on.",
      };
    case "viewer":
      return {
        title: "Read-only overview",
        subtitle: "Snapshot of pipeline and activity — no edits from here.",
      };
    default:
      return {
        title: "My work",
        subtitle: "Your inbox, due activities, and open opportunities.",
      };
  }
}

export async function getHomeDashboard(
  query: AdminOpsQuery = {},
): Promise<HomeDashboardData> {
  const [scope, businessType] = await Promise.all([
    resolveRecordOwnerScope(),
    getCurrentBusinessType(),
  ]);
  const persona = personaForRole(scope.role);
  const orgId = await getCurrentOrganizationId();
  const base = emptyHome(persona, scope, businessType);

  let result: HomeDashboardData;
  switch (persona) {
    case "finance":
      result = await enrichFinance(base, orgId);
      break;
    case "marketing":
      result = await enrichMarketing(base, scope, orgId);
      break;
    case "admin":
    case "manager":
      result = await enrichOrgWide(base, scope, orgId, persona, query);
      break;
    case "viewer":
    default:
      result = await enrichRep(base, scope, orgId);
      break;
  }

  const analytics = await loadDashboardAnalytics();
  return { ...result, analytics };
}

async function enrichRep(
  base: HomeDashboardData,
  scope: RecordOwnerScope,
  orgId: string,
): Promise<HomeDashboardData> {
  const userId = scope.userId;
  if (!userId) return base;

  const loadRepOps =
    base.businessType === "b2b" || base.businessType === "b2b2c";

  if (loadRepOps) {
    const repOps = await getRepOpsDashboard(userId);
    return {
      ...base,
      title: "My work",
      subtitle: "Meetings, tasks, leads, and deals on your book today.",
      periodLabel: "Today",
      repOps,
      kpis: [],
      pipelineBars: [],
      statusDonut: [],
      dueActivities: [],
      openDeals: [],
    };
  }

  const currency = await resolveDashboardCurrency(orgId);
  const [activities, deals, inboxCount, stageGroups] = await Promise.all([
    listUserActivities({ userId, page: 1, pageSize: 40 }),
    listDeals({ page: 1, pageSize: 10, ownerUserId: scope.ownerUserId }),
    prisma.contactActivity.count({
      where: {
        organizationId: orgId,
        folder: "inbox",
        createdByUserId: userId,
      },
    }),
    prisma.deal.groupBy({
      by: ["stage"],
      where: {
        organizationId: orgId,
        ...(scope.ownerUserId ? { ownerUserId: scope.ownerUserId } : {}),
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  const openDeals = deals.items
    .filter((d) => d.stage !== "closed_won" && d.stage !== "closed_lost")
    .slice(0, 8)
    .map(mapDeal);

  const pipelineValue = stageGroups
    .filter((g) => g.stage !== "closed_won" && g.stage !== "closed_lost")
    .reduce((s, g) => s + Number(g._sum.amount ?? 0), 0);
  const openDealCount = stageGroups
    .filter((g) => g.stage !== "closed_won" && g.stage !== "closed_lost")
    .reduce((s, g) => s + g._count._all, 0);
  const wonCount =
    stageGroups.find((g) => g.stage === "closed_won")?._count._all ?? 0;

  return {
    ...base,
    kpis: [
      {
        id: "inbox",
        label: "Inbox",
        value: String(inboxCount),
        hint: "Unread",
        href: "/inbox",
      },
      {
        id: "open-deals",
        label: "Open deals",
        value: String(openDealCount),
        hint: "Your deals",
        href: "/sales",
      },
      {
        id: "pipeline",
        label: "Pipeline value",
        value: money(pipelineValue, currency),
        hint: "Open value",
        href: "/sales",
      },
      {
        id: "won",
        label: "Closed won",
        value: String(wonCount),
        hint: "All closed won",
        href: "/sales",
      },
    ],
    pipelineBars: barsFromStages(stageGroups),
    statusDonut: [
      { id: "open", label: "Open", value: openDealCount },
      { id: "won", label: "Won", value: wonCount },
      {
        id: "lost",
        label: "Lost",
        value:
          stageGroups.find((g) => g.stage === "closed_lost")?._count._all ?? 0,
      },
    ],
    dueActivities: dueFromActivities(activities.items),
    openDeals,
    repOps: null,
  };
}

async function enrichOrgWide(
  base: HomeDashboardData,
  scope: RecordOwnerScope,
  orgId: string,
  persona: HomePersona,
  query: AdminOpsQuery = {},
): Promise<HomeDashboardData> {
  const loadAdminOps =
    (persona === "admin" || persona === "manager") &&
    (base.businessType === "b2b" || base.businessType === "b2b2c");
  const currency = await resolveDashboardCurrency(orgId);

  const [
    funnelSnap,
    stageGroups,
    deals,
    inboxCount,
    invoiceGroups,
    invoices,
    adminOps,
  ] = await Promise.all([
      loadDashboardAnalytics().then((a) => a.funnelSnapshot),
      prisma.deal.groupBy({
        by: ["stage"],
        where: { organizationId: orgId },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      listDeals({ page: 1, pageSize: 10 }),
      prisma.contactActivity.count({
        where: { organizationId: orgId, folder: "inbox" },
      }),
      prisma.invoice.groupBy({
        by: ["status"],
        where: { organizationId: orgId },
        _count: { _all: true },
        _sum: { total: true },
      }),
      listInvoices({ page: 1 }),
      loadAdminOps ? getAdminOpsDashboard(query) : Promise.resolve(null),
    ]);

  const openDealCount = stageGroups
    .filter((g) => g.stage !== "closed_won" && g.stage !== "closed_lost")
    .reduce((s, g) => s + g._count._all, 0);
  const pipelineValue = stageGroups
    .filter((g) => g.stage !== "closed_won" && g.stage !== "closed_lost")
    .reduce((s, g) => s + Number(g._sum.amount ?? 0), 0);
  const wonCount =
    stageGroups.find((g) => g.stage === "closed_won")?._count._all ?? 0;
  const outstanding = invoiceGroups
    .filter((g) => g.status !== "paid" && g.status !== "void")
    .reduce((s, g) => s + Number(g._sum.total ?? 0), 0);
  const paid = Number(
    invoiceGroups.find((g) => g.status === "paid")?._sum.total ?? 0,
  );

  const kpis: KpiCard[] =
    persona === "viewer"
      ? [
          {
            id: "open-deals",
            label: "Open deals",
            value: String(openDealCount),
            hint: "All open deals",
            href: "/sales",
          },
          {
            id: "pipeline",
            label: "Pipeline value",
            value: money(pipelineValue, currency),
            hint: "Open value",
            href: "/sales",
          },
          {
            id: "won",
            label: "Won",
            value: String(
              funnelSnap ? funnelSnap.wonCount : wonCount,
            ),
            hint: "Closed won",
            href: "/sales?stage=closed_won",
          },
          {
            id: "inbox",
            label: "Inbox items",
            value: String(inboxCount),
            hint: "Inbox",
            href: "/inbox",
          },
        ]
      : [
          {
            id: "open-deals",
            label: "Open deals",
            value: String(openDealCount),
            hint: persona === "admin" ? "All open deals" : "Team open deals",
            href: "/sales",
          },
          {
            id: "pipeline",
            label: "Pipeline value",
            value: money(pipelineValue, currency),
            hint: "Open value",
            href: "/sales",
          },
          {
            id: "won",
            label: "Closed won",
            value: String(
              funnelSnap ? funnelSnap.wonCount : wonCount,
            ),
            hint: "Closed won",
            href: "/dashboard?tab=pipeline",
          },
          {
            id: "finance",
            label: "Outstanding",
            value: money(outstanding, currency),
            hint: paid > 0 ? `${money(paid, currency)} collected` : "Unpaid invoices",
            href: "/finance",
          },
        ];

  return {
    ...base,
    periodLabel: adminOps
      ? `${
          adminOps.monthlyMetrics.period === "today"
            ? "Today"
            : adminOps.monthlyMetrics.period === "yesterday"
              ? "Yesterday"
              : adminOps.monthlyMetrics.period === "week"
                ? "Last 7 days"
                : adminOps.monthlyMetrics.period === "quarter"
                  ? "This quarter"
                  : "Last 30 days"
        } · Team ops`
      : base.periodLabel,
    kpis,
    pipelineBars: barsFromStages(stageGroups),
    statusDonut:
      persona === "admin"
        ? invoiceGroups.map((g) => ({
            id: g.status,
            label: g.status,
            value: g._count._all,
          }))
        : [
            { id: "open", label: "Open", value: openDealCount },
            { id: "won", label: "Won", value: wonCount },
            {
              id: "lost",
              label: "Lost",
              value:
                stageGroups.find((g) => g.stage === "closed_lost")?._count
                  ._all ?? 0,
            },
          ],
    openDeals: deals.items.slice(0, 8).map(mapDeal),
    openInvoices: invoices.items
      .filter((i) => i.status !== "paid" && i.status !== "void")
      .slice(0, 8)
      .map(mapInvoice),
    dueActivities:
      scope.userId && persona !== "viewer"
        ? dueFromActivities(
            (
              await listUserActivities({
                userId: scope.userId,
                page: 1,
                pageSize: 40,
                ownerScope: "all",
              })
            ).items,
          )
        : [],
    adminOps,
  };
}

async function enrichFinance(
  base: HomeDashboardData,
  orgId: string,
): Promise<HomeDashboardData> {
  const currency = await resolveDashboardCurrency(orgId);
  const [invoiceGroups, invoices] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: { _all: true },
      _sum: { total: true },
    }),
    listInvoices({ page: 1 }),
  ]);

  const paid = Number(
    invoiceGroups.find((g) => g.status === "paid")?._sum.total ?? 0,
  );
  const outstanding = invoiceGroups
    .filter((g) => g.status !== "paid" && g.status !== "void")
    .reduce((s, g) => s + Number(g._sum.total ?? 0), 0);
  const invoiceTotal = invoiceGroups
    .filter((g) => g.status !== "void")
    .reduce((s, g) => s + Number(g._sum.total ?? 0), 0);
  const openCount = invoiceGroups
    .filter((g) => g.status !== "paid" && g.status !== "void")
    .reduce((s, g) => s + g._count._all, 0);

  return {
    ...base,
    kpis: [
      {
        id: "total",
        label: "Invoice volume",
        value: money(invoiceTotal, currency),
        hint: "Excluding void",
        href: "/finance",
      },
      {
        id: "paid",
        label: "Collected",
        value: money(paid, currency),
        hint: "Paid",
        href: "/finance",
      },
      {
        id: "outstanding",
        label: "Outstanding",
        value: money(outstanding, currency),
        hint: `${openCount} open invoices`,
        href: "/finance",
      },
      {
        id: "open-count",
        label: "Open invoices",
        value: String(openCount),
        hint: "Needs attention",
        href: "/finance",
      },
    ],
    pipelineBars: invoiceGroups.map((g) => ({
      id: g.status,
      label: g.status,
      value: Number(g._sum.total ?? 0),
    })),
    statusDonut: invoiceGroups.map((g) => ({
      id: g.status,
      label: g.status,
      value: g._count._all,
    })),
    openInvoices: invoices.items
      .filter((i) => i.status !== "paid" && i.status !== "void")
      .slice(0, 10)
      .map(mapInvoice),
  };
}

async function enrichMarketing(
  base: HomeDashboardData,
  scope: RecordOwnerScope,
  orgId: string,
): Promise<HomeDashboardData> {
  const [contacts, inboxCount, activities] = await Promise.all([
    listContacts({
      page: 1,
      pageSize: 8,
      ownerUserId: scope.ownerUserId,
      channelCompanyIds: scope.channelCompanyIds,
    }),
    prisma.contactActivity.count({
      where: {
        organizationId: orgId,
        folder: "inbox",
        ...(scope.userId ? { createdByUserId: scope.userId } : {}),
      },
    }),
    scope.userId
      ? listUserActivities({ userId: scope.userId, page: 1, pageSize: 40 })
      : Promise.resolve({ items: [] as Awaited<
          ReturnType<typeof listUserActivities>
        >["items"] }),
  ]);

  const leadCount = contacts.items.filter(
    (c) => c.person.contactType === "lead",
  ).length;

  return {
    ...base,
    kpis: [
      {
        id: "contacts",
        label: "Contacts",
        value: String(contacts.pagination.total),
        hint: "All contacts",
        href: "/contact",
      },
      {
        id: "leads",
        label: "Leads (page)",
        value: String(leadCount),
        hint: "On this page",
        href: "/contact?stage=lead",
      },
      {
        id: "inbox",
        label: "Inbox",
        value: String(inboxCount),
        hint: "Your mailbox",
        href: "/inbox",
      },
      {
        id: "activities",
        label: "Recent activities",
        value: String(activities.items.length),
        hint: "Recent",
        href: "/activities",
      },
    ],
    pipelineBars: [
      {
        id: "lead",
        label: "Lead",
        value: contacts.items.filter((c) => c.person.contactType === "lead")
          .length,
      },
      {
        id: "prospect",
        label: "Prospect",
        value: contacts.items.filter((c) => c.person.contactType === "prospect")
          .length,
      },
      {
        id: "customer",
        label: "Customer",
        value: contacts.items.filter((c) => c.person.contactType === "customer")
          .length,
      },
    ],
    statusDonut: [
      { id: "inbox", label: "Inbox", value: inboxCount },
      {
        id: "contacts",
        label: "Contacts",
        value: Math.min(contacts.pagination.total, 100),
      },
    ],
    recentContacts: contacts.items.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      email: c.person.email,
      contactType: c.person.contactType,
    })),
    dueActivities: dueFromActivities(activities.items),
  };
}

function barsFromStages(
  stageGroups: Array<{
    stage: string;
    _count: { _all: number };
  }>,
): ChartSlice[] {
  const map = new Map(stageGroups.map((g) => [g.stage, g._count._all]));
  return DEAL_STAGES.filter((s) => s !== "closed_lost").map((stage) => ({
    id: stage,
    label: stage.replace(/_/g, " "),
    value: map.get(stage) ?? 0,
  }));
}

function dueFromActivities(
  items: Array<{
    id: string;
    type: string;
    subject: string;
    dueAt: string | null;
    contactId: string;
    contactName: string;
  }>,
) {
  const now = Date.now();
  const weekAhead = now + 7 * 24 * 60 * 60 * 1000;
  return items
    .filter((a) => {
      if (!a.dueAt) return false;
      const t = new Date(a.dueAt).getTime();
      return t <= weekAhead;
    })
    .slice(0, 8)
    .map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      dueAt: a.dueAt,
      contactId: a.contactId,
      contactName: a.contactName,
    }));
}

function mapDeal(d: {
  id: string;
  title: string;
  stage: string;
  amount: { toString(): string } | null;
  company: { name: string };
}) {
  return {
    id: d.id,
    title: d.title,
    stage: d.stage,
    amount: d.amount?.toString() ?? null,
    companyName: d.company.name,
  };
}

function mapInvoice(inv: {
  id: string;
  number: string;
  total: { toString(): string };
  currency: string;
  status: string;
  company: { name: string } | null;
}) {
  return {
    id: inv.id,
    number: inv.number,
    total: inv.total.toString(),
    currency: inv.currency,
    companyName: inv.company?.name ?? "—",
    status: inv.status,
  };
}

function emptyHome(
  persona: HomePersona,
  scope: RecordOwnerScope,
  businessType: BusinessType,
): HomeDashboardData {
  const { title, subtitle } = copyForPersona(persona);
  return {
    persona,
    role: scope.role,
    businessType,
    userId: scope.userId,
    title,
    subtitle,
    periodLabel: "This month",
    kpis: [],
    pipelineBars: [],
    statusDonut: [],
    dueActivities: [],
    openDeals: [],
    openInvoices: [],
    recentContacts: [],
    adminOps: null,
    repOps: null,
  };
}
