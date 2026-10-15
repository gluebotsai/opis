import type { ContractStatus, ProductBillingFrequency } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { getOrCreateOrgFinanceSettings } from "@/dao/finance/org-finance-settings";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";

export type ContractListItem = {
  id: string;
  companyId: string;
  companyName: string | null;
  dealId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  arr: number | null;
  autoRenew: boolean;
  status: ContractStatus;
  billingFrequency: ProductBillingFrequency | null;
  renewDealId: string | null;
  sourceOrderId: string | null;
  daysUntilEnd: number;
  atRisk: boolean;
};

function daysUntil(date: Date): number {
  const now = new Date();
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / 86_400_000);
}

function mapContract(row: {
  id: string;
  companyId: string;
  company?: { name: string | null } | null;
  dealId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  arr: { toString(): string } | null;
  autoRenew: boolean;
  status: ContractStatus;
  billingFrequency: ProductBillingFrequency | null;
  renewDealId: string | null;
  sourceOrderId: string | null;
}): ContractListItem {
  const until = daysUntil(row.endsAt);
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    dealId: row.dealId,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    arr: row.arr != null ? Number(row.arr) : null,
    autoRenew: row.autoRenew,
    status: row.status,
    billingFrequency: row.billingFrequency,
    renewDealId: row.renewDealId,
    sourceOrderId: row.sourceOrderId,
    daysUntilEnd: until,
    atRisk: until <= 90 && !row.renewDealId && row.status === "active",
  };
}

const contractInclude = {
  company: { select: { name: true } },
} as const;

export async function listContractsByCompany(
  companyId: string,
  organizationId?: string | null,
) {
  const orgId = await resolveRequestOrganizationId(organizationId);
  const rows = await prisma.contract.findMany({
    where: { organizationId: orgId, companyId },
    include: contractInclude,
    orderBy: { endsAt: "desc" },
  });
  return rows.map(mapContract);
}

export async function getContractById(
  id: string,
  organizationId?: string | null,
) {
  const orgId = await resolveRequestOrganizationId(organizationId);
  const row = await prisma.contract.findFirst({
    where: { id, organizationId: orgId },
    include: {
      ...contractInclude,
      billingSchedules: {
        orderBy: { scheduledFor: "asc" },
        take: 24,
      },
    },
  });
  if (!row) return null;
  return {
    ...mapContract(row),
    billingSchedules: row.billingSchedules.map((s) => ({
      id: s.id,
      billingKind: s.billingKind,
      scheduledFor: s.scheduledFor.toISOString().slice(0, 10),
      status: s.status,
      invoiceId: s.invoiceId,
      amount: s.amount != null ? Number(s.amount) : null,
      currency: s.currency,
    })),
  };
}

export async function listAtRiskContracts(
  organizationId?: string | null,
  withinDays = 90,
) {
  const orgId = await resolveRequestOrganizationId(organizationId);
  const until = new Date();
  until.setDate(until.getDate() + withinDays);
  const rows = await prisma.contract.findMany({
    where: {
      organizationId: orgId,
      status: "active",
      renewDealId: null,
      endsAt: { lte: until },
    },
    include: contractInclude,
    orderBy: { endsAt: "asc" },
    take: 200,
  });
  return {
    items: rows.map(mapContract),
    totalArrAtRisk: rows.reduce(
      (sum, row) => sum + (row.arr != null ? Number(row.arr) : 0),
      0,
    ),
  };
}

export async function patchContract(
  id: string,
  input: {
    autoRenew?: boolean;
    renewDealId?: string | null;
    status?: ContractStatus;
    cancelReason?: string | null;
  },
  actorUserId?: string | null,
  organizationId?: string | null,
) {
  const orgId = await resolveRequestOrganizationId(organizationId);
  const existing = await prisma.contract.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) throw new Error("Contract not found.");

  const data: {
    autoRenew?: boolean;
    renewDealId?: string | null;
    status?: ContractStatus;
    cancelledAt?: Date | null;
    cancelReason?: string | null;
  } = {};

  if (input.autoRenew !== undefined) data.autoRenew = input.autoRenew;
  if (input.renewDealId !== undefined) data.renewDealId = input.renewDealId;
  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === "cancelled") {
      data.cancelledAt = new Date();
      data.cancelReason = input.cancelReason?.trim() || "Cancelled";
    }
  }

  const updated = await prisma.contract.update({
    where: { id },
    data,
    include: contractInclude,
  });

  await writeAuditLog({
    actorUserId,
    action: "update",
    entityType: "contract",
    entityId: id,
    organizationId: orgId,
    meta: input,
  });

  return mapContract(updated);
}

export async function extendContractFromRenewalWon(input: {
  contractId: string;
  dealAmount: number | null;
  termMonths?: number;
  organizationId?: string | null;
}) {
  const orgId = await resolveRequestOrganizationId(input.organizationId);
  const settings = await getOrCreateOrgFinanceSettings(orgId);
  const contract = await prisma.contract.findFirst({
    where: { id: input.contractId, organizationId: orgId },
  });
  if (!contract) throw new Error("Contract not found.");

  const termMonths = input.termMonths ?? 12;
  const newEndsAt = new Date(contract.endsAt);
  newEndsAt.setMonth(newEndsAt.getMonth() + termMonths);

  return prisma.contract.update({
    where: { id: contract.id },
    data: {
      endsAt: newEndsAt,
      arr: input.dealAmount ?? contract.arr,
      status: "active",
      autoRenew: contract.autoRenew || settings.autoRenewDefault,
      renewDealId: null,
      renewalRemindedAt: null,
    },
  });
}
