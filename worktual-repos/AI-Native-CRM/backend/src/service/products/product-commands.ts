/**
 * Product commands — all motions use inventory.products.
 */

import {
  createProduct,
  deleteProduct,
  getProduct,
  listProductCategories,
  listProducts,
  listProductsForSelect,
  updateProduct,
  updateProductStatus,
  type CrmProductInput,
} from "@/dao/products/product-service";
import {
  isAddonMeterKey,
  isAddonPricingModel,
  isProductStatus,
  isProductType,
  normalizeProductStatus,
  type AddonInput,
  type ProductOfferInput,
} from "@/dao/products/product-labels";
import { importProductsFromCsv } from "@/dao/products/product-import-service";
import {
  canEditProducts,
  canImportProducts,
} from "@/service/auth/rbac";
import {
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";

export type CommandResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type ProductListPageItem = {
  id: string;
  name: string;
  sku: string | null;
  price: string | null;
  currency: string;
  status: string;
  category: string | null;
  updatedAt: string;
  brand?: string | null;
  subcategory?: string | null;
  stockOnHand?: number | null;
  tagline?: string | null;
  imageUrl?: string | null;
  productUrl?: string | null;
  productType?: string;
  tags?: string | null;
  addonCount?: number;
  offerCount?: number;
  listPrice?: string | null;
  listPriceSource?: string;
  catalog: "crm";
};

function parseCrmStatus(raw: string | undefined | null):
  | "draft"
  | "active"
  | "archived"
  | "all" {
  if (!raw || raw === "all") return "all";
  if (raw === "inactive") return "archived";
  if (raw === "available") return "active";
  if (isProductStatus(raw)) return raw;
  return normalizeProductStatus(raw);
}

function parseBillingType(raw: string | undefined | null): "one_time" | "recurring" {
  return raw === "recurring" ? "recurring" : "one_time";
}

function parseBillingFrequency(
  raw: string | undefined | null,
): "monthly" | "quarterly" | "annual" | null {
  if (raw === "monthly" || raw === "quarterly" || raw === "annual") return raw;
  return null;
}

function parseAddons(raw: unknown): AddonInput[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Invalid addons payload.");
    }
  }
  if (!Array.isArray(parsed)) return [];

  const addons: AddonInput[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const pricingModelRaw = String(r.pricingModel ?? "");
    if (!isAddonPricingModel(pricingModelRaw)) continue;
    const tiersRaw = Array.isArray(r.tiers) ? r.tiers : [];
    const tiers = tiersRaw
      .map((tier) => {
        if (!tier || typeof tier !== "object") return null;
        const t = tier as Record<string, unknown>;
        const minQty = Number(t.minQty);
        const unitPrice = Number(t.unitPrice);
        if (!Number.isFinite(minQty) || !Number.isFinite(unitPrice)) return null;
        const maxRaw = t.maxQty;
        const maxQty =
          maxRaw === null || maxRaw === undefined || maxRaw === ""
            ? null
            : Number(maxRaw);
        return {
          minQty,
          maxQty: maxQty != null && Number.isFinite(maxQty) ? maxQty : null,
          unitPrice,
        };
      })
      .filter((t): t is NonNullable<typeof t> => Boolean(t));

    const numOrNull = (v: unknown) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    addons.push({
      name: String(r.name ?? ""),
      unitLabel: r.unitLabel ? String(r.unitLabel) : null,
      meterKey:
        typeof r.meterKey === "string" && isAddonMeterKey(r.meterKey)
          ? r.meterKey
          : null,
      isOverage: Boolean(r.isOverage),
      pricingModel: pricingModelRaw,
      flatPrice: numOrNull(r.flatPrice),
      unitPrice: numOrNull(r.unitPrice),
      stepSize: numOrNull(r.stepSize),
      stepPrice: numOrNull(r.stepPrice),
      sortOrder: numOrNull(r.sortOrder) ?? addons.length,
      tiers,
    });
  }
  return addons;
}

