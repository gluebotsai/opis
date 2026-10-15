import type { Prisma, QuoteStatus } from "@prisma/client";
import {
  clampPage,
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  paginatedResult,
  type PaginatedResult,
} from "@/lib/pagination";
import { prisma } from "@/dao/db/prisma";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { createOrderFromQuote } from "@/dao/sales/order-service";
import { ensureDefaultQuoteTemplate } from "@/dao/sales/quote-template-service";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import {
  getEffectiveFinanceDefaults,
  overlayBankDetailsOnSections,
} from "@/dao/finance/org-finance-settings";
import { isSpreadsheetLayoutBlueprint } from "@/lib/document-blueprint";
import {
  applyQuoteDocumentMerge,
  parseQuoteDocumentSections,
  type QuoteDocumentSection,
} from "@/lib/quote-document-sections";
import {
  commercialLinesPipeTable,
  commercialTotalsMarkdown,
  withCommercialLineItemsSection,
} from "@/lib/commercial-line-table";
import { formatEmailDeliveryFailure } from "@/lib/email-delivery-error";
import {
  currencyFromProductCodes,
  resolveWrittenCurrency,
} from "@/lib/commercial-currency";

export type QuoteLineInput = {
  productId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type CreateQuoteInput = {
  dealId: string;
  lines: QuoteLineInput[];
  discountPct?: number;
  notes?: string | null;
  validUntil?: Date | null;
  proposalId?: string | null;
  currency?: string | null;
  /** Apply org standard (or chosen) quotation template. Default true. */
  fromTemplate?: boolean;
  templateId?: string | null;
  createdByUserId?: string | null;
  organizationId?: string | null;
};

export type UpdateQuoteInput = {
  notes?: string | null;
  validUntil?: Date | null;
  documentSections?: QuoteDocumentSection[] | null;
  customerName?: string | null;
  companyName?: string | null;
  vendorName?: string | null;
  lines?: QuoteLineInput[];
  discountPct?: number;
  assets?: unknown;
  blueprint?: unknown;
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

async function nextQuoteNumber(organizationId: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ max_seq: number | null }>>(
    `SELECT COALESCE(MAX((substring(number FROM '(\\d+)$'))::int), 0)::int AS max_seq
     FROM crm.quotes
     WHERE organization_id = $1::bigint`,
    organizationId,
  );
  const maxSeq = Number(rows[0]?.max_seq ?? 0);
  const next = Number.isFinite(maxSeq) && maxSeq >= 0 ? maxSeq + 1 : 1;
  return `Q-${String(next).padStart(5, "0")}`;
}

async function resolveVendorName(organizationId: string): Promise<string> {
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
    // accounts schema may be unavailable in some envs
  }
  return "Our company";
}

function formatMoneyLabel(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

function formatDateLabel(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function listQuotes(filters: {
  page?: number;
  dealId?: string;
  status?: QuoteStatus | "all";
  organizationId?: string | null;
  /** Scope to deals owned by this user (sales_rep / viewer / marketing). */
  ownerUserId?: string | null;
  /** Include line items (default true). Deal panel list can skip for speed. */
  includeLines?: boolean;
}): Promise<
  PaginatedResult<NonNullable<Awaited<ReturnType<typeof getQuote>>>>
> {
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(undefined, DEFAULT_PAGE_SIZE);
  const organizationId = await resolveRequestOrganizationId(filters.organizationId);
  const where = {
    organizationId,
    ...(filters.dealId ? { dealId: filters.dealId } : {}),
    ...(filters.status && filters.status !== "all"
      ? { status: filters.status }
      : {}),
    ...(filters.ownerUserId
      ? { deal: { ownerUserId: filters.ownerUserId } }
      : {}),
  };

  const includeLines = filters.includeLines !== false;

  const [total, rows] = await Promise.all([
    prisma.quote.count({ where }),
    prisma.quote.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        deal: {
          select: {
            id: true,
            title: true,
            companyId: true,
            contactId: true,
            ownerUserId: true,
            contactName: true,
            contactEmail: true,
            company: { select: { name: true } },
          },
        },
        proposal: { select: { id: true, number: true, version: true, title: true } },
        template: { select: { id: true, name: true } },
        ...(includeLines
          ? { lines: { orderBy: { sortOrder: "asc" as const } } }
          : {}),
      },
    }),
  ]);

  const normalized = rows.map((row) => ({
    ...row,
    lines: includeLines && "lines" in row ? row.lines : [],
  }));

  return paginatedResult(
    normalized as NonNullable<Awaited<ReturnType<typeof getQuote>>>[],
    total,
    page,
    pageSize,
  );
}

