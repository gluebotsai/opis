import { api } from "./api";

export type PriceBook = {
  id: string;
  name: string;
  code: string | null;
  currency: string;
  isDefault: boolean;
  entryCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PriceBookEntry = {
  id: string;
  priceBookId: string;
  productId: string | null;
  offerId: string | null;
  addonId: string | null;
  amount: string;
  billingFrequency: string | null;
};

export async function fetchPriceBooks() {
  const { data } = await api.get("/api/products/price-books");
  return data as { items: PriceBook[] };
}

export async function createPriceBook(body: {
  name: string;
  code?: string | null;
  currency?: string;
  isDefault?: boolean;
}) {
  const { data } = await api.post("/api/products/price-books", body);
  return data as { ok: true; book: PriceBook } | { ok: false; error: string };
}

export async function updatePriceBook(
  id: string,
  body: {
    name: string;
    code?: string | null;
    currency?: string;
    isDefault?: boolean;
  },
) {
  const { data } = await api.patch(`/api/products/price-books/${id}`, body);
  return data as { ok: true; book: PriceBook } | { ok: false; error: string };
}

export async function deletePriceBook(id: string) {
  const { data } = await api.delete(`/api/products/price-books/${id}`);
  return data as { ok: true } | { ok: false; error: string };
}

export async function fetchPriceBookEntries(params: {
  priceBookId: string;
  productId?: string;
}) {
  const { data } = await api.get("/api/products/price-book-entries", {
    params,
  });
  return data as
    | { ok: true; items: PriceBookEntry[] }
    | { ok: false; error: string };
}

export async function upsertPriceBookEntry(body: {
  priceBookId: string;
  productId?: string | null;
  offerId?: string | null;
  addonId?: string | null;
  amount: number;
  billingFrequency?: string | null;
}) {
  const { data } = await api.post("/api/products/price-book-entries", body);
  return data as
    | { ok: true; entry: PriceBookEntry }
    | { ok: false; error: string };
}

export async function deletePriceBookEntry(id: string) {
  const { data } = await api.delete(`/api/products/price-book-entries/${id}`);
  return data as { ok: true } | { ok: false; error: string };
}