function parseOffers(raw: unknown): ProductOfferInput[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Invalid offers payload.");
    }
  }
  if (!Array.isArray(parsed)) return [];

  const offers: ProductOfferInput[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = String(r.name ?? "").trim();
    if (!name) continue;
    const includedRaw = r.includedQty;
    const includedQty =
      includedRaw === null || includedRaw === undefined || includedRaw === ""
        ? null
        : Number(includedRaw);
    const statusRaw = typeof r.status === "string" ? r.status : "active";
    const status = isProductStatus(statusRaw) ? statusRaw : "active";
    offers.push({
      name,
      code: r.code ? String(r.code) : null,
      billingType:
        r.billingType === "recurring" || r.billingType === "one_time"
          ? r.billingType
          : null,
      billingFrequency: parseBillingFrequency(
        typeof r.billingFrequency === "string" ? r.billingFrequency : undefined,
      ),
      includedQty:
        includedQty != null && Number.isFinite(includedQty) ? includedQty : null,
      meterKey:
        typeof r.meterKey === "string" && isAddonMeterKey(r.meterKey)
          ? r.meterKey
          : null,
      sortOrder:
        typeof r.sortOrder === "number" && Number.isFinite(r.sortOrder)
          ? r.sortOrder
          : offers.length,
      status,
    });
  }
  return offers;
}

function parsePrice(body: Record<string, unknown>): number | null {
  const priceRaw = body.price;
  if (priceRaw === null || priceRaw === undefined || priceRaw === "") return null;
  const n = Number(priceRaw);
  return Number.isFinite(n) ? n : null;
}

/** Discount above this % on a quote line for this product requires Finance approval. */
function parseMaxDiscountPercent(body: Record<string, unknown>): number | null {
  const raw = body.maxDiscountPercent;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

/** Warehouse units. Empty = not tracked. */
function parseStockOnHand(body: Record<string, unknown>): number | null {
  const raw = body.stockOnHand;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error("Stock on hand must be a whole number ≥ 0.");
  }
  return n;
}

export function bodyToCrmProductInput(
  body: Record<string, unknown>,
): CrmProductInput {
  const billingType = parseBillingType(
    typeof body.billingType === "string" ? body.billingType : undefined,
  );
  const billingFrequency = parseBillingFrequency(
    typeof body.billingFrequency === "string" ? body.billingFrequency : undefined,
  );
  const productTypeRaw =
    typeof body.productType === "string" ? body.productType : "fixed";
  const productType = isProductType(productTypeRaw) ? productTypeRaw : "fixed";

  const statusRaw = typeof body.status === "string" ? body.status : "draft";
  const status = parseCrmStatus(statusRaw);
  const gallery =
    Array.isArray(body.galleryUrls)
      ? body.galleryUrls.filter((u): u is string => typeof u === "string")
      : typeof body.galleryUrls === "string"
        ? body.galleryUrls
            .split(/\n|,/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

  return {
    name: String(body.name ?? ""),
    tagline: body.tagline ? String(body.tagline) : null,
    description: body.description ? String(body.description) : null,
    specifications: body.specifications ? String(body.specifications) : null,
    imageUrl: body.imageUrl ? String(body.imageUrl) : null,
    galleryUrls: gallery,
    productUrl: body.productUrl ? String(body.productUrl) : null,
    sku: String(body.sku ?? ""),
    price: parsePrice(body),
    maxDiscountPercent: parseMaxDiscountPercent(body),
    currency: body.currency ? String(body.currency) : null,
    status: status === "all" ? "draft" : status,
    productType,
    category: body.category ? String(body.category) : null,
    brand: body.brand ? String(body.brand) : null,
    subcategory: body.subcategory ? String(body.subcategory) : null,
    stockOnHand: parseStockOnHand(body),
    tags: body.tags ? String(body.tags) : null,
    billingType,
    billingFrequency: billingType === "recurring" ? billingFrequency : null,
    addons:
      productType === "customizable"
        ? parseAddons(body.addons ?? body.addonsJson)
        : [],
    offers:
      productType === "customizable"
        ? parseOffers(body.offers ?? body.offersJson)
        : [],
    customAttributes:
      body.customAttributes &&
      typeof body.customAttributes === "object" &&
      !Array.isArray(body.customAttributes)
        ? (body.customAttributes as Record<string, unknown>)
        : null,
  };
}

/** Prefer bodyToCrmProductInput. */
export function bodyToProductInput(body: Record<string, unknown>): CrmProductInput {
  return bodyToCrmProductInput(body);
}

export async function listProductsCommand(filters: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  category?: string;
}) {
  const status = parseCrmStatus(filters.status);
  const result = await listProducts({
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 24,
    search: filters.search,
    status,
    category: filters.category || "all",
  });
  return {
    catalog: "crm" as const,
    items: result.items.map(
      (p): ProductListPageItem => ({
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        imageUrl: p.imageUrl,
        productUrl: p.productUrl,
        sku: p.sku,
        brand: p.brand,
        subcategory: p.subcategory,
        stockOnHand: p.stockOnHand,
        price: p.price,
        currency: p.currency,
        status: p.status,
        productType: p.productType,
        category: p.category,
        tags: p.tags,
        addonCount: p.addons.length,
        offerCount: p.offerCount,
        listPrice: p.listPrice,
        listPriceSource: p.listPriceSource,
        updatedAt: p.updatedAt.toISOString(),
        catalog: "crm",
      }),
    ),
    pagination: result.pagination,
  };
}

