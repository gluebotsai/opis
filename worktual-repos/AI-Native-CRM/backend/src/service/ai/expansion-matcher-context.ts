/**
 * Context + persistence for the Expansion & Revenue Matcher Agent.
 *
 * Judges whether an existing account's own closed-won deal history shows a
 * genuine upsell/cross-sell opportunity (signal band + reasoning) and drafts
 * outreach talking points for the account owner to review and use.
 *
 * HITL rule (hard constraint): this agent only ever writes the four
 * `expansion*` overlay fields on `Company` (plus a notification) — it never
 * creates a deal/quote, never edits any other company profile field, and
 * never contacts the company itself. `expansionDraft` is a human-review-only
 * outreach draft; sending it (or starting a new deal) stays a human action.
 */

import type { DealStage } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { notifyOwnerOrAdmins } from "@/dao/notifications/notify-users";

const DAY_MS = 24 * 60 * 60_000;

export const EXPANSION_SIGNALS = ["none", "watch", "opportunity"] as const;
export type ExpansionSignal = (typeof EXPANSION_SIGNALS)[number];

export function isExpansionSignal(v: unknown): v is ExpansionSignal {
  return typeof v === "string" && (EXPANSION_SIGNALS as readonly string[]).includes(v);
}

export type ExpansionMatcherContext = {
  organizationId: string;
  companyId: string;
  companyName: string;
  industry: string | null;
  employeeCount: number | null;
  ownerUserId: string | null;
  closedWonDealCount: number;
  closedWonTotalAmount: number;
  closedWonAvgAmount: number;
  lastClosedWonAt: string | null;
  daysSinceLastClosedWon: number | null;
  purchasedProductNames: string[];
  openDealCount: number;
  openDealStages: string[];
  candidateProductNames: string[];
  expansionSignal: ExpansionSignal | null;
  expansionReason: string | null;
  expansionLastRunAt: string | null;
};

const OPEN_STAGES: DealStage[] = [
  "qualification",
  "discover",
  "propose",
  "negotiate",
];

export async function buildExpansionContext(
  companyId: string,
  organizationId: string,
): Promise<ExpansionMatcherContext | null> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId },
    select: {
      id: true,
      name: true,
      industry: true,
      employeeCount: true,
      ownerUserId: true,
      expansionSignal: true,
      expansionReason: true,
      expansionLastRunAt: true,
    },
  });
  if (!company) return null;

  const [closedWonDeals, openDeals, candidateProducts] = await Promise.all([
    prisma.deal.findMany({
      where: { companyId, organizationId, stage: "closed_won" },
      orderBy: { closedAt: "desc" },
      select: {
        amount: true,
        closedAt: true,
        quotes: { select: { lines: { select: { name: true } } } },
        invoices: { select: { lines: { select: { name: true } } } },
      },
    }),
    prisma.deal.findMany({
      where: { companyId, organizationId, stage: { in: OPEN_STAGES } },
      select: { stage: true },
    }),
    prisma.product.findMany({
      where: { organizationId, status: "active" },
      orderBy: { name: "asc" },
      take: 50,
      select: { name: true },
    }),
  ]);

  const closedWonDealCount = closedWonDeals.length;
  const closedWonTotalAmount = closedWonDeals.reduce(
    (sum, d) => sum + Number(d.amount ?? 0),
    0,
  );
  const closedWonAvgAmount =
    closedWonDealCount > 0 ? closedWonTotalAmount / closedWonDealCount : 0;
  const lastClosedWonAt = closedWonDeals[0]?.closedAt ?? null;
  const daysSinceLastClosedWon = lastClosedWonAt
    ? Math.floor((Date.now() - lastClosedWonAt.getTime()) / DAY_MS)
    : null;

  const purchasedNames = new Set<string>();
  for (const deal of closedWonDeals) {
    for (const quote of deal.quotes) {
      for (const line of quote.lines) purchasedNames.add(line.name);
    }
    for (const invoice of deal.invoices) {
      for (const line of invoice.lines) purchasedNames.add(line.name);
    }
  }
  const purchasedProductNames = Array.from(purchasedNames).slice(0, 20);

  const candidateProductNames = candidateProducts
    .map((p) => p.name)
    .filter((name) => !purchasedNames.has(name))
    .slice(0, 15);

  return {
    organizationId,
    companyId: company.id,
    companyName: company.name,
    industry: company.industry,
    employeeCount: company.employeeCount,
    ownerUserId: company.ownerUserId ? String(company.ownerUserId) : null,
    closedWonDealCount,
    closedWonTotalAmount,
    closedWonAvgAmount,
    lastClosedWonAt: lastClosedWonAt?.toISOString() ?? null,
    daysSinceLastClosedWon,
    purchasedProductNames,
    openDealCount: openDeals.length,
    openDealStages: openDeals.map((d) => d.stage),
    candidateProductNames,
    expansionSignal: isExpansionSignal(company.expansionSignal)
      ? company.expansionSignal
      : null,
    expansionReason: company.expansionReason,
    expansionLastRunAt: company.expansionLastRunAt?.toISOString() ?? null,
  };
}

export type ExpansionMatcherDecision = {
  signal: ExpansionSignal;
  reason: string;
  outreachDraft: string | null;
};

export async function persistExpansionDecision(
  companyId: string,
  organizationId: string,
  decision: ExpansionMatcherDecision,
): Promise<{ applied: boolean }> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId },
    select: { id: true, name: true, ownerUserId: true },
  });
  if (!company) return { applied: false };

  await prisma.company.update({
    where: { id: companyId },
    data: {
      expansionSignal: decision.signal,
      expansionReason: decision.reason.slice(0, 500),
      expansionDraft: decision.outreachDraft?.slice(0, 2000) ?? null,
      expansionLastRunAt: new Date(),
    },
  });

  if (decision.signal !== "none") {
    await notifyOwnerOrAdmins({
      organizationId,
      ownerUserId: company.ownerUserId ? String(company.ownerUserId) : null,
      kind: "expansion_opportunity",
      title: `Expansion signal on ${company.name}`,
      body: decision.reason.slice(0, 240),
      href: `/company/${companyId}`,
      entityType: "company",
      entityId: companyId,
      metadata: {
        signal: decision.signal,
        seedTools: [
          {
            name: "navigate",
            args: {
              href: `/company/${companyId}`,
              seedPrompt: "Review this account's expansion opportunity and outreach draft",
            },
          },
        ],
        risk: "low",
      },
    }).catch(() => null);
  }

  return { applied: true };
}
