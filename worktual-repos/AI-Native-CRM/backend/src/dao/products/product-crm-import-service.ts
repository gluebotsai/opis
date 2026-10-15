import { getPrismaClient } from "@/dao/db/prisma";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import {
  csvToCatalogRows,
  type CatalogProductRow,
} from "@/dao/products/product-csv";

/** CSV upsert → inventory.products only. DML only. */

export type { CatalogProductRow } from "@/dao/products/product-csv";
export {
  csvToCatalogRows,
  parseCsv,
  parsePrice,
  parseStockOnHand,
  parseStatus,
  MAX_IMPORT_ROWS,
} from "@/dao/products/product-csv";

export type UpsertCatalogResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
};

export async function upsertCatalogProducts(
  rows: CatalogProductRow[],
  options: {
    organizationId?: string | null;
    dryRun?: boolean;
  } = {},
): Promise<UpsertCatalogResult> {
  const organizationId = await resolveRequestOrganizationId(options.organizationId);
  const prisma = getPrismaClient();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row.name.trim();
    if (!name) {
      skipped++;
      errors.push({ row: i + 1, message: "Missing name." });
      continue;
    }

    const sku = row.sku?.trim() || null;
    const data = {
      name,
      sku,
      price: row.price ?? null,
      currency: (row.currency?.trim() || "USD").toUpperCase(),
      status: row.status ?? "draft",
      category: row.category?.trim() || null,
      brand: row.brand?.trim() || null,
      subcategory: row.subcategory?.trim() || null,
      stockOnHand: row.stockOnHand ?? null,
      tags: row.tags?.trim() || null,
      tagline: row.tagline?.trim() || null,
      description: row.description?.trim() || null,
      imageUrl: row.imageUrl?.trim() || null,
      productUrl: row.productUrl?.trim() || null,
      organizationId,
    };

    try {
      if (options.dryRun) {
        if (sku) {
          const existing = await prisma.product.findFirst({
            where: {
              organizationId,
              sku: { equals: sku, mode: "insensitive" },
            },
            select: { id: true },
          });
          if (existing) updated++;
          else created++;
        } else {
          created++;
        }
        continue;
      }

      if (sku) {
        const existing = await prisma.product.findFirst({
          where: {
            organizationId,
            sku: { equals: sku, mode: "insensitive" },
          },
          select: { id: true },
        });
        if (existing) {
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              name: data.name,
              sku: data.sku,
              price: data.price,
              currency: data.currency,
              status: data.status,
              category: data.category,
              brand: data.brand,
              subcategory: data.subcategory,
              stockOnHand: data.stockOnHand,
              tags: data.tags,
              tagline: data.tagline,
              description: data.description,
              imageUrl: data.imageUrl,
              productUrl: data.productUrl,
            },
          });
          updated++;
          continue;
        }
      }

      await prisma.product.create({ data });
      created++;
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