export async function listCategoriesCommand() {
  return listProductCategories();
}

export async function listProductsSelectCommand(limit?: number) {
  return listProductsForSelect(limit);
}

export async function getProductCommand(id: string) {
  const product = await getProduct(id);
  if (!product) {
    return { ok: false as const, error: "Product not found.", status: 404 as const };
  }

  return {
    ok: true as const,
    catalog: "crm" as const,
    product: {
      ...product,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    },
  };
}

export async function createProductCommand(
  body: Record<string, unknown>,
): Promise<CommandResult> {
  try {
    await requireRole(
      canEditProducts,
      "You do not have permission to create products.",
    );
    const input = bodyToCrmProductInput(body);
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    if (!input.sku.trim()) return { ok: false, error: "SKU is required." };
    const product = await createProduct(input);
    return { ok: true, id: product.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create product.",
    };
  }
}

export async function updateProductCommand(
  id: string,
  body: Record<string, unknown>,
): Promise<CommandResult> {
  try {
    await requireRole(
      canEditProducts,
      "You do not have permission to edit products.",
    );
    const input = bodyToCrmProductInput(body);
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    if (!input.sku.trim()) return { ok: false, error: "SKU is required." };
    const product = await updateProduct(id, input);
    return { ok: true, id: product.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to edit product.",
    };
  }
}

/** Activate / change status without rewriting catalog lines (addons stay intact). */
export async function updateProductStatusCommand(
  id: string,
  body: Record<string, unknown>,
): Promise<CommandResult> {
  try {
    await requireRole(
      canEditProducts,
      "You do not have permission to edit products.",
    );
    const statusRaw =
      typeof body.status === "string" ? body.status.trim() : "";
    if (!statusRaw) return { ok: false, error: "Status is required." };
    if (!isProductStatus(statusRaw)) {
      return { ok: false, error: "Invalid status." };
    }
    const product = await updateProductStatus(id, statusRaw);
    return { ok: true, id: product.id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to update product status.",
    };
  }
}

export async function deleteProductCommand(id: string): Promise<CommandResult> {
  try {
    await requireRole(
      canEditProducts,
      "You do not have permission to delete products.",
    );
    await deleteProduct(id);
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete product.",
    };
  }
}

export async function importProductsCommand(input: {
  csvText: string;
  dryRun?: boolean;
}) {
  try {
    await requireRole(
      canImportProducts,
      "Only admins and sales managers can import products.",
    );
    const orgId = await getCurrentOrganizationId();
    const result = await importProductsFromCsv(input.csvText, {
      organizationId: orgId,
      dryRun: Boolean(input.dryRun),
    });
    return {
      ok: true as const,
      dryRun: Boolean(input.dryRun),
      parsed: result.parsed,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Import failed.",
    };
  }
}
