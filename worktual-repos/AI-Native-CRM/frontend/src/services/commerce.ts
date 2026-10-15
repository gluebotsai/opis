import { api } from "./api";

export type CommerceOrderRow = {
  id: string;
  number: string;
  status: string;
  total: string;
  currency: string;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
};

export type CommerceOrderDetail = {
  id: string;
  number: string;
  status: string;
  total: string;
  currency: string;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    name: string;
    quantity: string;
    unitPrice: string;
    amount: string;
  }>;
  invoices: Array<{
    id: string;
    number: string;
    status: string;
    total: string;
    currency: string;
  }>;
};

export async function fetchCommerceOrders(params?: {
  page?: number;
  contactId?: string;
}) {
  const { data } = await api.get<{
    ok: true;
    items: CommerceOrderRow[];
    total: number;
    page: number;
    pageSize: number;
    title: string;
    caption: string;
    canEdit: boolean;
  }>("/api/commerce/orders", { params });
  return data;
}

export async function fetchCommerceCreateOptions() {
  const { data } = await api.get<{
    ok: true;
    contacts: Array<{ id: string; displayName: string }>;
    products: Array<{ id: string; name: string; price: string | null }>;
    canEdit: boolean;
  }>("/api/commerce/orders/create-options");
  return data;
}

export async function fetchCommerceOrder(id: string) {
  const { data } = await api.get<
    { ok: true; order: CommerceOrderDetail } | { ok: false; error: string }
  >(`/api/commerce/orders/${id}`);
  return data;
}

export async function createCommerceOrder(body: {
  contactId: string;
  productId: string;
  quantity?: number;
}) {
  const { data } = await api.post("/api/commerce/orders", body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}
