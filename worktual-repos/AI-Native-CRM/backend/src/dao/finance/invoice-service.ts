import type {
  InvoiceBillingKind,
  InvoiceLineKind,
  InvoicePaymentMethod,
  InvoiceStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { getContact } from "@/dao/contacts/contact-service";
import {
  DEFAULT_PAYMENT_TERMS,
  type InvoiceBillingKindValue,
  type InvoicePaymentMethodValue,
  validateOfflinePaymentReference,
} from "@/config/finance-defaults";
import { getEffectiveFinanceDefaults, overlayBankDetailsOnSections } from "@/dao/finance/org-finance-settings";
import { priceAddon } from "@/lib/addon-pricing";
import {
  computeGlobalTax,
  type GlobalTaxInput,
  type TaxBreakdown,
} from "@/lib/tax/global-tax";
import {
  buildBillingAddress,
  defaultCurrencyForTaxCountry,
  inferIndiaStateCode,
  inferTaxCountry,
} from "@/lib/tax/infer-tax-from-customer";
import {
  clampPage,
  clampPageSize,
  paginatedResult,
  type PaginatedResult,
} from "@/lib/pagination";
import {
  effectiveInvoiceStatus,
  type InvoiceStatusFilter,
} from "@/dao/finance/invoice-labels";
import { isSpreadsheetLayoutBlueprint } from "@/lib/document-blueprint";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { ensureDefaultInvoiceTemplate } from "@/dao/finance/invoice-template-service";
import {
  applyInvoiceDocumentMerge,
  defaultStandardInvoiceSections,
  parseInvoiceDocumentSections,
} from "@/lib/invoice-document-sections";
import {
  parseBlueprintAssets,
  parseDocumentBlueprint,
} from "@/lib/document-blueprint";
import {
  invoiceLinesPipeTable,
  invoiceTotalsMarkdown,
  withCommercialLineItemsSection,
} from "@/lib/commercial-line-table";

const invoiceListInclude = {
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, title: true, ownerUserId: true } },
  order: {
    select: {
      id: true,
      number: true,
      dealId: true,
      deal: { select: { id: true, title: true, ownerUserId: true } },
    },
  },
  template: { select: { id: true, name: true } },
  lines: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
  },
} satisfies Prisma.InvoiceInclude;

export type InvoiceListItem = Prisma.InvoiceGetPayload<{
  include: typeof invoiceListInclude;
}>;

export type InvoiceSummary = {
  outstanding: number;
  openCount: number;
  overdueCount: number;
  collected: number;
  currency: string;
};

export type DealInvoiceOption = {
  id: string;
  title: string;
  companyName: string;
  stage: string;
  amount: string | null;
};

export type DealInvoiceAutofill = {
  dealId: string;
  dealTitle: string;
  companyId: string;
  companyName: string;
  billingAddress: string;
  leadEmail: string;
  leadPhone: string;
  contactName: string | null;
  currency: string;
  suggestedTotal: string | null;
  paymentTerms: string;
  issueDate: string;
  dueDate: string;
  existingInvoiceId: string | null;
  existingInvoiceNumber: string | null;
  /** Pre-filled tax config from contact / company / prior invoices. */
  tax: {
    country: "IN" | "UK" | "US";
    taxId: string;
    indiaGstRate: 0 | 5 | 12 | 18 | 28;
    sellerState: string;
    buyerState: string;
    ukVatCategory:
      | "standard"
      | "reduced"
      | "zero"
      | "exempt"
      | "outside_scope";
    usStatePercent: number;
    usCountyPercent: number;
    usCityPercent: number;
    usDistrictPercent: number;
    sourceNotes: string[];
  };
};

export type InvoiceProductOption = {
  id: string;
  name: string;
  sku: string | null;
  price: string | null;
  currency: string;
  productType: "fixed" | "customizable";
  addons: Array<{
    id: string;
    name: string;
    unitLabel: string | null;
    pricingModel: "flat" | "per_unit" | "stepped" | "tiered";
    flatPrice: string | null;
    unitPrice: string | null;
    stepSize: number | null;
    stepPrice: string | null;
    tiers: Array<{
      minQty: number;
      maxQty: number | null;
      unitPrice: string;
    }>;
  }>;
};

export type CreateInvoiceLineInput = {
  kind: InvoiceLineKind;
  productId?: string | null;
  addonId?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  taxPercent?: number;
  amount: number;
};

export type InvoiceTaxConfigInput =
  | {
      country: "IN";
      gstRate: 0 | 5 | 12 | 18 | 28;
      sellerState: string;
      buyerState: string;
    }
  | {
      country: "UK";
      vatCategory:
        | "standard"
        | "reduced"
        | "zero"
        | "exempt"
        | "outside_scope";
    }
  | {
      country: "US";
      statePercent?: number;
      countyPercent?: number;
      cityPercent?: number;
      specialDistrictPercent?: number;
    };

export type CreateInvoiceFromDealInput = {
  dealId: string;
  currency?: string;
  status?: "draft" | "sent";
  billingKind?: InvoiceBillingKindValue;
  approvalStatus?: string;
  submittedForApprovalAt?: Date | null;
  paymentTerms?: string | null;
  notes?: string | null;
  billingAddress?: string | null;
  leadEmail?: string | null;
  leadPhone?: string | null;
  taxId?: string | null;
  discountAmount?: number;
  issueDate?: string | null;
  dueAt?: string | null;
  taxConfig?: InvoiceTaxConfigInput | null;
  lines: CreateInvoiceLineInput[];
  templateId?: string | null;
  actorUserId?: string | null;
};

