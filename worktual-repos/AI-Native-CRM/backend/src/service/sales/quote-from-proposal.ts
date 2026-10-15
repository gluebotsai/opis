/**
 * Create a catalog-priced quote draft when a customer accepts a proposal.
 * Never auto-emails the customer.
 */

import { prisma } from "@/dao/db/prisma";
import { parsePipeGrid, pipeGrid } from "@/lib/spreadsheet-sheet";
import { getProposal, updateProposal } from "@/dao/sales/proposal-service";
import { createQuote } from "@/dao/sales/quote-service";
import { loadMeetingNotesForDeal } from "@/service/ai/proposal-brief";
import { resolveProposalProductScope } from "@/service/sales/proposal-visuals";
import { evaluateQuoteDiscountApproval } from "@/service/sales/quote-discount-approval";
import { notifySalesQuoteFromProposal } from "@/service/email/commercial-notify";

async function matchCatalogLine(input: {
  organizationId: string;
  productName: string;
  quantity: number;
}): Promise<{
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
}> {
  const products = await prisma.product.findMany({
    where: {
      organizationId: input.organizationId,
      status: { not: "archived" },
    },
    select: { id: true, name: true, price: true },
    take: 200,
    orderBy: { name: "asc" },
  });
  const nm = input.productName.trim().toLowerCase();
  let productId: string | null = null;
  let name = input.productName.trim();
  let unitPrice = 0;

  if (nm && products.length) {
    const exact = products.find((p) => p.name.toLowerCase() === nm);
    const hit =
      exact ??
      products.find(
        (p) =>
          p.name.toLowerCase().includes(nm) || nm.includes(p.name.toLowerCase()),
      );
    if (hit) {
      productId = hit.id;
      name = hit.name;
      unitPrice =
        hit.price != null && Number.isFinite(Number(hit.price))
          ? Number(hit.price)
          : 0;
    }
  }

  return {
    productId,
    name: name || input.productName,
    quantity: Math.max(0.01, input.quantity),
    unitPrice,
  };
}

export async function buildQuoteLinesFromProposal(input: {
  proposalId: string;
  organizationId: string;
  dealId: string;
  dealTitle: string;
  dealNotes?: string | null;
  title?: string | null;
  summary?: string | null;
  sections?: unknown;
  productHint?: string | null;
}): Promise<
  Array<{
    productId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
  }>
> {
  const scoped = await resolveProposalProductScope({
    dealId: input.dealId,
    organizationId: input.organizationId,
    dealTitle: input.dealTitle,
    dealNotes: input.dealNotes,
    productHint: input.productHint,
    title: input.title,
    summary: input.summary,
    matchText:
      typeof input.sections === "object" && input.sections
        ? JSON.stringify(input.sections).slice(0, 4000)
        : null,
  });

  const lines: Array<{
    productId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
  }> = [];

  if (scoped.quoteLines.length > 0) {
    for (const row of scoped.quoteLines) {
      const quotedId = row.productId?.trim();
      if (quotedId) {
        const hit = await prisma.product.findFirst({
          where: {
            id: quotedId,
            organizationId: input.organizationId,
            status: { not: "archived" },
          },
          select: { id: true, name: true, price: true },
        });
        if (hit) {
          const catalogPrice =
            hit.price != null && Number.isFinite(Number(hit.price))
              ? Number(hit.price)
              : 0;
          lines.push({
            productId: hit.id,
            name: hit.name?.trim() || row.name,
            quantity:
              row.quantity != null && row.quantity > 0 ? row.quantity : 1,
            unitPrice:
              row.unitPrice != null && Number(row.unitPrice) > 0
                ? Number(row.unitPrice)
                : catalogPrice,
          });
          continue;
        }
      }
      const matched = await matchCatalogLine({
        organizationId: input.organizationId,
        productName: row.name,
        quantity: row.quantity ?? 1,
      });
      lines.push({
        ...matched,
        unitPrice:
          row.unitPrice != null && Number(row.unitPrice) > 0
            ? Number(row.unitPrice)
            : matched.unitPrice,
      });
    }
  } else if (scoped.product) {
    lines.push(
      await matchCatalogLine({
        organizationId: input.organizationId,
        productName: scoped.product.name,
        quantity: 1,
      }),
    );
  }

  return lines.filter((l) => l.name.trim());
}

