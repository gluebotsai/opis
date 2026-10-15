import { stripCredentials } from '../privacy/consent.js';
import { createTracker } from '../tracking/tracker.js';

export const PRODUCT_RATING_EVENT = 'product_rating';

const { bindTrack, track: ratingTrackFn } = createTracker();
export { bindTrack };

function parseScore(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Normalize cross-site product rating props (stored in fact_custom_events).
 * @param {Record<string, unknown>} input
 */
export function normalizeProductRating(input = {}) {
  const score = parseScore(input.score ?? input.rating ?? input.nps);
  if (score == null) {
    throw new Error('WorktualAnalytics.productRating: score (number) is required');
  }

  const orderId = String(
    input.orderId ?? input.orderNumber ?? input.order_id ?? '',
  ).trim();
  const orderItemId = String(
    input.orderItemId ?? input.order_item_id ?? '',
  ).trim();
  const productId = String(
    input.productId ?? input.product_id ?? input.sku ?? '',
  ).trim();

  if (!orderId && !orderItemId && !productId) {
    throw new Error(
      'WorktualAnalytics.productRating: orderId, orderItemId, or productId is required',
    );
  }

  const payload = {
    score,
    scale: String(input.scale ?? '0-10').trim() || '0-10',
    orderId: orderId || undefined,
    orderItemId: orderItemId || undefined,
    productId: productId || undefined,
    productName: input.productName ?? input.product_name ?? input.name,
    source: input.source ?? input.context,
    comment: input.comment ?? input.feedback,
    deliveredAt: input.deliveredAt ?? input.delivered_at,
    currency: input.currency,
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === '') delete payload[key];
  });

  return payload;
}

/**
 * Generic product / order-item rating (NPS, post-delivery score, etc.) — same event on all websites.
 * Stored as `product_rating` in fact_custom_events for CDP queries.
 *
 * @param {Record<string, unknown>} props
 */
export function productRating(props = {}) {
  ratingTrackFn(PRODUCT_RATING_EVENT, stripCredentials(normalizeProductRating(props)));
}

/**
 * Submit multiple line-item ratings in one call (one ingest event each).
 * @param {{ orderId?: string, scale?: string, source?: string, items?: Record<string, unknown>[] }} batch
 */
export function productRatings(batch = {}) {
  const items = batch.items || batch.responses || batch.products;
  if (!Array.isArray(items) || !items.length) {
    throw new Error('WorktualAnalytics.productRatings: items array is required');
  }
  const shared = {
    orderId: batch.orderId ?? batch.orderNumber,
    scale: batch.scale,
    source: batch.source,
    deliveredAt: batch.deliveredAt,
  };
  for (const line of items) {
    productRating({ ...shared, ...line });
  }
}
