/**
 * Framework-agnostic invoice commands for Fastify Wave 6.
 * Mirrors legacy Next finance/actions.ts without next/cache.
 */

import { getServerUserId } from "@/service/account/session-cookie";
import {
  canEditDeals,
  canEditFinance,
  canEditInvoiceTemplates,
  canUploadCommercialDocumentTemplates,
} from "@/service/auth/rbac";
import { getCurrentUserRole, requireModuleEnabled, requireRole } from "@/service/auth/require-role";
import {
  assertRecordAccess,
  resolveRecordOwnerScope,
} from "@/service/auth/ownership-scope";
import { getDeal } from "@/dao/sales/deal-service";
import {
  createInvoiceFromDeal,
  deleteInvoice,
  getDealInvoiceAutofill,
  getInvoice,
  getInvoiceSummary,
  listActiveProductsWithAddons,
  listDealsForInvoiceSelect,
  listInvoiceBarItems,
  listInvoices,
  markInvoicePaid,
  voidInvoice,
  updateInvoice,
  type CreateInvoiceFromDealInput,
  type InvoiceLinePatchInput,
  type DealInvoiceAutofill,
  type DealInvoiceOption,
  type InvoiceProductOption,
  type InvoiceSummary,
} from "@/dao/finance/invoice-service";
import {
  createInvoiceTemplate,
  deleteInvoiceTemplate,
  ensureDefaultInvoiceTemplate,
  getInvoiceTemplate,
  listInvoiceTemplates,
  updateInvoiceTemplate,
} from "@/dao/finance/invoice-template-service";
import {
  commercialFinancialSummaryMarkdown,
  commercialInvoiceLinesPipeTable,
  invoiceLinesPipeTable,
  invoiceTotalsMarkdown,
  withCommercialLineItemsSection,
} from "@/lib/commercial-line-table";
import {
  defaultDocumentBlueprint,
  isSpreadsheetLayoutBlueprint,
  parseBlueprintAssets,
  parseBlueprintAssetsStrict,
  parseDocumentBlueprint,
  renderBlueprintHtml,
  resolveBlueprintForView,
  blueprintUsesExternalChrome,
  isCommercialInvoiceBlueprint,
  stripInBodyPageChrome,
  type DocumentBlueprint,
  type BlueprintAsset,
} from "@/lib/document-blueprint";
import {
  parseInvoiceDocumentSections,
  type InvoiceDocumentSection,
} from "@/lib/invoice-document-sections";
import { formatCompanyDisplayName } from "@/lib/proposal-sections";
import { loadSellerOrganization } from "@/service/ai/seller-org";
import {
  chromeFromBlueprintAssets,
  htmlToPdfBuffer,
} from "@/service/sales/proposal-pdf";
import {
  adaptProposalVisuals,
  productScopeForCoverParens,
  resolveProposalProductScope,
} from "@/service/sales/proposal-visuals";
import { resolveDocumentBlueprintForPreview } from "@/service/sales/document-blueprint-preview";
import {
  effectiveInvoiceStatus,
  type InvoiceStatusFilter,
} from "@/dao/finance/invoice-labels";
import { notifyAdminsAsync } from "@/dao/notifications/notify-admins";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import {
  billingKindBlocksCustomerSend,
  type InvoiceBillingKindValue,
  type InvoicePaymentMethodValue,
} from "@/config/finance-defaults";
import { notifyFinanceInvoicePendingApproval } from "@/service/email/commercial-notify";
import { prisma } from "@/dao/db/prisma";
import type { InvoiceLineKind, InvoiceStatus } from "@prisma/client";

export type CommandResult =
  | { ok: true; id: string; warning?: string }
  | { ok: false; error: string };

/**
 * Role AND business-type gate for every finance mutation. B2C orgs never have
 * `finance` enabled (Commerce revenue path only) — a B2C admin still passes
 * `canEditFinance` on role alone, so the module gate must be checked here too.
 */
async function requireFinanceEdit(message: string) {
  await requireRole(canEditFinance, message);
  await requireModuleEnabled("finance", message);
}

/** Configuration invoice templates — sales + finance (not live invoice edits). */
async function requireInvoiceTemplateEdit(message: string) {
  await requireRole(canUploadCommercialDocumentTemplates, message);
  await requireModuleEnabled("finance", message);
}

export type InvoiceListPageItem = {
  id: string;
  number: string;
  status: InvoiceStatus;
  displayStatus: InvoiceStatus;
  total: string;
  currency: string;
  companyId: string;
  companyName: string;
  orderNumber: string | null;
  dealId: string | null;
  dealTitle: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  escalationSeverity: string | null;
  approvalStatus: string | null;
  approvedAt: string | null;
  billingKind: string;
};

export type InvoiceBarItem = {
  id: string;
  number: string;
  status: InvoiceStatus;
  displayStatus: InvoiceStatus;
  total: string;
  currency: string;
};

