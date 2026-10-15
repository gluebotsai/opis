/**
 * Apply propose_update_product tool args onto an existing product detail.
 */

import {
  buildAddonsPayload,
  buildOffersPayload,
  numOrNull,
  parseGalleryUrls,
  productKeysForMotion,
  type ProductAddonDraft,
  type ProductOfferDraft,
} from "@/lib/coworker/field-contracts/product";
import type { ProductDetail, ProductInputBody } from "@/services/products";

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function productUpdateBodyFromToolArgs(
  p: ProductDetail,
  args: Record<string, unknown>,
  businessType?: string | null,
): ProductInputBody | null {
  const allowed = productKeysForMotion(businessType);
  const keepMeta = new Set(["productId", "label", "confirmed", "auto"]);
  args = Object.fromEntries(
    Object.entries(args).filter(([k]) => allowed.has(k) || keepMeta.has(k)),
  );
  const name = strArg(args, "name") ?? p.name;
  const sku = strArg(args, "sku") ?? p.sku ?? "";
  const brand = strArg(args, "brand");
  const category = strArg(args, "category");
  const subcategory = strArg(args, "subcategory");
  const description = strArg(args, "description");
  const currency = strArg(args, "currency");
  const status = strArg(args, "status");
  const productType = strArg(args, "productType");
  const billingType = strArg(args, "billingType");
  const billingFrequency = strArg(args, "billingFrequency");
  const tags = strArg(args, "tags");
  const imageUrl = strArg(args, "imageUrl");
  const productUrl = strArg(args, "productUrl");
  const galleryRaw = args.galleryUrls;
  const priceArg = args.price;
  const maxDiscArg = args.maxDiscountPercent;
  const stockArg = args.stockOnHand;

  let priceNum = Number(p.price ?? 0);
  if (typeof priceArg === "string" && priceArg.trim()) {
    const n = numOrNull(priceArg);
    if (n != null) priceNum = n;
  } else if (typeof priceArg === "number" && Number.isFinite(priceArg)) {
    priceNum = priceArg;
  }

  let maxDiscount =
    p.maxDiscountPercent != null ? Number(p.maxDiscountPercent) : null;
  if (maxDiscArg != null && maxDiscArg !== "") {
    maxDiscount = numOrNull(maxDiscArg);
  }

  let stockOnHand = p.stockOnHand ?? null;
  if (stockArg != null && stockArg !== "") {
    const n = numOrNull(stockArg);
    stockOnHand =
      n != null && Number.isInteger(n) && n >= 0 ? n : null;
  }

  const nextType = productType ?? p.productType ?? "fixed";
  const nextBilling = billingType ?? p.billingType ?? "one_time";

  const offersArg = args.offers;
  const addonsArg = args.addons;
  let offersPayload: Array<Record<string, unknown>> | undefined;
  let addonsPayload: Array<Record<string, unknown>> | undefined;

  if (Array.isArray(offersArg)) {
    offersPayload = buildOffersPayload(offersArg as ProductOfferDraft[]);
  }
  if (Array.isArray(addonsArg)) {
    addonsPayload = buildAddonsPayload(addonsArg as ProductAddonDraft[]);
  }

  const gallery =
    galleryRaw !== undefined
      ? parseGalleryUrls(galleryRaw)
      : p.galleryUrls ?? [];

  const changed =
    Boolean(strArg(args, "name")) ||
    Boolean(strArg(args, "sku")) ||
    brand !== undefined ||
    category !== undefined ||
    subcategory !== undefined ||
    description !== undefined ||
    currency !== undefined ||
    status !== undefined ||
    productType !== undefined ||
    billingType !== undefined ||
    billingFrequency !== undefined ||
    tags !== undefined ||
    imageUrl !== undefined ||
    productUrl !== undefined ||
    galleryRaw !== undefined ||
    priceArg != null ||
    maxDiscArg != null ||
    stockArg != null ||
    offersArg !== undefined ||
    addonsArg !== undefined;

  if (!changed) return null;

  return {
    name,
    sku,
    brand: brand !== undefined ? brand : p.brand,
    category: category !== undefined ? category : p.category,
    subcategory: subcategory !== undefined ? subcategory : p.subcategory,
    stockOnHand,
    description: description !== undefined ? description : p.description,
    price: priceNum,
    maxDiscountPercent: maxDiscount,
    currency: currency ?? p.currency,
    status: status ?? p.status,
    productType: nextType,
    billingType: nextBilling,
    billingFrequency:
      nextBilling === "recurring"
        ? billingFrequency ?? p.billingFrequency ?? "monthly"
        : null,
    tags: tags !== undefined ? tags : p.tags,
    imageUrl: imageUrl !== undefined ? imageUrl : p.imageUrl,
    productUrl: productUrl !== undefined ? productUrl : p.productUrl,
    galleryUrls: gallery,
    offers:
      offersPayload ??
      (nextType === "customizable"
        ? (p.offers ?? []).map((o, i) => ({
            name: o.name,
            code: o.code,
            includedQty: o.includedQty,
            meterKey: o.meterKey,
            status: o.status,
            sortOrder: i,
          }))
        : []),
    addons:
      addonsPayload ??
      (nextType === "customizable"
        ? (p.addons ?? []).map((a, i) => ({
            name: a.name,
            unitLabel: a.unitLabel,
            meterKey: a.meterKey,
            isOverage: a.isOverage,
            pricingModel: a.pricingModel,
            flatPrice: a.flatPrice != null ? Number(a.flatPrice) : null,
            unitPrice: a.unitPrice != null ? Number(a.unitPrice) : null,
            stepSize: a.stepSize,
            stepPrice: a.stepPrice != null ? Number(a.stepPrice) : null,
            sortOrder: i,
            tiers: a.tiers.map((t) => ({
              minQty: t.minQty,
              maxQty: t.maxQty,
              unitPrice: Number(t.unitPrice),
            })),
          }))
        : []),
  };
}
