import { getStoredToken, isTokenExpired } from '../authStorage';
import { netRevenue } from './commerceRevenue';

export function liveStreamUrl() {
  const token = getStoredToken();
  if (!token || isTokenExpired(token)) return null;
  const params = new URLSearchParams({ token });
  return `/api/analytics/live/stream?${params.toString()}`;
}

export const ECOM_EVENT_TYPES = new Set([
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'add_to_wishlist',
  'remove_from_wishlist',
  'begin_checkout',
  'purchase',
  'refund',
  'payment_failure',
]);

export function applyCountsToOverview(overview, counts) {
  if (!counts || typeof counts !== 'object') return overview;
  const next = { ...(overview || {}) };
  const map = [
    'product_views',
    'cart_adds',
    'cart_removes',
    'wishlist_adds',
    'wishlist_removes',
    'checkout_starts',
    'purchases',
    'purchase_revenue',
    'refunds',
    'refund_value',
    'net_revenue',
    'unique_products_touched',
    'product_engaged_visitors',
    'add_to_cart_rate',
  ];
  for (const key of map) {
    if (counts[key] != null) next[key] = counts[key];
  }
  if (counts.net_revenue == null) {
    next.net_revenue = netRevenue(next.purchase_revenue, next.refund_value);
  }
  return next;
}

export function applyLiveProductRow(products, event) {
  const product = event?.product;
  if (!product?.id) return products || [];
  const list = Array.isArray(products) ? [...products] : [];
  const idx = list.findIndex((row) => String(row.product_id) === String(product.id));
  const type = event.type;
  const bump = (row, field) => ({ ...row, [field]: Number(row[field] ?? 0) + 1 });
  let row =
    idx >= 0
      ? { ...list[idx] }
      : {
          product_id: product.id,
          product_name: product.name || product.id,
          views: 0,
          cart_adds: 0,
          interactions: 0,
          purchases: 0,
          checkout_starts: 0,
        };
  if (type === 'product_view') row = bump(row, 'views');
  if (type === 'add_to_cart') row = bump(row, 'cart_adds');
  if (type === 'purchase') row = bump(row, 'purchases');
  if (type === 'begin_checkout') row = bump(row, 'checkout_starts');
  if (type !== 'product_view') {
    row.interactions = Number(row.interactions ?? 0) + 1;
  }
  if (product.name) row.product_name = product.name;
  if (idx >= 0) list[idx] = row;
  else list.unshift(row);
  return list;
}

export function applyLiveVisitorActivity(activity, event) {
  if (!activity || !ECOM_EVENT_TYPES.has(event?.type)) return activity;
  const product = event.product || {};
  const nowIso = new Date(event.ts || Date.now()).toISOString();
  const line = {
    product_id: product.id || '',
    product_name: product.name || product.id || '',
    quantity: product.qty || 1,
    created_at: nowIso,
    last_added_at: nowIso,
    last_viewed_at: nowIso,
    last_removed_at: nowIso,
    checkout_at: nowIso,
    purchased_at: nowIso,
  };
  const next = { ...activity };
  const prepend = (key) => {
    const list = Array.isArray(next[key]) ? next[key] : [];
    next[key] = [line, ...list].slice(0, 30);
  };
  if (event.type === 'product_view') prepend('products_viewed');
  if (event.type === 'add_to_cart') prepend('cart_added');
  if (event.type === 'remove_from_cart') prepend('cart_removed');
  if (event.type === 'add_to_wishlist') prepend('wishlist_added');
  if (event.type === 'remove_from_wishlist') prepend('wishlist_removed');
  if (event.type === 'begin_checkout') prepend('checkout_product_lines');
  if (event.type === 'purchase') prepend('purchase_product_lines');
  return next;
}

export function applyLiveTopProducts(topProducts, event) {
  return applyLiveProductRow(topProducts, event);
}

export function applyLiveRecentInteractions(rows, event) {
  if (!ECOM_EVENT_TYPES.has(event?.type)) return rows || [];
  const product = event.product || {};
  const next = {
    event_type: event.type,
    product_id: product.id,
    product_name: product.name,
    quantity: product.qty || 1,
    created_at: new Date(event.ts || Date.now()).toISOString(),
  };
  return [next, ...(rows || [])].slice(0, 20);
}

export function applyLiveCommerceRevenue(summary, event) {
  if (!summary || (event?.type !== 'purchase' && event?.type !== 'refund')) return summary;
  const order = event.order || {};
  const product = event.product || {};
  const value = Number(order.revenue ?? product.price ?? 0);
  if (!Number.isFinite(value)) return summary;

  const next = { ...summary };
  if (event.type === 'purchase') {
    next.purchases = Number(next.purchases ?? 0) + 1;
    next.purchase_revenue = Number(next.purchase_revenue ?? 0) + value;
    const cur = order.currency || product.currency;
    if (cur) next.currency = cur;
  }
  if (event.type === 'refund') {
    next.refunds = Number(next.refunds ?? 0) + 1;
    next.refund_value = Number(next.refund_value ?? 0) + value;
  }
  next.net_revenue = netRevenue(next.purchase_revenue, next.refund_value);
  return next;
}

export function applyLiveConversions(rows, event) {
  if (event?.type !== 'purchase' && event?.type !== 'begin_checkout' && event?.type !== 'refund') {
    return rows || [];
  }
  const product = event.product || {};
  const order = event.order || {};
  const next = {
    conversion_type: event.type,
    product_id: product.id || order.id || '',
    value: order.revenue ?? product.price ?? 0,
    currency: order.currency || product.currency || 'USD',
    created_at: new Date(event.ts || Date.now()).toISOString(),
  };
  return [next, ...(rows || [])].slice(0, 50);
}
