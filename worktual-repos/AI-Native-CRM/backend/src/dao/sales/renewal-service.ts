import { prisma } from "@/dao/db/prisma";
import { createDeal } from "@/dao/sales/deal-service";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { getOrCreateOrgFinanceSettings } from "@/dao/finance/org-finance-settings";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { notifyAdmins } from "@/dao/notifications/notify-admins";
import { maybeAutoCreateRenewalQuote } from "@/service/sales/renewal-quote-service";

/**
 * Create renewal deals for contracts ending within the org renewal window
 * that have not yet been linked to a renew deal.
 */
export async function processRenewals(organizationId?: string | null) {
  const orgId = await resolveRequestOrganizationId(organizationId);
  const settings = await getOrCreateOrgFinanceSettings(orgId);
  const windowDays = Math.max(1, settings.renewalWindowDays);
  const now = new Date();
  const until = new Date();
  until.setDate(until.getDate() + windowDays);

  const contracts = await prisma.contract.findMany({
    where: {
      organizationId: orgId,
      status: "active",
      endsAt: { gte: now, lte: until },
      renewDealId: null,
    },
    take: 100,
    orderBy: { endsAt: "asc" },
    include: { company: { select: { name: true } } },
  });

  let created = 0;
  let quotesCreated = 0;
  for (const contract of contracts) {
    const location = await prisma.companyLocation.findFirst({
      where: { companyId: contract.companyId },
      orderBy: { createdAt: "asc" },
    });
    if (!location) continue;

    const deal = await createDeal({
      title: `Renewal — ${contract.title}`,
      stage: "qualification",
      amount: contract.arr ? Number(contract.arr) : null,
      companyId: contract.companyId,
      locationId: location.id,
      notes: `Auto-created renewal for contract ending ${contract.endsAt.toISOString().slice(0, 10)}`,
    });

    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        renewDealId: deal.id,
        renewalRemindedAt: new Date(),
      },
    });

    await writeAuditLog({
      action: "create",
      entityType: "deal",
      entityId: deal.id,
      organizationId: orgId,
      meta: { kind: "renewal", contractId: contract.id },
    });

    await notifyAdmins({
      organizationId: orgId,
      kind: "contract_renewal_due",
      dealId: deal.id,
      dealTitle: deal.title,
      companyName: contract.company?.name,
      entityType: "contract",
      entityId: contract.id,
      detail: `Contract ends ${contract.endsAt.toISOString().slice(0, 10)} — renewal deal created.`,
    });

    try {
      const quote = await maybeAutoCreateRenewalQuote({
        contractId: contract.id,
        dealId: deal.id,
        organizationId: orgId,
      });
      if (quote) quotesCreated += 1;
    } catch (err) {
      console.error("maybeAutoCreateRenewalQuote failed", contract.id, err);
    }

    created += 1;
  }

  return { scanned: contracts.length, created, quotesCreated };
}

export async function createContractFromWonDeal(input: {
  companyId: string;
  dealId: string;
  title: string;
  arr?: number | null;
  termMonths?: number;
  organizationId?: string | null;
  autoRenew?: boolean;
  sourceOrderId?: string | null;
}) {
  const orgId = await resolveRequestOrganizationId(input.organizationId);
  const settings = await getOrCreateOrgFinanceSettings(orgId);
  const startsAt = new Date();
  const endsAt = new Date();
  endsAt.setMonth(endsAt.getMonth() + (input.termMonths ?? 12));

  return prisma.contract.create({
    data: {
      organizationId: orgId,
      companyId: input.companyId,
      dealId: input.dealId,
      title: input.title,
      startsAt,
      endsAt,
      arr: input.arr ?? null,
      autoRenew: input.autoRenew ?? settings.autoRenewDefault,
      sourceOrderId: input.sourceOrderId ?? null,
    },
  });
}
