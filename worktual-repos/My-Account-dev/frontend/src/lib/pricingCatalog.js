import { getAuthToken } from "./auth.js";
import { fetchJson } from "./http.js";
import {
  DEFAULT_PRICING_CATALOG,
  deepMergeCatalog,
  ensureRegionPricing,
  migrateSharedSlabsOntoProducts,
} from "./pricingCatalogDefaults.js";

let cachedCatalog = null;
let inflight = null;

function normalizeCatalog(catalog) {
  const migrated = migrateSharedSlabsOntoProducts(catalog);
  return ensureRegionPricing(deepMergeCatalog(DEFAULT_PRICING_CATALOG, migrated));
}

export function getCachedPricingCatalog() {
  return cachedCatalog || normalizeCatalog(DEFAULT_PRICING_CATALOG);
}

export function setCachedPricingCatalog(catalog) {
  cachedCatalog = catalog ? normalizeCatalog(catalog) : null;
}

export async function fetchPricingCatalog({ force = false } = {}) {
  if (!force && cachedCatalog) {
    return cachedCatalog;
  }

  if (!force && inflight) {
    return inflight;
  }

  inflight = fetchJson("/api/pricing-catalog")
    .then((data) => {
      cachedCatalog = normalizeCatalog(data.catalog);
      return cachedCatalog;
    })
    .catch(() => {
      cachedCatalog = normalizeCatalog(DEFAULT_PRICING_CATALOG);
      return cachedCatalog;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export async function savePricingCatalog(catalog, { scopeProductId = null } = {}) {
  const token = getAuthToken();
  const data = await fetchJson("/api/admin/pricing-catalog", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      catalog,
      ...(scopeProductId ? { scopeProductId } : {}),
    }),
  });

  cachedCatalog = normalizeCatalog(data.catalog);
  return cachedCatalog;
}

export { DEFAULT_PRICING_CATALOG, deepMergeCatalog };
