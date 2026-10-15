import { rowToCamel, toIso } from "../../db/util.js";
import {
  DEFAULT_PRICING_CATALOG,
  deepMergeCatalog,
} from "../../lib/pricingCatalogDefaults.js";
import {
  assertValidPricingCatalogPayload,
  assertValidPricingCatalogScope,
  coerceEmptyNumericFieldsToZero,
} from "../../lib/pricingCatalogValidation.js";
import {
  selectLatestPricingCatalogRow,
  upsertPricingCatalogRow,
} from "../../repositories/raw/pricingCatalog.repo.js";

function mapCatalogRow(row: any) {
  if (!row) {
    return null;
  }

  const catalog = rowToCamel(row);
  return {
    version: (catalog as any).version,
    regions: (catalog as any).regions || DEFAULT_PRICING_CATALOG.regions,
    shared: (catalog as any).shared || DEFAULT_PRICING_CATALOG.shared,
    products: (catalog as any).products || DEFAULT_PRICING_CATALOG.products,
    regionPricing: (catalog as any).regionPricing || DEFAULT_PRICING_CATALOG.regionPricing || null,
    updatedAt: toIso((catalog as any).updatedAt),
    updatedBy: (catalog as any).updatedBy || "",
  };
}

export async function getPricingCatalog() {
  const stored = mapCatalogRow(await selectLatestPricingCatalogRow());
  return deepMergeCatalog(DEFAULT_PRICING_CATALOG, stored);
}

function mergeScopedProductCatalog(current: any, payload: any, scopeProductId: any) {
  const next = deepMergeCatalog(current, {});

  if (!scopeProductId || scopeProductId === "regions") {
    if (payload.regions) {
      next.regions = payload.regions;
    }
    if (payload.shared) {
      next.shared = coerceEmptyNumericFieldsToZero(payload.shared);
    }
    if (payload.regionPricing && typeof payload.regionPricing === "object") {
      next.regionPricing = next.regionPricing || {};
      for (const [region, slice] of Object.entries(payload.regionPricing)) {
        const existing = next.regionPricing[region] || { products: {}, shared: {} };
        next.regionPricing[region] = {
          ...existing,
          shared: coerceEmptyNumericFieldsToZero((slice as any)?.shared || existing.shared || {}),
        };
      }
    }
    return next;
  }

  if (payload.products?.[scopeProductId]) {
    next.products = {
      ...next.products,
      [scopeProductId]: coerceEmptyNumericFieldsToZero(payload.products[scopeProductId]),
    };
  }

  if (payload.regionPricing && typeof payload.regionPricing === "object") {
    next.regionPricing = next.regionPricing || {};
    for (const [region, slice] of Object.entries(payload.regionPricing)) {
      const existing = next.regionPricing[region] || { products: {}, shared: {} };
      const incomingProduct = (slice as any)?.products?.[scopeProductId];
      next.regionPricing[region] = {
        ...existing,
        products: {
          ...existing.products,
          ...(incomingProduct
            ? { [scopeProductId]: coerceEmptyNumericFieldsToZero(incomingProduct) }
            : {}),
        },
        shared: existing.shared || {},
      };
    }
  }

  // Keep top-level products in sync with India slice when present (legacy shape).
  const indiaProduct = next.regionPricing?.India?.products?.[scopeProductId];
  if (indiaProduct) {
    next.products = {
      ...next.products,
      [scopeProductId]: indiaProduct,
    };
  }

  return next;
}

export async function savePricingCatalog(payload: any, updatedBy = "", { scopeProductId = null } = {}) {
  const current = await getPricingCatalog();

  let merged;
  if (scopeProductId) {
    merged = mergeScopedProductCatalog(current, payload || {}, scopeProductId);
    assertValidPricingCatalogScope(merged, scopeProductId);
  } else {
    merged = deepMergeCatalog(DEFAULT_PRICING_CATALOG, payload);
    assertValidPricingCatalogPayload(merged);
  }

  const version = merged.version || 1;

  const row = await upsertPricingCatalogRow({
    version,
    updatedBy: updatedBy || merged.updatedBy || "",
    regions: JSON.stringify(merged.regions),
    shared: JSON.stringify(merged.shared),
    products: JSON.stringify(merged.products),
    regionPricing: JSON.stringify(merged.regionPricing || null),
  });

  return deepMergeCatalog(DEFAULT_PRICING_CATALOG, mapCatalogRow(row));
}