export async function getQuote(id: string) {
  return prisma.quote.findUnique({
    where: { id },
    include: {
      deal: {
        select: {
          id: true,
          title: true,
          companyId: true,
          contactId: true,
          ownerUserId: true,
          contactName: true,
          contactEmail: true,
          company: { select: { name: true } },
        },
      },
      proposal: { select: { id: true, number: true, version: true, title: true } },
      template: { select: { id: true, name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
}

async function currencyForQuoteLines(
  explicit: string | null | undefined,
  productIds: Array<string | null>,
  organizationId: string,
): Promise<string> {
  const chosen = explicit?.trim();
  if (chosen) return chosen.toUpperCase();
  const ids = [...new Set(productIds.filter((id): id is string => Boolean(id)))];
  if (ids.length > 0) {
    const rows = await prisma.product.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, currency: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row.currency]));
    const fromProducts = currencyFromProductCodes(
      productIds.map((id) => (id ? (byId.get(id) ?? null) : null)),
    );
    if (fromProducts) return fromProducts;
  }
  return resolveWrittenCurrency(null, organizationId);
}

export async function createQuote(input: CreateQuoteInput) {
  if (!input.lines.length) {
    throw new Error("Add at least one quote line.");
  }
  const deal = await prisma.deal.findUnique({
    where: { id: input.dealId },
    include: { company: { select: { name: true } } },
  });
  if (!deal) throw new Error("Deal not found.");

  let proposalId: string | null = input.proposalId?.trim() || null;
  if (proposalId) {
    const proposal = await prisma.proposal.findFirst({
      where: { id: proposalId, dealId: input.dealId },
    });
    if (!proposal) {
      throw new Error("Selected proposal was not found on this deal.");
    }
  }

  const organizationId = await resolveRequestOrganizationId(
    input.organizationId ?? deal.organizationId,
  );
  const discountPct = Math.min(100, Math.max(0, input.discountPct ?? 0));
  const computed = input.lines.map((line, idx) => {
    const quantity = Math.max(0.01, line.quantity);
    const unitPrice = Math.max(0, line.unitPrice);
    return {
      organizationId,
      productId: line.productId?.trim() || null,
      name: line.name.trim(),
      quantity,
      unitPrice,
      amount: money(quantity * unitPrice),
      sortOrder: idx,
    };
  });
  const subtotal = money(computed.reduce((s, l) => s + Number(l.amount), 0));
  const total = money(subtotal * (1 - discountPct / 100));
  const currency = await currencyForQuoteLines(
    input.currency,
    computed.map((line) => line.productId),
    organizationId,
  );
  const validUntil = input.validUntil ?? null;

  const companyName = deal.company?.name?.trim() || "Customer";
  const customerName = deal.contactName?.trim() || companyName;
  const vendorName = await resolveVendorName(organizationId);
  const date = formatDateLabel(new Date());

  let templateId: string | null = null;
  let templateSections: unknown = null;
  let blueprint: unknown = undefined;
  let assets: unknown = undefined;
  let bankDetails: Parameters<typeof overlayBankDetailsOnSections>[1] = null;

  if (input.fromTemplate !== false) {
    let template = input.templateId
      ? await prisma.quoteTemplate.findFirst({
          where: { id: input.templateId, organizationId },
        })
      : null;
    if (!template) {
      const ensured = await ensureDefaultQuoteTemplate(organizationId);
      template = await prisma.quoteTemplate.findFirstOrThrow({
        where: { id: ensured.id },
      });
    }
    templateId = template.id;
    blueprint = template.blueprint ?? undefined;
    assets = template.assets ?? undefined;
    templateSections = template.sections;
    bankDetails = (await getEffectiveFinanceDefaults(organizationId)).bankDetails;
  }

  let quote: Awaited<ReturnType<typeof prisma.quote.create>> & {
    lines: unknown[];
    deal: unknown;
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const number = await nextQuoteNumber(organizationId);
    let documentSections: QuoteDocumentSection[] | null = null;
    if (input.fromTemplate !== false && templateSections) {
      documentSections = overlayBankDetailsOnSections(
        applyQuoteDocumentMerge(parseQuoteDocumentSections(templateSections), {
          customerName,
          companyName,
          dealTitle: deal.title,
          date,
          vendorName,
          quoteNumber: number,
          currency,
          subtotal: formatMoneyLabel(subtotal, currency),
          discountPct: `${discountPct}`,
          total: formatMoneyLabel(total, currency),
          validUntil: formatDateLabel(validUntil),
        }),
        bankDetails,
      );
    }
    try {
      quote = await prisma.quote.create({
        data: {
          organizationId,
          dealId: input.dealId,
          proposalId,
          templateId,
          number,
          status: "draft",
          currency,
          subtotal,
          discountPct,
          total,
          notes: input.notes?.trim() || null,
          validUntil,
          documentSections: (documentSections ??
            undefined) as Prisma.InputJsonValue | undefined,
          blueprint: blueprint as Prisma.InputJsonValue | undefined,
          assets: assets as Prisma.InputJsonValue | undefined,
          customerName,
          companyName,
          vendorName,
          createdByUserId: input.createdByUserId ?? null,
          lines: { create: computed },
        },
        include: { lines: true, deal: true },
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (
        attempt < 5 &&
        msg.includes("Unique constraint failed") &&
        msg.includes("number")
      ) {
        continue;
      }
      throw e;
    }
  }
  if (lastErr) {
    throw lastErr;
  }

  await writeAuditLog({
    actorUserId: input.createdByUserId,
    action: "create",
    entityType: "quote",
    entityId: quote.id,
    organizationId,
    meta: { dealId: input.dealId, total, templateId },
  });

  if (quote.deal.contactId) {
    triggerLeadLifecycle({
      contactId: quote.deal.contactId,
      organizationId,
      triggerReason: "quote_created",
    });
  }

  return quote;
}

export async function updateQuote(id: string, input: UpdateQuoteInput) {
  const existing = await prisma.quote.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      _count: { select: { orders: true } },
    },
  });
  if (!existing) throw new Error("Quote not found.");

  const wantsLines = input.lines !== undefined;
  const wantsDiscount = input.discountPct !== undefined;
  if (wantsLines || wantsDiscount) {
    if (existing.status === "accepted" || existing.status === "void") {
      throw new Error("Accepted or void quotes cannot change line items.");
    }
    if (existing._count.orders > 0) {
      throw new Error("Quotes with orders cannot change line items.");
    }
  }

  let computedLines: Array<{
    organizationId: string;
    productId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    sortOrder: number;
  }> | null = null;
  let subtotal = Number(existing.subtotal);
  let discountPct = Number(existing.discountPct);
  let total = Number(existing.total);

  if (wantsDiscount) {
    discountPct = Math.min(100, Math.max(0, input.discountPct ?? 0));
  }
  if (wantsLines) {
    if (!input.lines?.length) {
      throw new Error("Add at least one quote line.");
    }
    computedLines = input.lines.map((line, idx) => {
      const quantity = Math.max(0.01, line.quantity);
      const unitPrice = Math.max(0, line.unitPrice);
      return {
        organizationId: existing.organizationId,
        productId: line.productId?.trim() || null,
        name: line.name.trim(),
        quantity,
        unitPrice,
        amount: money(quantity * unitPrice),
        sortOrder: idx,
      };
    });
    subtotal = money(
      computedLines.reduce((sum, line) => sum + Number(line.amount), 0),
    );
  }
  if (wantsLines || wantsDiscount) {
    total = money(subtotal * (1 - discountPct / 100));
  }

  const data: Prisma.QuoteUpdateInput = {};
  if (input.notes !== undefined) {
    data.notes = input.notes?.trim() || null;
  }
  if (input.validUntil !== undefined) {
    data.validUntil = input.validUntil;
  }
  if (input.customerName !== undefined) {
    data.customerName = input.customerName?.trim() || null;
  }
  if (input.companyName !== undefined) {
    data.companyName = input.companyName?.trim() || null;
  }
  if (input.vendorName !== undefined) {
    data.vendorName = input.vendorName?.trim() || null;
  }
  if (input.assets !== undefined) {
    data.assets = input.assets as Prisma.InputJsonValue;
  }
  if (input.blueprint !== undefined) {
    data.blueprint = input.blueprint as Prisma.InputJsonValue;
  }
  if (wantsLines || wantsDiscount) {
    data.subtotal = subtotal;
    data.discountPct = discountPct;
    data.total = total;
    const currency = existing.currency || "USD";
    const sectionRows = (
      computedLines ??
      existing.lines.map((line) => ({
        name: line.name,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        amount: Number(line.amount),
      }))
    ).map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
    }));
    const spreadsheet = isSpreadsheetLayoutBlueprint(
      input.blueprint !== undefined ? input.blueprint : existing.blueprint,
    );
    if (!spreadsheet) {
      const baseSections =
        input.documentSections !== undefined
          ? input.documentSections ?? []
          : parseQuoteDocumentSections(existing.documentSections);
      data.documentSections = withCommercialLineItemsSection(
        baseSections,
        commercialLinesPipeTable(sectionRows, currency),
        commercialTotalsMarkdown({
          currency,
          subtotal,
          discountLabel:
            discountPct > 0 ? `Discount (${discountPct}%)` : null,
          discountAmount:
            discountPct > 0 ? money(subtotal * (discountPct / 100)) : null,
          total,
        }),
      ) as Prisma.InputJsonValue;
    } else if (input.documentSections !== undefined) {
      data.documentSections = input.documentSections as Prisma.InputJsonValue;
    }
  } else if (input.documentSections !== undefined) {
    data.documentSections = input.documentSections as Prisma.InputJsonValue;
  }

  const include = {
    lines: { orderBy: { sortOrder: "asc" as const } },
    deal: true,
    template: { select: { id: true, name: true } },
    proposal: {
      select: { id: true, number: true, version: true, title: true },
    },
  };

  if (computedLines) {
    return prisma.$transaction(async (tx) => {
      await tx.quoteLine.deleteMany({ where: { quoteId: id } });
      await tx.quoteLine.createMany({
        data: computedLines!.map((line) => ({
          ...line,
          quoteId: id,
        })),
      });
      return tx.quote.update({ where: { id }, data, include });
    });
  }

  return prisma.quote.update({
    where: { id },
    data,
    include,
  });
}

