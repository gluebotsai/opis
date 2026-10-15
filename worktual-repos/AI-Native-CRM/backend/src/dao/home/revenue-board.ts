/**
 * Paid-invoice revenue for the admin dashboard.
 * Current and previous calendar quarters in Asia/Kolkata.
 */

import { prisma } from "@/dao/db/prisma";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export type RevenueSlice = {
  id: string;
  label: string;
  amount: number;
};

export type RevenueRepRow = {
  userId: string;
  name: string;
  current: number;
  previous: number;
  changePct: number | null;
};

export type RevenueBoard = {
  currency: string;
  quarterLabel: string;
  previousQuarterLabel: string;
  companyCurrent: number;
  companyPrevious: number;
  companyChangePct: number | null;
  employeeCurrent: number;
  employeePrevious: number;
  reps: RevenueRepRow[];
  byCustomer: RevenueSlice[];
  byProduct: RevenueSlice[];
};

export type PaidInvoiceFact = {
  total: number;
  paidAt: Date;
  companyId: string | null;
  companyName: string | null;
  ownerUserId: string | null;
  lines: Array<{ key: string; label: string; amount: number }>;
};

export function kolkataQuarterBounds(now = new Date()): {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  quarterLabel: string;
  previousQuarterLabel: string;
} {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const quarter = Math.floor(ist.getUTCMonth() / 3);
  const currentStart = quarterStart(year, quarter);
  const currentEnd =
    quarter === 3 ? quarterStart(year + 1, 0) : quarterStart(year, quarter + 1);
  const previousStart =
    quarter === 0 ? quarterStart(year - 1, 3) : quarterStart(year, quarter - 1);
  const previousYear = quarter === 0 ? year - 1 : year;
  const previousQuarter = quarter === 0 ? 3 : quarter - 1;
  return {
    currentStart,
    currentEnd,
    previousStart,
    quarterLabel: `Q${quarter + 1} ${year}`,
    previousQuarterLabel: `Q${previousQuarter + 1} ${previousYear}`,
  };
}

function quarterStart(year: number, quarter: number): Date {
  return new Date(Date.UTC(year, quarter * 3, 1) - IST_OFFSET_MS);
}

export function revenueChangePct(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function rollupPaidInvoices(
  facts: PaidInvoiceFact[],
  bounds: ReturnType<typeof kolkataQuarterBounds>,
  nameById: Map<string, string>,
  currency: string,
): RevenueBoard {
  const ownerCurrent = new Map<string, number>();
  const ownerPrevious = new Map<string, number>();
  const customers = new Map<string, { label: string; amount: number }>();
  const products = new Map<string, { label: string; amount: number }>();
  let companyCurrent = 0;
  let companyPrevious = 0;

  for (const fact of facts) {
    const paidAt = fact.paidAt;
    const inCurrent =
      paidAt >= bounds.currentStart && paidAt < bounds.currentEnd;
    const inPrevious =
      paidAt >= bounds.previousStart && paidAt < bounds.currentStart;
    if (!inCurrent && !inPrevious) continue;
    const total = fact.total;
    if (inCurrent) {
      companyCurrent += total;
      if (fact.ownerUserId && nameById.has(fact.ownerUserId)) {
        ownerCurrent.set(
          fact.ownerUserId,
          (ownerCurrent.get(fact.ownerUserId) ?? 0) + total,
        );
      }
      const companyKey = fact.companyId ?? "__none__";
      const company = customers.get(companyKey) ?? {
        label: fact.companyName?.trim() || "No company",
        amount: 0,
      };
      company.amount += total;
      customers.set(companyKey, company);
      addProductAmounts(products, fact);
    } else {
      companyPrevious += total;
      if (fact.ownerUserId && nameById.has(fact.ownerUserId)) {
        ownerPrevious.set(
          fact.ownerUserId,
          (ownerPrevious.get(fact.ownerUserId) ?? 0) + total,
        );
      }
    }
  }

  const repIds = new Set([...ownerCurrent.keys(), ...ownerPrevious.keys()]);
  const reps = [...repIds]
    .map((userId) => {
      const current = ownerCurrent.get(userId) ?? 0;
      const previous = ownerPrevious.get(userId) ?? 0;
      return {
        userId,
        name: nameById.get(userId) ?? "Rep",
        current,
        previous,
        changePct: revenueChangePct(current, previous),
      };
    })
    .sort((a, b) => b.current - a.current || a.name.localeCompare(b.name));

  const employeeCurrent = reps.reduce((sum, row) => sum + row.current, 0);
  const employeePrevious = reps.reduce((sum, row) => sum + row.previous, 0);

  return {
    currency,
    quarterLabel: bounds.quarterLabel,
    previousQuarterLabel: bounds.previousQuarterLabel,
    companyCurrent,
    companyPrevious,
    companyChangePct: revenueChangePct(companyCurrent, companyPrevious),
    employeeCurrent,
    employeePrevious,
    reps,
    byCustomer: topSlices(customers, 8),
    byProduct: topSlices(products, 8),
  };
}

function addProductAmounts(
  products: Map<string, { label: string; amount: number }>,
  fact: PaidInvoiceFact,
) {
  if (fact.lines.length === 0) {
    const row = products.get("__other__") ?? { label: "Other", amount: 0 };
    row.amount += fact.total;
    products.set("__other__", row);
    return;
  }
  for (const line of fact.lines) {
    const row = products.get(line.key) ?? { label: line.label, amount: 0 };
    row.amount += line.amount;
    products.set(line.key, row);
  }
}

function topSlices(
  rows: Map<string, { label: string; amount: number }>,
  limit: number,
): RevenueSlice[] {
  const sorted = [...rows.entries()]
    .map(([id, row]) => ({ id, label: row.label, amount: row.amount }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1);
  const other = rest.reduce((sum, row) => sum + row.amount, 0);
  if (other > 0) {
    head.push({ id: "__others__", label: "Others", amount: other });
  }
  return head;
}

export async function loadRevenueBoard(
  orgId: string,
  currency: string,
  nameById: Map<string, string>,
  now = new Date(),
): Promise<RevenueBoard> {
  const bounds = kolkataQuarterBounds(now);
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: orgId,
      status: "paid",
      paidAt: { gte: bounds.previousStart, lt: bounds.currentEnd },
    },
    select: {
      total: true,
      paidAt: true,
      companyId: true,
      company: { select: { name: true } },
      deal: { select: { ownerUserId: true } },
      lines: { select: { name: true, productId: true, amount: true } },
    },
  });

  const facts: PaidInvoiceFact[] = invoices.flatMap((invoice) => {
    if (!invoice.paidAt) return [];
    return [
      {
        total: Number(invoice.total),
        paidAt: invoice.paidAt,
        companyId: invoice.companyId,
        companyName: invoice.company?.name ?? null,
        ownerUserId: invoice.deal?.ownerUserId
          ? String(invoice.deal.ownerUserId)
          : null,
        lines: invoice.lines.map((line) => ({
          key: line.productId ?? line.name.trim().toLowerCase(),
          label: line.name.trim() || "Other",
          amount: Number(line.amount),
        })),
      },
    ];
  });

  return rollupPaidInvoices(facts, bounds, nameById, currency);
}