async function nextInvoiceNumber(organizationId: string): Promise<string> {
  const count = await prisma.invoice.count({ where: { organizationId } });
  return `INV-${String(count + 1).padStart(5, "0")}`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

type PriorInvoiceTaxRow = {
  tax_id: string | null;
  tax_details: unknown;
  currency: string;
};

/** Raw SQL — avoids stale Prisma Client rejecting `taxDetails` after schema changes. */
async function loadPriorCompanyInvoiceTax(companyId: string) {
  const rows = await prisma.$queryRaw<PriorInvoiceTaxRow[]>`
    SELECT tax_id, tax_details, currency
    FROM invoices
    WHERE company_id = ${companyId}
      AND status::text <> 'void'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function persistInvoiceTaxDetails(
  invoiceId: string,
  taxDetails: unknown,
) {
  await prisma.$executeRawUnsafe(
    `UPDATE invoices SET tax_details = $1::jsonb WHERE id = $2`,
    JSON.stringify(taxDetails),
    invoiceId,
  );
}

async function loadInvoiceTaxDetails(invoiceId: string): Promise<unknown | null> {
  const rows = await prisma.$queryRaw<Array<{ tax_details: unknown }>>`
    SELECT tax_details FROM invoices WHERE id = ${invoiceId} LIMIT 1
  `;
  return rows[0]?.tax_details ?? null;
}

async function resolveInvoiceVendorName(organizationId: string): Promise<string> {
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ company_name: string | null }>
    >(
      `SELECT company_name FROM accounts.organizations WHERE id = $1::bigint LIMIT 1`,
      organizationId,
    );
    const name = rows[0]?.company_name?.trim();
    if (name) return name;
  } catch {
    // accounts schema may be unavailable
  }
  return "Our company";
}

function formatInvoiceDateLabel(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function resolveInvoiceTemplateClone(input: {
  organizationId: string;
  templateId?: string | null;
  dealId?: string | null;
  dealTitle?: string | null;
  companyName: string;
  invoiceNumber: string;
  currency: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  paymentTerms: string;
  billingAddress: string;
  taxId: string;
  issueDate: Date;
  dueAt: Date | null;
}) {
  const fallback = await ensureDefaultInvoiceTemplate(input.organizationId);
  let template = fallback;
  if (input.templateId) {
    const chosen = await prisma.invoiceTemplate.findFirst({
      where: {
        id: input.templateId,
        organizationId: input.organizationId,
      },
    });
    if (chosen) {
      template = {
        id: chosen.id,
        name: chosen.name,
        code: chosen.code,
        kind: chosen.kind,
        isDefault: chosen.isDefault,
        sections: parseInvoiceDocumentSections(chosen.sections),
        blueprint: parseDocumentBlueprint(chosen.blueprint),
        assets: parseBlueprintAssets(chosen.assets),
        updatedAt: chosen.updatedAt.toISOString(),
      };
    }
  }

  const vendorName = await resolveInvoiceVendorName(input.organizationId);
  const baseSections =
    template.sections.length > 0
      ? template.sections
      : defaultStandardInvoiceSections();
  const financeDefaults = await getEffectiveFinanceDefaults(input.organizationId);
  const merged = applyInvoiceDocumentMerge(baseSections, {
    customerName: input.companyName,
    companyName: input.companyName,
    invoiceNumber: input.invoiceNumber,
    date: formatInvoiceDateLabel(input.issueDate),
    dueDate: formatInvoiceDateLabel(input.dueAt),
    vendorName,
    sellerAddress: "",
    currency: input.currency,
    subtotal: input.subtotal.toFixed(2),
    taxAmount: input.taxAmount.toFixed(2),
    total: input.total.toFixed(2),
    paymentTerms: input.paymentTerms || "Net 30",
    billingAddress: input.billingAddress || "—",
    taxId: input.taxId || "—",
  });
  const sections = overlayBankDetailsOnSections(
    merged,
    financeDefaults.bankDetails,
  );

  let blueprint = template.blueprint;
  let assets = template.assets;

  if (input.dealId && blueprint) {
    const { buildClonePersonalizeContext, personalizePageCloneDocument } =
      await import("@/service/sales/document-clone-personalize");
    const { resolveProposalProductScope } = await import(
      "@/service/sales/proposal-visuals"
    );
    const scoped = await resolveProposalProductScope({
      dealId: input.dealId,
      organizationId: input.organizationId,
      dealTitle: input.dealTitle ?? "",
      dealNotes: null,
      title: input.invoiceNumber,
      matchText: sections.map((s) => `${s.title}\n${s.body}`).join("\n"),
    }).catch(() => null);
    const cloneCtx = await buildClonePersonalizeContext({
      kind: "invoice",
      organizationId: input.organizationId,
      dealId: input.dealId,
      companyName: input.companyName,
      customerName: input.companyName,
      dealTitle: input.dealTitle ?? "",
      vendorName,
      date: formatInvoiceDateLabel(input.issueDate),
      productScope: scoped?.productScope ?? input.dealTitle ?? "Services",
      productHint: scoped?.productHint ?? null,
      invoiceNumber: input.invoiceNumber,
      total: input.total.toFixed(2),
      currency: input.currency,
    });
    const patched = await personalizePageCloneDocument({
      blueprint,
      assets,
      sections: sections.map((s, i) => ({
        id: s.key || `sec-${i}`,
        key: s.key,
        title: s.title,
        body: s.body,
        sortOrder: i + 1,
      })),
      context: cloneCtx,
    });
    if (patched.applied) {
      blueprint = patched.blueprint ?? blueprint;
      assets = patched.assets;
    }
  }

  return {
    templateId: template.id,
    sections,
    blueprint,
    assets,
  };
}

export type CreateInvoiceFromOrderOptions = {
  /** B2B quote-accept: draft invoice for finance approval — never auto-send. */
  mode?: "default" | "draft_pending_finance";
};

/** Pure status mapping for order-originated invoices (tested). */
export function invoiceCreateStatusFromOrderOptions(
  options?: CreateInvoiceFromOrderOptions,
): { status: "draft" | "sent"; approvalStatus: string } {
  const draftPendingFinance = options?.mode === "draft_pending_finance";
  return {
    status: "draft",
    approvalStatus: draftPendingFinance ? "pending_approval" : "drafting",
  };
}

const OPEN_INVOICE_STATUSES: InvoiceStatus[] = ["draft", "sent", "overdue"];

export class DuplicateOpenInvoiceError extends Error {
  readonly existingInvoiceId: string;
  readonly existingInvoiceNumber: string;

  constructor(existingInvoiceId: string, existingInvoiceNumber: string) {
    super(
      `An open invoice already exists for this order (${existingInvoiceNumber}). Resend or void it before creating another.`,
    );
    this.name = "DuplicateOpenInvoiceError";
    this.existingInvoiceId = existingInvoiceId;
    this.existingInvoiceNumber = existingInvoiceNumber;
  }
}

async function assertNoOpenInvoiceForOrder(
  orderId: string,
  organizationId: bigint,
  billingKind?: InvoiceBillingKindValue,
): Promise<void> {
  const defaults = await getEffectiveFinanceDefaults(organizationId);
  if (!defaults.duplicateInvoiceGuard) return;
  const open = await prisma.invoice.findFirst({
    where: {
      orderId,
      status: { in: OPEN_INVOICE_STATUSES },
      ...(billingKind ? { billingKind: billingKind as InvoiceBillingKind } : {}),
    },
    select: { id: true, number: true },
  });
  if (open) {
    throw new DuplicateOpenInvoiceError(open.id, open.number);
  }
}

export async function createInvoiceFromOrder(
  orderId: string,
  actorUserId?: string | null,
  options?: CreateInvoiceFromOrderOptions,
) {
  const order = await prisma.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      lines: {
        orderBy: { sortOrder: "asc" },
        include: { product: { select: { billingType: true, billingFrequency: true } } },
      },
      company: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true } },
    },
  });
  if (!order) throw new Error("Order not found.");

  if (!order.companyId) {
    throw new Error("Cannot create invoice without a company on the order.");
  }

  const organizationId = await resolveRequestOrganizationId(order.organizationId);
  const { classifyOrderLinesByBillingType, ensureSubscriptionScheduleForOrder, findContractForOrder, linkContractToOrder } =
    await import("@/dao/finance/billing-schedule-service");

  const split = classifyOrderLinesByBillingType(order.lines);
  const hasRecurring = split.recurringTotal > 0;
  const hasSetup = split.setupTotal > 0;

  if (hasRecurring && !hasSetup) {
    await assertNoOpenInvoiceForOrder(orderId, order.organizationId, "subscription_start");
    const contract = await findContractForOrder({
      organizationId,
      companyId: order.companyId,
      dealId: order.dealId,
    });
    if (contract) {
      await linkContractToOrder(
        contract.id,
        order.id,
        order.lines.find((l) => l.product?.billingFrequency)?.product?.billingFrequency ?? null,
      );
    }
    const schedule = await ensureSubscriptionScheduleForOrder({
      organizationId,
      orderId: order.id,
      companyId: order.companyId,
      dealId: order.dealId,
      currency: order.currency,
      recurringTotal: split.recurringTotal,
      purchaseDate: order.confirmedAt ?? new Date(),
    });
    if (schedule && schedule.scheduledFor <= new Date()) {
      const { createDraftInvoiceFromSchedule } = await import(
        "@/dao/finance/billing-schedule-service"
      );
      return createDraftInvoiceFromSchedule(schedule.id);
    }
    return null;
  }

  const billingKind: InvoiceBillingKindValue =
    hasSetup && hasRecurring ? "setup" : hasSetup ? "setup" : "standard";
  await assertNoOpenInvoiceForOrder(orderId, order.organizationId, billingKind);

  const invoiceLines = hasSetup
    ? order.lines.filter(
        (line) => line.product?.billingType !== "recurring",
      )
    : order.lines;

  const financeDefaults = await getEffectiveFinanceDefaults(organizationId);
  const paymentTerms = financeDefaults.defaultPaymentTerms;
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 30);
  const issueDate = new Date();
  const number = await nextInvoiceNumber(organizationId);
  const companyName = order.company?.name?.trim() || "Customer";
  const lineTotal = invoiceLines.reduce((sum, line) => sum + Number(line.amount), 0);
  const clone = await resolveInvoiceTemplateClone({
    organizationId,
    dealId: order.dealId,
    dealTitle: order.deal?.title ?? null,
    companyName,
    invoiceNumber: number,
    currency: order.currency,
    subtotal: lineTotal,
    taxAmount: 0,
    total: lineTotal,
    paymentTerms,
    billingAddress: "",
    taxId: "",
    issueDate,
    dueAt,
  });

  const { status, approvalStatus } = invoiceCreateStatusFromOrderOptions(options);
  const now = new Date();

  const contract = await findContractForOrder({
    organizationId,
    companyId: order.companyId,
    dealId: order.dealId,
  });

  const invoice = await prisma.invoice.create({
    data: {
      organizationId,
      orderId: order.id,
      dealId: order.dealId,
      companyId: order.companyId,
      contractId: contract?.id ?? null,
      templateId: clone.templateId,
      number,
      status,
      approvalStatus,
      billingKind,
      submittedForApprovalAt:
        approvalStatus === "pending_approval" ? now : null,
      currency: order.currency,
      total: lineTotal,
      issueDate,
      paymentTerms,
      dueAt,
      sections: clone.sections as unknown as Prisma.InputJsonValue,
      blueprint: (clone.blueprint ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      assets: (clone.assets ?? []) as unknown as Prisma.InputJsonValue,
      createdByUserId: actorUserId ?? null,
      lines: {
        create: invoiceLines.map((line, idx) => ({
          organizationId,
          kind: "product" as const,
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          sortOrder: line.sortOrder ?? idx,
        })),
      },
    },
  });

  if (contract) {
    await linkContractToOrder(
      contract.id,
      order.id,
      order.lines.find((l) => l.product?.billingFrequency)?.product?.billingFrequency ?? null,
    );
  }

  if (hasRecurring && hasSetup) {
    await ensureSubscriptionScheduleForOrder({
      organizationId,
      orderId: order.id,
      companyId: order.companyId,
      dealId: order.dealId,
      currency: order.currency,
      recurringTotal: split.recurringTotal,
      purchaseDate: order.confirmedAt ?? new Date(),
    });
  }

  if (clone.blueprint) {
    const { fillInvoiceDocumentFromTemplate } = await import(
      "@/service/sales/commercial-document-fill"
    );
    await fillInvoiceDocumentFromTemplate(invoice.id).catch((err) => {
      console.error("[invoice-fill-from-order]", err);
    });
  }

  await writeAuditLog({
    actorUserId,
    action: "invoice_created",
    entityType: "invoice",
    entityId: invoice.id,
    organizationId,
    meta: { orderId, billingKind },
  });

  return invoice;
}

function buildInvoiceWhere(filters: {
  organizationId: string;
  search?: string;
  status?: InvoiceStatusFilter;
  /** Scope via related deal ownership (sales_rep deep-links). */
  dealOwnerUserId?: string | null;
}): Prisma.InvoiceWhereInput {
  const parts: Prisma.InvoiceWhereInput[] = [
    { organizationId: filters.organizationId },
  ];

  if (filters.dealOwnerUserId) {
    parts.push({
      OR: [
        { deal: { ownerUserId: filters.dealOwnerUserId } },
        { order: { deal: { ownerUserId: filters.dealOwnerUserId } } },
        {
          AND: [
            { dealId: null },
            { orderId: null },
            { createdByUserId: filters.dealOwnerUserId },
          ],
        },
      ],
    });
  }

  const q = filters.search?.trim();
  if (q) {
    parts.push({
      OR: [
        { number: { contains: q, mode: "insensitive" } },
        { company: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  const status =
    filters.status && filters.status !== "all" ? filters.status : null;
  const now = new Date();

  if (status === "overdue") {
    parts.push({
      status: { notIn: ["paid", "void", "draft"] },
      OR: [{ status: "overdue" }, { dueAt: { lt: now } }],
    });
  } else if (status === "sent") {
    parts.push({
      status: "sent",
      OR: [{ dueAt: null }, { dueAt: { gte: now } }],
    });
  } else if (status) {
    parts.push({ status });
  }

  return parts.length === 1 ? parts[0]! : { AND: parts };
}

export async function listInvoices(filters: {
  page?: number;
  pageSize?: number;
  organizationId?: string | null;
  search?: string;
  status?: InvoiceStatusFilter;
  dealOwnerUserId?: string | null;
}): Promise<PaginatedResult<InvoiceListItem>> {
  const organizationId = await resolveRequestOrganizationId(filters.organizationId);
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize, 50);
  const where = buildInvoiceWhere({
    organizationId,
    search: filters.search,
    status: filters.status,
    dealOwnerUserId: filters.dealOwnerUserId,
  });

  const [total, items] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: invoiceListInclude,
    }),
  ]);

  return paginatedResult(items, total, page, pageSize);
}

/** Compact list for the Finance invoice sub-bar. */
export async function listInvoiceBarItems(options?: {
  organizationId?: string | null;
  dealOwnerUserId?: string | null;
}) {
  const orgId = await resolveRequestOrganizationId(options?.organizationId);
  const where = buildInvoiceWhere({
    organizationId: orgId,
    dealOwnerUserId: options?.dealOwnerUserId,
  });
  const rows = await prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      status: true,
      dueAt: true,
      total: true,
      currency: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    displayStatus: effectiveInvoiceStatus(row.status, row.dueAt),
    total: row.total.toString(),
    currency: row.currency,
  }));
}

export async function getInvoiceSummary(options?: {
  organizationId?: string | null;
  dealOwnerUserId?: string | null;
}): Promise<InvoiceSummary> {
  const orgId = await resolveRequestOrganizationId(options?.organizationId);
  const where = buildInvoiceWhere({
    organizationId: orgId,
    dealOwnerUserId: options?.dealOwnerUserId,
    status: "all",
  });
  // Exclude void from summary totals (match prior behavior).
  const rows = await prisma.invoice.findMany({
    where: {
      AND: [where, { status: { not: "void" } }],
    },
    select: { status: true, total: true, dueAt: true, currency: true },
  });

  const now = new Date();
  let outstanding = 0;
  let openCount = 0;
  let overdueCount = 0;
  let collected = 0;
  let currency = "USD";

  for (const row of rows) {
    currency = row.currency || currency;
    const amount = Number(row.total);
    const effective = effectiveInvoiceStatus(row.status, row.dueAt, now);
    if (effective === "paid") {
      collected += amount;
    } else {
      outstanding += amount;
      openCount += 1;
      if (effective === "overdue") overdueCount += 1;
    }
  }

  return { outstanding, openCount, overdueCount, collected, currency };
}

export async function getInvoice(id: string): Promise<InvoiceListItem | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: invoiceListInclude,
  });
  if (!invoice) return null;
  const taxDetails = await loadInvoiceTaxDetails(id);
  return { ...invoice, taxDetails: taxDetails as never };
}

export async function markInvoicePaid(
  id: string,
  options?: {
    paymentReference?: string | null;
    paymentMethod?: InvoicePaymentMethodValue;
    confirmedByUserId?: string | null;
  },
) {
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) throw new Error("Invoice not found.");
  if (existing.status === "paid") {
    throw new Error("Invoice is already paid.");
  }
  if (existing.status !== "sent" && existing.status !== "overdue") {
    throw new Error("Only sent invoices can be marked paid.");
  }
  const financeDefaults = await getEffectiveFinanceDefaults(existing.organizationId);
  const isGateway =
    options?.paymentMethod === "stripe" || options?.paymentMethod === "razorpay";
  if (!isGateway) {
    const refErr = validateOfflinePaymentReference(
      options?.paymentReference,
      financeDefaults.offlineReferenceMinLen,
    );
    if (refErr) throw new Error(refErr);
  }

  const method: InvoicePaymentMethod | null =
    options?.paymentMethod === "offline" ||
    options?.paymentMethod === "manual" ||
    options?.paymentMethod === "stripe" ||
    options?.paymentMethod === "razorpay"
      ? options.paymentMethod
      : options?.paymentReference?.trim()
        ? "offline"
        : "manual";

  const now = new Date();
  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      status: "paid",
      paidAt: now,
      paymentMethod: method,
      paymentReference: options?.paymentReference?.trim() || null,
      paymentConfirmedByUserId: options?.confirmedByUserId
        ? BigInt(options.confirmedByUserId)
        : null,
      paymentConfirmedAt: now,
      paymentSessionStatus: existing.paymentSessionId ? "paid" : undefined,
    },
  });

  try {
    const { handleContractAutoRenewOnPaid } = await import(
      "@/dao/finance/billing-schedule-service"
    );
    await handleContractAutoRenewOnPaid(updated.id);
  } catch (err) {
    console.error("handleContractAutoRenewOnPaid failed", updated.id, err);
  }

  return updated;
}

export async function voidInvoice(
  id: string,
  input: { reason: string; voidedByUserId?: string | null },
) {
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) throw new Error("Invoice not found.");
  if (existing.status === "paid") {
    throw new Error("Paid invoices cannot be voided.");
  }
  if (existing.status === "void") {
    throw new Error("Invoice is already void.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new Error("A void reason is required.");

  return prisma.invoice.update({
    where: { id },
    data: {
      status: "void",
      voidedAt: new Date(),
      voidReason: reason.slice(0, 2000),
      voidedByUserId: input.voidedByUserId
        ? BigInt(input.voidedByUserId)
        : null,
    },
  });
}

export async function autoMarkZeroInvoicePaid(
  id: string,
  confirmedByUserId?: string | null,
) {
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) throw new Error("Invoice not found.");
  if (existing.status === "paid") return existing;

  const now = new Date();
  return prisma.invoice.update({
    where: { id },
    data: {
      status: "paid",
      paidAt: now,
      paymentMethod: "manual",
      paymentReference: "ZERO_AMOUNT",
      paymentConfirmedByUserId: confirmedByUserId
        ? BigInt(confirmedByUserId)
        : null,
      paymentConfirmedAt: now,
    },
  });
}

export type InvoiceLinePatchInput = {
  productId?: string | null;
  name: string;
  quantity: number;
  unitPrice?: number;
  description?: string | null;
};

export type UpdateInvoiceInput = {
  notes?: string | null;
  paymentTerms?: string | null;
  lines?: InvoiceLinePatchInput[];
  discountAmount?: number;
  discountPct?: number;
};

function taxConfigFromDetails(
  details: unknown,
): InvoiceTaxConfigInput | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const meta =
    d.meta && typeof d.meta === "object"
      ? (d.meta as Record<string, unknown>)
      : {};
  const country = String(d.country || meta.country || "").toUpperCase();
  if (country === "IN") {
    const gstRate = Number(meta.gstRate ?? d.effectivePercent);
    const allowed: Array<0 | 5 | 12 | 18 | 28> = [0, 5, 12, 18, 28];
    if (!allowed.includes(gstRate as 0 | 5 | 12 | 18 | 28)) return null;
    return {
      country: "IN",
      gstRate: gstRate as 0 | 5 | 12 | 18 | 28,
      sellerState: String(meta.sellerState || "TN"),
      buyerState: String(meta.buyerState || "TN"),
    };
  }
  if (country === "UK") {
    const vat = String(meta.vatCategory || "standard");
    const allowed = [
      "standard",
      "reduced",
      "zero",
      "exempt",
      "outside_scope",
    ] as const;
    if (!allowed.includes(vat as (typeof allowed)[number])) return null;
    return {
      country: "UK",
      vatCategory: vat as (typeof allowed)[number],
    };
  }
  if (country === "US") {
    return {
      country: "US",
      statePercent:
        Number(meta.statePercent) || Number(d.effectivePercent) || 0,
      countyPercent: Number(meta.countyPercent) || 0,
      cityPercent: Number(meta.cityPercent) || 0,
      specialDistrictPercent: Number(meta.specialDistrictPercent) || 0,
    };
  }
  return null;
}

export async function updateInvoice(id: string, input: UpdateInvoiceInput) {
  const organizationId = await resolveRequestOrganizationId();
  const existing = await prisma.invoice.findFirst({
    where: { id, organizationId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!existing) throw new Error("Invoice not found.");

  const wantsLines = input.lines !== undefined;
  const wantsDiscount =
    input.discountAmount !== undefined || input.discountPct !== undefined;
  if (wantsLines || wantsDiscount) {
    if (existing.status === "paid" || existing.status === "void") {
      throw new Error("Paid or void invoices cannot change line items.");
    }
  }

  let computedLines: Array<{
    organizationId: string;
    kind: InvoiceLineKind;
    productId: string | null;
    addonId: string | null;
    name: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
    taxPercent: number;
    amount: number;
    sortOrder: number;
  }> | null = null;

  if (wantsLines) {
    if (!input.lines?.length) {
      throw new Error("Add at least one invoice line.");
    }
    computedLines = [];
    for (let i = 0; i < input.lines.length; i += 1) {
      const line = input.lines[i]!;
      const qty = Math.max(0.01, Number(line.quantity) || 1);
      let unitPrice = Number(line.unitPrice);
      let productId = line.productId?.trim() || null;
      if (productId) {
        const product = await prisma.product.findUnique({
          where: { id: productId },
        });
        if (!product || (product.status !== "active" && product.status !== "draft")) {
          throw new Error(`Product not available: ${line.name}`);
        }
        if (product.price != null) {
          unitPrice = Number(product.price);
        }
        productId = product.id;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error(`Line "${line.name}" has an invalid unit price.`);
      }
      computedLines.push({
        organizationId,
        kind: "product",
        productId,
        addonId: null,
        name: line.name.trim() || "Line item",
        description: line.description?.trim() || null,
        quantity: qty,
        unitPrice,
        taxPercent: 0,
        amount: roundMoney(qty * unitPrice),
        sortOrder: i,
      });
    }
  }

  const data: Prisma.InvoiceUpdateInput = {};
  if (input.notes !== undefined) {
    data.notes = input.notes?.trim() || null;
  }
  if (input.paymentTerms !== undefined) {
    data.paymentTerms = input.paymentTerms?.trim() || null;
  }

  let taxBreakdown: TaxBreakdown | null = null;
  if (wantsLines || wantsDiscount) {
    const lineRows =
      computedLines ??
      existing.lines.map((line) => ({
        name: line.name,
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        amount: Number(line.amount),
        taxPercent: Number(line.taxPercent),
      }));
    const subtotal = roundMoney(
      lineRows.reduce((sum, line) => sum + Number(line.amount), 0),
    );
    let discountAmount = roundMoney(Number(existing.discountAmount));
    if (input.discountPct !== undefined) {
      const pct = Math.min(100, Math.max(0, Number(input.discountPct) || 0));
      discountAmount = roundMoney(subtotal * (pct / 100));
    } else if (input.discountAmount !== undefined) {
      discountAmount = roundMoney(Number(input.discountAmount) || 0);
    }
    if (discountAmount < 0) throw new Error("Discount cannot be negative.");
    const taxableAmount = roundMoney(Math.max(0, subtotal - discountAmount));
    const existingTax = await loadInvoiceTaxDetails(existing.id);
    const fallbackLineTax =
      Number(
        (existingTax &&
          typeof existingTax === "object" &&
          (existingTax as { effectivePercent?: unknown }).effectivePercent) ||
          existing.lines[0]?.taxPercent ||
          0,
      ) || 0;
    taxBreakdown = resolveTaxBreakdown(
      taxConfigFromDetails(existingTax),
      taxableAmount,
      fallbackLineTax,
    );
    const taxAmount = taxBreakdown.taxAmount;
    const effectivePercent = taxBreakdown.effectivePercent;
    const total = roundMoney(taxableAmount + taxAmount);
    if (computedLines) {
      for (const line of computedLines) {
        line.taxPercent = effectivePercent;
      }
    }
    data.discountAmount = discountAmount;
    data.taxAmount = taxAmount;
    data.total = total;
    const currency = existing.currency || "USD";
    const sectionRows = (
      computedLines ??
      existing.lines.map((line) => ({
        name: line.name,
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        amount: Number(line.amount),
        taxPercent: Number(line.taxPercent),
      }))
    ).map((line) => ({
      name: line.name,
      description: "description" in line ? line.description : null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
      taxPercent:
        "taxPercent" in line ? Number(line.taxPercent) : effectivePercent,
    }));
    if (!isSpreadsheetLayoutBlueprint(existing.blueprint)) {
      data.sections = withCommercialLineItemsSection(
        parseInvoiceDocumentSections(existing.sections),
        invoiceLinesPipeTable(sectionRows, currency),
        invoiceTotalsMarkdown({
          currency,
          subtotal,
          discountAmount: discountAmount > 0 ? discountAmount : null,
          taxAmount: taxAmount > 0 ? taxAmount : null,
          taxDetails: taxBreakdown,
          total,
        }),
        { stripInvoiceTotals: true },
      ) as Prisma.InputJsonValue;
    }
  }

  if (Object.keys(data).length === 0 && !computedLines) {
    throw new Error("Nothing to update.");
  }

  if (computedLines) {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: existing.id } });
      await tx.invoiceLine.createMany({
        data: computedLines!.map((line) => ({
          ...line,
          invoiceId: existing.id,
        })),
      });
      return tx.invoice.update({
        where: { id: existing.id },
        data,
        include: invoiceListInclude,
      });
    });
    if (taxBreakdown) {
      await persistInvoiceTaxDetails(existing.id, taxBreakdown);
    }
    return updated;
  }

  const updated = await prisma.invoice.update({
    where: { id: existing.id },
    data,
    include: invoiceListInclude,
  });
  if (taxBreakdown) {
    await persistInvoiceTaxDetails(existing.id, taxBreakdown);
  }
  return updated;
}

/** Permanently delete an invoice (lines cascade). Paid invoices are blocked. */
export async function deleteInvoice(id: string) {
  const organizationId = await resolveRequestOrganizationId();
  const existing = await prisma.invoice.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      number: true,
      status: true,
      dealId: true,
      orderId: true,
    },
  });
  if (!existing) throw new Error("Invoice not found.");
  if (existing.status === "paid") {
    throw new Error("Paid invoices cannot be deleted.");
  }

  await prisma.invoice.delete({ where: { id: existing.id } });
  await writeAuditLog({
    action: "delete",
    entityType: "invoice",
    entityId: existing.id,
    organizationId,
    meta: {
      number: existing.number,
      status: existing.status,
      dealId: existing.dealId,
      orderId: existing.orderId,
    },
  });
  return { id: existing.id };
}

export async function listDealsForInvoiceSelect(options?: {
  organizationId?: string | null;
  ownerUserId?: string | null;
}): Promise<DealInvoiceOption[]> {
  const organizationId = await resolveRequestOrganizationId(options?.organizationId);
  let ownerUserId = options?.ownerUserId;
  if (ownerUserId === undefined) {
    const { resolveRecordOwnerScope } = await import(
      "@/service/auth/ownership-scope"
    );
    ownerUserId = (await resolveRecordOwnerScope()).ownerUserId;
  }
  const deals = await prisma.deal.findMany({
    where: {
      organizationId,
      stage: { not: "closed_lost" },
      companyId: { not: "" },
      ...(ownerUserId ? { ownerUserId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      stage: true,
      amount: true,
      company: { select: { name: true } },
    },
  });

  return deals.map((deal) => ({
    id: deal.id,
    title: deal.title,
    companyName: deal.company.name,
    stage: deal.stage,
    amount: deal.amount?.toString() ?? null,
  }));
}

export async function getDealInvoiceAutofill(
  dealId: string,
): Promise<DealInvoiceAutofill> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      company: { select: { id: true, name: true, domain: true } },
      location: { select: { address: true, city: true, name: true } },
      quotes: {
        where: { status: "accepted" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { currency: true, total: true },
      },
      orders: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { currency: true, total: true },
      },
      invoices: {
        where: { status: { not: "void" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, number: true },
      },
    },
  });
  if (!deal) throw new Error("Deal not found.");
  if (deal.stage === "closed_lost") {
    throw new Error("Closed-lost deals cannot be invoiced.");
  }

  let leadPhone = "";
  let contactCountry: string | null = null;
  let contactCity: string | null = null;
  let contactAddressLine: string | null = null;
  if (deal.contactId) {
    const contact = await getContact(deal.contactId);
    leadPhone = contact?.person.phone?.trim() || "";
    contactCountry = contact?.person.country?.trim() || null;
    contactCity = contact?.person.city?.trim() || null;
    contactAddressLine = contact?.person.addressLine?.trim() || null;
  }

  const priorCompanyInvoice = await loadPriorCompanyInvoiceTax(deal.company.id);

  const priorTax =
    priorCompanyInvoice?.tax_details &&
    typeof priorCompanyInvoice.tax_details === "object" &&
    !Array.isArray(priorCompanyInvoice.tax_details)
      ? (priorCompanyInvoice.tax_details as Record<string, unknown>)
      : null;
  const priorMeta =
    priorTax?.meta &&
    typeof priorTax.meta === "object" &&
    !Array.isArray(priorTax.meta)
      ? (priorTax.meta as Record<string, unknown>)
      : null;

  const acceptedQuote = deal.quotes[0];
  const latestOrder = deal.orders[0];
  const quoteOrOrderCurrency =
    acceptedQuote?.currency || latestOrder?.currency || null;

  const addressBlob = [
    deal.location.address,
    deal.location.city,
    deal.location.name,
    contactAddressLine,
    contactCity,
    contactCountry,
  ]
    .filter(Boolean)
    .join(" ");

  const sourceNotes: string[] = [];
  let taxCountry =
    inferTaxCountry({
      country: contactCountry,
      currency: quoteOrOrderCurrency,
      domain: deal.company.domain,
      addressText: addressBlob,
    }) ?? null;

  if (taxCountry && contactCountry) {
    sourceNotes.push(`Tax country from contact country (${contactCountry})`);
  } else if (taxCountry && quoteOrOrderCurrency) {
    sourceNotes.push(
      `Tax country inferred from currency (${quoteOrOrderCurrency})`,
    );
  } else if (taxCountry && deal.company.domain) {
    sourceNotes.push(
      `Tax country inferred from company domain (${deal.company.domain})`,
    );
  }

  if (
    !taxCountry &&
    priorTax?.country &&
    ["IN", "UK", "US"].includes(String(priorTax.country))
  ) {
    taxCountry = String(priorTax.country) as "IN" | "UK" | "US";
    sourceNotes.push("Tax country from prior company invoice");
  }

  if (!taxCountry) {
    taxCountry = "US";
    sourceNotes.push("Tax country defaulted to United States");
  }

  const currency =
    quoteOrOrderCurrency ||
    priorCompanyInvoice?.currency ||
    defaultCurrencyForTaxCountry(taxCountry);

  const buyerState =
    (taxCountry === "IN"
      ? inferIndiaStateCode(
          deal.location.city,
          deal.location.address,
          deal.location.name,
          contactCity,
          contactAddressLine,
          contactCountry,
        )
      : null) ||
    (priorMeta?.buyerState ? String(priorMeta.buyerState) : "") ||
    "";

  if (taxCountry === "IN" && buyerState) {
    sourceNotes.push(`Buyer state pre-filled as ${buyerState}`);
  }

  const sellerState =
    (priorMeta?.sellerState ? String(priorMeta.sellerState) : "") ||
    buyerState ||
    "";

  if (taxCountry === "IN" && sellerState && priorMeta?.sellerState) {
    sourceNotes.push(`Seller state from prior invoice (${sellerState})`);
  } else if (taxCountry === "IN" && sellerState && buyerState === sellerState) {
    sourceNotes.push(
      "Seller state matched buyer state (edit if inter-state supply)",
    );
  }

  let indiaGstRate: 0 | 5 | 12 | 18 | 28 = 18;
  const priorGst = Number(priorMeta?.gstRate);
  if ([0, 5, 12, 18, 28].includes(priorGst)) {
    indiaGstRate = priorGst as 0 | 5 | 12 | 18 | 28;
    sourceNotes.push(`GST rate from prior invoice (${indiaGstRate}%)`);
  }

  let ukVatCategory:
    | "standard"
    | "reduced"
    | "zero"
    | "exempt"
    | "outside_scope" = "standard";
  const priorVat = String(priorMeta?.vatCategory ?? "");
  if (
    ["standard", "reduced", "zero", "exempt", "outside_scope"].includes(
      priorVat,
    )
  ) {
    ukVatCategory = priorVat as typeof ukVatCategory;
    sourceNotes.push(`VAT category from prior invoice (${ukVatCategory})`);
  }

  const usStatePercent = Number(priorMeta?.statePercent ?? 0) || 0;
  const usCountyPercent = Number(priorMeta?.countyPercent ?? 0) || 0;
  const usCityPercent = Number(priorMeta?.cityPercent ?? 0) || 0;
  const usDistrictPercent =
    Number(priorMeta?.specialDistrictPercent ?? 0) || 0;

  const taxId = priorCompanyInvoice?.tax_id?.trim() || "";
  if (taxId) {
    sourceNotes.push("Tax ID / GSTIN from prior company invoice");
  }

  const billingAddress = buildBillingAddress([
    deal.location.address || contactAddressLine,
    deal.location.city || contactCity,
    contactCountry,
    deal.location.name !== deal.company.name ? deal.location.name : null,
    deal.company.name,
  ]);

  const suggestedTotal =
    acceptedQuote?.total?.toString() ||
    latestOrder?.total?.toString() ||
    deal.amount?.toString() ||
    null;

  const issue = new Date();
  const due = new Date(issue);
  due.setDate(due.getDate() + 30);

  const existing = deal.invoices[0] ?? null;

  return {
    dealId: deal.id,
    dealTitle: deal.title,
    companyId: deal.company.id,
    companyName: deal.company.name,
    billingAddress,
    leadEmail: deal.contactEmail?.trim() || "",
    leadPhone,
    contactName: deal.contactName,
    currency,
    suggestedTotal,
    paymentTerms: "Net 30",
    issueDate: issue.toISOString().slice(0, 10),
    dueDate: due.toISOString().slice(0, 10),
    existingInvoiceId: existing?.id ?? null,
    existingInvoiceNumber: existing?.number ?? null,
    tax: {
      country: taxCountry,
      taxId,
      indiaGstRate,
      sellerState,
      buyerState,
      ukVatCategory,
      usStatePercent,
      usCountyPercent,
      usCityPercent,
      usDistrictPercent,
      sourceNotes,
    },
  };
}

export async function listActiveProductsWithAddons(options?: {
  organizationId?: string | null;
}): Promise<InvoiceProductOption[]> {
  const organizationId = await resolveRequestOrganizationId(options?.organizationId);
  const products = await prisma.product.findMany({
    where: { organizationId, status: "active" },
    orderBy: { name: "asc" },
    include: {
      addons: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { tiers: { orderBy: { minQty: "asc" } } },
      },
    },
  });

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    price: product.price?.toString() ?? null,
    currency: product.currency,
    productType: product.productType,
    addons: product.addons.map((addon) => ({
      id: addon.id,
      name: addon.name,
      unitLabel: addon.unitLabel,
      pricingModel: addon.pricingModel,
      flatPrice: addon.flatPrice?.toString() ?? null,
      unitPrice: addon.unitPrice?.toString() ?? null,
      stepSize: addon.stepSize,
      stepPrice: addon.stepPrice?.toString() ?? null,
      tiers: addon.tiers.map((tier) => ({
        minQty: tier.minQty,
        maxQty: tier.maxQty,
        unitPrice: tier.unitPrice.toString(),
      })),
    })),
  }));
}

function resolveTaxBreakdown(
  taxConfig: InvoiceTaxConfigInput | null | undefined,
  taxableAmount: number,
  fallbackLineTaxPercent: number,
): TaxBreakdown {
  if (!taxConfig) {
    const percent = Math.max(0, Number(fallbackLineTaxPercent) || 0);
    return computeGlobalTax({
      country: "US",
      taxableAmount,
      statePercent: percent,
    });
  }

  if (taxConfig.country === "IN") {
    // Match invoice create form defaults (TN) so agent/chat drafts don't fail
    // when states weren't collected in conversation.
    const sellerState = taxConfig.sellerState?.trim() || "TN";
    const buyerState = taxConfig.buyerState?.trim() || "TN";
    const allowed: Array<0 | 5 | 12 | 18 | 28> = [0, 5, 12, 18, 28];
    if (!allowed.includes(taxConfig.gstRate)) {
      throw new Error("Invalid India GST rate.");
    }
    return computeGlobalTax({
      country: "IN",
      gstRate: taxConfig.gstRate,
      sellerState,
      buyerState,
      taxableAmount,
    });
  }

  if (taxConfig.country === "UK") {
    return computeGlobalTax({
      country: "UK",
      vatCategory: taxConfig.vatCategory,
      taxableAmount,
    });
  }

  return computeGlobalTax({
    country: "US",
    taxableAmount,
    statePercent: taxConfig.statePercent,
    countyPercent: taxConfig.countyPercent,
    cityPercent: taxConfig.cityPercent,
    specialDistrictPercent: taxConfig.specialDistrictPercent,
  } satisfies GlobalTaxInput);
}

export async function createInvoiceFromDeal(input: CreateInvoiceFromDealInput) {
  if (!input.dealId) throw new Error("Deal is required.");
  if (!input.lines.length) {
    throw new Error("Add at least one line item.");
  }

  const deal = await prisma.deal.findUnique({
    where: { id: input.dealId },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!deal) throw new Error("Deal not found.");
  if (deal.stage === "closed_lost") {
    throw new Error("Closed-lost deals cannot be invoiced.");
  }
  if (!deal.companyId) {
    throw new Error("Deal must have a company.");
  }

  const organizationId = await resolveRequestOrganizationId(deal.organizationId);
  const financeDefaults = await getEffectiveFinanceDefaults(organizationId);
  const defaultPaymentTerms = financeDefaults.defaultPaymentTerms;

  // Validate / recompute amounts server-side for product + addon lines
  const normalizedLines: Array<
    CreateInvoiceLineInput & { sortOrder: number }
  > = [];

  for (let i = 0; i < input.lines.length; i += 1) {
    const line = input.lines[i]!;
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Line "${line.name}" needs a positive quantity.`);
    }
    const taxPercent = Number(line.taxPercent ?? 0);
    if (!Number.isFinite(taxPercent) || taxPercent < 0) {
      throw new Error(`Line "${line.name}" has an invalid tax percent.`);
    }

    if (line.kind === "addon") {
      if (!line.addonId) throw new Error("Addon line is missing addon id.");
      const addon = await prisma.addon.findUnique({
        where: { id: line.addonId },
        include: { tiers: true },
      });
      if (!addon) throw new Error(`Addon not found: ${line.name}`);
      const amount = roundMoney(
        priceAddon(
          {
            pricingModel: addon.pricingModel,
            flatPrice: addon.flatPrice ? Number(addon.flatPrice) : null,
            unitPrice: addon.unitPrice ? Number(addon.unitPrice) : null,
            stepSize: addon.stepSize,
            stepPrice: addon.stepPrice ? Number(addon.stepPrice) : null,
            tiers: addon.tiers.map((t) => ({
              minQty: t.minQty,
              maxQty: t.maxQty,
              unitPrice: Number(t.unitPrice),
            })),
          },
          qty,
        ),
      );
      const unitPrice = qty > 0 ? roundMoney(amount / qty) : amount;
      normalizedLines.push({
        kind: "addon",
        productId: line.productId ?? addon.productId,
        addonId: addon.id,
        name: line.name.trim() || addon.name,
        description: line.description?.trim() || "Add-on",
        quantity: qty,
        unitPrice,
        taxPercent,
        amount,
        sortOrder: i,
      });
      continue;
    }

    let unitPrice = Number(line.unitPrice);
    let productId = line.productId ?? null;
    if (productId) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });
      if (!product || product.status !== "active") {
        throw new Error(`Product not available: ${line.name}`);
      }
      if (product.price != null) {
        unitPrice = Number(product.price);
      }
      productId = product.id;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`Line "${line.name}" has an invalid unit price.`);
    }
    const amount = roundMoney(qty * unitPrice);
    normalizedLines.push({
      kind: "product",
      productId,
      addonId: null,
      name: line.name.trim(),
      description: line.description?.trim() || null,
      quantity: qty,
      unitPrice,
      taxPercent,
      amount,
      sortOrder: i,
    });
  }

  const subtotal = roundMoney(
    normalizedLines.reduce((sum, line) => sum + line.amount, 0),
  );
  const discountAmount = roundMoney(Number(input.discountAmount ?? 0));
  if (discountAmount < 0) throw new Error("Discount cannot be negative.");
  const taxableAmount = roundMoney(Math.max(0, subtotal - discountAmount));

  const fallbackLineTax =
    normalizedLines[0]?.taxPercent ?? input.lines[0]?.taxPercent ?? 0;
  const taxBreakdown = resolveTaxBreakdown(
    input.taxConfig,
    taxableAmount,
    fallbackLineTax,
  );
  const taxAmount = taxBreakdown.taxAmount;
  const effectivePercent = taxBreakdown.effectivePercent;
  const total = roundMoney(taxableAmount + taxAmount);

  for (const line of normalizedLines) {
    line.taxPercent = effectivePercent;
  }

  const issueDate = input.issueDate
    ? new Date(`${input.issueDate}T12:00:00`)
    : new Date();
  const dueAt = input.dueAt
    ? new Date(`${input.dueAt}T12:00:00`)
    : (() => {
        const d = new Date(issueDate);
        d.setDate(d.getDate() + 30);
        return d;
      })();

  const status = "draft";
  const currency = (input.currency || "USD").trim().toUpperCase() || "USD";
  const billingKind = (input.billingKind ?? "standard") as InvoiceBillingKind;
  const approvalStatus = input.approvalStatus ?? "drafting";
  const number = await nextInvoiceNumber(organizationId);
  const companyName = deal.company?.name?.trim() || "Customer";
  const clone = await resolveInvoiceTemplateClone({
    organizationId,
    templateId: input.templateId,
    dealId: deal.id,
    dealTitle: deal.title,
    companyName,
    invoiceNumber: number,
    currency,
    subtotal,
    taxAmount,
    total,
    paymentTerms: input.paymentTerms?.trim() || defaultPaymentTerms,
    billingAddress: input.billingAddress?.trim() || "",
    taxId: input.taxId?.trim() || "",
    issueDate,
    dueAt,
  });

  const invoice = await prisma.invoice.create({
    data: {
      organizationId,
      dealId: deal.id,
      companyId: deal.companyId,
      templateId: clone.templateId,
      number,
      status,
      approvalStatus,
      billingKind,
      submittedForApprovalAt: input.submittedForApprovalAt ?? null,
      currency,
      total,
      discountAmount,
      taxAmount,
      issueDate,
      paymentTerms: input.paymentTerms?.trim() || defaultPaymentTerms,
      notes: input.notes?.trim() || null,
      billingAddress: input.billingAddress?.trim() || null,
      leadEmail: input.leadEmail?.trim() || null,
      leadPhone: input.leadPhone?.trim() || null,
      taxId: input.taxId?.trim() || null,
      dueAt,
      sections: clone.sections as unknown as Prisma.InputJsonValue,
      blueprint: (clone.blueprint ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      assets: (clone.assets ?? []) as unknown as Prisma.InputJsonValue,
      createdByUserId: input.actorUserId ?? null,
      lines: {
        create: normalizedLines.map((line) => ({
          organizationId,
          kind: line.kind,
          productId: line.productId ?? null,
          addonId: line.addonId ?? null,
          name: line.name,
          description: line.description ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxPercent: line.taxPercent ?? 0,
          amount: line.amount,
          sortOrder: line.sortOrder,
        })),
      },
    },
    include: invoiceListInclude,
  });

  await persistInvoiceTaxDetails(invoice.id, taxBreakdown);

  if (clone.blueprint) {
    const { fillInvoiceDocumentFromTemplate } = await import(
      "@/service/sales/commercial-document-fill"
    );
    await fillInvoiceDocumentFromTemplate(invoice.id).catch((err) => {
      console.error("[invoice-fill-from-deal]", err);
    });
  }

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "invoice_created",
    entityType: "invoice",
    entityId: invoice.id,
    organizationId,
    meta: {
      dealId: deal.id,
      source: "finance_create",
      taxCountry: taxBreakdown.country,
      taxSystem: taxBreakdown.system,
    },
  });

  return invoice;
}

export type { InvoiceStatus };
