import { rowToCamel, toIso } from "./db/util.js";
import {
  DEFAULT_PRICING_CATALOG,
  deepMergeCatalog,
} from "../src/lib/pricingCatalogDefaults.js";
import { assertValidPricingCatalogPayload } from "../src/lib/pricingCatalogValidation.js";
import {
  selectLatestPricingCatalogRow,
  upsertPricingCatalogRow,
} from "./repositories/raw/pricingCatalog.repo.js";

function mapCatalogRow(row) {
  if (!row) {
    return null;
  }

  const catalog = rowToCamel(row);
  return {
    version: catalog.version,
    regions: catalog.regions || DEFAULT_PRICING_CATALOG.regions,
    shared: catalog.shared || DEFAULT_PRICING_CATALOG.shared,
    products: catalog.products || DEFAULT_PRICING_CATALOG.products,
    regionPricing: catalog.regionPricing || DEFAULT_PRICING_CATALOG.regionPricing || null,
    updatedAt: toIso(catalog.updatedAt),
    updatedBy: catalog.updatedBy || "",
  };
}

export async function getPricingCatalog() {
  const stored = mapCatalogRow(await selectLatestPricingCatalogRow());
  return deepMergeCatalog(DEFAULT_PRICING_CATALOG, stored);
}

export async function savePricingCatalog(payload, updatedBy = "") {
  assertValidPricingCatalogPayload(payload);
  const merged = deepMergeCatalog(DEFAULT_PRICING_CATALOG, payload);
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
