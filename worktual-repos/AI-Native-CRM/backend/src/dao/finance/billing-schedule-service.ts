import type { InvoiceBillingKind, ProductBillingType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { writeAuditLog } from "@/dao/audit/audit-log";
import {
  getEffectiveFinanceDefaults,
  getOrCreateOrgFinanceSettings,
} from "@/dao/finance/org-finance-settings";
import { resolveInvoiceTemplateClone } from "@/dao/finance/invoice-service";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { notifyAdmins } from "@/dao/notifications/notify-admins";

function clampCutoffDay(day: number): number {
  return Math.max(1, Math.min(28, Math.floor(day)));
}

export function computeSubscriptionStartDate(
  purchaseDate: Date,
  cutoffDay: number,
): Date {
  const day = clampCutoffDay(cutoffDay);
  const purchaseDay = purchaseDate.getDate();
  const scheduled = new Date(purchaseDate);
  if (purchaseDay <= day) {
    scheduled.setDate(day);
  }
  scheduled.setHours(0, 0, 0, 0);
  return scheduled;
}

export function buildScheduleIdempotencyKey(input: {
  contractId: string;
  billingKind: InvoiceBillingKind;
  scheduledFor: Date;
}): string {
  const date = input.scheduledFor.toISOString().slice(0, 10);
  return `${input.contractId}:${input.billingKind}:${date}`;
}

async function nextInvoiceNumber(organizationId: string): Promise<string> {
  const count = await prisma.invoice.count({ where: { organizationId } });
  return `INV-${String(count + 1).padStart(5, "0")}`;
}

export async function findContractForOrder(input: {
  organizationId: string;
  companyId: string;
  dealId: string | null;
}) {
  return prisma.contract.findFirst({
    where: {
      organizationId: input.organizationId,
      companyId: input.companyId,
      status: "active",
      ...(input.dealId ? { dealId: input.dealId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function linkContractToOrder(
  contractId: string,
  orderId: string,
  billingFrequency?: string | null,
) {
  await prisma.contract.update({
    where: { id: contractId },
    data: {
      sourceOrderId: orderId,
      ...(billingFrequency
        ? {
            billingFrequency:
              billingFrequency as import("@prisma/client").ProductBillingFrequency,
          }
        : {}),
    },
  });
}

export async function createBillingScheduleRow(input: {
  organizationId: string;
  contractId: string;
  billingKind: InvoiceBillingKind;
  scheduledFor: Date;
  amount?: number | null;
  currency?: string;
}) {
  const idempotencyKey = buildScheduleIdempotencyKey({
    contractId: input.contractId,
    billingKind: input.billingKind,
    scheduledFor: input.scheduledFor,
  });
  const existing = await prisma.contractBillingSchedule.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: input.organizationId,
        idempotencyKey,
      },
    },
  });
  if (existing) return existing;

  return prisma.contractBillingSchedule.create({
    data: {
      organizationId: input.organizationId,
      contractId: input.contractId,
      billingKind: input.billingKind,
      scheduledFor: input.scheduledFor,
      amount: input.amount ?? null,
      currency: input.currency ?? "USD",
      idempotencyKey,
    },
  });
}

export async function ensureSubscriptionScheduleForOrder(input: {
  organizationId: string;
  orderId: string;
  companyId: string;
  dealId: string | null;
  currency: string;
  recurringTotal: number;
  purchaseDate: Date;
}) {
  const settings = await getOrCreateOrgFinanceSettings(input.organizationId);
  const contract = await findContractForOrder({
    organizationId: input.organizationId,
    companyId: input.companyId,
    dealId: input.dealId,
  });
  if (!contract) return null;

  await linkContractToOrder(contract.id, input.orderId);

  const scheduledFor = computeSubscriptionStartDate(
    input.purchaseDate,
    settings.billingCutoffDay,
  );

  return createBillingScheduleRow({
    organizationId: input.organizationId,
    contractId: contract.id,
    billingKind: "subscription_start",
    scheduledFor,
    amount: input.recurringTotal,
    currency: input.currency,
  });
}

export async function createDraftInvoiceFromSchedule(scheduleId: string) {
  const schedule = await prisma.contractBillingSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      contract: {
        include: {
          company: { select: { id: true, name: true } },
          sourceOrder: {
            include: {
              lines: { orderBy: { sortOrder: "asc" }, include: { product: true } },
              deal: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  });
  if (!schedule || schedule.status !== "scheduled") {
    throw new Error("Schedule not found or already processed.");
  }

  const contract = schedule.contract;
  const order = contract.sourceOrder;
  if (!order?.companyId) {
    throw new Error("Contract has no source order for schedule invoice.");
  }

  const organizationId = await resolveRequestOrganizationId(schedule.organizationId);
  const financeDefaults = await getEffectiveFinanceDefaults(organizationId);
  const paymentTerms = financeDefaults.defaultPaymentTerms;
  const issueDate = new Date();
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 30);

  const recurringLines = order.lines.filter(
    (line) => line.product?.billingType === "recurring",
  );
  const lines =
    schedule.billingKind === "renewal"
      ? [
          {
            name: `Renewal — ${contract.title}`,
            quantity: 1,
            unitPrice: Number(schedule.amount ?? contract.arr ?? 0),
            amount: Number(schedule.amount ?? contract.arr ?? 0),
            productId: null as string | null,
          },
        ]
      : recurringLines.length > 0
        ? recurringLines.map((line) => ({
            name: line.name,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            amount: Number(line.amount),
            productId: line.productId,
          }))
        : order.lines.map((line) => ({
            name: line.name,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            amount: Number(line.amount),
            productId: line.productId,
          }));

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  const companyName = contract.company?.name?.trim() || "Customer";
  const number = await nextInvoiceNumber(organizationId);
  const clone = await resolveInvoiceTemplateClone({
    organizationId,
    dealId: order.dealId,
    dealTitle: order.deal?.title ?? null,
    companyName,
    invoiceNumber: number,
    currency: schedule.currency || order.currency,
    subtotal: total,
    taxAmount: 0,
    total,
    paymentTerms,
    billingAddress: "",
    taxId: "",
    issueDate,
    dueAt,
  });

  const invoice = await prisma.invoice.create({
    data: {
      organizationId,
      orderId: order.id,
      dealId: order.dealId,
      companyId: order.companyId,
      contractId: contract.id,
      billingScheduleId: schedule.id,
      templateId: clone.templateId,
      number,
      status: "draft",
      approvalStatus: "pending_approval",
      billingKind: schedule.billingKind,
      submittedForApprovalAt: new Date(),
      currency: schedule.currency || order.currency,
      total,
      issueDate,
      paymentTerms,
      dueAt,
      sections: clone.sections as unknown as Prisma.InputJsonValue,
      blueprint: (clone.blueprint ?? undefined) as Prisma.InputJsonValue | undefined,
      assets: (clone.assets ?? []) as unknown as Prisma.InputJsonValue,
      lines: {
        create: lines.map((line, idx) => ({
          organizationId,
          kind: "product" as const,
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          sortOrder: idx,
        })),
      },
    },
  });

  await prisma.contractBillingSchedule.update({
    where: { id: schedule.id },
    data: { status: "generated", invoiceId: invoice.id },
  });

  await writeAuditLog({
    action: "invoice_created",
    entityType: "invoice",
    entityId: invoice.id,
    organizationId,
    meta: { scheduleId: schedule.id, billingKind: schedule.billingKind },
  });

  await notifyAdmins({
    organizationId,
    kind: "invoice_created",
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    companyName,
    dealId: order.dealId,
    detail: `Scheduled ${schedule.billingKind} invoice pending Finance approval.`,
  });

  return invoice;
}

export async function ensureRenewalScheduleForContract(
  contractId: string,
  organizationId?: string | null,
) {
  const orgId = await resolveRequestOrganizationId(organizationId);
  const settings = await getOrCreateOrgFinanceSettings(orgId);
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, organizationId: orgId, status: "active" },
  });
  if (!contract) return null;

  const cutoffMs = settings.billingCutoffDay * 86_400_000;
  const scheduledFor = new Date(contract.endsAt.getTime() - cutoffMs);
  scheduledFor.setHours(0, 0, 0, 0);

  const openRenewal = await prisma.contractBillingSchedule.findFirst({
    where: {
      contractId,
      billingKind: "renewal",
      status: { in: ["scheduled", "generated"] },
    },
  });
  if (openRenewal) return openRenewal;

  return createBillingScheduleRow({
    organizationId: orgId,
    contractId,
    billingKind: "renewal",
    scheduledFor,
    amount: contract.arr != null ? Number(contract.arr) : null,
    currency: "USD",
  });
}

export async function processBillingSchedules(organizationId?: string | null) {
  const orgId = await resolveRequestOrganizationId(organizationId);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const due = await prisma.contractBillingSchedule.findMany({
    where: {
      organizationId: orgId,
      status: "scheduled",
      scheduledFor: { lte: today },
    },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });

  let generated = 0;
  for (const row of due) {
    try {
      await createDraftInvoiceFromSchedule(row.id);
      generated += 1;
    } catch (err) {
      console.error("processBillingSchedules row failed", row.id, err);
    }
  }

  const contracts = await prisma.contract.findMany({
    where: {
      organizationId: orgId,
      status: "active",
      endsAt: { lte: new Date(Date.now() + 90 * 86_400_000) },
    },
    take: 100,
  });
  let renewalSchedules = 0;
  for (const contract of contracts) {
    const row = await ensureRenewalScheduleForContract(contract.id, orgId);
    if (row?.status === "scheduled") renewalSchedules += 1;
  }

  return { scanned: due.length, generated, renewalSchedulesEnsured: renewalSchedules };
}

export async function handleContractAutoRenewOnPaid(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { contract: true },
  });
  if (!invoice?.contractId || !invoice.contract) return null;
  if (invoice.billingKind !== "renewal") return null;
  if (!invoice.contract.autoRenew) return null;

  const termMonths = 12;
  const newEndsAt = new Date(invoice.contract.endsAt);
  newEndsAt.setMonth(newEndsAt.getMonth() + termMonths);

  const updated = await prisma.contract.update({
    where: { id: invoice.contractId },
    data: {
      endsAt: newEndsAt,
      status: "active",
      renewDealId: null,
      renewalRemindedAt: null,
    },
  });

  await ensureRenewalScheduleForContract(updated.id, updated.organizationId);
  return updated;
}

export function classifyOrderLinesByBillingType(
  lines: Array<{
    amount: { toString(): string };
    product?: { billingType: ProductBillingType | null } | null;
  }>,
): { setupTotal: number; recurringTotal: number; hasSplit: boolean } {
  let setupTotal = 0;
  let recurringTotal = 0;
  for (const line of lines) {
    const amount = Number(line.amount);
    if (line.product?.billingType === "recurring") {
      recurringTotal += amount;
    } else {
      setupTotal += amount;
    }
  }
  return {
    setupTotal,
    recurringTotal,
    hasSplit: setupTotal > 0 && recurringTotal > 0,
  };
}
