import { Prisma } from "@ai-contact-center/db-cc";

import type { DbClient } from "../lib/rls.js";

const ORDER_LIMIT = 20;

const ADDRESS_KEYS = [
  "shipping_address",
  "shippingAddress",
  "delivery_address",
  "deliveryAddress",
  "billing_address",
  "billingAddress",
  "default_address",
  "defaultAddress",
  "address",
] as const;

const DELIVERY_DATE_KEYS = [
  "expected_delivery",
  "expectedDelivery",
  "estimated_delivery_at",
  "delivery_date",
  "deliveryDate",
  "delivered_at",
  "deliveredAt",
] as const;

const TRACKING_KEYS = [
  "tracking_numbers",
  "tracking_id",
  "trackingId",
  "awb",
  "tracking_number",
] as const;

const COURIER_KEYS = ["courier", "carrier", "shipping_carrier"] as const;
const DELIVERY_STATUS_KEYS = ["delivery_status", "deliveryStatus"] as const;
const ORDER_URL_KEYS = ["order_url", "orderUrl", "shopify_order_url", "admin_url"] as const;
const LINE_NAME_KEYS = ["title", "name", "sku"] as const;

export type CustomerOrderLine = {
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  imageUrl: string | null;
};

export type CustomerOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string | null;
  totalAmount: string;
  currency: string;
  createdAt: string;
  address: string | null;
  deliveryDate: string | null;
  tracking: string | null;
  courier: string | null;
  deliveryStatus: string | null;
  orderUrl: string | null;
  lines: CustomerOrderLine[];
};

type OrderRow = {
  order_id: bigint | number | string;
  order_number: string;
  status: string;
  payment_status: string;
  fulfillment_status: string | null;
  total_amount: Prisma.Decimal | number | string;
  currency: string;
  created_at: Date | string;
  custom_fields: unknown;
  profile_custom_fields: unknown;
  city: string | null;
  region: string | null;
  country: string | null;
};

type ItemRow = {
  order_id: bigint | number | string;
  quantity: Prisma.Decimal | number | string | null;
  unit_price: Prisma.Decimal | number | string | null;
  custom_fields: unknown;
  product_name?: string | null;
  product_image?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textFrom(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "0") return null;
    return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value) && value !== 0) return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((entry) => textFrom(entry)).filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const parts = [
    "name",
    "address1",
    "address2",
    "line1",
    "line2",
    "city",
    "province",
    "region",
    "state",
    "zip",
    "postal_code",
    "country",
  ]
    .map((key) => textFrom(record[key]))
    .filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? parts.join(", ") : null;
}

function firstField(fields: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!fields) return null;
  for (const key of keys) {
    const text = textFrom(fields[key]);
    if (text) return text;
  }
  return null;
}

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith("http://") || value.startsWith("https://") ? value : null;
}

