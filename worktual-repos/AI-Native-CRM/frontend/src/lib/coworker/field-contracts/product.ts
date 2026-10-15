/**
 * Coworker product field contract — single source for draft, guided steps,
 * MCP patch keys, and Fastify ProductInputBody mapping.
 */

export type ProductOfferDraft = {
  name: string;
  code?: string;
  includedQty?: string;
  meterKey?: string;
  status?: string;
};

export type ProductAddonTierDraft = {
  minQty: string;
  maxQty: string;
  unitPrice: string;
};

export type ProductAddonDraft = {
  name: string;
  unitLabel?: string;
  meterKey?: string;
  isOverage?: boolean;
  pricingModel: string;
  flatPrice?: string;
  unitPrice?: string;
  stepSize?: string;
  stepPrice?: string;
  tiers?: ProductAddonTierDraft[];
};

/** Keys chatbot can patch on create drafts / propose on update. */
export const PRODUCT_SCALAR_KEYS = [
  "name",
  "sku",
  "brand",
  "category",
  "subcategory",
  "stockOnHand",
  "productUrl",
  "description",
  "price",
  "maxDiscountPercent",
  "currency",
  "status",
  "productType",
  "billingType",
  "billingFrequency",
  "tags",
  "imageUrl",
  "galleryUrls",
] as const;

export type ProductScalarKey = (typeof PRODUCT_SCALAR_KEYS)[number];

function productMotion(
  businessType: string | null | undefined,
): "b2b" | "b2c" | "b2b2c" {
  const t = (businessType || "b2b").trim().toLowerCase();
  return t === "b2c" || t === "b2b2c" ? t : "b2b";
}

/** Brand + stock on hand are commerce fields (B2C / B2B2C). B2B does not collect them. */
export function productShowsRetailFields(
  businessType: string | null | undefined,
): boolean {
  const t = productMotion(businessType);
  return t === "b2c" || t === "b2b2c";
}

/** Quote / CPQ fields (type, billing, max discount, offers). Hidden on pure B2C. */
export function productShowsQuoteFields(
  businessType: string | null | undefined,
): boolean {
  return productMotion(businessType) !== "b2c";
}

const RETAIL_KEYS = new Set(["brand", "stockOnHand"]);
const QUOTE_KEYS = new Set([
  "productType",
  "billingType",
  "billingFrequency",
  "maxDiscountPercent",
  "offers",
  "addons",
]);

/** Keys this motion may show, ask, or patch. Same table; gated collection. */
export function productKeysForMotion(
  businessType: string | null | undefined,
): Set<string> {
  const retail = productShowsRetailFields(businessType);
  const quote = productShowsQuoteFields(businessType);
  const keys = new Set<string>([
    ...PRODUCT_SCALAR_KEYS,
    "offers",
    "addons",
  ]);
  if (!retail) {
    for (const k of RETAIL_KEYS) keys.delete(k);
  }
  if (!quote) {
    for (const k of QUOTE_KEYS) keys.delete(k);
  }
  return keys;
}

export const PRODUCT_COLLECTION_ORDER: Array<{
  key: ProductScalarKey | "offers" | "addons";
  label: string;
  required: boolean;
  /** Only ask when this predicate is true (given current draft scalars). */
  when?: (d: Record<string, unknown>) => boolean;
}> = [
  { key: "name", label: "Product name", required: true },
  { key: "sku", label: "SKU", required: true },
  // Align with next_product_prompt (price after name+SKU).
  { key: "price", label: "Price", required: false },
  { key: "currency", label: "Currency", required: false },
  { key: "productType", label: "Product type", required: false },
  { key: "status", label: "Status", required: false },
  { key: "billingType", label: "Billing type", required: false },
  {
    key: "billingFrequency",
    label: "Billing frequency",
    required: false,
    when: (d) => String(d.billingType || "") === "recurring",
  },
  { key: "maxDiscountPercent", label: "Max discount %", required: false },
  { key: "category", label: "Category", required: false },
  // Brand / stock: commerce only (B2C / B2B2C). Hidden on B2B in form + chat.
  { key: "brand", label: "Brand", required: false },
  { key: "subcategory", label: "Subcategory", required: false },
  { key: "stockOnHand", label: "Stock on hand", required: false },
  { key: "productUrl", label: "Product URL", required: false },
  { key: "description", label: "Description", required: false },
  { key: "tags", label: "Tags", required: false },
  { key: "imageUrl", label: "Image URL", required: false },
  { key: "galleryUrls", label: "Gallery URLs", required: false },
  {
    key: "offers",
    label: "Offers / plans",
    required: false,
    when: (d) => String(d.productType || "") === "customizable",
  },
  {
    key: "addons",
    label: "Addons",
    required: false,
    when: (d) => String(d.productType || "") === "customizable",
  },
];

