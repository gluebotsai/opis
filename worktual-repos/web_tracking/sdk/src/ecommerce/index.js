import { stripCredentials } from '../privacy/consent.js';
import { createTracker } from '../tracking/tracker.js';

const { bindTrack, track: ecomTrackFn } = createTracker();
export { bindTrack };

function requireProductId(product, methodName) {
  const id = product?.productId || product?.id || product?.sku;
  if (!id) {
    throw new Error(`WorktualAnalytics.${methodName}: productId (or id/sku) is required`);
  }
  return id;
}

export function productView(product) {
  requireProductId(product, 'productView');
  ecomTrackFn('product_view', stripCredentials(normalizeProduct(product)));
}

export function addToCart(product) {
  requireProductId(product, 'addToCart');
  ecomTrackFn('add_to_cart', stripCredentials(normalizeProduct(product)));
}

export function removeFromCart(product) {
  requireProductId(product, 'removeFromCart');
  ecomTrackFn('remove_from_cart', stripCredentials(normalizeProduct(product)));
}

export function addToWishlist(product) {
  requireProductId(product, 'addToWishlist');
  ecomTrackFn('add_to_wishlist', stripCredentials(normalizeProduct(product)));
}

export function removeFromWishlist(product) {
  requireProductId(product, 'removeFromWishlist');
  ecomTrackFn('remove_from_wishlist', stripCredentials(normalizeProduct(product)));
}

export function beginCheckout(props = {}) {
  const rawLines = props.products || props.items;
  const { items: _items, ...rest } = props;
  const payload = stripCredentials({
    ...rest,
    currency: props.currency || 'USD',
    cartValue: props.cartValue ?? props.revenue ?? props.value,
    itemCount: props.itemCount,
    coupon: props.coupon,
    ...(Array.isArray(rawLines)
      ? { products: rawLines.map((line) => normalizeProduct(line)) }
      : {}),
  });
  ecomTrackFn('begin_checkout', payload);
}

/** Payment declined / checkout error (after gateway or API failure). */
export function paymentFailure(props = {}) {
  const rawLines = props.products || props.items;
  const { items: _items, ...rest } = props;
  const payload = stripCredentials({
    ...rest,
    currency: props.currency || 'USD',
    cartValue: props.cartValue ?? props.revenue ?? props.value,
    orderId: props.orderId || props.transactionId,
    errorCode: props.errorCode || props.code,
    errorMessage: props.errorMessage || props.message,
    paymentMethod: props.paymentMethod || props.method,
    ...(Array.isArray(rawLines)
      ? { products: rawLines.map((line) => normalizeProduct(line)) }
      : {}),
  });
  ecomTrackFn('payment_failure', payload);
}

export function purchase(order) {
  ecomTrackFn('purchase', stripCredentials(normalizeOrder(order)));
}

export function refund(order) {
  ecomTrackFn('refund', stripCredentials(normalizeOrder(order)));
}

function normalizeProduct(product) {
  return {
    productId: product.productId || product.id || product.sku,
    productName: product.productName || product.name,
    productCategory: product.productCategory || product.category,
    productPrice: product.productPrice ?? product.price,
    currency: product.currency || 'USD',
    quantity: product.quantity || 1,
    sku: product.sku,
    brand: product.brand,
  };
}

function normalizeOrder(order) {
  return {
    orderId: order.orderId || order.transactionId,
    revenue: order.revenue ?? order.total,
    currency: order.currency || 'USD',
    products: order.products || order.items || [],
    tax: order.tax,
    shipping: order.shipping,
  };
}
