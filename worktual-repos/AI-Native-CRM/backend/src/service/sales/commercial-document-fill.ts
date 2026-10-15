/**
 * LLM fill for quote / invoice documents in learned template designs.
 * Isolated from proposal playbook generation.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { getProposal } from "@/dao/sales/proposal-service";
import { updateQuote } from "@/dao/sales/quote-service";
import { getEffectiveFinanceDefaults } from "@/dao/finance/org-finance-settings";
import {
  isSpreadsheetLayoutBlueprint,
  listPageCloneAssets,
  parseBlueprintAssets,
  parseDocumentBlueprint,
  type BlueprintAsset,
} from "@/lib/document-blueprint";
import {
  applyQuoteDocumentMerge,
  parseQuoteDocumentSections,
  type QuoteDocumentSection,
  amountInWords,
} from "@/lib/quote-document-sections";
import {
  applyInvoiceDocumentMerge,
  parseInvoiceDocumentSections,
  type InvoiceDocumentSection,
} from "@/lib/invoice-document-sections";
import { parseProposalSections } from "@/lib/proposal-sections";
import {
  commercialInvoiceLinesPipeTable,
  commercialLinesPipeTable,
  commercialTotalsMarkdown,
  invoiceTotalsMarkdown,
  withCommercialLineItemsSection,
} from "@/lib/commercial-line-table";
import { parsePipeGrid, pipeGrid } from "@/lib/spreadsheet-sheet";
import { loadMeetingNotesForDeal } from "@/service/ai/proposal-brief";
import {
  callAiServiceAgent,
  AI_SERVICE_JOB_TIMEOUT_MS,
  AI_SERVICE_MAX_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";
import { loadSellerOrganization } from "@/service/ai/seller-org";
import {
  buildClonePersonalizeContext,
  personalizePageCloneDocument,
} from "@/service/sales/document-clone-personalize";
import {
  proposalProductScope,
  resolveProposalProductScope,
} from "@/service/sales/proposal-visuals";

type FillAgentSection = {
  key?: string;
  title?: string;
  body?: string;
  tableRows?: Array<{ cells?: string[] }>;
};

function pageAssetNumber(id: string): number {
  const match = /^page-(\d+)$/i.exec(id.trim());
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function pageImagesFromTemplateAssets(assets: unknown): Array<{
  page: number;
  mime: string;
  dataBase64: string;
}> {
  if (assets && typeof assets === "object" && !Array.isArray(assets)) {
    const rec = assets as Record<string, unknown>;
    const raw = rec.pageImages;
    if (Array.isArray(raw)) {
      const out: Array<{ page: number; mime: string; dataBase64: string }> = [];
      for (const row of raw) {
        if (!row || typeof row !== "object") continue;
        const item = row as Record<string, unknown>;
        let b64 = String(item.dataBase64 || "").trim();
        const dataUrl = String(item.dataUrl || "");
        if (!b64 && dataUrl.includes(",")) b64 = dataUrl.split(",")[1] || "";
        if (b64.length < 32) continue;
        out.push({
          page: Number(item.page) || out.length + 1,
          mime: String(item.mime || "image/png"),
          dataBase64: b64,
        });
        if (out.length >= 8) break;
      }
      if (out.length) return out;
    }
  }
  const parsed = parseBlueprintAssets(assets);
  const pages = listPageCloneAssets(parsed).filter((a) => a.dataBase64?.trim());
  return pages.map((a) => ({
    page: pageAssetNumber(a.id),
    mime: a.mime || "image/png",
    dataBase64: a.dataBase64!.trim(),
  }));
}

function formatDateLabel(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMoney(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return `${currency} 0.00`;
  return `${currency} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function mergeFilledSections<T extends { key: string; title: string; body: string; sortOrder: number }>(
  base: T[],
  filled: FillAgentSection[],
): T[] {
  if (!filled.length) return base;
  const byKey = new Map(base.map((s) => [(s.key || "").toLowerCase(), s]));
  for (const row of filled) {
    const key = String(row.key || "").trim().toLowerCase();
    if (!key) continue;
    const prev = byKey.get(key);
    const body = String(row.body || "").trim();
    const title = String(row.title || "").trim();
    if (prev) {
      byKey.set(key, {
        ...prev,
        title: title || prev.title,
        body: body || prev.body,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

async function callCommercialFillAgent(input: {
  agent: "quote-fill-template" | "invoice-fill-template";
  pageImages: Array<{ page: number; mime: string; dataBase64: string }>;
  skeleton: Array<{ key: string; title: string; purpose?: string; tableSpec?: unknown }>;
  css: string;
  contextJson: Record<string, unknown>;
}): Promise<{ sections: FillAgentSection[]; source?: string; reason?: string; warnings: string[] }> {
  const fill = await callAiServiceAgent<{
    source?: string;
    reason?: string;
    sections?: FillAgentSection[];
    warnings?: string[];
  }>(
    input.agent,
    {
      pageImages: input.pageImages,
      skeleton: input.skeleton,
      css: input.css,
      context: input.contextJson,
    },
    { timeoutMs: AI_SERVICE_MAX_TIMEOUT_MS },
  );
  const sections = Array.isArray(fill?.sections) ? fill.sections : [];
  return {
    sections,
    source: fill?.source,
    reason: fill?.reason,
    warnings: fill?.warnings ?? [],
  };
}

function skeletonFromQuoteSections(sections: QuoteDocumentSection[]) {
  return sections.map((s) => ({
    key: s.key,
    title: s.title,
    purpose: s.key === "line_items" ? "Product and pricing table" : undefined,
    tableSpec:
      s.key === "line_items"
        ? { columns: ["Item", "Qty", "Unit price", "Amount"] }
        : undefined,
  }));
}

function skeletonFromInvoiceSections(sections: InvoiceDocumentSection[]) {
  return sections.map((s) => ({
    key: s.key,
    title: s.title,
    purpose:
      s.key === "line_items"
        ? "Invoice line items and financial summary"
        : undefined,
    tableSpec:
      s.key === "line_items"
        ? {
            columns: ["Solution", "Description", "Qty", "Unit Price", "Subtotal"],
          }
        : undefined,
  }));
}

async function requirementTextForQuote(input: {
  dealId: string;
  organizationId: string;
  dealTitle: string;
  dealNotes: string | null;
  proposalId: string | null;
  lineNames: string;
}): Promise<string> {
  const parts: string[] = [];
  if (input.dealNotes?.trim()) parts.push(input.dealNotes.trim());
  const meeting = await loadMeetingNotesForDeal(input.dealId).catch(() => "");
  if (meeting?.trim()) parts.push(meeting.trim());
  if (input.proposalId) {
    const proposal = await getProposal(input.proposalId);
    if (proposal?.sections) {
      const sections = parseProposalSections(proposal.sections);
      const commercial = sections
        .filter((s) =>
          /commercial|scope|introduction|pricing|summary/i.test(
            `${s.key} ${s.title}`,
          ),
        )
        .map((s) => `${s.title}\n${s.body}`)
        .join("\n\n");
      if (commercial.trim()) {
        parts.push(`From accepted proposal ${proposal.number}:\n${commercial}`);
      }
      if (proposal.summary?.trim()) {
        parts.push(proposal.summary.trim());
      }
    }
  }
  if (input.lineNames.trim()) {
    parts.push(`Quote line products: ${input.lineNames.trim()}`);
  }
  const scoped = await resolveProposalProductScope({
    dealId: input.dealId,
    organizationId: input.organizationId,
    dealTitle: input.dealTitle,
    dealNotes: input.dealNotes,
    title: input.dealTitle,
    matchText: input.lineNames,
  }).catch(() => null);
  if (scoped?.productScope?.trim()) {
    parts.push(`Product scope: ${scoped.productScope.trim()}`);
  }
  return parts.join("\n\n").slice(0, 48_000);
}

async function fillSheetSection<T extends { key: string; body: string }>(
  sections: T[],
  input: {
    kind: "quote" | "invoice";
    sourceText: string;
    customerName: string;
    companyName: string;
    dealTitle: string;
  },
): Promise<T[]> {
  const index = sections.findIndex(
    (section) => section.key.toLowerCase() === "line_items",
  );
  const source = input.sourceText.trim();
  if (index < 0 || source.length < 8) return sections;
  const sheet = parsePipeGrid(sections[index]!.body);
  if (!sheet.length) return sections;
  const filled = await callAiServiceAgent<{ sheet?: string[][] }>(
    input.kind === "invoice" ? "invoice-sheet-fill" : "quote-brd-lines",
    {
      kind: input.kind,
      sheet,
      sourceText: source.slice(0, 20_000),
      requirementText: source.slice(0, 20_000),
      customerName: input.customerName,
      companyName: input.companyName,
      dealTitle: input.dealTitle,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );
  const next = Array.isArray(filled?.sheet) ? filled.sheet : [];
  if (!next.length) return sections;
  const body = pipeGrid(next.map((row) => row.map((cell) => String(cell ?? ""))));
  return sections.map((section, i) =>
    i === index ? { ...section, body } : section,
  );
}

export async function fillQuoteDocumentFromTemplate(quoteId: string): Promise<{
  applied: boolean;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      deal: {
        select: {
          id: true,
          title: true,
          notes: true,
          contactName: true,
          company: { select: { name: true } },
        },
      },
    },
  });
  if (!quote) {
    return { applied: false, warnings: ["Quote not found."] };
  }

  const orgId = String(quote.organizationId);
  const seller = await loadSellerOrganization(orgId);
  const vendorName =
    quote.vendorName?.trim() || seller?.companyName?.trim() || "Our company";
  const companyName =
    quote.companyName?.trim() ||
    quote.deal.company?.name?.trim() ||
    "Customer";
  const customerName = quote.customerName?.trim() || companyName;
  const date = formatDateLabel(new Date());
  const validUntil = formatDateLabel(quote.validUntil);
  const subtotal = Number(quote.subtotal);
  const discountPct = Number(quote.discountPct);
  const total = Number(quote.total);
  const discountAmount =
    Number.isFinite(subtotal) && Number.isFinite(discountPct)
      ? (subtotal * discountPct) / 100
      : 0;

  let sections = parseQuoteDocumentSections(quote.documentSections);
  if (!sections.length) {
    warnings.push("Quote has no document sections; skipping template fill.");
    return { applied: false, warnings };
  }

  if (isSpreadsheetLayoutBlueprint(quote.blueprint)) {
    sections = applyQuoteDocumentMerge(sections, {
      customerName,
      companyName,
      dealTitle: quote.deal.title,
      date,
      vendorName,
      quoteNumber: quote.number,
      currency: quote.currency,
      subtotal: formatMoney(subtotal, quote.currency),
      discountPct: String(discountPct),
      total: formatMoney(total, quote.currency),
      validUntil,
    });
    if (quote.proposalId) {
      const source = await requirementTextForQuote({
        dealId: quote.dealId,
        organizationId: orgId,
        dealTitle: quote.deal.title,
        dealNotes: quote.deal.notes,
        proposalId: quote.proposalId,
        lineNames: quote.lines.map((line) => line.name).join(" "),
      });
      sections = await fillSheetSection(sections, {
        kind: "quote",
        sourceText: source,
        customerName,
        companyName,
        dealTitle: quote.deal.title,
      });
    }
    await updateQuote(quote.id, { documentSections: sections });
    return { applied: true, warnings };
  }

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

  const mergeCtx = {
    customerName,
    companyName,
    dealTitle: quote.deal.title,
    date,
    vendorName,
    quoteNumber: quote.number,
    currency: quote.currency,
    subtotal: formatMoney(subtotal, quote.currency),
    discountPct: String(discountPct),
    total: formatMoney(total, quote.currency),
    validUntil,
  };
  sections = applyQuoteDocumentMerge(sections, mergeCtx);

  const blueprint = parseDocumentBlueprint(quote.blueprint);
  const assets = parseBlueprintAssets(quote.assets);
  const pageImages = pageImagesFromTemplateAssets(quote.assets);
  const css = blueprint?.css || "";

  const lineNames = quote.lines.map((l) => l.name).join(" ");
  const requirementText = await requirementTextForQuote({
    dealId: quote.dealId,
    organizationId: orgId,
    dealTitle: quote.deal.title,
    dealNotes: quote.deal.notes,
    proposalId: quote.proposalId,
    lineNames,
  });

  const products = quote.lines.map((line) => ({
    name: line.name,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    amount: Number(line.amount),
    currency: quote.currency,
  }));

  if (pageImages.length) {
    const fill = await callCommercialFillAgent({
      agent: "quote-fill-template",
      pageImages,
      skeleton: skeletonFromQuoteSections(sections),
      css,
      contextJson: {
        kind: "quote",
        requirementText,
        products,
        merge: mergeCtx,
        dealTitle: quote.deal.title,
      },
    });
    warnings.push(...fill.warnings);
    if (fill.source === "ai" && fill.sections.length) {
      sections = mergeFilledSections(sections, fill.sections);
      sections = withCommercialLineItemsSection(sections, linesMd, totalsMd);
      sections = applyQuoteDocumentMerge(sections, mergeCtx);
    } else {
      warnings.push(
        `Quote template fill unavailable (${fill.reason || "empty"}); using clone personalize.`,
      );
    }
  }

  const scoped = await resolveProposalProductScope({
    dealId: quote.dealId,
    organizationId: orgId,
    dealTitle: quote.deal.title,
    dealNotes: quote.deal.notes,
    title: quote.number,
    matchText: lineNames,
  }).catch(() => null);
  const productScope =
    scoped?.productScope ??
    proposalProductScope(null, quote.deal.title, scoped?.productHint);

  const cloneCtx = await buildClonePersonalizeContext({
    kind: "quote",
    organizationId: orgId,
    dealId: quote.dealId,
    companyName,
    customerName,
    dealTitle: quote.deal.title,
    vendorName,
    date,
    productScope,
    productHint: scoped?.productHint ?? null,
    quoteNumber: quote.number,
    total: formatMoney(total, quote.currency),
    currency: quote.currency,
    contactName: quote.deal.contactName ?? null,
    documentFacts: {
      quoteNumber: quote.number,
      vendorName,
      companyName,
      customerName,
      dealTitle: quote.deal.title,
      date,
      validUntil,
      currency: quote.currency,
      subtotal,
      discountPercent: discountPct,
      discountAmount,
      total,
      lineItems: products,
    },
  });

  const clonePatched = await personalizePageCloneDocument({
    blueprint: blueprint ?? quote.blueprint,
    assets,
    sections: sections.map((s, i) => ({
      id: s.id || s.key || `sec-${i}`,
      key: s.key,
      title: s.title,
      body: s.body,
      sortOrder: s.sortOrder ?? i + 1,
    })),
    context: cloneCtx,
    contentFill: true,
  });
  warnings.push(...clonePatched.warnings);

  await updateQuote(quote.id, {
    documentSections: clonePatched.sections.map((s, i) => ({
      id: s.id,
      key: s.key || s.id || `section_${i + 1}`,
      title: s.title,
      body: s.body,
      sortOrder: s.sortOrder ?? i + 1,
    })),
    blueprint: clonePatched.blueprint ?? undefined,
    assets: clonePatched.assets,
  });

  return { applied: true, warnings: [...new Set(warnings)] };
}

export async function fillInvoiceDocumentFromTemplate(invoiceId: string): Promise<{
  applied: boolean;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      company: { select: { name: true } },
      deal: { select: { id: true, title: true, notes: true, contactName: true } },
      order: {
        select: {
          id: true,
          quoteId: true,
          quote: {
            select: {
              id: true,
              number: true,
              documentSections: true,
              subtotal: true,
              total: true,
              currency: true,
              discountPct: true,
            },
          },
        },
      },
    },
  });
  if (!invoice) {
    return { applied: false, warnings: ["Invoice not found."] };
  }

  const orgId = String(invoice.organizationId);
  const seller = await loadSellerOrganization(orgId);
  const vendorName = seller?.companyName?.trim() || "Our company";
  const companyName = invoice.company?.name?.trim() || "Customer";
  const issueDate = formatDateLabel(invoice.issueDate ?? invoice.createdAt);
  const dueDate = formatDateLabel(invoice.dueAt);
  const financeDefaults = await getEffectiveFinanceDefaults(invoice.organizationId);

  let sections = parseInvoiceDocumentSections(invoice.sections);
  if (!sections.length) {
    warnings.push("Invoice has no document sections; skipping template fill.");
    return { applied: false, warnings };
  }

  if (isSpreadsheetLayoutBlueprint(invoice.blueprint)) {
    const quoteSheet = invoice.order?.quote
      ? parseQuoteDocumentSections(invoice.order.quote.documentSections)
          .map((section) => section.body)
          .join("\n\n")
      : "";
    const lineFacts = invoice.lines
      .map(
        (line) =>
          `${line.name} qty ${Number(line.quantity)} unit ${Number(line.unitPrice)} amount ${Number(line.amount)}`,
      )
      .join("\n");
    sections = await fillSheetSection(sections, {
      kind: "invoice",
      sourceText: [quoteSheet, lineFacts].filter(Boolean).join("\n\n"),
      customerName: companyName,
      companyName,
      dealTitle: invoice.deal?.title ?? "",
    });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { sections: sections as unknown as Prisma.InputJsonValue },
    });
    return { applied: true, warnings };
  }

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
    taxDetails:
      invoice.taxDetails && typeof invoice.taxDetails === "object"
        ? (invoice.taxDetails as {
            components?: Array<{
              label: string;
              percent: number;
              amount: number;
            }> | null;
            summaryLines?: string[] | null;
            system?: string | null;
            effectivePercent?: number | null;
          })
        : null,
  });
  sections = withCommercialLineItemsSection(sections, linesMd, totalsMd, {
    stripInvoiceTotals: true,
  });

  const mergeCtx = {
    customerName: companyName,
    companyName,
    invoiceNumber: invoice.number,
    date: issueDate,
    dueDate,
    vendorName,
    sellerAddress: seller?.billingAddress?.trim() || "",
    currency: invoice.currency,
    subtotal: formatMoney(subtotal, invoice.currency),
    taxAmount: formatMoney(taxAmount, invoice.currency),
    total: formatMoney(total, invoice.currency),
    paymentTerms: invoice.paymentTerms || financeDefaults.defaultPaymentTerms,
    billingAddress: invoice.billingAddress?.trim() || "",
    taxId: "",
  };
  sections = applyInvoiceDocumentMerge(sections, mergeCtx);

  const blueprint = parseDocumentBlueprint(invoice.blueprint);
  const assets = parseBlueprintAssets(invoice.assets);
  const pageImages = pageImagesFromTemplateAssets(invoice.assets);
  const css = blueprint?.css || "";

  let quoteContext = "";
  const linkedQuote = invoice.order?.quote;
  if (linkedQuote) {
    quoteContext = `From quote ${linkedQuote.number}. Totals: ${linkedQuote.total} ${linkedQuote.currency}.`;
    const qSections = parseQuoteDocumentSections(linkedQuote.documentSections);
    const intro = qSections.find((s) => s.key === "introduction");
    if (intro?.body?.trim()) {
      quoteContext += `\nQuote introduction:\n${intro.body.trim()}`;
    }
  }

  const products = invoice.lines.map((line) => ({
    name: line.name,
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    amount: Number(line.amount),
    taxPercent: Number(line.taxPercent),
  }));

  if (pageImages.length) {
    const fill = await callCommercialFillAgent({
      agent: "invoice-fill-template",
      pageImages,
      skeleton: skeletonFromInvoiceSections(sections),
      css,
      contextJson: {
        kind: "invoice",
        quoteContext,
        products,
        merge: mergeCtx,
        taxDetails: invoice.taxDetails,
        amountInWords: amountInWords(total, invoice.currency),
        bankDetails: financeDefaults.bankDetails,
      },
    });
    warnings.push(...fill.warnings);
    if (fill.source === "ai" && fill.sections.length) {
      sections = mergeFilledSections(sections, fill.sections);
      sections = withCommercialLineItemsSection(sections, linesMd, totalsMd, {
        stripInvoiceTotals: true,
      });
      sections = applyInvoiceDocumentMerge(sections, mergeCtx);
    } else {
      warnings.push(
        `Invoice template fill unavailable (${fill.reason || "empty"}); using clone personalize.`,
      );
    }
  }

  const dealId = invoice.deal?.id ?? null;
  const lineNames = invoice.lines.map((l) => l.name).join(" ");
  const scoped = dealId
    ? await resolveProposalProductScope({
        dealId,
        organizationId: orgId,
        dealTitle: invoice.deal?.title ?? "",
        dealNotes: invoice.deal?.notes ?? null,
        title: invoice.number,
        matchText: lineNames,
      }).catch(() => null)
    : null;
  const productScope =
    scoped?.productScope ??
    proposalProductScope(null, invoice.deal?.title ?? "", scoped?.productHint);

  const cloneCtx = await buildClonePersonalizeContext({
    kind: "invoice",
    organizationId: orgId,
    dealId: dealId ?? "",
    companyName,
    customerName: companyName,
    dealTitle: invoice.deal?.title ?? "",
    vendorName,
    date: issueDate,
    productScope,
    productHint: scoped?.productHint ?? null,
    invoiceNumber: invoice.number,
    total: formatMoney(total, invoice.currency),
    currency: invoice.currency,
    contactName: invoice.deal?.contactName ?? null,
    documentFacts: {
      invoiceNumber: invoice.number,
      vendorName,
      companyName,
      issueDate,
      dueDate,
      billingAddress: invoice.billingAddress?.trim() || "",
      paymentTerms:
        invoice.paymentTerms || financeDefaults.defaultPaymentTerms,
      currency: invoice.currency,
      subtotal,
      taxAmount,
      total,
      taxDetails: invoice.taxDetails,
      amountInWords: amountInWords(total, invoice.currency),
      bankDetails: financeDefaults.bankDetails,
      lineItems: products,
    },
  });

  const clonePatched = await personalizePageCloneDocument({
    blueprint: blueprint ?? invoice.blueprint,
    assets,
    sections: sections.map((s, i) => ({
      id: s.id || s.key || `sec-${i}`,
      key: s.key,
      title: s.title,
      body: s.body,
      sortOrder: s.sortOrder ?? i + 1,
    })),
    context: cloneCtx,
    contentFill: true,
  });
  warnings.push(...clonePatched.warnings);

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      sections: clonePatched.sections.map((s, i) => ({
        id: s.id,
        key: s.key,
        title: s.title,
        body: s.body,
        sortOrder: s.sortOrder ?? i + 1,
      })) as unknown as import("@prisma/client").Prisma.InputJsonValue,
      blueprint: (clonePatched.blueprint ?? undefined) as
        | import("@prisma/client").Prisma.InputJsonValue
        | undefined,
      assets: clonePatched.assets as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
  });

  return { applied: true, warnings: [...new Set(warnings)] };
}
