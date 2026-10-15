/**
 * Unused by the live Product module. CRM catalog is inventory.products.
 * Kept for a possible future CDP → CRM import. Do not ALTER cdp.products.
 */

import { accountQuery } from "@/dao/db/account-pool";
import {
  createProduct,
  updateProduct,
  type ProductInput,
} from "@/dao/products/product-cdp-service";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";

export type CatalogProductRow = {
  name: string;
  sku?: string | null;
  brand?: string | null;
  category?: string | null;
  subcategory?: string | null;
  price?: number | null;
  currency?: string;
  status?: string;
  active?: boolean;
};

export type UpsertCatalogResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
};

const MAX_IMPORT_ROWS = 500;

function parseStatus(raw: string | undefined | null): string {
  const v = raw?.trim().toLowerCase();
  if (v === "available" || v === "active" || v === "publish") return "active";
  if (v === "unavailable" || v === "inactive") return "inactive";
  if (v === "archived") return "archived";
  if (v === "draft") return "draft";
  return "active";
}

function parsePrice(raw: string | undefined | null): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const n = Number.parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseActive(raw: string | undefined | null): boolean | undefined {
  if (raw == null || !String(raw).trim()) return undefined;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(v)) return true;
  if (["0", "false", "no", "n"].includes(v)) return false;
  return undefined;
}

/** Minimal CSV parser: handles quoted fields and commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === "" && rows.length === 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      pushCell();
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      if (ch === "\r") i++;
      pushCell();
      pushRow();
      continue;
    }
    if (ch === "\r") {
      pushCell();
      pushRow();
      continue;
    }
    cell += ch;
  }
  pushCell();
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
    pushRow();
  }
  return rows;
}

const HEADER_ALIASES: Record<string, keyof CatalogProductRow | "skip"> = {
  name: "name",
  title: "name",
  product: "name",
  product_name: "name",
  sku: "sku",
  code: "sku",
  brand: "brand",
  price: "price",
  amount: "price",
  currency: "currency",
  status: "status",
  category: "category",
  subcategory: "subcategory",
  sub_category: "subcategory",
  active: "active",
};

export function csvToCatalogRows(csvText: string): {
  rows: CatalogProductRow[];
  errors: Array<{ row: number; message: string }>;
} {
  const table = parseCsv(csvText.trim());
  if (table.length === 0) {
    return { rows: [], errors: [{ row: 0, message: "CSV is empty." }] };
  }

  const headers = table[0].map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, "_"),
  );
  const mapped = headers.map((h) => HEADER_ALIASES[h] ?? null);
  if (!mapped.includes("name") || !mapped.includes("sku")) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          message:
            "CSV needs name and sku columns. Optional: brand, category, subcategory, price, currency, status, active.",
        },
      ],
    };
  }

  const rows: CatalogProductRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 1; i < table.length; i++) {
    if (rows.length >= MAX_IMPORT_ROWS) {
      errors.push({
        row: i + 1,
        message: `Stopped at ${MAX_IMPORT_ROWS} data rows (max).`,
      });
      break;
    }
    const line = table[i];
    if (line.every((c) => !c.trim())) continue;

    const draft: Record<string, string> = {};
    mapped.forEach((key, col) => {
      if (!key || key === "skip") return;
      draft[key] = (line[col] ?? "").trim();
    });

    const name = draft.name?.trim();
    const sku = draft.sku?.trim();
    if (!name) {
      errors.push({ row: i + 1, message: "Missing name." });
      continue;
    }
    if (!sku) {
      errors.push({ row: i + 1, message: "Missing sku." });
      continue;
    }

    const status = parseStatus(draft.status);
    rows.push({
      name,
      sku,
      brand: draft.brand || null,
      category: draft.category || null,
      subcategory: draft.subcategory || null,
      price: parsePrice(draft.price),
      currency: draft.currency || "USD",
      status,
      active: parseActive(draft.active) ?? status === "active",
    });
  }

  return { rows, errors };
}

async function findProductIdBySku(
  organizationId: string,
  sku: string,
): Promise<string | null> {
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT product_id::text AS id FROM cdp.products
     WHERE organization_id = $1::bigint AND lower(sku) = lower($2)
     LIMIT 1`,
    [organizationId, sku],
  );
  return rows[0]?.id ?? null;
}

export async function upsertCatalogProducts(
  rows: CatalogProductRow[],
  options: {
    organizationId?: string | null;
    dryRun?: boolean;
  } = {},
): Promise<UpsertCatalogResult> {
  const organizationId = await resolveRequestOrganizationId(
    options.organizationId,
  );
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const name = row.name.trim();
    const sku = row.sku?.trim();
    if (!name || !sku) {
      skipped++;
      errors.push({ row: i + 1, message: "Missing name or sku." });
      continue;
    }

    const input: ProductInput = {
      name,
      sku,
      brand: row.brand?.trim() || null,
      category: row.category?.trim() || null,
      subcategory: row.subcategory?.trim() || null,
      price: row.price ?? 0,
      currency: (row.currency?.trim() || "USD").toUpperCase(),
      status: row.status ?? "active",
      active: row.active,
    };

    try {
      const existingId = await findProductIdBySku(organizationId, sku);
      if (options.dryRun) {
        if (existingId) updated++;
        else created++;
        continue;
      }

      if (existingId) {
        await updateProduct(existingId, input);
        updated++;
      } else {
        await createProduct(input);
        created++;
      }
    } catch (err) {
      skipped++;
      errors.push({
        row: i + 1,
        message: err instanceof Error ? err.message : "Failed to upsert.",
      });
    }
  }

  return { created, updated, skipped, errors };
}

export async function importProductsFromCsv(
  csvText: string,
  options: {
    organizationId?: string | null;
    dryRun?: boolean;
  } = {},
): Promise<UpsertCatalogResult & { parsed: number }> {
  const { rows, errors: parseErrors } = csvToCatalogRows(csvText);
  if (rows.length === 0 && parseErrors.length > 0) {
    return {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: parseErrors,
      parsed: 0,
    };
  }
  const result = await upsertCatalogProducts(rows, options);
  return {
    ...result,
    errors: [...parseErrors, ...result.errors].slice(0, 40),
    parsed: rows.length,
  };
}

export { MAX_IMPORT_ROWS, parseStatus, parsePrice };
