/** Per-lead key — avoids collisions when multiple customers use branch id "hq". */
export function activeProductKey(leadId, productId, branchId) {
  return `${leadId}:${productId}:${branchId}`;
}
