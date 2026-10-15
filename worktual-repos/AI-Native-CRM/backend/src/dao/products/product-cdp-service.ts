/**
 * Unused by the live Product module. CRM catalog is inventory.products.
 * Kept for a possible future CDP → inventory import. Do not ALTER cdp.products.
 */

import { accountQuery } from "@/dao/db/account-pool";
import {
  paginatedResult,
  type PaginatedResult,
} from "@/lib/pagination";
import {
  getCurrentOrganizationId,
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";

export type ProductInput = {
  name: string;
  sku: string;
  brand?: string | null;
  category?: string | null;
  subcategory?: string | null;
  price?: number | null;
  currency?: string | null;
  status?: string;
  active?: boolean;
  customFields?: Record<string, unknown> | null;
};

export type ProductView = {
  id: string;
  name: string;
  sku: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  price: string | null;
  currency: string;
  status: string;
  active: boolean;
  customFields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  /** Compat stubs for quote/invoice/commerce callers that still expect old CRM shape. */
  tagline: string | null;
  description: string | null;
  specifications: string | null;
  imageUrl: string | null;
  galleryUrls: string[];
  productType: "fixed";
  tags: string | null;
  billingType: "one_time";
  billingFrequency: null;
  addons: [];
};

type CdpProductRow = {
  product_id: string;
  sku: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  price: string | number;
  currency: string;
  status: string;
  active: boolean;
  organization_id: string;
  custom_fields: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

const SELECT_FIELDS = `
  product_id::text AS product_id,
  sku,
  product_name,
  brand,
  category,
  subcategory,
  price::text AS price,
  currency,
  status,
  active,
  organization_id::text AS organization_id,
  custom_fields,
  created_at,
  updated_at
`;

function asCustomFields(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function normalizeStatus(raw: string | undefined | null): string {
  const v = (raw ?? "active").trim().toLowerCase();
  if (v === "available" || v === "publish") return "active";
  if (v === "unavailable" || v === "inactive") return "inactive";
  if (v === "archived") return "archived";
  if (v === "draft") return "draft";
  if (v === "active") return "active";
  return v || "active";
}

function activeFromStatus(status: string, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  return status === "active";
}

function toView(row: CdpProductRow): ProductView {
  const price =
    row.price == null || row.price === ""
      ? null
      : typeof row.price === "number"
        ? String(row.price)
        : String(row.price);
  return {
    id: row.product_id,
    name: row.product_name,
    sku: row.sku,
    brand: row.brand?.trim() || null,
    category: row.category?.trim() || null,
    subcategory: row.subcategory?.trim() || null,
    price,
    currency: row.currency || "USD",
    status: row.status || "active",
    active: Boolean(row.active),
    customFields: asCustomFields(row.custom_fields),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tagline: null,
    description: null,
    specifications: null,
    imageUrl: null,
    galleryUrls: [],
    productType: "fixed",
    tags: null,
    billingType: "one_time",
    billingFrequency: null,
    addons: [],
  };
}

function validateProductInput(input: ProductInput): void {
  if (!input.name.trim()) throw new Error("Product name is required.");
  if (!input.sku.trim()) throw new Error("SKU is required.");
}

async function assertSkuUnique(
  sku: string,
  organizationId: string,
  excludeId?: string,
): Promise<void> {
  const params: unknown[] = [organizationId, sku.trim()];
  let sql = `
    SELECT product_id::text AS id FROM cdp.products
    WHERE organization_id = $1::bigint
      AND lower(sku) = lower($2)
  `;
  if (excludeId) {
    params.push(excludeId);
    sql += ` AND product_id <> $3::bigint`;
  }
  sql += ` LIMIT 1`;
  const { rows } = await accountQuery<{ id: string }>(sql, params);
  if (rows[0]) {
    throw new Error("A product with this SKU already exists.");
  }
}

export async function listProducts(options: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string | "all";
  category?: string | "all";
  organizationId?: string | null;
}): Promise<PaginatedResult<ProductView>> {
  const organizationId = await resolveRequestOrganizationId(
    options.organizationId,
  );
  const conditions: string[] = ["organization_id = $1::bigint"];
  const params: unknown[] = [organizationId];
  let i = 2;

  const q = options.search?.trim();
  if (q) {
    conditions.push(
      `(product_name ILIKE $${i} OR sku ILIKE $${i} OR brand ILIKE $${i} OR category ILIKE $${i} OR subcategory ILIKE $${i})`,
    );
    params.push(`%${q}%`);
    i += 1;
  }

  if (options.status && options.status !== "all") {
    const status = normalizeStatus(options.status);
    if (status === "archived") {
      conditions.push(`(status = $${i} OR active = false)`);
      params.push("archived");
    } else if (status === "inactive") {
      conditions.push(`(status = $${i} OR active = false)`);
      params.push("inactive");
    } else {
      conditions.push(`status = $${i} AND active = true`);
      params.push(status);
    }
    i += 1;
  }

  if (options.category && options.category !== "all") {
    conditions.push(`lower(category) = lower($${i})`);
    params.push(options.category.trim());
    i += 1;
  }

  const where = conditions.join(" AND ");
  const countResult = await accountQuery<{ count: string }>(
    `SELECT count(*)::text AS count FROM cdp.products WHERE ${where}`,
    params,
  );
  const total = Number.parseInt(countResult.rows[0]?.count ?? "0", 10);

  const { rows } = await accountQuery<CdpProductRow>(
    `SELECT ${SELECT_FIELDS}
     FROM cdp.products
     WHERE ${where}
     ORDER BY updated_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    [...params, options.pageSize, (options.page - 1) * options.pageSize],
  );

  return paginatedResult(
    rows.map(toView),
    total,
    options.page,
    options.pageSize,
  );
}

export async function listProductCategories(): Promise<string[]> {
  const organizationId = await getCurrentOrganizationId();
  const { rows } = await accountQuery<{ category: string }>(
    `SELECT DISTINCT category
     FROM cdp.products
     WHERE organization_id = $1::bigint
       AND category IS NOT NULL
       AND trim(category) <> ''
     ORDER BY category ASC`,
    [organizationId],
  );
  return rows.map((r) => r.category.trim()).filter(Boolean);
}

export async function getProduct(id: string): Promise<ProductView | null> {
  const organizationId = await getCurrentOrganizationId();
  const { rows } = await accountQuery<CdpProductRow>(
    `SELECT ${SELECT_FIELDS}
     FROM cdp.products
     WHERE product_id = $1::bigint
       AND organization_id = $2::bigint
     LIMIT 1`,
    [id, organizationId],
  );
  return rows[0] ? toView(rows[0]) : null;
}

export async function createProduct(input: ProductInput): Promise<ProductView> {
  validateProductInput(input);
  const organizationId = await getCurrentOrganizationId();
  const sku = input.sku.trim();
  await assertSkuUnique(sku, organizationId);

  const status = normalizeStatus(input.status);
  const active = activeFromStatus(status, input.active);
  const customFields = input.customFields ?? {};

  const { rows } = await accountQuery<CdpProductRow>(
    `INSERT INTO cdp.products (
       organization_id, sku, product_name, brand, category, subcategory,
       price, currency, status, active, custom_fields
     ) VALUES ($1::bigint, $2, $3, $4, $5, $6,
       $7::numeric, $8, $9, $10, $11::jsonb
     )
     RETURNING ${SELECT_FIELDS}`,
    [
      organizationId,
      sku,
      input.name.trim(),
      input.brand?.trim() || null,
      input.category?.trim() || null,
      input.subcategory?.trim() || null,
      input.price ?? 0,
      (input.currency?.trim() || "USD").toUpperCase(),
      status,
      active,
      JSON.stringify(customFields),
    ],
  );
  return toView(rows[0]!);
}

/** Status-only update — safe for Activate from the detail page. */
export async function updateProductStatus(
  id: string,
  statusRaw: string,
): Promise<ProductView> {
  const organizationId = await getCurrentOrganizationId();
  const existing = await getProduct(id);
  if (!existing) throw new Error("Product not found.");

  const status = normalizeStatus(statusRaw);
  const active = activeFromStatus(status);

  const { rows } = await accountQuery<CdpProductRow>(
    `UPDATE cdp.products SET
       status = $3,
       active = $4,
       updated_at = NOW()
     WHERE product_id = $1::bigint
       AND organization_id = $2::bigint
     RETURNING ${SELECT_FIELDS}`,
    [id, organizationId, status, active],
  );
  const row = rows[0];
  if (!row) throw new Error("Product not found.");
  return toView(row);
}

export async function updateProduct(
  id: string,
  input: ProductInput,
): Promise<ProductView> {
  validateProductInput(input);
  const organizationId = await getCurrentOrganizationId();
  const existing = await getProduct(id);
  if (!existing) throw new Error("Product not found.");

  const sku = input.sku.trim();
  await assertSkuUnique(sku, organizationId, id);

  const status = normalizeStatus(input.status ?? existing.status);
  const active = activeFromStatus(
    status,
    input.active !== undefined ? input.active : existing.active,
  );
  const customFields = input.customFields ?? existing.customFields;

  const { rows } = await accountQuery<CdpProductRow>(
    `UPDATE cdp.products SET
       sku = $3,
       product_name = $4,
       brand = $5,
       category = $6,
       subcategory = $7,
       price = $8::numeric,
       currency = $9,
       status = $10,
       active = $11,
       custom_fields = $12::jsonb,
       updated_at = NOW()
     WHERE product_id = $1::bigint
       AND organization_id = $2::bigint
     RETURNING ${SELECT_FIELDS}`,
    [
      id,
      organizationId,
      sku,
      input.name.trim(),
      input.brand?.trim() || null,
      input.category?.trim() || null,
      input.subcategory?.trim() || null,
      input.price ?? 0,
      (input.currency?.trim() || "USD").toUpperCase(),
      status,
      active,
      JSON.stringify(customFields),
    ],
  );
  if (!rows[0]) throw new Error("Product not found.");
  return toView(rows[0]);
}

export async function deleteProduct(id: string): Promise<void> {
  const organizationId = await getCurrentOrganizationId();
  const result = await accountQuery(
    `DELETE FROM cdp.products
     WHERE product_id = $1::bigint
       AND organization_id = $2::bigint`,
    [id, organizationId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Product not found.");
  }
}

const MAX_PRODUCT_SELECT = 500;

/** Lightweight product picker for quote / order line items. */
export async function listProductsForSelect(limit = MAX_PRODUCT_SELECT) {
  const organizationId = await getCurrentOrganizationId();
  const take = Math.min(limit, MAX_PRODUCT_SELECT);
  const { rows } = await accountQuery<{
    product_id: string;
    product_name: string;
    price: string | null;
    currency: string;
    sku: string;
  }>(
    `SELECT product_id::text AS product_id,
            product_name,
            price::text AS price,
            currency,
            sku
     FROM cdp.products
     WHERE organization_id = $1::bigint
       AND active = true
       AND lower(status) <> 'archived'
     ORDER BY product_name ASC
     LIMIT $2`,
    [organizationId, take],
  );
  return rows.map((row) => ({
    id: row.product_id,
    name: row.product_name,
    price: row.price,
    currency: row.currency,
    sku: row.sku,
  }));
}

export {
  formatProductPrice,
  PRODUCT_STATUS_LABELS,
} from "@/dao/products/product-labels";