export type RequirementQuoteDraft = {
  lines: Array<{
    productId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  /** Pipe table in the uploaded spreadsheet's columns. Empty for non-sheet templates. */
  sheetMarkdown: string;
};

function strictCatalogProduct(
  catalog: Array<{ id: string; name: string; price: unknown }>,
  name: string,
) {
  const nm = name.trim().toLowerCase();
  if (!nm) return null;
  const exact = catalog.find((p) => p.name.toLowerCase() === nm);
  if (exact) return exact;
  const hits = catalog.filter((p) => {
    const pn = p.name.toLowerCase();
    if (Math.min(pn.length, nm.length) < 8) return false;
    return pn.includes(nm) || nm.includes(pn);
  });
  return hits.length === 1 ? hits[0]! : null;
}

/** Whole uploaded sheet, filled from the BRD, plus the priced lines on that sheet. */
export async function buildQuoteDraftFromRequirementText(input: {
  organizationId: string;
  dealTitle: string;
  customerName?: string | null;
  companyName?: string | null;
  requirementText: string;
}): Promise<RequirementQuoteDraft> {
  const text = input.requirementText.trim();
  const empty = { lines: [], sheetMarkdown: "" };
  if (text.length < 8) return empty;

  const template = await prisma.quoteTemplate.findFirst({
    where: { organizationId: input.organizationId, isDefault: true },
    orderBy: { createdAt: "asc" },
    select: { blueprint: true, sections: true },
  });
  const blueprint =
    template?.blueprint && typeof template.blueprint === "object"
      ? (template.blueprint as { mode?: string })
      : null;
  const sampleSection = Array.isArray(template?.sections)
    ? (template.sections as Array<{ key?: string; body?: string }>).find(
        (s) => String(s.key || "").toLowerCase() === "line_items",
      )
    : null;
  const spreadsheet = blueprint?.mode === "spreadsheet-layout";
  const sheet = spreadsheet ? parsePipeGrid(String(sampleSection?.body || "")) : [];

  const catalog = await prisma.product.findMany({
    where: { organizationId: input.organizationId, status: { not: "archived" } },
    select: { id: true, name: true, price: true },
    take: 80,
    orderBy: { name: "asc" },
  });

  const { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } = await import(
    "@/service/ai/ai-service-client"
  );
  const drafted = await callAiServiceAgent<{
    ok?: boolean;
    sheet?: string[][];
    lines?: Array<{
      productName?: string;
      quantity?: number;
      unitPrice?: number;
    }>;
    reason?: string;
  }>(
    "quote-brd-lines",
    {
      kind: "quote",
      requirementText: text.slice(0, 20_000),
      dealTitle: input.dealTitle,
      customerName: input.customerName ?? null,
      companyName: input.companyName ?? null,
      sheet,
      catalogProducts: catalog.map((p) => ({
        name: p.name,
        price: p.price != null ? Number(p.price) : null,
      })),
      organizationId: input.organizationId,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );
  const priced = Array.isArray(drafted?.lines) ? drafted.lines : [];
  const lines: RequirementQuoteDraft["lines"] = [];
  for (const row of priced) {
    const name = String(row.productName || "").trim();
    if (!name) continue;
    const quantity =
      row.quantity != null && Number(row.quantity) > 0 ? Number(row.quantity) : 1;
    const matched = strictCatalogProduct(catalog, name);
    const catalogPrice =
      matched?.price != null && Number(matched.price) > 0 ? Number(matched.price) : 0;
    const unitPrice =
      row.unitPrice != null && Number(row.unitPrice) > 0
        ? Number(row.unitPrice)
        : catalogPrice;
    lines.push({
      productId: matched?.id ?? null,
      name,
      quantity,
      unitPrice,
    });
  }
  const filledSheet = Array.isArray(drafted?.sheet) ? drafted.sheet : [];
  if (!lines.length) return empty;
  return {
    lines,
    sheetMarkdown:
      spreadsheet && filledSheet.length ? pipeGrid(filledSheet.map((row) => row.map(String))) : "",
  };
}

export async function createQuoteDraftFromAcceptedProposal(input: {
  proposalId: string;
  actorUserId?: string | null;
  discountPct?: number | null;
}): Promise<{ quoteId: string; quoteNumber: string | null } | null> {
  const proposal = await getProposal(input.proposalId);
  if (!proposal) return null;

  const deal = await prisma.deal.findUnique({
    where: { id: proposal.dealId },
    select: {
      id: true,
      title: true,
      notes: true,
      contactId: true,
      ownerUserId: true,
      organizationId: true,
    },
  });
  if (!deal) return null;

  const meetingNotes = await loadMeetingNotesForDeal(deal.id);
  const dealNotes = [deal.notes, meetingNotes].filter(Boolean).join("\n\n");

  const lines = await buildQuoteLinesFromProposal({
    proposalId: proposal.id,
    organizationId: String(proposal.organizationId),
    dealId: deal.id,
    dealTitle: deal.title,
    dealNotes,
    title: proposal.title,
    summary: proposal.summary,
    sections: proposal.sections,
    productHint: proposal.summary,
  });

  if (!lines.length) {
    console.warn(
      "createQuoteDraftFromAcceptedProposal: no catalog lines",
      proposal.id,
    );
    return null;
  }

  const discountPct = input.discountPct ?? 0;
  const quote = await createQuote({
    dealId: deal.id,
    proposalId: proposal.id,
    notes: "Draft from accepted proposal — review catalog pricing before sending.",
    createdByUserId: input.actorUserId ?? deal.ownerUserId,
    organizationId: String(proposal.organizationId),
    discountPct,
    lines,
  });

  if (quote.blueprint) {
    const { fillQuoteDocumentFromTemplate } = await import(
      "@/service/sales/commercial-document-fill"
    );
    await fillQuoteDocumentFromTemplate(quote.id).catch((err) => {
      console.error("[quote-fill-from-proposal]", err);
    });
  }

  await evaluateQuoteDiscountApproval({
    quoteId: quote.id,
    organizationId: String(proposal.organizationId),
    discountPct: Number(quote.discountPct),
    previousApprovalStatus: quote.approvalStatus,
    lines: lines.map((l) => ({ productId: l.productId })),
    actorUserId: input.actorUserId ?? null,
    dealTitle: deal.title,
    quoteNumber: quote.number,
  });

  if (proposal.status !== "accepted") {
    await updateProposal(proposal.id, { status: "accepted" });
  }

  await notifySalesQuoteFromProposal({
    organizationId: String(proposal.organizationId),
    ownerUserId: deal.ownerUserId,
    contactId: deal.contactId,
    quoteId: quote.id,
    quoteNumber: quote.number,
    proposalNumber: proposal.number,
    dealId: deal.id,
    dealTitle: deal.title,
  });

  return { quoteId: quote.id, quoteNumber: quote.number };
}

/**
 * Seed quote lines from a linked proposal (coworker / manual create with proposalId).
 */
export async function resolveQuoteLinesFromProposalId(
  proposalId: string,
): Promise<
  Array<{
    productId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
  }>
> {
  const proposal = await getProposal(proposalId);
  if (!proposal) return [];
  const deal = await prisma.deal.findUnique({
    where: { id: proposal.dealId },
    select: { id: true, title: true, notes: true },
  });
  if (!deal) return [];
  const meetingNotes = await loadMeetingNotesForDeal(deal.id);
  return buildQuoteLinesFromProposal({
    proposalId: proposal.id,
    organizationId: String(proposal.organizationId),
    dealId: deal.id,
    dealTitle: deal.title,
    dealNotes: [deal.notes, meetingNotes].filter(Boolean).join("\n\n"),
    title: proposal.title,
    summary: proposal.summary,
    sections: proposal.sections,
    productHint: proposal.summary,
  });
}
