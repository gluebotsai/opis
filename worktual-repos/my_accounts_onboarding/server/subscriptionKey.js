/** Per-organization subscription key — one product at one location. */
export function subscriptionKey(organizationId, productId, locationId) {
  return `${organizationId}:${productId}:${locationId}`;
}
