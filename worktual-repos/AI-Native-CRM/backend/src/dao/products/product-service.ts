/**
 * Product catalog — inventory.products is the shared source for all motions.
 * Prisma Product uses @@schema("inventory"). DML only; no DDL.
 * cdp.products is not the CRM working copy (optional future import only).
 */

import * as crm from "@/dao/products/product-crm-service";

export type {
  ProductInput as CrmProductInput,
  ProductView as CrmProductView,
  AddonView,
  ProposalCatalogProduct,
} from "@/dao/products/product-crm-service";

export const listProducts = crm.listProducts;
export const listProductCategories = crm.listProductCategories;
export const getProduct = crm.getProduct;
export const createProduct = crm.createProduct;
export const updateProduct = crm.updateProduct;
export const updateProductStatus = crm.updateProductStatus;
export const deleteProduct = crm.deleteProduct;
export const listProductsForSelect = crm.listProductsForSelect;
export const listProductsByIds = crm.listProductsByIds;
export const listActiveProductsForProposalCatalog =
  crm.listActiveProductsForProposalCatalog;
export const consumeProductStockIfTracked = crm.consumeProductStockIfTracked;

export {
  formatProductPrice,
  PRODUCT_STATUS_LABELS,
} from "@/dao/products/product-labels";
