const COMMERCE_EVENT_LABELS = {
  product_view: 'Product view',
  add_to_cart: 'Cart added',
  remove_from_cart: 'Cart removed',
  add_to_wishlist: 'Wishlist add',
  remove_from_wishlist: 'Wishlist remove',
  begin_checkout: 'Checkout',
  purchase: 'Purchase',
};

export function interactionEventLabel(eventType) {
  const key = String(eventType ?? '').trim();
  if (!key) return 'Activity';
  return COMMERCE_EVENT_LABELS[key] ?? key.replace(/_/g, ' ');
}

export function interactionEventTone(eventType) {
  const key = String(eventType ?? '');
  if (key === 'product_view') return 'view';
  if (key === 'add_to_cart' || key === 'add_to_wishlist') return 'add';
  if (key === 'remove_from_cart' || key === 'remove_from_wishlist') return 'remove';
  if (key === 'begin_checkout') return 'checkout';
  if (key === 'purchase') return 'purchase';
  return 'default';
}

export function commerceActivitySubtitle(row) {
  const name = String(row.product_name ?? '').trim() || String(row.product_id ?? '').trim();
  const qty = Number(row.quantity ?? 0);
  const parts = [];
  if (name) parts.push(name);
  if (qty > 1 && (row.event_type === 'add_to_cart' || row.event_type === 'remove_from_cart')) {
    parts.push(`qty ${qty}`);
  }
  const value = Number(row.value ?? 0);
  if (row.event_type === 'purchase' && value > 0) {
    const cur = String(row.currency ?? '').trim();
    parts.push(cur ? `${cur} ${value.toFixed(2)}` : value.toFixed(2));
  }
  return parts.length ? parts.join(' · ') : '—';
}
