/** Per-organization subscription key — one product at one location. */
export function subscriptionKey(organizationId: any, productId: any, branchId: any) {
  return `${organizationId}:${productId}:${branchId}`;
}
