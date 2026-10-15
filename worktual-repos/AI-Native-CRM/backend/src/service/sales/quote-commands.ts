/**
 * Framework-agnostic quote commands for Fastify Wave 5B.
 */

import { getServerUserId } from "@/service/account/session-cookie";
import {
  canEditFinance,
  canEditQuotes,
  canUploadCommercialDocumentTemplates,
} from "@/service/auth/rbac";
import {
  getCurrentOrganizationId,
  requireModuleEnabled,
  requireRole,
} from "@/service/auth/require-role";
import {
  assertRecordAccess,
  resolveRecordOwnerScope,
} from "@/service/auth/ownership-scope";
import { getDeal, listDealsForSelect } from "@/dao/sales/deal-service";
import {
  acceptQuote,
  createQuote,
  deleteQuote,
  getQuote,
  listQuotes,
  markQuoteSent,
  rejectQuote,
  updateQuote,
  emailQuoteToContact,
  type QuoteLineInput,
} from "@/dao/sales/quote-service";
import {
  createQuoteTemplate,
  ensureDefaultQuoteTemplate,
  getQuoteTemplate,
  listQuoteTemplates,
  updateQuoteTemplate,
  deleteQuoteTemplate,
} from "@/dao/sales/quote-template-service";
import {
  computeQuoteDiscountLimit,
  evaluateQuoteDiscountApproval,
  PENDING_FINANCE_APPROVAL,
} from "@/service/sales/quote-discount-approval";
import {
  amountInWords,
  parseQuoteDocumentSections,
  type QuoteDocumentSection,
} from "@/lib/quote-document-sections";
import {
  commercialLinesPipeTable,
  commercialTotalsMarkdown,
  withCommercialLineItemsSection,
} from "@/lib/commercial-line-table";
import {
  defaultDocumentBlueprint,
  isSpreadsheetLayoutBlueprint,
  parseBlueprintAssets,
  parseBlueprintAssetsStrict,
  parseDocumentBlueprint,
  renderBlueprintHtml,
  stripInBodyPageChrome,
} from "@/lib/document-blueprint";
import { formatCompanyDisplayName } from "@/lib/proposal-sections";
import {
  chromeFromBlueprintAssets,
  htmlToPdfBuffer,
} from "@/service/sales/proposal-pdf";
import {
  adaptProposalVisuals,
  productScopeForCoverParens,
  proposalProductScope,
  resolveProposalProductScope,
} from "@/service/sales/proposal-visuals";
import { resolveDocumentBlueprintForPreview } from "@/service/sales/document-blueprint-preview";
import { proposalHtmlToDocxBuffer } from "@/service/sales/proposal-docx";
import { loadSellerOrganization } from "@/service/ai/seller-org";
import { listOrdersForDeal } from "@/dao/sales/order-service";
import { resolveListPrice } from "@/dao/products/price-book-service";
import { notifyAdminsAsync } from "@/dao/notifications/notify-admins";
import { prisma } from "@/dao/db/prisma";

export type CommandResult =
  | { ok: true; id: string; warning?: string; invoiceId?: string | null }
  | { ok: false; error: string };

/**
 * Role AND business-type gate for every quote mutation. B2C orgs never have
 * `sales` enabled (Commerce revenue path only) — a B2C admin/sales_manager
 * still passes `canEditQuotes` on role alone, so the module gate must be
 * checked here too.
 */
async function requireQuotesEdit(message?: string) {
  await requireRole(canEditQuotes, message);
  await requireModuleEnabled(
    "sales",
    message ?? "Quotes are not available for your business type.",
  );
}

/** Org-level quote document templates — admin upload/design only. */
async function requireQuoteTemplateEdit(message: string) {
  await requireRole(canUploadCommercialDocumentTemplates, message);
  await requireModuleEnabled(
    "sales",
    message ?? "Quotes are not available for your business type.",
  );
}

const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "void",
] as const;

async function assertQuoteDealAccess(dealId: string) {
  const deal = await getDeal(dealId);
  if (!deal) throw new Error("Deal not found.");
  await assertRecordAccess(deal.ownerUserId);
  return deal;
}

async function assertQuoteAccess(quoteId: string) {
  const quote = await getQuote(quoteId);
  if (!quote) throw new Error("Quote not found.");
  await assertRecordAccess(quote.deal.ownerUserId);
  return quote;
}

export async function listQuotesCommand(filters: {
  page?: number;
  dealId?: string;
  status?: string;
}) {
  await requireModuleEnabled("sales", "Quotes are not available for your business type.");
  const scope = await resolveRecordOwnerScope();
  const status =
    filters.status &&
    QUOTE_STATUSES.includes(filters.status as (typeof QUOTE_STATUSES)[number])
      ? (filters.status as (typeof QUOTE_STATUSES)[number])
      : "all";
  const result = await listQuotes({
    page: filters.page ?? 1,
    dealId: filters.dealId,
    status,
    ownerUserId: scope.ownerUserId,
  });
  return {
    items: result.items.map((q) => ({
      id: q.id,
      number: q.number,
      status: q.status,
      total: q.total.toString(),
      currency: q.currency,
      dealId: q.dealId,
      dealTitle: q.deal.title,
      updatedAt: q.updatedAt.toISOString(),
      proposalLabel: q.proposal
        ? `${q.proposal.number} v${q.proposal.version}`
        : null,
    })),
    pagination: result.pagination,
  };
}

