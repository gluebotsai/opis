/** Event types shown under Recent interactions on visitor detail. */
export const VISITOR_COMMERCE_EVENT_TYPES = new Set([
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'add_to_wishlist',
  'remove_from_wishlist',
  'begin_checkout',
  'purchase',
]);

export function isVisitorCommerceEvent(eventType) {
  return VISITOR_COMMERCE_EVENT_TYPES.has(String(eventType ?? '').trim());
}

export function filterVisitorCommerceEvents(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => isVisitorCommerceEvent(row.event_type));
}

function pushCommerceEvent(events, eventType, row, timeField, quantity) {
  const createdAt = row?.[timeField] ?? row?.created_at;
  if (!createdAt) return;
  events.push({
    event_type: eventType,
    product_id: row.product_id,
    product_name: row.product_name,
    quantity: quantity ?? row.quantity ?? 1,
    value: row.value,
    currency: row.currency,
    created_at: createdAt,
  });
}

/** When API still returns generic clicks, derive commerce rows from product_activity + conversions. */
export function buildRecentCommerceFromActivity(productActivity, conversions = []) {
  const events = [];
  const activity = productActivity ?? {};

  for (const row of activity.products_viewed ?? []) {
    pushCommerceEvent(events, 'product_view', row, 'last_viewed_at', row.views ?? 1);
  }
  for (const row of activity.cart_added ?? []) {
    pushCommerceEvent(events, 'add_to_cart', row, 'last_added_at');
  }
  for (const row of activity.cart_removed ?? []) {
    pushCommerceEvent(events, 'remove_from_cart', row, 'last_removed_at');
  }
  for (const row of activity.wishlist_added ?? []) {
    pushCommerceEvent(events, 'add_to_wishlist', row, 'last_added_at');
  }
  for (const row of activity.wishlist_removed ?? []) {
    pushCommerceEvent(events, 'remove_from_wishlist', row, 'last_removed_at');
  }
  for (const row of activity.checkout_product_lines ?? []) {
    pushCommerceEvent(events, 'begin_checkout', {
      ...row,
      created_at: row.checkout_at,
    }, 'checkout_at');
  }
  for (const row of activity.purchase_product_lines ?? []) {
    pushCommerceEvent(events, 'purchase', {
      ...row,
      created_at: row.purchased_at,
      value: row.unit_price,
    }, 'purchased_at');
  }

  for (const row of conversions ?? []) {
    const type = String(row.conversion_type ?? '');
    if (type === 'purchase' || type === 'begin_checkout') {
      pushCommerceEvent(events, type, {
        product_id: row.product_id,
        product_name: row.product_id,
        value: row.value,
        currency: row.currency,
        created_at: row.created_at,
      }, 'created_at');
    }
  }

  return events.sort(
    (a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime(),
  );
}

export function resolveVisitorRecentCommerce(interactions, productActivity, conversions) {
  const fromApi = filterVisitorCommerceEvents(interactions);
  if (fromApi.length) return fromApi;
  return buildRecentCommerceFromActivity(productActivity, conversions);
}
