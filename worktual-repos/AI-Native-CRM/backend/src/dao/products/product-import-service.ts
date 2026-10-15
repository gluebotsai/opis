/**
 * Product CSV / catalog upsert — all motions write inventory.products.
 */

import * as crmImport from "@/dao/products/product-crm-import-service";

export type CatalogProductRow = crmImport.CatalogProductRow;
export type UpsertCatalogResult = crmImport.UpsertCatalogResult;

export const parseCsv = crmImport.parseCsv;
export const MAX_IMPORT_ROWS = crmImport.MAX_IMPORT_ROWS;
export const parseStatus = crmImport.parseStatus;
export const parsePrice = crmImport.parsePrice;
export const parseStockOnHand = crmImport.parseStockOnHand;
export const csvToCatalogRows = crmImport.csvToCatalogRows;
export const upsertCatalogProducts = crmImport.upsertCatalogProducts;
export const importProductsFromCsv = crmImport.importProductsFromCsv;
