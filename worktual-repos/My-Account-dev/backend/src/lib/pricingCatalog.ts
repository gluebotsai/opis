/**
 * Server-side pricing catalog cache helpers (pure).
 * Client fetch/save wrappers live in frontend/src/lib/pricingCatalog.js.
 */
import {
  DEFAULT_PRICING_CATALOG,
  deepMergeCatalog,
  ensureRegionPricing,
  migrateSharedSlabsOntoProducts,
} from "./pricingCatalogDefaults.js";

let cachedCatalog: any = null;

function normalizeCatalog(catalog: any) {
  const migrated = migrateSharedSlabsOntoProducts(catalog);
  return ensureRegionPricing(deepMergeCatalog(DEFAULT_PRICING_CATALOG, migrated));
}

export function getCachedPricingCatalog() {
  return cachedCatalog || normalizeCatalog(DEFAULT_PRICING_CATALOG);
}

export function setCachedPricingCatalog(catalog: any) {
  cachedCatalog = catalog ? normalizeCatalog(catalog) : null;
}

export { DEFAULT_PRICING_CATALOG, deepMergeCatalog };
