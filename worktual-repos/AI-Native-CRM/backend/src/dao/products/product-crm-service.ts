/**
 * Product catalog — inventory.products only (Prisma @@schema("inventory")).
 * DML on existing columns only — do not ALTER the catalog from CRM.
 */
import {
  Prisma,
  PrismaClient,
  type AddonMeterKey,
  type AddonPricingModel,
  type ProductBillingFrequency,
  type ProductBillingType,
  type ProductStatus,
  type ProductType,
  type ProductUnitOfMeasure,
} from "@prisma/client";
import { getPrismaClient } from "@/dao/db/prisma";
import {
  paginatedResult,
  type PaginatedResult,
} from "@/lib/pagination";
import { resolveWrittenCurrency } from "@/lib/commercial-currency";
import type {
  AddonInput,
  AddonTierInput,
  ProductOfferInput,
} from "@/dao/products/product-labels";
import {
  getCurrentOrganizationId,
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";

export type ProductInput = {
  name: string;
  tagline?: string | null;
  description?: string | null;
  specifications?: string | null;
  imageUrl?: string | null;
  galleryUrls?: string[];
  /** Product page / PDP / datasheet. Not an image. */
  productUrl?: string | null;
  sku: string;
  price?: number | null;
  /** Discount above this % on a quote line for this product requires Finance approval before send. Null/undefined = no cap. */
  maxDiscountPercent?: number | null;
  currency?: string | null;
  status?: ProductStatus;
  productType?: ProductType;
  category?: string | null;
  brand?: string | null;
  subcategory?: string | null;
  /** Warehouse units. Null = not inventory-tracked. */
  stockOnHand?: number | null;
  tags?: string | null;
  billingType?: ProductBillingType;
  billingFrequency?: ProductBillingFrequency | null;
  customAttributes?: Record<string, unknown> | null;
  addons?: AddonInput[];
  offers?: ProductOfferInput[];
};

export type AddonView = {
  id: string;
  name: string;
  unitLabel: string | null;
  meterKey: AddonMeterKey | null;
  isOverage: boolean;
  pricingModel: AddonPricingModel;
  flatPrice: string | null;
  unitPrice: string | null;
  stepSize: number | null;
  stepPrice: string | null;
  sortOrder: number;
  listPrice: string | null;
  tiers: {
    id: string;
    minQty: number;
    maxQty: number | null;
    unitPrice: string;
  }[];
};

export type ProductOfferView = {
  id: string;
  name: string;
  code: string | null;
  billingType: ProductBillingType | null;
  billingFrequency: ProductBillingFrequency | null;
  includedQty: number | null;
  meterKey: AddonMeterKey | null;
  sortOrder: number;
  status: ProductStatus;
  listPrice: string | null;
};

export type ProductView = {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  specifications: string | null;
  imageUrl: string | null;
  galleryUrls: string[];
  productUrl: string | null;
  sku: string | null;
  price: string | null;
  maxDiscountPercent: string | null;
  currency: string;
  status: ProductStatus;
  productType: ProductType;
  category: string | null;
  brand: string | null;
  subcategory: string | null;
  stockOnHand: number | null;
  tags: string | null;
  billingType: ProductBillingType;
  billingFrequency: ProductBillingFrequency | null;
  unitOfMeasure: ProductUnitOfMeasure;
  customAttributes: Record<string, unknown> | null;
  listPrice: string | null;
  listPriceSource: "price_book" | "product" | "none";
  offerCount: number;
  addons: AddonView[];
  offers: ProductOfferView[];
  createdAt: Date;
  updatedAt: Date;
};

function parseGallery(raw: Prisma.JsonValue | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter(
      (u): u is string => typeof u === "string" && u.trim().length > 0,
    );
  }
  return [];
}