/** Permanently delete a quote (lines cascade). Accepted quotes / quotes with orders are blocked. */
export async function deleteQuote(id: string) {
  const organizationId = await resolveRequestOrganizationId();
  const existing = await prisma.quote.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      number: true,
      status: true,
      dealId: true,
      _count: { select: { orders: true } },
    },
  });
  if (!existing) throw new Error("Quote not found.");
  if (existing.status === "accepted") {
    throw new Error("Accepted quotes cannot be deleted.");
  }
  if (existing._count.orders > 0) {
    throw new Error("Quotes with orders cannot be deleted.");
  }

  await prisma.quote.delete({ where: { id: existing.id } });
  await writeAuditLog({
    action: "delete",
    entityType: "quote",
    entityId: existing.id,
    organizationId,
    meta: {
      number: existing.number,
      status: existing.status,
      dealId: existing.dealId,
    },
  });
  return { id: existing.id };
}

export async function markQuoteSent(
  id: string,
  actorUserId?: string | null,
  attachment?: { filename: string; buffer: Buffer } | null,
) {
  const existing = await prisma.quote.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      deal: {
        select: {
          id: true,
          title: true,
          contactId: true,
          contactEmail: true,
          contactName: true,
        },
      },
    },
  });
  if (!existing) throw new Error("Quote not found.");
  if (existing.status !== "draft") {
    throw new Error("Only draft quotes can be sent.");
  }

  const { assertDocumentApprovedForSend } = await import(
    "@/service/sales/document-approval"
  );
  assertDocumentApprovedForSend(
    {
      approvedByUserId: (existing as { approvedByUserId?: string | null })
        .approvedByUserId,
      approvedAt: (existing as { approvedAt?: Date | null }).approvedAt,
    },
    "quote",
  );

  const quote = await prisma.quote.update({
    where: { id },
    data: {
      status: "sent",
      sentAt: new Date(),
      approvalStatus: "sent",
    },
  });

  await writeAuditLog({
    actorUserId,
    action: "quote_sent",
    entityType: "quote",
    entityId: id,
    organizationId: quote.organizationId,
  });

  if (existing.deal?.contactId) {
    triggerLeadLifecycle({
      contactId: existing.deal.contactId,
      organizationId: quote.organizationId,
      triggerReason: "quote_sent",
    });
  }

  const emailWarning = await emailQuoteToContact({
    quote: existing,
    actorUserId,
    attachment,
    markSentContext: true,
  });

  return { quote, emailWarning };
}

