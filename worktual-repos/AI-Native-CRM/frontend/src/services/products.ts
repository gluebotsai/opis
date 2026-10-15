import { api } from "./api";

/** Shared list row for inventory.products catalog. */
export type ProductListItem = {
  id: string;
  name: string;
  sku: string | null;
  price: string | null;
  maxDiscountPercent?: string | null;
  currency: string;
  status: string;
  category: string | null;
  updatedAt: string;
  catalog?: "crm";
  brand?: string | null;
  subcategory?: string | null;
  tagline?: string | null;
  imageUrl?: string | null;
  stockOnHand?: number | null;
  productUrl?: string | null;
  productType?: string;
  tags?: string | null;
  addonCount?: number;
  offerCount?: number;
  listPrice?: string | null;
  listPriceSource?: string;
  unitOfMeasure?: string | null;
};

export type ProductDetail = {
  id: string;
  name: string;
  sku: string | null;
  price: string | null;
  maxDiscountPercent?: string | null;
  currency: string;
  status: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  brand?: string | null;
  subcategory?: string | null;
  stockOnHand?: number | null;
  tagline?: string | null;
  description?: string | null;
  specifications?: string | null;
  imageUrl?: string | null;
  galleryUrls?: string[];
  productUrl?: string | null;
  productType?: string;
  tags?: string | null;
  billingType?: string;
  billingFrequency?: string | null;
  unitOfMeasure?: string | null;
  listPrice?: string | null;
  listPriceSource?: string;
  offerCount?: number;
  customAttributes?: Record<string, unknown> | null;
  offers?: Array<{
    id: string;
    name: string;
    code: string | null;
    billingType: string | null;
    billingFrequency: string | null;
    includedQty: number | null;
    meterKey: string | null;
    sortOrder: number;
    status: string;
    listPrice: string | null;
  }>;
  addons?: Array<{
    id: string;
    name: string;
    unitLabel: string | null;
    meterKey?: string | null;
    isOverage?: boolean;
    pricingModel: string;
    flatPrice: string | null;
    unitPrice: string | null;
    stepSize: number | null;
    stepPrice: string | null;
    sortOrder: number;
    listPrice?: string | null;
    tiers: Array<{
      id: string;
      minQty: number;
      maxQty: number | null;
      unitPrice: string;
    }>;
  }>;
};

export type ProductInputBody = {
  name: string;
  sku: string;
  brand?: string | null;
  category?: string | null;
  subcategory?: string | null;
  stockOnHand?: number | null;
  price?: number | null;
  maxDiscountPercent?: number | null;
  currency?: string | null;
  status?: string;
  tagline?: string | null;
  description?: string | null;
  specifications?: string | null;
  imageUrl?: string | null;
  galleryUrls?: string[];
  productUrl?: string | null;
  productType?: string;
  tags?: string | null;
  billingType?: string;
  billingFrequency?: string | null;
  addons?: Array<Record<string, unknown>>;
  offers?: Array<Record<string, unknown>>;
  customAttributes?: Record<string, unknown> | null;
};

export async function fetchProductsPage(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  category?: string;
}) {
  const { data } = await api.get("/api/products", { params });
  return data as {
    catalog?: "crm";
    items: ProductListItem[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  };
}

export async function fetchProductCategories() {
  const { data } = await api.get("/api/products/categories");
  return data as { categories: string[] };
}

export async function fetchProduct(id: string) {
  const { data } = await api.get(`/api/products/${id}`);
  return data as
    | { ok: true; catalog?: "crm"; product: ProductDetail }
    | { ok: false; error: string };
}

export async function createProduct(body: ProductInputBody) {
  const { data } = await api.post("/api/products", body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function updateProduct(id: string, body: ProductInputBody) {
  const { data } = await api.patch(`/api/products/${id}`, body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

/** Activate / change status without rewriting addons or offers. */
export async function setProductStatus(id: string, status: string) {
  const { data } = await api.post(`/api/products/${id}/status`, { status });
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function deleteProduct(id: string) {
  const { data } = await api.delete(`/api/products/${id}`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function importProductsCsv(input: {
  csvText: string;
  dryRun?: boolean;
}) {
  const { data } = await api.post("/api/products/import", input);
  return data as
    | {
        ok: true;
        dryRun: boolean;
        parsed: number;
        created: number;
        updated: number;
        skipped: number;
        errors: Array<{ row: number; message: string }>;
      }
    | { ok: false; error: string };
}

export async function fetchProductsForSelect(limit?: number) {
  const { data } = await api.get("/api/products/select", {
    params: limit ? { limit } : undefined,
  });
  return data as {
    items: Array<{
      id: string;
      name: string;
      price: string | null;
      currency: string;
      sku: string | null;
    }>;
  };
}