function parseCustomAttributes(
  raw: Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function dec(value: { toString(): string } | null | undefined): string | null {
  return value?.toString() ?? null;
}

type AddonRow = {
  id: string;
  name: string;
  unitLabel: string | null;
  meterKey: AddonMeterKey | null;
  isOverage: boolean;
  pricingModel: AddonPricingModel;
  flatPrice: { toString(): string } | null;
  unitPrice: { toString(): string } | null;
  stepSize: number | null;
  stepPrice: { toString(): string } | null;
  sortOrder: number;
  tiers: {
    id: string;
    minQty: number;
    maxQty: number | null;
    unitPrice: { toString(): string };
  }[];
};

type OfferRow = {
  id: string;
  name: string;
  code: string | null;
  billingType: ProductBillingType | null;
  billingFrequency: ProductBillingFrequency | null;
  includedQty: number | null;
  meterKey: AddonMeterKey | null;
  sortOrder: number;
  status: ProductStatus;
};

function toAddonView(
  row: AddonRow,
  listPriceByAddonId: Map<string, string>,
): AddonView {
  const fallback =
    row.pricingModel === "flat"
      ? dec(row.flatPrice)
      : row.pricingModel === "per_unit"
        ? dec(row.unitPrice)
        : row.pricingModel === "stepped"
          ? dec(row.stepPrice)
          : null;
  return {
    id: row.id,
    name: row.name,
    unitLabel: row.unitLabel,
    meterKey: row.meterKey,
    isOverage: row.isOverage,
    pricingModel: row.pricingModel,
    flatPrice: dec(row.flatPrice),
    unitPrice: dec(row.unitPrice),
    stepSize: row.stepSize,
    stepPrice: dec(row.stepPrice),
    sortOrder: row.sortOrder,
    // Product-level pricing first; price book only fills gaps.
    listPrice: fallback ?? listPriceByAddonId.get(row.id) ?? null,
    tiers: row.tiers
      .slice()
      .sort((a, b) => a.minQty - b.minQty)
      .map((tier) => ({
        id: tier.id,
        minQty: tier.minQty,
        maxQty: tier.maxQty,
        unitPrice: tier.unitPrice.toString(),
      })),
  };
}

function toOfferView(
  row: OfferRow,
  listPriceByOfferId: Map<string, string>,
  productPrice: string | null,
): ProductOfferView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    billingType: row.billingType,
    billingFrequency: row.billingFrequency,
    includedQty: row.includedQty,
    meterKey: row.meterKey,
    sortOrder: row.sortOrder,
    status: row.status,
    listPrice: productPrice ?? listPriceByOfferId.get(row.id) ?? null,
  };
}