export function productCollectionOrderFor(
  businessType: string | null | undefined,
): typeof PRODUCT_COLLECTION_ORDER {
  const allowed = productKeysForMotion(businessType);
  return PRODUCT_COLLECTION_ORDER.filter((s) => allowed.has(s.key));
}

export function numOrNull(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseGalleryUrls(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((u) => String(u ?? "").trim())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
  }
  return [];
}

export function buildOffersPayload(
  offers: ProductOfferDraft[] | undefined,
): Array<Record<string, unknown>> {
  if (!offers?.length) return [];
  return offers
    .filter((o) => o.name?.trim())
    .map((offer, index) => ({
      name: offer.name.trim(),
      code: offer.code?.trim() || null,
      includedQty: numOrNull(offer.includedQty),
      meterKey: offer.meterKey?.trim() || null,
      status: offer.status?.trim() || "active",
      sortOrder: index,
    }));
}

export function buildAddonsPayload(
  addons: ProductAddonDraft[] | undefined,
): Array<Record<string, unknown>> {
  if (!addons?.length) return [];
  return addons
    .filter((a) => a.name?.trim())
    .map((addon, index) => ({
      name: addon.name.trim(),
      unitLabel: addon.unitLabel?.trim() || null,
      meterKey: addon.meterKey?.trim() || null,
      isOverage: Boolean(addon.isOverage),
      pricingModel: addon.pricingModel || "unit",
      flatPrice: numOrNull(addon.flatPrice),
      unitPrice: numOrNull(addon.unitPrice),
      stepSize: numOrNull(addon.stepSize),
      stepPrice: numOrNull(addon.stepPrice),
      sortOrder: index,
      tiers: (addon.tiers ?? [])
        .filter((t) => t.minQty.trim() && t.unitPrice.trim())
        .map((t) => ({
          minQty: Number(t.minQty),
          maxQty: t.maxQty.trim() ? Number(t.maxQty) : null,
          unitPrice: Number(t.unitPrice),
        })),
    }));
}

/** Build Fastify ProductInputBody from a draft or tool args + existing product baseline. */
export function productInputFromDraft(input: {
  name: string;
  sku: string;
  brand?: string | null;
  category?: string | null;
  subcategory?: string | null;
  stockOnHand?: string | number | null;
  productUrl?: string | null;
  description?: string | null;
  price?: string | number | null;
  maxDiscountPercent?: string | number | null;
  currency?: string | null;
  status?: string;
  active?: boolean;
  productType?: string;
  billingType?: string;
  billingFrequency?: string | null;
  tags?: string | null;
  imageUrl?: string | null;
  galleryUrls?: string | string[] | null;
  offers?: ProductOfferDraft[];
  addons?: ProductAddonDraft[];
}): Record<string, unknown> {
  const productType = input.productType || "fixed";
  const billingType = input.billingType || "one_time";
  const priceNum = numOrNull(input.price);
  const maxDiscountNum = numOrNull(input.maxDiscountPercent);
  const stockNum = numOrNull(input.stockOnHand);
  const status = input.status || "draft";
  const gallery = parseGalleryUrls(input.galleryUrls);

  return {
    name: input.name.trim(),
    sku: input.sku.trim(),
    brand: input.brand?.trim() || null,
    category: input.category?.trim() || null,
    subcategory: input.subcategory?.trim() || null,
    stockOnHand: stockNum != null && Number.isInteger(stockNum) ? stockNum : null,
    productUrl: input.productUrl?.trim() || null,
    description: input.description?.trim() || null,
    price: priceNum,
    maxDiscountPercent: maxDiscountNum,
    currency: input.currency?.trim() || "",
    status,
    productType,
    tags: input.tags?.trim() || null,
    imageUrl: input.imageUrl?.trim() || null,
    galleryUrls: gallery,
    billingType,
    billingFrequency: billingType === "recurring" ? input.billingFrequency || "monthly" : null,
    offers: productType === "customizable" ? buildOffersPayload(input.offers) : [],
    addons: productType === "customizable" ? buildAddonsPayload(input.addons) : [],
  };
}
