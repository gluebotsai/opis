/** Purchase revenue minus refund value (returns). */
export function netRevenue(purchaseRevenue, refundValue) {
  const purchase = Number(purchaseRevenue ?? 0);
  const refund = Number(refundValue ?? 0);
  if (Number.isNaN(purchase) || Number.isNaN(refund)) return null;
  return purchase - refund;
}

export function formatCommerceMoney(amount, currency = '') {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  const v = Number(amount).toFixed(2);
  const cur = String(currency ?? '').trim();
  return cur ? `${cur} ${v}` : v;
}

export function netRevenueBreakdownHint(purchaseRevenue, refundValue, currency = '') {
  const purchase = formatCommerceMoney(purchaseRevenue, currency);
  const refund = formatCommerceMoney(refundValue, currency);
  return `${purchase} purchases − ${refund} refunds`;
}