function toView(
  row: {
    id: string;
    name: string;
    tagline: string | null;
    description: string | null;
    specifications: string | null;
    imageUrl: string | null;
    galleryUrls: Prisma.JsonValue | null;
    productUrl: string | null;
    sku: string | null;
    price: { toString(): string } | null;
    maxDiscountPercent: { toString(): string } | null;
    currency: string;
    status: ProductStatus;
    productType: ProductType;
    category: string | null;
    brand: string | null;
    subcategory: string | null;
    stockOnHand: number | null;
    tags: string | null;
    billingType: ProductBillingType;
    billingFrequency: ProductBillingFrequency | null;
    unitOfMeasure: ProductUnitOfMeasure;
    customAttributes: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
    addons?: AddonRow[];
    offers?: OfferRow[];
  },
  priceMaps?: {
    productAmount: string | null;
    source: "price_book" | "product" | "none";
    offerAmounts: Map<string, string>;
    addonAmounts: Map<string, string>;
  },
): ProductView {
  const productPrice = dec(row.price);
  const listPrice = priceMaps?.productAmount ?? productPrice;
  const listPriceSource =
    priceMaps?.source ??
    (productPrice != null ? "product" : "none");
  const offers = (row.offers ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    specifications: row.specifications,
    imageUrl: row.imageUrl,
    galleryUrls: parseGallery(row.galleryUrls),
    productUrl: row.productUrl,
    sku: row.sku,
    price: productPrice,
    maxDiscountPercent: dec(row.maxDiscountPercent),
    currency: row.currency,
    status: row.status,
    productType: row.productType,
    category: row.category,
    brand: row.brand,
    subcategory: row.subcategory,
    stockOnHand: row.stockOnHand,
    tags: row.tags,
    billingType: row.billingType,
    billingFrequency: row.billingFrequency,
    unitOfMeasure: row.unitOfMeasure,
    customAttributes: parseCustomAttributes(row.customAttributes),
    listPrice,
    listPriceSource,
    offerCount: offers.length,
    addons: (row.addons ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((a) => toAddonView(a, priceMaps?.addonAmounts ?? new Map())),
    offers: offers.map((o) =>
      toOfferView(o, priceMaps?.offerAmounts ?? new Map(), listPrice),
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const productInclude = {
  addons: {
    include: { tiers: true },
    orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
  },
  offers: {
    orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
  },
};

async function loadDefaultBookPriceMaps(
  organizationId: string,
  productIds: string[],
  offerIds: string[],
  addonIds: string[],
): Promise<{
  bookId: string | null;
  productAmounts: Map<string, string>;
  offerAmounts: Map<string, string>;
  addonAmounts: Map<string, string>;
}> {
  const prisma = getPrismaClient();
  const book = await prisma.priceBook.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  if (!book) {
    return {
      bookId: null,
      productAmounts: new Map(),
      offerAmounts: new Map(),
      addonAmounts: new Map(),
    };
  }
  const entries = await prisma.priceBookEntry.findMany({
    where: {
      organizationId,
      priceBookId: book.id,
      OR: [
        ...(productIds.length ? [{ productId: { in: productIds } }] : []),
        ...(offerIds.length ? [{ offerId: { in: offerIds } }] : []),
        ...(addonIds.length ? [{ addonId: { in: addonIds } }] : []),
      ],
    },
  });
  const productAmounts = new Map<string, string>();
  const offerAmounts = new Map<string, string>();
  const addonAmounts = new Map<string, string>();
  for (const entry of entries) {
    if (entry.productId) productAmounts.set(entry.productId, entry.amount.toString());
    if (entry.offerId) offerAmounts.set(entry.offerId, entry.amount.toString());
    if (entry.addonId) addonAmounts.set(entry.addonId, entry.amount.toString());
  }
  return { bookId: book.id, productAmounts, offerAmounts, addonAmounts };
}

function validateTiers(tiers: AddonTierInput[]): void {
  if (!tiers.length) {
    throw new Error("Tiered addons need at least one pricing band.");
  }
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i]!;
    if (!Number.isFinite(tier.minQty) || tier.minQty < 1) {
      throw new Error("Each tier needs a min quantity of at least 1.");
    }
    if (!Number.isFinite(tier.unitPrice) || tier.unitPrice < 0) {
      throw new Error("Each tier needs a non-negative unit price.");
    }
    if (
      tier.maxQty != null &&
      (!Number.isFinite(tier.maxQty) || tier.maxQty < tier.minQty)
    ) {
      throw new Error("Tier max quantity must be ≥ min quantity.");
    }
    if (i > 0) {
      const prev = sorted[i - 1]!;
      if (prev.maxQty == null) {
        throw new Error("Only the last tier may be unbounded.");
      }
      if (tier.minQty !== prev.maxQty + 1) {
        throw new Error("Tier bands must be contiguous (no gaps).");
      }
    }
  }
  if (sorted.slice(0, -1).some((t) => t.maxQty == null)) {
    throw new Error("Only the last tier may be unbounded.");
  }
}

function validateAddon(addon: AddonInput): void {
  if (!addon.name.trim()) throw new Error("Addon name is required.");
  switch (addon.pricingModel) {
    case "flat":
      if (addon.flatPrice == null || !Number.isFinite(addon.flatPrice)) {
        throw new Error(`“${addon.name}” needs a flat price.`);
      }
      break;
    case "per_unit":
      if (addon.unitPrice == null || !Number.isFinite(addon.unitPrice)) {
        throw new Error(`“${addon.name}” needs a unit price.`);
      }
      break;
    case "stepped":
      if (
        addon.stepSize == null ||
        !Number.isFinite(addon.stepSize) ||
        addon.stepSize <= 0
      ) {
        throw new Error(`“${addon.name}” needs a positive step size.`);
      }
      if (addon.stepPrice == null || !Number.isFinite(addon.stepPrice)) {
        throw new Error(`“${addon.name}” needs a step price.`);
      }
      break;
    case "tiered":
      validateTiers(addon.tiers ?? []);
      break;
    default:
      throw new Error("Unsupported addon pricing model.");
  }
}

function validateOffer(offer: ProductOfferInput): void {
  if (!offer.name.trim()) throw new Error("Offer name is required.");
  if (
    offer.includedQty != null &&
    (!Number.isFinite(offer.includedQty) || offer.includedQty < 0)
  ) {
    throw new Error(`“${offer.name}” included quantity must be ≥ 0.`);
  }
}

function validateProductInput(input: ProductInput): void {
  if (!input.name.trim()) throw new Error("Product name is required.");
  if (!input.sku.trim()) throw new Error("SKU is required.");
  const billingType = input.billingType ?? "one_time";
  if (billingType === "recurring" && !input.billingFrequency) {
    throw new Error("Billing frequency is required for recurring products.");
  }
    if (
    input.maxDiscountPercent != null &&
    (!Number.isFinite(input.maxDiscountPercent) ||
      input.maxDiscountPercent < 0 ||
      input.maxDiscountPercent > 100)
  ) {
    throw new Error("Max discount % must be between 0 and 100.");
  }
  if (
    input.stockOnHand != null &&
    (!Number.isInteger(input.stockOnHand) || input.stockOnHand < 0)
  ) {
    throw new Error("Stock on hand must be a whole number ≥ 0.");
  }
  const productType = input.productType ?? "fixed";
  const addons = input.addons ?? [];
  const offers = input.offers ?? [];
  if (productType === "fixed" && addons.length > 0) {
    throw new Error("Fixed-price products cannot have addons.");
  }
  if (productType === "fixed" && offers.length > 0) {
    throw new Error("Fixed-price products cannot have offers.");
  }
  for (const addon of addons) validateAddon(addon);
  for (const offer of offers) validateOffer(offer);
}

async function assertSkuUnique(
  sku: string,
  organizationId: string,
  excludeId?: string,
): Promise<void> {
  const prisma = getPrismaClient();
  const existing = await prisma.product.findFirst({
    where: {
      organizationId,
      sku: { equals: sku, mode: "insensitive" },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error("A product with this SKU already exists.");
  }
}

function addonCreateData(
  organizationId: string,
  addons: AddonInput[],
): Prisma.AddonCreateWithoutProductInput[] {
  return addons.map((addon, index) => ({
    organizationId,
    name: addon.name.trim(),
    unitLabel: addon.unitLabel?.trim() || null,
    meterKey: addon.meterKey ?? null,
    isOverage: Boolean(addon.isOverage),
    pricingModel: addon.pricingModel,
    flatPrice: addon.pricingModel === "flat" ? addon.flatPrice : null,
    unitPrice: addon.pricingModel === "per_unit" ? addon.unitPrice : null,
    stepSize: addon.pricingModel === "stepped" ? addon.stepSize : null,
    stepPrice: addon.pricingModel === "stepped" ? addon.stepPrice : null,
    sortOrder: addon.sortOrder ?? index,
    tiers:
      addon.pricingModel === "tiered"
        ? {
            create: (addon.tiers ?? []).map((tier) => ({
              organizationId,
              minQty: tier.minQty,
              maxQty: tier.maxQty,
              unitPrice: tier.unitPrice,
            })),
          }
        : undefined,
  }));
}

function offerCreateData(
  organizationId: string,
  offers: ProductOfferInput[],
): Prisma.ProductOfferCreateWithoutProductInput[] {
  return offers.map((offer, index) => ({
    organizationId,
    name: offer.name.trim(),
    code: offer.code?.trim() || null,
    billingType: offer.billingType ?? null,
    billingFrequency: offer.billingFrequency ?? null,
    includedQty: offer.includedQty ?? null,
    meterKey: offer.meterKey ?? null,
    sortOrder: offer.sortOrder ?? index,
    status: offer.status ?? "active",
  }));
}

async function mapRowsToViews(
  organizationId: string,
  rows: Array<{
    id: string;
    name: string;
    tagline: string | null;
    description: string | null;
    specifications: string | null;
    imageUrl: string | null;
    galleryUrls: Prisma.JsonValue | null;
    productUrl: string | null;
    sku: string | null;
    price: { toString(): string } | null;
    maxDiscountPercent: { toString(): string } | null;
    currency: string;
    status: ProductStatus;
    productType: ProductType;
    category: string | null;
    brand: string | null;
    subcategory: string | null;
    stockOnHand: number | null;
    tags: string | null;
    billingType: ProductBillingType;
    billingFrequency: ProductBillingFrequency | null;
    unitOfMeasure: ProductUnitOfMeasure;
    customAttributes: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
    addons: AddonRow[];
    offers: OfferRow[];
  }>,
): Promise<ProductView[]> {
  const productIds = rows.map((r) => r.id);
  const offerIds = rows.flatMap((r) => r.offers.map((o) => o.id));
  const addonIds = rows.flatMap((r) => r.addons.map((a) => a.id));
  const maps = await loadDefaultBookPriceMaps(
    organizationId,
    productIds,
    offerIds,
    addonIds,
  );
  return rows.map((row) => {
    const bookAmount = maps.productAmounts.get(row.id) ?? null;
    const productPrice = dec(row.price);
    return toView(row, {
      // Single-market default: product.price is the list price.
      productAmount: productPrice ?? bookAmount,
      source:
        productPrice != null
          ? "product"
          : bookAmount
            ? "price_book"
            : "none",
      offerAmounts: maps.offerAmounts,
      addonAmounts: maps.addonAmounts,
    });
  });
}

export async function listProducts(options: {
  page: number;
  pageSize: number;
  search?: string;
  status?: ProductStatus | "all";
  category?: string | "all";
  organizationId?: string | null;
}): Promise<PaginatedResult<ProductView>> {
  const organizationId = await resolveRequestOrganizationId(
    options.organizationId,
  );
  const where: Prisma.ProductWhereInput = { organizationId };
  const q = options.search?.trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { subcategory: { contains: q, mode: "insensitive" } },
      { tags: { contains: q, mode: "insensitive" } },
      { tagline: { contains: q, mode: "insensitive" } },
    ];
  }
  if (options.status && options.status !== "all") {
    where.status = options.status;
  }
  if (options.category && options.category !== "all") {
    where.category = { equals: options.category, mode: "insensitive" };
  }

  const prisma = getPrismaClient();

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { updatedAt: "desc" },
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
  ]);

  const items = await mapRowsToViews(organizationId, rows);
  return paginatedResult(items, total, options.page, options.pageSize);
}

