import { query } from "../../db/pool.js";

export async function selectLatestPricingCatalogRow() {
  const { rows } = await query(`SELECT * FROM pricing_catalogs ORDER BY version DESC LIMIT 1`);
  return rows[0] || null;
}

export async function upsertPricingCatalogRow({
  version,
  updatedBy,
  regions,
  shared,
  products,
  regionPricing,
}) {
  const { rows } = await query(
    `INSERT INTO pricing_catalogs (version, updated_at, updated_by, regions, shared, products, region_pricing)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6)
     ON CONFLICT (version) DO UPDATE SET
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by,
       regions = EXCLUDED.regions,
       shared = EXCLUDED.shared,
       products = EXCLUDED.products,
       region_pricing = EXCLUDED.region_pricing
     RETURNING *`,
    [version, updatedBy, regions, shared, products, regionPricing],
  );
  return rows[0] || null;
}
