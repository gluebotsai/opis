/**
 * Context + persistence for the Revenue Gap Forecast Agent.
 *
 * Per-organization: collected revenue this period vs. optional configured
 * targets, plus at-risk (open overdue) invoices ranked by value. Read-only —
 * caches the forecast on `OrgFinanceSettings.revenueForecastLastRun*` for the
 * existing Finance dashboard/home rollup to read; no new UI surface, no
 * invoice/deal/setting mutation, never contacts a customer.
 */

import { prisma } from "@/dao/db/prisma";

const DAY_MS = 24 * 60 * 60_000;

export type RevenueGapForecastContext = {
  organizationId: string;
  periodLabel: string;
  currency: string | null;
  collectedRevenue: number;
  revenueTargetMonthly: number | null;
  revenueTargetQuarterly: number | null;
  atRiskInvoices: Array<{
    id: string;
    number: string;
    total: number;
    currency: string;
    daysOverdue: number;
    companyName: string | null;
  }>;
};

export async function buildRevenueGapContext(
  organizationId: string,
): Promise<RevenueGapForecastContext | null> {
  const orgId = BigInt(organizationId);
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodLabel = periodStart.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const [settings, paidThisPeriod, atRisk] = await Promise.all([
    prisma.orgFinanceSettings.findUnique({
      where: { organizationId: orgId },
      select: { revenueTargetMonthly: true, revenueTargetQuarterly: true },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: "paid",
        paidAt: { gte: periodStart },
      },
      select: { total: true, currency: true },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["sent", "overdue"] },
        dueAt: { lt: now },
      },
      orderBy: { total: "desc" },
      take: 15,
      select: {
        id: true,
        number: true,
        total: true,
        currency: true,
        dueAt: true,
        company: { select: { name: true } },
      },
    }),
  ]);

  const collectedRevenue = paidThisPeriod.reduce(
    (sum, row) => sum + Number(row.total),
    0,
  );
  const currency =
    paidThisPeriod[0]?.currency ?? atRisk[0]?.currency ?? null;

  const atRiskInvoices = atRisk.map((row) => ({
    id: row.id,
    number: row.number,
    total: Number(row.total),
    currency: row.currency,
    daysOverdue: row.dueAt
      ? Math.floor((now.getTime() - row.dueAt.getTime()) / DAY_MS)
      : 0,
    companyName: row.company?.name ?? null,
  }));

  return {
    organizationId,
    periodLabel,
    currency,
    collectedRevenue,
    revenueTargetMonthly: settings?.revenueTargetMonthly
      ? Number(settings.revenueTargetMonthly)
      : null,
    revenueTargetQuarterly: settings?.revenueTargetQuarterly
      ? Number(settings.revenueTargetQuarterly)
      : null,
    atRiskInvoices,
  };
}

export type RevenueGapForecastDecision = {
  hasTarget: boolean;
  narrative: string;
  atRiskInvoiceIds: string[];
  gapScenario: string;
};

export async function persistRevenueGapDecision(
  organizationId: string,
  decision: RevenueGapForecastDecision,
): Promise<{ applied: boolean }> {
  const { getOrCreateOrgFinanceSettings } = await import(
    "@/dao/finance/org-finance-settings"
  );
  await getOrCreateOrgFinanceSettings(organizationId);
  const orgId = BigInt(organizationId);
  await prisma.orgFinanceSettings.update({
    where: { organizationId: orgId },
    data: {
      revenueForecastLastRun: decision,
      revenueForecastLastRunAt: new Date(),
    },
  });
  return { applied: true };
}
