/** Per-lead key — avoids collisions when multiple customers use branch id "hq". */
export function activeProductKey(leadId: any, productId: any, branchId: any) {
  return `${leadId}:${productId}:${branchId}`;
}
