import type { ProductBillingFrequency, Prisma } from "@prisma/client";
import { getPrismaClient } from "@/dao/db/prisma";
import {
  getCurrentOrganizationId,
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";
import {
  resolveTenantCurrency,
  resolveWrittenCurrency,
} from "@/lib/commercial-currency";

export type PriceBookView = {
  id: string;
  name: string;
  code: string | null;
  currency: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  entryCount: number;
};

export type PriceBookEntryView = {
  id: string;
  priceBookId: string;
  productId: string | null;
  offerId: string | null;
  addonId: string | null;
  amount: string;
  billingFrequency: ProductBillingFrequency | null;
};

export type PriceBookInput = {
  name: string;
  code?: string | null;
  currency?: string | null;
  isDefault?: boolean;
};

export type PriceBookEntryInput = {
  priceBookId: string;
  productId?: string | null;
  offerId?: string | null;
  addonId?: string | null;
  amount: number;
  billingFrequency?: ProductBillingFrequency | null;
};

function dec(value: { toString(): string } | null | undefined): string | null {
  return value?.toString() ?? null;
}

function assertExactlyOneTarget(input: {
  productId?: string | null;
  offerId?: string | null;
  addonId?: string | null;
}): void {
  const targets = [input.productId, input.offerId, input.addonId].filter(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
  if (targets.length !== 1) {
    throw new Error(
      "Each price book entry must target exactly one of product, offer, or addon.",
    );
  }
}

export async function listPriceBooks(options?: {
  organizationId?: string | null;
}): Promise<PriceBookView[]> {
  const organizationId = await resolveRequestOrganizationId(
    options?.organizationId,
  );
  const prisma = getPrismaClient();
  const rows = await prisma.priceBook.findMany({
    where: { organizationId },
    include: { _count: { select: { entries: true } } },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    currency: row.currency,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    entryCount: row._count.entries,
  }));
}

export async function getDefaultPriceBook(
  organizationId?: string | null,
): Promise<PriceBookView | null> {
  const orgId = await resolveRequestOrganizationId(organizationId);
  const prisma = getPrismaClient();
  const row = await prisma.priceBook.findFirst({
    where: { organizationId: orgId, isDefault: true },
    include: { _count: { select: { entries: true } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    currency: row.currency,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    entryCount: row._count.entries,
  };
}

export async function createPriceBook(
  input: PriceBookInput,
): Promise<PriceBookView> {
  if (!input.name.trim()) throw new Error("Price book name is required.");
  const organizationId = await getCurrentOrganizationId();
  const prisma = getPrismaClient();
  const isDefault = Boolean(input.isDefault);

  const row = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.priceBook.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const existingCount = await tx.priceBook.count({ where: { organizationId } });
    return tx.priceBook.create({
      data: {
        organizationId,
        name: input.name.trim(),
        code: input.code?.trim() || null,
        currency: await resolveWrittenCurrency(input.currency, organizationId),
        isDefault: isDefault || existingCount === 0,
      },
      include: { _count: { select: { entries: true } } },
    });
  });

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    currency: row.currency,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    entryCount: row._count.entries,
  };
}

export async function updatePriceBook(
  id: string,
  input: PriceBookInput,
): Promise<PriceBookView> {
  if (!input.name.trim()) throw new Error("Price book name is required.");
  const organizationId = await getCurrentOrganizationId();
  const prisma = getPrismaClient();
  const isDefault = Boolean(input.isDefault);

  const existing = await prisma.priceBook.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Price book not found.");

  const row = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.priceBook.updateMany({
        where: { organizationId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.priceBook.update({
      where: { id },
      data: {
        name: input.name.trim(),
        code: input.code?.trim() || null,
        currency: (input.currency?.trim() || existing.currency).toUpperCase(),
        isDefault: isDefault || existing.isDefault,
      },
      include: { _count: { select: { entries: true } } },
    });
  });

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    currency: row.currency,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    entryCount: row._count.entries,
  };
}

export async function deletePriceBook(id: string): Promise<void> {
  const organizationId = await getCurrentOrganizationId();
  const prisma = getPrismaClient();
  const existing = await prisma.priceBook.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Price book not found.");
  await prisma.priceBook.delete({ where: { id } });
}

export async function listPriceBookEntries(options: {
  priceBookId: string;
  productId?: string;
}): Promise<PriceBookEntryView[]> {
  const organizationId = await getCurrentOrganizationId();
  const prisma = getPrismaClient();
  const book = await prisma.priceBook.findFirst({
    where: { id: options.priceBookId, organizationId },
  });
  if (!book) throw new Error("Price book not found.");

  const where: Prisma.PriceBookEntryWhereInput = {
    organizationId,
    priceBookId: options.priceBookId,
  };
  if (options.productId) {
    where.OR = [
      { productId: options.productId },
      { offer: { productId: options.productId } },
      { addon: { productId: options.productId } },
    ];
  }

  const rows = await prisma.priceBookEntry.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    priceBookId: row.priceBookId,
    productId: row.productId,
    offerId: row.offerId,
    addonId: row.addonId,
    amount: row.amount.toString(),
    billingFrequency: row.billingFrequency,
  }));
}