type QuoteEmailPayload = Awaited<ReturnType<typeof getQuote>> & {
  lines: Array<{
    name: string;
    quantity: number;
    unitPrice: unknown;
    amount: unknown;
  }>;
  deal: {
    title: string;
    contactId: string | null;
    contactEmail: string | null;
    contactName: string | null;
  } | null;
};

/** Email a quote PDF to the deal contact (send or resend). */
export async function emailQuoteToContact(args: {
  quote: NonNullable<QuoteEmailPayload>;
  actorUserId: string | null | undefined;
  attachment?: { filename: string; buffer: Buffer } | null;
  /** When true, prefix failures with "Quote marked sent." */
  markSentContext?: boolean;
}): Promise<string | null> {
  const { quote, actorUserId, attachment, markSentContext } = args;
  const to = quote.deal?.contactEmail?.trim();
  if (!to) {
    return markSentContext
      ? "No contact email on the deal — quote marked sent without emailing the customer."
      : "No contact email on the deal.";
  }
  if (!actorUserId) {
    return markSentContext
      ? "Quote marked sent; sign in again to email the customer."
      : "Sign in again to email the customer.";
  }

  const lines = quote.lines
    .map(
      (l) =>
        `• ${l.name} × ${l.quantity} @ ${quote.currency} ${l.unitPrice} = ${quote.currency} ${l.amount}`,
    )
    .join("\n");
  const attachmentLine = attachment?.buffer?.length
    ? "Please find the quote attached as a PDF."
    : null;
  const body = [
    `Hello${quote.deal?.contactName ? ` ${quote.deal.contactName}` : ""},`,
    "",
    `Please find quote ${quote.number} for ${quote.deal?.title ?? "your opportunity"}.`,
    "",
    ...(attachmentLine ? [attachmentLine, ""] : []),
    `Total: ${quote.currency} ${quote.total}`,
    "",
    "Line items:",
    lines || "• (details in attached PDF)",
    "",
    "Reply to this email if you have questions.",
    "",
    `— ${quote.vendorName?.trim() || "Our team"}`,
  ].join("\n");

  const { sendTransactionalEmail } = await import(
    "@/service/mail/send-transactional"
  );
  const sent = await sendTransactionalEmail({
    userId: actorUserId,
    to,
    subject: `Quote ${quote.number} — ${quote.deal?.title ?? "Proposal"}`,
    body,
    contactId: quote.deal?.contactId ?? null,
    attachments: attachment?.buffer?.length
      ? [
          {
            filename: attachment.filename,
            contentType: "application/pdf",
            content: attachment.buffer,
          },
        ]
      : undefined,
  });
  if (!sent.ok) {
    const formatted = formatEmailDeliveryFailure(sent.error, {
      needsConnect: sent.needsConnect,
    });
    const msg = formatted.message;
    return markSentContext ? `Quote marked sent. ${msg}` : msg;
  }
  return null;
}

