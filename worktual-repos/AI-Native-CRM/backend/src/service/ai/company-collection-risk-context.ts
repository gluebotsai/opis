/**
 * Context + persistence for the Company Collection Risk Agent.
 *
 * Aggregates one customer company's whole invoice payment history into a
 * risk band (none|watch|risk) — distinct from the per-invoice
 * invoice_escalation_agent, this judges the pattern across the account.
 *
 * HITL rule (hard constraint): this agent only ever writes the three
 * `collectionRisk*` overlay fields on `Company` (plus a notification) — it
 * never blocks or pauses the account; that stays a human (Finance/Admin)
 * decision.
 */

import { prisma } from "@/dao/db/prisma";
import { notifyOwnerOrAdmins, notifyUsers } from "@/dao/notifications/notify-users";
import { listFinanceUsers } from "@/service/account/user-directory";

const DAY_MS = 24 * 60 * 60_000;

export const COLLECTION_RISK_LEVELS = ["none", "watch", "risk"] as const;
export type CollectionRiskLevel = (typeof COLLECTION_RISK_LEVELS)[number];

export function isCollectionRiskLevel(v: unknown): v is CollectionRiskLevel {
  return (
    typeof v === "string" &&
    (COLLECTION_RISK_LEVELS as readonly string[]).includes(v)
  );
}

export type CompanyCollectionRiskContext = {
  organizationId: string;
  companyId: string;
  companyName: string;
  totalInvoiceCount: number;
  invoiceHistory: Array<{
    number: string;
    status: string;
    daysLate: number;
    total: number;
  }>;
  openInvoices: Array<{
    id: string;
    number: string;
    daysOverdue: number;
    total: number;
  }>;
  collectionRiskLevel: CollectionRiskLevel | null;
  collectionRiskReason: string | null;
  collectionRiskLastRunAt: string | null;
};

export async function buildCollectionRiskContext(
  companyId: string,
  organizationId: string,
): Promise<CompanyCollectionRiskContext | null> {
  const orgId = BigInt(organizationId);
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: orgId },
    select: {
      id: true,
      name: true,
      collectionRiskLevel: true,
      collectionRiskReason: true,
      collectionRiskLastRunAt: true,
    },
  });
  if (!company) return null;

  const invoices = await prisma.invoice.findMany({
    where: { companyId, organizationId: orgId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      dueAt: true,
      paidAt: true,
    },
  });

  const invoiceHistory = invoices
    .filter((row) => row.status === "paid" && row.dueAt && row.paidAt)
    .slice(0, 20)
    .map((row) => ({
      number: row.number,
      status: row.status,
      daysLate: Math.max(
        0,
        Math.round((row.paidAt!.getTime() - row.dueAt!.getTime()) / DAY_MS),
      ),
      total: Number(row.total),
    }));

  const now = Date.now();
  const openInvoices = invoices
    .filter(
      (row) =>
        (row.status === "sent" || row.status === "overdue") &&
        row.dueAt &&
        row.dueAt.getTime() < now,
    )
    .map((row) => ({
      id: row.id,
      number: row.number,
      daysOverdue: Math.floor((now - row.dueAt!.getTime()) / DAY_MS),
      total: Number(row.total),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    organizationId,
    companyId: company.id,
    companyName: company.name,
    totalInvoiceCount: invoices.length,
    invoiceHistory,
    openInvoices,
    collectionRiskLevel: isCollectionRiskLevel(company.collectionRiskLevel)
      ? company.collectionRiskLevel
      : null,
    collectionRiskReason: company.collectionRiskReason,
    collectionRiskLastRunAt:
      company.collectionRiskLastRunAt?.toISOString() ?? null,
  };
}

export type CollectionRiskDecision = {
  riskLevel: CollectionRiskLevel;
  reason: string;
};

export async function persistCollectionRiskDecision(
  companyId: string,
  organizationId: string,
  decision: CollectionRiskDecision,
): Promise<{ applied: boolean }> {
  const orgId = BigInt(organizationId);
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: orgId },
    select: { id: true, name: true, ownerUserId: true },
  });
  if (!company) return { applied: false };

  await prisma.company.update({
    where: { id: companyId },
    data: {
      collectionRiskLevel: decision.riskLevel,
      collectionRiskReason: decision.reason.slice(0, 500),
      collectionRiskLastRunAt: new Date(),
    },
  });

  if (decision.riskLevel !== "none") {
    await notifyOwnerOrAdmins({
      organizationId,
      ownerUserId: company.ownerUserId ? String(company.ownerUserId) : null,
      kind: "company_collection_risk",
      title: `${company.name} flagged as collection ${decision.riskLevel}`,
      body: decision.reason.slice(0, 240),
      href: `/company/${companyId}`,
      entityType: "company",
      entityId: companyId,
      metadata: { riskLevel: decision.riskLevel, risk: "low" },
    }).catch(() => null);

    if (decision.riskLevel === "risk") {
      const financeUsers = await listFinanceUsers(organizationId);
      if (financeUsers.length > 0) {
        await notifyUsers({
          organizationId,
          recipientUserIds: financeUsers.map((u) => u.id),
          kind: "company_collection_risk",
          title: `Collection risk: ${company.name}`,
          body: decision.reason.slice(0, 240),
          href: `/company/${companyId}`,
          entityType: "company",
          entityId: companyId,
          metadata: { riskLevel: decision.riskLevel },
        }).catch(() => null);
      }
    }
  }

  return { applied: true };
}