export async function upsertPriceBookEntry(
  input: PriceBookEntryInput,
): Promise<PriceBookEntryView> {
  assertExactlyOneTarget(input);
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error("Amount must be a non-negative number.");
  }
  const organizationId = await getCurrentOrganizationId();
  const prisma = getPrismaClient();

  const book = await prisma.priceBook.findFirst({
    where: { id: input.priceBookId, organizationId },
  });
  if (!book) throw new Error("Price book not found.");

  const productId = input.productId?.trim() || null;
  const offerId = input.offerId?.trim() || null;
  const addonId = input.addonId?.trim() || null;

  const existing = await prisma.priceBookEntry.findFirst({
    where: {
      organizationId,
      priceBookId: input.priceBookId,
      ...(productId
        ? { productId, offerId: null, addonId: null }
        : offerId
          ? { offerId, productId: null, addonId: null }
          : { addonId: addonId!, productId: null, offerId: null }),
    },
  });

  const data = {
    amount: input.amount,
    billingFrequency: input.billingFrequency ?? null,
  };

  const row = existing
    ? await prisma.priceBookEntry.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.priceBookEntry.create({
        data: {
          organizationId,
          priceBookId: input.priceBookId,
          productId,
          offerId,
          addonId,
          ...data,
        },
      });

  return {
    id: row.id,
    priceBookId: row.priceBookId,
    productId: row.productId,
    offerId: row.offerId,
    addonId: row.addonId,
    amount: row.amount.toString(),
    billingFrequency: row.billingFrequency,
  };
}

export async function deletePriceBookEntry(id: string): Promise<void> {
  const organizationId = await getCurrentOrganizationId();
  const prisma = getPrismaClient();
  const existing = await prisma.priceBookEntry.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Price book entry not found.");
  await prisma.priceBookEntry.delete({ where: { id } });
}

/**
 * Resolve list price for single-market catalogs: product / offer / addon
 * scalars first. Price book is only a fallback when the scalar is missing
 * (or when an explicit priceBookId is passed and has an entry — still after
 * scalar check so product price remains the day-to-day source of truth).
 */
export async function resolveListPrice(options: {
  productId?: string | null;
  offerId?: string | null;
  addonId?: string | null;
  priceBookId?: string | null;
}): Promise<{
  amount: string | null;
  currency: string;
  source: "price_book" | "product" | "addon" | "none";
  priceBookId: string | null;
}> {
  assertExactlyOneTarget(options);
  const organizationId = await getCurrentOrganizationId();
  const prisma = getPrismaClient();
  const tenantCurrency = await resolveTenantCurrency(organizationId);
  const currencyOrTenant = (code: string | null | undefined) =>
    code?.trim().toUpperCase() || tenantCurrency || "USD";

  let priceBookId = options.priceBookId?.trim() || null;
  if (!priceBookId) {
    const def = await prisma.priceBook.findFirst({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    priceBookId = def?.id ?? null;
  }

  if (options.productId) {
    const product = await prisma.product.findFirst({
      where: { id: options.productId, organizationId },
      select: { price: true, currency: true },
    });
    if (product?.price != null) {
      return {
        amount: dec(product.price),
        currency: currencyOrTenant(product.currency),
        source: "product",
        priceBookId,
      };
    }
  }

  if (options.offerId) {
    const offer = await prisma.productOffer.findFirst({
      where: { id: options.offerId, organizationId },
      include: { product: { select: { price: true, currency: true } } },
    });
    if (offer?.product.price != null) {
      return {
        amount: dec(offer.product.price),
        currency: currencyOrTenant(offer.product.currency),
        source: "product",
        priceBookId,
      };
    }
  }

  if (options.addonId) {
    const addon = await prisma.addon.findFirst({
      where: { id: options.addonId, organizationId },
      include: { product: { select: { currency: true } } },
    });
    const amount =
      addon?.pricingModel === "flat"
        ? dec(addon.flatPrice)
        : addon?.pricingModel === "per_unit"
          ? dec(addon.unitPrice)
          : addon?.pricingModel === "stepped"
            ? dec(addon.stepPrice)
            : null;
    if (amount != null) {
      return {
        amount,
        currency: currencyOrTenant(addon?.product.currency),
        source: "addon",
        priceBookId,
      };
    }
  }

  if (priceBookId) {
    const entry = await prisma.priceBookEntry.findFirst({
      where: {
        organizationId,
        priceBookId,
        ...(options.productId
          ? { productId: options.productId, offerId: null, addonId: null }
          : options.offerId
            ? { offerId: options.offerId, productId: null, addonId: null }
            : {
                addonId: options.addonId!,
                productId: null,
                offerId: null,
              }),
      },
      include: { priceBook: { select: { currency: true } } },
    });
    if (entry) {
      return {
        amount: entry.amount.toString(),
        currency: entry.priceBook.currency,
        source: "price_book",
        priceBookId,
      };
    }
  }

  if (options.productId) {
    const product = await prisma.product.findFirst({
      where: { id: options.productId, organizationId },
      select: { currency: true },
    });
    return {
      amount: null,
      currency: currencyOrTenant(product?.currency),
      source: "none",
      priceBookId,
    };
  }

  if (options.offerId) {
    const offer = await prisma.productOffer.findFirst({
      where: { id: options.offerId, organizationId },
      include: { product: { select: { currency: true } } },
    });
    return {
      amount: null,
      currency: currencyOrTenant(offer?.product.currency),
      source: "none",
      priceBookId,
    };
  }

  const addon = await prisma.addon.findFirst({
    where: { id: options.addonId!, organizationId },
    include: { product: { select: { currency: true } } },
  });
  return {
    amount: null,
    currency: currencyOrTenant(addon?.product.currency),
    source: "none",
    priceBookId,
  };
}