export async function acceptQuote(id: string, actorUserId?: string | null) {
  const existing = await getQuote(id);
  if (!existing) throw new Error("Quote not found.");
  if (existing.status === "accepted") {
    return { quote: existing, order: null as Awaited<ReturnType<typeof createOrderFromQuote>> | null };
  }
  if (existing.status !== "sent") {
    throw new Error("Only sent quotes can be accepted.");
  }

  const quote = await prisma.quote.update({
    where: { id },
    data: { status: "accepted", acceptedAt: new Date() },
    include: { lines: true, deal: true },
  });

  await writeAuditLog({
    actorUserId,
    action: "quote_accepted",
    entityType: "quote",
    entityId: id,
    organizationId: quote.organizationId,
  });

  const order = await createOrderFromQuote(quote.id, actorUserId);

  if (quote.deal.contactId) {
    triggerLeadLifecycle({
      contactId: quote.deal.contactId,
      organizationId: quote.organizationId,
      triggerReason: "quote_accepted",
    });
  }

  return { quote, order };
}

export async function rejectQuote(id: string) {
  const existing = await getQuote(id);
  if (!existing) throw new Error("Quote not found.");
  if (existing.status !== "sent") {
    throw new Error("Only sent quotes can be rejected.");
  }
  return prisma.quote.update({
    where: { id },
    data: { status: "rejected" },
  });
}
