/** True when repair must not reactivate a cancelled/ended subscription for the same quote. */
export function shouldSkipCancelledSubscriptionResurrection(existingRow: any, quotationId: any, now = new Date()) {
  if (!existingRow) {
    return false;
  }

  const status = existingRow.status || "active";
  const existingQuoteId = existingRow.quotation_id || existingRow.quotationId || null;
  const sameQuote =
    !existingQuoteId || !quotationId || String(existingQuoteId) === String(quotationId);

  if (status === "cancelled") {
    return sameQuote;
  }

  const cancelAtPeriodEnd =
    existingRow.cancel_at_period_end === true || existingRow.cancelAtPeriodEnd === true;
  if (!cancelAtPeriodEnd) {
    return false;
  }

  const effectiveRaw =
    existingRow.cancel_effective_at ||
    existingRow.cancelEffectiveAt ||
    existingRow.renews_at ||
    existingRow.renewsAt;
  if (!effectiveRaw) {
    return false;
  }

  return sameQuote && new Date(effectiveRaw) <= now;
}