/** Prepare sections + fillable blueprint so live invoices match commercial templates. */
function prepareCommercialInvoiceView(input: {
  blueprint: DocumentBlueprint | null;
  assets: BlueprintAsset[];
  sections: InvoiceDocumentSection[];
  lines: Array<{
    name: string;
    description: string | null;
    quantity: number | string;
    unitPrice: number | string;
    amount: number | string;
    taxPercent: number | string;
  }>;
  currency: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  taxDetails: ReturnType<typeof mapTaxDetails>;
  sellerAddress?: string | null;
  vendorName?: string | null;
  companyName?: string | null;
  billingAddress?: string | null;
  issueDateLabel?: string | null;
  dueDateLabel?: string | null;
}): {
  blueprint: DocumentBlueprint;
  sections: InvoiceDocumentSection[];
  assets: BlueprintAsset[];
  tokens: {
    sellerLetterhead: string;
    vendorLegalName: string;
    amountInWords: string;
    tagline: string | null;
  };
} {
  const commercial = isCommercialInvoiceBlueprint(input.blueprint);
  let assets = [...input.assets];
  // Keep page/logo assets; do not inject soft brand crops into the live header.
  const hasLogo = assets.some((a) => a.id === "logo");

  const intro = input.sections.find(
    (s) => (s.key || "").toLowerCase() === "introduction",
  );
  const introLines = (intro?.body || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tagline =
    introLines.find((l) => /enterprise solution provider/i.test(l)) ||
    null;
  // Letterhead statics from template sample (not deal). Skip vendor wordmark line.
  const letterheadLines = introLines.filter((l, i) => {
    if (i === 0 && /^(worktual|{{vendorname}})/i.test(l)) return false;
    if (/enterprise solution provider/i.test(l)) return false;
    if (/^invoice\s*#/i.test(l)) return false;
    if (/^date\s*:/i.test(l)) return false;
    if (/^due/i.test(l)) return false;
    return true;
  });
  let sellerLetterhead = letterheadLines.join("\n").trim();
  if (!sellerLetterhead && input.sellerAddress?.trim()) {
    sellerLetterhead = input.sellerAddress.trim();
  }
  // Restore vendor GST from sample letterhead when merge token wiped it.
  const gstFromIntro = introLines
    .map((l) => l.match(/GST\s*:?\s*([0-9A-Z]{10,15})/i)?.[1])
    .find(Boolean);
  const gstFromLetterhead = sellerLetterhead.match(
    /GST\s*:?\s*([0-9A-Z]{10,15})/i,
  )?.[1];
  const vendorGst = gstFromIntro || gstFromLetterhead || null;
  if (vendorGst) {
    if (/GST\s*:/i.test(sellerLetterhead)) {
      sellerLetterhead = sellerLetterhead.replace(
        /GST\s*:?\s*(\{\{taxId\}\}|—|-|)?/i,
        `GST: ${vendorGst}`,
      );
    }
  } else if (/worktual/i.test(input.vendorName || "")) {
    // WIPL sample GST — keep letterhead complete when token was blanked.
    sellerLetterhead = sellerLetterhead.replace(
      /GST\s*:?\s*(\{\{taxId\}\}|—|-)?/i,
      "GST: 33AADCW3870A1ZO",
    );
    if (!/GST\s*:/i.test(sellerLetterhead) && sellerLetterhead) {
      const lines = sellerLetterhead.split("\n");
      const insertAt = Math.min(2, lines.length);
      lines.splice(insertAt, 0, "GST: 33AADCW3870A1ZO");
      sellerLetterhead = lines.join("\n");
    }
  }
  sellerLetterhead = sellerLetterhead
    .replace(/\{\{taxId\}\}/g, vendorGst || "33AADCW3870A1ZO")
    .replace(/GST\s*:\s*—/gi, "GST: 33AADCW3870A1ZO");

  const paymentSec = input.sections.find(
    (s) => (s.key || "").toLowerCase() === "payment",
  );
  const paymentLines = (paymentSec?.body || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const bankLines = paymentLines.filter((l) =>
    /^(account\s*name|bank|account\s*number|ifsc|branch)\b/i.test(l),
  );
  const vendorLegal =
    /worktual/i.test(input.vendorName || "")
      ? "WORKTUAL INNOVATIONS PRIVATE LIMITED"
      : `${(input.vendorName || "Company").trim().toUpperCase()}`;

  const blueprint = resolveBlueprintForView(
    input.blueprint ?? defaultDocumentBlueprint("invoice"),
    commercial ? "fillable" : "exact",
    {
      hasLogo,
      hasBrand: false,
      tagline,
    },
  );

  let sections = input.sections.map((s) => ({ ...s }));
  if (commercial || /bp-inv-banner/i.test(blueprint.html || "")) {
    const company = formatCompanyDisplayName(
      (input.companyName || "").trim() || "Customer",
    );
    const billing = (input.billingAddress || "").trim();
    const customerBody = [
      `**${company}**`,
      "",
      "Bill to:",
      billing || "—",
    ].join("\n");

    const deliveryBody =
      input.issueDateLabel && input.dueDateLabel
        ? `${input.issueDateLabel} to ${input.dueDateLabel}`
        : input.dueDateLabel
          ? `Due ${input.dueDateLabel}`
          : "As per deal / order schedule";

    sections = sections.map((s) => {
      const key = (s.key || "").toLowerCase();
      if (key === "introduction") return { ...s, body: "" };
      if (key === "customer") {
        return { ...s, title: "Customer details", body: customerBody };
      }
      if (key === "payment") {
        return {
          ...s,
          title: "Bank details",
          body:
            bankLines.join("\n") ||
            (s.body || "")
              .split("\n")
              .filter((l) => !/computer generated|innovations private/i.test(l))
              .join("\n")
              .trim(),
        };
      }
      if (key === "payment_terms") {
        return {
          ...s,
          title: "Payment Terms",
          body: `Due on {{dueDate}}`,
        };
      }
      if (key === "delivery") {
        return {
          ...s,
          title: "Delivery Timeline",
          body: deliveryBody,
        };
      }
      if (key === "footer") {
        return {
          ...s,
          key: "disclaimer",
          id: s.id || "sec-disclaimer",
          title: vendorLegal,
          body: "This is computer generated invoice and does not require signature.",
        };
      }
      return s;
    });

    if (!sections.some((s) => (s.key || "").toLowerCase() === "customer")) {
      sections.push({
        id: "sec-customer",
        key: "customer",
        title: "Customer details",
        body: customerBody,
        sortOrder: 2,
      });
    }

    const linesMd = commercialInvoiceLinesPipeTable(
      input.lines.map((line) => ({
        name: line.name,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
        taxPercent: line.taxPercent,
      })),
      input.currency,
    );
    const taxMd = commercialFinancialSummaryMarkdown({
      currency: input.currency,
      subtotal: input.subtotal,
      taxAmount: input.taxAmount > 0 ? input.taxAmount : null,
      taxDetails: input.taxDetails,
      total: input.total,
    });

    const lineIdx = sections.findIndex(
      (s) => (s.key || "").toLowerCase() === "line_items",
    );
    if (lineIdx >= 0) {
      sections[lineIdx] = {
        ...sections[lineIdx],
        title: "Items",
        body: linesMd,
      };
    } else {
      sections.push({
        id: "sec-line-items",
        key: "line_items",
        title: "Items",
        body: linesMd,
        sortOrder: sections.length + 1,
      });
    }

    const taxIdx = sections.findIndex(
      (s) => (s.key || "").toLowerCase() === "tax",
    );
    if (taxIdx >= 0) {
      sections[taxIdx] = {
        ...sections[taxIdx],
        title: "Financial Summary",
        body: taxMd,
      };
    } else {
      sections.push({
        id: "sec-tax",
        key: "tax",
        title: "Financial Summary",
        body: taxMd,
        sortOrder: sections.length + 1,
      });
    }

    if (!sections.some((s) => (s.key || "").toLowerCase() === "disclaimer")) {
      sections.push({
        id: "sec-disclaimer",
        key: "disclaimer",
        title: vendorLegal,
        body: "This is computer generated invoice and does not require signature.",
        sortOrder: sections.length + 1,
      });
    }
  }

  return {
    blueprint,
    sections,
    assets,
    tokens: {
      sellerLetterhead:
        sellerLetterhead ||
        (input.sellerAddress || "").trim() ||
        "",
      vendorLegalName: vendorLegal,
      amountInWords: amountInWords(input.total, input.currency),
      tagline,
    },
  };
}

function amountInWords(total: number, currency: string): string {
  const n = Math.round(Number(total) || 0);
  if (!Number.isFinite(n)) return "—";
  const words = numberToEnglishWords(n);
  const cur = (currency || "").toUpperCase();
  if (cur === "INR" || cur === "RS" || cur === "₹") {
    return `${words} Rupees Only`;
  }
  return `${words} ${cur} Only`;
}

function numberToEnglishWords(n: number): string {
  if (n === 0) return "Zero";
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  const chunk = (num: number): string => {
    if (num < 20) return ones[num];
    if (num < 100) {
      return `${tens[Math.floor(num / 10)]}${num % 10 ? ` ${ones[num % 10]}` : ""}`;
    }
    return `${ones[Math.floor(num / 100)]} Hundred${num % 100 ? ` ${chunk(num % 100)}` : ""}`;
  };
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${chunk(crore)} Crore`);
  if (lakh) parts.push(`${chunk(lakh)} Lakh`);
  if (thousand) parts.push(`${chunk(thousand)} Thousand`);
  if (rest) parts.push(chunk(rest));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export type InvoiceDetailView = {
  id: string;
  number: string;
  status: InvoiceStatus;
  total: string;
  discountAmount: string;
  taxAmount: string;
  currency: string;
  companyId: string;
  companyName: string;
  orderId: string | null;
  orderNumber: string | null;
  dealId: string | null;
  dealTitle: string | null;
  dueAt: string | null;
  paidAt: string | null;
  issueDate: string | null;
  paymentTerms: string | null;
  notes: string | null;
  billingAddress: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  taxId: string | null;
  taxDetails: {
    country: string;
    system: string;
    effectivePercent: number;
    taxAmount: number;
    components: Array<{
      code: string;
      label: string;
      percent: number;
      amount: number;
    }>;
    summaryLines: string[];
  } | null;
  templateId: string | null;
  templateName: string | null;
  vendorName: string;
  sellerAddress: string | null;
  /** Commercial template merge extras (letterhead from sample, amount in words). */
  sellerLetterhead?: string | null;
  vendorLegalName?: string | null;
  amountInWords?: string | null;
  sections: InvoiceDocumentSection[];
  blueprint: ReturnType<typeof parseDocumentBlueprint>;
  assets: ReturnType<typeof parseBlueprintAssets>;
  createdAt: string;
  lines: Array<{
    id: string;
    kind: InvoiceLineKind;
    name: string;
    description: string | null;
    quantity: string;
    unitPrice: string;
    taxPercent: string;
    amount: string;
  }>;
  /** Invoice Escalation Agent — collections-risk overlay (informational only). */
  escalationSeverity: string | null;
  escalationReason: string | null;
  escalationDraft: string | null;
  escalationLastRunAt: string | null;
  approvalStatus: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  billingKind: string;
  paymentMethod: string | null;
  paymentReference: string | null;
  paymentConfirmedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  submittedForApprovalAt: string | null;
  resubmittedAt: string | null;
  paymentProvider: string | null;
  paymentLinkUrl: string | null;
  paymentSessionId: string | null;
  paymentSessionExpiresAt: string | null;
  paymentSessionStatus: string | null;
  sentAt: string | null;
  lastSentAt: string | null;
  paymentPathMode: "online" | "offline" | "blocked" | null;
  paymentPathReason: string | null;
  allowedPaymentProviders: Array<"stripe" | "razorpay">;
  contractId: string | null;
  billingScheduleId: string | null;
};

function resolveDeal(inv: {
  dealId?: string | null;
  deal?: { id: string; title: string } | null;
  order?: {
    dealId: string | null;
    deal: { id: string; title: string } | null;
  } | null;
}): { dealId: string | null; dealTitle: string | null } {
  if (inv.deal?.id) {
    return { dealId: inv.deal.id, dealTitle: inv.deal.title };
  }
  if (inv.order?.deal?.id) {
    return {
      dealId: inv.order.deal.id,
      dealTitle: inv.order.deal.title,
    };
  }
  if (inv.dealId) {
    return { dealId: inv.dealId, dealTitle: null };
  }
  if (inv.order?.dealId) {
    return { dealId: inv.order.dealId, dealTitle: null };
  }
  return { dealId: null, dealTitle: null };
}

async function buildPaymentPathPreview(invoice: {
  organizationId: bigint;
  total: unknown;
  currency: string;
  billingKind?: string | null;
}) {
  const { getEffectiveFinanceDefaults, getOrgFinanceSettingsPublic } =
    await import("@/dao/finance/org-finance-settings");
  const { resolvePaymentPath } = await import(
    "@/service/finance/payment-routing"
  );
  const [defaults, publicSettings] = await Promise.all([
    getEffectiveFinanceDefaults(invoice.organizationId),
    getOrgFinanceSettingsPublic(invoice.organizationId),
  ]);
  const path = resolvePaymentPath({
    total: invoice.total,
    currency: invoice.currency,
    billingKind: invoice.billingKind,
    defaults,
    gatewayConfigured: publicSettings,
  });
  if (path.mode === "online") {
    return {
      paymentPathMode: "online" as const,
      paymentPathReason: path.reason ?? null,
      allowedPaymentProviders: path.allowedProviders,
    };
  }
  if (path.mode === "blocked") {
    return {
      paymentPathMode: "blocked" as const,
      paymentPathReason: path.reason,
      allowedPaymentProviders: [] as Array<"stripe" | "razorpay">,
    };
  }
  return {
    paymentPathMode: "offline" as const,
    paymentPathReason: path.reason ?? null,
    allowedPaymentProviders: [] as Array<"stripe" | "razorpay">,
  };
}

type SendInvoiceOptions = {
  paymentProvider?: "stripe" | "razorpay";
};

async function dispatchInvoiceCustomerEmail(
  id: string,
  userId: string,
  mode: "initial_send" | "payment_reminder",
  options?: SendInvoiceOptions,
): Promise<CommandResult> {
  const linkResult = await (
    await import("@/service/finance/payment-gateways/index")
  ).ensureInvoicePaymentLink({
    invoiceId: id,
    preferredProvider: options?.paymentProvider ?? null,
  });
  if (!linkResult.ok) {
    return { ok: false, error: linkResult.error };
  }
  if (linkResult.mode === "blocked") {
    return { ok: false, error: linkResult.reason ?? "Cannot send this invoice." };
  }

  const pdf = await getInvoicePdfCommand(id);
  const pdfAttachment = pdf.ok
    ? { filename: pdf.filename, buffer: pdf.buffer }
    : null;

  const { sendInvoiceToCustomer } = await import(
    "@/service/finance/invoice-email"
  );
  const result = await sendInvoiceToCustomer({
    invoiceId: id,
    userId,
    mode,
    attachment: pdfAttachment,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.needsConnect
        ? "Connect email in Configuration to send invoices."
        : result.error,
    };
  }

  const now = new Date();
  const refreshed = await getInvoice(id);
  const wasDraft = refreshed?.status === "draft";
  await prisma.invoice.update({
    where: { id },
    data: {
      ...(wasDraft ? { status: "sent" as const } : {}),
      sentAt: refreshed?.sentAt ?? now,
      lastSentAt: now,
    },
  });
  return { ok: true, id };
}

function mapInvoiceRow(
  inv: Awaited<ReturnType<typeof listInvoices>>["items"][number],
): InvoiceListPageItem {
  const deal = resolveDeal(inv);
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    displayStatus: effectiveInvoiceStatus(inv.status, inv.dueAt),
    total: inv.total.toString(),
    currency: inv.currency,
    companyId: inv.company?.id ?? "",
    companyName: inv.company?.name ?? "—",
    orderNumber: inv.order?.number ?? null,
    dealId: deal.dealId,
    dealTitle: deal.dealTitle,
    dueAt: inv.dueAt?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
    escalationSeverity: inv.escalationSeverity ?? null,
    approvalStatus: inv.approvalStatus ?? null,
    approvedAt: inv.approvedAt?.toISOString() ?? null,
    billingKind: inv.billingKind ?? "standard",
  };
}

function parseStatusFilter(raw?: string): InvoiceStatusFilter {
  if (
    raw === "draft" ||
    raw === "sent" ||
    raw === "paid" ||
    raw === "void" ||
    raw === "overdue"
  ) {
    return raw;
  }
  return "all";
}

function mapTaxDetails(
  raw: unknown,
  taxAmount: { toString(): string } | number | string,
): InvoiceDetailView["taxDetails"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const details = raw as Record<string, unknown>;
  const components = Array.isArray(details.components)
    ? details.components
        .filter(
          (c): c is Record<string, unknown> =>
            Boolean(c) && typeof c === "object",
        )
        .map((c) => ({
          code: String(c.code ?? ""),
          label: String(c.label ?? c.code ?? "Tax"),
          percent: Number(c.percent ?? 0),
          amount: Number(c.amount ?? 0),
        }))
    : [];
  return {
    country: String(details.country ?? ""),
    system: String(details.system ?? "Tax"),
    effectivePercent: Number(details.effectivePercent ?? 0),
    taxAmount: Number(details.taxAmount ?? taxAmount),
    components,
    summaryLines: Array.isArray(details.summaryLines)
      ? details.summaryLines.map(String)
      : [],
  };
}

async function assertInvoiceRecordAccess(id: string) {
  const invoice = await getInvoice(id);
  if (!invoice) throw new Error("Invoice not found.");
  const ownerUserId =
    invoice.deal?.ownerUserId ??
    invoice.order?.deal?.ownerUserId ??
    invoice.createdByUserId ??
    null;
  await assertRecordAccess(ownerUserId);
  return invoice;
}

export async function listInvoicesPageCommand(filters: {
  page?: number;
  search?: string;
  status?: string;
}): Promise<{
  items: InvoiceListPageItem[];
  pagination: Awaited<ReturnType<typeof listInvoices>>["pagination"];
  summary: InvoiceSummary;
}> {
  await requireModuleEnabled("finance", "Finance is not available for your business type.");
  const scope = await resolveRecordOwnerScope();
  const dealOwnerUserId = scope.ownerUserId;
  const status = parseStatusFilter(filters.status);
  const [result, summary] = await Promise.all([
    listInvoices({
      page: filters.page ?? 1,
      pageSize: 50,
      search: filters.search,
      status,
      dealOwnerUserId,
    }),
    getInvoiceSummary({ dealOwnerUserId }),
  ]);

  return {
    items: result.items.map(mapInvoiceRow),
    pagination: result.pagination,
    summary,
  };
}

export async function listInvoiceBarCommand(): Promise<InvoiceBarItem[]> {
  const scope = await resolveRecordOwnerScope();
  return listInvoiceBarItems({
    dealOwnerUserId: scope.ownerUserId,
  });
}

export async function getInvoiceCommand(
  id: string,
): Promise<{ ok: true; invoice: InvoiceDetailView } | { ok: false; error: string }> {
  try {
    await requireModuleEnabled("finance", "Finance is not available for your business type.");
    const invoice = await assertInvoiceRecordAccess(id);
    const dealId =
      invoice.deal?.id ??
      invoice.order?.deal?.id ??
      invoice.dealId ??
      invoice.order?.dealId ??
      null;
    const dealTitle =
      invoice.deal?.title ?? invoice.order?.deal?.title ?? null;
    const seller = await loadSellerOrganization(invoice.organizationId);
    const vendorName = seller?.companyName?.trim() || "Our company";

    // Preview uses deal-personalized page-clone when stored; otherwise live template layout.
    const template = invoice.templateId
      ? await getInvoiceTemplate(invoice.templateId).catch(() => null)
      : null;
    const resolvedLayout = resolveDocumentBlueprintForPreview({
      storedBlueprint: invoice.blueprint,
      storedAssets: invoice.assets,
      templateBlueprint: template?.blueprint,
      templateAssets: template?.assets,
    });
    let blueprint = resolvedLayout.blueprint;
    let assets = resolvedLayout.assets;

    const lineNames = invoice.lines.map((l) => l.name).join(" ");
    const scoped = dealId
      ? await resolveProposalProductScope({
          dealId,
          organizationId: invoice.organizationId,
          dealTitle: dealTitle || "",
          dealNotes: null,
          title: invoice.number,
          summary: null,
          matchText: lineNames,
        }).catch(() => null)
      : null;

    const visuals = await adaptProposalVisuals({
      blueprint: blueprint ?? defaultDocumentBlueprint("invoice"),
      assets,
      product: scoped?.product ?? null,
      dealTitle: dealTitle || "",
      sellerAddress: seller?.billingAddress?.trim() || null,
      productHint: scoped?.productHint ?? (lineNames || null),
      kind: "invoice",
    }).catch(() => null);

    const { overlayBankDetailsOnSections, getEffectiveFinanceDefaults } =
      await import("@/dao/finance/org-finance-settings");
    const financeDefaults = await getEffectiveFinanceDefaults(
      invoice.organizationId,
    );
    const rawSections = overlayBankDetailsOnSections(
      parseInvoiceDocumentSections(invoice.sections),
      financeDefaults.bankDetails,
    );
    const taxDetails = mapTaxDetails(invoice.taxDetails, invoice.taxAmount);
    const subtotalNum = invoice.lines.reduce(
      (sum, line) => sum + Number(line.amount),
      0,
    );
    const prepared = prepareCommercialInvoiceView({
      blueprint: visuals?.blueprint ?? blueprint,
      assets: visuals?.assets?.length ? visuals.assets : assets,
      sections: rawSections,
      lines: invoice.lines.map((line) => ({
        name: line.name,
        description: line.description,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toString(),
        amount: line.amount.toString(),
        taxPercent: line.taxPercent.toString(),
      })),
      currency: invoice.currency,
      subtotal: subtotalNum,
      taxAmount: Number(invoice.taxAmount),
      total: Number(invoice.total),
      taxDetails,
      sellerAddress: seller?.billingAddress?.trim() || null,
      vendorName,
      companyName: invoice.company?.name ?? null,
      billingAddress: invoice.billingAddress,
      issueDateLabel: (invoice.issueDate ?? invoice.createdAt).toLocaleDateString(
        undefined,
        { year: "numeric", month: "short", day: "numeric" },
      ),
      dueDateLabel: invoice.dueAt
        ? invoice.dueAt.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : null,
    });

    return {
      ok: true,
      invoice: {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        total: invoice.total.toString(),
        discountAmount: invoice.discountAmount.toString(),
        taxAmount: invoice.taxAmount.toString(),
        currency: invoice.currency,
        companyId: invoice.company?.id ?? "",
        companyName: invoice.company?.name ?? "—",
        orderId: invoice.order?.id ?? null,
        orderNumber: invoice.order?.number ?? null,
        dealId,
        dealTitle,
        dueAt: invoice.dueAt?.toISOString() ?? null,
        paidAt: invoice.paidAt?.toISOString() ?? null,
        issueDate: invoice.issueDate?.toISOString() ?? null,
        paymentTerms: invoice.paymentTerms,
        notes: invoice.notes,
        billingAddress: invoice.billingAddress,
        leadEmail: invoice.leadEmail,
        leadPhone: invoice.leadPhone,
        taxId: invoice.taxId,
        taxDetails,
        templateId: invoice.templateId ?? null,
        templateName: invoice.template?.name ?? null,
        vendorName,
        sellerAddress: seller?.billingAddress?.trim() || null,
        sellerLetterhead: prepared.tokens.sellerLetterhead || null,
        vendorLegalName: prepared.tokens.vendorLegalName || null,
        amountInWords: prepared.tokens.amountInWords || null,
        sections: prepared.sections,
        blueprint: prepared.blueprint,
        assets: prepared.assets,
        createdAt: invoice.createdAt.toISOString(),
        lines: invoice.lines.map((line) => ({
          id: line.id,
          kind: line.kind,
          name: line.name,
          description: line.description,
          quantity: line.quantity.toString(),
          unitPrice: line.unitPrice.toString(),
          taxPercent: line.taxPercent.toString(),
          amount: line.amount.toString(),
        })),
        escalationSeverity: invoice.escalationSeverity ?? null,
        escalationReason: invoice.escalationReason ?? null,
        escalationDraft: invoice.escalationDraft ?? null,
        escalationLastRunAt: invoice.escalationLastRunAt?.toISOString() ?? null,
        approvalStatus: invoice.approvalStatus ?? null,
        approvedAt: invoice.approvedAt?.toISOString() ?? null,
        approvalNote: invoice.approvalNote ?? null,
        billingKind: invoice.billingKind ?? "standard",
        paymentMethod: invoice.paymentMethod ?? null,
        paymentReference: invoice.paymentReference ?? null,
        paymentConfirmedAt: invoice.paymentConfirmedAt?.toISOString() ?? null,
        voidedAt: invoice.voidedAt?.toISOString() ?? null,
        voidReason: invoice.voidReason ?? null,
        submittedForApprovalAt:
          invoice.submittedForApprovalAt?.toISOString() ?? null,
        resubmittedAt: invoice.resubmittedAt?.toISOString() ?? null,
        paymentProvider: invoice.paymentProvider ?? null,
        paymentLinkUrl: invoice.paymentLinkUrl ?? null,
        paymentSessionId: invoice.paymentSessionId ?? null,
        paymentSessionExpiresAt:
          invoice.paymentSessionExpiresAt?.toISOString() ?? null,
        paymentSessionStatus: invoice.paymentSessionStatus ?? null,
        sentAt: invoice.sentAt?.toISOString() ?? null,
        lastSentAt: invoice.lastSentAt?.toISOString() ?? null,
        contractId: invoice.contractId ?? null,
        billingScheduleId: invoice.billingScheduleId ?? null,
        ...(await buildPaymentPathPreview(invoice)),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invoice not found.",
    };
  }
}

function invoiceCsvCell(value: string): string {
  const text = value.replace(/‹br›/gi, "\n");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function getInvoiceCsvCommand(id: string) {
  try {
    const invoice = await assertInvoiceRecordAccess(id);
    const { parsePipeGrid } = await import("@/lib/spreadsheet-sheet");
    const sections = parseInvoiceDocumentSections(invoice.sections);
    const sheet = sections.find(
      (section) => section.key.toLowerCase() === "line_items",
    );
    const grid = isSpreadsheetLayoutBlueprint(invoice.blueprint)
      ? parsePipeGrid(sheet?.body || "")
      : [];
    const csv = (
      grid.length
        ? grid
        : [
            ["Item", "Qty", "Unit price", "Amount"],
            ...invoice.lines.map((line) => [
              line.name,
              String(line.quantity),
              String(line.unitPrice),
              String(line.amount),
            ]),
            ["", "", "Total", String(invoice.total)],
          ]
    )
      .map((row) => row.map((cell) => invoiceCsvCell(String(cell))).join(","))
      .join("\n");
    return {
      ok: true as const,
      csv,
      filename: `${invoice.number || "invoice"}.csv`,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to export CSV.",
      status: 500,
    };
  }
}

export async function getInvoicePdfCommand(id: string) {
  try {
    const invoice = await assertInvoiceRecordAccess(id);
    const date = (invoice.issueDate ?? invoice.createdAt).toLocaleDateString(
      undefined,
      { year: "numeric", month: "short", day: "numeric" },
    );
    const dueDate = invoice.dueAt
      ? invoice.dueAt.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";
    const seller = await loadSellerOrganization(invoice.organizationId);
    const vendorName = seller?.companyName?.trim() || "Our company";
    const company = formatCompanyDisplayName(
      invoice.company?.name?.trim() || "Customer",
    );
    const subtotal = invoice.lines.reduce(
      (sum, line) => sum + Number(line.amount),
      0,
    );
    const discountAmount = Number(invoice.discountAmount);
    const taxAmount = Number(invoice.taxAmount);
    const total = Number(invoice.total);

    const { overlayBankDetailsOnSections, getEffectiveFinanceDefaults } =
      await import("@/dao/finance/org-finance-settings");
    const financeDefaults = await getEffectiveFinanceDefaults(
      invoice.organizationId,
    );
    let sections = overlayBankDetailsOnSections(
      parseInvoiceDocumentSections(invoice.sections),
      financeDefaults.bankDetails,
    );
    const taxDetails = mapTaxDetails(invoice.taxDetails, invoice.taxAmount);

    const template = invoice.templateId
      ? await getInvoiceTemplate(invoice.templateId).catch(() => null)
      : null;
    const resolvedLayout = resolveDocumentBlueprintForPreview({
      storedBlueprint: invoice.blueprint,
      storedAssets: invoice.assets,
      templateBlueprint: template?.blueprint,
      templateAssets: template?.assets,
    });
    let layoutBlueprint =
      resolvedLayout.blueprint ?? defaultDocumentBlueprint("invoice");
    let layoutAssets = resolvedLayout.assets;

    const commercial = isCommercialInvoiceBlueprint(layoutBlueprint);
    let commercialTokens: {
      sellerLetterhead: string;
      vendorLegalName: string;
      amountInWords: string;
      tagline: string | null;
    } | null = null;
    if (commercial) {
      const prepared = prepareCommercialInvoiceView({
        blueprint: layoutBlueprint,
        assets: layoutAssets,
        sections,
        lines: invoice.lines.map((line) => ({
          name: line.name,
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          amount: Number(line.amount),
          taxPercent: Number(line.taxPercent),
        })),
        currency: invoice.currency,
        subtotal,
        taxAmount,
        total,
        taxDetails,
        sellerAddress: seller?.billingAddress?.trim() || null,
        vendorName,
        companyName: company,
        billingAddress: invoice.billingAddress,
        issueDateLabel: date,
        dueDateLabel: dueDate,
      });
      sections = prepared.sections;
      layoutBlueprint = prepared.blueprint;
      layoutAssets = prepared.assets;
      commercialTokens = prepared.tokens;
    } else {
      const linesMd = invoiceLinesPipeTable(
        invoice.lines.map((line) => ({
          name: line.name,
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          amount: Number(line.amount),
          taxPercent: Number(line.taxPercent),
        })),
        invoice.currency,
      );
      const totalsMd = invoiceTotalsMarkdown({
        currency: invoice.currency,
        subtotal,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        taxAmount: taxAmount > 0 ? taxAmount : null,
        taxDetails,
        total,
      });
      if (!isSpreadsheetLayoutBlueprint(invoice.blueprint)) {
        sections = withCommercialLineItemsSection(sections, linesMd, totalsMd, {
          stripInvoiceTotals: true,
        });
      }
    }

    const lineNames = invoice.lines.map((l) => l.name).join(" ");
    const dealId =
      invoice.deal?.id ??
      invoice.order?.deal?.id ??
      invoice.dealId ??
      invoice.order?.dealId ??
      null;
    const dealTitle =
      invoice.deal?.title ?? invoice.order?.deal?.title ?? "";
    const scoped = dealId
      ? await resolveProposalProductScope({
          dealId,
          organizationId: invoice.organizationId,
          dealTitle,
          dealNotes: null,
          title: invoice.number,
          summary: null,
          matchText: `${lineNames}\n${sections.map((s) => `${s.title}\n${s.body}`).join("\n")}`,
        }).catch(() => null)
      : null;

    const visuals = await adaptProposalVisuals({
      blueprint: layoutBlueprint,
      assets: layoutAssets,
      product: scoped?.product ?? null,
      dealTitle: dealTitle || "",
      sellerAddress: seller?.billingAddress?.trim() || null,
      productHint: scoped?.productHint ?? (lineNames || null),
      kind: "invoice",
    });
    const blueprint = commercial
      ? layoutBlueprint
      : resolveBlueprintForView(
          visuals.blueprint ?? layoutBlueprint,
          "fillable",
        );
    const stampAssets = commercial
      ? layoutAssets
      : visuals.assets.length > 0
        ? visuals.assets
        : layoutAssets;
    const productScope =
      scoped?.product?.name ||
      scoped?.productScope ||
      visuals.productScope;
    const sellerAddress = seller?.billingAddress?.trim() || "";

    const html = renderBlueprintHtml({
      blueprint,
      assets: stampAssets,
      sections,
      tokens: {
        customerName: company,
        companyName: company,
        invoiceNumber: invoice.number,
        date,
        dueDate,
        vendorName,
        currency: invoice.currency,
        subtotal: subtotal.toFixed(2),
        taxAmount: Number.isFinite(taxAmount) ? taxAmount.toFixed(2) : "0.00",
        total: Number.isFinite(total) ? total.toFixed(2) : "0.00",
        paymentTerms: invoice.paymentTerms || "Net 30",
        billingAddress: invoice.billingAddress || "—",
        taxId: invoice.taxId || "—",
        dealTitle,
        productScope: productScopeForCoverParens(productScope),
        sellerAddress,
        sellerLetterhead:
          commercialTokens?.sellerLetterhead || sellerAddress || "",
        vendorLegalName:
          commercialTokens?.vendorLegalName || vendorName || "",
        amountInWords:
          commercialTokens?.amountInWords ||
          amountInWords(total, invoice.currency),
      },
    });

    const useChrome = blueprintUsesExternalChrome(blueprint);
    const buffer = await htmlToPdfBuffer(
      useChrome ? stripInBodyPageChrome(html) : html,
      useChrome
        ? chromeFromBlueprintAssets(stampAssets, vendorName, sellerAddress)
        : null,
    );
    return {
      ok: true as const,
      buffer,
      filename: `${invoice.number || "invoice"}.pdf`,
    };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error
          ? err.message
          : "Failed to generate PDF. Ensure Playwright Chromium is installed.",
      status: 500,
    };
  }
}

export async function getInvoiceDocxCommand(id: string) {
  try {
    const invoice = await assertInvoiceRecordAccess(id);
    const date = (invoice.issueDate ?? invoice.createdAt).toLocaleDateString(
      undefined,
      { year: "numeric", month: "short", day: "numeric" },
    );
    const seller = await loadSellerOrganization(invoice.organizationId);
    const vendorName = seller?.companyName?.trim() || "Our company";
    const company = formatCompanyDisplayName(
      invoice.company?.name?.trim() || "Customer",
    );
    const { overlayBankDetailsOnSections, getEffectiveFinanceDefaults } =
      await import("@/dao/finance/org-finance-settings");
    const financeDefaults = await getEffectiveFinanceDefaults(
      invoice.organizationId,
    );
    let sections = overlayBankDetailsOnSections(
      parseInvoiceDocumentSections(invoice.sections),
      financeDefaults.bankDetails,
    );
    const subtotal = invoice.lines.reduce(
      (sum, line) => sum + Number(line.amount),
      0,
    );
    const taxAmount = Number(invoice.taxAmount);
    const total = Number(invoice.total);
    const linesMd = commercialInvoiceLinesPipeTable(
      invoice.lines.map((line) => ({
        name: line.name,
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        amount: Number(line.amount),
      })),
      invoice.currency,
    );
    const totalsMd = invoiceTotalsMarkdown({
      currency: invoice.currency,
      subtotal,
      taxAmount,
      total,
      taxDetails: mapTaxDetails(invoice.taxDetails, invoice.taxAmount),
    });
    if (!isSpreadsheetLayoutBlueprint(invoice.blueprint)) {
      sections = withCommercialLineItemsSection(sections, linesMd, totalsMd, {
        stripInvoiceTotals: true,
      });
    }

    const { proposalHtmlToDocxBuffer } = await import(
      "@/service/sales/proposal-docx"
    );
    const buffer = await proposalHtmlToDocxBuffer({
      number: invoice.number,
      title: `Invoice ${invoice.number}`,
      customerName: company,
      vendorName,
      date,
      html: "",
      sections: sections.map((s) => ({ title: s.title, body: s.body })),
    });
    return {
      ok: true as const,
      buffer,
      filename: `${invoice.number || "invoice"}.docx`,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to generate DOCX.",
      status: 500,
    };
  }
}

export async function listInvoiceTemplatesCommand() {
  try {
    await ensureDefaultInvoiceTemplate();
    const items = await listInvoiceTemplates();
    return { ok: true as const, items };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to list invoice templates.",
    };
  }
}

export async function getInvoiceTemplateCommand(id: string) {
  try {
    const template = await getInvoiceTemplate(id);
    if (!template) {
      return { ok: false as const, error: "Template not found.", status: 404 };
    }
    return { ok: true as const, template };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to load template.",
    };
  }
}

export async function createInvoiceTemplateCommand(input: {
  name: string;
  makeActive?: boolean;
  sections?: InvoiceDocumentSection[];
  blueprint?: unknown;
  assets?: unknown;
}) {
  try {
    await requireInvoiceTemplateEdit("You cannot edit invoice templates.");
    const template = await createInvoiceTemplate({
      name: input.name,
      makeActive: input.makeActive,
      sections: input.sections,
      blueprint: parseDocumentBlueprint(input.blueprint),
      assets: parseBlueprintAssetsStrict(input.assets),
    });
    return { ok: true as const, id: template.id, template };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to create template.",
    };
  }
}

export async function updateInvoiceTemplateCommand(
  id: string,
  input: {
    name?: string;
    sections?: InvoiceDocumentSection[];
    isDefault?: boolean;
    blueprint?: unknown;
    assets?: unknown;
  },
) {
  try {
    await requireInvoiceTemplateEdit("You cannot edit invoice templates.");
    const template = await updateInvoiceTemplate(id, {
      name: input.name,
      sections: input.sections,
      isDefault: input.isDefault,
      ...(input.blueprint !== undefined
        ? { blueprint: parseDocumentBlueprint(input.blueprint) }
        : {}),
      ...(input.assets !== undefined
        ? { assets: parseBlueprintAssetsStrict(input.assets) }
        : {}),
    });
    return { ok: true as const, id: template.id, template };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to update template.",
    };
  }
}

export async function deleteInvoiceTemplateCommand(id: string) {
  try {
    await requireInvoiceTemplateEdit("You cannot delete invoice templates.");
    await deleteInvoiceTemplate(id);
    return { ok: true as const, id };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to delete template.",
    };
  }
}

export async function listDealsForInvoiceCommand(): Promise<DealInvoiceOption[]> {
  await requireFinanceEdit("You cannot create invoices.");
  return listDealsForInvoiceSelect();
}

export async function getDealInvoiceAutofillCommand(
  dealId: string,
): Promise<
  { ok: true; data: DealInvoiceAutofill } | { ok: false; error: string }
> {
  try {
    await requireFinanceEdit("You cannot create invoices.");
    const deal = await getDeal(dealId);
    if (!deal) return { ok: false, error: "Deal not found." };
    await assertRecordAccess(deal.ownerUserId);
    const data = await getDealInvoiceAutofill(dealId);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load deal.",
    };
  }
}

export async function listInvoiceProductsCommand(): Promise<
  InvoiceProductOption[]
> {
  await requireFinanceEdit("You cannot create invoices.");
  return listActiveProductsWithAddons();
}

export async function getInvoiceCreateOptionsCommand(): Promise<{
  deals: DealInvoiceOption[];
  products: InvoiceProductOption[];
  bar: InvoiceBarItem[];
  templates: Array<{ id: string; name: string; isDefault: boolean }>;
}> {
  await requireFinanceEdit("You cannot create invoices.");
  const scope = await resolveRecordOwnerScope();
  const [deals, products, bar, templateItems] = await Promise.all([
    listDealsForInvoiceSelect({ ownerUserId: scope.ownerUserId }),
    listActiveProductsWithAddons(),
    listInvoiceBarItems({ dealOwnerUserId: scope.ownerUserId }),
    listInvoiceTemplates(),
  ]);
  return {
    deals,
    products,
    bar,
    templates: templateItems.map((t) => ({
      id: t.id,
      name: t.name,
      isDefault: t.isDefault,
    })),
  };
}

export async function createInvoiceFromDealCommand(input: {
  dealId: string;
  currency?: string;
  status?: "draft" | "sent";
  billingKind?: InvoiceBillingKindValue;
  paymentTerms?: string | null;
  notes?: string | null;
  billingAddress?: string | null;
  leadEmail?: string | null;
  leadPhone?: string | null;
  taxId?: string | null;
  discountAmount?: number;
  issueDate?: string | null;
  dueAt?: string | null;
  taxConfig?: CreateInvoiceFromDealInput["taxConfig"];
  lines: CreateInvoiceFromDealInput["lines"];
  templateId?: string | null;
}): Promise<CommandResult> {
  try {
    await requireRole(
      (role) => canEditFinance(role) || canEditDeals(role),
      "You cannot create invoices.",
    );
    const deal = await getDeal(input.dealId);
    if (!deal) return { ok: false, error: "Deal not found." };
    await assertRecordAccess(deal.ownerUserId);
    const userId = await getServerUserId();
    const role = await getCurrentUserRole();
    const needsFinanceApproval = !canEditFinance(role);
    const now = new Date();
    const invoice = await createInvoiceFromDeal({
      ...input,
      status: "draft",
      billingKind: input.billingKind ?? "standard",
      approvalStatus: needsFinanceApproval ? "pending_approval" : "drafting",
      submittedForApprovalAt: needsFinanceApproval ? now : null,
      actorUserId: userId,
    });
    if (needsFinanceApproval) {
      await notifyFinanceInvoicePendingApproval({
        organizationId: String(invoice.organizationId),
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        dealTitle: deal.title,
        dealId: input.dealId,
        ownerUserId: deal.ownerUserId ? String(deal.ownerUserId) : null,
        contactId: deal.contactId,
        actorUserId: userId,
      }).catch((err) =>
        console.error("notifyFinanceInvoicePendingApproval create failed", err),
      );
    }
    notifyAdminsAsync({
      kind: "invoice_created",
      actorUserId: userId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      dealId: input.dealId,
      dealTitle: deal.title,
      contactId: deal.contactId,
      contactName: deal.contactName,
      companyName: deal.company?.name ?? null,
      ownerUserId: deal.ownerUserId,
      href: `/finance/${invoice.id}`,
    });
    return { ok: true, id: invoice.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create invoice.",
    };
  }
}

export async function markInvoicePaidCommand(
  id: string,
  input?: {
    paymentReference?: string | null;
    paymentMethod?: InvoicePaymentMethodValue;
  },
): Promise<CommandResult> {
  try {
    await requireFinanceEdit("You cannot update invoices.");
    const existing = await assertInvoiceRecordAccess(id);
    const userId = await getServerUserId();
    await markInvoicePaid(id, {
      paymentReference: input?.paymentReference,
      paymentMethod: input?.paymentMethod,
      confirmedByUserId: userId,
    });
    notifyAdminsAsync({
      kind: "invoice_paid",
      actorUserId: userId,
      invoiceId: id,
      invoiceNumber: existing.number,
      dealId: existing.dealId,
      companyName: existing.company?.name ?? null,
      ownerUserId:
        existing.deal?.ownerUserId ??
        existing.order?.deal?.ownerUserId ??
        existing.createdByUserId ??
        null,
      href: `/finance/${id}`,
    });
    const contactId =
      existing.deal?.contactId ?? existing.order?.deal?.contactId ?? null;
    if (contactId) {
      triggerLeadLifecycle({
        contactId,
        organizationId: existing.organizationId,
        triggerReason: "invoice_paid",
      });
    }
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark invoice paid.",
    };
  }
}

export async function deleteInvoiceCommand(id: string): Promise<CommandResult> {
  try {
    await requireFinanceEdit("You cannot delete invoices.");
    await assertInvoiceRecordAccess(id);
    await deleteInvoice(id);
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete invoice.",
    };
  }
}

async function resolveInvoiceLineInputs(
  lines: Array<{
    productId?: string | null;
    name?: string | null;
    quantity?: number | string | null;
    unitPrice?: number | string | null;
    description?: string | null;
  }>,
): Promise<InvoiceLinePatchInput[]> {
  const products = await listActiveProductsWithAddons();
  const out: InvoiceLinePatchInput[] = [];
  for (const row of lines) {
    const pid = String(row.productId || "").trim();
    const nameRaw = String(row.name || "").trim();
    const product =
      products.find((p) => p.id === pid) ||
      (nameRaw
        ? products.find(
            (p) =>
              p.name.toLowerCase() === nameRaw.toLowerCase() ||
              p.name.toLowerCase().includes(nameRaw.toLowerCase()) ||
              nameRaw.toLowerCase().includes(p.name.toLowerCase()),
          )
        : null);
    const name = (product?.name || nameRaw).trim();
    if (!name) continue;
    const quantity = Math.max(0.01, Number(row.quantity) || 1);
    const unitFromRow = Number(row.unitPrice);
    const unitPrice =
      Number.isFinite(unitFromRow) && unitFromRow >= 0
        ? unitFromRow
        : product?.price != null
          ? Number(product.price)
          : 0;
    out.push({
      productId: product?.id ?? (pid || null),
      name,
      quantity,
      unitPrice,
      description: row.description?.trim() || null,
    });
  }
  if (!out.length) throw new Error("Add at least one invoice line.");
  return out;
}

export async function updateInvoiceCommand(
  id: string,
  input: {
    notes?: string | null;
    paymentTerms?: string | null;
    lines?: Array<{
      productId?: string | null;
      name?: string | null;
      quantity?: number | string | null;
      unitPrice?: number | string | null;
      description?: string | null;
    }>;
    discountAmount?: number | string | null;
    discountPct?: number | string | null;
  },
): Promise<CommandResult> {
  try {
    await requireFinanceEdit("You cannot update invoices.");
    await assertInvoiceRecordAccess(id);
    const resolvedLines =
      input.lines !== undefined
        ? await resolveInvoiceLineInputs(input.lines)
        : undefined;
    const discountAmtRaw =
      input.discountAmount === undefined || input.discountAmount === null
        ? undefined
        : Number(input.discountAmount);
    const discountPctRaw =
      input.discountPct === undefined || input.discountPct === null
        ? undefined
        : Number(input.discountPct);
    await updateInvoice(id, {
      notes: input.notes,
      paymentTerms: input.paymentTerms,
      ...(resolvedLines ? { lines: resolvedLines } : {}),
      ...(discountAmtRaw !== undefined && Number.isFinite(discountAmtRaw)
        ? { discountAmount: discountAmtRaw }
        : {}),
      ...(discountPctRaw !== undefined && Number.isFinite(discountPctRaw)
        ? { discountPct: discountPctRaw }
        : {}),
    });
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update invoice.",
    };
  }
}

export async function sendInvoiceEmailCommand(
  id: string,
  options?: SendInvoiceOptions,
): Promise<CommandResult> {
  try {
    await requireFinanceEdit("You cannot send invoices.");
    await assertInvoiceRecordAccess(id);
    const userId = await getServerUserId();
    if (!userId) {
      return { ok: false, error: "Sign in again to send email." };
    }
    const invoice = await getInvoice(id);
    if (!invoice) return { ok: false, error: "Invoice not found." };
    const row = await prisma.invoice.findUnique({ where: { id } });
    if (billingKindBlocksCustomerSend(row?.billingKind)) {
      return {
        ok: false,
        error:
          "This invoice kind is for internal billing records and cannot be sent to the customer.",
      };
    }
    if (row?.approvalStatus === "finance_rejected") {
      return {
        ok: false,
        error:
          "Finance rejected this invoice. Revise it and save before sending.",
      };
    }

    const { assertDocumentApprovedForSend } = await import(
      "@/service/sales/document-approval"
    );
    const approvalFields = {
      approvedByUserId: row?.approvedByUserId ?? null,
      approvedAt: row?.approvedAt ?? null,
    };
    try {
      assertDocumentApprovedForSend(approvalFields, "invoice");
    } catch {
      return {
        ok: false,
        error:
          "This invoice must be approved before it can be sent to the customer.",
      };
    }

    const result = await dispatchInvoiceCustomerEmail(
      id,
      userId,
      "initial_send",
      options,
    );
    if (!result.ok) return result;

    notifyAdminsAsync({
      kind: "invoice_sent",
      actorUserId: userId,
      invoiceId: id,
      invoiceNumber: invoice?.number ?? null,
      dealId: invoice?.dealId ?? null,
      companyName: invoice?.company?.name ?? null,
      ownerUserId:
        invoice?.deal?.ownerUserId ??
        invoice?.order?.deal?.ownerUserId ??
        invoice?.createdByUserId ??
        null,
      href: `/finance/${id}`,
    });
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send invoice.",
    };
  }
}

export async function resendInvoiceEmailCommand(
  id: string,
  options?: SendInvoiceOptions,
): Promise<CommandResult> {
  try {
    await requireFinanceEdit("You cannot resend invoices.");
    await assertInvoiceRecordAccess(id);
    const userId = await getServerUserId();
    if (!userId) {
      return { ok: false, error: "Sign in again to resend email." };
    }
    const invoice = await getInvoice(id);
    if (!invoice) return { ok: false, error: "Invoice not found." };
    if (invoice.status !== "sent" && invoice.status !== "overdue") {
      return {
        ok: false,
        error: "Only sent or overdue invoices can be resent.",
      };
    }
    if (billingKindBlocksCustomerSend(invoice.billingKind)) {
      return {
        ok: false,
        error: "This invoice kind cannot be emailed to the customer.",
      };
    }

    return dispatchInvoiceCustomerEmail(
      id,
      userId,
      "payment_reminder",
      options,
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to resend invoice.",
    };
  }
}

export async function voidInvoiceCommand(
  id: string,
  reason: string,
): Promise<CommandResult> {
  try {
    await requireFinanceEdit("You cannot void invoices.");
    const existing = await assertInvoiceRecordAccess(id);
    const userId = await getServerUserId();
    const { cancelInvoicePaymentLink } = await import(
      "@/service/finance/payment-gateways/index"
    );
    await cancelInvoicePaymentLink(id);
    await voidInvoice(id, { reason, voidedByUserId: userId });
    notifyAdminsAsync({
      kind: "invoice_voided",
      actorUserId: userId,
      invoiceId: id,
      invoiceNumber: existing.number,
      dealId: existing.dealId,
      companyName: existing.company?.name ?? null,
      ownerUserId:
        existing.deal?.ownerUserId ??
        existing.order?.deal?.ownerUserId ??
        existing.createdByUserId ??
        null,
      href: `/finance/${id}`,
      metadata: { reason: reason.trim() },
    });
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to void invoice.",
    };
  }
}