export type PendingDiscountApproval = {
  id: string;
  number: string;
  dealId: string;
  dealTitle: string;
  contactName: string | null;
  companyName: string | null;
  discountPct: string;
  limitPct: number | null;
  total: string;
  currency: string;
  updatedAt: string;
};

/** Finance's queue: quotes whose discount exceeds a product's cap, awaiting sign-off. */
export async function listPendingDiscountApprovalsCommand(): Promise<
  | { ok: true; items: PendingDiscountApproval[] }
  | { ok: false; error: string }
> {
  try {
    await requireModuleEnabled(
      "finance",
      "Discount approvals are not available for your business type.",
    );
    await requireRole(
      canEditFinance,
      "You cannot view discount approvals.",
    );
    const organizationId = await getCurrentOrganizationId();
    const quotes = await prisma.quote.findMany({
      where: { organizationId, approvalStatus: PENDING_FINANCE_APPROVAL },
      include: {
        lines: { select: { productId: true } },
        deal: {
          select: {
            title: true,
            contactName: true,
            company: { select: { name: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    const items = await Promise.all(
      quotes.map(async (q) => ({
        id: q.id,
        number: q.number,
        dealId: q.dealId,
        dealTitle: q.deal?.title ?? "",
        contactName: q.deal?.contactName ?? null,
        companyName: q.deal?.company?.name ?? null,
        discountPct: q.discountPct.toString(),
        limitPct: await computeQuoteDiscountLimit(
          q.lines.map((l) => ({ productId: l.productId })),
        ),
        total: q.total.toString(),
        currency: q.currency,
        updatedAt: q.updatedAt.toISOString(),
      })),
    );
    return { ok: true, items };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to load discount approvals.",
    };
  }
}

/** Deal-scoped quotes joined with order/invoice for panel UI. */
export async function listDealQuotesCommand(dealId: string) {
  await assertQuoteDealAccess(dealId);
  const scope = await resolveRecordOwnerScope();
  const [quotesResult, orders] = await Promise.all([
    listQuotes({
      page: 1,
      dealId,
      ownerUserId: scope.ownerUserId,
      includeLines: false,
    }),
    listOrdersForDeal(dealId),
  ]);

  const orderByQuoteId = new Map(
    orders
      .filter((o) => o.quoteId)
      .map((o) => [o.quoteId as string, o] as const),
  );

  return {
    items: quotesResult.items.map((q) => {
      const order = orderByQuoteId.get(q.id) as
        | {
            number: string;
            status: string;
            invoices?: Array<{
              id: string;
              number: string;
              status: string;
            }>;
          }
        | undefined;
      const invoice = order?.invoices?.[0] ?? null;
      return {
        id: q.id,
        number: q.number,
        status: q.status,
        approvalStatus: q.approvalStatus,
        total: q.total.toString(),
        currency: q.currency,
        updatedAt: q.updatedAt.toISOString(),
        proposalLabel: q.proposal
          ? `${q.proposal.number} v${q.proposal.version}`
          : null,
        orderNumber: order?.number ?? null,
        orderStatus: order?.status ?? null,
        invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.number ?? null,
        invoiceStatus: invoice?.status ?? null,
      };
    }),
  };
}

export async function getQuoteCommand(id: string) {
  try {
    await requireModuleEnabled("sales", "Quotes are not available for your business type.");
    const quote = await assertQuoteAccess(id);
    const seller = await loadSellerOrganization(quote.organizationId);
    const vendorName =
      quote.vendorName?.trim() ||
      seller?.companyName?.trim() ||
      quote.companyName ||
      "Our company";
    const totalNum = Number(quote.total);
    const discountLimitPct = await computeQuoteDiscountLimit(
      quote.lines.map((l) => ({ productId: l.productId })),
    );

    // Preview uses deal-personalized page-clone when stored; otherwise live template layout.
    const template = quote.templateId
      ? await getQuoteTemplate(quote.templateId).catch(() => null)
      : null;
    const resolvedLayout = resolveDocumentBlueprintForPreview({
      storedBlueprint: quote.blueprint,
      storedAssets: quote.assets,
      templateBlueprint: template?.blueprint,
      templateAssets: template?.assets,
    });
    let blueprint = resolvedLayout.blueprint;
    let assets = resolvedLayout.assets;

    const lineNames = quote.lines.map((l) => l.name).join(" ");
    const scoped = await resolveProposalProductScope({
      dealId: quote.dealId,
      organizationId: quote.organizationId,
      dealTitle: quote.deal.title,
      dealNotes: null,
      title: quote.number,
      summary: null,
      matchText: lineNames,
    }).catch(() => null);

    const visuals = await adaptProposalVisuals({
      blueprint: blueprint ?? defaultDocumentBlueprint("quote"),
      assets,
      product: scoped?.product ?? null,
      dealTitle: quote.deal.title || "",
      sellerAddress: seller?.billingAddress?.trim() || null,
      productHint: scoped?.productHint ?? (lineNames || null),
      kind: "quote",
    }).catch(() => null);

    return {
      ok: true as const,
      quote: {
        id: quote.id,
        number: quote.number,
        version: quote.version,
        status: quote.status,
        currency: quote.currency,
        subtotal: quote.subtotal.toString(),
        discountPct: quote.discountPct.toString(),
        total: quote.total.toString(),
        amountInWords: amountInWords(
          Number.isFinite(totalNum) ? totalNum : 0,
          quote.currency,
        ),
        notes: quote.notes,
        validUntil: quote.validUntil?.toISOString() ?? null,
        sentAt: quote.sentAt?.toISOString() ?? null,
        acceptedAt: quote.acceptedAt?.toISOString() ?? null,
        approvalStatus: quote.approvalStatus,
        approvalNote: quote.approvalNote ?? null,
        approvedAt: quote.approvedAt?.toISOString() ?? null,
        isApproved: Boolean(quote.approvedByUserId && quote.approvedAt),
        discountLimitPct,
        dealId: quote.dealId,
        dealTitle: quote.deal.title,
        customerName:
          quote.customerName ??
          quote.deal.contactName ??
          quote.deal.company?.name ??
          null,
        companyName:
          quote.companyName ?? quote.deal.company?.name ?? null,
        vendorName,
        documentSections: parseQuoteDocumentSections(quote.documentSections),
        templateId: quote.templateId,
        templateName: quote.template?.name ?? null,
        blueprint: visuals?.blueprint ?? blueprint,
        assets: visuals?.assets?.length ? visuals.assets : assets,
        proposalLabel: quote.proposal
          ? `${quote.proposal.number} v${quote.proposal.version}`
          : null,
        lines: quote.lines.map((line) => ({
          id: line.id,
          productId: line.productId,
          name: line.name,
          quantity: line.quantity.toString(),
          unitPrice: line.unitPrice.toString(),
          amount: line.amount.toString(),
          sortOrder: line.sortOrder,
        })),
        createdAt: quote.createdAt.toISOString(),
        updatedAt: quote.updatedAt.toISOString(),
      },
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to load quote.",
      status: 404,
    };
  }
}

export async function getQuotePdfCommand(id: string) {
  try {
    const quote = await assertQuoteAccess(id);
    const date = new Date(quote.updatedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const validUntil = quote.validUntil
      ? quote.validUntil.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";
    const seller = await loadSellerOrganization(quote.organizationId);
    const vendorName =
      quote.vendorName?.trim() ||
      seller?.companyName?.trim() ||
      "Our company";
    const company = formatCompanyDisplayName(
      quote.companyName?.trim() ||
        quote.deal.company?.name?.trim() ||
        quote.customerName?.trim() ||
        "Customer",
    );
    const subtotal = Number(quote.subtotal);
    const discountPct = Number(quote.discountPct);
    const total = Number(quote.total);
    const discountAmount =
      Number.isFinite(subtotal) && Number.isFinite(discountPct)
        ? (subtotal * discountPct) / 100
        : 0;

    let sections = parseQuoteDocumentSections(quote.documentSections);
    const spreadsheet = isSpreadsheetLayoutBlueprint(quote.blueprint);
    if (!spreadsheet) {
      const linesMd = commercialLinesPipeTable(
        quote.lines.map((line) => ({
          name: line.name,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          amount: Number(line.amount),
        })),
        quote.currency,
      );
      const totalsMd = commercialTotalsMarkdown({
        currency: quote.currency,
        subtotal,
        discountLabel:
          discountPct > 0 ? `${discountPct}%` : null,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        total,
      });
      sections = withCommercialLineItemsSection(sections, linesMd, totalsMd);
    }

    const lineNames = quote.lines.map((l) => l.name).join(" ");
    const scoped = await resolveProposalProductScope({
      dealId: quote.dealId,
      organizationId: quote.organizationId,
      dealTitle: quote.deal.title,
      dealNotes: null,
      title: quote.number,
      summary: null,
      matchText: `${lineNames}\n${sections.map((s) => `${s.title}\n${s.body}`).join("\n")}`,
    }).catch(() => null);

    const template = quote.templateId
      ? await getQuoteTemplate(quote.templateId).catch(() => null)
      : null;
    const resolvedLayout = resolveDocumentBlueprintForPreview({
      storedBlueprint: quote.blueprint,
      storedAssets: quote.assets,
      templateBlueprint: template?.blueprint,
      templateAssets: template?.assets,
    });
    let layoutBlueprint =
      resolvedLayout.blueprint ?? defaultDocumentBlueprint("quote");
    let layoutAssets = resolvedLayout.assets;

    const visuals = await adaptProposalVisuals({
      blueprint: layoutBlueprint,
      assets: layoutAssets,
      product: scoped?.product ?? null,
      dealTitle: quote.deal.title || "",
      sellerAddress: seller?.billingAddress?.trim() || null,
      productHint: scoped?.productHint ?? (lineNames || null),
      kind: "quote",
    });
    const blueprint = visuals.blueprint ?? layoutBlueprint;
    const stampAssets =
      visuals.assets.length > 0 ? visuals.assets : layoutAssets;
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
        dealTitle: quote.deal.title || "",
        date,
        vendorName,
        documentTitle: "Quotation",
        quoteNumber: quote.number,
        currency: quote.currency,
        subtotal: Number.isFinite(subtotal) ? subtotal.toFixed(2) : "0.00",
        discountPct: Number.isFinite(discountPct)
          ? String(discountPct)
          : "0",
        total: Number.isFinite(total) ? total.toFixed(2) : "0.00",
        validUntil,
        productScope: productScopeForCoverParens(productScope),
        sellerAddress,
      },
    });

    const buffer = await htmlToPdfBuffer(
      stripInBodyPageChrome(html),
      chromeFromBlueprintAssets(stampAssets, vendorName, sellerAddress),
    );
    return {
      ok: true as const,
      buffer,
      filename: `${quote.number || "quote"}.pdf`,
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

export async function getQuoteDocxCommand(id: string) {
  try {
    const quote = await assertQuoteAccess(id);
    const date = new Date(quote.updatedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const company = formatCompanyDisplayName(
      quote.companyName?.trim() ||
        quote.deal.company?.name?.trim() ||
        quote.customerName?.trim() ||
        "Customer",
    );
    const vendorName = quote.vendorName?.trim() || "Our company";
    let sections = parseQuoteDocumentSections(quote.documentSections);
    const subtotal = Number(quote.subtotal);
    const discountPct = Number(quote.discountPct);
    const total = Number(quote.total);
    const discountAmount =
      Number.isFinite(subtotal) && Number.isFinite(discountPct)
        ? (subtotal * discountPct) / 100
        : 0;
    if (!isSpreadsheetLayoutBlueprint(quote.blueprint)) {
      const linesMd = commercialLinesPipeTable(
        quote.lines.map((line) => ({
          name: line.name,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          amount: Number(line.amount),
        })),
        quote.currency,
      );
      const totalsMd = commercialTotalsMarkdown({
        currency: quote.currency,
        subtotal,
        discountLabel: discountPct > 0 ? `${discountPct}%` : null,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        total,
      });
      sections = withCommercialLineItemsSection(sections, linesMd, totalsMd);
    }

    const buffer = await proposalHtmlToDocxBuffer({
      number: quote.number,
      title: `Quotation ${quote.number}`,
      customerName: company,
      vendorName,
      date,
      html: "",
      sections: sections.map((s) => ({ title: s.title, body: s.body })),
    });
    return {
      ok: true as const,
      buffer,
      filename: `${quote.number || "quote"}.docx`,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to generate DOCX.",
      status: 500,
    };
  }
}

function csvCell(value: string): string {
  const text = value.replace(/‹br›/gi, "\n");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function pipeTableToCsv(markdown: string): string | null {
  const rows = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => {
      const inner = line.replace(/^\|/, "").replace(/\|$/, "");
      return !(/^[\s|:-]+$/.test(inner) && /[-:]/.test(inner));
    });
  if (rows.length < 1) return null;
  return rows
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => csvCell(cell.trim()))
        .join(","),
    )
    .join("\n");
}

export async function getQuoteCsvCommand(id: string) {
  try {
    const quote = await assertQuoteAccess(id);
    const sections = parseQuoteDocumentSections(quote.documentSections);
    const sheet = sections.find(
      (section) => section.key.toLowerCase() === "line_items",
    );
    const fromSheet = isSpreadsheetLayoutBlueprint(quote.blueprint)
      ? pipeTableToCsv(sheet?.body || "")
      : null;
    const csv =
      fromSheet ??
      [
        ["Item", "Qty", "Unit price", "Amount"].map(csvCell).join(","),
        ...quote.lines.map((line) =>
          [
            line.name,
            String(line.quantity),
            String(line.unitPrice),
            String(line.amount),
          ]
            .map(csvCell)
            .join(","),
        ),
        ["", "", "Total", String(quote.total)].map(csvCell).join(","),
      ].join("\n");
    return {
      ok: true as const,
      csv,
      filename: `${quote.number || "quote"}.csv`,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to export CSV.",
      status: 500,
    };
  }
}

type QuoteFormOffer = {
  id: string;
  name: string;
  code: string | null;
  meterKey: string | null;
  includedQty: number | null;
  listPrice: string | null;
  currency: string;
};

type QuoteFormAddon = {
  id: string;
  name: string;
  unitLabel: string | null;
  meterKey: string | null;
  isOverage: boolean;
  pricingModel: string;
  listPrice: string | null;
  flatPrice: string | null;
  unitPrice: string | null;
  stepSize: number | null;
  stepPrice: string | null;
  currency: string;
  tiers: Array<{
    minQty: number;
    maxQty: number | null;
    unitPrice: number;
  }>;
};

type QuoteFormProduct = {
  id: string;
  name: string;
  sku: string | null;
  productType: "fixed" | "customizable";
  currency: string;
  /** @deprecated Prefer basePrice / listPrice */
  price: string | null;
  basePrice: string | null;
  listPrice: string | null;
  offers: QuoteFormOffer[];
  addons: QuoteFormAddon[];
};

async function buildCrmQuoteProducts(): Promise<QuoteFormProduct[]> {
  const organizationId = await getCurrentOrganizationId();
  const rows = await prisma.product.findMany({
    where: {
      organizationId,
      status: { not: "archived" },
    },
    orderBy: { name: "asc" },
    take: 500,
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      currency: true,
      productType: true,
      offers: {
        where: { status: "active" },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          code: true,
          meterKey: true,
          includedQty: true,
        },
      },
      addons: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          unitLabel: true,
          meterKey: true,
          isOverage: true,
          pricingModel: true,
          flatPrice: true,
          unitPrice: true,
          stepSize: true,
          stepPrice: true,
          tiers: {
            orderBy: { minQty: "asc" },
            select: {
              minQty: true,
              maxQty: true,
              unitPrice: true,
            },
          },
        },
      },
    },
  });

  const products: QuoteFormProduct[] = [];
  for (const row of rows) {
    const productResolved = await resolveListPrice({ productId: row.id });
    const basePrice = row.price?.toString() ?? null;
    const listPrice = productResolved.amount ?? basePrice;
    const currency = productResolved.currency || row.currency || "";

    const offers: QuoteFormOffer[] = [];
    for (const offer of row.offers) {
      const resolved = await resolveListPrice({ offerId: offer.id });
      offers.push({
        id: offer.id,
        name: offer.name,
        code: offer.code,
        meterKey: offer.meterKey,
        includedQty: offer.includedQty,
        listPrice: resolved.amount ?? listPrice,
        currency: resolved.currency || currency,
      });
    }

    const addons: QuoteFormAddon[] = [];
    for (const addon of row.addons) {
      const resolved = await resolveListPrice({ addonId: addon.id });
      const fallback =
        addon.pricingModel === "flat"
          ? addon.flatPrice?.toString() ?? null
          : addon.pricingModel === "per_unit"
            ? addon.unitPrice?.toString() ?? null
            : addon.pricingModel === "stepped"
              ? addon.stepPrice?.toString() ?? null
              : null;
      addons.push({
        id: addon.id,
        name: addon.name,
        unitLabel: addon.unitLabel,
        meterKey: addon.meterKey,
        isOverage: Boolean(addon.isOverage),
        pricingModel: addon.pricingModel,
        listPrice: resolved.amount ?? fallback,
        flatPrice: addon.flatPrice?.toString() ?? null,
        unitPrice: addon.unitPrice?.toString() ?? null,
        stepSize: addon.stepSize,
        stepPrice: addon.stepPrice?.toString() ?? null,
        currency: resolved.currency || currency,
        tiers: addon.tiers.map((t) => ({
          minQty: t.minQty,
          maxQty: t.maxQty,
          unitPrice: Number(t.unitPrice),
        })),
      });
    }

    products.push({
      id: row.id,
      name: row.name,
      sku: row.sku,
      productType: row.productType === "customizable" ? "customizable" : "fixed",
      currency,
      price: listPrice,
      basePrice,
      listPrice,
      offers,
      addons,
    });
  }
  return products;
}

export async function getQuoteFormOptionsCommand() {
  const deals = await listDealsForSelect();
  const products = await buildCrmQuoteProducts();

  return {
    deals: deals.map((d) => ({ id: d.id, title: d.title })),
    products,
  };
}

export async function createQuoteCommand(input: {
  dealId: string;
  discountPct?: number;
  notes?: string | null;
  proposalId?: string | null;
  currency?: string | null;
  fromTemplate?: boolean;
  templateId?: string | null;
  lines: QuoteLineInput[];
}): Promise<CommandResult> {
  try {
    await requireQuotesEdit("You cannot create quotes.");
    await assertQuoteDealAccess(input.dealId);
    const userId = await getServerUserId();

    let lines = input.lines;
    if (!lines?.length && input.proposalId) {
      const { resolveQuoteLinesFromProposalId } = await import(
        "@/service/sales/quote-from-proposal"
      );
      lines = await resolveQuoteLinesFromProposalId(input.proposalId);
    }
    if (!lines?.length) {
      return { ok: false, error: "Add at least one quote line." };
    }

    const resolvedLines = await resolveQuoteLineInputs(
      lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    );

    const quote = await createQuote({
      dealId: input.dealId,
      lines: resolvedLines,
      discountPct: input.discountPct,
      notes: input.notes,
      proposalId: input.proposalId,
      currency: input.currency,
      fromTemplate: input.fromTemplate,
      templateId: input.templateId,
      createdByUserId: userId,
    });

    if (input.fromTemplate !== false && quote.blueprint) {
      const { fillQuoteDocumentFromTemplate } = await import(
        "@/service/sales/commercial-document-fill"
      );
      await fillQuoteDocumentFromTemplate(quote.id).catch((err) => {
        console.error("[quote-fill]", err);
      });
    }

    await evaluateQuoteDiscountApproval({
      quoteId: quote.id,
      organizationId: String(quote.organizationId),
      discountPct: Number(quote.discountPct),
      previousApprovalStatus: quote.approvalStatus,
      lines: quote.lines.map((l) => ({ productId: l.productId })),
      actorUserId: userId,
      dealTitle: quote.deal?.title ?? null,
      quoteNumber: quote.number,
    });
    const deal = await getDeal(input.dealId);
    notifyAdminsAsync({
      kind: "quote_created",
      actorUserId: userId,
      dealId: input.dealId,
      dealTitle: deal?.title ?? null,
      contactId: deal?.contactId ?? null,
      contactName: deal?.contactName ?? null,
      companyName: deal?.company?.name ?? null,
      ownerUserId: deal?.ownerUserId ?? null,
      quoteId: quote.id,
      quoteNumber: quote.number,
      href: `/sales/quotes/${quote.id}`,
    });
    return { ok: true, id: quote.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create quote.",
    };
  }
}

export async function createQuoteFromRequirementCommand(input: {
  dealId: string;
  requirementPdfBase64: string;
  requirementFilename?: string | null;
}): Promise<CommandResult> {
  try {
    await requireQuotesEdit("You cannot create quotes.");
    await assertQuoteDealAccess(input.dealId);
    const pdfB64 = input.requirementPdfBase64?.trim() || "";
    if (!pdfB64) {
      return {
        ok: false,
        error: "Attach a BRD (PDF, Word, or text) to generate this quote.",
      };
    }
    const deal = await getDeal(input.dealId);
    if (!deal) return { ok: false, error: "Deal not found." };
    const organizationId = await getCurrentOrganizationId();
    const { randomBytes } = await import("node:crypto");
    const { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } = await import(
      "@/service/ai/ai-service-client"
    );
    const filename = input.requirementFilename?.trim() || "requirement.pdf";
    const ingest = await callAiServiceAgent<{
      ok?: boolean;
      fullText?: string;
      reason?: string;
    }>(
      "proposal-corpus-ingest",
      {
        itemId: `quote-req-${randomBytes(6).toString("hex")}`,
        filename,
        contentBase64: pdfB64,
        organizationId,
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );
    const extracted = String(ingest?.fullText || "").trim();
    if (extracted.length < 8) {
      return {
        ok: false,
        error: ingest?.reason
          ? `Could not read the BRD (${ingest.reason}).`
          : "Could not read text from that BRD.",
      };
    }
    const { buildQuoteDraftFromRequirementText } = await import(
      "@/service/sales/quote-from-proposal"
    );
    const draft = await buildQuoteDraftFromRequirementText({
      organizationId,
      dealTitle: deal.title,
      customerName: deal.contactName ?? null,
      companyName: deal.company?.name ?? null,
      requirementText: extracted,
    });
    if (!draft.lines.length) {
      return {
        ok: false,
        error:
          "Could not read commercial rows from the BRD, so no quote was created.",
      };
    }
    const created = await createQuoteCommand({
      dealId: input.dealId,
      fromTemplate: true,
      notes: `Draft from BRD ${filename} — review pricing before sending.`,
      lines: draft.lines,
    });
    if (!created.ok || !draft.sheetMarkdown) return created;
    const quote = await getQuote(created.id);
    if (!quote) return created;
    const sections = parseQuoteDocumentSections(quote.documentSections).map(
      (section) =>
        section.key.toLowerCase() === "line_items"
          ? { ...section, body: draft.sheetMarkdown }
          : section,
    );
    await updateQuote(created.id, { documentSections: sections });
    return created;
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to create quote from BRD.",
    };
  }
}

type QuoteLinePatchInput = {
  productId?: string | null;
  name?: string;
  quantity?: number | string;
  unitPrice?: number | string;
};

function quoteProductUnitPrice(product: QuoteFormProduct): number {
  const n = Number(product.listPrice ?? product.basePrice ?? product.price ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function matchQuoteFormProduct(
  products: QuoteFormProduct[],
  productId?: string | null,
  name?: string | null,
): QuoteFormProduct | null {
  const id = productId?.trim() || "";
  const nm = name?.trim().toLowerCase() || "";
  if (id) {
    const exact = products.find((p) => p.id === id);
    if (exact) return exact;
  }
  if (!nm) return null;
  const exactName = products.find((p) => p.name.toLowerCase() === nm);
  if (exactName) return exactName;
  const contained = products.filter(
    (p) =>
      p.name.toLowerCase().includes(nm) || nm.includes(p.name.toLowerCase()),
  );
  if (contained.length === 1) return contained[0]!;
  const tokens = nm.split(/\s+/).filter((t) => t.length >= 2);
  const tokenHits = products.filter((p) => {
    const hay = p.name.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
  if (tokenHits.length === 1) return tokenHits[0]!;
  return null;
}

function quoteLineInputComplete(row: QuoteLinePatchInput): boolean {
  const name = (row.name || "").trim();
  const unitFromRow = Number(row.unitPrice);
  return (
    name.length > 0 &&
    Number.isFinite(unitFromRow) &&
    unitFromRow >= 0 &&
    Math.max(0.01, Number(row.quantity) || 1) > 0
  );
}

async function resolveQuoteLineInputs(
  lines: QuoteLinePatchInput[],
): Promise<QuoteLineInput[]> {
  const allComplete = lines.every(quoteLineInputComplete);
  let products: QuoteFormProduct[] = [];
  if (!allComplete) {
    const options = await getQuoteFormOptionsCommand();
    products = options.products ?? [];
  }
  const out: QuoteLineInput[] = [];
  for (const row of lines) {
    const product = products.length
      ? matchQuoteFormProduct(products, row.productId, row.name)
      : null;
    const name = (product?.name || row.name || "").trim();
    if (!name) continue;
    const quantity = Math.max(0.01, Number(row.quantity) || 1);
    const unitFromRow = Number(row.unitPrice);
    const unitPrice =
      Number.isFinite(unitFromRow) && unitFromRow >= 0
        ? unitFromRow
        : product
          ? quoteProductUnitPrice(product)
          : 0;
    out.push({
      productId: product?.id ?? (row.productId?.trim() || null),
      name,
      quantity,
      unitPrice,
    });
  }
  if (!out.length) throw new Error("Add at least one quote line.");
  return out;
}

export async function updateQuoteCommand(
  id: string,
  input: {
    notes?: string | null;
    documentSections?: QuoteDocumentSection[] | null;
    customerName?: string | null;
    companyName?: string | null;
    vendorName?: string | null;
    lines?: QuoteLinePatchInput[];
    discountPct?: number | string | null;
  },
): Promise<CommandResult> {
  try {
    await requireQuotesEdit("You cannot update quotes.");
    const existing = await assertQuoteAccess(id);
    const resolvedLines =
      input.lines !== undefined
        ? await resolveQuoteLineInputs(input.lines)
        : undefined;
    const discountRaw =
      input.discountPct === undefined || input.discountPct === null
        ? undefined
        : Number(input.discountPct);
    const wantsLines = resolvedLines !== undefined;
    const wantsDiscount = discountRaw !== undefined && Number.isFinite(discountRaw);
    const quote = await updateQuote(id, {
      notes: input.notes,
      documentSections: input.documentSections,
      customerName: input.customerName,
      companyName: input.companyName,
      vendorName: input.vendorName,
      ...(resolvedLines ? { lines: resolvedLines } : {}),
      ...(wantsDiscount ? { discountPct: discountRaw } : {}),
    });
    if (wantsLines || wantsDiscount) {
      const userId = await getServerUserId();
      await evaluateQuoteDiscountApproval({
        quoteId: quote.id,
        organizationId: String(quote.organizationId),
        discountPct: Number(quote.discountPct),
        previousApprovalStatus: existing.approvalStatus,
        lines: quote.lines.map((l) => ({ productId: l.productId })),
        actorUserId: userId,
        dealTitle: existing.deal?.title ?? null,
        quoteNumber: quote.number,
      });
    }
    return { ok: true, id: quote.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update quote.",
    };
  }
}

export async function deleteQuoteCommand(id: string): Promise<CommandResult> {
  try {
    await requireQuotesEdit("You cannot delete quotes.");
    await assertQuoteAccess(id);
    await deleteQuote(id);
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete quote.",
    };
  }
}

export async function listQuoteTemplatesCommand() {
  try {
    await requireQuotesEdit();
    await ensureDefaultQuoteTemplate();
    const items = await listQuoteTemplates();
    return { ok: true as const, items };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to load templates.",
    };
  }
}

export async function getQuoteTemplateCommand(id: string) {
  try {
    await requireQuotesEdit();
    const template = await getQuoteTemplate(id);
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

export async function createQuoteTemplateCommand(input: {
  name: string;
  sections?: QuoteDocumentSection[];
  makeActive?: boolean;
  blueprint?: unknown;
  assets?: unknown;
}) {
  try {
    await requireQuoteTemplateEdit("You cannot create quote templates.");
    const template = await createQuoteTemplate({
      name: input.name,
      sections: input.sections,
      makeActive: input.makeActive,
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

export async function updateQuoteTemplateCommand(
  id: string,
  input: {
    name?: string;
    sections?: QuoteDocumentSection[];
    isDefault?: boolean;
    blueprint?: unknown;
    assets?: unknown;
  },
) {
  try {
    await requireQuoteTemplateEdit("You cannot edit quote templates.");
    const template = await updateQuoteTemplate(id, {
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

export async function deleteQuoteTemplateCommand(id: string) {
  try {
    await requireQuoteTemplateEdit("You cannot delete quote templates.");
    await deleteQuoteTemplate(id);
    return { ok: true as const, id };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to delete template.",
    };
  }
}

export async function rewriteQuoteSectionCommand(
  id: string,
  input: { sectionKey: string; instruction?: string },
): Promise<
  | { ok: true; id: string; warnings?: string[] }
  | { ok: false; error: string; status?: number }
> {
  try {
    await requireQuotesEdit("You cannot update quotes.");
    const existing = await assertQuoteAccess(id);
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Only draft quotes can be rewritten.",
        status: 400,
      };
    }
    const sectionKey = input.sectionKey?.trim();
    if (!sectionKey) {
      return { ok: false, error: "sectionKey is required.", status: 400 };
    }
    const { rewriteQuoteSectionBodies } = await import(
      "@/service/sales/quote-section-rewrite"
    );
    const rewritten = await rewriteQuoteSectionBodies({
      quoteId: id,
      sectionKey,
      instruction: input.instruction,
    });
    if (
      rewritten.warnings.some((w) => w.includes("No section matching"))
    ) {
      return {
        ok: false,
        error: rewritten.warnings[0] || "Section not found.",
        status: 400,
      };
    }
    await updateQuote(id, { documentSections: rewritten.sections });
    return {
      ok: true,
      id,
      ...(rewritten.warnings.length ? { warnings: rewritten.warnings } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to rewrite section.",
    };
  }
}

export {
  updateQuoteDocumentAssetCommand,
  updateProposalDocumentAssetCommand,
} from "@/service/sales/document-asset-update";

export async function markQuoteSentCommand(id: string): Promise<CommandResult> {
  let pendingFinance = false;
  let financeRejected = false;
  try {
    await requireQuotesEdit();
    const existing = await assertQuoteAccess(id);
    pendingFinance = existing.approvalStatus === PENDING_FINANCE_APPROVAL;
    financeRejected = existing.approvalStatus === "finance_rejected";
    const userId = await getServerUserId();
    if (!userId) {
      return { ok: false, error: "Sign in again to send the quote." };
    }

    const { assertDocumentApprovedForSend, markDocumentApproved } =
      await import("@/service/sales/document-approval");
    const approvalFields = {
      approvedByUserId: existing.approvedByUserId ?? null,
      approvedAt: existing.approvedAt ?? null,
    };

    if (pendingFinance) {
      try {
        assertDocumentApprovedForSend(approvalFields, "quote");
      } catch {
        return {
          ok: false,
          error:
            "This quote's discount exceeds the product's limit and needs Finance approval before it can be sent.",
        };
      }
    } else {
      try {
        assertDocumentApprovedForSend(approvalFields, "quote");
      } catch {
        await markDocumentApproved({
          type: "quote",
          id,
          approvedByUserId: userId,
        });
      }
    }

    let pdfAttachment: { filename: string; buffer: Buffer } | null = null;
    const pdf = await getQuotePdfCommand(id);
    if (pdf.ok) {
      pdfAttachment = { filename: pdf.filename, buffer: pdf.buffer };
    }
    const { quote, emailWarning } = await markQuoteSent(id, userId, pdfAttachment);
    notifyAdminsAsync({
      kind: "quote_sent",
      actorUserId: userId,
      dealId: existing.dealId,
      dealTitle: existing.deal?.title ?? null,
      contactId: existing.deal?.contactId ?? null,
      ownerUserId: existing.deal?.ownerUserId ?? null,
      quoteId: quote.id,
      quoteNumber: quote.number,
      href: `/sales/${existing.dealId}`,
    });
    return {
      ok: true,
      id,
      ...(emailWarning ? { warning: emailWarning } : {}),
    };
  } catch (err) {
    if (pendingFinance) {
      return {
        ok: false,
        error:
          "This quote's discount exceeds the product's limit and needs Finance approval before it can be sent.",
      };
    }
    if (financeRejected) {
      return {
        ok: false,
        error:
          "Finance rejected this discount. Revise the quote and save before sending.",
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark quote sent.",
    };
  }
}

/** Re-email a sent quote with PDF (e.g. after reconnecting Gmail). */
export async function resendQuoteCommand(id: string): Promise<CommandResult> {
  try {
    await requireQuotesEdit();
    const existing = await assertQuoteAccess(id);
    if (existing.status !== "sent") {
      return {
        ok: false,
        error: "Only sent quotes can be re-sent. Use Send on a draft first.",
      };
    }

    const userId = await getServerUserId();
    if (!userId) {
      return { ok: false, error: "Sign in again to send the quote." };
    }

    const full = await getQuote(id);
    if (!full) return { ok: false, error: "Quote not found." };

    const pdf = await getQuotePdfCommand(id);
    const pdfAttachment = pdf.ok
      ? { filename: pdf.filename, buffer: pdf.buffer }
      : null;

    const emailWarning = await emailQuoteToContact({
      quote: full,
      actorUserId: userId,
      attachment: pdfAttachment,
    });
    if (emailWarning) {
      return { ok: false, error: emailWarning };
    }

    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to resend quote.",
    };
  }
}

export async function acceptQuoteCommand(id: string): Promise<CommandResult> {
  try {
    await requireQuotesEdit();
    await assertQuoteAccess(id);
    const userId = await getServerUserId();
    const { quote, order } = await acceptQuote(id, userId);
    const { notifyAfterQuoteAccepted } = await import(
      "@/service/email/commercial-notify"
    );
    const invoiceId = await notifyAfterQuoteAccepted({
      organizationId: String(quote.organizationId),
      quoteId: quote.id,
      quoteNumber: quote.number,
      dealId: quote.dealId,
      dealTitle: quote.deal?.title ?? null,
      contactId: quote.deal?.contactId ?? null,
      ownerUserId: quote.deal?.ownerUserId ?? null,
      orderId: order?.id ?? null,
      actorUserId: userId,
    });
    return { ok: true, id, invoiceId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to accept quote.",
    };
  }
}

export async function rejectQuoteCommand(id: string): Promise<CommandResult> {
  try {
    await requireQuotesEdit();
    const existing = await assertQuoteAccess(id);
    const quote = await rejectQuote(id);
    const userId = await getServerUserId();
    notifyAdminsAsync({
      kind: "quote_rejected",
      actorUserId: userId,
      dealId: existing.dealId,
      dealTitle: existing.deal?.title ?? null,
      contactId: existing.deal?.contactId ?? null,
      ownerUserId: existing.deal?.ownerUserId ?? null,
      quoteId: quote.id,
      quoteNumber: quote.number,
      href: `/sales/${existing.dealId}`,
    });
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reject quote.",
    };
  }
}
