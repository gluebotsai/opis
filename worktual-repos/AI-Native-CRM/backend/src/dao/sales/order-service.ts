import { prisma } from "@/dao/db/prisma";
import { writeAuditLog } from "@/dao/audit/audit-log";
import { createInvoiceFromOrder } from "@/dao/finance/invoice-service";
import { consumeProductStockIfTracked } from "@/dao/products/product-crm-service";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { resolveWrittenCurrency } from "@/lib/commercial-currency";

async function nextOrderNumber(organizationId: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ max_seq: number | null }>>(
    `SELECT COALESCE(MAX((substring(number FROM '(\\d+)$'))::int), 0)::int AS max_seq
     FROM crm.sales_orders
     WHERE organization_id = $1::bigint`,
    organizationId,
  );
  const maxSeq = Number(rows[0]?.max_seq ?? 0);
  const next = Number.isFinite(maxSeq) && maxSeq >= 0 ? maxSeq + 1 : 1;
  return `SO-${String(next).padStart(5, "0")}`;
}

export async function createOrderFromQuote(
  quoteId: string,
  actorUserId?: string | null,
) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true, deal: true },
  });
  if (!quote) throw new Error("Quote not found.");
  if (!quote.deal) throw new Error("Quote has no deal.");

  const existing = await prisma.salesOrder.findFirst({
    where: { quoteId: quote.id, status: { not: "cancelled" } },
  });
  if (existing) return existing;

  const organizationId = await resolveRequestOrganizationId(quote.organizationId);
  const order = await prisma.$transaction(async (tx) => {
    for (const line of quote.lines) {
      if (line.productId) {
        await consumeProductStockIfTracked(
          line.productId,
          Number(line.quantity),
          organizationId,
          tx,
        );
      }
    }
    return tx.salesOrder.create({
      data: {
        organizationId,
        dealId: quote.dealId,
        quoteId: quote.id,
        companyId: quote.deal.companyId,
        contactId: quote.deal.contactId,
        number: await nextOrderNumber(organizationId),
        status: "confirmed",
        currency: quote.currency,
        total: quote.total,
        confirmedAt: new Date(),
        createdByUserId: actorUserId ?? null,
        lines: {
          create: quote.lines.map((line, idx) => ({
            organizationId,
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount: line.amount,
            sortOrder: idx,
          })),
        },
      },
      include: { lines: true },
    });
  });

  await writeAuditLog({
    actorUserId,
    action: "order_created",
    entityType: "sales_order",
    entityId: order.id,
    organizationId,
    meta: { quoteId },
  });

  if (order.companyId) {
    await createInvoiceFromOrder(order.id, actorUserId, {
      mode: "draft_pending_finance",
    });
  }
  return order;
}

export async function listOrders(filters: {
  page?: number;
  organizationId?: string | null;
  dealId?: string;
  contactId?: string;
  /** When set (own-only roles), restrict to these contact IDs. Empty → no rows. */
  contactIds?: string[];
  /** Scope B2B orders via deal ownership. */
  dealOwnerUserId?: string | null;
  /** Franchise / channel company scope (orders linked to those companies). */
  companyIds?: string[] | null;
  /** Contact-first commerce orders (no deal). */
  commerceOnly?: boolean;
}) {
  const organizationId = await resolveRequestOrganizationId(filters.organizationId);
  const page = Math.max(1, filters.page ?? 1);
  const take = 50;

  if (filters.contactIds && filters.contactIds.length === 0) {
    return { items: [] as never[], total: 0, page, pageSize: take };
  }

  const where = {
    organizationId,
    ...(filters.dealId ? { dealId: filters.dealId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.contactIds ? { contactId: { in: filters.contactIds } } : {}),
    ...(filters.dealOwnerUserId
      ? { deal: { ownerUserId: filters.dealOwnerUserId } }
      : {}),
    ...(filters.companyIds && filters.companyIds.length > 0
      ? { companyId: { in: filters.companyIds } }
      : {}),
    ...(filters.commerceOnly
      ? { dealId: null, contactId: { not: null } as const }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.salesOrder.count({ where }),
    prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      include: {
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        lines: { orderBy: { sortOrder: "asc" } },
        invoices: {
          where: { status: { not: "void" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            currency: true,
          },
        },
      },
    }),
  ]);
  return { items, total, page, pageSize: take };
}

/** Orders (+ latest invoice) for a deal — used on deal detail revenue path. */
export async function listOrdersForDeal(dealId: string) {
  const { items } = await listOrders({ page: 1, dealId });
  return items;
}

export async function listOrdersForContact(contactId: string) {
  const { items } = await listOrders({ page: 1, contactId });
  return items;
}

export async function getOrder(id: string) {
  return prisma.salesOrder.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      invoices: {
        where: { status: { not: "void" } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export type CommerceLineInput = {
  productId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
};

/**
 * Contact-first commerce order (B2C / B2B2C). Company optional.
 * Does not create a Finance invoice when there is no company (B2C path).
 */
export async function createCommerceOrder(input: {
  contactId: string;
  companyId?: string | null;
  lines: CommerceLineInput[];
  currency?: string;
  actorUserId?: string | null;
  organizationId?: string | null;
}) {
  if (!input.lines.length) {
    throw new Error("Add at least one line item.");
  }

  const organizationId = await resolveRequestOrganizationId(input.organizationId);
  const lines = input.lines.map((line, idx) => {
    const quantity = Math.max(0.01, line.quantity);
    const unitPrice = Math.max(0, line.unitPrice);
    const amount = Math.round(quantity * unitPrice * 100) / 100;
    return {
      organizationId,
      productId: line.productId?.trim() || null,
      name: line.name.trim(),
      quantity,
      unitPrice,
      amount,
      sortOrder: idx,
    };
  });
  const total = Math.round(
    lines.reduce((s, l) => s + Number(l.amount), 0) * 100,
  ) / 100;

  const order = await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      if (line.productId) {
        await consumeProductStockIfTracked(
          line.productId,
          Number(line.quantity),
          organizationId,
          tx,
        );
      }
    }
    return tx.salesOrder.create({
      data: {
        organizationId,
        contactId: input.contactId,
        companyId: input.companyId?.trim() || null,
        number: await nextOrderNumber(organizationId),
        status: "confirmed",
        currency: await resolveWrittenCurrency(input.currency, organizationId),
        total,
        confirmedAt: new Date(),
        createdByUserId: input.actorUserId ?? null,
        lines: { create: lines },
      },
      include: {
        lines: true,
        company: { select: { id: true, name: true } },
      },
    });
  });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "order_created",
    entityType: "sales_order",
    entityId: order.id,
    organizationId,
    meta: { contactId: input.contactId, companyId: order.companyId, source: "commerce" },
  });

  if (order.companyId) {
    await createInvoiceFromOrder(order.id, input.actorUserId);
  }

  return order;
}