export async function listProductCategories(): Promise<string[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.product.findMany({
    where: { category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows
    .map((r) => r.category?.trim())
    .filter((c): c is string => Boolean(c));
}

export async function getProduct(id: string): Promise<ProductView | null> {
  const organizationId = await getCurrentOrganizationId();
  const prisma = getPrismaClient();
  const row = await prisma.product.findFirst({
    where: { id, organizationId },
    include: productInclude,
  });
  if (!row) return null;
  const [view] = await mapRowsToViews(organizationId, [row]);
  return view ?? null;
}

export async function createProduct(input: ProductInput): Promise<ProductView> {
  validateProductInput(input);
  const organizationId = await getCurrentOrganizationId();
  const sku = input.sku.trim();
  await assertSkuUnique(sku, organizationId);

  const billingType = input.billingType ?? "one_time";
  const productType = input.productType ?? "fixed";
  const addons = productType === "customizable" ? (input.addons ?? []) : [];
  const offers = productType === "customizable" ? (input.offers ?? []) : [];
  const prisma = getPrismaClient();

  const row = await prisma.product.create({
    data: {
      organizationId,
      name: input.name.trim(),
      tagline: input.tagline?.trim() || null,
      description: input.description?.trim() || null,
      specifications: input.specifications?.trim() || null,
      imageUrl: input.imageUrl?.trim() || null,
      galleryUrls: input.galleryUrls?.length ? input.galleryUrls : undefined,
      productUrl: input.productUrl?.trim() || null,
      sku,
      price: input.price ?? null,
      maxDiscountPercent: input.maxDiscountPercent ?? null,
      currency: await resolveWrittenCurrency(input.currency, organizationId),
      status: input.status ?? "draft",
      productType,
      category: input.category?.trim() || null,
      brand: input.brand?.trim() || null,
      subcategory: input.subcategory?.trim() || null,
      stockOnHand: input.stockOnHand ?? null,
      tags: input.tags?.trim() || null,
      billingType,
      billingFrequency:
        billingType === "recurring" ? input.billingFrequency ?? null : null,
      customAttributes:
        input.customAttributes != null
          ? (input.customAttributes as Prisma.InputJsonValue)
          : undefined,
      addons: addons.length
        ? { create: addonCreateData(organizationId, addons) }
        : undefined,
      offers: offers.length
        ? { create: offerCreateData(organizationId, offers) }
        : undefined,
    },
    include: productInclude,
  });
  const [view] = await mapRowsToViews(organizationId, [
    row as Parameters<typeof mapRowsToViews>[1][number],
  ]);
  return view!;
}

/** Status-only update — does not touch addons/offers (safe for Activate). */
export async function updateProductStatus(
  id: string,
  status: ProductStatus,
): Promise<ProductView> {
  const organizationId = await getCurrentOrganizationId();
  const prisma = getPrismaClient();
  const existing = await prisma.product.findFirst({
    where: { id, organizationId },
    select: { id: true },
  });
  if (!existing) throw new Error("Product not found.");

  const row = await prisma.product.update({
    where: { id },
    data: { status },
    include: productInclude,
  });
  const [view] = await mapRowsToViews(organizationId, [row]);
  return view!;
}

export async function updateProduct(
  id: string,
  input: ProductInput,
): Promise<ProductView> {
  validateProductInput(input);
  const organizationId = await getCurrentOrganizationId();
  const sku = input.sku.trim();
  await assertSkuUnique(sku, organizationId, id);

  const billingType = input.billingType ?? "one_time";
  const productType = input.productType ?? "fixed";
  const addons = productType === "customizable" ? (input.addons ?? []) : [];
  const offers = productType === "customizable" ? (input.offers ?? []) : [];
  const prisma = getPrismaClient();

  const row = await prisma.$transaction(async (tx) => {
    await tx.addon.deleteMany({ where: { productId: id } });
    await tx.productOffer.deleteMany({ where: { productId: id } });

    return tx.product.update({
      where: { id },
      data: {
        name: input.name.trim(),
        tagline: input.tagline?.trim() || null,
        description: input.description?.trim() || null,
        specifications: input.specifications?.trim() || null,
        imageUrl: input.imageUrl?.trim() || null,
        galleryUrls: input.galleryUrls ?? [],
        productUrl: input.productUrl?.trim() || null,
        sku,
        price: input.price ?? null,
        maxDiscountPercent: input.maxDiscountPercent ?? null,
        currency: await resolveWrittenCurrency(input.currency, organizationId),
        status: input.status ?? "draft",
        productType,
        category: input.category?.trim() || null,
        brand: input.brand?.trim() || null,
        subcategory: input.subcategory?.trim() || null,
        stockOnHand: input.stockOnHand ?? null,
        tags: input.tags?.trim() || null,
        billingType,
        billingFrequency:
          billingType === "recurring" ? input.billingFrequency ?? null : null,
        customAttributes:
          input.customAttributes != null
            ? (input.customAttributes as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        addons: addons.length
          ? { create: addonCreateData(organizationId, addons) }
          : undefined,
        offers: offers.length
          ? { create: offerCreateData(organizationId, offers) }
          : undefined,
      },
      include: productInclude,
    });
  });

  const [view] = await mapRowsToViews(organizationId, [row]);
  return view!;
}

export async function deleteProduct(id: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.product.delete({ where: { id } });
}

/**
 * Decrement catalog stock when the product tracks inventory.
 * No-op when `stock_on_hand` is null. Rejects the order if units exceed stock.
 */
export async function consumeProductStockIfTracked(
  productId: string,
  quantity: number,
  organizationId: string,
  tx?: Prisma.TransactionClient | PrismaClient,
): Promise<void> {
  const db = tx ?? getPrismaClient();
  const units = Math.max(1, Math.ceil(quantity));
  const product = await db.product.findFirst({
    where: { id: productId, organizationId },
    select: { name: true, stockOnHand: true },
  });
  if (!product || product.stockOnHand == null) return;
  if (product.stockOnHand < units) {
    throw new Error(
      `Not enough stock for ${product.name} (${product.stockOnHand} available).`,
    );
  }
  const updated = await db.product.updateMany({
    where: {
      id: productId,
      organizationId,
      stockOnHand: { gte: units },
    },
    data: { stockOnHand: { decrement: units } },
  });
  if (updated.count !== 1) {
    throw new Error(`Not enough stock for ${product.name}.`);
  }
}

const MAX_PRODUCT_SELECT = 500;

/** Lightweight product picker for quote / order line items. */
export async function listProductsForSelect(limit = MAX_PRODUCT_SELECT) {
  const prisma = getPrismaClient();
  const rows = await prisma.product.findMany({
    where: {
      organizationId: await getCurrentOrganizationId(),
      status: { not: "archived" },
    },
    orderBy: { name: "asc" },
    take: Math.min(limit, MAX_PRODUCT_SELECT),
    select: { id: true, name: true, price: true, currency: true, sku: true },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price?.toString() ?? null,
    currency: row.currency,
    sku: row.sku,
  }));
}

export type ProposalCatalogProduct = {
  id: string;
  name: string;
  price: string | null;
  currency: string;
  sku: string | null;
  description: string | null;
  tagline: string | null;
  category: string | null;
  unitOfMeasure: ProductUnitOfMeasure;
  billingType: ProductBillingType;
  billingFrequency: ProductBillingFrequency | null;
  offers: Array<{ meterKey: AddonMeterKey | null }>;
  addons: Array<{
    id: string;
    productId: string;
    name: string;
    unitLabel: string | null;
    meterKey: AddonMeterKey | null;
    pricingModel: AddonPricingModel;
    flatPrice: number | null;
    unitPrice: number | null;
    stepSize: number | null;
    stepPrice: number | null;
    tiers: Array<{
      minQty: number;
      maxQty: number | null;
      unitPrice: number;
    }>;
  }>;
};

const proposalCatalogProductSelect = {
  id: true,
  name: true,
  price: true,
  currency: true,
  sku: true,
  description: true,
  tagline: true,
  category: true,
  unitOfMeasure: true,
  billingType: true,
  billingFrequency: true,
} as const;

async function mapRowsToProposalCatalogProducts(
  rows: Array<{
    id: string;
    name: string;
    price: Prisma.Decimal | null;
    currency: string;
    sku: string | null;
    description: string | null;
    tagline: string | null;
    category: string | null;
    unitOfMeasure: ProductUnitOfMeasure;
    billingType: ProductBillingType;
    billingFrequency: ProductBillingFrequency | null;
  }>,
): Promise<ProposalCatalogProduct[]> {
  const productIds = rows.map((row) => row.id);
  const prisma = getPrismaClient();
  const [addonRows, offerRows] = productIds.length
    ? await Promise.all([
        prisma.addon.findMany({
          where: { productId: { in: productIds } },
          select: {
            id: true,
            productId: true,
            name: true,
            unitLabel: true,
            meterKey: true,
            pricingModel: true,
            flatPrice: true,
            unitPrice: true,
            stepSize: true,
            stepPrice: true,
            tiers: {
              select: { minQty: true, maxQty: true, unitPrice: true },
            },
          },
          take: 500,
        }),
        prisma.productOffer.findMany({
          where: { productId: { in: productIds } },
          select: { productId: true, meterKey: true },
          orderBy: { sortOrder: "asc" },
          take: 500,
        }),
      ])
    : [[], []];
  const addonsByProduct = new Map<string, ProposalCatalogProduct["addons"]>();
  for (const addon of addonRows) {
    const list = addonsByProduct.get(addon.productId) ?? [];
    list.push({
      id: addon.id,
      productId: addon.productId,
      name: addon.name,
      unitLabel: addon.unitLabel,
      meterKey: addon.meterKey,
      pricingModel: addon.pricingModel,
      flatPrice: addon.flatPrice != null ? Number(addon.flatPrice) : null,
      unitPrice: addon.unitPrice != null ? Number(addon.unitPrice) : null,
      stepSize: addon.stepSize,
      stepPrice: addon.stepPrice != null ? Number(addon.stepPrice) : null,
      tiers: addon.tiers.map((tier) => ({
        minQty: tier.minQty,
        maxQty: tier.maxQty,
        unitPrice: Number(tier.unitPrice),
      })),
    });
    addonsByProduct.set(addon.productId, list);
  }
  const offersByProduct = new Map<string, ProposalCatalogProduct["offers"]>();
  for (const offer of offerRows) {
    const list = offersByProduct.get(offer.productId) ?? [];
    list.push({ meterKey: offer.meterKey });
    offersByProduct.set(offer.productId, list);
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price?.toString() ?? null,
    currency: row.currency,
    sku: row.sku,
    description: row.description,
    tagline: row.tagline,
    category: row.category,
    unitOfMeasure: row.unitOfMeasure,
    billingType: row.billingType,
    billingFrequency: row.billingFrequency,
    offers: offersByProduct.get(row.id) ?? [],
    addons: addonsByProduct.get(row.id) ?? [],
  }));
}

/** Full catalog rows (price, addons, offers) for proposal LLM context — org-scoped. */
export async function listActiveProductsForProposalCatalog(
  organizationId: string,
  limit = 100,
): Promise<ProposalCatalogProduct[]> {
  const take = Math.min(Math.max(limit, 1), 100);
  const prisma = getPrismaClient();
  const rows = await prisma.product.findMany({
    where: {
      organizationId,
      status: { not: "archived" },
    },
    select: proposalCatalogProductSelect,
    orderBy: { name: "asc" },
    take,
  });
  return mapRowsToProposalCatalogProducts(rows);
}

export async function listProductsByIds(
  ids: string[],
): Promise<ProposalCatalogProduct[]> {
  const wanted = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    40,
  );
  if (!wanted.length) return [];
  const prisma = getPrismaClient();
  const orgId = await getCurrentOrganizationId();
  const rows = await prisma.product.findMany({
    where: {
      organizationId: orgId,
      id: { in: wanted },
      status: { not: "archived" },
    },
    select: proposalCatalogProductSelect,
  });
  return mapRowsToProposalCatalogProducts(rows);
}

export {
  formatProductPrice,
  PRODUCT_STATUS_LABELS,
} from "@/dao/products/product-labels";