function money(value: Prisma.Decimal | number | string | null | undefined): string {
  if (value == null) return "0.00";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function profileAddress(
  fields: Record<string, unknown> | null,
  city: string | null,
  region: string | null,
  country: string | null,
): string | null {
  const fromFields = firstField(fields, ADDRESS_KEYS);
  if (fromFields) return fromFields;
  const fromProfile = [city, region, country].map((part) => part?.trim()).filter(Boolean).join(", ");
  return fromProfile || null;
}

export function mapCustomerOrder(row: OrderRow, items: ItemRow[]): CustomerOrder {
  const fields = asRecord(row.custom_fields);
  const fulfillment = row.fulfillment_status?.trim() || null;
  const status = row.status.trim();
  const lines = items.map((item) => {
    const itemFields = asRecord(item.custom_fields);
    const sku = firstField(itemFields, ["sku"]);
    const catalogName = item.product_name?.trim() || null;
    const fieldName = firstField(itemFields, ["title", "name"]);
    const name = catalogName || fieldName || firstField(itemFields, LINE_NAME_KEYS) || "Item";
    const quantity = Number(item.quantity ?? 0);
    return {
      name,
      sku: sku && sku !== name ? sku : null,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unitPrice: money(item.unit_price),
      imageUrl: httpUrl(item.product_image?.trim() || null),
    };
  });
  const created = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return {
    id: String(row.order_id),
    orderNumber: row.order_number.trim() || String(row.order_id),
    status,
    paymentStatus: row.payment_status.trim(),
    fulfillmentStatus: fulfillment && fulfillment.toLowerCase() !== status.toLowerCase() ? fulfillment : null,
    totalAmount: money(row.total_amount),
    currency: row.currency.trim() || "USD",
    createdAt: Number.isNaN(created.getTime()) ? new Date(0).toISOString() : created.toISOString(),
    address: firstField(fields, ADDRESS_KEYS) ?? profileAddress(asRecord(row.profile_custom_fields), row.city, row.region, row.country),
    deliveryDate: firstField(fields, DELIVERY_DATE_KEYS),
    tracking: firstField(fields, TRACKING_KEYS),
    courier: firstField(fields, COURIER_KEYS),
    deliveryStatus: firstField(fields, DELIVERY_STATUS_KEYS),
    orderUrl: httpUrl(firstField(fields, ORDER_URL_KEYS)),
    lines,
  };
}

async function loadInventoryProducts(
  db: DbClient,
  organizationId: string,
  items: ItemRow[],
): Promise<Map<string, { name: string | null; imageUrl: string | null }>> {
  const skus = [
    ...new Set(
      items
        .map((item) => firstField(asRecord(item.custom_fields), ["sku"]))
        .filter((sku): sku is string => Boolean(sku)),
    ),
  ];
  if (skus.length === 0) return new Map();
  const rows = await db.$queryRaw<Array<{ sku: string; name: string | null; image_url: string | null }>>`
    SELECT sku, name, image_url
    FROM inventory.products
    WHERE organization_id = ${organizationId}::bigint
      AND sku IN (${Prisma.join(skus)})
  `;
  const products = new Map<string, { name: string | null; imageUrl: string | null }>();
  for (const row of rows) {
    if (!row.sku) continue;
    products.set(row.sku, {
      name: row.name?.trim() || null,
      imageUrl: row.image_url?.trim() || null,
    });
  }
  return products;
}

export async function listCustomerOrders(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<CustomerOrder[]> {
  const trimmed = contactId.trim();
  if (!trimmed) return [];
  const rows = await db.$queryRaw<OrderRow[]>`
    SELECT
      o.order_id,
      o.order_number,
      o.status,
      o.payment_status,
      o.fulfillment_status,
      o.total_amount,
      o.currency,
      o.created_at,
      o.custom_fields,
      cp.custom_fields AS profile_custom_fields,
      cp.city,
      cp.region,
      cp.country
    FROM cdp.orders o
    LEFT JOIN cdp.customer_profile cp
      ON cp.organization_id = o.organization_id
     AND cp.cdp_id = ${trimmed}
    WHERE o.organization_id = ${organizationId}::bigint
      AND (
        o.cdp_id = ${trimmed}
        OR o.custom_fields->>'proposed_cdp_id' = ${trimmed}
      )
    ORDER BY o.created_at DESC
    LIMIT ${ORDER_LIMIT}
  `;
  if (rows.length === 0) return [];
  const orderIds = rows.map((row) => String(row.order_id));
  const items = await db.$queryRaw<ItemRow[]>`
    SELECT oi.order_id, oi.quantity, oi.unit_price, oi.custom_fields
    FROM cdp.order_items oi
    WHERE oi.organization_id = ${organizationId}::bigint
      AND oi.order_id IN (${Prisma.join(orderIds.map((id) => Prisma.sql`${id}::bigint`))})
    ORDER BY oi.order_item_id
  `;
  const productsBySku = await loadInventoryProducts(db, organizationId, items);
  const itemsByOrder = new Map<string, ItemRow[]>();
  for (const item of items) {
    const sku = firstField(asRecord(item.custom_fields), ["sku"]);
    const product = sku ? productsBySku.get(sku) : undefined;
    const named = product
      ? { ...item, product_name: product.name, product_image: product.imageUrl }
      : item;
    const key = String(named.order_id);
    const list = itemsByOrder.get(key) ?? [];
    list.push(named);
    itemsByOrder.set(key, list);
  }
  return rows.map((row) => mapCustomerOrder(row, itemsByOrder.get(String(row.order_id)) ?? []));
}
