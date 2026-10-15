import { prisma } from "@/dao/db/prisma";
import { createQuote } from "@/dao/sales/quote-service";
import { getOrCreateOrgFinanceSettings } from "@/dao/finance/org-finance-settings";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { notifyAdmins } from "@/dao/notifications/notify-admins";

async function loadSourceOrderLines(contractId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      sourceOrder: { include: { lines: { orderBy: { sortOrder: "asc" } } } },
      company: { select: { name: true } },
    },
  });
  if (contract?.sourceOrder?.lines.length) {
    return { contract, lines: contract.sourceOrder.lines };
  }

  const contractRow = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { company: { select: { name: true } } },
  });
  if (!contractRow) throw new Error("Contract not found.");

  const lastOrder = await prisma.salesOrder.findFirst({
    where: {
      organizationId: contractRow.organizationId,
      companyId: contractRow.companyId,
      status: { not: "cancelled" },
    },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  if (!lastOrder?.lines.length) {
    throw new Error("No prior order lines found to clone for renewal quote.");
  }
  return { contract: contractRow, lines: lastOrder.lines };
}

export async function cloneRenewalQuoteFromContract(input: {
  contractId: string;
  dealId: string;
  actorUserId?: string | null;
  organizationId?: string | null;
}) {
  const orgId = await resolveRequestOrganizationId(input.organizationId);
  const contract = await prisma.contract.findFirst({
    where: { id: input.contractId, organizationId: orgId },
  });
  if (!contract) throw new Error("Contract not found.");
  if (contract.renewDealId && contract.renewDealId !== input.dealId) {
    throw new Error("Contract is linked to a different renewal deal.");
  }

  const existing = await prisma.quote.findFirst({
    where: {
      dealId: input.dealId,
      renewalContractId: contract.id,
      status: { in: ["draft", "sent"] },
    },
  });
  if (existing) return existing;

  const { lines } = await loadSourceOrderLines(contract.id);
  const quote = await createQuote({
    dealId: input.dealId,
    organizationId: orgId,
    createdByUserId: input.actorUserId,
    notes: `Renewal quote cloned from contract ending ${contract.endsAt.toISOString().slice(0, 10)}`,
    lines: lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
    })),
  });

  await prisma.quote.update({
    where: { id: quote.id },
    data: { renewalContractId: contract.id },
  });

  const deal = await prisma.deal.findUnique({
    where: { id: input.dealId },
    select: { title: true, ownerUserId: true, company: { select: { name: true } } },
  });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "create",
    entityType: "quote",
    entityId: quote.id,
    organizationId: orgId,
    meta: { renewalContractId: contract.id, kind: "renewal_quote" },
  });

  await notifyAdmins({
    organizationId: orgId,
    kind: "quote_created",
    quoteId: quote.id,
    quoteNumber: quote.number,
    dealId: input.dealId,
    dealTitle: deal?.title,
    companyName: deal?.company?.name,
    ownerUserId: deal?.ownerUserId?.toString(),
    detail: "Draft renewal quote created from contract lines.",
  });

  return quote;
}

export async function maybeAutoCreateRenewalQuote(input: {
  contractId: string;
  dealId: string;
  organizationId?: string | null;
}) {
  const orgId = await resolveRequestOrganizationId(input.organizationId);
  const settings = await getOrCreateOrgFinanceSettings(orgId);
  if (!settings.renewalQuoteAutoCreate) return null;
  return cloneRenewalQuoteFromContract({
    contractId: input.contractId,
    dealId: input.dealId,
    organizationId: orgId,
  });
}
